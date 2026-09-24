import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import {
  isPublicSitePath,
  proxyPublicSite,
  resolveConvexSiteUrl,
} from "./server/publicSiteProxy.ts";

/**
 * Content-Security-Policy for the built app (pack T0.7).
 *
 * This is the HTTP-header half of the policy: the header — unlike a `<meta>`
 * tag — can carry `frame-ancestors 'none'` and `script-src 'self'` (no inline
 * scripts). `index.html` ships the directives that are safe to enforce from a
 * meta tag in BOTH dev and build; the script restrictions deliberately live
 * only here, because the Vite dev server injects an inline React-refresh
 * preamble and the platform injects its own module scripts into index.html —
 * a meta `script-src` would blank the development preview.
 *
 * Keep in sync with the meta tag in `index.html`.
 *
 * Public customer websites under `/s/*` do NOT get this policy: they get the
 * stricter, script-free `PUBLIC_SITE_CSP` from `server/publicSiteProxy.ts`
 * (owner exception to AGENTS.md rule 9, 24 Sep 2026).
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site wss://*.convex.site",
  "frame-src 'none'",
  "worker-src 'self' blob:",
].join("; ");

/** Convex HTTP-actions origin that renders public sites (null → 503). */
const PUBLIC_SITE_BASE_URL = resolveConvexSiteUrl({
  CONVEX_SITE_URL: Deno.env.get("CONVEX_SITE_URL"),
  VITE_CONVEX_URL: Deno.env.get("VITE_CONVEX_URL"),
});

const app = new Hono();

// 0) Public customer websites. Handled first, and entirely by the proxy: it
//    sets its own strict CSP and never falls through to the SPA/index.html.
app.use("*", async (c, next) => {
  if (!isPublicSitePath(c.req.path)) return next();
  return proxyPublicSite(c.req.raw, { siteBaseUrl: PUBLIC_SITE_BASE_URL });
});

// CSP (+ nosniff) on every app response this server sends (pack T0.7). The
// public-site middleware above returns before reaching here, so /s/* keeps
// its own policy.
app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  c.header("X-Content-Type-Options", "nosniff");
});

// 1) Serve anything in /assets/**
app.use("/assets/*", serveStatic({ root: "./dist/assets" }));

// 2) Catch *all* other files in dist (CSS, JS, images, etc.)
app.use("*", serveStatic({ root: "./dist" }));

// 3) Fallback to index.html for the SPA
app.get("*", serveStatic({ path: "./dist/index.html" }));

Deno.serve(app.fetch);
