import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ownedRow, requireUser } from "./guards";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("contacts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const { projectId, consentMarketing, ...rest } = args;
    return await ctx.db.insert("contacts", {
      projectId,
      ...rest,
      consent: {
        marketing: consentMarketing ?? false,
        updatedAt: Date.now(),
        source: "manual",
      },
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("contacts"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    const next: Record<string, unknown> = { ...clean };
    if (patch.consentMarketing !== undefined) {
      next.consent = {
        marketing: patch.consentMarketing,
        updatedAt: Date.now(),
        source: "manual",
      };
      delete next.consentMarketing;
    }
    if (Object.keys(next).length) await ctx.db.patch(id, next);
  },
});

export const remove = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
