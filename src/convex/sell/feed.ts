import type { Id } from "../_generated/dataModel";
import {
  computeReadiness,
  type MediaRow,
  type ProductRow,
  type VariantRow,
} from "./readiness";

/* ── Google Merchant feed projection (M1-BLUEPRINT §7) ────────────────────
 * Feeds are PROJECTIONS, never canonical truth (SELL-ARCHITECTURE §5).
 * Deterministic — AI never decides technical compliance.
 *
 * M1 delivers a downloadable artifact; Merchant Center submission is M2+. */

export type FeedItem = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  image_link: string | null;
  availability: string;
  availability_date?: string;
  price: string;
  gtin?: string;
  mpn?: string;
  identifier_exists?: "no";
  item_group_id?: string;
  condition: "new";
  brand?: string;
  product_type?: string;
};

export type FeedIssue = {
  productId: Id<"products">;
  variantLabel?: string;
  field: string;
  message: string;
};

export type FeedProjection = {
  items: FeedItem[];
  issues: FeedIssue[];
  /** not_configured | needs_attention | ready — M1 stops at "ready" */
  state: "not_configured" | "needs_attention" | "ready";
};

function xmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildGoogleFeed(input: {
  products: Array<{
    product: ProductRow;
    variants: VariantRow[];
    media: MediaRow[];
  }>;
  websiteUrl?: string;
  businessName?: string;
}): FeedProjection {
  const items: FeedItem[] = [];
  const issues: FeedIssue[] = [];

  for (const { product, variants, media } of input.products) {
    if (product.status === "archived") continue; // archived: excluded, not silently broken

    const readiness = computeReadiness({
      product,
      variants,
      media,
      websiteUrl: input.websiteUrl,
    });
    for (const issue of readiness.issues) {
      if (issue.severity === "error" || issue.severity === "warning") {
        issues.push({
          productId: product._id,
          variantLabel: issue.variantLabel,
          field: issue.field,
          message: issue.message,
        });
      }
    }

    const primary = media
      .filter((m) => !m.variantId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    const hasExplicitVariants = variants.some((v) => !v.isDefault);
    const brand = product.brand ?? input.businessName;

    for (const v of variants) {
      const vLabel =
        v.title ??
        v.optionValues?.map((o) => o.value).join(" / ") ??
        undefined;

      const item: FeedItem = {
        // stable IDs: externalId when present (M2), composite otherwise
        id: v.externalId ?? `${product._id}_${v._id}`,
        title: hasExplicitVariants && vLabel
          ? `${product.title} ${vLabel}`.trim()
          : product.title,
        description: product.description ?? null,
        link: input.websiteUrl
          ? `${input.websiteUrl.replace(/\/$/, "")}/products/${product.slug ?? product._id}`
          : null,
        image_link: primary?.url ?? null,
        availability: v.availability ?? "out_of_stock",
        price:
          v.priceCents != null
            ? `${(v.priceCents / 100).toFixed(2)} ${v.currency}`
            : "",
        condition: "new",
      };

      if (
        (v.availability === "backorder" || v.availability === "preorder") &&
        v.availabilityDate
      ) {
        item.availability_date = new Date(v.availabilityDate).toISOString();
      }

      // Honest identifier handling — never fabricate
      const idStatus =
        v.identifierStatus ?? (v.gtin || v.sku ? "has_identifiers" : "unknown");
      if (v.gtin) item.gtin = v.gtin;
      if (v.sku) item.mpn = v.sku;
      if (idStatus === "no_identifiers_exist") {
        item.identifier_exists = "no";
      }

      if (hasExplicitVariants) {
        item.item_group_id = String(product._id);
      }
      if (brand) item.brand = brand;
      if (product.collectionIds?.length) {
        // product_type derived from collection titles at render time by caller;
        // M1 keeps titles out of the projection core
      }

      items.push(item);
    }
  }

  const state: FeedProjection["state"] =
    items.length === 0
      ? "not_configured"
      : issues.some((i) => i.field && issues.length > 0) &&
          items.every((i) => !i.link || !i.price)
        ? "needs_attention"
        : issues.length > 0
          ? "needs_attention"
          : "ready";

  return { items, issues, state };
}

/** Serialize the projection as a Google Merchant XML feed. */
export function feedToXml(projection: FeedProjection): string {
  const rows = projection.items
    .map((i) => {
      const parts: string[] = [
        `<g:id>${xmlEscape(i.id)}</g:id>`,
        `<g:title>${xmlEscape(i.title)}</g:title>`,
        `<g:description>${xmlEscape(i.description ?? "")}</g:description>`,
        i.link ? `<g:link>${xmlEscape(i.link)}</g:link>` : "",
        i.image_link
          ? `<g:image_link>${xmlEscape(i.image_link)}</g:image_link>`
          : "",
        `<g:availability>${xmlEscape(i.availability)}</g:availability>`,
        i.availability_date
          ? `<g:availability_date>${xmlEscape(i.availability_date)}</g:availability_date>`
          : "",
        `<g:price>${xmlEscape(i.price)}</g:price>`,
        i.gtin ? `<g:gtin>${xmlEscape(i.gtin)}</g:gtin>` : "",
        i.mpn ? `<g:mpn>${xmlEscape(i.mpn)}</g:mpn>` : "",
        i.identifier_exists
          ? `<g:identifier_exists>${i.identifier_exists}</g:identifier_exists>`
          : "",
        i.item_group_id
          ? `<g:item_group_id>${xmlEscape(i.item_group_id)}</g:item_group_id>`
          : "",
        `<g:condition>${i.condition}</g:condition>`,
        i.brand ? `<g:brand>${xmlEscape(i.brand)}</g:brand>` : "",
      ];
      return `    <item>\n${parts.filter(Boolean).join("\n")}\n    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>MOSAI catalog</title>
    <item_count>${projection.items.length}</item_count>
${rows}
  </channel>
</rss>`;
}
