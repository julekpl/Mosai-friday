import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

export const list = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("communications")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    message: v.string(),
    rationale: v.optional(v.string()),
    channels: v.optional(v.array(v.string())),
    audience: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
    return await ctx.db.insert("communications", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("create", {
  args: {
    id: v.id("communications"),
    name: v.optional(v.string()),
    message: v.optional(v.string()),
    rationale: v.optional(v.string()),
    channels: v.optional(v.array(v.string())),
    audience: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    ),
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

export const remove = moduleMutation("create", {
  args: { id: v.id("communications") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
