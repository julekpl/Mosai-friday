"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

import { normalizeWebsiteUrl } from "../lib/url";
import { requireActionUser } from "./guards";
import { safeFetch } from "./lib/safeFetch";
import { reserveProviderCallForAction } from "./lib/providerUsage";
import {
  extractSitemapLocations,
  extractWebsitePage,
  isAllowedByRobots,
  normalizeCrawlUrl,
  parseRobotsTxt,
  prioritizeSiteUrls,
  type RobotsRules,
  mergeScanImages,
  type WebsiteBusinessDetails,
  type WebsiteImage,
  type WebsitePageFinding,
  type WebsitePageExtraction,
} from "./lib/websiteScan";
import {
  googleMapsFailure,
  isEmptyGoogleMapsAnswer,
  parseGoogleMapsPlace,
  parseGoogleMapsSuggestions,
  type GoogleMapsResponse,
  type GoogleMapsSuggestion,
} from "./lib/googleMaps";

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
  images: WebsiteImage[];
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
    return await runWebsiteScan(url, ignoreRobots);
  },
});

/**
 * Re-scan a project's saved website from project settings. The scan runs and
 * is stored entirely on the server (the browser never writes the findings),
 * and an earlier Google Business result is kept.
 */
export const rescanProjectWebsite = action({
  args: { projectId: v.id("projects"), ignoreRobots: v.optional(v.boolean()) },
  handler: async (ctx, { projectId, ignoreRobots = false }): Promise<RescanResult> => {
    const userId = await requireActionUser(ctx);
    return await rescanForUser(ctx, projectId, userId, ignoreRobots);
  },
});

/**
 * The same server re-scan for a job that already acts as a known user (U5b:
 * the starter kit fills `websiteScan.images` after a first-run scan). Same
 * access check, quota, robots.txt handling and safeFetch path as above.
 */
export const rescanProjectWebsiteForUser = internalAction({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }): Promise<RescanResult> =>
    await rescanForUser(ctx, projectId, userId, false),
});

type RescanResult = { status: "scraped" | "partial"; scannedPageCount: number };

async function rescanForUser(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
  ignoreRobots: boolean,
): Promise<RescanResult> {
  const project: Doc<"projects"> | null = await ctx.runQuery(internal.guards.projectAccessForAction, {
    projectId,
    userId,
  });
  if (!project) throw new Error("Not found");
  if (!project.websiteUrl) throw new Error("Add the website address first, then scan it.");
  await ctx.runMutation(internal.guards.consumeLookupQuota, { userId, kind: "website_scan" });

  const scan = await runWebsiteScan(project.websiteUrl, ignoreRobots);
  const status =
    scan.coverage.truncated || scan.coverage.failedPageCount > 0 || scan.coverage.sitemapFailureCount > 0
      ? "partial"
      : "scraped";
  await ctx.runMutation(internal.projects.storeServerScan, {
    projectId,
    userId,
    scan: {
      status,
      sitemapUrls: scan.sitemapUrls,
      titles: scan.titles,
      metaDescription: scan.metaDescription,
      headings: scan.headings,
      productsServices: scan.productsServices,
      pages: scan.pages,
      socialChannels: scan.socialChannels,
      images: scan.images,
      businessDetails: scan.businessDetails,
      coverage: scan.coverage,
    },
  });
  return { status, scannedPageCount: scan.coverage.scannedPageCount };
}

async function runWebsiteScan(url: string, ignoreRobots: boolean): Promise<ScanResult> {
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
      if (renderedPage.excerpt.length > homepage.excerpt.length) homepage = { ...homepage, ...renderedPage, url: homepageUrl, images: homepage.images };
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
  const images = mergeScanImages(pages.map((page) => page.images));
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
    images,
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
}

/* ── SerpApi — Google Business Profile (google_maps engine) ─────────────── */

type GmbLookup = NonNullable<ScanResult["gmb"]> & { source: string };

const SERPAPI_SEARCH = "https://serpapi.com/search.json";
const GOOGLE_MAPS_NOT_CONFIGURED =
  "Google Business search isn't set up on this workspace yet. You can skip this step.";
// LQ-1: shown, unchanged, when the platform monthly ceiling or the per-user
// daily cap is reached. The wizard matches this exact text to switch to its
// "resting" state; other errors keep their own message.
export const GOOGLE_MAPS_CEILING_MESSAGE =
  "Business search is resting for now, type your details instead.";

/** Platform ceiling + per-user daily cap, checked before every paid
 *  SerpApi `google_maps` call. Throws the same needs_setup-style message
 *  either way so the wizard degrades the same way for both. */
async function guardGoogleMapsCall(ctx: ActionCtx, userId: Id<"users">): Promise<void> {
  try {
    await ctx.runMutation(internal.guards.consumeSerpApiDailyQuota, { userId });
  } catch {
    throw new Error(GOOGLE_MAPS_CEILING_MESSAGE);
  }
  const reserved = await reserveProviderCallForAction(ctx, "serpapi");
  if (!reserved) throw new Error(GOOGLE_MAPS_CEILING_MESSAGE);
}

async function serpApiGoogleMaps(
  params: Record<string, string>,
): Promise<GoogleMapsResponse> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error(GOOGLE_MAPS_NOT_CONFIGURED);
  const query = new URLSearchParams({ engine: "google_maps", ...params, api_key: key });
  let res: Response;
  try {
    res = await fetch(`${SERPAPI_SEARCH}?${query}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("Google Business search didn't respond. Try again in a moment.");
  }
  if (!res.ok) {
    throw new Error("Google Business search is temporarily unavailable. Try again or skip this step.");
  }
  const data = (await res.json()) as GoogleMapsResponse;
  // Provider error text is never shown to the user (it can echo parameters).
  if (googleMapsFailure(data)) {
    throw new Error("Google Business search is temporarily unavailable. Try again or skip this step.");
  }
  return data;
}

/**
 * Search a small, bounded set of Google Maps listings while the user types.
 * Suggestions are only candidates; the user reviews the selected listing later.
 * An exact match comes back as `place_results` and an empty search as a
 * documented "no results" answer — both are handled, neither is an outage.
 */
export const suggestGoogleBusiness = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<GoogleMapsSuggestion[]> => {
    const userId = await requireActionUser(ctx);
    const normalizedQuery = query.trim().slice(0, 160);
    if (normalizedQuery.length < 3) return [];
    if (!process.env.SERPAPI_KEY) throw new Error(GOOGLE_MAPS_NOT_CONFIGURED);
    await ctx.runMutation(internal.guards.consumeLookupQuota, { userId, kind: "google_maps" });
    await guardGoogleMapsCall(ctx, userId);

    const data = await serpApiGoogleMaps({ type: "search", q: normalizedQuery });
    if (isEmptyGoogleMapsAnswer(data)) return [];
    return parseGoogleMapsSuggestions(data);
  },
});

/**
 * Confirm one Google Business listing. With a `placeId` (picked from the
 * suggestions) SerpApi resolves the exact place; `type`/`q` must not be sent
 * with it. Without one, the best text match is used.
 */
export const lookupGoogleBusiness = action({
  args: { name: v.string(), placeId: v.optional(v.string()) },
  handler: async (ctx, { name, placeId }): Promise<GmbLookup> => {
    const userId = await requireActionUser(ctx);
    const title = name.trim().slice(0, 160);
    const place = placeId?.trim().slice(0, 200);
    if (!title && !place) throw new Error("Enter the business name to look it up.");
    if (!process.env.SERPAPI_KEY) throw new Error(GOOGLE_MAPS_NOT_CONFIGURED);
    await ctx.runMutation(internal.guards.consumeLookupQuota, { userId, kind: "google_maps" });
    await guardGoogleMapsCall(ctx, userId);

    const data = await serpApiGoogleMaps(
      place ? { place_id: place } : { type: "search", q: title },
    );
    const hit = isEmptyGoogleMapsAnswer(data) ? null : parseGoogleMapsPlace(data, title);
    if (!hit) throw new Error(`No Google Business listing found for "${title || "this place"}".`);

    const { latitude, longitude, ...listing } = hit;
    return {
      ...listing,
      source: `serpapi:google_maps${
        latitude !== undefined && longitude !== undefined
          ? ` @${latitude.toFixed(3)},${longitude.toFixed(3)}`
          : ""
      }`,
    } satisfies GmbLookup;
  },
});
