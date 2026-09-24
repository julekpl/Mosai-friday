/**
 * Pure parsers for SerpApi's `google_maps` engine responses.
 *
 * Kept free of Convex/Node imports so the parsing rules are unit-testable
 * without a network. Behaviour follows SerpApi's documented shapes:
 *
 *  - a list search returns `local_results`, but a query that Google resolves to
 *    one exact place returns `place_results` instead (single object);
 *  - "no results" is a 200 response carrying
 *    `error: "Google hasn't returned any results for this query."` and
 *    `search_information.local_results_state: "Fully empty"` — that is an empty
 *    answer, not an outage;
 *  - `operating_hours` is a `{ day: hours }` map, while place results carry
 *    `hours` as an array of single-key objects.
 */

export type GoogleMapsSuggestion = {
  placeId: string;
  title: string;
  address?: string;
  category?: string;
  rating?: number;
  reviews?: number;
};

export type GoogleMapsPlace = {
  title: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  openHours?: string;
  latitude?: number;
  longitude?: number;
};

type Hit = Record<string, unknown>;

export type GoogleMapsResponse = {
  local_results?: unknown;
  place_results?: unknown;
  error?: unknown;
  search_information?: { local_results_state?: unknown } | null;
};

const MAX_SUGGESTIONS = 5;

function isHit(value: unknown): value is Hit {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function category(hit: Hit): string | undefined {
  if (Array.isArray(hit.type)) return str(hit.type[0], 100);
  return str(hit.type, 100) ?? (Array.isArray(hit.types) ? str(hit.types[0], 100) : undefined);
}

function reviewCount(value: unknown): number | undefined {
  if (typeof value === "number") return num(value);
  if (isHit(value)) return num(value.original);
  return undefined;
}

/** True when SerpApi answered successfully but Google had nothing to show. */
export function isEmptyGoogleMapsAnswer(data: GoogleMapsResponse): boolean {
  const state = data.search_information?.local_results_state;
  if (typeof state === "string" && /fully empty/i.test(state)) return true;
  return typeof data.error === "string" && /hasn't returned any results/i.test(data.error);
}

/** Any other `error` is a real failure (bad key, quota, provider outage). */
export function googleMapsFailure(data: GoogleMapsResponse): boolean {
  return typeof data.error === "string" && !isEmptyGoogleMapsAnswer(data);
}

/** Candidates for the search-as-you-type picker (deduplicated, at most five). */
export function parseGoogleMapsSuggestions(data: GoogleMapsResponse): GoogleMapsSuggestion[] {
  const hits: unknown[] = Array.isArray(data.local_results)
    ? data.local_results
    : isHit(data.place_results)
      ? [data.place_results]
      : [];
  const seen = new Set<string>();
  const out: GoogleMapsSuggestion[] = [];
  for (const hit of hits) {
    if (!isHit(hit)) continue;
    const placeId = str(hit.place_id, 200);
    const title = str(hit.title, 200);
    if (!placeId || !title || seen.has(placeId)) continue;
    seen.add(placeId);
    out.push({
      placeId,
      title,
      address: str(hit.address, 300),
      category: category(hit),
      rating: num(hit.rating),
      reviews: reviewCount(hit.reviews),
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** "Monday: 9 AM–5 PM · Tuesday: …" from either documented hours shape. */
export function formatOpeningHours(hit: Hit): string | undefined {
  const parts: string[] = [];
  const push = (day: string, hours: unknown) => {
    const h = str(hours, 60);
    if (h) parts.push(`${day.charAt(0).toUpperCase()}${day.slice(1)}: ${h}`);
  };
  if (isHit(hit.operating_hours)) {
    for (const [day, hours] of Object.entries(hit.operating_hours)) push(day, hours);
  } else if (Array.isArray(hit.hours)) {
    for (const entry of hit.hours) {
      if (!isHit(entry)) continue;
      for (const [day, hours] of Object.entries(entry)) push(day, hours);
    }
  }
  return parts.length ? parts.slice(0, 7).join(" · ") : undefined;
}

/** The confirmed listing: a place result, or the first list result. */
export function parseGoogleMapsPlace(
  data: GoogleMapsResponse,
  fallbackTitle: string,
): GoogleMapsPlace | null {
  const hit = isHit(data.place_results)
    ? data.place_results
    : Array.isArray(data.local_results) && isHit(data.local_results[0])
      ? data.local_results[0]
      : null;
  if (!hit) return null;
  const gps = isHit(hit.gps_coordinates) ? hit.gps_coordinates : {};
  return {
    title: str(hit.title, 200) ?? fallbackTitle.slice(0, 200),
    address: str(hit.address, 300),
    phone: str(hit.phone, 60),
    website: str(hit.website, 500),
    rating: num(hit.rating),
    reviews: reviewCount(hit.reviews),
    category: category(hit),
    openHours: formatOpeningHours(hit),
    latitude: num(gps.latitude),
    longitude: num(gps.longitude),
  };
}
