import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";
import { bigFiveSourceValidator, bigFiveValidator, cleanBigFive } from "../shared/bigFive";

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
    culturalContext: v.optional(v.string()),
    bigFive: v.optional(bigFiveValidator),
    bigFiveSource: v.optional(bigFiveSourceValidator),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
  },
  handler: async (ctx, args, access) => {
    const { userId } = await access.requireProject(args.projectId);
    const { projectId, bigFive: rawBigFive, bigFiveSource, ...rest } = args;
    // Scores without a stated source are an AI guess (shared/bigFive.ts).
    const bigFive = cleanBigFive(rawBigFive);
    return await ctx.db.insert("personas", {
      projectId,
      ...rest,
      bigFive,
      bigFiveSource: bigFive ? bigFiveSource ?? "ai_hypothesis" : undefined,
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
    culturalContext: v.optional(v.string()),
    bigFive: v.optional(bigFiveValidator),
    bigFiveSource: v.optional(bigFiveSourceValidator),
    // Remove the scores (and their source) altogether.
    clearBigFive: v.optional(v.boolean()),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
  },
  handler: async (ctx, { id, bigFive: rawBigFive, bigFiveSource, clearBigFive, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (clearBigFive) {
      clean.bigFive = undefined;
      clean.bigFiveSource = undefined;
    } else if (rawBigFive !== undefined) {
      const bigFive = cleanBigFive(rawBigFive);
      clean.bigFive = bigFive;
      clean.bigFiveSource = bigFive ? bigFiveSource ?? row.bigFiveSource ?? "ai_hypothesis" : undefined;
    } else if (bigFiveSource !== undefined && row.bigFive) {
      clean.bigFiveSource = bigFiveSource;
    }
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
