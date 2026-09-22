import { Hono } from "hono";
import { serveStatic } from "hono/deno";

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

const app = new Hono();

// CSP (+ nosniff) on every response this server sends (pack T0.7).
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
