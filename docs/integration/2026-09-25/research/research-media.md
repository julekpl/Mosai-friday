# D4: Photo processing approach: research

Date: 2026-09-25. Repo check: `src/convex` already uses `"use node"` in 13+
files (`ai.ts`, `buildChat.ts`, `sellAI.ts`, `scraping.ts`, `stock.ts`,
`social/copilot.ts`, etc.), so Node actions are an established pattern in
MOSAI, not new infrastructure. `convex.json` currently has no `"node"` key
(no `externalPackages` set yet): one would need to be added for sharp.
`package.json` targets Node >=22.12, bun >=1.3; no image-processing lib is
installed yet.

## Convex Node action constraints (confirms option a is technically viable)

- Actions run up to 10 minutes; Node.js runtime process memory ~512MB, the
  (non-node) Convex V8 runtime is capped at 64MB: irrelevant here since image
  work must run in a `"use node"` action anyway. [Convex Limits](https://docs.convex.dev/production/state/limits)
- Total bundled function code per deployment is capped at 32MiB (source maps
  included): native binaries would blow this if bundled directly. [Convex Bundling](https://docs.convex.dev/functions/bundling)
- Convex 1.4 added `node.externalPackages` in `convex.json`: packages with
  native modules (Convex's own docs example is **sharp**) are excluded from
  the bundle and installed server-side from npm on push, sidestepping the
  bundle-size and cross-platform-binary problem. Example config:
  `{ "node": { "externalPackages": ["sharp"] } }`. [Convex Project Configuration](https://docs.convex.dev/production/project-configuration) · [Announcing Convex 1.4](https://news.convex.dev/announcing-convex-1-4/)
- Action concurrency: up to 1000 concurrent ops per action (queries/mutations/
  fetches), not a hard cap on parallel image jobs but a signal Convex expects
  actions to fan out work rather than hold huge in-memory state.
- Not independently verified from Convex docs: exact CPU/vCPU allocation per
  Node action invocation, and whether the 512MB figure is officially
  documented vs. inferred: flag as **unverified**, worth confirming with
  Convex support/Discord before committing to sharp for large batch jobs
  (e.g., 50MB source photos at 50k/month with 6 derivatives = 300k sharp
  operations/month).

## Cost comparison (approx, 1k / 10k / 50k images per month, ~6 derivatives each)

Derivative counts: 1k images -> 6k transforms; 10k -> 60k; 50k -> 300k.

| Option | 1k img/mo | 10k img/mo | 50k img/mo | Smart/focal crop | EU residency / DPA | Lock-in | Convex integration effort |
|---|---|---|---|---|---|---|---|
| (a) sharp in Convex Node action | $0 extra (compute only, within existing Convex plan) | $0 extra, but consumes action compute minutes on your Convex plan | $0 extra, likely meaningful action-minutes usage; may need queued jobs | DIY (manual focal point or a face/saliency lib you add yourself: no built-in AI crop) | Data never leaves Convex/your cloud: best residency story | None (open-source, self-owned) | Medium: install sharp, add `convex.json` externalPackages, write a Node action, chain through Convex file storage; must self-implement smart crop and format negotiation |
| (b) Cloudinary | Free tier likely covers it (25 credits/mo free; 6k transforms ≈ a few credits) | Plus plan $89/mo (225 credits) likely covers 60k light transforms + some storage/bandwidth | Advanced $224–249/mo (600 credits) probably needed once storage+bandwidth credits are counted, not just transform count | Yes: g_auto AI gravity/content-aware cropping built in | Cloudinary offers EU/other regional data centers on Advanced/Enterprise plans with a DPA; confirm exact region for your plan tier | Medium-high: proprietary URL-based transform API and credit accounting | Low-medium: upload via API/webhook, store Cloudinary public_id + derived URLs in Convex; straightforward SDK |
| (c) ImageKit | Free plan (25GB bandwidth/5GB storage) likely enough | Growth/mid plan, roughly in Cloudinary's range depending on bandwidth mix | Premium ~$89/mo (225GB bandwidth+storage) is a plausible fit if delivery stays modest; extension units (AI features) billed separately | Yes: AI-based smart/auto crop is a named, praised feature | GDPR/DPA available; specific EU-region hosting not confirmed in this pass: verify with ImageKit sales | Medium: URL-based transformations, own SDKs | Low-medium: similar upload-then-transform-URL pattern; good docs, easy Convex file-storage bridge (upload buffer from Convex action) |
| (d) imgix | Starter $25/mo (100 credits, 50GB media/100GB delivery) plausible for 6k transforms if source images are small | Growth tier likely required; historical per-1000-master-image pricing ($3/1k) suggests ~$180 for 60k master processing alone, current credit model likely similar order | Could land $500–1,000+/mo at this volume per vendor-cited SMB range | Yes: imgix has strong face-aware/entropy-based smart crop | AWS-backed; enterprise region options exist but self-serve EU data residency is not clearly self-service: verify | Medium: URL-parameter transform API, credit-based billing is opaque and prone to overage surprises | Low-medium: similar to Cloudinary/ImageKit |
| (e) Cloudflare Images / Image Transformations | Free (first 5,000 unique transforms/mo free): likely $0 | $0.50/1,000 beyond 5k => ~55k billable-transform-months ≈ $27.50/mo range (60k - 5k free) plus storage $5/100k images and delivery $1/100k if using Cloudflare storage | (300k - 5k) x $0.50/1k ≈ $147.50/mo transforms + storage/delivery: cheapest at scale by a wide margin | Limited: has gravity presets (face, auto via saliency in newer transform options) but historically weaker/less documented than Cloudinary's g_auto: verify current smart-crop parity | Cloudflare is a global network; EU-specific data processing / jurisdiction controls exist for Enterprise (Data Localization Suite) but are not simple self-serve on lower tiers: verify for a GDPR-focused SMB product | Low-medium: transformations are just URL params on Cloudflare's network/Workers, not deeply proprietary, but Images storage is | Low: fits well if the site is already on Cloudflare/Workers; otherwise needs Cloudflare account + zone setup, then fetch-and-transform or Images API from Convex |
| (f) Bunny Optimizer | $9.50/mo flat per Pull Zone (site), independent of volume, + CDN bandwidth by region | Same $9.50/mo flat + bandwidth | Same $9.50/mo flat + bandwidth: cheapest predictable flat fee at higher volumes | Yes: crop gravity, focus/face-cropping, AVIF output (GA June 2026) | Bunny.net is EU-based (Slovenia): naturally EU-friendly data handling and DPA | Low-medium: mostly standard resize/crop URL params, not a heavy proprietary API | Low: simple URL-based pull-zone transforms; requires Bunny storage or origin pull from Convex file storage over HTTP |
| (g) Client-side canvas (browser) pre-processing | $0 | $0 | $0 | No true AI smart crop; can do manual focal-point drag-to-crop before upload | Best possible: image never leaves the user's device until the (already-cropped) file is uploaded: minimizes processing of personal data server-side | None: plain web APIs (Canvas, OffscreenCanvas, createImageBitmap) | Low for crop/resize UI; but WebP/AVIF *encoding* quality and browser support vary, EXIF auto-orient needs care, and mild color/exposure correction is harder to get consistent across devices/browsers than server-side |

Notes on the numbers: transform/credit accounting for Cloudinary, ImageKit
and imgix is not purely per-image: it blends storage, bandwidth and
transformation counts, so the derivative-count math above is directional,
not a quote. Treat all $ figures as **unverified estimates from vendor
marketing/aggregator pages**, not confirmed via each vendor's live pricing
calculator or a sales conversation: worth a follow-up pass at ticket time
that pulls exact numbers from each vendor's own pricing page with MOSAI's
real image-size assumptions.

## Recommendation

**v1 (now): hybrid of (g) + (a).**
- Do crop/orient/basic exposure adjustment client-side (browser canvas) at
  upload time for immediate user feedback and to cut bytes uploaded: this
  needs no new vendor, no new spend, and keeps raw personal photos off
  third-party processors by default (good EU/GDPR story per AGENTS.md rule
  8: "user-supplied URLs/data ... never ... scraped" applies in spirit to
  minimizing what leaves the user's device).
- Do canonical resize + WebP/AVIF derivative generation + a *simple* focal
  or center-weighted crop (not full AI saliency) server-side with **sharp in
  a Convex Node action** (`convex.json` → `node.externalPackages: ["sharp"]`),
  storing derivatives in Convex file storage next to the original. This
  matches the repo's existing `"use node"` pattern (`ai.ts`, `buildChat.ts`,
  `scraping.ts`, etc.), needs no new vendor contract/DPA, keeps all customer
  photo data inside Convex (simplest EU data-residency argument depending on
  Convex's own deployment region), and avoids committing to a credit-based
  SaaS pricing model before real volume is known.
- Explicitly defer true AI smart-crop (saliency/face detection): ship
  center-crop + optional user-set focal point in v1; this is consistent with
  "no fake success" (don't claim AI smart-crop until it's real) and keeps
  scope small per AGENTS.md §8.

**At scale (post-PMF, 50k+/month or need for true AI smart-crop, video, or
heavier bandwidth):** re-evaluate **Cloudflare Images/Transformations** for
its clearly cheapest per-transform economics at volume and its likely
existing footprint if MOSAI's own delivery sits behind Cloudflare, or
**Bunny Optimizer** for its flat $9.50/mo predictability and EU home base -
both keep lock-in low since transforms are just URL parameters, easy to
swap. Reserve **Cloudinary** for if/when true AI-driven crop and richer DAM
features become a hard requirement customers are asking for, accepting its
higher cost and heavier proprietary surface. Whatever is chosen, keep the
existing Convex-stored asset ids as the source of truth and treat any
external processor as a swappable delivery layer, never the record of
truth, to satisfy AGENTS.md rule 10 (module independence / no vendor lock
into canonical data).

## Sources
- [Convex Limits](https://docs.convex.dev/production/state/limits)
- [Convex Bundling](https://docs.convex.dev/functions/bundling)
- [Convex Project Configuration (externalPackages)](https://docs.convex.dev/production/project-configuration)
- [Convex Actions](https://docs.convex.dev/functions/actions)
- [Announcing Convex 1.4 (sharp/externalPackages)](https://news.convex.dev/announcing-convex-1-4/)
- [Cloudinary Pricing](https://cloudinary.com/pricing)
- [Cloudinary Pricing Explained 2026](https://theimagecdn.com/docs/cloudinary-pricing)
- [Cloudflare Images docs](https://developers.cloudflare.com/images/)
- [Cloudflare Images Pricing 2026](https://theimagecdn.com/docs/cloudflare-images-pricing)
- [Cloudflare vs Cloudinary pricing gap](https://leanopstech.com/blog/cloudflare-images-pricing-2026/)
- [ImageKit Plans](https://imagekit.io/plans/)
- [imgix Pricing](https://www.imgix.com/pricing)
- [imgix Pricing 2026 (TCO)](https://pricingnow.com/question/imgix-pricing/)
- [Bunny Optimizer Pricing](https://bunny.net/pricing/optimizer/)
- [Bunny Optimizer features](https://bunny.net/optimizer/)
- [Smart Cropping across image CDNs 2026](https://theimagecdn.com/docs/smart-cropping)
- [Paid Image CDN Options 2026 cost math](https://theimagecdn.com/docs/paid-cdn-options)
