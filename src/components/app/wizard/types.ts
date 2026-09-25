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
export type BusinessSearchState = "idle" | "loading" | "results" | "empty" | "error";
