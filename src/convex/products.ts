import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { computeReadiness } from "./sell/readiness";
import type { MutationCtx } from "./_generated/server";

/* ── M1 Products CRUD — Sell module (M1-BLUEPRINT.md §1/§4) ────────────── */

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

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

async function requireProjectCollections(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  collectionIds: Doc<"products">["collectionIds"],
) {
  if (!collectionIds) return;
  if (new Set(collectionIds).size !== collectionIds.length) {
    throw new Error("A collection can only be assigned once");
  }
  for (const id of collectionIds) {
    const collection = await ctx.db.get(id);
    if (!collection || collection.projectId !== projectId) {
      throw new Error("Collection must belong to the same project");
    }
  }
}

/* ── Queries ─────────────────────────────────────────────────────────── */

/** Products + variants + media + readiness in one reactive call. */
export const listWithReadiness = moduleQuery("sell", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    const project = scope.project;

    const products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return await Promise.all(
      products.map(async (product) => {
        const [variants, media, collections] = await Promise.all([
          ctx.db
            .query("productVariants")
            .withIndex("by_product", (q) => q.eq("productId", product._id))
            .collect(),
          ctx.db
            .query("productMedia")
            .withIndex("by_product", (q) => q.eq("productId", product._id))
            .collect(),
          Promise.all((product.collectionIds ?? []).map((id) => ctx.db.get(id))),
        ]);
        const readiness = computeReadiness({
          product,
          variants,
          media,
          websiteUrl: project.websiteUrl,
        });
        return {
          ...product,
          variants,
          media,
          collections: collections.filter(
            (c): c is Doc<"collections"> => !!c && c.projectId === projectId,
          ),
          readiness,
        };
      }),
    );
  },
});

/** Single product bundle for the inspector. */
export const getWithDetail = moduleQuery("sell", {
  args: { id: v.id("products") },
  handler: async (ctx, { id }, access) => {
    const product = (await access.ownedRow(
      await ctx.db.get(id),
    )) as Doc<"products"> | null;
    if (!product) return null;
    const [variants, media] = await Promise.all([
      ctx.db
        .query("productVariants")
        .withIndex("by_product", (q) => q.eq("productId", id))
        .collect(),
      ctx.db
        .query("productMedia")
        .withIndex("by_product", (q) => q.eq("productId", id))
        .collect(),
    ]);
    return {
      ...product,
      variants,
      media,
      readiness: computeReadiness({
        product,
        variants,
        media,
        websiteUrl: (await ctx.db.get(product.projectId))?.websiteUrl,
      }),
    };
  },
});

/* ── Mutations ────────────────────────────────────────────────────────── */

/** Create a product. Always creates exactly one default variant. */
export const create = moduleMutation("sell", {
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    priceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    availability: v.optional(v.union(
      v.literal("in_stock"), v.literal("out_of_stock"),
      v.literal("backorder"), v.literal("preorder"),
    )),
    imageUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
    collectionIds: v.optional(v.array(v.id("collections"))),
    identifierStatus: v.optional(v.union(
      v.literal("has_identifiers"), v.literal("no_identifiers_exist"), v.literal("unknown"),
    )),
  },
  handler: async (ctx, args, access) => {
    // The module builder already enforced `sell.edit` against the acting
    // organization's plan and the caller's role; this is the record check.
    await access.requireProject(args.projectId);

    requireNonnegativeInteger(args.priceCents, "Price");
    requireNonnegativeInteger(args.inventoryCount, "Inventory count");
    requireAvailabilityInventory(args.availability, args.inventoryCount);
    await requireProjectCollections(ctx, args.projectId, args.collectionIds);

    const now = Date.now();
    const { projectId, imageUrl, ...rest } = args;

    const productId = await ctx.db.insert("products", {
      projectId,
      title: rest.title,
      slug: slugify(rest.title),
      description: rest.description,
      status: rest.status ?? "draft",
      source: "mosai_native",
      authority: "mosai",
      collectionIds: rest.collectionIds,
      createdAt: now,
      updatedAt: now,
    });

    // Default variant — owns the purchasable facts (hidden in ordinary UX)
    await ctx.db.insert("productVariants", {
      projectId,
      productId,
      isDefault: true,
      priceCents: rest.priceCents,
      currency: rest.currency ?? "EUR",
      inventoryCount: rest.inventoryCount,
      availability: rest.availability ?? (rest.inventoryCount === 0
        ? "out_of_stock"
        : "in_stock"),
      identifierStatus: rest.identifierStatus ?? "unknown",
      source: "mosai_native",
      createdAt: now,
      updatedAt: now,
    });

    if (imageUrl?.trim()) {
      await ctx.db.insert("productMedia", {
        projectId,
        productId,
        url: imageUrl.trim(),
        position: 0,
        source: "mosai_native",
        createdAt: now,
      });
    }

    await ctx.runMutation(internal.commerceEvents.log, {
      projectId,
      event: "product_created",
      meta: {
        productId,
        hasPrice: rest.priceCents != null,
        hasImage: !!imageUrl?.trim(),
      },
    });

    return productId;
  },
});

/** Update product merchandising fields (never commerce facts — those live
 *  on variants and are updated via variants.updateDefault). */
export const update = moduleMutation("sell", {
  args: {
    id: v.id("products"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    ),
    brand: v.optional(v.string()),
    productType: v.optional(v.string()),
    collectionIds: v.optional(v.array(v.id("collections"))),
    enrichment: v.optional(
      v.object({
        seoTitle: v.optional(v.string()),
        seoDescription: v.optional(v.string()),
        buyerObjections: v.optional(v.array(v.string())),
        contentOpportunities: v.optional(v.array(v.string())),
        origin: v.union(v.literal("ai"), v.literal("user")),
      }),
    ),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");

    if (patch.collectionIds !== undefined) {
      await requireProjectCollections(ctx, row.projectId, patch.collectionIds);
    }

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (!Object.keys(clean).length) return;

    await ctx.db.patch(id, {
      ...clean,
      ...(typeof clean.title === "string" ? { slug: slugify(clean.title) } : {}),
      updatedAt: Date.now(),
    });

    if (clean.status === "active") {
      await ctx.runMutation(internal.commerceEvents.log, {
        projectId: row.projectId,
        event: "product_activated",
        meta: { productId: id },
      });
    }
  },
});

export const remove = moduleMutation("sell", {
  args: { id: v.id("products") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");

    // Transactional-ish cleanup: variants, media, then product
    const variants = await ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", id))
      .collect();
    for (const v of variants) await ctx.db.delete(v._id);
    const media = await ctx.db
      .query("productMedia")
      .withIndex("by_product", (q) => q.eq("productId", id))
      .collect();
    for (const m of media) await ctx.db.delete(m._id);
    await ctx.db.delete(id);
  },
});
