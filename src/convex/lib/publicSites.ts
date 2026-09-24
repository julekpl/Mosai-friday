/* ── MOSAI self-hosted public sites: slugs, URL segments, base URL ─────────
 *
 * Owner decision (24 Sep 2026): for the MVP a customer WEBSITE is served by
 * MOSAI itself at `<base>/s/<slug>-website/<page path>`, where `<slug>` is
 * derived once from the project name and never changes afterwards. Apps are
 * not served publicly yet (`-app` segments always 404).
 *
 * The public base is configurable so the sites can move to a separate
 * registrable domain later (AGENTS.md rule 9) without touching callers:
 * `MOSAI_PUBLIC_SITE_BASE` (default "" = same origin as the dashboard).
 * Pure module; no Convex imports.
 */

export type PublicSiteKind = "website" | "app";

export const MAX_PUBLIC_SLUG_LENGTH = 40;

/** Path prefix under the public base where sites live (`/s/<segment>`). */
export const PUBLIC_SITE_PATH_PREFIX = "/s";

/** Convex HTTP route prefix the `/s/*` proxy forwards to. */
export const PUBLIC_SITE_HTTP_PREFIX = "/public-site/";

/** Provider label written on self-hosted `buildDeployments` rows. */
export const SELF_HOST_PROVIDER = "mosai-self-host";

export const RESERVED_PUBLIC_SLUGS: ReadonlySet<string> = new Set([
  "s",
  "app",
  "apps",
  "admin",
  "api",
  "auth",
  "shop",
  "system",
  "www",
  "mosai",
  "billing",
  "new",
  "dashboard",
  "static",
  "assets",
  "public-site",
]);

const LIGATURES: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};

const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A slug this module would accept as a public site slug. */
export function isValidPublicSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug.length <= MAX_PUBLIC_SLUG_LENGTH &&
    SLUG_SHAPE.test(slug) &&
    !slug.includes("--") &&
    !isReservedPublicSlug(slug)
  );
}

export function isReservedPublicSlug(slug: string): boolean {
  return slug.startsWith("-") || RESERVED_PUBLIC_SLUGS.has(slug);
}

function trimToLength(slug: string, max: number): string {
  return slug.slice(0, max).replace(/-+$/g, "");
}

/**
 * The base slug for a project name: lower-case, diacritics stripped, only
 * `[a-z0-9-]`, dashes collapsed and trimmed, at most 40 characters. A
 * reserved or empty result falls back to a safe form (`admin` → `admin-site`,
 * `""` → `site`), so every project gets a usable slug.
 */
export function slugifyProjectName(name: string): string {
  const folded = name
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (ch) => LIGATURES[ch] ?? ch)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
  const slug = trimToLength(
    folded
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, ""),
    MAX_PUBLIC_SLUG_LENGTH,
  );
  if (!slug) return "site";
  if (isReservedPublicSlug(slug)) {
    return trimToLength(`${slug}-site`, MAX_PUBLIC_SLUG_LENGTH);
  }
  return slug;
}

/** The n-th candidate for a base slug: `base`, `base-2`, `base-3`, … (≤ 40). */
export function slugCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${trimToLength(base, MAX_PUBLIC_SLUG_LENGTH - suffix.length)}${suffix}`;
}

/** URL segment for a site: `<slug>-website` / `<slug>-app`. */
export function publicSiteSegment(slug: string, kind: PublicSiteKind): string {
  return `${slug}-${kind}`;
}

/** Parse a URL segment back into slug + kind; null when it is neither. */
export function parsePublicSiteSegment(
  segment: string,
): { slug: string; kind: PublicSiteKind } | null {
  for (const kind of ["website", "app"] as const) {
    const suffix = `-${kind}`;
    if (segment.endsWith(suffix)) {
      const slug = segment.slice(0, -suffix.length);
      return isValidPublicSlug(slug) ? { slug, kind } : null;
    }
  }
  return null;
}

/**
 * The configured public base (scheme + host, optionally a path), without a
 * trailing slash. "" means the dashboard's own origin. Only `https://` bases
 * are honoured; anything else is ignored (same origin). The value is never
 * logged or echoed in errors.
 */
export function publicSiteBase(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/g, "");
  if (!value) return "";
  return /^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i.test(value) ? value : "";
}

/** Site-relative path prefix pages link through: `/s/<slug>-website`. */
export function publicSiteBasePath(
  slug: string,
  kind: PublicSiteKind = "website",
): string {
  return `${PUBLIC_SITE_PATH_PREFIX}/${publicSiteSegment(slug, kind)}`;
}

/** The public location shown to the owner: `<base>/s/<slug>-website`. */
export function publicSiteLocation(
  slug: string,
  base: string,
  kind: PublicSiteKind = "website",
): string {
  return `${base}${publicSiteBasePath(slug, kind)}`;
}
