/**
 * Public customer-website proxy (owner decision, 24 Sep 2026: "option B for
 * MVP"). See docs/decisions/2026-09-24-hosting-public-sites.md and the dated
 * exception to AGENTS.md rule 9.
 *
 * `main.ts` (Hono on Deno) routes `GET|HEAD /s/<slug>-website/<page>` here.
 * The request is forwarded to the Convex HTTP route
 * `${CONVEX_SITE_URL}/public-site/<slug>-website/<page>`, which returns the
 * finished, server-rendered HTML. Because these pages live on the dashboard
 * origin until the move to a separate registrable domain (option A), every
 * response is locked down:
 *
 * - only GET/HEAD, no request body and NO request headers are forwarded
 *   (never cookies, `Authorization`, or anything else the browser sent);
 * - only status, body and a small allow-list of response headers come back
 *   (never `Set-Cookie`);
 * - the app CSP is REPLACED by a policy with no script source at all, so a
 *   page served here cannot run JavaScript on the app origin.
 *
 * Pure and dependency-free so it runs under Deno and in Vitest alike.
 */

/** Strict CSP for public pages: no script, no connections, no frames, no forms. */
export const PUBLIC_SITE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src https: data:",
  "font-src https: data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers every /s/* response carries, replacing the app's. */
export const PUBLIC_SITE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": PUBLIC_SITE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

export const PUBLIC_SITE_TIMEOUT_MS = 10_000;

/** Upstream response headers passed through (lower-case). Everything else,
 *  including `set-cookie`, is dropped. */
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "content-language",
] as const;

/** The website segment: `<slug>-website`, lower-case, URL-safe. Apps are not
 *  public yet, so only `-website` segments are proxied. */
const SITE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,98}-website$/;
/** Any later path segment: unreserved URL characters only (no `%`, so no
 *  encoded traversal or encoded slashes can sneak through). */
const PAGE_SEGMENT = /^[A-Za-z0-9._~-]{1,200}$/;
const MAX_PATH_LENGTH = 1024;

/** True for any path the public-site proxy owns. Such a path must never fall
 *  through to the SPA (index.html) or pick up the app CSP. */
export function isPublicSitePath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/");
}

/**
 * Validate a request pathname and map it to the upstream Convex path:
 * `/s/acme-website/about` → `/public-site/acme-website/about`.
 * Returns null for anything that is not a well-formed website path.
 */
export function publicSiteUpstreamPath(pathname: string): string | null {
  if (!pathname.startsWith("/s/") || pathname.length > MAX_PATH_LENGTH) {
    return null;
  }
  const rest = pathname.slice("/s/".length);
  // One trailing slash is allowed (`/s/acme-website/`); empty inner segments
  // (`//`) are not.
  const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
  if (!trimmed) return null;
  const [site, ...pages] = trimmed.split("/");
  if (!SITE_SEGMENT.test(site)) return null;
  for (const segment of pages) {
    if (!PAGE_SEGMENT.test(segment) || segment.includes("..") || segment === ".") {
      return null;
    }
  }
  return `/public-site/${rest}`;
}

/**
 * The Convex HTTP-actions origin. `CONVEX_SITE_URL` wins; otherwise it is
 * derived from `VITE_CONVEX_URL` (`https://x.convex.cloud` →
 * `https://x.convex.site`). Returns null when neither yields an https origin.
 */
export function resolveConvexSiteUrl(env: {
  CONVEX_SITE_URL?: string | null;
  VITE_CONVEX_URL?: string | null;
}): string | null {
  const explicit = env.CONVEX_SITE_URL?.trim();
  if (explicit) return httpsOrigin(explicit);
  const cloud = env.VITE_CONVEX_URL?.trim();
  if (!cloud) return null;
  const origin = httpsOrigin(cloud);
  if (!origin) return null;
  const url = new URL(origin);
  if (!url.hostname.endsWith(".convex.cloud")) return null;
  url.hostname = `${url.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
  return url.origin;
}

function httpsOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The request the proxy sends upstream: the method only. No browser headers,
 *  no body, no credentials, and redirects are not followed. */
export function upstreamRequestInit(
  method: "GET" | "HEAD",
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: { Accept: "text/html" },
    redirect: "manual",
    credentials: "omit",
    signal,
  };
}

/** Response headers for a proxied page: the allow-listed upstream headers plus
 *  the public-site security headers, which always win. */
export function publicSiteResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) headers.set(name, value);
  }
  // An upstream redirect may only point at another public-site path.
  const location = upstream.get("location");
  if (location !== null && publicSiteUpstreamPath(location.split(/[?#]/)[0])) {
    headers.set("location", location);
  }
  for (const [name, value] of Object.entries(PUBLIC_SITE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

/** A small plain HTML error page carrying the public-site headers. */
export function publicSiteErrorResponse(
  status: number,
  message: string,
  method = "GET",
): Response {
  const headers = new Headers(PUBLIC_SITE_SECURITY_HEADERS);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (status === 405) headers.set("allow", "GET, HEAD");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${status}</title></head><body><p>${escapeHtml(message)}</p></body></html>`;
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const UPSTREAM_FAILED = "This site could not be loaded right now. Please try again shortly.";

export type ProxyOptions = {
  /** Convex HTTP-actions origin (see `resolveConvexSiteUrl`). */
  siteBaseUrl: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Handle one /s/* request end to end. Never throws. */
export async function proxyPublicSite(
  request: Request,
  options: ProxyOptions,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return publicSiteErrorResponse(405, "Method not allowed.", method);
  }
  const upstreamPath = publicSiteUpstreamPath(new URL(request.url).pathname);
  if (!upstreamPath) {
    return publicSiteErrorResponse(404, "Page not found.", method);
  }
  if (!options.siteBaseUrl) {
    return publicSiteErrorResponse(
      503,
      "Public sites are not configured on this server yet.",
      method,
    );
  }
  const doFetch = options.fetchImpl ?? fetch;
  let upstream: Response;
  try {
    upstream = await doFetch(
      `${options.siteBaseUrl}${upstreamPath}`,
      upstreamRequestInit(
        method,
        AbortSignal.timeout(options.timeoutMs ?? PUBLIC_SITE_TIMEOUT_MS),
      ),
    );
  } catch {
    return publicSiteErrorResponse(502, UPSTREAM_FAILED, method);
  }
  if (upstream.status >= 500) {
    await upstream.body?.cancel().catch(() => undefined);
    return publicSiteErrorResponse(502, UPSTREAM_FAILED, method);
  }
  const noBody =
    method === "HEAD" || upstream.status === 204 || upstream.status === 304;
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    headers: publicSiteResponseHeaders(upstream.headers),
  });
}
