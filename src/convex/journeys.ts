import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const DEFAULT_LANES = [
  "Actions",
  "Thoughts",
  "Feelings",
  "Pain points",
  "Opportunities",
];

const stageValidator = v.object({
  stage: v.string(),
  cells: v.array(v.string()),
  score: v.optional(v.number()),
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("journeyMaps")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("journeyMaps") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const map = await ctx.db.get(id);
    if (!map) return null;
    const project = await ctx.db.get(map.projectId);
    if (!project || project.ownerId !== userId) return null;
    return map;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    personaId: v.optional(v.id("personas")),
    name: v.string(),
    goal: v.optional(v.string()),
    lanes: v.optional(v.array(v.string())),
    stages: v.array(stageValidator),
    source: v.union(v.literal("manual"), v.literal("ai"), v.literal("csv")),
  },
  handler: async (ctx, { projectId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const now = Date.now();
    return await ctx.db.insert("journeyMaps", {
      projectId,
      ...rest,
      lanes: rest.lanes ?? DEFAULT_LANES,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("journeyMaps"),
    name: v.optional(v.string()),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    lanes: v.optional(v.array(v.string())),
    stages: v.optional(v.array(stageValidator)),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const map = await ctx.db.get(id);
    if (!map) throw new Error("Not found");
    const project = await ctx.db.get(map.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("journeyMaps") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const map = await ctx.db.get(id);
    if (!map) throw new Error("Not found");
    const project = await ctx.db.get(map.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
