/* ── Site path normalization (shared by every Build write path) ────────────
 *
 * One normalizer for CMS page paths, used by the AI site generator
 * (`buildChat.generateSite`), page materialization
 * (`buildInternals.ensureSiteWithPages`) and chat-edit targeting
 * (`buildChat.editPage`). Before this module each caller normalized on its own:
 * the generator kept `/` while materialization turned it into `-`, so a planned
 * `/services/web-design` was created as `/services-web-design`, the lookup
 * missed and the page stayed empty (build backend review C3).
 *
 * Rules, per segment: lower-case, every run of characters outside `[a-z0-9]`
 * becomes one `-`, leading/trailing `-` dropped, at most 80 characters (the
 * same slug policy as `cms.ts` `normalizeSlug`). Empty segments disappear, so
 * `//about/` and `/about/` both become `/about`. At most `MAX_SITE_PATH_DEPTH`
 * segments are kept (the CMS page tree depth limit). Pure; no Convex imports.
 */

export const MAX_SITE_PATH_DEPTH = 5;
const MAX_SEGMENT_LENGTH = 80;

export function normalizeSlugSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Normalize a page path. `fallbackName` is used when `raw` is missing or
 * blank (the generator falls back to the page name). The homepage is `/`.
 */
export function normalizeSitePath(raw: string | undefined | null, fallbackName?: string): string {
  const source =
    typeof raw === "string" && raw.trim() !== "" ? raw : (fallbackName ?? "");
  const segments = source
    .split("/")
    .map(normalizeSlugSegment)
    .filter((segment) => segment !== "")
    .slice(0, MAX_SITE_PATH_DEPTH);
  return segments.length ? `/${segments.join("/")}` : "/";
}

/** The page's own slug: the last path segment, or `home` for `/`. */
export function slugForSitePath(fullPath: string): string {
  if (fullPath === "/") return "home";
  const segments = fullPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "home";
}

/** The parent path of a normalized path (`/a/b` → `/a`, `/a` → `/`). */
export function parentSitePath(fullPath: string): string | null {
  if (fullPath === "/") return null;
  const segments = fullPath.split("/").filter(Boolean);
  return segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
}
