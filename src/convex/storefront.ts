import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { moduleQuery, type OrgAccess } from "./guards";
import type { CapabilityKey } from "./lib/capabilities";

/* ── Storefront read model (svelte-commerce pattern) ──────────────────────
 *
 * Multi-page storefront over the canonical Sell + CMS tables:
 *   /            → shop listing (search, filter, sort)
 *   /c/:slug     → collection page
 *   /p/:slug     → product detail (variants, gallery, checkout handoff)
 *   /*           → published CMS page via PageRenderer
 *
 * Commerce facts (price, availability, images) are resolved live from
 * Product/Variant/Media at read time — the storefront never stores copies
 * (WEBSITE-ARCHITECTURE §5). Checkout is handed off to the provider via
 * the product's externalUrl (§57) until the native engine (W7) exists.
 */

type VariantDoc = Doc<"productVariants">;
type MediaDoc = Doc<"productMedia">;

export type StorefrontProduct = {
  productId: Id<"products">;
  title: string;
  slug: string | null;
  description: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
  provider: string | null;
  productType: string | null;
  tags: string[];
  collectionIds: Id<"collections">[];
};

async function requireOwnedProject(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  access: OrgAccess,
  capability?: CapabilityKey,
): Promise<{ ok: true; site: Doc<"sites"> | null } | { ok: false }> {
  // `access` carries the module capability (T2.3): the shop reads under Sell
  // and a published CMS page under Build, so a plan without the add-on — or a
  // role without the action — reads nothing instead of shop data. A foreign
  // organization still gets nothing (the capability resolves to
  // `unavailable` when the caller is not an active member of the owner).
  const scope = await access.ownedProject(projectId, capability);
  if (!scope) return { ok: false };
  const site = await ctx.db
    .query("sites")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  return { ok: true, site };
}

/** Resolve live display facts for one product (default variant + primary media). */
async function resolveProductFacts(
  ctx: QueryCtx,
  productId: Id<"products">,
) {
  const [variants, media] = await Promise.all([
    ctx.db
      .query("productVariants")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect() as Promise<VariantDoc[]>,
    ctx.db
      .query("productMedia")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect() as Promise<MediaDoc[]>,
  ]);
  const def = variants.find((v) => v.isDefault) ?? variants[0];
  const primary =
    [...media].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0] ?? null;
  return { variants, media, def, primary };
}

/* ── Shop listing: search, availability filter, sort (§55, §56) ────────── */

export const listShopProducts = moduleQuery("sell", {
  args: {
    projectId: v.id("projects"),
    collectionId: v.optional(v.id("collections")),
    search: v.optional(v.string()),
    availability: v.optional(v.string()), // "all" | "in_stock"
    sort: v.optional(v.string()), // featured | price_asc | price_desc | title
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { projectId, collectionId, search, availability, sort, limit },
    access,
  ) => {
    const owned = await requireOwnedProject(ctx, projectId, access);
    if (!owned.ok) return [];

    let products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    // Storefront shows only active products — drafts are not for sale.
    products = products.filter((p) => p.status === "active");
    if (collectionId) {
      products = products.filter((p) =>
        p.collectionIds?.includes(collectionId),
      );
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      products = products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.productType?.toLowerCase().includes(q) ||
          p.tags?.some((t: string) => t.toLowerCase().includes(q)),
      );
    }

    const resolved: StorefrontProduct[] = [];
    for (const p of products) {
      const { def, primary } = await resolveProductFacts(ctx, p._id);
      if (
        availability === "in_stock" &&
        def?.availability &&
        def.availability !== "in_stock"
      ) {
        continue;
      }
      resolved.push({
        productId: p._id,
        title: p.title,
        slug: p.slug ?? null,
        description: p.description ?? null,
        priceCents: def?.priceCents ?? null,
        compareAtPriceCents: def?.compareAtPriceCents ?? null,
        currency: def?.currency ?? "USD",
        availability: def?.availability ?? null,
        imageUrl: primary?.url ?? null,
        externalUrl: p.externalUrl ?? null,
        provider: p.provider ?? null,
        productType: p.productType ?? null,
        tags: p.tags ?? [],
        collectionIds: p.collectionIds ?? [],
      });
    }

    switch (sort) {
      case "price_asc":
        resolved.sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity));
        break;
      case "price_desc":
        resolved.sort((a, b) => (b.priceCents ?? -1) - (a.priceCents ?? -1));
        break;
      case "title":
        resolved.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        break; // featured = natural order
    }
    return resolved.slice(0, Math.min(limit ?? 48, 96));
  },
});

/* ── Collections rail + collection page ────────────────────────────────── */

export const listShopCollections = moduleQuery("sell", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const owned = await requireOwnedProject(ctx, projectId, access);
    if (!owned.ok) return [];
    return await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const getShopCollection = moduleQuery("sell", {
  args: { projectId: v.id("projects"), slug: v.string() },
  handler: async (ctx, { projectId, slug }, access) => {
    const owned = await requireOwnedProject(ctx, projectId, access);
    if (!owned.ok) return null;
    const cols = await ctx.db
      .query("collections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return cols.find((c) => c.slug === slug) ?? null;
  },
});

/* ── Product detail: variants, gallery, handoff URL ────────────────────── */

export const getShopProduct = moduleQuery("sell", {
  args: { projectId: v.id("projects"), slug: v.string() },
  handler: async (ctx, { projectId, slug }, access) => {
    const owned = await requireOwnedProject(ctx, projectId, access);
    if (!owned.ok) return null;

    const products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const product = products.find(
      (p) => p.slug === slug && p.status === "active",
    );
    if (!product) return null;

    const { variants, media } = await resolveProductFacts(ctx, product._id);
    const orderedMedia = [...media].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    // Related: same collection, exclude self, max 4
    const collectionIds: Id<"collections">[] = product.collectionIds ?? [];
    const related = products
      .filter(
        (p) =>
          p._id !== product._id &&
          p.status === "active" &&
          (p.collectionIds ?? []).some((c: Id<"collections">) =>
            collectionIds.includes(c),
          ),
      )
      .slice(0, 4);

    const relatedResolved = [];
    for (const p of related) {
      const { def, primary } = await resolveProductFacts(ctx, p._id);
      relatedResolved.push({
        productId: p._id,
        slug: p.slug ?? null,
        title: p.title,
        priceCents: def?.priceCents ?? null,
        currency: def?.currency ?? "USD",
        availability: def?.availability ?? null,
        imageUrl: primary?.url ?? null,
        provider: p.provider ?? null,
      });
    }

    return {
      product: {
        productId: product._id,
        title: product.title,
        slug: product.slug ?? null,
        description: product.description ?? null,
        externalUrl: product.externalUrl ?? null,
        provider: product.provider ?? null,
        productType: product.productType ?? null,
        tags: product.tags ?? [],
        collectionIds,
      },
      variants: variants.map((v) => ({
        variantId: v._id,
        title: v.title ?? "Default",
        isDefault: v.isDefault,
        priceCents: v.priceCents ?? null,
        compareAtPriceCents: v.compareAtPriceCents ?? null,
        currency: v.currency,
        inventoryCount: v.inventoryCount ?? null,
        availability: v.availability ?? null,
        optionValues: v.optionValues ?? [],
      })),
      media: orderedMedia.map((m) => ({
        mediaId: m._id,
        url: m.url,
        alt: m.alt ?? null,
      })),
      related: relatedResolved,
    };
  },
});

/* ── Published CMS page at an arbitrary storefront path (§48, §49) ─────── */

export const getPublishedPage = moduleQuery("sell", {
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }, access) => {
    // A published CMS page belongs to Build, not Sell, so this read overrides
    // the file's module default with the capability it actually needs.
    const owned = await requireOwnedProject(ctx, projectId, access, "build.view");
    if (!owned.ok) return null;
    const site = owned.site;
    if (!site) return null;

    const clean = ("/" + path.replace(/^\/+|\/+$/g, "")).replace(/\/+/g, "/");

    // explicit redirect table first (§33)
    const redirects = await ctx.db
      .query("cmsRedirects")
      .withIndex("by_site_path", (q) =>
        q.eq("siteId", site._id).eq("fromPath", clean),
      )
      .collect();
    const redirect = redirects[0];
    if (redirect) return { kind: "redirect" as const, to: redirect.to };

    const page = await ctx.db
      .query("cmsPages")
      .withIndex("by_site_path", (q) =>
        q.eq("siteId", site._id).eq("fullPath", clean),
      )
      .first();
    if (!page || page.status !== "published" || !page.publishedRevisionId) {
      return { kind: "not_found" as const };
    }
    // Drafts can never leak: only the published pointer is read (§133.13).
    const revision = await ctx.db.get(page.publishedRevisionId);
    if (!revision) return { kind: "not_found" as const };
    return {
      kind: "page" as const,
      page: { title: page.title, fullPath: page.fullPath, seo: page.seo ?? null },
      document: revision.document,
    };
  },
});

/* ── Site header facts (name, theme) ───────────────────────────────────── */

export const getShopSite = moduleQuery("sell", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const owned = await requireOwnedProject(ctx, projectId, access);
    if (!owned.ok) return null;
    if (!owned.site) return null;
    const { name, theme, seoDefaults, status } = owned.site;
    return { name, theme: theme ?? null, seoDefaults: seoDefaults ?? null, status };
  },
});
