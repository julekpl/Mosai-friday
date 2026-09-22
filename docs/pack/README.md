# MOSAI implementation pack — start here

**Pack date:** 20 September 2026 · **Verified against:** `da87ab7` ·
**Supersedes:** the single-file review from the first pass.

This pack sits **beside** `MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md`. The blueprint
says *what the product is*. This pack says *what is true in the code today, what
must change first, how modules and AI must be configured, and the exact tickets
to build it in order*, so a coding LLM can finish the app without guessing.

> **Read `STATUS.md` in this folder before acting on anything below.** It records
> what has already been implemented in the repository since `da87ab7`, so you do
> not re-do finished work.

## Reading order

| # | File | Use it for | Skill format |
|---|---|---|---|
| — | [`../../AGENTS.md`](../../AGENTS.md) | Root rules every coding agent must follow | — |
| — | [`STATUS.md`](STATUS.md) | What is already done vs. still open in the code | audit |
| 01 | `01-review-and-code-verification.md` | What is exposed, what the code confirms, what is good | Review |
| 02 | `02-prd-gap-spec.md` | Problem, goals, 27 gaps with acceptance criteria | write-spec |
| 03 | `03-system-design.md` | Target architecture, data model, key flows, reliability | system-design |
| 04 | `04-adrs.md` | 11 decisions with options and consequences; external approvals | architecture |
| 05 | `05-design-system.md` | Simple-but-powerful UX doctrine, audit results, components | design-system |
| 06 | `06-test-strategy.md` | Baseline, regression tests, CI pipeline | testing-strategy |
| 07 | `07-ai-agent-config.md` | Agent registry, autonomy levels, context, evals | — |
| 08 | `08-module-contracts.md` | Independence and integration rules per module | — |
| 09 | `09-competitive-positioning.md` | How to beat HubSpot, Shopify, Conductor, Mailchimp and Lovable | — |
| 10 | [`10-build-backlog.md`](10-build-backlog.md) | Ordered tickets: exposure → buildable repo → foundations → modules | — |
| — | [`../tickets/`](../tickets/) | One file per ticket — **the unit of work** | ticket |

## Precedence when documents disagree

1. `AGENTS.md` (security and truthfulness rules)
2. The ticket in `docs/tickets/`
3. `08-module-contracts.md` and `07-ai-agent-config.md`
4. The blueprint section the ticket cites
5. Everything else

If a real conflict remains, stop and ask the owner (`AGENTS.md` §7).

## Do this today (the repository has been public)

1. **Rotate the exposed secrets:** the email service API key
   (`src/convex/auth/emailOtp.ts`) and the dotenvx private key (`.env.keys`).
   Assume both are compromised. Runbook: `docs/runbooks/secret-rotation.md`.
2. **Close the abuse chain:** remove anonymous sign-in, default new users to the
   free plan, block client plan changes, and require sign-in on the AI and
   scraping actions. Details and tests: ticket T0.1–T0.10 in
   [`10-build-backlog.md`](10-build-backlog.md).

Status of both: see [`STATUS.md`](STATUS.md).

## Glossary: one name for each thing

The blueprint, the navigation and the code use three naming systems. Use the
**capability ID** in new code and specs.

| Navigation label | Base-package noun / add-on | Code module key today | Capability ID (use this) | Folder today |
|---|---|---|---|---|
| Understand | Project, Persona | `understand` | `base.project`, `base.persona` | `projects.ts`, `personas.ts` |
| Journeys | Journey | `journeys` | `base.journey` | `journeys.ts` |
| Create | Content | `create` | `base.content` | `content.ts`, `ai.ts` |
| Build | Build add-on | `build` | `build.website`, `build.app` | `cms.ts`, `build*.ts` |
| Customers | Customers add-on | `customers` | `customers` | `contacts.ts`, `communications.ts` |
| Promote | Promote add-on | `promote` | `promote.social`, `promote.ads` | `social/`, `ads/`, `campaigns.ts`, `posts.ts` |
| Sell | Sell add-on | `sell` | `sell.native`, `sell.shopify` | `sell/`, `products.ts`, `shopifySync.ts` |
| Grow | Grow add-on | `grow` | `grow` | `insights.ts`, `connections.ts` |

Purchasing is per **add-on**; activation, gates and tests are per **capability
ID**.

## Corrections to the blueprint (verified)

| Blueprint says | Reality | Where handled |
|---|---|---|
| §21.2: `npm ci`, `npm run build`, `npm run lint` are the workbench baseline | `npm ci` fails; there are no tests or CI | T1.1–T1.5 |
| §18–19: ChatGPT is only a discovery channel until an official advertiser API exists | An official Advertiser API now exists (beta, reported US advertisers, per-account keys, partner access) | G26 |
| Auth section assumes MOSAI sends the OTP code | OTP email goes through a template platform using a committed key | T0.1, T0.8, ADR-9 |
| Public storefront and SEO/GEO goals assume crawlable server-rendered pages | Public pages are a client-side app on the dashboard's origin | G23, T2.15 |
| Add-ons are separately purchasable | Code has tier bundles (`free/starter/growth/scale`) | T2.3 |
| Base and modules can integrate without entanglement | Modules read each other's tables freely today | ADR-10, `08` |

## What "finished" means

An add-on is finished only when its module-alone, pairwise and removal journeys
pass, its security and privacy checks pass, its agents meet their evaluation
floors, its parity table P0 items are done, and every status shown to a customer
is backed by a receipt. **A screen that merely looks complete is not finished.**

## What the pack could not verify

The pack did not run the app against a Convex deployment, exercise provider
APIs, or measure runtime performance. Its authorization scan is a text
heuristic. Competitor facts come from vendor pages and third-party reviews
(September 2026) and should be re-checked before public claims. Numbers marked
*(proposed)* or *(assumption)* are starting points.
