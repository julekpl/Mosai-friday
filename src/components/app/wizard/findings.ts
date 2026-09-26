import type { BusinessListing, FoundDetails } from "@/components/app/wizard/types";

/** The parts of a website scan the summary reads (a subset of ScanResult). */
export type ScanDetails = {
  businessDetails?: { name?: string; address?: string; phone?: string; email?: string };
  productsServices?: string[];
  socialChannels?: string[];
};

function text(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

/**
 * Merge what the scan and the listing returned into one list for "Here's what
 * we found". Truth rule: a field is present only when a source returned it;
 * blanks are dropped, nothing is guessed or filled in.
 */
export function foundDetails(scan: ScanDetails | null, listing: BusinessListing | null): FoundDetails {
  const out: FoundDetails = {};
  const put = <K extends keyof FoundDetails>(key: K, value: FoundDetails[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  const business = scan?.businessDetails;
  put("name", text(business?.name) ?? text(listing?.title));
  put("category", text(listing?.category));
  put("address", text(business?.address) ?? text(listing?.address));
  put("phone", text(business?.phone) ?? text(listing?.phone));
  put("email", text(business?.email));
  put("website", text(listing?.website));
  put("openHours", text(listing?.openHours));
  if (typeof listing?.rating === "number") put("rating", listing.rating);
  if (typeof listing?.reviews === "number") put("reviews", listing.reviews);
  const products = (scan?.productsServices ?? []).map((item) => item.trim()).filter(Boolean);
  if (products.length) put("productsServices", products.slice(0, 6));
  const social = (scan?.socialChannels ?? []).map((item) => item.trim()).filter(Boolean);
  if (social.length) put("socialChannels", social.slice(0, 6));
  return out;
}

export function hasFoundDetails(details: FoundDetails): boolean {
  return Object.keys(details).length > 0;
}
