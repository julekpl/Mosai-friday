import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ownedRow, requireUser } from "./guards";

export const list = query({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const build = await ctx.db.get(buildId);
    if (!build) return [];
    const project = await ctx.db.get(build.projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("buildPages")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("buildPages") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const page = await ctx.db.get(id);
    if (!page) return null;
    const project = await ctx.db.get(page.projectId);
    if (!project || project.ownerId !== userId) return null;
    return page;
  },
});

export const create = mutation({
  args: {
    buildId: v.id("builds"),
    name: v.string(),
    path: v.string(),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    journeyStage: v.optional(v.string()),
  },
  handler: async (ctx, { buildId, ...rest }) => {
    const userId = await requireUser(ctx);
    const build = await ctx.db.get(buildId);
    if (!build) throw new Error("Not found");
    const project = await ctx.db.get(build.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const now = Date.now();
    return await ctx.db.insert("buildPages", {
      buildId,
      projectId: build.projectId,
      ...rest,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("buildPages"),
    name: v.optional(v.string()),
    path: v.optional(v.string()),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    journeyStage: v.optional(v.string()),
    draft: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("drafted"), v.literal("approved")),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("buildPages") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
