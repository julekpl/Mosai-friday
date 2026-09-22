import { orgMutation, orgQuery } from "./guards";
import { v } from "convex/values";

export const list = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("campaigns")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = orgMutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    channel: v.string(), // email | social | ads
    budgetCents: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    const { projectId, ...rest } = args;
    return await ctx.db.insert("campaigns", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
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
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = orgMutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
