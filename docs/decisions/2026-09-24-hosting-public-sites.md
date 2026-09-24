# Decision record: hosting for the dashboard and customer sites

**Status:** **accepted (owner, 24 Sep 2026): option B for MVP, option A later.** · **Date:** 24 Sep 2026

## Decision (accepted 24 Sep 2026)

- **Option B, MVP (now):** customer **websites** are served on the dashboard
  domain at `https://appmosai.com/s/<slug>-website/<page>`, with the slug taken
  from the project name. Apps are not public yet.
- **Option A, later:** everything public moves to a separate registrable domain
  (the "Recommendation" below). Option B is a deliberate, time-boxed exception
  to AGENTS.md rule 9, recorded in rule 9 itself.

**Conditions that make option B acceptable** (all enforced in code):

1. Pages are server-rendered static HTML with **no JavaScript**. The Convex HTTP
   route `GET <CONVEX_SITE_URL>/public-site/<slug>-website/<rest>` renders them.
2. `main.ts` sends every `/s/*` request to `server/publicSiteProxy.ts` before any
   static or SPA handler, so `/s/*` never gets `index.html` or the app CSP. The
   proxy:
   - accepts only `GET`/`HEAD` and `/s/<slug>-website(/<segment>)*` with a safe
     character set (no `%`, no `..`); anything else is 404 or 405;
   - forwards no browser headers (no cookies, no `Authorization`), no body and
     no query string; it does not follow redirects and times out after 10 s
     (502);
   - returns status, body and a small header allow-list, never `Set-Cookie`;
   - **replaces** the app CSP with `default-src 'none'; style-src 'unsafe-inline';
     img-src https: data:; font-src https: data:; base-uri 'none';
     form-action 'none'; frame-ancestors 'none'`, plus `nosniff`.
3. The dashboard shows "Live" only when `siteHosting:status` reports
   `state === "live"` (AGENTS.md rule 5).
4. No app, form handler or user-supplied script is ever served under `/s/*`.

**Server configuration:** `CONVEX_SITE_URL` (the deployment's `.convex.site`
origin). If it is unset, the proxy derives it from `VITE_CONVEX_URL`
(`.convex.cloud` → `.convex.site`); if neither is set, `/s/*` answers 503.

### Migration to option A (separate domain)

1. Buy the separate registrable domain (e.g. `mosai-sites.com`). Point it (or a
   Cloudflare Worker on it, as below) at the **same** Convex HTTP route
   `/public-site/<slug>-website/<rest>`. The rendering code does not change.
2. Set `MOSAI_PUBLIC_SITE_BASE` (e.g. `https://mosai-sites.com`) so the backend
   reports public addresses on the new domain in `siteHosting:status.path`/URL
   and in `deployWebsite` results.
3. In `main.ts`, answer `/s/*` with a **301** to the same path on the new domain
   instead of proxying. Keep the 301 for at least 12 months so links and search
   rankings carry over.
4. Once the 301 is live, remove the rule 9 exception from AGENTS.md. Only then
   may apps or any user script be published.
**Owner brief:** host cheaply or free for now, and move when we scale.
**Constraints:**
- AGENTS.md rule 9: public customer content is served from a separate registrable domain, never from the app origin.
- SEO/GEO needs real HTML (a server-rendered page or a prerendered snapshot), not an empty single-page-app shell.

## Before this decision (verified in code, 24 Sep 2026)

- `/shop/:projectId/*` is behind sign-in and lives on the dashboard origin.
- Published CMS pages are never served, because nothing writes a `buildDeployments` row.
- `main.ts` returns `index.html` for every path, so crawlers see an empty `<div id="root">`.

## Options compared

Cloudflare figures come from the `cloudflare/cloudflare-docs` source files. The other rows come from search summaries of their pricing pages, so re-check them before signing up.

| Platform | Free tier | Fit |
|---|---|---|
| Cloudflare Workers + static assets | 100k requests/day, 10 ms CPU. Paid $5/mo: 10M requests + 30M CPU-ms. Static asset requests are free | **Best fit.** Universal SSL covers `*.mosai-sites.com` |
| Cloudflare for SaaS (custom domains) | 100 custom hostnames included, then $0.10 each (up to 50k). Wildcard *customer* hostnames are Enterprise-only | Customer domains with automatic TLS |
| Workers for Platforms | $25/mo | Only if tenants ever run their own code. Not needed |
| Cloudflare Pages | 500 builds/month | Fine for the dashboard single-page app |
| Vercel Hobby | Non-commercial use only | **Not allowed** for MOSAI |
| Netlify Free | Hard credit cap; sites pause when it runs out | Risky for customer sites |
| Render Free | Sleeps after 15 min, ~1 min cold start | Bad for storefront SEO |
| Deno Deploy Free | 50 custom domains | Too few |
| Convex HTTP actions | 1M calls/month free, 20 MiB responses. Custom domains are paid and one at a time | Use as the **data origin**, not the public front end |

## Option A (later): target design on a separate domain

**Now (about $5–6/month plus domains):**
1. **Dashboard:** the single-page app on Cloudflare Workers static assets (or Pages) at `app.<brand>.<tld>`. Convex stays the backend.
2. **Customer sites:** a separate zone, e.g. `mosai-sites.com`, with a wildcard DNS record and one Worker on `*.mosai-sites.com/*`. The Worker resolves the tenant from the host name and serves a **prerendered HTML snapshot**:
   - Publishing in MOSAI renders the page on the server and stores the HTML.
   - The HTML lives in R2/KV, or is fetched from a Convex HTTP action and cached at the edge.
   - The publish flow writes the `buildDeployments` receipt only after the edge confirms the upload. This closes the "published but not live" gap (AGENTS.md rule 5).
   - Workers Paid ($5) is needed, because 10 ms of CPU on the free plan is too tight.
3. **Custom domains (later in v1):** Cloudflare for SaaS on the same zone. The first 100 are free.

**At scale:** roughly 1,000 custom domains and 50M requests/month comes to about $110/month plus Convex usage. That is the $5 plan, 900 extra hostnames, request overage and CPU time. There is no platform migration: the same design scales. Move to Enterprise only for apex proxying, wildcard customer hostnames or more than 50k hostnames.

## Decisions still open for option A

1. The brand domain for the dashboard, and a **separate** registrable domain for customer sites (to buy).
2. A Cloudflare account, and approval of Workers Paid at $5/month.
3. Whether custom domains are in v1, and on which plans.
