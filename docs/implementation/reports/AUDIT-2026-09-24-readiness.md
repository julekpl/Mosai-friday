# Readiness audit and follow-up: 24 Sep 2026

**Scope:** a code-level audit of the eight product areas the owner listed, then the first round of fixes on branch `claude/dreamy-hopper-qndqeg`.
**Method:**
- Six parallel reviewers: auth/billing/admin, data/AI, website/CMS/shop, app builder, ads/social/CRM, UX/copy.
- Every critical claim was re-checked in code.
- Checks were run locally: typecheck, lint, unit, e2e, a11y, and the function, capability, data-registry and secret audits.
- No live provider (Stripe, Google, SerpApi, OpenRouter) was called. Everything provider-facing is tested against the documented response shapes only.

## Fixed on this branch

| Area | Change | Proof |
|---|---|---|
| Security | `buildChat.editPage` let one tenant's AI edit overwrite another tenant's CMS draft. The page must now belong to the build's project | `tests/unit/audit-2026-09-24-regressions.test.ts` (failed before the fix) |
| Truth | `posts.update` let the client set `published` or `scheduled`. It no longer accepts a status | same file |
| CI | `lib/websiteScan` wasn't registered in the capability audit; `.env.keys` was untracked | audits green |
| Google Business search | Exact matches (`place_results`) returned "no matches"; SerpApi's no-results answer showed as an outage; `place_id` was sent together with `q/type`; hours printed "[object Object]". Paid lookups are now capped per user | `tests/unit/google-maps-parsing.test.ts` |
| AI grounding (owner report: an architecture firm got an *employee* persona and *marketing-agency* content) | Server-drafted, owner-confirmed business profile. The business brief now opens every prompt (customers, who is *not* the audience, offerings, goals). The wizard now saves audience and customer problems, and keeps the owner's marketing problems apart from customer problems | `tests/unit/business-understanding.test.ts` |
| Edit project | New Edit project sheet (business understanding, customers, details, AI model, re-scan website), plus Home and Edit project links in the sidebar | `business-understanding.test.ts` |
| Scan truth | A re-scan is stored by the server; a scan no longer overwrites the owner's description | same |
| Google Analytics 4 / Search Console / Google Ads (MVP) | One Google OAuth per project (offline access, revoke), resource pickers, sync jobs + daily cron, Grow insights panel, provider-labelled AI context | `tests/unit/google-grow.test.ts` (28) |
| AI models | Operator allow-list of OpenRouter models, per-project choice, model resolved inside the gateway. One repair retry for invalid structured output; output ceiling 8k tokens; timeout 90s | `tests/unit/ai-models.test.ts` |
| Plans | Core bundle (Understand + Journeys + Create) is always included. Operator catalog of plans and add-ons; audited add-on grants; webhook and reconciliation map subscription items; catalog checkout and add/remove add-on (test mode) | `tests/unit/plans-and-addons.test.ts` |
| Billing bugs | Double billing on "Upgrade" (a second checkout while subscribed); cancellation date shown as year ~50,000 | same + `billing.test.ts` |

## Still open (ranked)

1. **Owner-only.** Rotate the dotenvx key that was committed in `.env.keys` (it is still in git history) and the old OTP key (`docs/runbooks/secret-rotation.md`). CI's history scan stays red until then.
2. **Public website and shop.**
   - Customer sites are not public.
   - There is no server rendering or prerendering, no SEO head, sitemap, robots.txt or JSON-LD.
   - Call-to-action blocks are not links, image blocks are broken, collections have no slug.
   - "Published / now live" is shown without a deployment.
   - Hosting proposal: `docs/decisions/2026-09-24-hosting-public-sites.md`.
3. **Checkout for the shop.** There is no cart, orders, tax, shipping or Stripe Connect. The product feed is invalid for Merchant Center.
4. **Social.** All five connect flows are broken (FB page id, LinkedIn URN, X PKCE, TikTok parameter names); publishing can double-send; there is no comments inbox.
5. **Ads.** No UI calls the ads backend. The TikTok budget is sent in cents instead of currency units (100× too large). Meta Graph v21 is near end-of-life. Campaign creation is draft-only.
6. **CRM and email.** There is no email service, consent capture, double opt-in, unsubscribe, forms, segments or workflows (a GDPR exposure for an "EU HubSpot/Mailchimp").
7. **App builder.** It produces CMS blocks, not code. There is no sandbox, backend, deploy or GitHub export. The chat always edits the homepage (the client never sends `pageId`).
8. **Analytics in customer sites.** There are no GA4/GTM/Matomo/PostHog tags, no Consent Mode v2 and no cookie banner. The content security policy would block the tags anyway.
9. **Admin.** There is no user search, suspend or delete, no MRR or AI-spend view, and no coupons or promotions. A failed Stripe webhook returns 200, so Stripe never retries it and the event is lost.
10. **Research quality.** Reddit's unauthenticated API is likely blocked and isn't licensed for commercial use. NewsAPI's free plan isn't licensed for production. Research queries aren't anchored to the business, and content carries no citations.
11. **In-product agent.** Proposal: `docs/decisions/2026-09-24-in-product-ai-agent.md`. The Hermes blueprint's package does not exist; the recommendation is a native Convex copilot.

## Environment the owner must configure

- `OPENROUTER_API_KEY`, `SERPAPI_KEY`, `NEWSAPI_KEY` (production licence).
- `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, optionally `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
  - In Google Cloud, enable the Analytics Data and Admin APIs, the Search Console API and the Google Ads API.
  - Set up the OAuth consent screen and get it verified.
  - Redirect URI: `https://<deployment>.convex.site/api/google/callback`.
- Stripe test keys and prices. Then create plans and add-ons in **/admin → Plans & add-ons** with their `price_…` ids.
- `NAMECRANE_SMTP_PASSWORD` and `OTP_EMAIL_PROVIDER=namecrane` (the owner chose Namecrane for the demo).

## Notes for the next agent

- `src/convex/_generated/api.d.ts` was edited by hand in generator order for new modules, because no Convex deployment is reachable from agent sessions. CI's `codegen drift` job verifies it; if it fails, run `bun run codegen` against a deployment.
- CI runs on pushes to `main` and on pull requests; this branch has no PR yet.
