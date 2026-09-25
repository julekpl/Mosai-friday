"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { consumeAiQuotaForAction, moduleAction } from "./guards";
import { safeFetch } from "./lib/safeFetch";
import {
  SOURCE_FILE_MAX_BYTES,
  capSourceText,
  htmlToReadableText,
  parseSerpTranscript,
  parseYouTubeVideoId,
  sourceFileKind,
  subtitleFileToText,
} from "./lib/sourceText";

/* ── Content source imports (files, web pages, YouTube, research) ─────────
 *
 * Each action authorizes the content piece first (`moduleAction("create")`
 * checks the capability from `pieceId`; `contentGenerationReferences` checks
 * project access), then obtains text and stores it through
 * `contentSources.insert`.
 *
 *  - Files: the browser uploads to Convex storage; text is extracted here
 *    (PDF via unpdf, DOCX via mammoth, text/markdown/CSV/HTML/subtitles as
 *    text) and the blob is deleted once read.
 *  - Web pages: fetched only through `safeFetch` (HTTPS, public hosts,
 *    re-validated redirects), then reduced to readable paragraphs.
 *    Wikipedia/Wikibooks use the MediaWiki plain-text extract API.
 *  - YouTube: captions through SerpApi's `youtube_video_transcript` engine
 *    (the key this project already uses for YouTube search). No unsupported
 *    scraping of YouTube pages. Without SERPAPI_KEY the import reports
 *    `needs setup` honestly instead of storing the page shell.
 *
 * Everything imported is data for the writer and the model, never
 * instructions.
 */

const UA = "Mozilla/5.0 (compatible; MosaiBot/1.0; +https://mosai.app/bot)";
/** A blob must be imported within this window of its upload. */
const UPLOAD_MAX_AGE_MS = 30 * 60 * 1000;

type ImportResult = { sourceId: Id<"contentSources">; title: string; charCount: number; truncated: boolean };

async function authorizedPiece(
  ctx: ActionCtx,
  pieceId: Id<"contentPieces">,
  userId: Id<"users">,
): Promise<{ piece: Doc<"contentPieces">; topic: Doc<"contentTopics"> | null }> {
  const refs = await ctx.runQuery(internal.guards.contentGenerationReferences, { pieceId, userId });
  if (!refs) throw new Error("Not found");
  return { piece: refs.piece, topic: refs.topic };
}

async function store(
  ctx: ActionCtx,
  piece: Doc<"contentPieces">,
  userId: Id<"users">,
  source: {
    kind: "file" | "web" | "youtube" | "research";
    title: string;
    url?: string;
    provider?: string;
    fileName?: string;
    text: string;
    truncated?: boolean;
    extraction: string;
  },
): Promise<ImportResult> {
  const capped = capSourceText(source.text);
  if (capped.text.length < 20) throw new Error("No readable text was found in this source.");
  const sourceId = await ctx.runMutation(internal.contentSources.insert, {
    projectId: piece.projectId,
    pieceId: piece._id,
    userId,
    kind: source.kind,
    title: source.title,
    url: source.url,
    provider: source.provider,
    fileName: source.fileName,
    text: capped.text,
    truncated: Boolean(source.truncated) || capped.truncated,
    extraction: source.extraction,
  });
  return { sourceId, title: source.title, charCount: capped.text.length, truncated: Boolean(source.truncated) || capped.truncated };
}

/* ── Providers ────────────────────────────────────────────────────────── */

async function fetchJson(url: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: controller.signal });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(res.ok ? "The provider returned an unreadable response." : `The provider refused the request (HTTP ${res.status}).`);
    }
    if (!res.ok && !("error" in body)) throw new Error(`The provider refused the request (HTTP ${res.status}).`);
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The provider did not answer in time. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function importYouTube(videoId: string, languageCode?: string): Promise<{ title: string; url: string; text: string; extraction: string }> {
  const serpKey = process.env.SERPAPI_KEY;
  if (!serpKey) {
    throw new Error("YouTube transcripts need setup: the SERPAPI_KEY environment variable is not configured for this deployment.");
  }
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const params = new URLSearchParams({ engine: "youtube_video_transcript", v: videoId, api_key: serpKey });
  if (languageCode) params.set("language_code", languageCode);
  const [transcript, oembed] = await Promise.all([
    fetchJson(`https://serpapi.com/search.json?${params}`, 30_000).then(parseSerpTranscript),
    fetchJson(`https://www.youtube.com/oembed?${new URLSearchParams({ url, format: "json" })}`).catch(() => null),
  ]);
  const title = typeof oembed?.title === "string" ? oembed.title : `YouTube video ${videoId}`;
  const channel = typeof oembed?.author_name === "string" ? ` · ${oembed.author_name}` : "";
  return {
    title: `${title}${channel}`,
    url,
    text: transcript.text,
    extraction: `YouTube transcript via SerpApi${transcript.kind ? ` (${transcript.kind}${transcript.language ? `, ${transcript.language}` : ""})` : ""}`,
  };
}

const WIKI_HOST = /^([a-z-]+)\.(wikipedia|wikibooks)\.org$/;

async function importWiki(url: URL): Promise<{ title: string; text: string; extraction: string } | null> {
  const match = url.hostname.toLowerCase().replace(/^m\./, "").match(WIKI_HOST) ?? url.hostname.toLowerCase().match(/^([a-z-]+)\.m\.(wikipedia|wikibooks)\.org$/);
  const page = url.pathname.startsWith("/wiki/") ? decodeURIComponent(url.pathname.slice(6)) : null;
  if (!match || !page) return null;
  const api = `https://${match[1]}.${match[2]}.org/w/api.php?${new URLSearchParams({
    action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", redirects: "1", format: "json", titles: page,
  })}`;
  const result = await safeFetch(api, { headers: { "user-agent": UA, accept: "application/json" }, maxBytes: 2_000_000, timeoutMs: 15_000 });
  const data = JSON.parse(result.text) as { query?: { pages?: Record<string, { title?: string; extract?: string }> } };
  const first = Object.values(data.query?.pages ?? {})[0];
  if (!first?.extract) return null;
  return {
    title: first.title ?? page.replace(/_/g, " "),
    text: first.extract.replace(/^(={2,})\s*(.+?)\s*\1$/gm, "## $2"),
    extraction: `${match[2] === "wikibooks" ? "Wikibooks" : "Wikipedia"} full article text (MediaWiki API)`,
  };
}

async function importRedditThread(url: URL): Promise<{ title: string; text: string; extraction: string } | null> {
  if (!/(^|\.)reddit\.com$/.test(url.hostname) || !/\/comments\//.test(url.pathname)) return null;
  const jsonUrl = `https://www.reddit.com${url.pathname.replace(/\/$/, "")}.json?raw_json=1&limit=40&depth=2`;
  const result = await safeFetch(jsonUrl, { headers: { "user-agent": UA, accept: "application/json" }, maxBytes: 2_000_000 });
  if (!result.ok) return null;
  const data = JSON.parse(result.text) as Array<{ data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> } }>;
  const post = data[0]?.data?.children?.[0]?.data;
  if (!post || typeof post.title !== "string") return null;
  const lines = [`## ${post.title}`, typeof post.selftext === "string" ? post.selftext : "", "", "## Top comments"];
  for (const child of data[1]?.data?.children ?? []) {
    if (child.kind !== "t1") continue;
    const body = child.data?.body;
    const score = child.data?.score;
    if (typeof body === "string" && body.trim() && body !== "[deleted]" && body !== "[removed]") {
      lines.push(`- (${typeof score === "number" ? `${score} points` : "comment"}) ${body.replace(/\s+/g, " ").trim()}`);
    }
  }
  return { title: post.title, text: lines.join("\n"), extraction: "Reddit thread with top comments (public JSON)" };
}

async function importWebPage(raw: string): Promise<{ title: string; url: string; text: string; extraction: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  const wiki = await importWiki(url).catch(() => null);
  if (wiki) return { ...wiki, url: url.toString() };
  const reddit = await importRedditThread(url).catch(() => null);
  if (reddit) return { ...reddit, url: url.toString() };

  const result = await safeFetch(url.toString(), {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    maxBytes: 3_000_000,
    timeoutMs: 15_000,
  });
  if (!result.ok) throw new Error(`The page answered HTTP ${result.status}; nothing was imported.`);
  const looksHtml = /<html|<body|<p[\s>]/i.test(result.text.slice(0, 5_000));
  const page = looksHtml ? htmlToReadableText(result.text) : { title: undefined, text: result.text };
  return {
    title: page.title ?? url.hostname + url.pathname,
    url: result.url,
    text: page.text,
    extraction: looksHtml ? "Web page, readable text extracted" : "Web page, plain text",
  };
}

async function extractFileText(bytes: ArrayBuffer, name: string, mimeType?: string): Promise<{ text: string; extraction: string }> {
  const kind = sourceFileKind(name, mimeType);
  switch (kind) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      const pages = (text as string[]).map((page, i) => (page.trim() ? `[page ${i + 1}]\n${page}` : "")).filter(Boolean);
      if (!pages.length) {
        throw new Error("This PDF has no text layer (it is probably scanned images). Run OCR on it first, then upload again.");
      }
      return { text: pages.join("\n\n"), extraction: `PDF text layer, ${totalPages} page${totalPages === 1 ? "" : "s"}` };
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: result.value, extraction: "Word document (.docx) text" };
    }
    case "html":
      return { text: htmlToReadableText(new TextDecoder().decode(bytes)).text, extraction: "HTML file, readable text extracted" };
    case "text": {
      const raw = new TextDecoder().decode(bytes);
      const subtitles = /\.(srt|vtt)$/i.test(name);
      return { text: subtitles ? subtitleFileToText(raw) : raw, extraction: subtitles ? "Subtitle file, cue text" : "Text file" };
    }
    case "unsupported_doc":
      throw new Error("Legacy .doc, .rtf and .odt files cannot be read yet. Save the file as .docx or PDF and upload it again.");
    default:
      throw new Error("This file type is not supported. Upload .txt, .md, .csv, .json, .html, .srt, .vtt, .pdf or .docx.");
  }
}

/* ── Public actions ───────────────────────────────────────────────────── */

export const importFile = moduleAction("create", {
  args: {
    pieceId: v.id("contentPieces"),
    storageId: v.id("_storage"),
    name: v.string(),
  },
  handler: async (ctx, { pieceId, storageId, name }, access): Promise<ImportResult> => {
    const userId = await access.requireUser();
    const { piece } = await authorizedPiece(ctx, pieceId, userId);
    try {
      const blob = await ctx.runQuery(internal.contentSources.uploadedBlob, { storageId });
      // Only a fresh upload is accepted: a storage id that has been sitting in
      // storage (another feature's file) is refused, and the blob is deleted
      // below once read, so an id cannot be replayed.
      if (!blob || Date.now() - blob.createdAt > UPLOAD_MAX_AGE_MS) throw new Error("Upload not found. Upload the file again.");
      if (blob.size > SOURCE_FILE_MAX_BYTES) throw new Error("Files up to 15 MB can be imported.");
      const data = await ctx.storage.get(storageId);
      if (!data) throw new Error("Upload not found. Upload the file again.");
      const fileName = name.trim().slice(0, 200) || "Uploaded file";
      const { text, extraction } = await extractFileText(await data.arrayBuffer(), fileName, blob.contentType ?? undefined);
      return await store(ctx, piece, userId, {
        kind: "file",
        title: fileName.replace(/\.[a-z0-9]+$/i, ""),
        fileName,
        provider: blob.contentType ?? undefined,
        text,
        extraction,
      });
    } finally {
      await ctx.storage.delete(storageId).catch(() => undefined);
    }
  },
});

export const importUrl = moduleAction("create", {
  args: {
    pieceId: v.id("contentPieces"),
    url: v.string(),
    languageCode: v.optional(v.string()),
  },
  handler: async (ctx, { pieceId, url, languageCode }, access): Promise<ImportResult> => {
    const userId = await access.requireUser();
    const { piece } = await authorizedPiece(ctx, pieceId, userId);
    const videoId = parseYouTubeVideoId(url);
    if (videoId) {
      await consumeAiQuotaForAction(ctx, userId); // SerpApi call is metered
      const language = languageCode && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(languageCode) ? languageCode : undefined;
      const video = await importYouTube(videoId, language);
      return await store(ctx, piece, userId, { kind: "youtube", provider: "youtube", ...video });
    }
    const page = await importWebPage(url);
    return await store(ctx, piece, userId, { kind: "web", ...page });
  },
});

/**
 * Turn one saved research finding of the piece's topic into a full-text
 * source. The finding is read from the database by index (never from the
 * client), its URL is imported with the same rules as `importUrl`, and when
 * the page cannot be read the provider snippet is stored and labelled as
 * such — never passed off as the full text.
 */
export const importResearchFinding = moduleAction("create", {
  args: {
    pieceId: v.id("contentPieces"),
    index: v.number(),
  },
  handler: async (ctx, { pieceId, index }, access): Promise<ImportResult & { fullText: boolean }> => {
    const userId = await access.requireUser();
    const { piece, topic } = await authorizedPiece(ctx, pieceId, userId);
    const finding = topic?.research?.[index];
    if (!finding) throw new Error("That research finding no longer exists.");
    const label = `${finding.source}`;
    if (finding.url) {
      try {
        const videoId = parseYouTubeVideoId(finding.url);
        if (videoId) {
          await consumeAiQuotaForAction(ctx, userId);
          const video = await importYouTube(videoId);
          return { ...(await store(ctx, piece, userId, { kind: "youtube", provider: "youtube", ...video })), fullText: true };
        }
        const page = await importWebPage(finding.url);
        return {
          ...(await store(ctx, piece, userId, { kind: "research", provider: label, ...page, title: finding.title || page.title })),
          fullText: true,
        };
      } catch {
        // fall through to the snippet
      }
    }
    const snippet = [finding.title, finding.snippet].filter(Boolean).join("\n");
    return {
      ...(await store(ctx, piece, userId, {
        kind: "research",
        provider: label,
        title: finding.title,
        url: finding.url,
        text: snippet.length >= 20 ? snippet : `${snippet} (no further text available)`,
        extraction: finding.url ? "Search snippet only: the full page could not be read" : "Search snippet only",
      })),
      fullText: false,
    };
  },
});
