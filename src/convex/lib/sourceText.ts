/* ── Source text: normalization, chunking, retrieval and prompt packing ────
 *
 * Content sources (uploaded files, imported web pages, YouTube transcripts,
 * research findings, pasted notes) can be far longer than one model request
 * can carry. This module is the retrieval step between the stored full text
 * and the prompt:
 *
 *   1. `chunkSourceText` splits each source into paragraph-aligned chunks;
 *   2. `rankChunks` scores chunks against the writing goal with BM25 (lexical,
 *      deterministic, no embedding provider needed);
 *   3. `packSources` builds the prompt block inside a character budget. When
 *      every selected source fits, every source goes in **in full**. When it
 *      does not, each source still gets a fair share of the budget, filled
 *      with its most relevant chunks in document order, and the result says
 *      exactly how much of each source was included — so the UI can tell the
 *      user the truth instead of implying the model read everything.
 *
 * Pure functions only (no Convex, no Node APIs), so it is unit tested
 * directly and usable from both runtimes.
 */

import * as cheerio from "cheerio";

/** Hard cap on stored text per source (characters). Keeps one row well under
 *  Convex's 1 MiB document limit even for multi-byte scripts. */
export const SOURCE_TEXT_MAX_CHARS = 180_000;

export const DEFAULT_CHUNK_CHARS = 1_400;
const CHUNK_OVERLAP_CHARS = 150;

export type SourceChunk = { index: number; start: number; text: string };

export type PackableSource = {
  id: string;
  title: string;
  kind: string;
  url?: string;
  text: string;
};

export type PackedSourceReport = {
  id: string;
  label: string; // S1, S2 … — the citation key the model is asked to use
  title: string;
  totalChars: number;
  includedChars: number;
  mode: "full" | "excerpts" | "omitted";
};

export type PackedSources = {
  block: string;
  reports: PackedSourceReport[];
};

/** Collapse runs of spaces while keeping paragraph breaks. */
export function normalizeSourceText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split(String.fromCharCode(0)).join("")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalize and cap stored source text; reports whether it was cut. */
export function capSourceText(raw: string, max = SOURCE_TEXT_MAX_CHARS): { text: string; truncated: boolean; originalChars: number } {
  const text = normalizeSourceText(raw);
  if (text.length <= max) return { text, truncated: false, originalChars: text.length };
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return {
    text: lastBreak > max * 0.9 ? cut.slice(0, lastBreak) : cut,
    truncated: true,
    originalChars: text.length,
  };
}

/**
 * Split text into chunks of roughly `size` characters on paragraph (then
 * sentence, then word) boundaries, with a small overlap so a fact spanning a
 * boundary is not lost.
 */
export function chunkSourceText(text: string, size = DEFAULT_CHUNK_CHARS): SourceChunk[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ index: 0, start: 0, text: clean }];

  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const minCut = Math.floor(size * 0.5);
      const para = window.lastIndexOf("\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const space = window.lastIndexOf(" ");
      const cut = para > minCut ? para + 1 : sentence > minCut ? sentence + 2 : space > minCut ? space + 1 : window.length;
      end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push({ index: chunks.length, start, text: piece });
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
    // Re-align the overlap to a word start so chunks do not open mid-word.
    const nextSpace = clean.indexOf(" ", start);
    if (nextSpace !== -1 && nextSpace < end) start = nextSpace + 1;
  }
  return chunks;
}

const STOP_WORDS = new Set(
  "a an and are as at be but by for from has have how i if in into is it its of on or our so that the their them then there these they this to was we what when which who why will with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  );
}

/** BM25 score of each chunk for `query`. Returns scores parallel to `chunks`. */
export function rankChunks(chunks: Array<{ text: string }>, query: string): number[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || !chunks.length) return chunks.map(() => 0);
  const docs = chunks.map((chunk) => tokenize(chunk.text));
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  return docs.map((doc) => {
    const termFrequency = new Map<string, number>();
    for (const term of doc) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = termFrequency.get(term) ?? 0;
      if (!tf) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avgLength)));
    }
    return score;
  });
}

/** Pick the most relevant chunks of one source that fit `budget`, returned in
 *  document order. Chunks shrink with the budget so at least four fit, and
 *  relevance decides; the opening chunk only wins ties (it usually states
 *  what the source is about). */
export function selectExcerpts(text: string, query: string, budget: number): { excerpt: string; includedChars: number } {
  const size = Math.max(300, Math.min(DEFAULT_CHUNK_CHARS, Math.floor(budget / 4)));
  const chunks = chunkSourceText(text, size);
  if (!chunks.length || budget <= 0) return { excerpt: "", includedChars: 0 };
  const scores = rankChunks(chunks, query);
  const order = chunks
    .map((chunk, i) => ({ chunk, score: scores[i] + (i === 0 ? 0.01 : 0) }))
    .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
  const picked: SourceChunk[] = [];
  let used = 0;
  for (const { chunk } of order) {
    if (used + chunk.text.length > budget) continue;
    picked.push(chunk);
    used += chunk.text.length;
  }
  if (!picked.length) {
    const head = chunks[0].text.slice(0, budget);
    return { excerpt: head, includedChars: head.length };
  }
  picked.sort((a, b) => a.index - b.index);
  const parts: string[] = [];
  let previous = -1;
  for (const chunk of picked) {
    if (previous !== -1 && chunk.index !== previous + 1) parts.push("[…]");
    parts.push(chunk.text);
    previous = chunk.index;
  }
  return { excerpt: parts.join("\n"), includedChars: used };
}

function sourceHeader(label: string, source: PackableSource, mode: PackedSourceReport["mode"], included: number): string {
  const scope = mode === "full" ? "full text" : `relevant excerpts, ${included.toLocaleString("en-US")} of ${source.text.length.toLocaleString("en-US")} characters`;
  return `<source id="${label}" kind="${source.kind}" title=${JSON.stringify(source.title.slice(0, 200))}${source.url ? ` url=${JSON.stringify(source.url.slice(0, 500))}` : ""} scope="${scope}">`;
}

/**
 * Build the sources block for a prompt within `budgetChars`.
 *
 * Every source fits → all of them in full. Otherwise the budget is split
 * fairly (short sources keep their full text and hand the rest back), and each
 * long source contributes its highest-ranked chunks for `query`.
 */
export function packSources(sources: PackableSource[], query: string, budgetChars: number): PackedSources {
  const labelled = sources
    .filter((source) => source.text.trim())
    .map((source, i) => ({ source, label: `S${i + 1}` }));
  if (!labelled.length) return { block: "", reports: [] };

  const overhead = labelled.length * 260; // headers + closing tags
  const available = Math.max(0, budgetChars - overhead);
  const total = labelled.reduce((sum, { source }) => sum + source.text.length, 0);

  const allowance = new Map<string, number>();
  if (total <= available) {
    for (const { source } of labelled) allowance.set(source.id, source.text.length);
  } else {
    // Water-filling: short sources take what they need, the rest is shared.
    let remaining = available;
    let pending = [...labelled].sort((a, b) => a.source.text.length - b.source.text.length);
    while (pending.length) {
      const share = Math.floor(remaining / pending.length);
      const [first] = pending;
      if (first.source.text.length <= share) {
        allowance.set(first.source.id, first.source.text.length);
        remaining -= first.source.text.length;
        pending = pending.slice(1);
      } else {
        for (const { source } of pending) allowance.set(source.id, share);
        pending = [];
      }
    }
  }

  const parts: string[] = [];
  const reports: PackedSourceReport[] = [];
  for (const { source, label } of labelled) {
    const budget = allowance.get(source.id) ?? 0;
    let body: string;
    let mode: PackedSourceReport["mode"];
    let includedChars: number;
    if (budget >= source.text.length) {
      body = source.text;
      mode = "full";
      includedChars = source.text.length;
    } else {
      const selected = selectExcerpts(source.text, query, budget);
      body = selected.excerpt;
      includedChars = selected.includedChars;
      mode = includedChars > 0 ? "excerpts" : "omitted";
    }
    reports.push({ id: source.id, label, title: source.title, totalChars: source.text.length, includedChars, mode });
    if (mode === "omitted") continue;
    parts.push(`${sourceHeader(label, source, mode, includedChars)}\n${body}\n</source>`);
  }
  return { block: parts.join("\n\n"), reports };
}

/* ── YouTube helpers ──────────────────────────────────────────────────── */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id from any common YouTube URL form, or null. */
export function parseYouTubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = match?.[1] ?? null;
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export type TranscriptSegment = { startMs?: number; text: string };

function timestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Join caption segments into readable paragraphs with a timestamp roughly
 *  every 45 seconds, so the model (and the reader) can cite a moment. */
export function transcriptToText(segments: TranscriptSegment[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let paragraphStart: number | undefined;
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text || /^\[(music|applause|laughter)\]$/i.test(text)) continue;
    if (paragraphStart === undefined) paragraphStart = segment.startMs;
    current.push(text);
    const elapsed = segment.startMs !== undefined && paragraphStart !== undefined ? segment.startMs - paragraphStart : 0;
    if (elapsed >= 45_000 || current.join(" ").length > 900) {
      paragraphs.push(`${paragraphStart !== undefined ? `[${timestamp(paragraphStart)}] ` : ""}${current.join(" ")}`);
      current = [];
      paragraphStart = undefined;
    }
  }
  if (current.length) paragraphs.push(`${paragraphStart !== undefined ? `[${timestamp(paragraphStart)}] ` : ""}${current.join(" ")}`);
  return paragraphs.join("\n");
}

/* ── File type detection ──────────────────────────────────────────────── */

export type SourceFileKind = "text" | "pdf" | "docx" | "html" | "unsupported_doc" | "unsupported";

export const SOURCE_FILE_MAX_BYTES = 15 * 1024 * 1024;

export function sourceFileKind(name: string, mimeType?: string): SourceFileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === "doc" || ext === "rtf" || ext === "odt" || mime === "application/msword") return "unsupported_doc";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "srt", "vtt"].includes(ext) || mime.startsWith("text/")) return "text";
  return "unsupported";
}

/** Strip SRT/WebVTT cue numbers and timings, keeping the spoken text. */
export function subtitleFileToText(raw: string): string {
  return raw
    .replace(/^WEBVTT.*$/m, "")
    .split(/\r?\n/)
    .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line) && !/^(NOTE|STYLE)\b/.test(line.trim()))
    .map((line) => line.replace(/<[^>]+>/g, ""))
    .join("\n");
}

/* ── Provider payloads ────────────────────────────────────────────────── */

const BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th, figcaption, dt, dd";

export function htmlToReadableText(html: string): { title?: string; text: string } {
  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr("content")?.trim() || $("head title").first().text().trim() || undefined;
  $("script, style, noscript, svg, iframe, form, nav, footer, header, aside, [aria-hidden='true'], .cookie, #cookie-banner").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const lines: string[] = [];
  root.find(BLOCK_SELECTOR).each((_, element) => {
    // Skip blocks nested in another captured block (li > p, td > p …).
    if ($(element).parents(BLOCK_SELECTOR).length) return;
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const tag = String($(element).prop("tagName") ?? "").toLowerCase();
    lines.push(/^h[1-6]$/.test(tag) ? `## ${text}` : tag === "li" ? `- ${text}` : text);
  });
  const text = lines.length ? lines.join("\n") : root.text();
  return { title: title?.slice(0, 200), text };
}

type TranscriptResult = { text: string; language?: string; kind?: string };

export function parseSerpTranscript(data: Record<string, unknown>): TranscriptResult {
  if (typeof data.error === "string") {
    throw new Error(/transcript|caption|subtitle/i.test(data.error)
      ? "This video has no captions or transcript available."
      : `SerpApi could not return the transcript: ${data.error.slice(0, 200)}`);
  }
  const rows = Array.isArray(data.transcript) ? data.transcript : null;
  if (!rows) throw new Error("This video has no captions or transcript available.");
  const segments: TranscriptSegment[] = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { snippet?: unknown; start_ms?: unknown };
    return typeof item.snippet === "string"
      ? [{ text: item.snippet, startMs: typeof item.start_ms === "number" ? item.start_ms : undefined }]
      : [];
  });
  const chapters = (Array.isArray(data.chapters) ? data.chapters : []).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { chapter?: unknown; start_ms?: unknown };
    return typeof item.chapter === "string" && typeof item.start_ms === "number" ? [{ title: item.chapter, startMs: item.start_ms }] : [];
  });
  // Interleave chapter headings so the structure survives chunking.
  const withChapters: TranscriptSegment[] = [];
  let next = 0;
  for (const segment of segments) {
    while (next < chapters.length && segment.startMs !== undefined && chapters[next].startMs <= segment.startMs) {
      withChapters.push({ text: `\n## ${chapters[next].title}\n` });
      next += 1;
    }
    withChapters.push(segment);
  }
  const text = transcriptToText(withChapters).replace(/\] ## /g, "]\n## ");
  const selected = (Array.isArray(data.available_transcripts) ? data.available_transcripts : []).find(
    (row) => row && typeof row === "object" && (row as { selected?: unknown }).selected === true,
  ) as { language_name?: unknown; type?: unknown } | undefined;
  return {
    text,
    language: typeof selected?.language_name === "string" ? selected.language_name : undefined,
    kind: selected?.type === "asr" ? "auto-generated captions" : selected ? "captions" : undefined,
  };
}

