"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { LOOKUP_QUOTA_WINDOW_MS } from "./guards";
import { IMAGE_CONTENT_TYPES, safeFetchBytes } from "./lib/safeFetch";
import {
  PEXELS_IMAGE_HOST,
  buildPhotoRequest,
  buildSearchRequest,
  isPexelsId,
  normalizeStockQuery,
  parsePhoto,
  parseSearchResults,
  rateLimitFrom,
  stockCacheKey,
  type StockHit,
} from "./lib/pexels";

/* ── U5: posts with pictures (internal only) ─────────────────────────────
 *
 * Pexels search (fixed host, server key, 24 h shared cache, per-user limit)
 * and imports into project files. Imports never trust a client URL: stock
 * pictures are re-fetched by id; owner photos must be on the project's own
 * scanned image list, re-read from the database. Every download goes through
 * `safeFetchBytes`. The key is read here and sent only as the Authorization
 * header to api.pexels.com; it is never logged or returned.
 */

const CACHE_TTL_MS = 24 * 60 * 60_000;
const PROVIDER_TIMEOUT_MS = 10_000;

const orientation = v.union(v.literal("landscape"), v.literal("portrait"), v.literal("square"));

type NotOk =
  | { status: "needs_setup" }
  | { status: "rate_limited"; resetAt: number }
  | { status: "unavailable" };

export type StockSearchResult = { status: "ok"; results: StockHit[]; cached: boolean } | NotOk;
export type StockImportResult = { status: "ok"; fileId: Id<"projectFiles">; url: string | null } | NotOk;

function pexelsKey(): string | null {
  const key = process.env.PEXELS_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

async function providerGet(url: string, headers: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), redirect: "error" });
  } catch {
    return null;
  }
}

async function requireProject(ctx: ActionCtx, projectId: Id<"projects">, userId: Id<"users">): Promise<Doc<"projects">> {
  const project: Doc<"projects"> | null = await ctx.runQuery(internal.guards.projectAccessForAction, {
    projectId,
    userId,
  });
  if (!project) throw new Error("Not found");
  return project;
}

function fileNameFrom(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const clean = decodeURIComponent(last).replace(/[^\w.\- ]+/g, "").slice(0, 120);
    return clean || fallback;
  } catch {
    return fallback;
  }
}

async function storeImage(
  ctx: ActionCtx,
  args: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    downloadUrl: string;
    allowedHosts?: readonly string[];
    name: string;
    source: "owner_site" | "stock";
    attribution?: Doc<"projectFiles">["attribution"];
  },
): Promise<StockImportResult> {
  let download;
  try {
    download = await safeFetchBytes(args.downloadUrl, {
      allowedContentTypes: IMAGE_CONTENT_TYPES,
      allowedHosts: args.allowedHosts,
      timeoutMs: 15_000,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (!download.ok || download.bytes.byteLength === 0) return { status: "unavailable" };

  const storageId = await ctx.storage.store(new Blob([download.bytes], { type: download.contentType }));
  const fileId: Id<"projectFiles"> | null = await ctx.runMutation(internal.stockStore.insertImportedFile, {
    projectId: args.projectId,
    userId: args.userId,
    storageId,
    name: args.name,
    mimeType: download.contentType,
    sizeBytes: download.bytes.byteLength,
    source: args.source,
    ...(args.attribution ? { attribution: args.attribution } : {}),
  });
  if (!fileId) throw new Error("Not found");
  return { status: "ok", fileId, url: await ctx.storage.getUrl(storageId) };
}

export const searchPhotos = internalAction({
  args: { userId: v.id("users"), query: v.string(), orientation },
  handler: async (ctx, { userId, query, orientation: shape }): Promise<StockSearchResult> => {
    const normalized = normalizeStockQuery(query);
    if (!normalized) return { status: "ok", results: [], cached: false };
    const key = stockCacheKey(shape, normalized);
    const now = Date.now();

    // A fresh cached answer costs no provider call and no quota.
    const cached: StockHit[] | null = await ctx.runQuery(internal.stockStore.getCachedSearch, { key, now });
    if (cached) return { status: "ok", results: cached, cached: true };

    const apiKey = pexelsKey();
    if (!apiKey) return { status: "needs_setup" };

    try {
      await ctx.runMutation(internal.guards.consumeLookupQuota, { userId, kind: "stock_search" });
    } catch {
      const windowStart = Math.floor(Date.now() / LOOKUP_QUOTA_WINDOW_MS) * LOOKUP_QUOTA_WINDOW_MS;
      return { status: "rate_limited", resetAt: windowStart + LOOKUP_QUOTA_WINDOW_MS };
    }

    const request = buildSearchRequest(apiKey, normalized, shape);
    const res = await providerGet(request.url, request.headers);
    if (!res) return { status: "unavailable" };
    const limited = rateLimitFrom(res.status, res.headers, Date.now());
    if (limited && (res.status === 429 || !res.ok)) return limited;
    if (!res.ok) return { status: "unavailable" };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "unavailable" };
    }
    const results = parseSearchResults(body);
    const fetchedAt = Date.now();
    await ctx.runMutation(internal.stockStore.putCachedSearch, {
      key,
      results,
      fetchedAt,
      expiresAt: fetchedAt + CACHE_TTL_MS,
    });
    return { status: "ok", results, cached: false };
  },
});

export const importStockPhoto = internalAction({
  args: { projectId: v.id("projects"), userId: v.id("users"), externalId: v.string() },
  handler: async (ctx, { projectId, userId, externalId }): Promise<StockImportResult> => {
    await requireProject(ctx, projectId, userId);
    if (!isPexelsId(externalId)) throw new Error("Invalid stock photo id");
    const apiKey = pexelsKey();
    if (!apiKey) return { status: "needs_setup" };

    // Idempotent: a retried import of the same photo returns the first file.
    const existing: { fileId: Id<"projectFiles">; storageId: Id<"_storage"> } | null = await ctx.runQuery(
      internal.stockStore.findStockFile,
      { projectId, userId, externalId },
    );
    if (existing) {
      return { status: "ok", fileId: existing.fileId, url: await ctx.storage.getUrl(existing.storageId) };
    }

    // Re-fetch BY ID: the download address comes from Pexels, not the client.
    const request = buildPhotoRequest(apiKey, externalId);
    const res = await providerGet(request.url, request.headers);
    if (!res) return { status: "unavailable" };
    const limited = rateLimitFrom(res.status, res.headers, Date.now());
    if (limited && (res.status === 429 || !res.ok)) return limited;
    if (!res.ok) return { status: "unavailable" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "unavailable" };
    }
    const photo = parsePhoto(body);
    if (!photo || photo.externalId !== externalId) return { status: "unavailable" };

    return await storeImage(ctx, {
      projectId,
      userId,
      downloadUrl: photo.downloadUrl,
      allowedHosts: [PEXELS_IMAGE_HOST],
      name: `pexels-${photo.externalId}`,
      source: "stock",
      attribution: {
        provider: "pexels",
        externalId: photo.externalId,
        photographer: photo.photographer,
        photographerUrl: photo.photographerUrl,
        pageUrl: photo.pageUrl,
      },
    });
  },
});

export const importOwnerPhoto = internalAction({
  args: { projectId: v.id("projects"), userId: v.id("users"), url: v.string() },
  handler: async (ctx, { projectId, userId, url }): Promise<StockImportResult> => {
    const project = await requireProject(ctx, projectId, userId);
    // Only an address the server scan found on the owner's own pages.
    const listed = (project.websiteScan?.images ?? []).some((image) => image.url === url);
    if (!listed) throw new Error("That picture is not on your scanned website.");
    return await storeImage(ctx, {
      projectId,
      userId,
      downloadUrl: url,
      name: fileNameFrom(url, "website-photo"),
      source: "owner_site",
    });
  },
});
