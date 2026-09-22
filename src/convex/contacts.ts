import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

export const list = moduleQuery("customers", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("contacts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("customers", {
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
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

export const update = moduleMutation("customers", {
  args: {
    id: v.id("contacts"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
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

export const remove = moduleMutation("customers", {
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
