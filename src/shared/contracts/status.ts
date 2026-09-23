/**
 * Status contract (MOSAI blueprint §5 BP-03, T2.13 precursor) — the browser-
 * safe vocabulary for every workflow state the product shows.
 *
 * The product promise is truth (AGENTS.md rule 5): the states `connected`,
 * `published`, `live`, `sent`, `paid`, `succeeded` may only be written by
 * server code holding a provider receipt or a verified webhook. Everything
 * else is a *preparation*, a *local* claim or an *unverified* legacy value.
 *
 * This module is deliberately dependency-free and importable from both the
 * Convex backend (validators, serializers) and React components. Server
 * implementations live in `src/convex/**`; this file only classifies and
 * labels. UI renders states through `StatusBadge` / `ReceiptBadge`
 * (`src/components/app/module-kit.tsx` / `ReceiptBadge.tsx`).
 */

/* ── The four delivery phases (BP-03) ──────────────────────────────────────
 *
 * Draft approval (draft_approved) → release preparation (release_prepared) →
 * deployment progress (deploying, BP-13) → externally verified delivery
 * (verified, receipt required). Nothing may skip to `verified`.
 */

export const DELIVERY_LABELS = [
  "draft_approved",
  "release_prepared",
  "deploying",
  "verified",
  // honest non-delivery states
  "content_changed",
  "requires_verification",
  "deployment_missing",
  "unavailable",
] as const;

export type DeliveryLabel = (typeof DELIVERY_LABELS)[number];

/** Legacy statuses remain readable during migration (BP-03) but are
 *  classified, never promoted to verified by this contract alone. */
export const LEGACY_DELIVERY_LABELS = [
  "published",
  "live",
  "sent",
  "paid",
  "running",
] as const;

export type LegacyDeliveryLabel = (typeof LEGACY_DELIVERY_LABELS)[number];

/** A stored provider receipt / verification record reference. Without one,
 *  a delivery view is never `verified`. */
export type DeliveryReceiptRef = {
  /** Table + row of the stored receipt or verification record. */
  table: string;
  id: string;
  /** Safe provider-side reference string (never a token or secret). */
  providerRef?: string;
};

export type DeliveryView = {
  label: DeliveryLabel | LegacyDeliveryLabel;
  /** True only when a stored receipt/verification record exists for the
   *  exact revision/resource the view describes. */
  verified: boolean;
  /** Present only when `verified` is true. */
  receipt?: DeliveryReceiptRef;
  /** Safe, redacted reason for the current label (no provider bodies). */
  reason?: string;
  /** Legacy row that has never been verified against the outside world. */
  legacy?: boolean;
};

/* ── Readiness (rule version pinning) ──────────────────────────────────────
 *
 * Readiness claims (SEO/WCAG audits) come from an audit record pinned to the
 * content revision and the rule version that produced them. Any content
 * change, or a rule-version bump, invalidates the claim. A client can never
 * set `seoReady`/`wcagReady` booleans: only an audit row written by server
 * code can mark a revision ready.
 */

/** Bump when the audit rules change meaningfully; existing audits for older
 *  versions stop counting as verified. */
export const READINESS_RULE_VERSION = 1;

/**
 * Deterministic, key-order-insensitive serialization used to pin content in a
 * readiness/release audit. The audit writer (`publishSite`) and the reader
 * (`builds.getReadiness`) must both go through this function so a pin can
 * never disagree with itself over object key order. An in-place edit of a
 * draft document changes its fingerprint and invalidates the audit.
 */
export function contentFingerprint(doc: unknown): string {
  return stableStringify(doc);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") {
    // JSON.stringify(undefined) is undefined — normalize to null so the
    // return type stays string (documents never contain top-level undefined).
    return JSON.stringify(v) ?? "null";
  }
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    "{" +
    entries
      .map(([k, val]) => JSON.stringify(k) + ":" + stableStringify(val))
      .join(",") +
    "}"
  );
}

/* ── Badge classification (single source for the UI) ─────────────────────── */

export type ReceiptTone = "verified" | "prepared" | "unverified" | "locked";

/** Map a delivery/legacy label to the badge tone. Only `verified` is green;
 *  prepared is blue; everything unverified is amber; unavailable is locked. */
export function receiptTone(label: string): ReceiptTone {
  switch (label) {
    case "verified":
      return "verified";
    case "release_prepared":
    case "deploying":
      return "prepared";
    case "unavailable":
      return "locked";
    case "draft_approved":
    case "content_changed":
    case "requires_verification":
    case "deployment_missing":
    // legacy values are readable but never verified by classification alone
    // (intentional grouping — every case below returns the same value)
    // eslint-disable-next-line no-fallthrough
    case "published":
    case "live":
    case "sent":
    case "paid":
    case "running":
      return "unverified";
    default:
      return "unverified";
  }
}

/** Local-tracked vs provider-tracked (campaigns; BP-03 "apply the same
 *  distinction to locally tracked campaigns and provider-running campaigns"). */
export type TrackingSource = "local" | "provider";
