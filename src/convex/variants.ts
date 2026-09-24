import { v } from "convex/values";
import { moduleMutation } from "./guards";
import type { Doc } from "./_generated/dataModel";

function requireNonnegativeInteger(value: number | undefined, label: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a nonnegative whole number`);
  }
}

function requireAvailabilityInventory(
  availability: string | undefined,
  inventoryCount: number | undefined,
) {
  if (inventoryCount === undefined) return;
  if (
    (availability === "in_stock" && inventoryCount === 0) ||
    (availability === "out_of_stock" && inventoryCount > 0)
  ) {
    throw new Error("Availability must agree with the tracked inventory count");
  }
}

/* ── M1 Variants — purchasable facts live here (M1-BLUEPRINT §1) ───────── */

/** Update the default variant's facts (simple-product UX writes here). */
export const updateDefault = moduleMutation("sell", {
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
  handler: async (ctx, { productId, ...patch }, access) => {
    const product = await access.ownedRow(await ctx.db.get(productId));
    if (!product) throw new Error("Not found");

    const variants = await ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const def = variants.find((v) => v.isDefault);
    if (!def) throw new Error("Default variant missing");

    requireNonnegativeInteger(patch.priceCents, "Price");
    requireNonnegativeInteger(patch.compareAtPriceCents, "Compare-at price");
    requireNonnegativeInteger(patch.inventoryCount, "Inventory count");
    if (patch.availabilityDate !== undefined && !Number.isSafeInteger(patch.availabilityDate)) {
      throw new Error("Availability date must be a whole number timestamp");
    }

    const clean = { ...patch };
    for (const key of Object.keys(clean) as Array<keyof typeof clean>) {
      if (clean[key] === undefined) delete clean[key];
    }
    const effectiveInventory = patch.inventoryCount ?? def.inventoryCount;
    const effectiveAvailability = patch.availability ?? (
      patch.inventoryCount !== undefined &&
      (def.availability === undefined ||
        def.availability === "in_stock" ||
        def.availability === "out_of_stock")
        ? patch.inventoryCount === 0 ? "out_of_stock" : "in_stock"
        : def.availability
    );
    requireAvailabilityInventory(effectiveAvailability, effectiveInventory);
    if (
      patch.inventoryCount !== undefined &&
      patch.availability === undefined &&
      (def.availability === undefined ||
        def.availability === "in_stock" ||
        def.availability === "out_of_stock")
    ) {
      clean.availability = patch.inventoryCount === 0 ? "out_of_stock" : "in_stock";
    }
    if (!Object.keys(clean).length) return;

    await ctx.db.patch(def._id, {
      ...clean,
      updatedAt: Date.now(),
    });
  },
});

/** Add an explicit variant. Demotes the previous default if this is the
 *  first explicit variant and the product was previously simple. */
export const addExplicit = moduleMutation("sell", {
  args: {
    productId: v.id("products"),
    title: v.string(),
    optionValues: v.array(
      v.object({ name: v.string(), value: v.string() }),
    ),
    priceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    availability: v.optional(v.union(
      v.literal("in_stock"), v.literal("out_of_stock"),
      v.literal("backorder"), v.literal("preorder"),
    )),
    sku: v.optional(v.string()),
    gtin: v.optional(v.string()),
  },
  handler: async (ctx, { productId, ...args }, access) => {
    const product = (await access.ownedRow(
      await ctx.db.get(productId),
    )) as Doc<"products"> | null;
    if (!product) throw new Error("Not found");

    requireNonnegativeInteger(args.priceCents, "Price");
    requireNonnegativeInteger(args.inventoryCount, "Inventory count");
    requireAvailabilityInventory(args.availability, args.inventoryCount);

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
      availability: args.availability ?? (args.inventoryCount === 0 ? "out_of_stock" : "in_stock"),
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
