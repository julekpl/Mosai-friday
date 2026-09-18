import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("contentPieces")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    topic: v.optional(v.string()),
    brief: v.optional(v.string()),
    body: v.optional(v.string()),
    surface: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, ...rest } = args;
    const now = Date.now();
    return await ctx.db.insert("contentPieces", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("contentPieces"),
    title: v.optional(v.string()),
    topic: v.optional(v.string()),
    brief: v.optional(v.string()),
    body: v.optional(v.string()),
    surface: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("approved"),
        v.literal("published"),
      ),
    ),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const piece = await ctx.db.get(id);
    if (!piece) throw new Error("Not found");
    const project = await ctx.db.get(piece.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("contentPieces") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const piece = await ctx.db.get(id);
    if (!piece) throw new Error("Not found");
    const project = await ctx.db.get(piece.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
