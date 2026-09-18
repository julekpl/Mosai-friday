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
