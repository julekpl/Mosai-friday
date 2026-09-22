import { orgMutation, orgQuery } from "./guards";
import { v } from "convex/values";

export const list = orgQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) return [];
    const scope = await access.ownedProject(build.projectId);
    if (!scope) return [];
    return await ctx.db
      .query("buildPages")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
  },
});

export const get = orgQuery({
  args: { id: v.id("buildPages") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export const create = orgMutation({
  args: {
    buildId: v.id("builds"),
    name: v.string(),
    path: v.string(),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    journeyStage: v.optional(v.string()),
  },
  handler: async (ctx, { buildId, ...rest }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) throw new Error("Not found");
    await access.requireProject(build.projectId);
    const now = Date.now();
    return await ctx.db.insert("buildPages", {
      buildId,
      projectId: build.projectId,
      ...rest,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = orgMutation({
  args: {
    id: v.id("buildPages"),
    name: v.optional(v.string()),
    path: v.optional(v.string()),
    goal: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    journeyStage: v.optional(v.string()),
    draft: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("drafted"), v.literal("approved")),
    ),
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

export const remove = orgMutation({
  args: { id: v.id("buildPages") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
