import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

/* ── M1 Collections — reference products, never own them ───────────────── */

export const list = moduleQuery("sell", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("sell", {
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args, access) => {
    // `access.requireProject` authorizes the record AND (inside a module
    // builder) enforces `sell.edit` for the acting organization's plan and the
    // caller's role, so a foreign projectId and a locked module both fail here
    // before anything is inserted (review finding T0.6 / T2.3).
    const { project } = await access.requireProject(args.projectId);
    return await ctx.db.insert("collections", {
      ...args,
      projectId: project._id,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("sell", {
  args: {
    id: v.id("collections"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
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

/** Deleting a collection de-references it from products — never touches
 *  the products themselves (M1-BLUEPRINT §5). */
export const remove = moduleMutation("sell", {
  args: { id: v.id("collections") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");

    const products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", row.projectId))
      .collect();
    for (const p of products) {
      if (p.collectionIds?.includes(id)) {
        await ctx.db.patch(p._id, {
          collectionIds: p.collectionIds.filter((c) => c !== id),
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.delete(id);
  },
});
