# PROGRESS — MOSAI implementation against the saved blueprint

**Created:** 23 September 2026 (chat 0 — save-and-organize only; no application
changes were made in this chat). **Blueprint of record:**
`docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md` (saved verbatim this chat).
**Repository baseline:** branch `main`, commit
`a3edd69bf813e4705f9d189fe43079aee3f2257e` — read directly from
`.git/refs/heads/main`; this is **identical to the blueprint's stated baseline**
(blueprint header). Git *commands* are blocked in this environment
("Git and GitHub commands are blocked; Vly manages version control."), so
branch/commit are verified by reading `.git` files, and working-tree cleanliness
could not be confirmed with `git status` (see Blockers B2).

**Status vocabulary (per chat instructions):** `not_started` · `in_progress` ·
`blocked` · `implemented_unverified` · `complete`.
**Report convention:** each finished chat writes
`docs/implementation/reports/<PACKAGE-ID>-<short-name>.md` and updates this file.

---

## 1. Blueprint chapter index (IDs of record)

Chapters 1–4 and 6–11 are **shared guidance applied throughout every chat**;
chapter 5 holds the per-chat work packages.

| Chapter | Content | Applies |
|---|---|---|
| 1 | How to use this blueprint; source-of-truth order (owner/security → code+tests → contracts → ticket prose); T2.5 discrepancy must be reconciled | every chat |
| 2 | What "working" means; evidence levels (Implemented / Configured / Connected / Operational / Ready to release) | every chat |
| 3 | Dependency & delivery map (orders A–E), predecessor checks, phase gates | ordering (§3) |
| 4 | Shared contracts: §4.1 boundaries & identifiers (`src/shared/*`, `src/convex/modules/<domain>/`, registry mapping); §4.2 external execution protocol (validate → persist+hash → claim → action → receipt → reconcile); §4.3 proposed records (Job, Provider receipt, Event/outbox/inbox, Connection, Fact/evidence, Metric observation, Approval, AI run) | every chat |
| 5 | Code work packages **BP-01 … BP-20** (see §2) | one chat per package/slice |
| 6 | Integration verification matrix (provider → entry point → proof) | adapter chats |
| 7 | Migrations, rollout, rollback rules | any schema/data chat |
| 8 | End-to-end acceptance scenarios **J01–J15**; required UI states | release evidence |
| 9 | Decisions register: recorded decisions to preserve + 7 owner-input rows | every chat |
| 10 | First implementation assignment (BP-01 → BP-04 → BP-03, prepare BP-05) + per-ticket handoff text | ordering (§10) |
| 11 | Sources and verification boundary | every chat |

## 2. Work packages, backlog mapping and chat order

**Ordering-conflict resolution (chapter 3 vs chapter 10), resolved before
implementation:** chapter 3 lists Order A as BP-01–04 (numeric), while chapter
10's explicit "First implementation assignment" says BP-01 → BP-04 → BP-03 and
does not mention BP-02. Resolution: **chapter 10 controls the first three
implementation chats** (it is the blueprint's explicit assignment and gives the
rationale: bounded, demonstrable, no whole-module claims); **BP-02 remains part
of Order A and runs fourth**, so Order A still completes before Order B, per the
chapter-3 map and the backlog rule "do not start a phase until the previous
phase's gate passes." BP-05 is *prepared* during Order A (analysis only) and
*implemented* fifth, first package of Order B, as chapter 10 directs. No other
deviation from chapter 3's A→E sequence.

**Slice rule:** packages that specify PR slices get one chat per slice (IDs
`BP-nn/Sk`, parent ID retained). Packages judged too large for one coherent
change were split provisionally below (marked †); the split is refined at chat
start if reality differs, always retaining the parent BP ID. A chat stops at
its slice boundary — it never continues into the next package.

| Chat | Package/Slice | Order | Backlog mapping | Depends on (must be complete first) | Status |
|---|---|---|---|---|---|
| 0 | save-and-organize (this chat) | — | — | — | complete |
| 1 | **BP-01** repair baseline & status docs | A | T0.1/T0.8, T1.5/T1.8 | — | implemented_unverified (chat 1, 23 Sep 2026 — report: `docs/implementation/reports/BP-01-repair-baseline.md`; all local gates re-run green, plant/observe demonstrations done (broken auth, wrong CTA, synthetic secret), STATUS/T2.5/missing-docs reconciled; **two CI runs, both completed/FAILURE:** implementation commit `d3f6a8e09e301944789dc2c4487a831dc7698137` → run `35828575954`, documentation commit `dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` (current local `.git/refs/heads/main`) → run `35830549968` — install/typecheck/lint/unit/codegen/e2e/a11y passed on both, **BOTH security jobs failed their secret-scan steps on both → release gate BLOCKED, CI not green**; full-history findings + rotation/untracking remain owner-run (B2/B3) — remediation checklist in the report; any new commit needs a fresh run, never assumed |
| 2 | **BP-04** social credentials & token refresh | A | E3.5 defect fix | BP-01 (per §10 order; no hard code dep) | implemented_unverified (chat 2, 23 Sep 2026 — report: `docs/implementation/reports/BP-04-social-credential-refresh.md`; three defects fixed + **review follow-up on code `e6f91b9`/docs `f9510fc`**: Basic token exchange honored for LinkedIn/X (red-first: 2 tests failed `expected '' to be 'Basic …'` before the fix), provider `error` strings gated by an allowlist AT the message site in both credentialActions (adversarial marker tests pin posts/outcomes; green pre-fix via the old coupling — recorded honestly); tests 16/16 in the two files, unit **311/311**, lint(0 err)/audits/codegen/tsc/dev-check exit 0, e2e 15+1, a11y 5; `bun run check` exit 1 **kept red** at the pre-existing `scan:secrets` on tracked `.env.keys`; local ref `f9510fc`, **CI for `e6f91b9`/`f9510fc` unknown (B2), never assumed green**; real-provider proof pending (O7); release gate still BLOCKED (BP-01/B3); main-branch workflow exception recorded in the report) |
| 3 | **BP-03** stop false publishing/readiness | A | T2.13 | BP-01; truthful labels allowed before BP-13 deployment exists (§5 BP-03) | implemented_unverified (local compatibility fix `c1006d3`, report: `docs/implementation/reports/BP-03-publish-truth.md`; legacy verified-row inventory, exact-SHA CI and real deployment proof remain open) |
| 4 | **BP-02** sign-in, recovery, privileged access | A | T0.8, T2.8 | BP-01; email-gateway sub-part owner-blocked until decision O2 | implemented_unverified (chat 4, 23 Sep 2026 — report: `docs/implementation/reports/BP-02-auth.md`; allowlisted `returnTo`, generic OTP recovery/errors, 10s auth-load + 15s action timeout, late verification response ignored, keyboard/focus and hermetic regressions; lint/typecheck, 333 unit, both audits, full e2e 20 pass/1 live OTP skip, a11y 5 pass; red-first timeout regression demonstrated; `check:codegen` blocked on missing `CONVEX_DEPLOYMENT`; `check` remains exit 1 at existing tracked `.env.keys` secret finding; O2 provider/domain and T2.8 step-up policy remain blocked; session audit proposal write denied; diff check exit 0) |
| 5 | **BP-05** export/deletion lifecycle | B | T2.5 | Order A; decisions already recorded (D2) | implemented_unverified (source `0fde75c`, locally integrated `7e880f6`; report: `docs/implementation/reports/BP-05-export-deletion-lifecycle.md`; 30-day durable lifecycle, registry-driven export/deletion, guarded multi-org cleanup, active-member and per-step export authorization, current-access chunk reads, cancellation/retry. Independent safety review passed 39 focused tests; combined 436 units/typecheck/lint/audits/build and browser E2E 20 pass/1 live OTP skip passed. Customer export/download UI, dev Convex and real Stripe proof, exact-SHA CI and secret remediation remain open.) |
| 6 | **BP-06/S1** provider-backed price display & cancellation | B | T2.4 + owner rules | BP-05 not required; T2.4 done; owner chose Stripe test catalog and period-end cancellation | implemented_unverified (local `codex/bp-06-admin-stats`; report: `docs/implementation/reports/BP-06-S1-billing-truth.md`; 354/354 units and focused lint/audits passed; checkout-local typecheck lacks installed `three`; no real Stripe test proof, CI or BP-05 integration) |
| 7 | **BP-06/S2** organization-level subscription/add-on mapping | B | T2.4 + T2.3 | BP-06/S1 | not_started |
| 8 | **BP-06/S3** operator catalog/promotions/business statistics | B | admin commerce | BP-06/S2 | not_started |
| 9 | **BP-07** jobs, events, receipts, approvals | B | T2.6, T2.12 | BP-05 not required; schema/crons exist | in_progress (ads claim/receipt S1 `db64359` plus deletion fence integrated as `7b120dc`, implemented_unverified; reports: `docs/implementation/reports/BP-07-S1-ads-execution-claim.md` and `BP-07-BP-05-deletion-fence.md`; lease/reconciliation, events, approvals and provider proof remain open) |
| 10 | **BP-08** one connection framework | B | T2.7 | BP-04 (refresh-in-action pattern), BP-07 not required | in_progress (OAuth state/origin S1 implemented_unverified in the local integration checkout; report: `docs/implementation/reports/BP-08-S1-oauth-state-origin.md`; 6 focused regressions and combined 456 units passed; organization-bound state, token policy, account discovery, sync/provider proof and CI remain open) |
| 11 | **BP-09/S1**† ModelGateway + run metering (route all model call sites) | B | T2.9 | T0.4 gating exists | implemented_unverified (source `d21fa7c` integrated into development main before `274877f`; report: `docs/implementation/reports/BP-09-S1-model-gateway.md`; no real provider proof; BP-07 run reconciliation and BP-09/S3 remain open) |
| 12 | **BP-09/S2**† ContextPack/ContextInspector (finishes T0.4 → unblocks red test R4) | B | T2.10 | BP-09/S1 | implemented_unverified (server-owned bounded context and Build inspector locally integrated; report: `docs/implementation/reports/BP-09-S2-context-pack.md`; combined 456 units/typecheck/build/audits and synthetic E2E 20+1 passed; buildChat/ads/social contexts, exact-commit CI and external model proof remain open) |
| 13 | **BP-09/S3**† prompt versioning, golden tests, eval floors | B | T2.11 | BP-09/S1; needs `07-ai-agent-config.md` (missing, see B1) | not_started |
| 14 | **BP-10** accurate ingestion & transparent research | C | E3.1 (part) | Order B (safeFetch/guards exist already) | in_progress (source-status slice `c9da779` implemented_unverified; report: `docs/implementation/reports/BP-10-source-status-slice.md`; persisted evidence and provider proof remain open) |
| 15 | **BP-11** projects, personas, content, journeys | C | E3.1 | BP-10 (facts/evidence links) | in_progress (journey-origin and onboarding source-review slices implemented_unverified; report: `docs/implementation/reports/BP-11-source-review-onboarding.md`; full fact-linked persona/journey/content flow and provider proof remain open) |
| 16 | **BP-12/S1** event/consent contract | C | T2.14 | BP-07 (envelope), BP-08 (connections seam) | in_progress (type-only fail-closed event/consent contract `6be29f0`, corrected `914346d`; report: `docs/implementation/reports/BP-12-S1-measurement-contract.md`; no public collector or optional tracking, no server-owned consent record or approved EU/EEA policy; not a complete S1) |
| 17 | **BP-12/S2** GA4/GSC account selection & ingestion | C | E3.7 | BP-12/S1; provider accounts (owner input O7) | not_started |
| 18 | **BP-12/S3** Matomo/PostHog | C | E3.7 | BP-12/S1 | not_started |
| 19 | **BP-12/S4** GTM installation/diagnostics + forwarders | C | T2.14 | BP-12/S1 | not_started |
| 20 | **BP-12/S5** evidence-backed recommendations | C | E3.7 | BP-12/S2–S3 (observations) | not_started |
| 21 | **BP-13/S1** public projection (published-only, separate origin) | D | T2.15 | Order C; public-domain owner decision O4 blocks *real* origin verification only | not_started |
| 22 | **BP-13/S2** deployment & domain verification | D | T2.15, E3.2 | BP-13/S1; **hosting adapter + domain owner decision O4** | not_started |
| 23 | **BP-13/S3** CMS completeness (nav, slugs, redirects, media, revisions, locales, forms) | D | E3.2 | BP-13/S1 | not_started |
| 24 | **BP-13/S4** generated-page quality (SEO, links, a11y audit) | D | E3.2 | BP-13/S3 | not_started |
| 25 | **BP-13/S5** export parity | D | E3.2 | BP-13/S3 | not_started |
| 26 | **BP-14/S1** merchant setup & catalog validation | D | E3.4 | Order C; Connect direction decided (D3) | not_started |
| 27 | **BP-14/S2** checkout/order/payment | D | E3.4 | BP-14/S1; **precise Connect/tax/shipping owner decision O6** before money movement | not_started |
| 28 | **BP-14/S3** fulfillment/refunds/subscriptions/digital delivery | D | E3.4 | BP-14/S2; O6 | not_started |
| 29 | **BP-14/S4** public feed submission/diagnostics | D | E3.4 | BP-14/S1 (public endpoint needs BP-13/S1 origin seam) | not_started |
| 30 | **BP-14/S5** per-store Shopify sync | D | E3.4 | BP-14/S1; per-project credentials (T0.9 guard preserved) | not_started |
| 31 | **BP-15/S1**† app model: source graph, build jobs, snapshots, runner interface | D | E3.8 | Order C; no external decision for interface work | not_started |
| 32 | **BP-15/S2**† sandbox execution, preview, approved deploy, rollback | D | E3.8 | BP-15/S1; **sandbox/backend host owner decision O5** | not_started |
| 33 | **BP-15/S3**† export/portability, cost metering, context grounding | D | E3.8 | BP-15/S2; O5 (portability promise) | not_started |
| 34 | **BP-16/S1** ad adapter contract + Google verified drafts/creation (paused) | D | E3.6 | Order C; BP-07 (approvals/receipts), BP-08 (connections); Google dev token/test account (O7) | not_started |
| 35 | **BP-16/S2**† wizard/simple mode, approval, activation, optimization, conversion setup | D | E3.6 | BP-16/S1 | not_started |
| 36 | **BP-16/S3**† Meta & TikTok validation (OpenAI Ads stays unavailable until official docs+test) | D | E3.6 | BP-16/S1; Meta/TikTok test accounts (O7) | not_started |
| 37 | **BP-17/S1** contact/import/consent | D | E3.3 | Order C | not_started |
| 38 | **BP-17/S2** email sending/feedback | D | E3.3 | BP-17/S1, BP-07; **email service/domain owner decision O2** | not_started |
| 39 | **BP-17/S3** deterministic segments | D | E3.3 | BP-17/S1 | not_started |
| 40 | **BP-17/S4** automation engine (jobs, not frontend timers) | D | E3.3 | BP-17/S2–S3, BP-07 | not_started |
| 41 | **BP-17/S5** pipeline/inbox/reporting | D | E3.3 | BP-17/S1 | not_started |
| 42 | **BP-18** social publishing, comments, reporting | D | E3.5 | **BP-04, BP-07, BP-08 all complete** (blueprint: "After BP-04/BP-07/BP-08") | not_started |
| 43 | **BP-19** make the power understandable (usability) | E | T2.16 + design contracts | Orders A–D for the screens it touches; user-testing sessions (owner coordination) | in_progress (social connection gate source `eb39e27` plus mobile navigation slice locally integrated; reports: `docs/implementation/reports/BP-19-social-action-connection-gate.md`, `BP-19-mobile-navigation.md`; authenticated mobile visual proof, guided journeys and five observed user sessions remain open) |
| 44 | **BP-20** operations & release proof | E | T2.16, 06-test-strategy | all prior packages; owner RPO/RTO decision | not_started |

† = provisional split made in chat 0 because the package is too large for one
coherent change (blueprint does not pre-slice it). Sibling slices that the
blueprint *does* pre-slice (BP-06, BP-12, BP-13, BP-14, BP-17) are verbatim
from its "PR slices" lines.

**Phase gates (chapter 3):** A exit = known failures have regressions; no false
live state or broken credential handoff. B exit = shared contracts authorize and
record work correctly. C exit = correctable facts and actual observations support
outputs. D exit = every requested tool completes its standalone customer outcome.
E exit = complete combined journeys pass with users and real test accounts.

## 3. Existing implementation that must be preserved (verified in this tree)

- **Tenancy/authorization:** `guards.ts` org builders `orgQuery/orgMutation/orgAction`
  + `OrgAccess` (T2.2), `requirePlatformAdmin` + `lib/platformAdmin.ts`,
  `requireActionUser`; `scripts/audit-public-functions.mjs` (allow-list of 3,
  keep tiny); `eslint.config.js` raw-`ctx.db` ban; generated cross-tenant suite
  (169+ cases). Do not create a second tenancy system (§4.1).
- **Capabilities:** `src/convex/lib/capabilities.ts` canonical registry
  (`PLAN_MODULES`, 34 capability keys, states `included|locked|needs_setup|unavailable`,
  `CONVEX_FILE_OWNERS`) + `audit-module-capabilities.mjs`; module builders
  `moduleQuery/moduleMutation/moduleAction` gate 149 functions (T2.3).
  §4.1 requires adding an explicit submodule mapping (`build.website`, `build.app`)
  here rather than renaming strings in components.
- **Billing (BP-06 base):** `lib/stripe.ts` (test-mode guard, HMAC-SHA256 webhook
  verify, mandatory idempotency), `billingWebhooks.applyEvent` (idempotent by
  event id, out-of-order-safe), `lib/billingCatalog.ts`, `lib/billingReconcile.ts`
  (0-drift target), dunning + wind-down sweep + daily reconcile cron, admin panel
  guarded by `requirePlatformAdmin` (T2.4). `tests/unit/billing.test.ts` (12).
- **Deletion (BP-05 base):** `dal.cascadeDeleteProject` is the one engine
  (incl. the `buildVersions` index fix found by R10); `deletion-completeness.test.ts`
  generates the table list from the schema; T2.5's four owner decisions (D2 below).
  Preserve the engine; replace the *entry paths* per BP-05.
- **Truthful states already enforced:** connections `connected` writable only via
  internal mutations (T0.10); Shopify deployment-global sync refuses (T0.9);
  scheduled-post job refuses without `promote.publish` (T2.3); checkout redirect
  never grants a plan (T2.4).
- **Safety primitives:** `lib/safeFetch.ts` (SSRF), `src/lib/sanitize.ts` +
  sink scan in `tests/e2e/sanitized-html.spec.ts`, `.gitleaks.toml` +
  `scripts/scan-secrets.mjs`, secret-scan unit tests that never echo values.
- **Test/CI gates:** `bun run check` (typecheck+lint+unit+secrets+audit:functions
  +audit:capabilities), `test:e2e` (13), `test:a11y` (5, zero serious/critical,
  no allow-list), `check:codegen`; R1–R12 suite — R4 was deliberately red
  (`it.fails`, blocked on T0.4) **until 22 Sep 2026**; BP-01 re-verified on
  23 Sep that R4 is **green**, the `it.fails` count on this tree is **0** and
  all **295** unit tests pass (this line was stale). Never weaken a gate to go
  green.
- **Auth UX (BP-02 base):** OTP-only flow in `Auth.tsx` with T1.8 accessibility
  (labels, `autocomplete="one-time-code"`, focus management, resend countdown),
  `RequireAuth` preserving `returnTo`, skip links on all layouts.
- **BP-03 base:** sanitized `PageRenderer`, CMS revision rules in
  `WEBSITE-ARCHITECTURE.md` (published content immutable; public reads never
  return a draft), `StatusBadge`/`ReceiptBadge` requirement (rule 15).
- **BP-04 nuance:** `social/executor.ts` already contains an internal
  `executor.getCred` query ("action-safe", ~L212/L238) — verify how much of the
  credential-handoff fix already exists before rebuilding; ads consumers use
  `cred._id` and must keep that contract.
- **BP-14 base:** `SELL-ARCHITECTURE.md` invariants (Product→Variant mandatory,
  change-control), `M1-BLUEPRINT.md` field model, standalone Sell contract.
- **BP-15 base:** website generation inside `Build.tsx`/`BuildWorkspace.tsx`/
  `buildChat`/`buildPlan`/`buildPages` must keep working while app behavior is
  separated.

## 4. Recorded owner decisions (preserve; do not re-decide)

| # | Decision | Source |
|---|---|---|
| D1 | **Bun** is the package manager; `bun.lock` only; Node ≥22.12 pinned; **Convex bindings committed** with `check:codegen` drift gate | T1.1/T1.2, STATUS §6 #8, blueprint §9 |
| D2 | **Deletion lifecycle:** 30-day grace (`ACCOUNT_DELETION_GRACE_DAYS = 30`); active finalizer cron after grace, only on explicit user request; **skip + report** (no auto-cancel) while a relevant paid subscription is active; delete **solely-owned orgs only**, preserve orgs with other active members; block unresolved shared ownership | T2.5 owner answers (22 Sep 2026), blueprint §9 |
| D3 | **Stripe:** Connect (connected accounts) for commerce (E3.4); MOSAI platform subscriptions bill the platform account; Stripe Tax enabled; **plans/prices NOT final** → price ids are `STRIPE_PRICE_*` config, unconfigured plan = honest `needs_setup` | T2.4 owner answers, STATUS §6 #1, blueprint §9 |
| D4 | **Convex is canonical**; CMS composed from existing primitives per ADR-4; no separate headless-CMS DB | blueprint §9 |
| D5 | Passwordless **email OTP is the current sign-in model** (guest/anonymous removed); no password provider exists, so no reset-password link may be shown | T0.2, blueprint §5 BP-02 |
| D6 | Source-of-truth order: owner/security → code+tests → contracts → ticket prose; **T2.5 "done" is disproven by code and must be reconciled, not trusted** | blueprint §1 |

## 5. Unresolved questions / blockers (owner input)

Numbering used across chats: **O** = owner decision (blueprint §9 + STATUS §6),
**B** = environment/asset blocker found in chat 0.

| ID | Question | Blocks | Can proceed meanwhile |
|---|---|---|---|
| **B1** | **Missing reference documents.** Not present anywhere in this workspace: `MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md`; pack files `01–09` (only `README`, `STATUS`, `10-build-backlog` exist) including the blueprint-named `04-adrs.md`, `05-design-system.md`, `07-ai-agent-config.md`, `08-module-contracts.md`; `MOSAI-READINESS-AUDIT-2026-09-23.md`. Please provide them (paste/upload). | BP-01 "bring the missing reference documents into the pack"; BP-09/S3 eval floors (from `07`); ADR-dependent choices (ADR-3/4/6/7) in BP-13/14/15 | BP-01's test/CI repairs; everything not needing those texts. If unprovided, BP-01 records them as permanently missing with documented impact — **the blueprint forbids inventing their content** |
| **B2** | **Git is blocked** ("Vly manages version control"). Cannot run `git status/diff/log`, history secret scan, or attach CI evidence to a commit from this environment; GitHub CI run 35790335737 not verifiable from here. | BP-01 history investigation, working-tree cleanliness proof, "CI evidence attached to the exact commit" | All local gates (`bun run check`, `test:e2e`, `test:a11y`, `check:codegen`), file-level inspection, unit regressions. Options: enable git, or you run git/GitHub steps and paste results, or record as owner-run evidence |
| **B3** | `.env.keys` and `.env.local` still sit at the repo root; T0.1's rotation/history-purge owner actions are outstanding. Never read, printed, committed or allow-listed. **CI-confirmed 23 Sep 2026 (two runs, same result):** implementation `d3f6a8e` / run `35828575954` and documentation `dd9c163` / run `35830549968` — in both, the `security` job fails at the working-tree scan (tracked `.env.keys`, value redacted) and `security-history` fails at the full-history scan; **release gate blocked until both pass through owner remediation, never through weakened rules or allow-lists** (checklist: `docs/implementation/reports/BP-01-repair-baseline.md` § *Owner remediation checklist*). | BP-01 acceptance "all CI jobs pass" + release gate (implemented_unverified stays) | All code work; the runbook exists (`docs/runbooks/secret-rotation.md`) |
| **O1** | Owner selected the **Stripe test catalog** for current package prices and **period-end cancellation**. Final add-on terms, proration/discount rules and live catalog approval remain open. | BP-06/S1 real test-provider cancellation verification, BP-06/S3 final pricing display | catalog abstraction, reconciliation tests, admin auth (blueprint §9) |
| **O2** | Sign-in model beyond OTP; **approved transactional email service + sending domain** (T0.8/ADR-9) | BP-02 email-gateway implementation, BP-17/S2 real sends | OTP error/focus/rate-limit tests, gateway interface, all non-send work |
| **O3** | Owner selected **EU/EEA with English-only first release** on 24 Sep 2026. The other 14 requested languages are deferred until the owner asks for later phases: German, French, Italian, Spanish, Polish, Dutch, Romanian, Greek, Hungarian, Czech, Swedish, Portuguese, Bulgarian, Danish. Specific EU data-processing and residency requirements remain open. | capability matrix fill (STATUS §5 #4), verified localization claims in later phases, BP-20 residency rows | English-first UI, provider capability matrix, data inventory |
| **O4** | **Public customer domain + site-host deployment adapter** (hosting ADR) | BP-13/S2 real deployment/domain verification, public-origin proof | published-only projection, immutable releases, renderer tests (§9) |
| **O5** | **App sandbox/backend host + portability promise** (ADR-3 spike) | BP-15/S2 deploy claims, BP-15/S3 export promise | source graph, runner interface, budgets, adversarial test spec |
| **O6** | Precise Stripe Connect model; merchant tax/shipping/refund requirements; supported markets | BP-14/S2–S3 money movement details | catalog/readiness, test webhook infra, order state model |
| **O7** | Provider app approvals, scopes, **test accounts** (Google Ads dev token, Meta/TikTok apps, GA4/GSC properties, email OTP inbox) | *Operational* evidence for BP-12/S2, BP-16, BP-18, J01 real-inbox | contract fixtures, `needs_setup` states, adapter code |
| **O8** | (STATUS §6) cut-line rule ADR-8; app-builder audience (#5); app backend location (#6); "Conductor" naming (#7) | BP-15 defaults, BP-19/20 scope details | most code work |
| **O9** | RPO/RTO and backup scope for BP-20 | BP-20 restore claims | defining safe logs/metrics/runbooks |

Per blueprint §9: do not block all work on these — only the dependent operation
stays pending, and the chat records `blocked` with the specific dependency.
**No passwords/API keys may be requested in plaintext conversation.**

## 6. Tests and external evidence needed (per package)

"Implemented" needs reviewed code + green regression/contract tests; "operational"
additionally needs an approved real-provider journey with a stored receipt
(blueprint §2). Minimum per package:

| Package | Code-level evidence (tests) | External evidence still needed |
|---|---|---|
| BP-01 | all CI jobs green on the commit; planted secret fails scan; broken CTA/redirect fails e2e; skipped/expected-failure inventory documented; STATUS matches code | **Runs `35828575954` (impl `d3f6a8e`) and `35830549968` (docs `dd9c163`) obtained 23 Sep 2026: install/typecheck/lint/unit/codegen/e2e/a11y passed on both exact SHAs; both security jobs FAILED both runs (tracked `.env.keys` + historical credential) — not green, not allow-listed; history findings stay owner-side (needs B2/B3) until remediation makes a later run fully green** |
| BP-02 | `tests/unit/auth-lifecycle.test.ts`, `tests/e2e/auth-lifecycle.spec.ts`: OTP sign-in, expired/wrong/resend, backend-down retry, returnTo rejection, non-admin denied, keyboard paths | real OTP inbox delivery (O2/O7) |
| BP-03 | `tests/unit/publish-truth.test.ts`: client cannot write live/published/paid/sent or SEO/WCAG booleans; failed release keeps previous; badge opens receipt | none until BP-13 deployment (then real deploy receipt) |
| BP-04 | `tests/unit/{social-execution,credential-refresh}.test.ts`: correct credential ID to adapter, refresh via action, revoked→reconnect, concurrent-refresh lease, one failure ≠ batch abort | controlled provider refresh test after configuration (O7) — not a campaign blast |
| BP-05 | `tests/unit/account-lifecycle.test.ts` + existing deletion-completeness: free/paid, sole/shared/last-owner, cancel deletion, overdue job, outage, partial retry, cross-tenant denial; unregistered table fails CI | Stripe subscription check proven against live test mode; no deletion of live data without explicit authorization |
| BP-06 | extend `billing.test.ts`/`entitlements.test.ts`: display=checkout, webhook dup/ordering, org isolation, add-on gates, promotion failures, non-admin denied | Stripe catalog projection + cancellation confirmed by provider (O1, test mode) |
| BP-07 | `tests/unit/job-execution.test.ts`: single logical operation under concurrency, timeout reconciliation, late-worker loss, stale approval refused, capability removal stops queue, loop→dead-letter | none local; provider idempotency where supported |
| BP-08 | wrong-tenant/state replay fails; account selection; reconnect; sync freshness; disconnect stops jobs | real OAuth dances per provider (O7) |
| BP-09 | `tests/ai/`: tenant isolation, forged snapshot rejected (R4 flips green), injection cannot alter tools/args, budget metering, invalid output never published | eval floors measured vs `07` doc (B1); provider spend accounting |
| BP-10 | `tests/unit/source-provenance.test.ts`: conflicting facts, blocked pages, malicious redirects, same-name businesses; distinct missing-key/empty/timeout/ratelimit states; correction propagates + staleness flags | extraction-quality review on real business examples (O7 keys) |
| BP-11 | `tests/e2e/base-journey.spec.ts`: reviewed source → evidence-linked persona → journey → approved content reused by another module at exact versions | none |
| BP-12 | per slice: denied-consent ⇒ zero tracking requests; one order ⇒ one deduped event/destination; repeat import ⇒ no double count; revocation/staleness visible; recommendation reproduces from stored observations | real GA4/GSC/Matomo/PostHog properties (O7) |
| BP-13 | JS-disabled public render of correct tenant; draft inaccessible; bad publish preserves old site; keyboard form journey; sanitization/axe gates stay green | verified public domain + TLS receipt (O4/O7) |
| BP-14 | signed-out test checkout; forged/dup webhook no payment; no oversell; refund/fulfillment reconcile; cross-tenant catalog isolation; consent≠purchase | Stripe Connect test-mode receipts, feed acceptance by external endpoint, Shopify store webhooks (O6/O7) |
| BP-15 | CRUD/auth/app CRUD app builds, persists, tenant-isolated; malicious code cannot reach metadata/internal nets/secrets; cost limit pauses; export in clean env | sandbox provider selection (O5) + real deploy/rollback receipt |
| BP-16 | contract fixtures per provider: connect→select→validate→create paused→approved change→metrics→pause/revoke; partial-failure compensation; no unexpected spend | Google/Meta/TikTok approved test accounts (O7); OpenAI Ads stays `unavailable` until official docs prove it |
| BP-17 | duplicate imports; unsubscribe-during-delay blocks send; dup trigger ⇒ no extra message; suppressed/erased excluded; stop prevents future actions; role-protected exports | ESP provider receipts + sender authentication (O2/O7) |
| BP-18 | schedule→publish→receipt per destination; restart/tz/expiry recovery; partial failure does not duplicate; revoke blocks queued send; unsupported inbox ops show no working control | real approved test post + threaded reply on each supported provider (O7) |
| BP-19 | state-coverage checks (loading/empty/error/partial/locked/unavailable each with a next step); keyboard/reduced-motion/reflow/token audits stay green | observed sessions: ≥5 nontechnical users, benchmark ≥4/5 task success, 0 critical live/paid misreadings (owner coordinates participants) |
| BP-20 | gates documented and green: `check`, `test:e2e`, `test:a11y`, `check:codegen`, build; new module-alone/pairwise/removal + registry checks implemented *before* being called gates | restore drill in isolated env (O9), provider-outage exercise, release-proof rows with commit/environment/role/fixture/time, redacted artifacts |

## 7. Reconciliation findings (chat-0 verification, 23 September 2026)

Verified directly in this tree — the audited defects are **still present**:

1. **False live state (BP-03):** `src/convex/buildWorkspace.ts` — `publishSite`
   (`moduleMutation("build")`, ~L157) patches `status: "live"` after database
   edits (~L224–225). Confirmed.
2. **Credential refresh in mutations (BP-04):**
   `src/convex/social/credentials.ts` — `fetch(env.tokenUrl, …)` at L56 inside the
   path used by `refreshIfNeeded` (`internalMutation`, L81); `getCredId`
   (`internalQuery`, L89) returns a document while
   `social/executor.ts` L194 fetches it as `credId` (cast to re-verify).
   `src/convex/ads/credentials.ts` — same shape: `fetch` L42,
   `refreshIfNeeded` `internalMutation` L79, `getCredId` L87. Note the partial
   fix already present: `social/executor.ts` has its own `executor.getCred`
   internal query (~L212, comment "action-safe" L238) — verify before rebuilding.
3. **T2.5 discrepancy confirmed (BP-05 / blueprint §1):**
   `docs/tickets/T2.5-…md` header says **Status: done**, but
   `src/convex/lib/dataRegistry.ts` L2 still labels itself the **T2.1 seed**,
   `billing.deleteAccount` (L386) and `requestAccountDeletion` (L367) are still
   the old immediate mutations, and `src/convex/crons.ts` contains **no
   finalizer** (grep for `finalizer|registry` returns nothing). Ticket prose is
   not proof — reconcile in BP-05 before editing.
4. **Placeholder backend in CI (BP-01):** `.github/workflows/ci.yml` L162 and
   L182 fall back to `VITE_CONVEX_URL: https://placeholder.convex.cloud` for the
   e2e/a11y jobs. Confirmed.
5. **Smoke test state (BP-01):** `tests/e2e/smoke.spec.ts` exists (31 lines;
   asserts H1 copy, "mosai", CTA → `/auth`, "Get Started", OTP placeholder,
   404). `STATUS.md` claims 13 e2e passed locally while the blueprint says the
   baseline CI run failed — **reproduce first** (BP-01's opening step) rather
   than trusting either claim; local reproduction is possible (bun 1.3.14,
   Playwright chromium-1243 installed).
6. **Missing documents (B1):** glob confirms no
   `MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md`, no pack `01–09` files, no
   `MOSAI-READINESS-AUDIT-2026-09-23.md`, and the workspace copies
   `04/05/07/08` are absent. `docs/tickets/README.md` says T2.5–T2.16 and
   E3.1–E3.10 ticket files are "create when reached" — expected, not a defect.
7. **Environment constraints:** git commands blocked (B2); Freebuff runs
   `bun convex dev --once` + `tsc -b --noEmit` after every turn that touches
   `src/convex/` or TypeScript respectively; dev servers must never be started
   or killed manually; no full `bun run build` unless asked.
8. **Baseline match:** `.git/refs/heads/main` =
   `a3edd69bf813e4705f9d189fe43079aee3f2257e` = blueprint baseline; file mtimes
   (Sep 19–22) are consistent with that checkout, but **working-tree cleanliness
   could not be proven** without git (B2) — each implementation chat must
   re-inspect before editing and preserve unrelated changes.

## 8. Chat-1 outcome and next chat

**Chat 1 = BP-01 — done (implemented_unverified), 23 September 2026.**
Report: `docs/implementation/reports/BP-01-repair-baseline.md`. Reproduced
every documented gate first (`bun run check` red only at `scan:secrets` on the
tracked `.env.keys`; e2e 15+1 skipped; a11y 5; both audits exit 0; git and
gitleaks unavailable — B2/B3 re-confirmed); replaced the placeholder backend
with the test-only double (`tests/e2e/fixtures/test-backend.ts`), added
`auth-contract.spec.ts` and the opt-in `otp-live.spec.ts`, updated the smoke
assertions to the current copy, split the CI history scan into its own job,
added SHA-named 7-day failure artifacts, fixed a real `list`/`listitem` axe
defect in `Landing.tsx`, corrected the stale claims in `STATUS.md`, reconciled
T2.5 as **not implemented** (BP-05 owns it), and recorded the missing B1
documents in `STATUS.md` §7 without inventing their content. Acceptance
demonstrations: broken auth, wrong CTA navigation and a planted synthetic
secret each failed the relevant gate and were reverted to green (outputs in
the report). **CI reconciliation (independent checks, 23 Sep 2026):** two commits, two
runs, identical outcome — implementation
`d3f6a8e09e301944789dc2c4487a831dc7698137` → run `35828575954`, and the
documentation commit
`dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` (this report + PROGRESS + STATUS;
current local `.git/refs/heads/main`) → run `35830549968`. Both runs
completed/**failure**: install/typecheck/lint/unit/codegen/e2e/a11y
**passed on the exact SHA**; **both security jobs failed** at their
secret-scan steps (working tree: tracked `.env.keys`; full history: ≥1
historical credential — values redacted, never reproduced). The split is
proven (the history failure no
longer skips the working-tree scan), but **BP-01 stays
`implemented_unverified` and the release gate is BLOCKED; CI must never be
described as green** until a later run passes both security jobs through the
owner remediation checklist (report § *Owner remediation checklist* — what
Freebuff may do vs. what requires owner action). Any new commit (including
future doc edits) triggers a fresh run — its result must not be claimed
before it exists. Remaining for the owner:
rotate/untrack the exposed credentials (never allow-list), authorize + run
the history purge, provide B1 documents.

**Chat 2 = BP-04 — done (implemented_unverified), 23 September 2026.**
Report: `docs/implementation/reports/BP-04-social-credential-refresh.md`.
Re-ran the documented gates before editing (`check` red only at the
pre-existing `scan:secrets`; audits/codegen/e2e/a11y exit 0; ref read from
`.git/refs/heads/main` = `e25639d4eb39511b859dad8d0b583c44a061814c`, later
than `dd9c163`, CI unknown — git blocked, B2); wrote the two regression files
first and proved them RED against the unfixed code (10/10 failed: the
`[object Object]` doc-to-ID cast at `executor.ts`, Convex's "fetch is not
supported in queries or mutations", missing claim/registry entries); then
fixed all three defects — typed `getCredential` query + `credential._id`
handoff (ads `cred._id` contract preserved), refresh moved into the new
`social/credentialActions.ts` / `ads/credentialActions.ts` internal actions
with query→claim(lease+version)→fetch→conditional-save/release, rotated
refresh tokens saved, OAuth reconnect resets `refreshStatus`/`tokenVersion`,
provider errors redacted to `HTTP <status>` in all five social adapters, and
refresh failure isolated to the individual post while the due batch
continues. Registry entries added for both new files. After: 10/10 new tests
and 305/305 unit green; typecheck/lint/audits/codegen/e2e/a11y exit 0;
`bun run check` still exit 1 at the same pre-existing secret-scan finding (no
new failure, never claimed green). **Main-branch workflow exception
(owner-approved for BP-04 only):** Vly autosave on main — no manual
commit/push/PR/deploy; the usual one-ticket/one-branch/one-PR process was NOT
followed and is not claimed. Real-provider refresh proof pending (O7);
BP-01 stays `implemented_unverified` and the release gate stays BLOCKED
(B3).

**Chat 2 review follow-up (same chat, 23 Sep 2026):** GitHub review of code
commit `e6f91b9` / docs `f9510fc` found two gaps; both fixed with tests —
(1) refresh now honors `tokenExchange: "basic"` for LinkedIn/X (Authorization
header, credentials out of the form; form exchange preserved for the rest;
red-first: LinkedIn/X request-shape tests failed with `expected '' to be
'Basic …'` before the fix), (2) provider-supplied JSON `error` strings are
gated by an explicit allowlist **at the message site** in both
credentialActions (adversarial marker tests prove raw strings never reach
posts/outcome messages; recorded honestly: those marker tests were green
against pre-fix code because the old `grantRejected` coupling incidentally
blocked the site). Round-2 gates: BP-04 suites 16/16, unit **311/311**,
tsc/lint/audits/codegen/dev-check exit 0, e2e 15+1, a11y 5, `bun run check`
exit 1 **kept red** at the pre-existing secret-scan finding. Status
`in_progress` during the fixes → **`implemented_unverified`** after they
passed; real-provider proof (O7) still pending; CI for `e6f91b9`/`f9510fc`
unknown (B2) and never assumed. Details in the report's *Review follow-up*
section.

**Chat 3 = BP-03 — stop false publishing/readiness** (blueprint §10 order:
BP-01 → BP-04 → BP-03, prepare BP-05; backlog T2.13). Entry checks: re-read
AGENTS.md, the blueprint §5 BP-03 (+ §§6–11), this file, and both prior
reports; re-verify the audited defect is still present (`src/convex/buildWorkspace.ts`
`publishSite` — `moduleMutation("build")` — patches `status: "live"` after
database edits, §7.1); current code outranks ticket prose; run the documented
gates before editing; never weaken a gate to go green. Scope guardrails:
truthful labels are allowed before BP-13's deployment exists (§5 BP-03),
`StatusBadge`/ReceiptBadge are the status UI (rule 15), client-callable
mutations must never write `live`/`published`/`paid`/`sent` (rule 5),
planned test file `tests/unit/publish-truth.test.ts` (§6); keep BP-04's
receipt/`needs_reconnect` semantics intact and stop at the BP-03 boundary.

**BP-03 — done (implemented_unverified), 23 September 2026.**
Report: `docs/implementation/reports/BP-03-publish-truth.md`. Wrote the
10-test regression suite first against the unfixed tree (red-first record in
the suite header); then fixed: `builds.update` no longer accepts external
`status`/`seoReady`/`wcagReady` (validator-removed, nothing written);
`publishSite` validates-before-mutates, promotes drafts canonically, writes
the server-only `buildReleaseAudits` audit pinned to revision ids +
`READINESS_RULE_VERSION`, records `releaseState: "prepared"` — and never
writes `sites.status="live"`/`builds.status="published"` (no deployment
exists before BP-13); new `builds.getReadiness` derives readiness via
`contentFingerprint` pin equality (content edit ⇒ `content_changed`); new
`buildWorkspace.getSiteDelivery` (deployment `null`, honest labels,
`requireProject` guard); campaigns stamp `trackingSource: "local"`, refuse
client lifecycle writes on provider rows, expose `getDelivery`; new
`src/shared/contracts/status.ts` (phase vocabulary, tone classifier,
`contentFingerprint`) and `src/components/app/ReceiptBadge.tsx` (verified
without a receipt demoted at render; verified anchor opens the real stored
receipt); removed the fake `state="verified" href="#"` badge in
`BuildWorkspace.tsx` (legacy verified now shows `requires_verification`,
failed shows "last confirmed release intact"). Legacy pre-BP-03 rows stay
readable as `requires_verification` with no invented receipt.
`buildReleaseAudits` + `buildDeployments` registered in
`cascadeDeleteProject`'s `PROJECT_TABLES` with deletion fixtures (fixture
regression failed first). BP-04's receipts/reconnect/lease-version/redaction
preserved untouched; no BP-13 work (no adapter, no `buildDeployments`
writer, no public URL). Gates: unit **324/324**, tsc/lint/codegen/
audit:functions/audit:capabilities exit 0; `bun run check` exit 1 **kept
red** at the same pre-existing secret-scan finding (B3, never weakened);
e2e/a11y not re-run here (badge-swap-only UI change) — recorded, not
assumed. **Main-branch workflow exception (owner-approved for BP-03 only):**
Vly autosave on main — no manual commit/push/PR/deploy; the one-ticket/
one-branch/one-PR process was NOT followed and is not claimed; the exception
does not carry to BP-02 and waives no gate. CI for the autosaved tree
unknown (B2). BP-01/BP-04 stay `implemented_unverified`; release gate stays
BLOCKED (B3).

**BP-03 fifth review follow-up (23 Sep 2026, isolated checkout `codex/bp-03-final`).** Compatibility review found that `buildReleaseAudits.routes[].title` was required although the immediately preceding writer omitted it, and the documented pre-snapshot fallback was not implemented. The schema now accepts missing titles. Public delivery fails closed for a verified audit with no route snapshot or any route lacking frozen title metadata; it does not infer routes/title/SEO from mutable CMS rows. Red-first regressions cover both legacy shapes and both public readers; snapshot-complete verified A still serves across B prepare/fail. No migration rewrites rows. This can withdraw a historical release that lacks complete route snapshots; current code has no verified-phase writer (only `draft_approved` and `release_prepared`), but historical persisted rows were not inspected. Recovery is a fresh BP-13 deployment verification, not a fabricated/backfilled receipt. Rollback requires assessing existing rows first; never reconstruct from mutable CMS data. Focused suite 21/21 after the fix. Browser follow-up: without `VITE_CONVEX_URL`, Vite starts but the app is blank (reviewer: first five browser tests failed; run interrupted, exit 130). `src/main.tsx` constructs Convex client with that value; `.env` is absent. With an inert syntactically valid URL, controller reports full e2e 15 passed/1 real-OTP skipped (exit 0, 33.6s) and focused landing a11y 1/1; this agent independently ran smoke 2/2 with the test-only URL. Browser failure is setup, not BP-03. Exact gates are in `reports/BP-03-publish-truth.md`. BP-02 remains isolated and owner-blocked for provider/domain and step-up decisions; untouched.

**BP-03 review follow-up (same chat, 23 Sep 2026, GitHub main `be1ade5a`,
CI run 35866805693: exact-SHA CI passed unit/typecheck/lint/codegen/e2e/a11y;
both security jobs failed on the known secret findings — release stays
BLOCKED, and CI is not called green).** Two correctness gaps found by review,
both fixed red-first: (1) `publishSite` was skip-and-promote — an
invalid/empty page was skipped while valid pages were promoted, a partial
release with no blueprint clause permitting it; preparation is now
all-or-nothing with a per-page problem list (nothing mutates when any page
fails), proven by valid+invalid-mix and empty-page regressions. (2)
`cms.getPublishedByPath` and `storefront.getPublishedPage` served approved
content before any deployment; both are gated by the new
`src/convex/lib/deliveryGate.ts` — external serving requires the receipt
chain (audit phase `verified` + deployment `succeeded`, server-written
only), a later failed deployment supersedes an older verified one, owner
preview preserved via `getPreviewData`/`getReadiness`; regressions prove
both paths serve nothing after preparation alone and content after a
simulated server-written verified deployment. `publishSite` return is now
`{ prepared }` (no "published" wording) and the workspace toast says
"prepared — not live yet". Gates after: unit **328/328** (14/14 BP-03),
tsc/lint/codegen/audits exit 0; `check` still exit 1 only at the pre-
existing secret-scan finding (B3). e2e/a11y not re-run locally; CI for the
post-`be1ade5a` autosaved commits is unknown (B2) and not assumed. BP-13
still not implemented. BP-03 main-branch exception does NOT carry to BP-02.

**BP-03 second review follow-up (same chat, 23 Sep 2026, GitHub commit
`d8d8c35`, CI run 35870794832: unit/typecheck/lint/codegen/e2e/a11y passed
on that exact SHA; both security scans failed on the known secret findings;
release stays BLOCKED; CI not called green).** One remaining acceptance gap
fixed red-first: the delivery gate read only the newest audit and resolved
pages via the mutable `publishedRevisionId` pointer, so after A verified +
B merely prepared (or B failed) both public paths served nothing — and a
naive fallback to A's audit would have leaked B content. `deliveryGate` now
selects the **last confirmed release** (newest audit with verified phase +
succeeded deployment; a newer prepared/failed audit no longer disqualifies
it) and readers resolve pages from the audit's **pinned revisions** (never
the current pointer); B-only pages stay hidden until B verifies, and B
redirects resolve only once their target page is pinned by the confirmed
release. Regressions: A verified → B prepared → B failed (both paths keep
serving A's pinned revision, by id and document) → B verified (both serve
B); new page + redirect from B hidden until verification. Gates: unit
**330/330** (16/16 BP-03), codegen/tsc/lint/audits exit 0; `check` exit 1
only at the pre-existing secret-scan finding (B3). e2e/a11y not re-run
locally; CI for commits autosaved after `d8d8c35` unknown (B2), not
assumed. **Handoff correction:** BP-02 is sign-in/recovery/privileged
access (NOT "fix the CI pipeline"); BP-02 is already in progress by Codex
in an isolated branch — do not start or overwrite it. No BP-13 adapter or
real publish added.

**BP-03 third review follow-up (same chat, 23 Sep 2026, GitHub main
`d3434a64`, CI run 35875669379: unit/typecheck/lint/codegen/e2e/a11y/install
passed; both security jobs failed on the known secret findings; release
gate stays BLOCKED; CI not called green).** One more last-confirmed-release
gap fixed red-first: `cms.updatePage` moves a published page's fullPath and
auto-creates the 301 immediately, while both public readers resolved paths
via the live `by_site_path` index — a slug move for unverified B cut off
A's confirmed route and B's new path served A's content (leak). Fix: the
release audit now snapshots `routes` (fullPath → pinned revision) and
`redirects` (fromPath → target) at preparation; `selectConfirmedRelease`
exposes them and both readers resolve externally through the snapshot,
which is AUTHORITATIVE when present (pin-based index fallback only for
legacy audits without a snapshot — skipped otherwise, because a pin lookup
by page id would serve A's revision under B's new path). Regression: A
verified at / → slug moved to /new for B → before B verification and after
B's failure, / still serves A on both readers, /new and B's redirect stay
hidden; after B verifies, /new serves B (homepage moves carry no auto-301
by updatePage's oldPath!=="/" guard). Also fixed a same-millisecond
tie-breaker in newest-audit selection (createdAt then _creationTime).
Schema change additive/optional — no migration. Gates: unit **331/331**
(17/17 BP-03), codegen/tsc/lint/audits exit 0; `check` exit 1 only at the
pre-existing secret-scan finding (B3). e2e/a11y not re-run locally; CI for
commits autosaved after `d3434a64` unknown (B2), not assumed.

**BP-03 fourth review follow-up (same chat, 23 Sep 2026, GitHub main
`61f0605`, CI run 35878361142: application/e2e/a11y passed; BOTH SECURITY
JOBS STILL FAILED — never called green; release gate stays BLOCKED).** Two
snapshot gaps fixed red-first: (1) storefront's live-redirect fallback
keyed on `redirectsByPath.size === 0`, which an intentionally empty new
snapshot also matches — a non-homepage slug move's auto-301 leaked before
B verified; fallback now keys on snapshot ABSENCE (`audit.redirects ===
undefined`, pre-snapshot legacy audits only); regression: /old serves A
(not the redirect) before verification and after B's failure, redirect
resolves after B verifies. (2) both public readers served mutable
page title/SEO and checked mutable page.status; the route snapshot now
carries metadata frozen at preparation (`routes[].title/seo`) and both
readers serve it with no live-status check; regression: A metadata serves
across B prepare/fail, B metadata appears only after verification. One
existing test reordered (redirect inserted before B's preparation, as the
snapshot semantics require) — not weakened. Schema additive/optional. Gates:
unit **333/333** (19/19 BP-03), codegen/tsc/lint/audits exit 0; `check`
exit 1 only at the pre-existing secret-scan finding (B3). e2e/a11y not
re-run locally; CI after `61f0605` unknown (B2), not assumed. BP-02
untouched; no BP-13 adapter or real publish.

**Chat 4 = BP-02 — sign-in, recovery and privileged access** (blueprint §10
Order A, fourth; prepare BP-05). Entry checks: specified clean isolated
worktree `bp-02-codex`, branch `codex/bp-02-auth` at
`be1ade5a6832418a455d7086037c18c34130c245`; preserve OTP-only D5; avoid all
BP-03-owned paths. The session audit was attempted but could not write its
central proposal under `~/.hermes` (sandbox `PermissionError`). Implementation
report: `docs/implementation/reports/BP-02-auth.md`. Return-path allowlist,
generic OTP send/resend errors, invalid/expired-code recovery copy, connection
timeout/retry, and hermetic browser regressions are implemented. Existing
admin API guard and direct non-admin denial tests are present and unchanged.
Email provider/domain O2 and T2.8 privileged step-up policy remain blocked;
no live OTP/account proof. Lint (0 errors/28 existing warnings), typecheck,
333/333 unit tests, both audits, full e2e (20 passed, 1 opt-in live OTP
skipped), and a11y (5/5) passed. Red-first timeout regression failed with the
timeout extended to 150s, then passed at the restored 15s value. `check:codegen`
is blocked by missing `CONVEX_DEPLOYMENT`; `bun run check` remains exit 1 at
the existing `.env.keys` secret scan finding (value redacted; unchanged). The
session audit could not write its central proposal under `~/.hermes`.
`rtk git diff --check` passed. Status is `implemented_unverified`, not
complete.
