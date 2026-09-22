import { orgMutation, orgQuery } from "./guards";
import { v } from "convex/values";

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

export const list = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("builds")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = orgQuery({
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export const create = orgMutation({
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
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
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

export const update = orgMutation({
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

export const setStepStatus = orgMutation({
  args: {
    id: v.id("builds"),
    stepIndex: v.number(),
    status: v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
  },
  handler: async (ctx, { id, stepIndex, status }, access) => {
    const build = await access.ownedRow(await ctx.db.get(id));
    if (!build) throw new Error("Not found");
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

export const remove = orgMutation({
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
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
