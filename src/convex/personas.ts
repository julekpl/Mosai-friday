import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

const journeyStage = v.object({
  stage: v.string(),
  question: v.string(),
  answer: v.optional(v.string()),
});

export const list = moduleQuery("understand", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("personas")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = moduleQuery("understand", {
  args: { id: v.id("personas") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export const create = moduleMutation("understand", {
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    role: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    pains: v.optional(v.array(v.string())),
    objections: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    country: v.optional(v.string()),
    demographics: v.optional(v.string()),
    bigFive: v.optional(v.object({ openness: v.number(), conscientiousness: v.number(), extraversion: v.number(), agreeableness: v.number(), neuroticism: v.number() })),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
  },
  handler: async (ctx, args, access) => {
    const { userId } = await access.requireProject(args.projectId);
    const { projectId, ...rest } = args;
    return await ctx.db.insert("personas", {
      projectId,
      ...rest,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("understand", {
  args: {
    id: v.id("personas"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    pains: v.optional(v.array(v.string())),
    objections: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    country: v.optional(v.string()),
    demographics: v.optional(v.string()),
    bigFive: v.optional(v.object({ openness: v.number(), conscientiousness: v.number(), extraversion: v.number(), agreeableness: v.number(), neuroticism: v.number() })),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
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

export const remove = moduleMutation("understand", {
  args: { id: v.id("personas") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
