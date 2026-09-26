import type { BusinessListing, BusinessSuggestion } from "@/components/app/wizard/types";

/**
 * LQ-1b: a Google listing costs two paid SerpApi calls, the search and then
 * the details lookup. The search answer already carries the listing's
 * details when Google has them, so a picked suggestion that has what the
 * summary needs (an address, a category and a way to reach the business)
 * becomes the listing directly and the details call is skipped. Anything
 * thinner still gets the details call.
 *
 * Only a suggestion the owner picked is ever passed here. Pure on purpose,
 * so it is unit-tested without a network.
 */
export function listingFromSuggestion(suggestion: BusinessSuggestion): BusinessListing | null {
  const reachable = Boolean(suggestion.phone || suggestion.website);
  if (!suggestion.address || !suggestion.category || !reachable) return null;
  return {
    title: suggestion.title,
    address: suggestion.address,
    phone: suggestion.phone,
    website: suggestion.website,
    rating: suggestion.rating,
    reviews: suggestion.reviews,
    category: suggestion.category,
    openHours: suggestion.openHours,
  };
}
