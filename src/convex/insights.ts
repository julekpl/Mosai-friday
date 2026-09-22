import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

export const list = moduleQuery("grow", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("insights")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("grow", {
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
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
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

export const update = moduleMutation("grow", {
  args: {
    id: v.id("insights"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("new"), v.literal("seen"), v.literal("done")),
    ),
    freshness: v.optional(v.union(v.literal("fresh"), v.literal("stale"))),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = moduleMutation("grow", {
  args: { id: v.id("insights") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
