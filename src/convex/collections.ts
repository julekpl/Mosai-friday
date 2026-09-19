import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertModule, ownedRow, requireUser } from "./guards";

/* ── M1 Collections — reference products, never own them ───────────────── */

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertModule(ctx, "sell");
    const { projectId, ...rest } = args;
    return await ctx.db.insert("collections", {
      projectId,
      ...rest,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("collections"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await assertModule(ctx, "sell");
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

/** Deleting a collection de-references it from products — never touches
 *  the products themselves (M1-BLUEPRINT §5). */
export const remove = mutation({
  args: { id: v.id("collections") },
  handler: async (ctx, { id }) => {
    await assertModule(ctx, "sell");
    const row = await ownedRow(ctx, await ctx.db.get(id));
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
