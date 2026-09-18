import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ownedRow, requireUser } from "./guards";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("insights")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("seo"),
      v.literal("geo"),
      v.literal("content_gap"),
      v.literal("channel"),
      v.literal("recommendation"),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    source: v.string(),
    dataAsOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, dataAsOf, ...rest } = args;
    return await ctx.db.insert("insights", {
      projectId,
      ...rest,
      dataAsOf,
      freshness: "fresh",
      status: "new",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("insights"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("new"), v.literal("seen"), v.literal("done")),
    ),
    freshness: v.optional(v.union(v.literal("fresh"), v.literal("stale"))),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("insights") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
