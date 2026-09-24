/**
 * Canonical, privacy-minimal measurement event contract.
 *
 * Optional destinations stay disabled until a provider integration is
 * explicitly configured. Consent alone never enables a network request.
 */
export const CANONICAL_EVENT_TYPES = [
  "page_view",
  "lead",
  "content_interaction",
  "cart",
  "checkout",
  "purchase",
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];
export type BrowserEventType = Exclude<CanonicalEventType, "purchase">;

export type ConsentSnapshot = {
  analytics: boolean;
  advertising: boolean;
};

export type CanonicalEventProperties = {
  surface?: "site" | "storefront" | "app";
  contentType?: "page" | "article" | "product" | "form";
  itemCount?: number;
};

export type CanonicalEvent = {
  projectId: string;
  eventId: string;
  type: CanonicalEventType;
  occurredAt: number;
  consent: ConsentSnapshot;
  properties: CanonicalEventProperties;
};

export const DENIED_BY_DEFAULT_CONSENT: ConsentSnapshot = Object.freeze({
  analytics: false,
  advertising: false,
});

/** Missing or malformed consent is treated as denied for every optional use. */
export function normalizeConsentSnapshot(
  value: Partial<ConsentSnapshot> | null | undefined,
): ConsentSnapshot {
  return {
    analytics: value?.analytics === true,
    advertising: value?.advertising === true,
  };
}

export function isValidEventId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isValidEventTime(value: number, now = Date.now()): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= now + 5 * 60_000;
}
