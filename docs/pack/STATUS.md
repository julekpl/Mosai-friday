# STATUS — what is already implemented vs. the pack

**Audited:** 22 September 2026, against the working tree (baseline `da87ab7` plus
the changes listed below). **Method:** read the code, ran
`bun convex dev --once && bun tsc -b --noEmit` (exit 0), ran
`bun run audit:functions` (exit 0). **Updated the same day by T1.1:** the
package-manager question is decided (bun) and recorded in §6; the §3 rows for the
lockfile, the Tiptap peer conflict and the runtime pin now reflect the fix.
**Updated the same day by T1.2:** the Convex codegen strategy is decided —
`src/convex/_generated` is committed with a `bun run check:codegen` drift check;
the §3 codegen row reflects it.
**Updated the same day by T1.3:** the post-T1.2 typecheck baseline is measured at
**0 errors** (final also 0), the check is proven to really read `src/` with a
planted-error probe, and no suppression was added; §1 and §3 reflect it.
**Updated the same day by T1.4:** lint was re-measured at **82 errors / 29
warnings** and driven to **0 errors / 25 warnings** without weakening
`eslint.config.js`; the only remaining source `eslint-disable` is the documented
`dal.ts` cascade handle (`Create.tsx`'s was removed), and §3 reflects it.
**Updated the same day by T1.5:** the test runner and CI exist — Vitest +
`convex-test` unit harness, Playwright + axe browser/A11y gates, a working-tree
secret scan, `bun run check`, `bun run test:e2e`, `bun run test:a11y` and
`.github/workflows/ci.yml`; every gate was proven to fail on a deliberate break;
§1, §2 (R11) and §3 reflect it.
**Updated the same day by T1.6:** the dependency audit is **clean** — `bun audit`
reports no findings at any level (was 1 critical + 4 high on this tree, from
`@auth/core` via `@convex-dev/auth` and a nested `undici` via
`@vly-ai/integrations`); the pack's `react-router`/`hono` list was stale and
neither is flagged. The staged dependency-audit CI leg is now a hard failure.
§1 and §3 reflect it.
**Updated the same day by T1.7:** R1–R12 are now **real automated tests** and run
in CI — 33 unit tests plus 3 browser tests across
`tests/unit/{phase0-regressions,safe-fetch,deletion-completeness,secret-scan,platform-detach}.test.ts`
and `tests/e2e/{sanitized-html,no-platform-calls}.spec.ts`. Every one was
demonstrated failing against the pre-fix code (the plant/observe table is in the
ticket). R4 is the one exception and stays **blocked** on T0.4. Writing R10 found
and fixed a real defect: `cascadeDeleteProject` asked `buildVersions` for a
`by_project` index the schema never declared, so **every** project deletion threw.
§1, §2 (R1–R12) and §3 reflect it.
**Updated the same day by T1.8:** the accessibility quick fixes are in (AGENTS.md
rule 16). The `/auth` sign-in form now has labelled fields, `autoComplete="one-time-code"`
on the code input, an assertive error `role="alert"`, a polite status live region,
focus management across the email/code steps and a resend control with a countdown;
the two clickable `div`s (the CMS block card and the version-menu backdrop) are
fixed; and every layout (landing, auth, app shell) has a skip link to `#main-content`.
The dated `KNOWN_VIOLATIONS` baseline in `tests/e2e/a11y.spec.ts` is **deleted** —
axe now fails on any serious/critical violation on `/`, `/auth` and `/app` with
**no allow-list**. §1 and §3 reflect it.
**Updated the same day by T2.1:** Phase 2 has begun — organizations,
memberships, roles and invitations are in the schema; an idempotent migration
puts every existing project under its owner's personal organization; agency
client links and last-owner protection are enforced by role guards; and 9 new
unit tests prove both acceptance criteria. §1, §2b and §3 reflect it.
**Updated the same day by T2.2:** tenancy now runs through `orgQuery` /
`orgMutation` / `orgAction` in `guards.ts`, which resolve the caller's active
organization membership and authorize a specific record; all **81** inline
`project.ownerId !== userId` checks are gone, so a member of the owning
organization can reach the project (and `projects.list` returns the
organization's projects, not just the caller's own); `eslint.config.js` bans a
raw `ctx.db` project lookup outside the data-access layer; the audit fails on an
unscoped public function; and a **generated** cross-tenant suite (163 cases over
every record-scoped public function, plus 2 structural) proves a foreign
organization gets nothing and writes nothing. §1, §2b, §3 and §5 reflect it.
**Updated the same day by T2.3:** capabilities are now one canonical registry
(`src/convex/lib/capabilities.ts`) instead of four disagreeing module lists; all
**149 module functions in 31 files** enforce a capability through the module
builders (before the handler, for writes), the scheduled-post job refuses to
publish without `promote.publish`, and the UI routes/locks read the same
resolution. `assertModule` is gone. The CI gate
`scripts/audit-module-capabilities.mjs` fails on a module function that is
reachable without a capability or a documented exemption. §1, §2b, §3 and §5
reflect it.
**Updated the same day by T2.4:** Stripe Billing and the platform admin panel
are in. The owner answered the three blocking money questions (Connect for
E3.4; Stripe Tax enabled; plans/prices **not** final), so price ids are
configuration (`STRIPE_PRICE_*`) and an unconfigured plan is an honest
`needs_setup`. `lib/stripe.ts` verifies webhook signatures (HMAC-SHA256) and
refuses a live key unless `STRIPE_LIVE_MODE=true`; the internal webhook apply is
idempotent by event id and out-of-order-safe, and a completed browser checkout
never grants a plan. Dunning, a `past_due` → `wind_down` sweep and a daily
reconciliation job (target 0 drift) are in. The `/admin` panel is guarded by
`guards.requirePlatformAdmin`; the bootstrap operator is
`julian.s.witkowski@gmail.com` via `lib/platformAdmin.ts` (extensible with
`PLATFORM_ADMIN_EMAILS`). **Final-verification note:** the a11y gate threw one
bogus serious `color-contrast` node on `/auth` on a cold parallel run (axe
racing the 0.55s entrance fade / font swap); `tests/e2e/a11y.spec.ts` now
settles fonts + finite entrance animations before scanning and logs the
offending nodes on failure — the assertion (zero serious/critical, no
allow-list) is unchanged. §1, §2b, §3, §5 and §6 reflect it.
**Updated the same day by BP-01 (23 Sep 2026):** the baseline was repaired
and this file was corrected to agree with the executable code (the stale claims
fixed below: unit count 263, R4 "blocked", T0.4's snapshot validator, and
"bun run check exit 0"). Browser tests no longer treat
`https://placeholder.convex.cloud` as a working service: every Convex WS/HTTP
call is intercepted by the documented test-only backend double
(`tests/e2e/fixtures/test-backend.ts`), CI's `VITE_CONVEX_URL` is the inert
`https://e2e-test-only.convex.cloud` (answers nothing; fully intercepted),
deterministic auth error-state contract tests live in
`tests/e2e/auth-contract.spec.ts`, and the real OTP journey is the separate
opt-in `tests/e2e/otp-live.spec.ts` against a test deployment. The smoke spec
asserts the current landing copy ("Your marketing, coming together." / CTA
"Create your workspace" → `/auth`) and keeps the signed-out `/app?returnTo`
redirect and the sign-in response assertions. In CI the full-history secret
scan runs as its own `security-history` job, so a history finding can no longer
skip the working-tree scan and the audits; both browser jobs upload SHA-named
traces/screenshots on failure (7-day retention, synthetic data only). Two real
defects found and fixed: a `list`/`listitem` axe violation on `/` (`<Reveal>`
divs as `<ol>` children in `Landing.tsx`) and a `settleForAxe` race that let
axe sample pages mid-fade (content gate + double-sample stability now).
Honest reds are recorded, not hidden: `scan:secrets` fails on the **tracked**
`.env.keys` (line 8, `dotenvx-private-key`, value redacted) — the fix is owner
rotation + untracking per `docs/runbooks/secret-rotation.md`, never an
allow-list entry; and the full-history scan plus commit/CI evidence are
owner-run (git commands and the gitleaks binary are unavailable to agents).
The T2.5 "done" claim is reconciled in §2b: not implemented on this tree —
BP-05 owns it. Missing pack documents are recorded in §7.
**CI reality check (independent read-only verification, 23 Sep 2026 — two
commits, two runs, identical outcome):** implementation commit
`d3f6a8e09e301944789dc2c4487a831dc7698137` → run
[`35828575954`](https://github.com/julekpl/Mosai-friday/actions/runs/35828575954);
then the documentation commit
`dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` (this report set — current local
`.git/refs/heads/main`) → run
[`35830549968`](https://github.com/julekpl/Mosai-friday/actions/runs/35830549968).
Both = **completed / failure**. install/typecheck/lint/unit/codegen/e2e/a11y
**passed on each exact commit**; **both security jobs failed** at their
secret-scan steps in both runs (`security`: the tracked `.env.keys`;
`security-history`: a historical credential — values redacted, never
reproduced). The BP-01 split
is proven (the history failure no longer skips the working-tree scan).
**CI is NOT green: BP-01 stays `implemented_unverified`, the release gate is
BLOCKED, and no document may describe CI as green** until owner remediation
makes a later run pass both scans — checklist in
`docs/implementation/reports/BP-01-repair-baseline.md` § *Owner remediation
checklist* (Freebuff-safe vs. owner-only actions).

**Updated 24 Sep 2026 — public website hosting (owner decision, option B for
MVP):** customer websites are served at `https://appmosai.com/s/<slug>-website/<page>`
on the dashboard origin, as server-rendered HTML with no JavaScript. This is a
dated, time-boxed exception to AGENTS.md rule 9 (recorded in rule 9 and in
`docs/decisions/2026-09-24-hosting-public-sites.md`, now **accepted**); apps are
not public. `main.ts` routes every `/s/*` request to
`server/publicSiteProxy.ts`, which validates the path, forwards only GET/HEAD
with no browser headers to the Convex route `/public-site/…`, and replaces the
app CSP with a script-free policy (`tests/unit/public-site-proxy.test.ts`). The
Build workspace has one **Publish** button (prepare release → deploy) and the
Site panel a compact "Publish to web" bar; both say "Live" only when
`siteHosting:status` reports `live` (`tests/unit/publish-to-web.test.ts`). The
`siteHosting` backend and the Convex HTTP route are built in parallel; owner
must set `CONVEX_SITE_URL` (or `VITE_CONVEX_URL`) on the Deno server. Moving to
option A (separate domain) is still required before apps or any user script go
public.


**Updated 25 Sep 2026: Create source library and AI editing.** Each content
piece now has a source library (`contentSources`, registered in the data
registry, removed with its piece and its project): uploaded files with text
extracted on the server (PDF text layer via `unpdf`, DOCX via `mammoth`, plus
TXT/MD/CSV/JSON/HTML/SRT/VTT; the blob is deleted after reading), web pages
through `safeFetch`, Wikipedia/Wikibooks full articles, Reddit threads, YouTube
transcripts through SerpApi's `youtube_video_transcript` engine (`needs setup`
without `SERPAPI_KEY`), research findings imported as full text, and pasted
notes. `lib/sourceText.ts` retrieves from that text (BM25 over chunks) and packs
it into the prompt: all included sources in full when they fit the gateway's
input cap, otherwise a fair share of the most relevant passages per source, and
`generateContent` returns a per-source report of what the model read. The
editor gained per-source include switches, draft options (length, tone,
instructions, citations) and a selection menu (rewrite, shorten, expand, guide
note) that previews before replacing. `contentPieces` deletion now also removes
its `contentDocs` snapshot, which was previously orphaned.
This file exists so that a fresh agent session does not re-do finished work and
does not trust the pack where the code has moved on. It is the pack's precedence
level 5 — a ticket still wins on scope — but it is the ground truth about *state*.

---

## 1. Headline

Phase 0 (stop the exposure) is **substantially complete in code and now in
tests**. Phase 1 (make the repository buildable and testable) is **done**:
T1.1–T1.8 are done — bun is authoritative, codegen is committed and guarded,
`tsc` and lint are green, the repository has a test runner and CI, the dependency
audit is clean (no critical, high, moderate or low findings), the R1–R12
Phase 0 controls have an automated regression suite that runs in CI, and the
accessibility gate (T1.8) fails on any serious/critical axe violation with **no
allow-list**. Gate G-P1 has no outstanding code work on this tree. **R4 is

green**: it was promoted from `it.fails` on 22 Sep 2026 (evening) once T0.4's
server-side context loading landed, and it passes in the current 295-test
suite (BP-01 re-measured 23 Sep 2026). The remaining Phase 0 items
all need an owner action (key rotation, choosing an email provider) or a
decision, not code.

Phase 2 (the shared spine) has begun. **T2.1 is done (22 Sep 2026):** the
`organizations`, `memberships`, `invitations`, `roles` and `agencyClientLinks`
tables are added, every existing project is migrated under its owner's personal
organization by an idempotent `internalMutation`, new projects are created
inside that organization, roles are enforced through one capability map, agency
client links are honoured, and an organization can never be left without an
owner. Nine new unit tests prove the two acceptance criteria.

**T2.2 is done (22 Sep 2026):** the organization is now the tenant in the
*authorization* path, not just in the schema. `guards.ts` exports the builders
`orgQuery` / `orgMutation` / `orgAction`, which resolve the caller's active
organization memberships once and hand the handler an `OrgAccess` object
(`requireProject` / `ownedProject` / `ownedRow` / `requireOrganization`);
`hasProjectAccess` is the one rule — active membership of the owning
organization, with the owner fallback only for a row that predates T2.1's
migration. The audit's **81** inline `project.ownerId !== userId` checks are all
migrated (27 modules), so a teammate in the owning organization can reach the
project, and `projects.list` returns the organization's projects rather than
only the caller's own. Two gates keep it there: `eslint.config.js` makes a raw
`ctx.db` project lookup an **error** outside the data-access layer, and
`scripts/audit-public-functions.mjs` now **fails** on a public function that
names a record (`v.id(...)`) without authorizing it (and on the inline pattern
itself). A **generated** suite (`tests/unit/cross-tenant.generated.test.ts`, 163
generated cases + 2 structural) proves a foreign-organization caller gets
nothing and writes nothing for every record-scoped public function.

**T2.3 is done (22 Sep 2026):** the tiers stopped being a list and became a
registry. `src/convex/lib/capabilities.ts` is the single typed source of truth
for the eight add-ons and their actions (`<module>.<action>`, 34 keys), the
plan → module matrix (`PLAN_MODULES` now lives here and `billing.ts` re-exports
it), the role → action matrix, the four blueprint §3 capability states
(`included | locked | needs_setup | unavailable`) and a country-matrix **stub**
(one wildcard policy — the real matrix is owner decision #4). `guards.ts` resolves
a capability from the **organization's plan × the caller's role** and the new
builders `moduleQuery` / `moduleMutation` / `moduleAction` enforce it: a write is
refused **before** the handler runs (the tenant comes from the record argument),
a read authorizes through a capability-aware `OrgAccess`, and a `"use node"`
action enforces through the action-safe probes. All **149 module functions in 31
files** are migrated (before this, only two modules checked a plan at all —a `free` plan could call `builds.create` straight from the client), and the
scheduled-post cron job refuses to publish a post whose organization no longer
includes `promote.publish` (it records the reason and writes no receipt).
`assertModule` is deleted. The UI never hard-codes a tier: `AppShell`, the
`App.tsx` route gate, `Overview` and `Billing` read `entitlements.matrix` /
`entitlements.plans`, so enabling or disabling an add-on changes routes, queries,
mutations, actions and jobs together. `scripts/audit-module-capabilities.mjs`
(`bun run audit:capabilities`) fails CI when a module function is reachable
without a capability, when a convex file is unclassified, when a library file
exports a public function, or when an exemption is missing a reason or stale.

**T2.4 is done (22 Sep 2026):** Stripe Billing and the platform admin panel. The
owner's answers to the three blocking money questions are recorded in §6 #1 —
Connect (connected accounts) for the commerce add-on E3.4, **Stripe Tax enabled**
for MOSAI's own billing, and **plans/prices are not final** — so price ids are
deployment configuration (`STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE`) and an
unconfigured plan is an honest `needs_setup`, never a fake checkout.
`src/convex/lib/stripe.ts` is the one provider seam (test-mode-only guard,
mandatory idempotency key, mandatory HMAC-SHA256 webhook signature verification);
`POST /api/stripe/webhook` calls the internal `billingWebhooks.applyEvent`, which
is the only writer of the mirror: idempotent by provider event id,
out-of-order-safe by `subscriptions.lastEventCreated`, and a completed browser
checkout is recorded as a receipt but **never** grants entitlement. A daily
reconciliation job (`billing.reconcileNow` over `lib/billingReconcile.ts`)
reports entitlement drift with a target of 0; dunning advances on
`invoice.payment_failed` and the `past_due` → `wind_down` sweep is honest and
deletes nothing. Separately, `/admin` is a full platform-operator panel
guarded by `guards.requirePlatformAdmin`; the bootstrap operator
`julian.s.witkowski@gmail.com` is granted through `lib/platformAdmin.ts` (plus
`users.isPlatformAdmin`, the legacy `admin` role and `PLATFORM_ADMIN_EMAILS`),
and every operator write is recorded in `adminAuditLog`. T2.5 is next.

`bun tsc -b --noEmit` is **clean** here. The pack's claim that a clean checkout
produces 1,067 type errors is a *pre-codegen* measurement: `src/convex/_generated`
is git-ignored, so the errors appear only when the generated types are absent.
With codegen present, type health is good. Ticket T1.2 (done 22 Sep 2026) makes
this reproducible: `src/convex/_generated` is no longer git-ignored, so a fresh
clone typechecks from the committed bindings with no Convex credentials.

**T1.3 (done 22 Sep 2026) records the number:** baseline **0** errors and final
**0** errors, re-measured with the incremental cache wiped
(`rm -rf node_modules/.tmp`) and with `--force`. A temporary planted error
(`TS2322`) was reported by `tsc`, proving the check is live and not skipping
`src/`. No suppression comment was added; the suppression survey is unchanged
(`@ts-ignore` 0, `@ts-expect-error` 0, `as any` 4 — including the accepted
`dal.ts` deletion handle).

---

## 2. Phase 0 — ticket by ticket

| Ticket | Status | Evidence |
|---|---|---|
| **T0.1** rotate and remove committed secrets | 🟡 **code done, owner action outstanding** | `emailOtp.ts` reads `EMAIL_OTP_API_KEY` from env and no longer rethrows `JSON.stringify(error)` (only the HTTP status). `.gitignore` now ignores `.env*` except `.env.example`. `.gitleaks.toml` and `docs/runbooks/secret-rotation.md` added. **Still open:** the owner must actually revoke the OTP key and re-key dotenvx; `.env.keys` is still present in the working tree (deleting it could break local env decryption, so it was left in place and ignored); history purge needs `git` access the agent does not have. |
| **T0.2** remove anonymous sign-in | ✅ **done** | `auth.ts` has `providers: [emailOtp]` only; the guest button is gone. `guards.ts` now also treats `isAnonymous === true` accounts as unauthenticated in `maybeUser`, `requireUser` and `requireActionUser` (via `internal.guards.isAnonymousUser`), so accounts minted before the change cannot act. |
| **T0.3** free by default, no client plan changes | ✅ **done** | `DEFAULT_PLAN = "free"` in both read and write paths; `changePlan` throws unless `PLAN_SELF_SERVE === "true"`; `Billing.tsx` renders plans as "Managed" with the switcher disabled unless self-serve is on. The duplicate `assertModule` in `billing.ts` was deleted — **one** implementation remains, in `guards.ts` — and `ads/control.ts` now imports it from there. |
| **T0.4** authenticate AI/scraping actions, load context server-side | 🟡 **mostly done (corrected by BP-01, 23 Sep 2026)** | `requireActionUser` gates the `ai.ts` actions, and the client-supplied `projectSnapshotValidator` is **gone** — every AI/scraping action takes `actionProjectSnapshot` (`ai.ts`, `buildPlan.ts`, `sellAI.ts`, `guards.ts`), which is why R4 was promoted to green on 22 Sep. **Still open:** no per-user rate limit (`rg -i ratelimit src/convex` finds none). |
| **T0.5** `safeFetch` + SSRF guard | ✅ **done** | `src/convex/lib/safeFetch.ts` — HTTPS only, DNS-resolved blocklist (v4 + v6, IPv4-mapped, NAT64, 6to4), manual redirect re-validation, size/time caps, no credentials forwarded. Used by `scraping.ts`. Residual DNS-rebinding risk is documented in the file. |
| **T0.6** ownership fix + public-function audit | ✅ **done** | `collections.create` now calls `requireProject` before inserting (it previously checked only the plan — the confirmed cross-tenant write). `scripts/audit-public-functions.mjs` + `scripts/public-functions-allowlist.json` added; wired as `bun run audit:functions`. |
| **T0.7** sanitize HTML, add CSP | 🟡 **half done** | `src/lib/sanitize.ts` (DOMPurify allow-list) is applied at **every** `dangerouslySetInnerHTML` sink that renders user/AI rich text: `PageRenderer.tsx` and `Build.tsx` draft preview. **Still open:** sanitize on *save* (server side) — DOMPurify needs a DOM, so this needs an isomorphic sanitizer (e.g. `isomorphic-dompurify`) or a sandboxed renderer; and the CSP header/meta is not added. |
| **T0.8** detach identity and OTP email from the template platform | 🟡 **partly done** | The federated `customJwt` provider (issuer `https://freebuff.com`) is **removed** from `auth.config.ts`. **Still open, needs an owner decision:** OTP still sends through `https://auth.freebuff.app`; there is no `EmailGateway` abstraction yet; the platform toolbar still exists (`vly-toolbar-readonly.tsx`, read-only). |
| **T0.9** disable the global Shopify sync | ✅ **done** | `shopifySync.ts` has `SHOPIFY_PER_PROJECT_CREDENTIALS = false` and `syncCatalog` throws a typed, user-readable error before it can read any environment credential. |
| **T0.10** refuse fake connections | ✅ **done** | `connections.beginAuthorization` writes `authorizing` only; `markVerified` and `markNeedsAttention` are `internalMutation`s, so no client can self-declare `connected`. |

### Phase 0 gate (G-P0)

| Regression | Assertion | Status |
|---|---|---|
| R1 | No anonymous provider; a new user has Base access only; leftover anonymous accounts are rejected | ✅ **tested (T1.7)** — `phase0-regressions.test.ts`: signing in as `anonymous` rejects, a fresh account's modules equal `PLAN_MODULES.free`, and an `isAnonymous: true` row is refused by `requireUser` |
| R2 | `changePlan` from a client is rejected | ✅ **tested (T1.7)** — `changePlan` rejects and the stored plan is unchanged; `selfServePlanChanges` is false |
| R3 | AI/scraping actions reject unauthenticated callers | ✅ **tested (T1.7)** — all 17 listed actions reject an unauthenticated caller with "Not signed in" (valid args, so the rejection is the sign-in guard, not the validator) |
| R4 | AI actions load context server-side | ✅ **tested and green (promoted 22 Sep 2026, re-verified by BP-01)** — `phase0-regressions.test.ts` no longer marks it `it.fails` (promotion note at L196): the client snapshot argument was replaced by server-loaded context (`actionProjectSnapshot`), so it passes in the current 295-test suite |
| R5 | `safeFetch` blocks loopback/private/metadata/non-HTTPS/redirect-to-private | ✅ **tested (T1.7)** — `safe-fetch.test.ts` (14 cases, hermetic): non-HTTPS, localhost/`.local`/`.internal`, loopback, 10/8, 172.16/12, 192.168/16, CGNAT, link-local/metadata, `::1`, `fc00::`, `::ffff:127.0.0.1`, a redirect to a private address and an http-downgrade redirect are all refused; a public address succeeds |
| R6 | Cross-tenant write blocked (`collections.create`) | ✅ **tested (T1.7)** — user B's `collections.create` on user A's project throws "Not found" and writes nothing, while A (same plan) succeeds |
| R7 | `<script>`, `onerror=`, `javascript:` never execute | ✅ **tested (T1.7)** — `sanitized-html.spec.ts` mounts the real `PageRenderer` in Chromium with six payloads (script, `onerror`, `onload`, `javascript:`, iframe, `onclick`): nothing executes, with a control proving the probes *do* fire when unsanitized; a scan also fails the build if a new `dangerouslySetInnerHTML` sink is not wrapped in `sanitizeHtml`. ⚠️ **still open:** sanitize on *save* (server side) and the CSP — T0.7 remainder |
| R8 | Fake connection refused | ✅ **tested (T1.7)** — the connection module's public mutations are exactly `beginAuthorization`/`disconnect`; the only writers of a success state are the `internalMutation`s `markVerified`/`markNeedsAttention`, and `beginAuthorization` yields `authorizing` |
| R9 | Shopify sync cannot read a deployment-wide store | ✅ **tested (T1.7)** — `syncCatalog` refuses an unauthenticated caller, a non-owner ("Not found") and the owner ("needs per-project credentials"), creating no products or collections |
| R10 | Deletion completeness (generated from the schema) | ✅ **tested (T1.7)** — `deletion-completeness.test.ts` derives the table list from `schema.ts` (every table with a `projectId` field, plus `contentDocs`), seeds a row in all 37 and proves `projects.remove` leaves none and deletes the storage blob. `oauthStates` is the sole exemption, asserted to have no `by_project` index. **Writing it found a real defect:** the cascade asked `buildVersions` for a `by_project` index the schema never declared, so *every* project deletion threw; `dal.ts` now reaches `buildVersions` through its parent `build` (the same pattern as `buildMessages`) |
| R11 | Secret scan fails on a planted secret; history clean | ✅ **tested (T1.7)** — `secret-scan.test.ts` runs the shipped scanner in a throwaway directory: it exits 1 on a planted dummy key (and never echoes the value), exits 0 on a clean tree, and refuses a no-op scan. CI (T1.5) still runs gitleaks over history and the working tree in the `security` job. History still not purged (owner action). |
| R12 | No request to platform domains with platform vars unset | ✅ **tested (T1.7)** — `no-platform-calls.spec.ts` intercepts the network layer on `/`, `/auth`, `/system` and a 404 and fails if any request reaches a `freebuff.*`/`vly.*` host; `platform-detach.test.ts` asserts the live auth config trusts only this deployment's OIDC discovery (no `customJwt`, no platform issuer), so a platform-signed token cannot authenticate. ⚠️ **still open:** the server-side AI gateway is still the platform SDK — T2.9 (`ModelGateway`) |

**Verdict on G-P0:** the *code* holes are closed (except R4's remainder and the
T0.7/T0.8 server-side items noted above). The *proof* gap is **closed**: T1.5
(22 Sep 2026) added the test runner and CI, and T1.7 (22 Sep 2026) wrote R1–R12
against them — twelve green guards — R4 included: it was promoted to green on 22 Sep 2026
once T0.4's server-side context loading landed (BP-01 re-verified 23 Sep).

---

## 2b. Phase 2 — ticket by ticket

| Ticket | Status | Evidence |
|---|---|---|
| **T2.5** data registry, unified export/deletion, finalizer | 🟡 **ticket says done; the code does not contain it (reconciled by BP-01, 23 Sep 2026)** | The ticket header claims done (22 Sep), but on this tree: `src/convex/lib/dataRegistry.ts` still labels itself the **T2.1 seed** (~14 org/billing tables; its header says "T2.5 replaces this"); `src/convex/lib/dataLifecycle.ts` **does not exist**; `src/convex/crons.ts` has **no** `account-deletion-finalizer` (only the social and billing crons); `billing.deleteAccount` still calls `dal.cascadeDeleteProject` directly (old cascade path, L383–395); `data.exportProject` / `data.exportAccount` / `data.obligations` / `data.pendingDeletions` / `ACCOUNT_DELETION_GRACE_DAYS` / `deletionBlockedReason` have **no matches** in `src/convex`; `scripts/audit-data-registry.mjs` and `audit:data-registry` are in neither `package.json` nor `.github/workflows/ci.yml`; `tests/unit/data-registry.test.ts` does not exist. The four owner decisions recorded in the ticket (D2) remain valid — **implementing them is BP-05**, deliberately not done in this package. Ticket annotated with the same finding. |
| **T2.4** Stripe billing, checkout, portal, webhooks, dunning | ✅ **done** (22 Sep 2026) | `lib/stripe.ts` (REST client + test-mode guard + HMAC-SHA256 signature verification), `lib/billingCatalog.ts` (registry plans → `STRIPE_PRICE_*`, no new tier list), `lib/billingReconcile.ts` (pure drift computation). New tables `billingCustomers` / `subscriptions` / `billingEvents` / `billingReceipts` / `billingInvoices` / `reconciliationRuns` and, for the admin panel, `platformAdmins` / `adminAuditLog`; all registered in `lib/dataRegistry.ts`. `billing.startCheckout` / `billing.openPortal` are org actions that return a URL and write no plan; `POST /api/stripe/webhook` (signature-verified) → internal `billingWebhooks.applyEvent` (idempotent by event id, out-of-order-safe by `lastEventCreated`, a completed checkout alone never grants a plan), the dunning path, the `past_due` → `wind_down` sweep and the daily `billing.reconcileNow` cron. `/admin` (route in `main.tsx`, link in `AppShell`) shows platform stats, Stripe config, the webhook ledger, the reconciliation report, audited plan overrides and operator grant/revoke; `guards.requirePlatformAdmin` resolves the bootstrap operator `julian.s.witkowski@gmail.com` (via `lib/platformAdmin.ts`) plus `users.isPlatformAdmin` / the legacy `admin` role / `PLATFORM_ADMIN_EMAILS`. Proof: `tests/unit/billing.test.ts` (12) — duplicate and out-of-order no-ops, redirect-never-grants, 0-drift reconciliation + drift detection, wind-down, signature/test-mode guards, admin gating, and a regression for a real defect (an invoice arriving before its subscription silently downgraded the customer to `free`; it is now ignored). Owner decisions recorded in §6 #1. `tests/e2e/a11y.spec.ts` gained a `settleForAxe` pre-scan settle (fonts + finite entrance animations) after a cold-parallel run reported one bogus `color-contrast` node on `/auth`; failure output now names the offending nodes. See `docs/tickets/T2.4-stripe-billing.md`. |
| **T2.3** capability registry, per-add-on entitlements | ✅ **done** (22 Sep 2026) | `src/convex/lib/capabilities.ts` — one registry: 8 modules × 5 verbs (34 capabilities), `PLAN_MODULES` (re-exported by `billing.ts`, so the old `assertModule`/tier lists are gone), `ROLE_MODULE_ACTIONS`, the four capability states, a country stub and `CONVEX_FILE_OWNERS`. `guards.ts`: `projectTenant` / `projectCapability` resolve plan × role **for the organization, not the caller**, and `moduleQuery` / `moduleMutation` / `moduleAction` enforce before the handler runs (149 module functions in 31 files). `social/executor.ts` refuses to publish a due post without `promote.publish` and records why with no receipt. UI: `use-module-entitlements.ts` + `entitlements.matrix`/`entitlements.plans` drive the sidebar locks, the `App.tsx` route gate, `Overview` and the `Billing` cards. Gate: `bun run audit:capabilities` (in `bun run check` and CI) fails on an ungated module function, an unclassified file, a public export from a library file and a missing/stale exemption — proven by 6 fixture tests in `tests/unit/audit-gate.test.ts`. Proof of behaviour: `tests/unit/entitlements.test.ts` (26 tests) — generated read axis (8 modules × 4 plans: a downgrade hides rows, an upgrade shows the same rows, nothing is deleted), generated write axis (per module), the plan-locked mutation, the role × action refusal (member vs owner), the job gate, and regressions for three defects (no server enforcement at all; the plan read from the caller instead of the organization, both directions; `entitlements.matrix` answering a foreign caller with an envelope instead of `null`, found by the T2.2 generated suite). Audit: 201 public functions, 194 guarded, 0 inline, exit 0; allow-list still **3** entries, no exemption added. See `docs/tickets/T2.3-capability-registry.md`. |
| **T2.2** org-scoped function builders, generated cross-tenant tests | ✅ **done** (22 Sep 2026) | `guards.ts` exports `orgQuery` / `orgMutation` / `orgAction` and the `OrgAccess` context (`requireProject` / `ownedProject` / `ownedRow` / `requireOrganization`); `hasProjectAccess` = active membership of the owning organization (owner fallback only for a pre-T2.1 row). All **81** inline `ownerId` checks migrated across 27 modules; `projects.list` is organization-scoped. `eslint.config.js` bans a raw `ctx.db` project lookup outside the data-access layer. Audit: 198 public functions, **191** guarded, **0** inline, 4 self-scoped REVIEW, exit 0 — the script now fails on an unscoped function that names a record, proven by `tests/unit/audit-gate.test.ts` (5 tests). Coverage: `function-registry.ts` + `cross-tenant.fixtures.ts` + `cross-tenant.generated.test.ts` — 198/198 public functions classified, 163 record-scoped ones each exercised by a foreign-organization caller that is verified to share no organization with the owner, asserting nothing written (per-table row counts) and nothing revealed. The suite found two real gaps (`buildChat.editPage`/`planSite`/`generateSite`, `sellAI.generateDescription`), both fixed. No allow-list entry added (still 3). See `docs/tickets/T2.2-org-scoped-function-builders.md`. |
| **T2.1** organizations, memberships, roles, invitations | ✅ **done** (22 Sep 2026) | New tables `organizations` / `memberships` / `invitations` / `roles` / `agencyClientLinks` plus `projects.organizationId`; role capabilities in `lib/roles.ts`; `guards.requireOrganization` / `requireOrgRole`; module `organizations.ts` with invitations, role administration, last-owner protection and agency links; idempotent `internalMutation` migration; data-registry entries in `lib/dataRegistry.ts`. Proof: `tests/unit/organizations.test.ts` (9 tests) shows a pre-T2.1 project moving under its owner's personal organization on the first run and a no-op on the second, and the owner/admin/member capability matrix. No allow-list entry added; `requireProject` left owner-based (T2.2). See `docs/tickets/T2.1-organizations-memberships-roles-invitations.md`. |

---

## 2c. Usability (U-series): first-run starter kit, 25 Sep 2026

Source: `docs/ux/usability-strategy.md`, `first-run-blueprint.md`,
`usability-backlog.md` (the backlog holds the per-ticket status; this row is the
summary). The stack below merged as `a5b4255` on 25 Sep 2026 except #19 (U7, merged separately the same day)
and #22 (this docs PR); merged `main` passes `bun run check` (1057 unit tests,
0 lint errors / 33 warnings, 84 tables). Original order:
#11 (docs + U0) → #12 (U2a schema) → #14 (U2) → #15 (U3) → #16 (U5) → #17 (U6)
→ #18 (U5b) → #19 (U7) → #20 (U4) → #21 (U9). #15 and #16 both add lines to
`_generated/api.d.ts`; the second to merge resolves by keeping both.

| Ticket | Status | Evidence |
|---|---|---|
| U0, U2, U3, U4, U5, U5b, U6, U7 | **merged** (`a5b4255`, and #19 for U7; 25 Sep 2026), not yet proven with owners | Unit, cross-tenant and (where UI) e2e tests per PR; baseline was 959 tests, merged `main` 1057+ (1069 with U7). Lint stays at 0 errors / 33 warnings. |
| U9 agency path | first slice **merged** (`a5b4255`); hand-off not started | client projects use the agency user's plan (owner-based entitlement) |
| U6b contact details, U4b kit follow-ups | not started | found in review (see backlog) |
| U1, U8, U10, U11 | blocked | owner decisions / hosting option A |
| U12 five-owner test | script ready, not run | `docs/ux/u12-usability-test-script.md` |

New tables: `starterKits` (project job), `stockSearchCache` (global, ephemeral),
`projectVisits` (per member); all registered (registry audit: 85 tables).
**Found and not fixed here:**
- The schema runs with `schemaValidation: false`: validators are type-only at
  runtime. Decision needed.
- `CONVEX_DEPLOY_KEY` is absent in CI and in agent environments, so new-module
  lines in `_generated/api.d.ts` were written in codegen's exact format but not
  regenerated. Add the key so the codegen drift job verifies them.
- The full-history secret scan fails on every PR and on `main` (owner rotation,
  §2/BP-01).
- The T2.5 row in §2b above looks stale: `lib/dataLifecycle.ts`,
  `scripts/audit-data-registry.mjs` and `audit:data-registry` now exist on `main`.
  Re-verify before relying on either the row or the code.

## 3. Phase 1 baseline — verified now

| Item | State (verified) |
|---|---|
| Package manager | **bun is authoritative (T1.1, 22 Sep 2026).** `package-lock.json` is deleted; `bun.lock` is the only lockfile and was regenerated from a clean `node_modules`. `rm -rf node_modules && bun install --frozen-lockfile` exits 0 with no peer warnings. |
| Tiptap peer conflict | **Resolved (T1.1).** `@tiptap/extension-collaboration-cursor@^2.26.2` was not imported anywhere in `src/` (the only collaboration import is `@tiptap/extension-collaboration`, in `src/components/app/ContentEditor.tsx`) and has been removed; the lockfile no longer contains it. |
| Typecheck | **T1.3 (22 Sep 2026): 0 errors.** `bun tsc -b --noEmit` → exit 0 with codegen present, re-verified with the incremental cache wiped (`rm -rf node_modules/.tmp`) and with `--force`, and per project (`tsconfig.app.json`, `tsconfig.node.json`) → all exit 0, 0 errors. A planted `TS2322` was reported by `tsc`, proving the check reads `src/`. No `@ts-ignore`/`@ts-expect-error` anywhere; `as any` count unchanged (4, incl. the accepted `dal.ts` handle). |
| Convex codegen | **Committed (T1.2, 22 Sep 2026).** `src/convex/_generated` is no longer git-ignored; `convex codegen` output is deterministic (regenerating leaves the 5 files byte-identical). `bun run check:codegen` regenerates with `convex codegen` and fails on drift (`git diff --exit-code`); `bun run codegen` regenerates by hand. `bun convex dev --once` → succeeds against `julekpl:mosai-another:dev`. |
| Lint | **0 errors / 25 warnings (T1.4, 22 Sep 2026; T2.2 added a data-access rule without changing the count).** Baseline re-measured on the current tree at **82 errors / 29 warnings** (82 = 49 `no-unused-vars` + 22 `no-explicit-any` + 11 `react-hooks/*`), so the pack's 79/25 was stale. All 82 errors fixed without adding a suppression or weakening `eslint.config.js`; source `eslint-disable` directives went **2 → 1** (only the documented `dal.ts` cascade handle remains). The 25 warnings are 21 Fast-Refresh `only-export-components` in shared modules and 4 generated-file headers — recorded and justified in `docs/tickets/T1.4-zero-lint-errors.md`. `bun run lint` exits 0. **T2.2 (22 Sep 2026)** adds `no-restricted-syntax` for `src/convex/**/*.ts`: a bare `ctx.db.get(projectId)` or `ctx.db.query("projects")` is an error, ignored only for the data-access layer (`guards.ts`, `dal.ts`, `organizations.ts`, `projects.ts`, `billing.ts`, `lib/**`, `_generated/**`), so a feature module cannot authorize a project on its own. 0 errors / 25 warnings still. |
| Tests / test runner / CI | **Added (T1.5, 22 Sep 2026).** Unit: `vitest.config.ts` + `src/convex/test.setup.ts` + `tests/unit/` (Vitest 5, `convex-test`, `@edge-runtime/vm`). Browser: `playwright.config.ts` + `tests/e2e/` (Playwright + `@axe-core/playwright`). Scripts: `test`, `test:unit`, `test:e2e`, `test:a11y`, `scan:secrets`, `check`. CI: `.github/workflows/ci.yml`, one job per concern (install · codegen · typecheck · lint · unit · security · e2e · a11y). Measured on this tree by BP-01 (23 Sep 2026): `bun run check` runs typecheck + lint + unit + secret scan + both audits and is **red only at `scan:secrets`** (the tracked `.env.keys` — see the Secret scanning row; never allow-list it), everything before it green; `bun run test:e2e` **15 passed + 1 visibly skipped** (`otp-live`, opt-in) hermetically against the test-only backend double, including the CI condition (inert `VITE_CONVEX_URL`); `bun run test:a11y` **5 passed** (T1.8) — `/`, `/auth` and `/app` with zero serious/critical axe violations and no allow-list, plus a skip-link and a keyboard-only sign-in test. The signed-out `/app` → `/auth?returnTo=%2Fapp` redirect is asserted by the a11y app entry. **R1–R12 land in T1.7 (done 22 Sep 2026):**`tests/unit/{phase0-regressions,safe-fetch,deletion-completeness,secret-scan,platform-detach}.test.ts`
(33 unit tests) and `tests/e2e/{sanitized-html,no-platform-calls}.spec.ts` (3 browser tests).
**T2.1 added `tests/unit/organizations.test.ts` (9 tests).** **T2.2 added `tests/unit/cross-tenant.generated.test.ts` (165: 163 generated + 2 structural, driven by `function-registry.ts` over every public function), `cross-tenant.fixtures.ts` and `audit-gate.test.ts` (5).** **T2.3 (22 Sep 2026) adds `tests/unit/entitlements.test.ts` (26 — the capability/entitlement suite, generated over the registry) and 6 more cases in `audit-gate.test.ts` for the module-capability gate.** **T2.4 (22 Sep 2026) adds `tests/unit/billing.test.ts` (12 — webhook idempotency/ordering, redirect-never-grants, reconciliation drift, wind-down, signature/test-mode guards, admin gating, one defect regression) and the generated cross-tenant suite grows to 171 (169 generated + 2 structural) as the new public functions are covered — 13 files, **295 unit tests total, all passing** (R4 promoted to green on 22 Sep; BP-01 re-measured 23 Sep — the 263/`it.fails` claim above was stale). Browser: **15 e2e + 5 a11y passed**, 1 spec skipped (`otp-live`, opt-in), bounded workers (CI 1, local 2 — the default worker count crashed renderers under cold-start load). **BP-01 adds** `tests/e2e/{fixtures/test-backend,auth-contract,otp-live}`. `vitest.config.ts` aliases `@vly-ai/integrations` to `tests/unit/stubs/` because the platform SDK reads `document` at import time and cannot load under `edge-runtime`. **CI on the exact commits (runs `35828575954`/`d3f6a8e` and
`35830549968`/`dd9c163`, 23 Sep 2026): the `unit`, `e2e` and `a11y` jobs all
PASSED on GitHub's runner in both runs** — SHA-bound external proof of these
numbers on the implementation commit *and* on the later documentation commit;
each run as a whole is still a **failure** because both security jobs are red
(see the Secret scanning row), so this is evidence, **not** a green CI claim.
Any new commit triggers a fresh run whose result must not be claimed before
it exists. |
| Secret scanning | **Wired (T1.5, 22 Sep 2026).** `scripts/scan-secrets.mjs` reads the custom rules from `.gitleaks.toml` and runs inside `bun run check`, so a planted secret fails locally; the CI `security` job also runs gitleaks over full history and the working tree, plus `bun audit --audit-level=high` (now a hard failure, T1.6) and `audit:functions`. The T1.5 ticket quoted a literal dummy `x-api-key` value in its proof table, which the `vly-email-otp-key` rule correctly matched — the doc line was redacted in T1.6 rather than allow-listing `docs/tickets/`. **BP-01 truth (23 Sep 2026):** the working-tree scan is **red today** — the tracked `.env.keys` at the repo root matches `dotenvx-private-key` at line 8 (value redacted by the scanner; never read or printed). No allow-list entry may silence it: the fix is rotation + untracking per `docs/runbooks/secret-rotation.md` (git is blocked for agents — B2). The full-history scan cannot run in this environment (gitleaks not installed; git blocked) and is **owner-run evidence**: `gitleaks detect --no-banner --config .gitleaks.toml --redact --exit-code 1`, findings never pasted. A planted synthetic `CONVEX_DEPLOY_KEY` fixture was proven to fail the gate this chat (finding listed, value redacted, exit 1) and removed afterwards; after cleanup the scan's only finding is the pre-existing `.env.keys`. Still open: pre-commit hook, credential rotation and the history purge (owner).
**CI confirmation (runs `35828575954` on `d3f6a8e` and `35830549968` on
`dd9c163`, 23 Sep 2026):** in both runs the
`security-history` job **failed** at the full-history gitleaks step and the
`security` job **failed** at the working-tree scan step — exactly the two
findings above, now proven twice on the real runner instead of inferred. Neither
scan was weakened or allow-listed; the later steps of `security` (local scan,
both audits, `bun audit`) were skipped by that job's fail-fast order and were
instead verified green locally this chat. **Remediation (owner-only except
where noted) — redacted checklist:** (1) rotate the dotenvx key per
`docs/runbooks/secret-rotation.md`, and decide the historical OTP key per §6
#2 — **owner**; (2) `git rm --cached .env.keys` (file stays locally, already
ignored) — **owner**, git is blocked for agents (B2); (3) authorize + run the
history purge for `.env.keys` and the former `emailOtp.ts` key (rewrite +
force-push), then re-run gitleaks with `--redact` and judge only the exit
code — **owner**; if purge is declined, `security-history` stays red as the
honest state until an explicit recorded owner decision, and the release gate
stays blocked; (4) keep both scan rules and allow-lists untouched, keep
findings redacted, re-run/verify gates — **Freebuff may do this now and must
refuse any weakening**. Freebuff must never edit `.env*` files, run git, or
handle credential values. |
| Dependency audit | **Clean (T1.6, 22 Sep 2026).** `bun audit` (and `--audit-level=high`) → **"No vulnerabilities found"**; was 1 critical + 4 high + 8 moderate + 2 low. Fixed: `@convex-dev/auth` 0.0.90 → **0.0.94** (moves the `@auth/core` peer to `^0.41.1`) with `@auth/core` pinned at **0.41.3** (GHSA-7rqj-j65f-68wh critical + GHSA-xmf8-cvqr-rfgj high + GHSA-x445-f3h2-j279 moderate), and a root `overrides` entry forcing `undici` to `^7.19.0`, which removes the vulnerable nested `undici@5.29.0` under `@ai-sdk/provider-utils` (GHSA-vrm6-8vpv-qv8q / GHSA-v9p9-hfj2-hcw8 / GHSA-vxpw-j846-p89q high + moderates/lows) and de-duplicates the tree to one `undici@7.29.1`. The pack's `react-router` (7.18.4) and `hono` (4.13.8) findings are stale — neither is flagged. Rationale, the no-in-range-fix analysis and the override's compensating control are in `docs/tickets/T1.6-vulnerable-dependencies.md`. |
| Node/bun engines | **Pinned (T1.1):** `engines.node >= 22.12.0`, `engines.bun >= 1.3.0`, `.nvmrc` = `22`. |
| Authorization audit | `bun run audit:functions` → exit 0. Reports 218 public functions scanned: **212 authorize through a shared guard or the org access object (T2.2/T2.3/T2.4, up from 106), 0 via an inline `ownerId` check (was 81), and 3 worth a human look** — all self-scoped with no record argument (see §5). Since T2.2 the script **fails** (exit 1) on a public function that has no sign-in check, that authorizes inline, or that names a record (`v.id(...)`) and never authorizes it; `tests/unit/audit-gate.test.ts` proves each of those exits non-zero against throwaway fixtures. `scripts/public-functions-allowlist.json` is unchanged at 3 entries. (**T2.3, 22 Sep 2026:** the script also recognizes the module builders, so a module function is authorized by the builder that enforces it.) |
| Module capability audit | **Added (T2.3, 22 Sep 2026).** `bun run audit:capabilities` → exit 0: **149 module functions scanned, 142 enforce a capability**, 4 documented exemptions (registry, each with a reason), 3 allow-listed anonymous endpoints (the two OAuth callbacks and the public published-CMS read). It **fails** (exit 1) on an ungated module function, a convex file the registry does not classify, an `internal` file that exports a public function, and an exemption that is missing a reason or stale. Runs inside `bun run check` and the CI `security` job; `tests/unit/audit-gate.test.ts` (6 cases) proves each failure mode against throwaway convex trees. The registry (`src/convex/lib/capabilities.ts`) is the only module list — the four copies that existed before (tier list, `AppShell`, `App.tsx`, `Billing.tsx`) are gone. |

---

## 4. What the pack describes that has moved on in the code

| Pack statement | Current reality |
|---|---|
| Two `assertModule` copies with different defaults decide who can use a mutation | **Fixed.** One implementation, in `guards.ts`; the free-plan fallback is the only one. **T2.3:** `assertModule` is gone altogether — a plan was only half of a capability; `moduleQuery` / `moduleMutation` / `moduleAction` enforce plan × role from `lib/capabilities.ts`. |
| `PLAN_MODULES` in `billing.ts` plus hard-coded module arrays in `AppShell`/`App`/`Billing` decide which add-ons the UI offers | **Fixed (T2.3).** One registry, `src/convex/lib/capabilities.ts`; `billing.ts` re-exports `PLAN_MODULES` and the UI reads the resolved matrix. |
| `projects.remove` and `billing.deleteAccount` use two divergent hard-coded table lists that never delete 17 tables | **Fixed.** Both call `dal.cascadeDeleteProject`, which walks 33 `by_project` tables plus the children that have no project index (`contentDocs`, `buildMessages`, `productMedia`, `personaMessages`) and deletes `projectFiles` storage blobs. `oauthStates` is intentionally skipped (short-lived, no project index). There is still no grace-period finalizer job. |
| `collections.create` checks only the plan | **Fixed.** `requireProject` now runs first. |
| `guards.ts` falls back to `scale` on reads | **Fixed.** Single `DEFAULT_PLAN = "free"`. |
| AI actions are unauthenticated | **Fixed.** They require a signed-in, non-anonymous user. They still trust a client-supplied snapshot (T0.4 remainder). |
| Connections can be marked connected without OAuth | **Fixed.** Only an internal mutation can write `connected`. |

---

## 5. Open items this audit found that the pack does not list

1. **2 public functions authenticate but never authorize** (was 8 before T2.2,
   4 before T2.4, 3 before 24 Sep 2026; `files.getFileUrl`, `projects.list`,
   `social/copilot.draftVariants`, `social/copilot.suggestSchedule` and
   `ads/copilot.setCopilotModel` now authorize through the org access object or
   `requirePlatformAdmin`) — `bun run audit:functions` names them:
   `billing.currentPlan`, `users.currentUser`. Both are self-scoped and take no
   record argument (own plan, the current user), which is why T2.2 left them as
   REVIEW warnings while making "names a record but never authorizes it" a hard
   failure. Confirm by hand if their shape changes.
   `files.generateUploadUrl` was on this list but was **not** self-scoped: it
   discarded the `getAuthUserId` result, so a signed-out caller could mint
   storage upload URLs. Fixed 24 Sep 2026: it is an `orgMutation` taking
   `projectId` and authorizing it with `access.requireProject`
   (`tests/unit/upload-url-authorization.test.ts`, and the generated
   cross-tenant suite now covers it). The audit also fails any public function
   that calls `getAuthUserId`/`maybeUser` as a bare statement and discards the
   result.
2. ~~81 public functions authorize inline~~ — **fixed in T2.2 (22 Sep 2026):**
   the audit reports **0** inline `ownerId` checks, and the audit now fails on
   the pattern, so a forgotten line is caught in CI rather than shipped.
3. **The storefront is not actually public.** `storefront.ts` gates every query on
   `requireOwnedProject`, which returns nothing for a signed-out visitor. The
   pages under `/shop/:projectId/*` therefore only render for the owner. This
   strengthens the case for T2.15 (public-origin separation + pre-rendering): the
   public read path needs to exist *and* be safe, not just be un-gated.
4. **The country matrix is a stub** (T2.3). `capabilities.COUNTRY_MATRIX` has one
   wildcard policy, so no country restriction is modelled and the
   `unavailable` state is currently unreachable in practice. Fill it in when
   owner decision #4 is answered — the seam (one map, one resolver) is already in
   place and no guard, UI or test has to change.
5. **`needs_setup` is reachable but currently unused.** `resolveCapabilityState`
   returns it for `setup: false` on a write (reads stay available), and the
   builder can carry it, but no module passes `setup` yet: connections (T2.7) is
   the first candidate. Until then the state exists in the registry, the matrix
   and the UI's honest labels, and nothing claims it.
6. ~~Four copies of the plan → module list~~ — **fixed in T2.3 (22 Sep 2026):**
   `src/convex/lib/capabilities.ts` is the only list (`PLAN_MODULES` re-exported by
   `billing.ts`), the UI reads `entitlements.matrix` / `entitlements.plans`, and
   `bun run audit:capabilities` fails on a module function that is reachable
   without a capability or a documented exemption.

---

## 6. Owner decisions still blocking work

These are the pack's open questions, unchanged:

| # | Question | Blocks |
|---|---|---|
| 1 | Whose Stripe account receives buyers' payments (connected accounts vs. platform)? | ✅ **Answered (owner, 22 Sep 2026): connected accounts (Stripe Connect)** for the commerce add-on (E3.4); MOSAI's own plan subscriptions bill to the platform account. **Stripe Tax is enabled**; the launch **plans/prices are not final**, so T2.4 ships plan→price as configuration (`STRIPE_PRICE_*`) and treats an unconfigured plan as `needs_setup`. |
| 2 | Are the exposed email + dotenvx secrets yours to rotate, or issued by the platform? Do you keep the platform for any production service? | T0.1, T0.8, ADR-9 |
| 3 | Keep "all add-ons on one launch date", or adopt the cut-line rule? | ADR-8 |
| 4 | Which countries and languages must be polished at launch? Regulated products, marketplaces, B2B pricing in scope? | capability matrix |
| 5 | Is the app builder for the same small-business audience, or for startups and agencies? | defaults, pricing |
| 6 | Where does a generated app's backend live, and how does a customer take it away? | G6, export promise |
| 9 | App builder preview runtime and approach (BP-15 first slice)? | ✅ **Answered (owner, 24 Sep 2026): in-browser Sandpack first, port open-lovable, chat first.** Recorded in `docs/decisions/2026-09-24-app-builder-preview.md`. Generation, versions and preview exist; app backend, deploy and export still wait on question 6 and ADR-3. |
| 7 | Is "Conductor" the enterprise SEO/AI-search platform? | `09` |
| 8 | Which package manager is authoritative — bun (what the platform runs today) or npm (what the blueprint's commands assume)? | ✅ **Answered in T1.1 (22 Sep 2026): bun.** `bun.lock` is the only lockfile, the runtime is pinned in `engines` + `.nvmrc`, and `AGENTS.md` §4 is the authoritative command list. Every `npm ci` / `npm run …` in the blueprint and `10-build-backlog.md` is to be read as its bun equivalent; no further ticket is needed. |

Non-blocking: agency billing owner, dashboard localization and RTL scope, TikTok
organic posting, data-residency promise, SMS/WhatsApp, SSO.

---

## 7. Missing reference documents (recorded by BP-01, 23 Sep 2026)

The following documents are named by AGENTS.md, the backlog or tickets but are
**absent from this workspace** (blocker B1). They are recorded as permanently
missing rather than invented — their content must never be fabricated:

| Document | Named by | Impact of the absence |
|---|---|---|
| `MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md` | AGENTS.md §2, many tickets | Pack line-number citations cannot be re-verified; the saved verbatim copy `docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md` is the implementation contract in its place |
| `docs/pack/01-…`–`09-…` (incl. `04-adrs.md`, `05-design-system.md`, `07-ai-agent-config.md`, `08-module-contracts.md`) | AGENTS.md §2, T2.5, blueprint §5 | ADR/design/AI-config/module-contract details must come from AGENTS.md, the root design contracts (`WEBSITE-*`, `SELL-*`, `CMS-*`, `M1-BLUEPRINT`) and tickets; AI eval floors (07) and ADR-3/4/6/7-dependent choices in BP-09/BP-13/BP-14/BP-15 stay open until the files or explicit owner answers arrive |
| `MOSAI-READINESS-AUDIT-2026-09-23.md` | chat-0 brief | Readiness claims cannot be cross-checked; release-readiness stays unverified until BP-20 |

None of these absences blocks the test/CI repairs or other code work; only the
dependent interpretation steps wait. `docs/pack/README.md` and
`docs/pack/10-build-backlog.md` were reviewed under BP-01 and need no change.
