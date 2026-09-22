import { moduleMutation, moduleQuery } from "./guards";
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

export const list = moduleQuery("journeys", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("journeyMaps")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = moduleQuery("journeys", {
  args: { id: v.id("journeyMaps") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export const create = moduleMutation("journeys", {
  args: {
    projectId: v.id("projects"),
    personaId: v.optional(v.id("personas")),
    name: v.string(),
    goal: v.optional(v.string()),
    lanes: v.optional(v.array(v.string())),
    stages: v.array(stageValidator),
    source: v.union(v.literal("manual"), v.literal("ai"), v.literal("csv")),
  },
  handler: async (ctx, { projectId, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
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

export const update = moduleMutation("journeys", {
  args: {
    id: v.id("journeyMaps"),
    name: v.optional(v.string()),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    lanes: v.optional(v.array(v.string())),
    stages: v.optional(v.array(stageValidator)),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = moduleMutation("journeys", {
  args: { id: v.id("journeyMaps") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
