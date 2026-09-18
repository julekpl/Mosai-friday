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
      .query("campaigns")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    channel: v.string(), // email | social | ads
    budgetCents: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, ...rest } = args;
    return await ctx.db.insert("campaigns", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("campaigns"),
    name: v.optional(v.string()),
    channel: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("done"),
      ),
    ),
    budgetCents: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    contentId: v.optional(v.id("contentPieces")),
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
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
