/**
 * Normalize any user-supplied website input into a canonical https:// origin.
 *
 * Accepts all common variations:
 *   wp.pl  www.wp.pl  https://wp.pl  http://www.wp.pl  https://www.wp.pl/
 *   https://www.wp.pl/some/path?query=1  WP.PL  blog.wp.pl:8080
 *
 * Returns null when the input can't be interpreted as a website at all.
 */
export function normalizeWebsiteUrl(raw: string): string | null {
  let input = raw.trim();
  if (!input) return null;

  // Strip obvious junk the user may paste (copy buttons, quotes, angle brackets)
  input = input.replace(/[<>"'`]/g, "").replace(/\/+$/, "");

  // If there's no scheme, assume https:// — this covers `wp.pl` and `www.wp.pl`
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    input = `https://${input}`;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  // Must be http(s)
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // Must have a hostname with at least one dot (not just "localhost")
  const host = url.hostname.toLowerCase();
  if (!host || !host.includes(".")) return null;
  if (/\s/.test(host)) return null;

  // Canonical form: https + host + optional non-root pathname (no search/hash)
  const path = url.pathname && url.pathname !== "/" ? url.pathname : "";
  return `https://${host}${path}`;
}

/** Extract just the registrable-looking domain for display, e.g. "wp.pl". */
export function displayDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
  }
}

/**
 * Heuristic: is this competitor entry a website URL or a business name
 * (e.g. a Google Maps listing)? Used to label competitor chips.
 */
export function looksLikeUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/\s/.test(s)) return false; // business names contain spaces
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return true; // has scheme
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(s); // domain-ish, e.g. wp.pl
}
