import { looksLikeUrl, normalizeWebsiteUrl } from "@/lib/url";

/**
 * Q2's single "Your website or Google listing" field takes either a website or
 * a Google listing name (first-run blueprint §3). This decides which one the
 * owner typed:
 *
 * - `website`: it looks like a web address, so the server scan (which fetches
 *   through `safeFetch`) reads it. The URL is normalized to `https://host/path`.
 * - `listing`: anything else that is not blank is a business name, looked up
 *   through the existing Google listing search.
 * - `none`: blank, so nothing is read.
 *
 * Pure on purpose: no network, so it is unit-tested directly.
 */
export type SourceInput =
  | { kind: "none" }
  | { kind: "website"; url: string }
  | { kind: "listing"; query: string };

export function classifySource(raw: string): SourceInput {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { kind: "none" };
  if (looksLikeUrl(value)) {
    const url = normalizeWebsiteUrl(value);
    if (url) return { kind: "website", url };
  }
  return { kind: "listing", query: value };
}
