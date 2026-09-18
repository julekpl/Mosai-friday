import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ownedRow, requireUser } from "./guards";

const blueprintStep = v.object({
  step: v.string(),
  title: v.string(),
  detail: v.string(),
  status: v.optional(
    v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
  ),
});

const blueprintValidator = v.object({
  summary: v.optional(v.string()),
  steps: v.optional(v.array(blueprintStep)),
  generatedAt: v.number(),
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("builds")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("builds") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const build = await ctx.db.get(id);
    if (!build) return null;
    const project = await ctx.db.get(build.projectId);
    if (!project || project.ownerId !== userId) return null;
    return build;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    kind: v.union(v.literal("website"), v.literal("app")),
    pages: v.optional(v.array(v.string())),
    idea: v.optional(v.string()),
    positioning: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    personaIds: v.optional(v.array(v.id("personas"))),
    journeyMapIds: v.optional(v.array(v.id("journeyMaps"))),
    differentiators: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, ...rest } = args;
    const now = Date.now();
    return await ctx.db.insert("builds", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("builds"),
    name: v.optional(v.string()),
    pages: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("generated"),
        v.literal("published"),
      ),
    ),
    idea: v.optional(v.string()),
    positioning: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    personaIds: v.optional(v.array(v.id("personas"))),
    journeyMapIds: v.optional(v.array(v.id("journeyMaps"))),
    differentiators: v.optional(v.array(v.string())),
    blueprint: v.optional(blueprintValidator),
    seoReady: v.optional(v.boolean()),
    wcagReady: v.optional(v.boolean()),
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

export const setStepStatus = mutation({
  args: {
    id: v.id("builds"),
    stepIndex: v.number(),
    status: v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
  },
  handler: async (ctx, { id, stepIndex, status }) => {
    const userId = await requireUser(ctx);
    const build = await ctx.db.get(id);
    if (!build) throw new Error("Not found");
    const project = await ctx.db.get(build.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const blueprint = build.blueprint;
    if (!blueprint?.steps || stepIndex < 0 || stepIndex >= blueprint.steps.length)
      throw new Error("Step not found");
    const steps = blueprint.steps.map((s, i) =>
      i === stepIndex ? { ...s, status } : s,
    );
    await ctx.db.patch(id, {
      blueprint: { ...blueprint, steps },
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("builds") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    // cascade: remove the build's pages too
    const pages = await ctx.db
      .query("buildPages")
      .withIndex("by_build", (q) => q.eq("buildId", id))
      .collect();
    for (const p of pages) await ctx.db.delete(p._id);
    await ctx.db.delete(id);
  },
});
