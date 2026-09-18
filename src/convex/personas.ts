import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const journeyStage = v.object({
  stage: v.string(),
  question: v.string(),
  answer: v.optional(v.string()),
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("personas")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("personas") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const persona = await ctx.db.get(id);
    if (!persona) return null;
    const project = await ctx.db.get(persona.projectId);
    if (!project || project.ownerId !== userId) return null;
    return persona;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    role: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    pains: v.optional(v.array(v.string())),
    objections: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, ...rest } = args;
    return await ctx.db.insert("personas", {
      projectId,
      ...rest,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("personas"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    pains: v.optional(v.array(v.string())),
    objections: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    evidence: v.optional(v.string()),
    journeyStages: v.optional(v.array(journeyStage)),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const persona = await ctx.db.get(id);
    if (!persona) throw new Error("Not found");
    const project = await ctx.db.get(persona.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("personas") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const persona = await ctx.db.get(id);
    if (!persona) throw new Error("Not found");
    const project = await ctx.db.get(persona.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
