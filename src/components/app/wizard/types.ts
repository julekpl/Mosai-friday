/** Shared shapes for the new-project wizard. */

export type BusinessListing = {
  title?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  openHours?: string;
};
export type BusinessSuggestion = {
  placeId: string;
  title: string;
  address?: string;
  category?: string;
  rating?: number;
  reviews?: number;
};
export type BusinessSearchState = "idle" | "loading" | "results" | "empty" | "error" | "resting";

/** What the Q2 source produced once read in the background. */
export type SourceFindingsStatus =
  /** Nothing to read: no website and no picked listing. */
  | { status: "none" }
  /** A read is still in flight. */
  | { status: "running"; kind: "website" | "listing" }
  /** The read ended; `failed` means nothing came back. */
  | {
      status: "done";
      kind: "website" | "listing";
      failed: boolean;
      /** Business search was paused by a spending limit (LQ-1), so the
       *  listing was not read; not the owner's fault and not an error. */
      resting?: boolean;
      partial: boolean;
      details: FoundDetails;
    };

/** Only what the scan or the listing actually returned (never invented). */
export type FoundDetails = {
  name?: string;
  category?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  openHours?: string;
  rating?: number;
  reviews?: number;
  productsServices?: string[];
  socialChannels?: string[];
};
