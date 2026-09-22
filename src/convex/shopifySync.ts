import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import {
  fetchAllShopifyProducts,
  fetchAllShopifyCollections,
} from "../lib/cms/commerceConnector";

/* ── Shopify READ connector (W5) — see CMS-CONNECTOR-CONTRACT.md ──────────
 *
 * Provider-authority sync: Shopify rows are upserted by externalId with
 * source="external" / authority="shopify". MOSAI enrichment is preserved.
 * Credentials come from project env keys set in the Keys/API keys UI and
 * never touch the client.
 */

/* Per-project credentials do not exist yet. Until the connections framework
 * can supply a store domain + access token for a single project, this route
 * must stay disabled: it would read ONE deployment-wide Shopify store from
 * the environment and sync that store's catalog into EVERY project that
 * calls it (cross-tenant data exposure — see review item T0.9 / G24).
 *
 * Flip this only once credentials are resolved per project. */
const SHOPIFY_PER_PROJECT_CREDENTIALS = false;

type NormalizedProduct = {
  externalId: string;
  title: string;
  handle: string;
  description?: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  onlineStoreUrl?: string;
  variants: {
    externalId: string;
    title?: string;
    sku?: string;
    priceCents: number | null;
    compareAtPriceCents?: number | null;
    currency: string;
    available: boolean | null;
    quantity: number | null;
    isDefault: boolean;
    position: number;
  }[];
  media: { url: string; alt?: string; position: number }[];
};

type NormalizedCollection = {
  externalId: string;
  title: string;
  handle: string;
  description?: string;
};

/** Look up an external product row (internal: no auth needed, action-only). */
export const findExternalProduct = internalQuery({
  args: { projectId: v.id("projects"), externalId: v.string() },
  handler: async (ctx, { projectId, externalId }) => {
    const rows = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.find((r) => r.externalId === externalId) ?? null;
  },
});

export const findExternalCollection = internalQuery({
  args: { projectId: v.id("projects"), externalId: v.string() },
  handler: async (ctx, { projectId, externalId }) => {
    const rows = await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.find((r) => r.externalId === externalId) ?? null;
  },
});

/** Upsert one product bundle (product + variants + media), provider-authority. */
export const upsertExternalProduct = internalMutation({
  args: {
    projectId: v.id("projects"),
    product: v.any(),
  },
  handler: async (ctx, { projectId, product }) => {
    const p = product as NormalizedProduct;
    const now = Date.now();
    const external = {
      source: "external" as const,
      authority: "shopify",
      provider: "shopify",
      externalId: p.externalId,
      lastSyncedAt: now,
    };

    const existing = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
      .then((rows) => rows.find((r) => r.externalId === p.externalId));

    let productId: Id<"products">;
    if (existing) {
      // provider facts updated; MOSAI enrichment (enrichment.*) untouched
      await ctx.db.patch(existing._id, {
        title: p.title,
        slug: p.handle,
        description: p.description,
        brand: p.vendor,
        productType: p.productType,
        tags: p.tags,
        externalUrl: p.onlineStoreUrl,
        status: existing.status === "archived" ? "active" : existing.status,
        updatedAt: now,
        ...external,
      });
      productId = existing._id;
    } else {
      productId = await ctx.db.insert("products", {
        projectId,
        title: p.title,
        slug: p.handle,
        description: p.description,
        brand: p.vendor,
        productType: p.productType,
        tags: p.tags,
        externalUrl: p.onlineStoreUrl,
        status: "active",
        enrichment: undefined,
        createdAt: now,
        updatedAt: now,
        ...external,
      });
    }

    // variants: replace-all by externalId (variants are wholly provider-owned)
    const existingVariants = await ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const seen = new Set<string>();
    for (const v of p.variants) {
      seen.add(v.externalId);
      const match = existingVariants.find((ev) => ev.externalId === v.externalId);
      const patch = {
        title: v.title,
        sku: v.sku,
        priceCents: v.priceCents ?? undefined,
        compareAtPriceCents: v.compareAtPriceCents ?? undefined,
        currency: v.currency,
        inventoryCount: v.quantity ?? undefined,
        availability:
          v.available === true
            ? "in_stock"
            : v.available === false
              ? "out_of_stock"
              : undefined,
        isDefault: v.isDefault,
        updatedAt: now,
      };
      if (match) {
        await ctx.db.patch(match._id, patch);
      } else {
        await ctx.db.insert("productVariants", {
          projectId,
          productId,
          ...patch,
          source: "external" as const,
          externalId: v.externalId,
          createdAt: now,
        });
      }
    }
    // provider removed a variant → delete the stale row (§51: no stale truth)
    for (const ev of existingVariants) {
      if (ev.externalId && !seen.has(ev.externalId)) await ctx.db.delete(ev._id);
    }

    // media: replace-all
    const existingMedia = await ctx.db
      .query("productMedia")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    for (const m of existingMedia) await ctx.db.delete(m._id);
    for (const m of p.media) {
      await ctx.db.insert("productMedia", {
        projectId,
        productId,
        url: m.url,
        alt: m.alt,
        position: m.position,
        source: "external" as const,
        createdAt: now,
      });
    }

    return productId;
  },
});

export const upsertExternalCollection = internalMutation({
  args: {
    projectId: v.id("projects"),
    collection: v.any(),
  },
  handler: async (ctx, { projectId, collection }) => {
    const c = collection as NormalizedCollection;
    const now = Date.now();
    const rows = await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const existing = rows.find((r) => r.externalId === c.externalId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: c.title,
        description: c.description,
        slug: c.handle,
        lastSyncedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("collections", {
      projectId,
      title: c.title,
      description: c.description,
      slug: c.handle,
      source: "external" as const,
      authority: "shopify",
      provider: "shopify",
      externalId: c.externalId,
      lastSyncedAt: now,
      createdAt: now,
    });
  },
});

/** Link products to their Shopify collections — see applyCollectionMembership. */

/** Internal project ownership check for actions. */
export const getProjectOwner = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    return project ? { ownerId: project.ownerId } : null;
  },
});

/** Full catalog sync. Returns counts; throws readable errors to the client. */
export const syncCatalog = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project: { ownerId: Id<"users"> } | null = await ctx.runQuery(
      internal.shopifySync.getProjectOwner,
      { projectId },
    );
    if (!project || project.ownerId !== userId)
      throw new Error("Not found");

    if (!SHOPIFY_PER_PROJECT_CREDENTIALS) {
      throw new Error(
        "Shopify catalog sync is not available yet — it needs per-project credentials so one store can never sync into another project.",
      );
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
    if (!storeDomain || !accessToken) {
      throw new Error(
        "Shopify is not configured — add SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN in the Keys tab.",
      );
    }

    const { shopifyGraphQL, fetchAllShopifyProducts, fetchAllShopifyCollections } =
      await import("../lib/cms/commerceConnector");

    const cfg = { storeDomain, accessToken };

    // 1. collections
    const collections = await fetchAllShopifyCollections(cfg);
    for (const c of collections) {
      await ctx.runMutation(internal.shopifySync.upsertExternalCollection, {
        projectId,
        collection: c,
      });
    }

    // 2. products
    const products = await fetchAllShopifyProducts(cfg);
    for (const p of products) {
      await ctx.runMutation(internal.shopifySync.upsertExternalProduct, {
        projectId,
        product: p,
      });
    }

    // 3. collection membership (handles → product GIDs via a second query)
    const MEMBERSHIP_QUERY = /* GraphQL */ `
      query CollectionProducts($first: Int!, $cursor: String) {
        collections(first: $first, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            products(first: 100) { nodes { id } }
          }
        }
      }
    `;
    let cursor: string | null = null;
    const membership = new Map<string, string[]>(); // collection GID → product GIDs
    for (let page = 0; page < 5; page++) {
      const data = await shopifyGraphQL(cfg, MEMBERSHIP_QUERY, {
        first: 20,
        cursor,
      });
      const conn = (
        data as {
          collections: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: { id: string; products: { nodes: { id: string }[] } }[];
          };
        }
      ).collections;
      for (const node of conn.nodes) {
        membership.set(
          node.id,
          node.products.nodes.map((n) => n.id),
        );
      }
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      cursor = conn.pageInfo.endCursor;
    }
    await ctx.runMutation(internal.shopifySync.applyCollectionMembership, {
      projectId,
      membership: Array.from(membership.entries()).map(([externalId, productIds]) => ({
        externalId,
        productIds,
      })),
    });

    return {
      collections: collections.length,
      products: products.length,
    };
  },
});

export const applyCollectionMembership = internalMutation({
  args: {
    projectId: v.id("projects"),
    membership: v.array(
      v.object({
        externalId: v.string(),
        productIds: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { projectId, membership }) => {
    const [collections, products] = await Promise.all([
      ctx.db
        .query("collections")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    ]);
    for (const m of membership) {
      const col = collections.find((c) => c.externalId === m.externalId);
      if (!col) continue;
      const memberLocalIds = products
        .filter((p) => p.externalId && m.productIds.includes(p.externalId))
        .map((p) => p._id);
      // products hold collectionIds (M1 model) — patch each product
      for (const pid of memberLocalIds) {
        const product = await ctx.db.get(pid);
        const current = product?.collectionIds ?? [];
        if (!current.includes(col._id)) {
          await ctx.db.patch(pid, {
            collectionIds: [...current, col._id],
            updatedAt: Date.now(),
          });
        }
      }
    }
  },
});
