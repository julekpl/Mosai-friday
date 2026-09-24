# Decision record (proposed): hosting for the dashboard and customer sites

**Status:** proposed, awaiting owner acceptance · **Date:** 24 Sep 2026
**Owner brief:** host cheaply or free for now, and move when we scale.
**Constraints:**
- AGENTS.md rule 9: public customer content is served from a separate registrable domain, never from the app origin.
- SEO/GEO needs real HTML (a server-rendered page or a prerendered snapshot), not an empty single-page-app shell.

## Today (verified in code)

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

## Recommendation

**Now (about $5–6/month plus domains):**
1. **Dashboard:** the single-page app on Cloudflare Workers static assets (or Pages) at `app.<brand>.<tld>`. Convex stays the backend.
2. **Customer sites:** a separate zone, e.g. `mosai-sites.com`, with a wildcard DNS record and one Worker on `*.mosai-sites.com/*`. The Worker resolves the tenant from the host name and serves a **prerendered HTML snapshot**:
   - Publishing in MOSAI renders the page on the server and stores the HTML.
   - The HTML lives in R2/KV, or is fetched from a Convex HTTP action and cached at the edge.
   - The publish flow writes the `buildDeployments` receipt only after the edge confirms the upload. This closes the "published but not live" gap (AGENTS.md rule 5).
   - Workers Paid ($5) is needed, because 10 ms of CPU on the free plan is too tight.
3. **Custom domains (later in v1):** Cloudflare for SaaS on the same zone. The first 100 are free.

**At scale:** roughly 1,000 custom domains and 50M requests/month comes to about $110/month plus Convex usage. That is the $5 plan, 900 extra hostnames, request overage and CPU time. There is no platform migration: the same design scales. Move to Enterprise only for apex proxying, wildcard customer hostnames or more than 50k hostnames.

## Decisions the owner must make

1. The brand domain for the dashboard, and a **separate** registrable domain for customer sites (to buy).
2. A Cloudflare account, and approval of Workers Paid at $5/month.
3. Whether custom domains are in v1, and on which plans.
