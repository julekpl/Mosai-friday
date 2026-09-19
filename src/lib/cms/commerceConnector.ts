/**
 * MOSAI commerce connector surface (W5) — see CMS-CONNECTOR-CONTRACT.md.
 *
 * Normalized model + Shopify Storefront API mapping derived from
 * svelte-commerce's @misiki/shopify-connector (MIT — see
 * THIRD_PARTY_NOTICES.md). This file is transport-agnostic so Convex actions
 * ("use node") and future runtimes can share it.
 */

export type NormalizedProduct = {
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

export type NormalizedCollection = {
  externalId: string;
  title: string;
  handle: string;
  description?: string;
};

export type ShopifyConfig = {
  storeDomain: string; // e.g. "my-store.myshopify.com" (no protocol)
  accessToken: string;
  apiVersion?: string;
};

/** Provider capabilities — rendered honestly in the UI, never asserted. */
export const SHOPIFY_READ_CAPABILITIES = {
  browse: true,
  priceVariants: true,
  availability: true,
  cartCheckout: false, // W6: checkout handoff URLs
  ordersRefunds: false,
} as const;

export function shopifyEndpoint(cfg: ShopifyConfig): string {
  const domain = cfg.storeDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}/api/${cfg.apiVersion ?? "2025-01"}/graphql.json`;
}

export async function shopifyGraphQL(
  cfg: ShopifyConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(shopifyEndpoint(cfg), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": cfg.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify API error ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    data?: Record<string, unknown>;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify returned no data");
  return json.data;
}

/* ── Queries (ported from @misiki/shopify-connector usage of the SF API) ── */

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($first: Int!, $cursor: String) {
    products(first: $first, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        description
        vendor
        productType
        tags
        onlineStoreUrl
        featuredImage { url altText }
        images(first: 8) { nodes { url altText } }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            availableForSale
            quantityAvailable
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query Collections($first: Int!, $cursor: String) {
    collections(first: $first, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        description
      }
    }
  }
`;

/* ── Transformers: provider payload → MOSAI normalized model ───────────── */

type ShopifyMoney = { amount: string; currencyCode: string } | null;

type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: ShopifyMoney;
  compareAtPrice: ShopifyMoney | null;
};

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  onlineStoreUrl: string | null;
  featuredImage: { url: string; altText: string | null } | null;
  images: { nodes: { url: string; altText: string | null }[] };
  variants: { nodes: ShopifyVariantNode[] };
};

type ShopifyCollectionNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
};

function moneyToCents(m: ShopifyMoney): number | null {
  if (!m) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function normalizeShopifyProduct(n: ShopifyProductNode): NormalizedProduct {
  const variants = n.variants.nodes.map((v, i) => {
    // Shopify treats the variant titled "Default Title" as the implicit
    // default — hide it in ordinary UX (M1 media/variant model).
    const isDefault = v.title === "Default Title" || n.variants.nodes.length === 1;
    return {
      externalId: v.id,
      title: v.title === "Default Title" ? undefined : v.title,
      sku: v.sku ?? undefined,
      priceCents: moneyToCents(v.price),
      compareAtPriceCents: moneyToCents(v.compareAtPrice),
      currency: v.price?.currencyCode ?? "USD",
      available: v.availableForSale,
      quantity: v.quantityAvailable,
      isDefault,
      position: i,
    };
  });
  const images = n.images.nodes.length
    ? n.images.nodes
    : n.featuredImage
      ? [n.featuredImage]
      : [];
  return {
    externalId: n.id,
    title: n.title,
    handle: n.handle,
    description: n.description || undefined,
    vendor: n.vendor ?? undefined,
    productType: n.productType ?? undefined,
    tags: n.tags ?? [],
    onlineStoreUrl: n.onlineStoreUrl ?? undefined,
    variants,
    media: images.map((img, i) => ({
      url: img.url,
      alt: img.altText ?? undefined,
      position: i,
    })),
  };
}

export function normalizeShopifyCollection(
  n: ShopifyCollectionNode,
): NormalizedCollection {
  return {
    externalId: n.id,
    title: n.title,
    handle: n.handle,
    description: n.description || undefined,
  };
}

/** Page through the full product catalog. */
export async function fetchAllShopifyProducts(
  cfg: ShopifyConfig,
  pageSize = 50,
  maxPages = 10,
): Promise<NormalizedProduct[]> {
  const out: NormalizedProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await shopifyGraphQL(cfg, PRODUCTS_QUERY, {
      first: pageSize,
      cursor,
    });
    const conn = (data as { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProductNode[] } })
      .products;
    out.push(...conn.nodes.map(normalizeShopifyProduct));
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

export async function fetchAllShopifyCollections(
  cfg: ShopifyConfig,
  pageSize = 50,
  maxPages = 5,
): Promise<NormalizedCollection[]> {
  const out: NormalizedCollection[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await shopifyGraphQL(cfg, COLLECTIONS_QUERY, {
      first: pageSize,
      cursor,
    });
    const conn = (data as { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyCollectionNode[] } })
      .collections;
    out.push(...conn.nodes.map(normalizeShopifyCollection));
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

export type { ShopifyProductNode, ShopifyCollectionNode };
