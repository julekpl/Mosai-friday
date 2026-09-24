"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

import { normalizeWebsiteUrl } from "../lib/url";
import { requireActionUser } from "./guards";
import { safeFetch } from "./lib/safeFetch";
import {
  extractSitemapLocations,
  extractWebsitePage,
  isAllowedByRobots,
  normalizeCrawlUrl,
  parseRobotsTxt,
  prioritizeSiteUrls,
  type RobotsRules,
  type WebsiteBusinessDetails,
  type WebsitePageFinding,
  type WebsitePageExtraction,
} from "./lib/websiteScan";

/* ── Open-source scraping (cheerio, server-side) ─────────────────────────
 *
 * Follows robots.txt sitemap hints and sitemap indexes, then fetches the
 * homepage and up to twenty high-value same-site pages. The bounded page
 * findings include structured/visible business details and social links.
 *
 * If static HTML looks JS-rendered (too little content), retries once
 * through the public r.jina.ai HTML-to-text proxy as a lightweight
 * JS-rendering fallback. Robots rules are respected unless the caller
 * explicitly opts out for a site they control.
 */

const UA =
  "Mozilla/5.0 (compatible; MosaiBot/1.0; +https://mosai.app/bot)";

async function fetchText(
  url: string,
  timeoutMs = 8_000,
  maxBytes = 750_000,
): Promise<{ text: string; url: string }> {
  // SSRF-guarded: HTTPS only, public hosts only, redirects re-validated,
  // bounded size and time. See lib/safeFetch.ts.
  const res = await safeFetch(url, {
    timeoutMs,
    maxBytes,
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: res.text, url: res.url };
}

const MAX_SITEMAP_DOCUMENTS = 10;
const MAX_SITEMAP_URLS = 1_000;
const MAX_DISCOVERED_URLS = 1_200;
const MAX_CRAWLED_PAGES = 20;
const CRAWL_CONCURRENCY = 4;

async function loadRobots(origin: string): Promise<RobotsRules> {
  try {
    const robots = await fetchText(`${origin}/robots.txt`, 4_000, 200_000);
    return parseRobotsTxt(robots.text);
  } catch {
    return { sitemapUrls: [], allow: [], disallow: [] };
  }
}

function isAllowed(url: string, rules: RobotsRules, ignoreRobots: boolean): boolean {
  return ignoreRobots || isAllowedByRobots(new URL(url).pathname + new URL(url).search, rules);
}

async function discoverSitemapPages(
  origin: string,
  rules: RobotsRules,
): Promise<{ urls: string[]; documentCount: number; failureCount: number; truncated: boolean }> {
  const queue = [...new Set([...rules.sitemapUrls, `${origin}/sitemap.xml`])]
    .map((url) => normalizeCrawlUrl(url, origin))
    .filter((url): url is string => Boolean(url));
  const visited = new Set<string>();
  const pages: string[] = [];
  let documentCount = 0;
  let failureCount = 0;
  let truncated = false;

  while (queue.length && documentCount < MAX_SITEMAP_DOCUMENTS && pages.length < MAX_SITEMAP_URLS) {
    const batch = queue.splice(0, Math.min(CRAWL_CONCURRENCY, MAX_SITEMAP_DOCUMENTS - documentCount));
    const results = await Promise.all(batch.map(async (url) => {
      visited.add(url);
      try {
        const response = await fetchText(url, 6_000, 500_000);
        return { url, xml: response.text };
      } catch {
        failureCount += 1;
        return { url, xml: "" };
      }
    }));
    documentCount += results.length;
    for (const result of results) {
      if (!result.xml) continue;
      const locations = extractSitemapLocations(result.xml);
      if (/<sitemapindex\b/i.test(result.xml)) {
        for (const child of locations) {
          const safe = normalizeCrawlUrl(child, origin);
          if (safe && !visited.has(safe) && !queue.includes(safe)) queue.push(safe);
        }
      } else {
        for (const location of locations) {
          const safe = normalizeCrawlUrl(location, origin);
          if (safe && !pages.includes(safe)) pages.push(safe);
          if (pages.length >= MAX_SITEMAP_URLS) {
            truncated = true;
            break;
          }
        }
      }
    }
  }
  if (queue.length) truncated = true;
  return { urls: pages, documentCount, failureCount, truncated };
}

type ScanCoverage = {
  sitemapCount: number;
  sitemapFailureCount: number;
  discoveredPageCount: number;
  scannedPageCount: number;
  failedPageCount: number;
  skippedByRobotsCount: number;
  pageLimit: number;
  truncated: boolean;
};

type ScanResult = {
  url: string;
  scannedAt: number;
  sitemapUrls: string[];
  pages: WebsitePageFinding[];
  titles: string[];
  headings: string[];
  metaDescription?: string;
  productsServices: string[];
  socialChannels: string[];
  businessDetails: WebsiteBusinessDetails;
  coverage: ScanCoverage;
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
  handler: async (ctx, { url, ignoreRobots = false }): Promise<ScanResult> => {
    await requireActionUser(ctx);
    const normalized = normalizeWebsiteUrl(url);
    if (!normalized) throw new Error("Could not interpret that website URL");

    const origin = new URL(normalized).origin;
    const robots = await loadRobots(origin);
    if (!isAllowed(normalized, robots, ignoreRobots)) {
      throw new Error("This page is disallowed by robots.txt. Continue only if you control the site and choose the robots override.");
    }
    const sitemap = await discoverSitemapPages(origin, robots);

    let homepageResponse: { text: string; url: string };
    try {
      homepageResponse = await fetchText(normalized, 8_000, 750_000);
    } catch (e) {
      throw new Error(
        `Could not fetch ${normalized} (${e instanceof Error ? e.message : "network error"})`,
      );
    }
    const homepageUrl = normalizeCrawlUrl(homepageResponse.url, origin);
    if (!homepageUrl) throw new Error("The website redirected outside the supplied site, so MOSAI stopped the crawl.");
    let homepage = extractWebsitePage(homepageResponse.text, homepageUrl);

    // JS-render fallback: page looks empty (SPA) → try the jina reader proxy,
    // which executes JS headlessly and returns rendered text.
    if (homepage.headings.length < 3 && homepage.excerpt.length < 500 && homepageResponse.text.length < 30_000) {
      try {
        const rendered = await fetchText(`https://r.jina.ai/${normalized}`, 12_000, 500_000);
        const renderedPage = extractWebsitePage(`<html><body>${rendered.text}</body></html>`, homepageUrl);
        if (!renderedPage.title) {
          const match = rendered.text.match(/^Title:\s*(.+)$/m);
          if (match) renderedPage.title = match[1].trim();
        }
        if (renderedPage.excerpt.length > homepage.excerpt.length) homepage = { ...homepage, ...renderedPage, url: homepageUrl };
      } catch {
        // Keep the original HTML result and its honest evidence.
      }
    }

    const candidates = new Set<string>();
    let skippedByRobotsCount = 0;
    const addCandidate = (candidate: string) => {
      const safe = normalizeCrawlUrl(candidate, origin);
      if (!safe || safe === homepageUrl || candidates.has(safe)) return;
      if (!isAllowed(safe, robots, ignoreRobots)) {
        skippedByRobotsCount += 1;
        return;
      }
      if (candidates.size < MAX_DISCOVERED_URLS) candidates.add(safe);
    };
    sitemap.urls.forEach(addCandidate);
    homepage.internalLinks.forEach((link) => addCandidate(link.url));

    const pages: Array<Omit<WebsitePageExtraction, "internalLinks">> = [homepage];
    const visited = new Set([homepageUrl]);
    let failedPageCount = 0;
    while (pages.length < MAX_CRAWLED_PAGES) {
      const next = prioritizeSiteUrls(
        [...candidates].filter((candidate) => !visited.has(candidate)),
        Math.min(CRAWL_CONCURRENCY, MAX_CRAWLED_PAGES - pages.length),
      );
      if (!next.length) break;
      next.forEach((pageUrl) => visited.add(pageUrl));
      const outcomes = await Promise.all(next.map(async (pageUrl) => {
        try {
          const response = await fetchText(pageUrl, 6_000, 500_000);
          const finalUrl = normalizeCrawlUrl(response.url, origin);
          if (!finalUrl) throw new Error("Page redirected outside the supplied site");
          return { pageUrl, page: extractWebsitePage(response.text, finalUrl) };
        } catch {
          return { pageUrl, page: null };
        }
      }));
      for (const outcome of outcomes) {
        if (!outcome.page) {
          failedPageCount += 1;
          continue;
        }
        const { internalLinks, ...finding } = outcome.page;
        pages.push(finding);
        internalLinks.forEach((link) => addCandidate(link.url));
      }
    }

    const businessDetails: WebsiteBusinessDetails = {};
    for (const page of pages) {
      for (const [key, value] of Object.entries(page.businessDetails)) {
        if (businessDetails[key as keyof WebsiteBusinessDetails] === undefined && value) {
          Object.assign(businessDetails, { [key]: value });
        }
      }
    }
    const productsServices = [...new Set(pages.flatMap((page) => page.productsServices))].slice(0, 80);
    const socialChannels = [...new Set(pages.flatMap((page) => page.socialChannels))].slice(0, 50);
    const pendingDiscovered = [...candidates].filter((candidate) => !visited.has(candidate)).length;
    const truncated = sitemap.truncated || candidates.size >= MAX_DISCOVERED_URLS || pendingDiscovered > 0;

    return {
      url: normalized,
      scannedAt: Date.now(),
      sitemapUrls: sitemap.urls.slice(0, MAX_SITEMAP_URLS),
      pages: pages.map(({ url: pageUrl, title, description, headings, productsServices: names, excerpt }) => ({
        url: pageUrl,
        title,
        description,
        headings,
        productsServices: names,
        excerpt,
      })),
      titles: pages.map((page) => page.title).filter((title): title is string => Boolean(title)).slice(0, 40),
      headings: [...new Set(pages.flatMap((page) => page.headings))].slice(0, 160),
      metaDescription: homepage.description,
      productsServices,
      socialChannels,
      businessDetails,
      coverage: {
        sitemapCount: sitemap.documentCount,
        sitemapFailureCount: sitemap.failureCount,
        discoveredPageCount: candidates.size + 1,
        scannedPageCount: pages.length,
        failedPageCount,
        skippedByRobotsCount,
        pageLimit: MAX_CRAWLED_PAGES,
        truncated,
      },
    };
  },
});

/* ── SerpApi — Google My Business (google_maps engine) ──────────────────── */

type GmbLookup = NonNullable<ScanResult["gmb"]> & { source: string };
type GmbSuggestion = {
  placeId: string;
  title: string;
  address?: string;
  category?: string;
  rating?: number;
  reviews?: number;
};

/**
 * Search a small, bounded set of Google Maps listings while the user types.
 * Suggestions are only candidates; the user reviews the selected listing later.
 */
export const suggestGoogleBusiness = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<GmbSuggestion[]> => {
    await requireActionUser(ctx);
    const normalizedQuery = query.trim().slice(0, 160);
    if (normalizedQuery.length < 3) return [];

    const key = process.env.SERPAPI_KEY;
    if (!key) {
      throw new Error(
        "SERPAPI_KEY is not configured — add it in the Keys / API keys panel.",
      );
    }

    const params = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q: normalizedQuery,
      api_key: key,
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Google Maps search failed (HTTP ${res.status}).`);
    const data = (await res.json()) as {
      local_results?: Array<Record<string, unknown>>;
      error?: string;
    };
    if (data.error) throw new Error("Google Maps suggestions are temporarily unavailable.");

    const seen = new Set<string>();
    return (data.local_results ?? [])
      .filter((hit) => typeof hit.place_id === "string" && Boolean(hit.place_id.trim()) && typeof hit.title === "string")
      .filter((hit) => {
        const placeId = hit.place_id as string;
        if (seen.has(placeId)) return false;
        seen.add(placeId);
        return true;
      })
      .slice(0, 5)
      .map((hit) => ({
        placeId: (hit.place_id as string).slice(0, 200),
        title: (hit.title as string).slice(0, 200),
        address: typeof hit.address === "string" ? hit.address.slice(0, 300) : undefined,
        category: Array.isArray(hit.type)
          ? typeof hit.type[0] === "string" ? hit.type[0].slice(0, 100) : undefined
          : typeof hit.type === "string" ? hit.type.slice(0, 100) : undefined,
        rating: typeof hit.rating === "number" ? hit.rating : undefined,
        reviews: typeof hit.reviews === "number" ? hit.reviews : undefined,
      }));
  },
});

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
