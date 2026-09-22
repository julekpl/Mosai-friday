"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { consumeAiQuotaForAction, requireActionUser } from "./guards";

/* ── Universal content-research hub ───────────────────────────────────────
 *
 * One action fans a topic out across every connected source:
 *   reddit · wikipedia · wikibooks · GDELT · youtube (+ transcript)
 *   newsapi · google trends · local news (google) · serpapi news · google books
 *
 * Keyless sources (reddit, wikipedia, wikibooks, gdlt, youtube scrape,
 * google books) always run. Keyed sources run only when their key exists:
 *   SERPAPI_KEY → youtube results, google trends, local news, serp news
 *   NEWSAPI_KEY → newsapi
 * Failures are per-source and silent: a dead source never blocks the rest.
 */

const UA =
  "Mozilla/5.0 (compatible; MosaiBot/1.0; +https://mosai.app/bot)";

export type ResearchHit = {
  source: string;
  title: string;
  url?: string;
  snippet?: string;
};

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function clean(s: string, max = 280): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/* ── Per-source collectors (each returns [] on any failure) ───────────── */

async function researchReddit(query: string): Promise<ResearchHit[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=6&raw_json=1`;
  const data = await fetchJson<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>(url, {
    headers: { accept: "text/html,application/json" },
  });
  return (data.data?.children ?? [])
    .map((c) => c.data ?? {})
    .filter((p) => typeof p.title === "string")
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
  return (data.query?.search ?? [])
    .filter((s) => typeof s.title === "string")
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
  return (data.articles ?? [])
    .filter((a) => typeof a.title === "string")
    .map((a) => ({
      source: "gdlt",
      title: clean(a.title as string, 160),
      url: a.url,
      snippet: clean(`${a.domain ?? ""} ${a.seendate ?? ""}`),
    }));
}

/** Best-effort YouTube transcript via the watch page's caption tracks. */
async function youtubeTranscript(videoId: string): Promise<string | undefined> {
  try {
    const html = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) },
    ).then((r) => r.text());
    const m = html.match(/"captionTracks":(\[.*?\])/s);
    if (!m) return undefined;
    const tracks = JSON.parse(m[1]) as Array<{ baseUrl?: string; languageCode?: string }>;
    const track = tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0];
    if (!track?.baseUrl) return undefined;
    const xml = await fetch(track.baseUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(12_000),
    }).then((r) => r.text());
    const text = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
      .map((m2) => m2[1].replace(/&amp;#39;/g, "'").replace(/&amp;quot;/g, '"').replace(/&amp;amp;/g, "&").replace(/&[^;]+;/g, " "))
      .join(" ");
    return clean(text, 900) || undefined;
  } catch {
    return undefined;
  }
}

async function researchYoutube(query: string, serpKey?: string): Promise<ResearchHit[]> {
  if (serpKey) {
    const params = new URLSearchParams({
      engine: "youtube",
      search_query: query,
      api_key: serpKey,
    });
    const data = await fetchJson<{
      video_results?: Array<{ title?: string; link?: string; snippet?: string; video_id?: string }>;
      error?: string;
    }>(`https://serpapi.com/search.json?${params}`);
    const videos = (data.video_results ?? []).slice(0, 4);
    const hits: ResearchHit[] = [];
    for (const v of videos) {
      if (!v.title) continue;
      const videoId =
        v.video_id ??
        (v.link ? (v.link.match(/[?&]v=([\w-]{6,})/)?.[1] ?? undefined) : undefined);
      let snippet = clean(v.snippet ?? "");
      if (videoId) {
        const transcript = await youtubeTranscript(videoId);
        if (transcript) snippet = `${snippet ? snippet + " · " : ""}[transcript] ${transcript}`;
      }
      hits.push({ source: "youtube", title: clean(v.title, 160), url: v.link, snippet });
    }
    return hits;
  }
  // keyless fallback: YouTube's public search JSON (best-effort)
  const data = await fetchJson<{
    contents?: Array<{ videoRenderer?: { videoId?: string; title?: { runs?: Array<{ text?: string }> }; descriptionSnippet?: { runs?: Array<{ text?: string }> } } }>;
  }>(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`,
    { headers: { "accept-language": "en" } },
  );
  const out: ResearchHit[] = [];
  for (const item of (data.contents ?? []).slice(0, 4)) {
    const v = item.videoRenderer;
    if (!v?.videoId || !v.title?.runs?.[0]?.text) continue;
    let snippet = clean(v.descriptionSnippet?.runs?.[0]?.text ?? "");
    const transcript = await youtubeTranscript(v.videoId);
    if (transcript) snippet = `${snippet ? snippet + " · " : ""}[transcript] ${transcript}`;
    out.push({
      source: "youtube",
      title: clean(v.title.runs[0].text, 160),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      snippet,
    });
  }
  return out;
}

async function researchNewsApi(query: string, key: string): Promise<ResearchHit[]> {
  const params = new URLSearchParams({ q: query, pageSize: "5", language: "en", sortBy: "relevancy" });
  const data = await fetchJson<{
    articles?: Array<{ title?: string; url?: string; description?: string; source?: { name?: string } }>;
  }>(`https://newsapi.org/v2/everything?${params}`, {
    headers: { "x-api-key": key },
  });
  return (data.articles ?? [])
    .filter((a) => typeof a.title === "string")
    .map((a) => ({
      source: "newsapi",
      title: clean(a.title as string, 160),
      url: a.url,
      snippet: clean(`${a.source?.name ? a.source.name + " · " : ""}${a.description ?? ""}`),
    }));
}

async function serpSearch(
  params: Record<string, string>,
  key: string,
): Promise<Array<Record<string, unknown>>> {
  const sp = new URLSearchParams({ ...params, api_key: key });
  const data = await fetchJson<{
    news_results?: Array<Record<string, unknown>>;
    organic_results?: Array<Record<string, unknown>>;
    related_queries?: Array<{ query?: string; value?: number }>;
    error?: string;
  }>(`https://serpapi.com/search.json?${sp}`);
  if (data.error) throw new Error(data.error);
  return [...(data.news_results ?? []), ...(data.organic_results ?? [])];
}

/** Google Trends via SerpApi: related rising queries = demand signal. */
async function researchTrends(query: string, key: string): Promise<ResearchHit[]> {
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
  if (data.error) throw new Error(data.error);
  return (data.related_queries?.rising ?? [])
    .filter((r) => typeof r.query === "string")
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
  return (data.items ?? [])
    .filter((i) => i.volumeInfo?.title)
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
  handler: async (ctx, { query, location }): Promise<ResearchHit[]> => {
    const userId = await requireActionUser(ctx);
    await consumeAiQuotaForAction(ctx, userId);
    const q = query.trim();
    if (!q) throw new Error("Empty research query");
    const serpKey = process.env.SERPAPI_KEY;
    const newsKey = process.env.NEWSAPI_KEY;
    // Local news aims at geo + topic; SerpApi google news otherwise.
    const localQ = location ? `${q} ${location}` : q;

    const tasks: Array<Promise<ResearchHit[]>> = [
      researchReddit(q).catch(() => []),
      researchWikimedia("en.wikipedia.org", "wikipedia", q).catch(() => []),
      researchWikimedia("en.wikibooks.org", "wikibooks", q).catch(() => []),
      researchGdlt(q).catch(() => []),
      researchYoutube(q, serpKey).catch(() => []),
      researchGoogleBooks(q).catch(() => []),
      newsKey ? researchNewsApi(q, newsKey).catch(() => []) : Promise.resolve([]),
      serpKey
        ? researchTrends(q, serpKey).catch(() => [])
        : Promise.resolve([]),
      serpKey
        ? serpSearch(
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
            .catch(() => [])
        : Promise.resolve([]),
      serpKey
        ? serpSearch({ engine: "google_news", q }, serpKey)
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
            .catch(() => [])
        : Promise.resolve([]),
    ];

    const settled = await Promise.all(tasks);
    const seen = new Set<string>();
    const merged: ResearchHit[] = [];
    for (const hits of settled) {
      for (const h of hits) {
        const key = (h.url ?? h.title).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(h);
      }
    }
    return merged.slice(0, 60);
  },
});
