/* ── Pexels adapter (U5, CREATE-VIDEO-BLUEPRINT V4) ─────────────────────
 *
 * Pure request builders and response parsers. The host is fixed; nothing a
 * client or a provider sends can change where a request goes. The API key is
 * read by the caller from `process.env.PEXELS_API_KEY` on the server and only
 * ever placed in the Authorization header built here — never logged, never
 * returned, never stored.
 *
 * Provider text (alt, photographer name) is data, not instructions.
 */

export const PEXELS_API_ORIGIN = "https://api.pexels.com";
/** The only host a stock picture may be downloaded from. */
export const PEXELS_IMAGE_HOST = "images.pexels.com";

export type StockOrientation = "landscape" | "portrait" | "square";

export type StockHit = {
  provider: "pexels";
  externalId: string;
  width: number;
  height: number;
  alt?: string;
  thumbUrl: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
};

export type StockPhoto = StockHit & { downloadUrl: string };

export type PexelsFailure =
  | { status: "rate_limited"; resetAt: number }
  | { status: "unavailable" };

export type PexelsRequest = { url: string; headers: Record<string, string> };

const MAX_PER_PAGE = 30;

export function buildSearchRequest(
  apiKey: string,
  query: string,
  orientation: StockOrientation,
  perPage = 15,
): PexelsRequest {
  const url = new URL("/v1/search", PEXELS_API_ORIGIN);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("per_page", String(Math.max(1, Math.min(MAX_PER_PAGE, Math.floor(perPage)))));
  url.searchParams.set("page", "1");
  return { url: url.toString(), headers: { Authorization: apiKey } };
}

/** Pexels photo ids are positive integers; anything else is refused before a
 *  request is built, so an id cannot smuggle a path or query. */
export function isPexelsId(externalId: string): boolean {
  return /^[1-9]\d{0,15}$/.test(externalId);
}

export function buildPhotoRequest(apiKey: string, externalId: string): PexelsRequest {
  if (!isPexelsId(externalId)) throw new Error("Invalid stock photo id");
  const url = new URL(`/v1/photos/${externalId}`, PEXELS_API_ORIGIN);
  return { url: url.toString(), headers: { Authorization: apiKey } };
}

type Headerish = { get(name: string): string | null };

/** 429, or an exhausted hourly budget, is `rate_limited` with the reset time
 *  in milliseconds. Without a usable reset header, assume one hour. */
export function rateLimitFrom(status: number, headers: Headerish, now: number): PexelsFailure | null {
  const remaining = headers.get("x-ratelimit-remaining");
  const exhausted = remaining !== null && remaining.trim() !== "" && Number(remaining) <= 0;
  if (status !== 429 && !exhausted) return null;
  const resetSeconds = Number(headers.get("x-ratelimit-reset"));
  const resetAt = Number.isFinite(resetSeconds) && resetSeconds > 0 ? resetSeconds * 1000 : now + 60 * 60_000;
  return { status: "rate_limited", resetAt };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Parse one photo object; null when a required field is missing. */
export function parsePhoto(raw: unknown): StockPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const photo = raw as Record<string, unknown>;
  const id = typeof photo.id === "number" || typeof photo.id === "string" ? String(photo.id) : "";
  if (!isPexelsId(id)) return null;
  const src = photo.src && typeof photo.src === "object" ? (photo.src as Record<string, unknown>) : {};
  const width = num(photo.width);
  const height = num(photo.height);
  const thumbUrl = httpsUrl(src.medium);
  const downloadUrl = httpsUrl(src.large);
  const photographer = str(photo.photographer)?.trim();
  const photographerUrl = httpsUrl(photo.photographer_url);
  const pageUrl = httpsUrl(photo.url);
  if (
    width === undefined || height === undefined || !thumbUrl || !downloadUrl ||
    !photographer || !photographerUrl || !pageUrl
  ) {
    return null;
  }
  const alt = str(photo.alt)?.trim().slice(0, 300);
  return {
    provider: "pexels",
    externalId: id,
    width,
    height,
    ...(alt ? { alt } : {}),
    thumbUrl,
    photographer: photographer.slice(0, 200),
    photographerUrl,
    pageUrl,
    downloadUrl,
  };
}

export function toHit(photo: StockPhoto): StockHit {
  return {
    provider: photo.provider,
    externalId: photo.externalId,
    width: photo.width,
    height: photo.height,
    ...(photo.alt ? { alt: photo.alt } : {}),
    thumbUrl: photo.thumbUrl,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
    pageUrl: photo.pageUrl,
  };
}

/** Parse a `/v1/search` body into cache-shaped hits (invalid items skipped). */
export function parseSearchResults(raw: unknown): StockHit[] {
  if (!raw || typeof raw !== "object") return [];
  const photos = (raw as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  const hits: StockHit[] = [];
  for (const item of photos.slice(0, MAX_PER_PAGE)) {
    const photo = parsePhoto(item);
    if (photo) hits.push(toHit(photo));
  }
  return hits;
}

/** Cache key normalization: trim, lower case, collapse spaces, max 100. */
export function normalizeStockQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100).trim();
}

export function stockCacheKey(orientation: StockOrientation, normalizedQuery: string): string {
  return `pexels:${orientation}:${normalizedQuery}`;
}
