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
allow-list**. Gate G-P1 has no outstanding code work on this tree. **R4 is the one
test still red** — it is
marked `blocked` on T0.4, not weakened or deleted. The remaining Phase 0 items
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
T2.4 (Stripe billing) is next.

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
| **T0.4** authenticate AI/scraping actions, load context server-side | 🟡 **half done** | `requireActionUser` gates the `ai.ts` actions. **Still open:** every AI/scraping action still accepts a client-supplied `projectSnapshotValidator` instead of a `projectId` loaded server-side, and there is no per-user rate limit. |
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
| R4 | AI actions load context server-side | ⛔ **blocked on T0.4** — test written and kept red (`it.fails`) in `phase0-regressions.test.ts`; it turns into a hard failure the moment the client snapshot argument is replaced by a server-loaded `projectId`, which is the reminder to promote it |
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
against them — eleven green guards, plus R4 which is deliberately red and marked
`blocked` on T0.4 rather than deleted or weakened.

---

## 2b. Phase 2 — ticket by ticket

| Ticket | Status | Evidence |
|---|---|---|
| **T2.3** capability registry, per-add-on entitlements | ✅ **done** (22 Sep 2026) | `src/convex/lib/capabilities.ts` — one registry: 8 modules × 5 verbs (34 capabilities), `PLAN_MODULES` (re-exported by `billing.ts`, so the old `assertModule`/tier lists are gone), `ROLE_MODULE_ACTIONS`, the four capability states, a country stub and `CONVEX_FILE_OWNERS`. `guards.ts`: `projectTenant` / `projectCapability` resolve plan × role **for the organization, not the caller**, and `moduleQuery` / `moduleMutation` / `moduleAction` enforce before the handler runs (149 module functions in 31 files). `social/executor.ts` refuses to publish a due post without `promote.publish` and records why with no receipt. UI: `use-module-entitlements.ts` + `entitlements.matrix`/`entitlements.plans` drive the sidebar locks, the `App.tsx` route gate, `Overview` and the `Billing` cards. Gate: `bun run audit:capabilities` (in `bun run check` and CI) fails on an ungated module function, an unclassified file, a public export from a library file and a missing/stale exemption — proven by 6 fixture tests in `tests/unit/audit-gate.test.ts`. Proof of behaviour: `tests/unit/entitlements.test.ts` (26 tests) — generated read axis (8 modules × 4 plans: a downgrade hides rows, an upgrade shows the same rows, nothing is deleted), generated write axis (per module), the plan-locked mutation, the role × action refusal (member vs owner), the job gate, and regressions for three defects (no server enforcement at all; the plan read from the caller instead of the organization, both directions; `entitlements.matrix` answering a foreign caller with an envelope instead of `null`, found by the T2.2 generated suite). Audit: 201 public functions, 194 guarded, 0 inline, exit 0; allow-list still **3** entries, no exemption added. See `docs/tickets/T2.3-capability-registry.md`. |
| **T2.2** org-scoped function builders, generated cross-tenant tests | ✅ **done** (22 Sep 2026) | `guards.ts` exports `orgQuery` / `orgMutation` / `orgAction` and the `OrgAccess` context (`requireProject` / `ownedProject` / `ownedRow` / `requireOrganization`); `hasProjectAccess` = active membership of the owning organization (owner fallback only for a pre-T2.1 row). All **81** inline `ownerId` checks migrated across 27 modules; `projects.list` is organization-scoped. `eslint.config.js` bans a raw `ctx.db` project lookup outside the data-access layer. Audit: 198 public functions, **191** guarded, **0** inline, 4 self-scoped REVIEW, exit 0 — the script now fails on an unscoped function that names a record, proven by `tests/unit/audit-gate.test.ts` (5 tests). Coverage: `function-registry.ts` + `cross-tenant.fixtures.ts` + `cross-tenant.generated.test.ts` — 198/198 public functions classified, 163 record-scoped ones each exercised by a foreign-organization caller that is verified to share no organization with the owner, asserting nothing written (per-table row counts) and nothing revealed. The suite found two real gaps (`buildChat.editPage`/`planSite`/`generateSite`, `sellAI.generateDescription`), both fixed. No allow-list entry added (still 3). See `docs/tickets/T2.2-org-scoped-function-builders.md`. |
| **T2.1** organizations, memberships, roles, invitations | ✅ **done** (22 Sep 2026) | New tables `organizations` / `memberships` / `invitations` / `roles` / `agencyClientLinks` plus `projects.organizationId`; role capabilities in `lib/roles.ts`; `guards.requireOrganization` / `requireOrgRole`; module `organizations.ts` with invitations, role administration, last-owner protection and agency links; idempotent `internalMutation` migration; data-registry entries in `lib/dataRegistry.ts`. Proof: `tests/unit/organizations.test.ts` (9 tests) shows a pre-T2.1 project moving under its owner's personal organization on the first run and a no-op on the second, and the owner/admin/member capability matrix. No allow-list entry added; `requireProject` left owner-based (T2.2). See `docs/tickets/T2.1-organizations-memberships-roles-invitations.md`. |

---

## 3. Phase 1 baseline — verified now

| Item | State (verified) |
|---|---|
| Package manager | **bun is authoritative (T1.1, 22 Sep 2026).** `package-lock.json` is deleted; `bun.lock` is the only lockfile and was regenerated from a clean `node_modules`. `rm -rf node_modules && bun install --frozen-lockfile` exits 0 with no peer warnings. |
| Tiptap peer conflict | **Resolved (T1.1).** `@tiptap/extension-collaboration-cursor@^2.26.2` was not imported anywhere in `src/` (the only collaboration import is `@tiptap/extension-collaboration`, in `src/components/app/ContentEditor.tsx`) and has been removed; the lockfile no longer contains it. |
| Typecheck | **T1.3 (22 Sep 2026): 0 errors.** `bun tsc -b --noEmit` → exit 0 with codegen present, re-verified with the incremental cache wiped (`rm -rf node_modules/.tmp`) and with `--force`, and per project (`tsconfig.app.json`, `tsconfig.node.json`) → all exit 0, 0 errors. A planted `TS2322` was reported by `tsc`, proving the check reads `src/`. No `@ts-ignore`/`@ts-expect-error` anywhere; `as any` count unchanged (4, incl. the accepted `dal.ts` handle). |
| Convex codegen | **Committed (T1.2, 22 Sep 2026).** `src/convex/_generated` is no longer git-ignored; `convex codegen` output is deterministic (regenerating leaves the 5 files byte-identical). `bun run check:codegen` regenerates with `convex codegen` and fails on drift (`git diff --exit-code`); `bun run codegen` regenerates by hand. `bun convex dev --once` → succeeds against `julekpl:mosai-another:dev`. |
| Lint | **0 errors / 25 warnings (T1.4, 22 Sep 2026; T2.2 added a data-access rule without changing the count).** Baseline re-measured on the current tree at **82 errors / 29 warnings** (82 = 49 `no-unused-vars` + 22 `no-explicit-any` + 11 `react-hooks/*`), so the pack's 79/25 was stale. All 82 errors fixed without adding a suppression or weakening `eslint.config.js`; source `eslint-disable` directives went **2 → 1** (only the documented `dal.ts` cascade handle remains). The 25 warnings are 21 Fast-Refresh `only-export-components` in shared modules and 4 generated-file headers — recorded and justified in `docs/tickets/T1.4-zero-lint-errors.md`. `bun run lint` exits 0. **T2.2 (22 Sep 2026)** adds `no-restricted-syntax` for `src/convex/**/*.ts`: a bare `ctx.db.get(projectId)` or `ctx.db.query("projects")` is an error, ignored only for the data-access layer (`guards.ts`, `dal.ts`, `organizations.ts`, `projects.ts`, `billing.ts`, `lib/**`, `_generated/**`), so a feature module cannot authorize a project on its own. 0 errors / 25 warnings still. |
| Tests / test runner / CI | **Added (T1.5, 22 Sep 2026).** Unit: `vitest.config.ts` + `src/convex/test.setup.ts` + `tests/unit/` (Vitest 5, `convex-test`, `@edge-runtime/vm`). Browser: `playwright.config.ts` + `tests/e2e/` (Playwright + `@axe-core/playwright`). Scripts: `test`, `test:unit`, `test:e2e`, `test:a11y`, `scan:secrets`, `check`. CI: `.github/workflows/ci.yml`, one job per concern (install · codegen · typecheck · lint · unit · security · e2e · a11y). Green on this tree: `bun run check` exit 0; `bun run test:e2e` 13 passed; `bun run test:a11y` **5 passed** (T1.8) — `/`, `/auth` and `/app` with zero serious/critical axe violations and no allow-list, plus a skip-link and a keyboard-only sign-in test. **R1–R12 land in T1.7 (done 22 Sep 2026):**`tests/unit/{phase0-regressions,safe-fetch,deletion-completeness,secret-scan,platform-detach}.test.ts`
(33 unit tests) and `tests/e2e/{sanitized-html,no-platform-calls}.spec.ts` (3 browser tests).
**T2.1 added `tests/unit/organizations.test.ts` (9 tests).** **T2.2 added `tests/unit/cross-tenant.generated.test.ts` (165: 163 generated + 2 structural, driven by `function-registry.ts` over every public function), `cross-tenant.fixtures.ts` and `audit-gate.test.ts` (5).** **T2.3 (22 Sep 2026) adds `tests/unit/entitlements.test.ts` (26 — the capability/entitlement suite, generated over the registry) and 6 more cases in `audit-gate.test.ts` for the module-capability gate — 10 files, 246 unit tests total** (245 pass, 1 `it.fails` = R4). Browser: 13 e2e + 5 a11y passed with `--workers=2`. `vitest.config.ts` aliases `@vly-ai/integrations` to `tests/unit/stubs/` because the platform SDK reads `document` at import time and cannot load under `edge-runtime`. |
| Secret scanning | **Wired (T1.5, 22 Sep 2026).** `scripts/scan-secrets.mjs` reads the custom rules from `.gitleaks.toml` and runs inside `bun run check`, so a planted secret fails locally; the CI `security` job also runs gitleaks over full history and the working tree, plus `bun audit --audit-level=high` (now a hard failure, T1.6) and `audit:functions`. The T1.5 ticket quoted a literal dummy `x-api-key` value in its proof table, which the `vly-email-otp-key` rule correctly matched — the doc line was redacted in T1.6 rather than allow-listing `docs/tickets/`. Still open: pre-commit hook and the history purge (owner). |
| Dependency audit | **Clean (T1.6, 22 Sep 2026).** `bun audit` (and `--audit-level=high`) → **"No vulnerabilities found"**; was 1 critical + 4 high + 8 moderate + 2 low. Fixed: `@convex-dev/auth` 0.0.90 → **0.0.94** (moves the `@auth/core` peer to `^0.41.1`) with `@auth/core` pinned at **0.41.3** (GHSA-7rqj-j65f-68wh critical + GHSA-xmf8-cvqr-rfgj high + GHSA-x445-f3h2-j279 moderate), and a root `overrides` entry forcing `undici` to `^7.19.0`, which removes the vulnerable nested `undici@5.29.0` under `@ai-sdk/provider-utils` (GHSA-vrm6-8vpv-qv8q / GHSA-v9p9-hfj2-hcw8 / GHSA-vxpw-j846-p89q high + moderates/lows) and de-duplicates the tree to one `undici@7.29.1`. The pack's `react-router` (7.18.4) and `hono` (4.13.8) findings are stale — neither is flagged. Rationale, the no-in-range-fix analysis and the override's compensating control are in `docs/tickets/T1.6-vulnerable-dependencies.md`. |
| Node/bun engines | **Pinned (T1.1):** `engines.node >= 22.12.0`, `engines.bun >= 1.3.0`, `.nvmrc` = `22`. |
| Authorization audit | `bun run audit:functions` → exit 0. Reports 201 public functions scanned: **194 authorize through a shared guard or the org access object (T2.2/T2.3, up from 106), 0 via an inline `ownerId` check (was 81), and 4 worth a human look** — all four self-scoped with no record argument (see §5). Since T2.2 the script **fails** (exit 1) on a public function that has no sign-in check, that authorizes inline, or that names a record (`v.id(...)`) and never authorizes it; `tests/unit/audit-gate.test.ts` proves each of those exits non-zero against throwaway fixtures. `scripts/public-functions-allowlist.json` is unchanged at 3 entries. (**T2.3, 22 Sep 2026:** the script also recognizes the module builders, so a module function is authorized by the builder that enforces it.) |
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

1. **4 public functions authenticate but never authorize** (was 8 before T2.2;
   `files.getFileUrl`, `projects.list`, `social/copilot.draftVariants` and
   `social/copilot.suggestSchedule` now authorize through the org access object)
   — `bun run audit:functions` names them: `ads/copilot.setCopilotModel`,
   `billing.currentPlan`, `files.generateUploadUrl`, `users.currentUser`. All four
   are self-scoped and take no record argument (own user row, own plan, an upload
   URL, an admin-gated setting), which is why T2.2 left them as REVIEW warnings
   while making "names a record but never authorizes it" a hard failure. Confirm
   by hand if their shape changes.
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
| 1 | Whose Stripe account receives buyers' payments (connected accounts vs. platform)? | G1, ADR-5, ticket T2.4/E3.4 |
| 2 | Are the exposed email + dotenvx secrets yours to rotate, or issued by the platform? Do you keep the platform for any production service? | T0.1, T0.8, ADR-9 |
| 3 | Keep "all add-ons on one launch date", or adopt the cut-line rule? | ADR-8 |
| 4 | Which countries and languages must be polished at launch? Regulated products, marketplaces, B2B pricing in scope? | capability matrix |
| 5 | Is the app builder for the same small-business audience, or for startups and agencies? | defaults, pricing |
| 6 | Where does a generated app's backend live, and how does a customer take it away? | G6, export promise |
| 7 | Is "Conductor" the enterprise SEO/AI-search platform? | `09` |
| 8 | Which package manager is authoritative — bun (what the platform runs today) or npm (what the blueprint's commands assume)? | ✅ **Answered in T1.1 (22 Sep 2026): bun.** `bun.lock` is the only lockfile, the runtime is pinned in `engines` + `.nvmrc`, and `AGENTS.md` §4 is the authoritative command list. Every `npm ci` / `npm run …` in the blueprint and `10-build-backlog.md` is to be read as its bun equivalent; no further ticket is needed. |

Non-blocking: agency billing owner, dashboard localization and RTL scope, TikTok
organic posting, data-residency promise, SMS/WhatsApp, SSO.
