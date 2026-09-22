import { mutation, query } from "./_generated/server";
import { assertModule, orgMutation, orgQuery, ownedRow, requireUser } from "./guards";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { computeReadiness } from "./sell/readiness";

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

/* ── Queries ─────────────────────────────────────────────────────────── */

/** Products + variants + media + readiness in one reactive call. */
export const listWithReadiness = orgQuery({
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
          Promise.all(
            (product.collectionIds ?? []).map((id) => ctx.db.get(id)),
          ),
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
          collections: collections.filter((c): c is Doc<"collections"> => !!c),
          readiness,
        };
      }),
    );
  },
});

/** Single product bundle for the inspector. */
export const getWithDetail = query({
  args: { id: v.id("products") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const product = (await ownedRow(
      ctx,
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
    void userId;
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
export const create = orgMutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    priceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    availability: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
    collectionIds: v.optional(v.array(v.id("collections"))),
    identifierStatus: v.optional(v.string()),
  },
  handler: async (ctx, args, access) => {
    await assertModule(ctx, "sell");
    await access.requireProject(args.projectId);

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
      syncState: "synced",
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
      availability: rest.availability ?? (rest.inventoryCount != null && rest.inventoryCount > 0 ? "in_stock" : "out_of_stock"),
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
export const update = mutation({
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
  handler: async (ctx, { id, ...patch }) => {
    await assertModule(ctx, "sell");
    const row = await ownedRow(ctx, await ctx.db.get(id));
    if (!row) throw new Error("Not found");

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
        event: "product_published",
        meta: { productId: id },
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, { id }) => {
    await assertModule(ctx, "sell");
    const row = await ownedRow(ctx, await ctx.db.get(id));
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
