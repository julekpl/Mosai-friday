"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { consumeAiQuotaForAction, requireActionUser } from "./guards";
import { reserveSerpApiCallForAction } from "./lib/providerUsage";

/* ── Universal content-research hub ───────────────────────────────────────
 *
 * One action fans a topic out across available sources:
 *   reddit · wikipedia · wikibooks · GDELT · YouTube (through SerpApi)
 *   newsapi · google trends · local news (google) · serpapi news · google books
 *
 * Keyless sources (reddit, wikipedia, wikibooks, gdlt, google books) always
 * run. Keyed sources run only when their key exists:
 *   SERPAPI_KEY → YouTube results, Google Trends, local news, Serp news
 *   NEWSAPI_KEY → newsapi
 * Each source returns a status envelope; one failed source never hides the
 * status or results of the other sources. YouTube HTML/transcript scraping is
 * intentionally unavailable because it has no supported collector here.
 */

const UA =
  "Mozilla/5.0 (compatible; MosaiBot/1.0; +https://mosai.app/bot)";

export type ResearchHit = {
  source: string;
  title: string;
  url?: string;
  snippet?: string;
};

export type SourceStatus = "ok" | "empty" | "needs_setup" | "rate_limited" | "failed";
export type SourceErrorCategory = "timeout" | "rate_limit" | "network" | "authentication" | "access_denied" | "provider_error" | "invalid_response" | "ceiling";
export type ResearchSource = {
  provider: string;
  status: SourceStatus;
  hits: ResearchHit[];
  retrievedAt: number;
  errorCategory?: SourceErrorCategory;
};
export type ResearchResult = { hits: ResearchHit[]; sources: ResearchSource[] };

class SourceRequestError extends Error {
  readonly category: SourceErrorCategory;

  constructor(category: SourceErrorCategory) {
    super(category);
    this.category = category;
  }
}

async function fetchJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json", ...(opts.headers ?? {}) },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      const category: SourceErrorCategory = res.status === 429
        ? "rate_limit"
        : res.status === 401
          ? "authentication"
          : res.status === 403
            ? "access_denied"
            : "provider_error";
      throw new SourceRequestError(category);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new SourceRequestError("invalid_response");
    }
  } catch (error) {
    if (error instanceof SourceRequestError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new SourceRequestError("timeout");
    }
    throw new SourceRequestError("network");
  } finally {
    clearTimeout(timer);
  }
}

function clean(s: string, max = 900): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceRequestError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function array<T = unknown>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new SourceRequestError("invalid_response");
  return value as T[];
}

function entriesWithTitle<T extends { title?: string }>(value: unknown): T[] {
  return array<unknown>(value).map((item) => {
    const entry = record(item);
    if (typeof entry.title !== "string") throw new SourceRequestError("invalid_response");
    return entry as T;
  });
}

/* ── Per-source collectors ────────────────────────────────────────────── */

async function researchReddit(query: string): Promise<ResearchHit[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=6&raw_json=1`;
  const data = await fetchJson<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>(url, {
    headers: { accept: "text/html,application/json" },
  });
  const children = array<{ data?: Record<string, unknown> }>(record(data.data).children);
  const posts = children.map((child) => {
    const post = record(child.data);
    if (typeof post.title !== "string") throw new SourceRequestError("invalid_response");
    return post;
  });
  return posts
    .map((p) => ({
      source: "reddit",
      title: clean(p.title as string, 160),
      url: `https://www.reddit.com${p.permalink ?? ""}`,
      snippet: clean(
        `${typeof p.subreddit_name_prefixed === "string" ? p.subreddit_name_prefixed + " · " : ""}${p.selftext ?? ""}`,
      ),
    }));
}

async function researchWikimedia(
  host: string,
  source: string,
  query: string,
): Promise<ResearchHit[]> {
  const url = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=4&format=json&origin=*`;
  const data = await fetchJson<{ query?: { search?: Array<{ title?: string; snippet?: string }> } }>(url);
  const search = entriesWithTitle<{ title?: string; snippet?: string }>(record(data.query).search);
  return search
    .map((s) => ({
      source,
      title: s.title as string,
      url: `https://${host}/wiki/${encodeURIComponent((s.title as string).replace(/ /g, "_"))}`,
      snippet: clean((s.snippet ?? "").replace(/<[^>]+>/g, "")),
    }));
}

async function researchGdlt(query: string): Promise<ResearchHit[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=5&format=json&sort=hybridrel`;
  const data = await fetchJson<{ articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string }> }>(url);
  const articles = entriesWithTitle<{ title?: string; url?: string; seendate?: string; domain?: string }>(record(data).articles);
  return articles
    .map((a) => ({
      source: "gdlt",
      title: clean(a.title as string, 160),
      url: a.url,
      snippet: clean(`${a.domain ?? ""} ${a.seendate ?? ""}`),
    }));
}

/** LQ-1: every SerpApi-backed collector reserves against the platform
 *  monthly ceiling AND the per-user daily cap (together, one mutation)
 *  before its fetch; at either limit the source degrades to `needs_setup`,
 *  never a silently empty or fake result. */
async function reserveSerpApiOrThrow(ctx: ActionCtx, userId: Id<"users">): Promise<void> {
  const reserved = await reserveSerpApiCallForAction(ctx, userId);
  if (!reserved.ok) throw new SourceRequestError("ceiling");
}

async function researchYoutube(ctx: ActionCtx, userId: Id<"users">, query: string, serpKey?: string): Promise<ResearchHit[]> {
  if (!serpKey) throw new SourceRequestError("provider_error");
  await reserveSerpApiOrThrow(ctx, userId);
  const params = new URLSearchParams({
      engine: "youtube",
      search_query: query,
      api_key: serpKey,
  });
  const data = await fetchJson<{
      video_results?: Array<{ title?: string; link?: string; snippet?: string; video_id?: string }>;
      error?: string;
  }>(`https://serpapi.com/search.json?${params}`);
  if (data.error) throw new SourceRequestError("provider_error");
  return entriesWithTitle<{ title?: string; link?: string; snippet?: string }>(data.video_results).slice(0, 4)
    .map((video) => ({
      source: "youtube",
      title: clean(video.title ?? "", 160),
      url: video.link,
      snippet: clean(video.snippet ?? ""),
    }));
}

async function researchNewsApi(query: string, key: string): Promise<ResearchHit[]> {
  const params = new URLSearchParams({ q: query, pageSize: "5", language: "en", sortBy: "relevancy" });
  const data = await fetchJson<{
    articles?: Array<{ title?: string; url?: string; description?: string; source?: { name?: string } }>;
  }>(`https://newsapi.org/v2/everything?${params}`, {
    headers: { "x-api-key": key },
  });
  const response = record(data);
  if (response.status === "error") throw new SourceRequestError("provider_error");
  if (response.status !== "ok") throw new SourceRequestError("invalid_response");
  const articles = entriesWithTitle<{ title?: string; url?: string; description?: string; source?: { name?: string } }>(response.articles);
  return articles
    .map((a) => ({
      source: "newsapi",
      title: clean(a.title as string, 160),
      url: a.url,
      snippet: clean(`${a.source?.name ? a.source.name + " · " : ""}${a.description ?? ""}`),
    }));
}

async function serpSearch(
  ctx: ActionCtx,
  userId: Id<"users">,
  params: Record<string, string>,
  key: string,
): Promise<Array<Record<string, unknown>>> {
  await reserveSerpApiOrThrow(ctx, userId);
  const sp = new URLSearchParams({ ...params, api_key: key });
  const data = await fetchJson<{
    news_results?: Array<Record<string, unknown>>;
    organic_results?: Array<Record<string, unknown>>;
    related_queries?: Array<{ query?: string; value?: number }>;
    error?: string;
  }>(`https://serpapi.com/search.json?${sp}`);
  if (data.error) throw new SourceRequestError("provider_error");
  const hasResultList = Array.isArray(data.news_results) || Array.isArray(data.organic_results);
  if (!hasResultList) throw new SourceRequestError("invalid_response");
  return entriesWithTitle<Record<string, unknown>>([
    ...(Array.isArray(data.news_results) ? data.news_results : []),
    ...(Array.isArray(data.organic_results) ? data.organic_results : []),
  ]);
}

/** Google Trends via SerpApi: related rising queries = demand signal. */
async function researchTrends(ctx: ActionCtx, userId: Id<"users">, query: string, key: string): Promise<ResearchHit[]> {
  await reserveSerpApiOrThrow(ctx, userId);
  const sp = new URLSearchParams({
    engine: "google_trends",
    data_type: "RELATED_QUERIES",
    q: query,
    api_key: key,
  });
  const data = await fetchJson<{
    related_queries?: { rising?: Array<{ query?: string; extracted_value?: number }> };
    error?: string;
  }>(`https://serpapi.com/search.json?${sp}`);
  if (data.error) throw new SourceRequestError("provider_error");
  const relatedQueries = record(data.related_queries);
  const rising = array<{ query?: string; extracted_value?: number }>(relatedQueries.rising).map((row) => {
    if (!row || typeof row !== "object" || typeof row.query !== "string") {
      throw new SourceRequestError("invalid_response");
    }
    return row;
  });
  return rising
    .slice(0, 5)
    .map((r) => ({
      source: "trends",
      title: `↗ rising: ${r.query}`,
      snippet:
        typeof r.extracted_value === "number"
          ? `search interest up (${r.extracted_value}+ % growth signal)`
          : "rising search interest",
    }));
}

async function researchGoogleBooks(query: string): Promise<ResearchHit[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=4`;
  const data = await fetchJson<{
    items?: Array<{ volumeInfo?: { title?: string; description?: string; infoLink?: string; authors?: string[] } }>;
  }>(url);
  const response = record(data);
  if (response.error) throw new SourceRequestError("provider_error");
  const items = response.items === undefined && response.totalItems === 0
    ? []
    : array<{ volumeInfo?: { title?: string; description?: string; infoLink?: string; authors?: string[] } }>(response.items).map((item) => {
      const volumeInfo = record(item.volumeInfo);
      if (typeof volumeInfo.title !== "string") throw new SourceRequestError("invalid_response");
      return item;
    });
  return items
    .map((i) => ({
      source: "google_books",
      title: clean(i.volumeInfo?.title ?? "", 160),
      url: i.volumeInfo?.infoLink,
      snippet: clean(
        `${(i.volumeInfo?.authors ?? []).join(", ") ? (i.volumeInfo?.authors ?? []).join(", ") + " · " : ""}${i.volumeInfo?.description ?? ""}`,
      ),
    }));
}

/* ── Action ────────────────────────────────────────────────────────────── */

export const researchTopic = action({
  args: {
    query: v.string(),
    personaContext: v.optional(v.string()), // sharpens ambiguous queries
    location: v.optional(v.string()), // local-news geotarget, e.g. "Austin, TX"
  },
  handler: async (ctx, { query, location }): Promise<ResearchResult> => {
    const userId = await requireActionUser(ctx);
    await consumeAiQuotaForAction(ctx, userId);
    const q = query.trim();
    if (!q) throw new Error("Empty research query");
    const serpKey = process.env.SERPAPI_KEY;
    const newsKey = process.env.NEWSAPI_KEY;
    // Local news aims at geo + topic; SerpApi google news otherwise.
    const localQ = location ? `${q} ${location}` : q;

    const collectors: Array<{
      provider: string;
      configured: boolean;
      collect: () => Promise<ResearchHit[]>;
    }> = [
      { provider: "reddit", configured: true, collect: () => researchReddit(q) },
      { provider: "wikipedia", configured: true, collect: () => researchWikimedia("en.wikipedia.org", "wikipedia", q) },
      { provider: "wikibooks", configured: true, collect: () => researchWikimedia("en.wikibooks.org", "wikibooks", q) },
      { provider: "gdlt", configured: true, collect: () => researchGdlt(q) },
      { provider: "youtube", configured: Boolean(serpKey), collect: () => researchYoutube(ctx, userId, q, serpKey) },
      { provider: "google_books", configured: true, collect: () => researchGoogleBooks(q) },
      { provider: "newsapi", configured: Boolean(newsKey), collect: () => newsKey ? researchNewsApi(q, newsKey) : Promise.resolve([]) },
      { provider: "trends", configured: Boolean(serpKey), collect: () => serpKey ? researchTrends(ctx, userId, q, serpKey) : Promise.resolve([]) },
      {
        provider: "local_news",
        configured: Boolean(serpKey),
        collect: () => serpKey
          ? serpSearch(
            ctx,
            userId,
            {
              engine: "google",
              tbm: "nws",
              q: localQ,
              ...(location ? { location } : {}),
            },
            serpKey,
          )
            .then((rs) =>
              rs.slice(0, 4).map((r) => ({
                source: "local_news",
                title: clean(String(r.title ?? ""), 160),
                url: typeof r.link === "string" ? r.link : undefined,
                snippet: clean(String(r.snippet ?? "")),
              })),
            )
            : Promise.resolve([]),
      },
      {
        provider: "serp_news",
        configured: Boolean(serpKey),
        collect: () => serpKey
          ? serpSearch(ctx, userId, { engine: "google_news", q }, serpKey)
            .then((rs) =>
              rs.slice(0, 4).map((r) => ({
                source: "serp_news",
                title: clean(String(r.title ?? ""), 160),
                url: typeof r.link === "string" ? r.link : undefined,
                snippet: clean(
                  `${typeof r.source === "object" && r.source && "name" in r.source ? String((r.source as { name?: string }).name ?? "") : ""} · ${String(r.snippet ?? "")}`,
                ),
              })),
            )
            : Promise.resolve([]),
      },
    ];

    const sources = await Promise.all(
      collectors.map(async ({ provider, configured, collect }): Promise<ResearchSource> => {
        if (!configured) {
          return { provider, status: "needs_setup", hits: [], retrievedAt: Date.now() };
        }
        try {
          const hits = await collect();
          return {
            provider,
            status: hits.length ? "ok" : "empty",
            hits,
            retrievedAt: Date.now(),
          };
        } catch (error) {
          const category = error instanceof SourceRequestError ? error.category : "provider_error";
          const status: SourceStatus =
            category === "rate_limit" ? "rate_limited" : category === "ceiling" ? "needs_setup" : "failed";
          return {
            provider,
            status,
            hits: [],
            retrievedAt: Date.now(),
            errorCategory: category,
          };
        }
      }),
    );
    const seen = new Set<string>();
    const merged: ResearchHit[] = [];
    for (const source of sources) {
      for (const h of source.hits) {
        const key = (h.url ?? h.title).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(h);
      }
    }
    return { hits: merged.slice(0, 100), sources };
  },
});
