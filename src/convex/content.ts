import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

export const list = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("contentPieces")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    topic: v.optional(v.string()),
    brief: v.optional(v.string()),
    body: v.optional(v.string()),
    surface: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    topicId: v.optional(v.id("contentTopics")),
    gapId: v.optional(v.id("contentGaps")),
    journeyMapId: v.optional(v.id("journeyMaps")),
    journeyStage: v.optional(v.string()),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args, access) => {
    const { userId } = await access.requireProject(args.projectId);
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

export const update = moduleMutation("create", {
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
    topicId: v.optional(v.id("contentTopics")),
    gapId: v.optional(v.id("contentGaps")),
    journeyMapId: v.optional(v.id("journeyMaps")),
    journeyStage: v.optional(v.string()),
    contentType: v.optional(v.string()),
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

export const remove = moduleMutation("create", {
  args: { id: v.id("contentPieces") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
