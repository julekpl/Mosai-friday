import type { Doc, Id } from "../_generated/dataModel";

/* ── M1 Readiness engine — deterministic, computed, never stored ──────────
 * Resolved per VARIANT, displayed per PRODUCT (product = worst variant).
 * Pure function over plain data so it is trivially testable and reusable
 * by both queries and the feed projection. AI never decides readiness —
 * it may only fix text fields the fixType marks as ai_safe.
 *
 * See M1-BLUEPRINT.md §6 and SELL-ARCHITECTURE.md §5. */

export type ProductRow = Doc<"products">;
export type VariantRow = Doc<"productVariants">;
export type MediaRow = Doc<"productMedia">;

export type FixType = "ai_safe" | "user_input" | "external_action";

export type ReadinessIssue = {
  /** which object failed — readiness is resolved variant-level */
  scope: "product" | "variant";
  objectId: Id<"products"> | Id<"productVariants">;
  /** variant title/name for UI attribution when scope = variant */
  variantLabel?: string;
  field: string;
  severity: "error" | "warning" | "info";
  fixType: FixType;
  /** human-readable: what happened / why it matters / what to do */
  message: string;
  /** identifierStatus context for the identifier check */
  identifierStatus?: "has_identifiers" | "no_identifiers_exist" | "unknown";
};

export type Recommendation = {
  field: string;
  message: string;
  fixType: FixType;
};

export type ReadinessResult = {
  /** blocked = any severity error; needs_attention = any warning; ready */
  state: "ready" | "needs_attention" | "blocked";
  issues: ReadinessIssue[];
  recommendations: Recommendation[];
};

/** Plain input shape (avoids coupling callers to raw Doc rows). */
export type ReadinessInput = {
  product: ProductRow;
  variants: VariantRow[];
  media: MediaRow[];
  websiteUrl?: string;
};

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  const recommendations: Recommendation[] = [];
  const { product, variants, media } = input;

  if (!product.title?.trim()) {
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "title",
      severity: "error",
      fixType: "user_input",
      message: "This product has no title. Add a name so it can be listed.",
    });
  }

  const primary = media.filter((m) => !m.variantId).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  )[0];

  if (!primary) {
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "image",
      severity: "error",
      fixType: "user_input",
      message:
        "No product image. Channels require at least one image — add one to reach Google.",
    });
  } else if (!primary.alt?.trim()) {
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "image_alt",
      severity: "warning",
      fixType: "ai_safe",
      message:
        "The product image has no alt text. MOSAI can suggest one from the product details.",
    });
  }

  if (!product.description || product.description.trim().length < 80) {
    // below 80 chars this is an ai_safe fill/improve candidate
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "description",
      severity: "warning",
      fixType: "ai_safe",
      message:
        "The description is missing or very short. MOSAI can suggest a stronger version.",
    });
  }

  if (input.websiteUrl && !product.slug?.trim()) {
    // slug is derived automatically on create; only a data problem if absent
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "slug",
      severity: "warning",
      fixType: "user_input",
      message: "Product has no URL slug — it cannot be linked from the feed.",
    });
  }

  if (variants.length === 0) {
    issues.push({
      scope: "product",
      objectId: product._id,
      field: "variant",
      severity: "error",
      fixType: "user_input",
      message: "This product has no variant. Add a purchasable option before it can be considered ready.",
    });
  }

  // ── Variant-level checks (normative: worst variant decides) ────────────
  for (const v of variants) {
    const vLabel =
      v.title ??
      (v.isDefault ? "Default" : undefined) ??
      v.optionValues?.map((o) => o.value).join(" / ");

    if (
      v.priceCents == null ||
      !Number.isSafeInteger(v.priceCents) ||
      v.priceCents < 0
    ) {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "price",
        severity: "error",
        fixType: "user_input",
        message: `${vLabel ? `${vLabel}: ` : ""}A valid nonnegative whole-number price in minor currency units is required. Channels cannot list a product without a price.`,
      });
    }

    if (
      v.inventoryCount != null &&
      (!Number.isSafeInteger(v.inventoryCount) || v.inventoryCount < 0)
    ) {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "inventory",
        severity: "error",
        fixType: "user_input",
        message: `${vLabel ? `${vLabel}: ` : ""}Inventory must be a nonnegative whole number, or left untracked.`,
      });
    }

    const validAvailability = [
      "in_stock",
      "out_of_stock",
      "backorder",
      "preorder",
    ].includes(v.availability ?? "");
    if (!validAvailability) {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "availability",
        severity: "error",
        fixType: "user_input",
        message: `${vLabel ? `${vLabel}: ` : ""}Availability is missing or invalid. Set whether it is in stock, out of stock, preorder or backorder.`,
      });
    } else if (
      (v.availability === "in_stock" && v.inventoryCount === 0) ||
      (v.availability === "out_of_stock" &&
        v.inventoryCount != null &&
        v.inventoryCount > 0)
    ) {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "availability",
        severity: "error",
        fixType: "user_input",
        message: `${vLabel ? `${vLabel}: ` : ""}Availability conflicts with the tracked inventory count. Correct one of the values.`,
      });
    } else if (
      (v.availability === "backorder" || v.availability === "preorder") &&
      v.availabilityDate == null
    ) {
      // backorder stays backorder — never remapped to in_stock
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "availability_date",
        severity: "error",
        fixType: "user_input",
        message: `${vLabel ? `${vLabel}: ` : ""}${v.availability === "backorder" ? "Backorder" : "Preorder"} needs an availability date for Google.`,
      });
    }

    // Honest identifier model — GTIN missing is never an error
    const idStatus =
      v.identifierStatus ??
      (v.gtin || v.sku ? "has_identifiers" : "unknown");
    if (idStatus === "unknown") {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "identifier",
        severity: "warning",
        fixType: "user_input",
        identifierStatus: "unknown",
        message: `${vLabel ? `${vLabel}: ` : ""}We don't know whether this product has a barcode/GTIN. Answering lets Google list it correctly.`,
      });
    } else if (idStatus === "has_identifiers" && !v.gtin && !v.sku) {
      issues.push({
        scope: "variant",
        objectId: v._id,
        variantLabel: vLabel,
        field: "identifier",
        severity: "warning",
        fixType: "user_input",
        identifierStatus: idStatus,
        message: `${vLabel ? `${vLabel}: ` : ""}Marked as having identifiers but none are filled in.`,
      });
    }
    // no_identifiers_exist → passes; feed emits identifier_exists=no
  }

  // ── Recommendations (advisory — never block) ───────────────────────────
  if (product.description && product.description.trim().length >= 80) {
    recommendations.push({
      field: "description",
      message: "Your description could answer your buyer's main objection more directly.",
      fixType: "ai_safe",
    });
  }
  if (!product.enrichment?.seoDescription) {
    recommendations.push({
      field: "seo",
      message: "No SEO description yet — MOSAI can suggest one.",
      fixType: "ai_safe",
    });
  }
  if ((media.filter((m) => !m.variantId).length ?? 0) < 2) {
    recommendations.push({
      field: "media",
      message: "One image only — more imagery builds buyer confidence.",
      fixType: "user_input",
    });
  }

  const state: ReadinessResult["state"] = issues.some(
    (i) => i.severity === "error",
  )
    ? "blocked"
    : issues.some((i) => i.severity === "warning")
      ? "needs_attention"
      : "ready";

  return { state, issues, recommendations };
}

/** Aggregate helper for the Feed tab: counts per state. */
export function summarize(
  results: Array<{ productId: Id<"products">; result: ReadinessResult }>,
) {
  return {
    ready: results.filter((r) => r.result.state === "ready").length,
    needsAttention: results.filter((r) => r.result.state === "needs_attention")
      .length,
    blocked: results.filter((r) => r.result.state === "blocked").length,
  };
}
