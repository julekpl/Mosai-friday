import { orgMutation, orgQuery } from "./guards";
import { assertModule } from "./guards";
import { v } from "convex/values";

/* ── M1 Collections — reference products, never own them ───────────────── */

export const list = orgQuery({
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

export const create = orgMutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args, access) => {
    // Ownership first: `assertModule` only checks the plan, so without this
    // any signed-in user could insert a collection into somebody else's
    // project by passing a foreign projectId (review finding T0.6).
    const { project } = await access.requireProject(args.projectId);
    await assertModule(ctx, "sell");
    return await ctx.db.insert("collections", {
      ...args,
      projectId: project._id,
      createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
  args: {
    id: v.id("collections"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    await assertModule(ctx, "sell");
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
export const remove = orgMutation({
  args: { id: v.id("collections") },
  handler: async (ctx, { id }, access) => {
    await assertModule(ctx, "sell");
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
