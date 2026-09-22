# 10 — Build backlog for LLM and human implementers

Tickets are ordered. **Do not start a phase until the previous phase's gate
passes.** Each ticket is self-contained: an implementer needs `AGENTS.md`, this
ticket, and the files named in it. Symbols follow the blueprint: `[R]` rework ·
`[N]` new · `[D]` delete · `[M]` migrate · `[G]` gate. Sizes: S ≤ 0.5 day,
M ≤ 2 days, L ≤ 1 week (for one implementer, as a planning guide).

**Check `STATUS.md` in this folder before starting any ticket** — Phase 0 is
substantially complete as code, and re-doing it wastes a session.

**How to run any ticket:** (1) `git rev-parse HEAD`, note the baseline; (2) write
the regression test named in the ticket and watch it fail; (3) implement the
smallest change that passes; (4) run the project's check command (after T1.5);
(5) fill the PR template below; (6) stop at the ticket's scope.

**PR template (from blueprint §21):** *Outcome · Scope · Before · After · Data
migration · Security and privacy · Verification · Proof.*

**Owner decisions needed before or during a ticket are marked ⚑.**

---

## Phase 0 — Stop the exposure (do these first; the repo is public)

### T0.1 — Rotate and remove committed secrets `[D][N]` S ⚑ — 🟡 code done, owner action outstanding

- **Why:** a committed API key and the dotenvx private key are public
  (`src/convex/auth/emailOtp.ts`, `.env.keys`, commit `6d343a7`).
- **Owner action first:** revoke the email service key (ask the platform provider
  to rotate it, or drop that service in T0.8); re-key dotenvx and re-encrypt
  environment files; treat both as compromised.
- **Do:** delete `.env.keys` from the tree; extend `.gitignore` with `.env*`
  except `.env.example`; in `emailOtp.ts` read the key from an environment
  variable and stop rethrowing `JSON.stringify(error)`, throw a generic error and
  log only the HTTP status; add `docs/runbooks/secret-rotation.md` including a
  `git filter-repo` history purge and force-push procedure; add a gitleaks config.
- **Don't:** print or paste any key value into code, tests, tickets or chat.
- **Acceptance (R11):** secret scan of full history on the default branch is
  clean; the old key is rejected by a test call; CI fails on a planted dummy
  secret.
- **Done in code:** env indirection, generic error, `.gitignore`, `.gitleaks.toml`,
  runbook. **Outstanding:** the owner's rotation and the history purge.

### T0.2 — Remove anonymous sign-in `[D]` S — ✅ done

- **Files:** `src/convex/auth.ts`, `src/pages/Auth.tsx`, `src/convex/schema.ts`
  (keep the optional `isAnonymous` field), `src/convex/guards.ts`.
- **Acceptance (R1):** a client cannot sign in anonymously; an existing anonymous
  user is rejected by every guarded function.
- **Done:** provider removed, guest UI removed, and `guards.ts` now rejects
  `isAnonymous === true` in `maybeUser`, `requireUser` and `requireActionUser`.
  Still needs an automated test (T1.7).

### T0.3 — Free by default; no client plan changes `[R]` S — ✅ done

- **Files:** `src/convex/billing.ts`, `src/components/app/AppShell.tsx`,
  `src/convex/guards.ts`, `src/pages/app/Billing.tsx`.
- **Done:** `DEFAULT_PLAN = "free"`; `changePlan` gated behind
  `PLAN_SELF_SERVE`; one `assertModule` (in `guards.ts`), the `billing.ts` copy
  deleted and its importer updated. Still needs an automated test (R2).

### T0.4 — Authenticate AI and scraping actions; load context on the server `[R]` M — 🟡 half done

- **Actions (17):** `ai.ts` — `detectContentGaps, suggestTopics, generateContent,
  editSelection, generatePersona, personaChat, generateJourneyMap, generateJourney,
  generateComms`; `research.ts` `researchTopic`; `sellAI.ts` `generateDescription,
  generateAltText, generateSeo`; `scraping.ts` `scanWebsite, lookupGoogleBusiness`;
  `buildPlan.ts` `generateBuildPlan, generatePageDraft`. (`social/copilot.ts`
  `draftVariants` and `suggestSchedule` authenticate but do not check ownership;
  fix them too.)
- **Do:** add a `requireUserInAction(ctx)` helper ✅ done as `requireActionUser`;
  replace the client-supplied `projectSnapshotValidator` argument with `projectId`,
  verify ownership through an internal query, and build the snapshot on the server
  with the same shape so prompts are unchanged ❌ **still open**; add a per-user,
  per-minute limiter (small `rateLimits` table) ❌ **still open**; update client
  call sites ❌ **still open**.
- **Don't:** change prompts, models or output shapes in this ticket.
- **Acceptance (R3, R4):** every listed action rejects unauthenticated callers
  (✅); a fabricated snapshot argument is not accepted (❌); exceeding the limit
  returns a clear error (❌).

### T0.5 — `safeFetch` and SSRF guard `[N]` M — ✅ done

- **Files:** `src/convex/lib/safeFetch.ts`; used in `scraping.ts` and every other
  fetch of a user-supplied URL.
- **Acceptance (R5):** requests to `localhost`, `127.0.0.1`, `10.0.0.1`,
  `169.254.169.254`, a public URL that redirects to a private address, and
  `http://` are refused; a normal HTTPS site succeeds. Needs an automated test.

### T0.6 — Ownership fix and public-function audit `[R][N]` S — ✅ done

- **Files:** `src/convex/collections.ts` (add an ownership check), `guards.ts`
  (`requireProject`), `scripts/audit-public-functions.mjs`,
  `scripts/public-functions-allowlist.json`.
- **Acceptance (R6):** user B cannot create a collection in user A's project ✅;
  the script fails on a newly added unguarded function ✅ (`bun run audit:functions`).
- **Follow-up found by the audit:** 8 public functions authenticate but never
  authorize, and 81 authorize inline instead of via `requireProject` — see
  `STATUS.md` §5. Migrating them is T2.2's job.

### T0.7 — Sanitize HTML and add a content-security policy `[R]` M — 🟡 half done

- **Files:** `src/components/cms/PageRenderer.tsx`, `src/pages/app/Build.tsx`,
  `src/convex/cms.ts` (richText save), `index.html`.
- **Do:** a shared `sanitizeHtml` with an allow-list ✅ (`src/lib/sanitize.ts`),
  applied on render (client) ✅ and on save (server) ❌ — server side needs an
  isomorphic sanitizer because DOMPurify requires a DOM; add a CSP meta or header:
  no inline script, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors
  'none'`, with `connect-src` limited to the app's Convex domains ❌ **still open**.
- **Don't:** attempt origin separation here (that is T2.15).
- **Acceptance (R7):** `<script>`, `<img onerror>`, `javascript:` links and SVG
  script payloads never execute in the renderer, the draft preview, or after save
  and reload.

### T0.8 — Detach identity and OTP email from the template platform `[R][D]` M ⚑ — 🟡 partly done

- **Files:** `src/convex/auth.config.ts`, `src/convex/auth/emailOtp.ts`,
  `src/main.tsx`.
- **Owner decision:** choose the transactional email provider and sending domain
  (ADR-9, G10).
- **Do:** remove the `customJwt` provider for the template platform ✅; implement
  an `EmailGateway` interface with one provider adapter selected by environment ❌;
  send OTP through it ❌; remove the platform toolbar and its error boundary ❌;
  leave `@vly-ai/integrations` for AI until T2.9.
- **Acceptance (R12, auth path):** with platform variables unset, sign-in works in
  staging; no request goes to the platform's domains; tokens signed by the platform
  are rejected ✅ for the last clause.

### T0.9 — Disable the global Shopify sync `[R]` S — ✅ done

- **File:** `src/convex/shopifySync.ts`.
- **Acceptance (R9):** the sync action cannot read any store using
  deployment-wide variables ✅.

### T0.10 — Refuse fake connections `[R]` S — ✅ done

- **Files:** `src/convex/connections.ts`, `src/pages/app/Grow.tsx`,
  `src/components/app/module-kit.tsx`.
- **Acceptance (R8):** no client-callable function can write a `connected`
  status ✅.

**Gate G-P0:** R1–R9 and R11 pass; the owner confirms secrets are rotated; no
unauthenticated public function remains except the allow-list.

**Current standing:** every code hole except R4, R7-server-side and the T0.8
server-side items is closed, and R1–R12 now have an automated suite (T1.5 added
the runner; T1.7 wrote the tests) that runs in CI. R4 is the one test still red —
it is marked `blocked` on T0.4, not deleted.

---

## Phase 1 — Make the repository buildable and testable

### T1.1 — One package manager, a consistent lockfile `[R]` S ⚑
- **Owner decision:** bun (what the platform runs today) or npm (what the
  blueprint's commands assume). **Verified:** `bun.lock` **and**
  `package-lock.json` are both in the repository.
- **Do:** delete the unused lockfile; regenerate the chosen one; resolve the Tiptap
  peer conflict (`@tiptap/extension-collaboration-cursor@^2.26.2` sits next to
  Tiptap 3; `src` uses only `@tiptap/extension-collaboration`, so remove the cursor
  package or upgrade it); pin the runtime in `package.json` engines and `.nvmrc`.
- **Acceptance:** a clean install of the chosen manager exits 0 on a fresh clone.

### T1.2 — Convex codegen strategy `[R]` S ⚑
- **Recommended:** commit `src/convex/_generated` (remove it from `.gitignore`)
  and add a CI drift check; alternative: run codegen in CI against a dedicated dev
  deployment. Confirm current Convex guidance before choosing.
- **Why it matters:** with the folder absent, `tsc -b` reports unresolved
  `_generated` imports; the pack measured 1,067 errors on a clean checkout. With
  codegen present the project typechecks clean.
- **Acceptance:** `tsc -b` resolves all `_generated` imports on a fresh clone.

### T1.3 — Zero type errors `[R]` M
- **Do:** record the post-codegen error count first; fix without `@ts-ignore` or
  new `any`. **Current:** `bun tsc -b --noEmit` exits 0.
- **Acceptance:** `tsc -b` reports zero errors on a fresh clone through CI.

### T1.4 — Zero lint errors `[R]` M
- **Baseline (pack):** 79 errors (51 unused variables, 17 `any`, 11 React-hook
  rules; worst files `convex/storefront.ts`, `main.tsx`, `ContentEditor.tsx`,
  `PageEditor.tsx`, `Overview.tsx`). Re-measure — the tree has changed.
- **Acceptance:** `eslint .` reports zero errors; no disabled rules added.

### T1.5 — Test tooling and CI `[N]` M
- **Do:** add Vitest with a Convex test harness, Playwright, gitleaks,
  dependency audit at high level; scripts `check`, `test`, `test:e2e`; a CI
  workflow running the jobs in `06-test-strategy.md` §4 — including
  `bun run audit:functions`; add `AGENTS.md` and `docs/pack/` (already present).
- **Acceptance:** CI is green on the default branch; a deliberately broken commit
  fails each gate.

### T1.6 — Upgrade vulnerable dependencies `[R]` S
- **Baseline (pack):** `react-router` (high), `hono` (moderate). Re-audit and
  upgrade to fixed versions, then run the smoke journeys.
- **Acceptance:** production audit reports no high findings.

### T1.7 — Complete the Phase 0 regression suite `[N]` S — ✅ done (22 Sep 2026)
- **Do:** write R1–R12 and run them in CI (R10 deletion completeness generated from
  the schema; R12 platform-call assertion). Each one must fail against the
  pre-fix code.
- **Acceptance:** all twelve run in CI and pass. **Done:** 33 unit + 3 browser
  tests; R4 is `blocked` on T0.4 and kept red (`it.fails`). Writing R10 found and
  fixed a real cascade defect (`buildVersions`). See
  `docs/tickets/T1.7-phase0-regression-suite.md`.

### T1.8 — Accessibility quick fixes `[R]` S
- **Files:** `src/pages/Auth.tsx` (OTP `autoComplete="one-time-code"`, alert role
  for errors, focus management, resend with countdown), the two clickable
  `div`/`span` elements, live regions for async status, a skip link.
- **Acceptance:** axe reports zero serious violations on `/auth` and `/app`; a
  keyboard-only sign-in works.

**Gate G-P1:** install, codegen, typecheck, lint, unit, security and e2e jobs are
green on every PR.

---

## Phase 2 — Foundations (the shared spine; blueprint §6–§8, §14, §17 Releases A–B)

Each ticket below is expanded to the same detail as Phase 0–1 when it is picked
up; the outline gives files, steps and the acceptance test. Dependencies are
listed.

| ID | Title | Outline | Acceptance | Deps |
|---|---|---|---|---|
| T2.1 | Organizations, memberships, roles, invitations `[N][M]` | New tables; idempotent migration from `projects.ownerId`; agency client links; last-owner protection | Existing projects appear under a personal organization; roles enforced | G-P1 |
| T2.2 | Org-scoped function builders and generated cross-tenant tests `[R][N]` (ADR-2) | Extend `guards.ts` into `orgQuery/orgMutation/orgAction`; lint ban on raw `ctx.db` outside data access; test generator over the function registry; migrate the 81 inline ownership checks found by `audit:functions` | CI fails on an unscoped public function; 100% cross-tenant coverage | T2.1 |
| T2.3 | Capability registry and per-add-on entitlements `[R][M]` | Replace tier `PLAN_MODULES` and `AppShell` locks; capability states per blueprint §3; country matrix stub | Enabling or disabling an add-on changes routes, queries, mutations, actions and jobs consistently | T2.1 |
| T2.4 | Stripe Billing: checkout, portal, webhooks, dunning `[N]` ⚑ | Products per add-on; verified idempotent webhooks; reconciliation job; `past_due` → `wind_down` policy; MOSAI's own tax setup | Duplicate and out-of-order webhooks change nothing twice; entitlement drift 0 | T2.3 |
| T2.5 | Data registry, unified export and deletion, finalizer job `[N][R]` (G4, G9) | Register every table; one deletion engine replacing both cascades (start from `dal.cascadeDeleteProject`); grace-period finalizer cron; obligations inspector interface | R10 passes with the full schema; CI fails on unregistered tables | T2.1 |
| T2.6 | Events (outbox, inbox, dead letters) and job framework `[N]` (`08` §5) | Envelope with correlation, causation and hop; idempotent consumers; replay UI; shared job states | Duplicate delivery is a no-op; synthetic loop stops at hop limit | T2.1 |
| T2.7 | Connections framework, vault and receipts `[N][R]` (G24) | Per-project connections; envelope-encrypted tokens; OAuth state; refresh; revoke; migrate ad and social credentials; Shopify per project | Tokens unreadable in the database; disconnect revokes; receipts for external writes | T2.2 |
| T2.8 | Step-up authentication, passkeys, recovery `[N]` (G3) | Passkeys for owners and approvers; step-up for spend and destructive actions; recovery and change-email rules | Mailbox-only attacker cannot delete, change email or approve spend | T0.8, T2.1 |
| T2.9 | `ModelGateway` and `aiRuns` `[N][R]` (ADR-7, ADR-11) | Tiers, routing, budgets, structured output; move the five `vly.ai.completion` sites and the OpenRouter call in `ads/copilot.ts` behind it; retire the platform package | No direct vendor call in feature code; every call has a run record and budget | T0.4 |
| T2.10 | `ContextPack` and `ContextInspector` `[N][R]` | Server-built pack with origin labels; replace `ProjectSnapshot` (finishes T0.4) | Injection strings in scraped text cannot alter tool choice (red-team suite) | T2.9 |
| T2.11 | Prompt versioning, golden tests and eval harness `[N]` | `agents/<id>/prompt.vN.ts`; datasets and floors from `07` §9; CI job `ai-eval` | A prompt change below a floor blocks merge | T2.9 |
| T2.12 | Action registry and `ApprovalGate` `[N][R]` | Typed actions with risk tiers; approvals table; move ad and social executions behind the gate | No external spend or publish executes without an approval record | T2.2, T2.8 |
| T2.13 | `StatusModel` and `ReceiptBadge` `[N][R]` | Typed states and tones; migrate every `StatusBadge` use; success requires `receiptId` | Type check fails on a success badge without a receipt | T1.8 |
| T2.14 | Measurement contract, collector and consent manager `[N]` (G5, ADR-6) | Canonical events v2; browser adapters; consent gate; server forwarders with de-duplication; GTM template | Consent denied → zero analytics or ad requests; one purchase → one server conversion per provider | T2.6 |
| T2.15 | Public-origin separation and pre-rendering `[N][R]` (G23) | Separate registrable domain; server or pre-render public pages (React Router framework mode or equivalent); sitemap, canonical, head metadata. **Also fixes the fact that the storefront currently requires ownership to render at all** (`STATUS.md` §5) | Public origin cannot read dashboard storage; page content available without JavaScript | T0.7 |
| T2.16 | Observability, backups, status page `[N]` (G7) | Logs, traces, error tracking, SLOs, alerts; backup and restore drill | Restore drill meets stated RPO/RTO | T1.5 |

**Gate G-P2:** module-alone tests for Base pass; cross-tenant suite at 100%;
billing reconciliation clean; ModelGateway is the only AI path; approvals gate
all external writes.

---

## Phase 3 — Module vertical slices (in this order; each must pass module-alone, pairwise and removal tests before the next starts)

Each epic points to the blueprint sections that already contain detailed packages,
to the parity table in `09`, and to the seams in `08`. Convert an epic into
tickets when picked up, using the Phase 0–1 format.

| Epic | Scope | Blueprint | Notes and additions from this review |
|---|---|---|---|
| **E3.1 Base completion** | Brand kit and asset library; locale/channel variants of content; project ingest agent A00; activation tracking | §3–§5, §7 | Add G12; rename the personalization `contentVariants` table |
| **E3.2 Build: website** | Content types (post, product page, FAQ, author), forms → Customers, media library, redirects UI, locale + hreflang, custom domains, deploy pipeline with health check and rollback, audits with "Fix for me" (A08), GitHub export with export-parity test | §9 | ADR-4 and G11 checklist; accessible starter (`05` §6); needs T2.14, T2.15 |
| **E3.3 Customers** | Consent history, suppression, per-contact requests, ESP integration and sender authentication, segments, automation templates, contact timeline | §12 | G9, G10; needs T2.6 |
| **E3.4 Sell** | Stripe Connect, orders, checkout, tax, shipping (EasyPost), subscriptions and digital delivery, per-project Shopify, Merchant API v1 feed submission | §10 | G1, ADR-5; requires owner decision on funds flow ⚑ |
| **E3.5 Promote: social** | Approvals through the gate, provider readiness, media pipeline, insights adapters incl. X and LinkedIn | §11 | Real adapters exist; G15 |
| **E3.6 Promote: ads** | Readiness checks, simple mode, conversion pipeline, policy lint, spend safety; verify Google/Meta/TikTok adapters live; OpenAI Ads adapter to the official contract | §11 | G5, G15, G26 |
| **E3.7 Grow** | GA4, Search Console, PostHog, Matomo connectors; metric store and event sink; tracking health; reconciliation; recommender A14 with evidence validator | §11 | ADR-1, `07` schema; start Search Console sync at connection |
| **E3.8 Build: app** | Sandbox provider spike and decision; source graph, snapshots, agent A09 with allow-listed tools, preview, GitHub export, deploy, cost meter | §13 | ADR-3, G6; own backend portability decision ⚑ |
| **E3.9 Agency workspaces** | Client organizations, scoped sessions, client approvals, audit trails | §3, §6 | Billing owner decision ⚑ |
| **E3.10 Launch proof pack** | Release gates per add-on, external approvals checklist, restore drill, load tests, accessibility audit, the five-user first-use test | §15, §17 | Cut-line rule at T-30 days (ADR-8) |

**Definition of launch-ready for an add-on:** module-alone journey green; pairwise
journeys green; removal test green; security and privacy checks green; evaluation
floors met for its agents; parity table P0 items done; receipts and honest states
verified; accessibility checks green.
