import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertModule, ownedRow } from "./guards";
import type { Doc } from "./_generated/dataModel";

/* ── M1 Variants — purchasable facts live here (M1-BLUEPRINT §1) ───────── */

/** Update the default variant's facts (simple-product UX writes here). */
export const updateDefault = mutation({
  args: {
    productId: v.id("products"),
    priceCents: v.optional(v.number()),
    compareAtPriceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    availability: v.optional(
      v.union(
        v.literal("in_stock"),
        v.literal("out_of_stock"),
        v.literal("backorder"),
        v.literal("preorder"),
      ),
    ),
    availabilityDate: v.optional(v.number()),
    sku: v.optional(v.string()),
    gtin: v.optional(v.string()),
    identifierStatus: v.optional(
      v.union(
        v.literal("has_identifiers"),
        v.literal("no_identifiers_exist"),
        v.literal("unknown"),
      ),
    ),
  },
  handler: async (ctx, { productId, ...patch }) => {
    await assertModule(ctx, "sell");
    const product = await ownedRow(ctx, await ctx.db.get(productId));
    if (!product) throw new Error("Not found");

    const variants = await ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const def = variants.find((v) => v.isDefault);
    if (!def) throw new Error("Default variant missing");

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (!Object.keys(clean).length) return;

    await ctx.db.patch(def._id, {
      ...clean,
      updatedAt: Date.now(),
    });
  },
});

/** Add an explicit variant. Demotes the previous default if this is the
 *  first explicit variant and the product was previously simple. */
export const addExplicit = mutation({
  args: {
    productId: v.id("products"),
    title: v.string(),
    optionValues: v.array(
      v.object({ name: v.string(), value: v.string() }),
    ),
    priceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    availability: v.optional(v.string()),
    sku: v.optional(v.string()),
    gtin: v.optional(v.string()),
  },
  handler: async (ctx, { productId, ...args }) => {
    await assertModule(ctx, "sell");
    const product = (await ownedRow(
      ctx,
      await ctx.db.get(productId),
    )) as Doc<"products"> | null;
    if (!product) throw new Error("Not found");

    const now = Date.now();
    const variants = await ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();

    const wasSimple =
      variants.length === 1 && variants[0].isDefault;

    const id = await ctx.db.insert("productVariants", {
      projectId: product.projectId,
      productId,
      isDefault: false,
      title: args.title,
      optionValues: args.optionValues,
      priceCents: args.priceCents,
      currency: args.currency ?? "EUR",
      inventoryCount: args.inventoryCount,
      availability: args.availability ?? "in_stock",
      sku: args.sku,
      gtin: args.gtin,
      identifierStatus: args.gtin || args.sku ? "has_identifiers" : "unknown",
      source: "mosai_native",
      createdAt: now,
      updatedAt: now,
    });

    // When a simple product gains its first explicit variant, keep the old
    // default as an explicit variant too (title from product title) so the
    // "exactly one default" invariant and variant semantics stay honest.
    if (wasSimple && variants[0] && !variants[0].title) {
      await ctx.db.patch(variants[0]._id, {
        title: product.title,
        optionValues: [],
        updatedAt: now,
      });
    }

    return id;
  },
});
