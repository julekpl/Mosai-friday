"use node";

import * as cheerio from "cheerio";
import { v } from "convex/values";
import { action } from "./_generated/server";

import { normalizeWebsiteUrl } from "../lib/url";
import { requireActionUser } from "./guards";
import { safeFetch } from "./lib/safeFetch";

/* ── Open-source scraping (cheerio, server-side) ─────────────────────────
 *
 * Fetches the homepage + sitemap of the given website and extracts:
 *   - page <title>, meta description, h1–h3 headings
 *   - sitemap URLs (from /sitemap.xml, with best-effort /robots.txt Sitemap:)
 *   - product / service names (heuristic: nav/heading/link text + JSON-LD)
 *
 * If static HTML looks JS-rendered (too little content), retries once
 * through the public r.jina.ai HTML-to-text proxy as a lightweight
 * JS-rendering fallback. robots.txt is fetched for the sitemap hint but
 * is otherwise ignored (`ignoreRobots` flag), per product requirement.
 */

const UA =
  "Mozilla/5.0 (compatible; MosaiBot/1.0; +https://mosai.app/bot)";

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  // SSRF-guarded: HTTPS only, public hosts only, redirects re-validated,
  // bounded size and time. See lib/safeFetch.ts.
  const res = await safeFetch(url, {
    timeoutMs,
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text;
}

function extractFromHtml(html: string) {
  const $ = cheerio.load(html);
  const title = $("head title").first().text().trim() || undefined;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || undefined;

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 120 && !headings.includes(t)) headings.push(t);
  });
  headings.splice(30);

  // JSON-LD structured data — most reliable source for products/services
  const jsonLdNames: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const obj = node as Record<string, unknown>;
          const type = obj["@type"];
          if (
            typeof type === "string" &&
            /Product|Service|Offer|ProductCollection/i.test(type) &&
            typeof obj.name === "string"
          ) {
            jsonLdNames.push(obj.name.trim());
          }
          Object.values(obj).forEach(walk);
        }
      };
      walk(parsed);
    } catch {
      /* malformed JSON-LD — skip */
    }
  });

  // Heuristic sweep: nav links and headings that smell like products/services
  const heuristic: string[] = [];
  const smell =
    /\b(shop|store|product|products|service|services|plans|pricing|solutions|packages|menu|offers|subscriptions?|courses?|consulting|app)\b/i;
  $("nav a, header a, footer a, a[href]").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length >= 3 && t.length < 60 && smell.test(t) && !heuristic.includes(t))
      heuristic.push(t);
  });
  heuristic.splice(15);

  return { title, metaDescription, headings, jsonLdNames, heuristic, $ };
}

async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];
  // Prefer robots.txt Sitemap: hint
  try {
    const robots = await fetchText(`${origin}/robots.txt`, 6_000);
    for (const line of robots.split("\n")) {
      const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
      if (m) urls.push(m[1]);
    }
  } catch {
    /* no robots.txt — fine */
  }
  if (urls.length === 0) urls.push(`${origin}/sitemap.xml`);

  const out: string[] = [];
  for (const sm of urls.slice(0, 3)) {
    try {
      const xml = await fetchText(sm, 8_000);
      const $ = cheerio.load(xml, { xmlMode: true });
      $("loc").each((_, el) => {
        const u = $(el).text().trim();
        if (u.startsWith("http")) out.push(u);
      });
      out.splice(50); // cap per sitemap
    } catch {
      /* unreachable sitemap — fine */
    }
  }
  return [...new Set(out)].slice(0, 80);
}

function scanSite(
  scan: {
    url: string;
    sitemapUrls: string[];
    titles: string[];
    headings: string[];
    metaDescription?: string;
    productsServices: string[];
  },
  opts: { gmb?: ScanResult["gmb"] } = {},
): ScanResult {
  return {
    url: scan.url,
    scannedAt: Date.now(),
    sitemapUrls: scan.sitemapUrls,
    titles: scan.titles,
    headings: scan.headings,
    metaDescription: scan.metaDescription,
    productsServices: scan.productsServices,
    gmb: opts.gmb,
  };
}

type ScanResult = {
  url: string;
  scannedAt: number;
  sitemapUrls: string[];
  titles: string[];
  headings: string[];
  metaDescription?: string;
  productsServices: string[];
  gmb?: {
    title?: string;
    address?: string;
    phone?: string;
    website?: string;
    rating?: number;
    reviews?: number;
    category?: string;
    openHours?: string;
  };
};

export type { ScanResult };

/* ── Actions ─────────────────────────────────────────────────────────── */

/**
 * Scrape a website (open-source cheerio pipeline, running on the Convex
 * server). Accepts any URL variation; returns structured findings.
 */
export const scanWebsite = action({
  args: {
    url: v.string(), // raw user input — any variation
    ignoreRobots: v.optional(v.boolean()),
  },
  handler: async (ctx, { url }): Promise<ScanResult> => {
    await requireActionUser(ctx);
    const normalized = normalizeWebsiteUrl(url);
    if (!normalized) throw new Error("Could not interpret that website URL");

    const origin = new URL(normalized).origin;
    const sitemapUrls = await fetchSitemapUrls(origin);

    let html = "";
    try {
      html = await fetchText(normalized);
    } catch (e) {
      throw new Error(
        `Could not fetch ${normalized} (${e instanceof Error ? e.message : "network error"})`,
      );
    }

    let ex = extractFromHtml(html);

    // JS-render fallback: page looks empty (SPA) → try the jina reader proxy,
    // which executes JS headlessly and returns rendered text.
    if (ex.headings.length < 3 && html.length < 30_000) {
      try {
        const rendered = await fetchText(
          `https://r.jina.ai/${normalized}`,
          15_000,
        );
        // The reader returns markdown; wrap it so cheerio can still pull text.
        ex = extractFromHtml(`<html><body>${rendered}</body></html>`);
        if (!ex.title) {
          const m = rendered.match(/^Title:\s*(.+)$/m);
          if (m) ex.title = m[1].trim();
        }
      } catch {
        /* keep static-only result */
      }
    }

    const productsServices = [...new Set([...ex.jsonLdNames, ...ex.heuristic])];

    return scanSite({
      url: normalized,
      sitemapUrls,
      titles: ex.title ? [ex.title] : [],
      headings: ex.headings,
      metaDescription: ex.metaDescription,
      productsServices,
    });
  },
});

/* ── SerpApi — Google My Business (google_maps engine) ──────────────────── */

type GmbLookup = NonNullable<ScanResult["gmb"]> & { source: string };

/**
 * Look up a Google My Business listing via SerpApi's google_maps engine.
 * Requires SERPAPI_KEY env var (set through the Keys / API keys UI).
 */
export const lookupGoogleBusiness = action({
  args: { name: v.string(), placeId: v.optional(v.string()) },
  handler: async (ctx, { name, placeId }): Promise<GmbLookup> => {
    await requireActionUser(ctx);
    const key = process.env.SERPAPI_KEY;
    if (!key)
      throw new Error(
        "SERPAPI_KEY is not configured — add it in the Keys / API keys panel.",
      );

    const params = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q: name,
      api_key: key,
    });
    if (placeId) params.set("place_id", placeId);

    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) throw new Error(`SerpApi error HTTP ${res.status}`);
    const data = (await res.json()) as {
      local_results?: Array<Record<string, unknown>>;
      place_results?: Record<string, unknown>;
      error?: string;
    };
    if (data.error) throw new Error(`SerpApi: ${data.error}`);

    const hit =
      data.place_results ?? (data.local_results?.[0] as Record<string, unknown> | undefined);
    if (!hit) throw new Error(`No Google Maps listing found for "${name}"`);

    const gps = (hit.gps_coordinates ?? {}) as Record<string, number>;
    const address = (hit.address ?? "") as string;

    return {
      title: (hit.title as string) ?? name,
      address: address || undefined,
      phone: ((hit.phone ?? "") as string) || undefined,
      website: ((hit.website ?? "") as string) || undefined,
      rating: typeof hit.rating === "number" ? hit.rating : undefined,
      reviews:
        typeof hit.reviews === "number"
          ? hit.reviews
          : typeof (hit.reviews as { original?: number })?.original === "number"
            ? (hit.reviews as { original: number }).original
            : undefined,
      category: Array.isArray(hit.type)
        ? (hit.type as string[])[0]
        : ((hit.type as string) ?? undefined),
      openHours: hit.operating_hours
        ? Object.entries(hit.operating_hours as Record<string, string>)
            .map(([d, h]) => `${d}: ${h}`)
            .join(" · ")
        : undefined,
      source: `serpapi:google_maps${gps.lat ? ` @${gps.lat.toFixed(3)},${gps.lng.toFixed(3)}` : ""}`,
    } satisfies GmbLookup;
  },
});
