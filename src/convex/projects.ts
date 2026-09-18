import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./guards";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) return null;
    return project;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    businessName: v.optional(v.string()),
    description: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    competitorEntries: v.optional(
      v.array(
        v.object({
          type: v.union(v.literal("website"), v.literal("gmb")),
          value: v.string(),
        }),
      ),
    ),
    googleBusinessName: v.optional(v.string()),
    productsServices: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    kpis: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await ctx.db.insert("projects", {
      ...args,
      ownerId: userId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Called after the wizard's scan step finishes — stores scrape + SerpApi
 * findings on the project so every module can reuse the enriched context.
 */
export const saveScan = mutation({
  args: {
    id: v.id("projects"),
    status: v.union(
      v.literal("pending"),
      v.literal("scraped"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    sitemapUrls: v.optional(v.array(v.string())),
    titles: v.optional(v.array(v.string())),
    metaDescription: v.optional(v.string()),
    headings: v.optional(v.array(v.string())),
    productsServices: v.optional(v.array(v.string())),
    gmb: v.optional(
      v.object({
        title: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        website: v.optional(v.string()),
        rating: v.optional(v.number()),
        reviews: v.optional(v.number()),
        category: v.optional(v.string()),
        openHours: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { id, ...scan }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");

    // Auto-populate description from the best evidence we got.
    const description =
      scan.metaDescription ??
      project.description ??
      (scan.titles?.length ? scan.titles[0] : undefined);

    // Products/services from scan (or GMB category) enrich the project.
    const mergedProducts = [
      ...new Set([...(project.productsServices ?? []), ...(scan.productsServices ?? [])]),
    ];
    const industry =
      project.industry ?? scan.gmb?.category ?? undefined;

    await ctx.db.patch(id, {
      websiteScan: { ...scan, scannedAt: Date.now() },
      description,
      productsServices: mergedProducts.length ? mergedProducts : undefined,
      industry,
      // If GMB found a website and none was provided, backfill it.
      websiteUrl: project.websiteUrl ?? scan.gmb?.website ?? undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    businessName: v.optional(v.string()),
    description: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    kpis: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    // Cascade delete all child entities.
    for (const table of [
      "personas",
      "contentPieces",
      "connections",
      "contacts",
      "campaigns",
      "posts",
      "products",
      "builds",
      "insights",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_project", (q) => q.eq("projectId", id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(id);
  },
});
