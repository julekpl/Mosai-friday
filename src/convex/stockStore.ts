import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { projectAccessFor } from "./guards";

/* ── Database side of U5 stock pictures (internal only) ──────────────────
 *
 * `stock.ts` runs in the Node runtime (it needs `safeFetchBytes`), and Convex
 * only allows actions there, so the cache and file-row writes live here.
 * Nothing in this file is public.
 */

const stockHit = v.object({
  provider: v.literal("pexels"),
  externalId: v.string(),
  width: v.number(),
  height: v.number(),
  alt: v.optional(v.string()),
  thumbUrl: v.string(),
  photographer: v.string(),
  photographerUrl: v.string(),
  pageUrl: v.string(),
});

export const SWEEP_BATCH = 200;

/** A fresh cache row (expiresAt > now), or null. */
export const getCachedSearch = internalQuery({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, { key, now }) => {
    const row = await ctx.db
      .query("stockSearchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!row || row.expiresAt <= now) return null;
    return row.results;
  },
});

/** Upsert by key, so a repeated write never creates a second row. */
export const putCachedSearch = internalMutation({
  args: { key: v.string(), results: v.array(stockHit), fetchedAt: v.number(), expiresAt: v.number() },
  handler: async (ctx, { key, results, fetchedAt, expiresAt }) => {
    const rows = await ctx.db
      .query("stockSearchCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .collect();
    const [first, ...rest] = rows;
    for (const row of rest) await ctx.db.delete(row._id);
    if (first) await ctx.db.patch(first._id, { results, fetchedAt, expiresAt });
    else await ctx.db.insert("stockSearchCache", { key, results, fetchedAt, expiresAt });
  },
});

/** Daily cron: delete expired rows in bounded batches. */
export const sweepStockCache = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const expired = await ctx.db
      .query("stockSearchCache")
      .withIndex("by_expires", (q) => q.lte("expiresAt", Date.now()))
      .take(SWEEP_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.stockStore.sweepStockCache, {});
    }
    return { deleted: expired.length };
  },
});

/** An earlier import of the same Pexels photo into this project, if any
 *  (keeps a retried import from storing the blob twice). */
export const findStockFile = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users"), externalId: v.string() },
  handler: async (ctx, { projectId, userId, externalId }) => {
    if (!(await projectAccessFor(ctx, projectId, userId))) return null;
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const file = files.find(
      (row) => row.source === "stock" && row.attribution?.externalId === externalId,
    );
    return file ? { fileId: file._id, storageId: file.storageId } : null;
  },
});

export const insertImportedFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    source: v.union(v.literal("owner_site"), v.literal("stock")),
    attribution: v.optional(
      v.object({
        provider: v.literal("pexels"),
        externalId: v.string(),
        photographer: v.string(),
        photographerUrl: v.string(),
        pageUrl: v.string(),
      }),
    ),
  },
  handler: async (ctx, { projectId, userId, ...file }) => {
    // Re-check at write time: access may have been removed during download.
    // Returning (not throwing) lets the orphan blob deletion commit.
    if (!(await projectAccessFor(ctx, projectId, userId))) {
      await ctx.storage.delete(file.storageId);
      return null;
    }
    return await ctx.db.insert("projectFiles", {
      projectId,
      ...file,
      uploadedBy: userId,
      createdAt: Date.now(),
    });
  },
});
