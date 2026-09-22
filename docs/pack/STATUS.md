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

This file exists so that a fresh agent session does not re-do finished work and
does not trust the pack where the code has moved on. It is the pack's precedence
level 5 — a ticket still wins on scope — but it is the ground truth about *state*.

---

## 1. Headline

Phase 0 (stop the exposure) is **substantially complete in code**. Phase 1 (make
the repository buildable and testable) is **not started**. The remaining Phase 0
items all need an owner action (key rotation, choosing an email provider) or a
decision, not code.

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
| R1 | No anonymous provider; a new user has Base access only; leftover anonymous accounts are rejected | ✅ code in place, **no automated test yet** |
| R2 | `changePlan` from a client is rejected | ✅ code in place, no test |
| R3 | AI/scraping actions reject unauthenticated callers | ✅ code in place, no test |
| R4 | AI actions load context server-side | ❌ **not done** (T0.4 remainder) |
| R5 | `safeFetch` blocks loopback/private/metadata/non-HTTPS/redirect-to-private | ✅ code in place, no test |
| R6 | Cross-tenant write blocked (`collections.create`) | ✅ code in place, no test |
| R7 | `<script>`, `onerror=`, `javascript:` never execute | ✅ render sinks covered; server-side save not |
| R8 | Fake connection refused | ✅ code in place |
| R9 | Shopify sync cannot read a deployment-wide store | ✅ code in place |
| R10 | Deletion completeness (generated from the schema) | ❌ not done — `dal.cascadeDeleteProject` is now the single cascade (33 tables + children) called by both `projects.remove` and `billing.deleteAccount`, but there is **no test** and `oauthStates` is deliberately not deleted |
| R11 | Secret scan fails on a planted secret; history clean | 🟡 config added, no CI, history not purged |
| R12 | No request to platform domains with platform vars unset | ❌ **not done** |

**Verdict on G-P0:** the *code* holes are closed (except R4/R10-cascade-finalization/R12);
the *proof* is missing, because there is no test runner and no CI. That is
exactly Phase 1.

---

## 3. Phase 1 baseline — verified now

| Item | State (verified) |
|---|---|
| Package manager | **bun is authoritative (T1.1, 22 Sep 2026).** `package-lock.json` is deleted; `bun.lock` is the only lockfile and was regenerated from a clean `node_modules`. `rm -rf node_modules && bun install --frozen-lockfile` exits 0 with no peer warnings. |
| Tiptap peer conflict | **Resolved (T1.1).** `@tiptap/extension-collaboration-cursor@^2.26.2` was not imported anywhere in `src/` (the only collaboration import is `@tiptap/extension-collaboration`, in `src/components/app/ContentEditor.tsx`) and has been removed; the lockfile no longer contains it. |
| Typecheck | **T1.3 (22 Sep 2026): 0 errors.** `bun tsc -b --noEmit` → exit 0 with codegen present, re-verified with the incremental cache wiped (`rm -rf node_modules/.tmp`) and with `--force`, and per project (`tsconfig.app.json`, `tsconfig.node.json`) → all exit 0, 0 errors. A planted `TS2322` was reported by `tsc`, proving the check reads `src/`. No `@ts-ignore`/`@ts-expect-error` anywhere; `as any` count unchanged (4, incl. the accepted `dal.ts` handle). |
| Convex codegen | **Committed (T1.2, 22 Sep 2026).** `src/convex/_generated` is no longer git-ignored; `convex codegen` output is deterministic (regenerating leaves the 5 files byte-identical). `bun run check:codegen` regenerates with `convex codegen` and fails on drift (`git diff --exit-code`); `bun run codegen` regenerates by hand. `bun convex dev --once` → succeeds against `julekpl:mosai-another:dev`. |
| Lint | **82 errors / 29 warnings** (82 = 49 `no-unused-vars` + 22 `no-explicit-any` + 11 `react-hooks/*`). Measured during T1.1, which touched no source file; the pack's 79 was a different tree. T1.4 re-measures and owns the fixes. |
| Tests / test runner / CI | **None.** `package.json` has no test script; no `.github/workflows`. |
| Secret scanning | `.gitleaks.toml` exists; no CI job, no pre-commit hook, gitleaks not installed. |
| Node/bun engines | **Pinned (T1.1):** `engines.node >= 22.12.0`, `engines.bun >= 1.3.0`, `.nvmrc` = `22`. |
| Authorization audit | `bun run audit:functions` → exit 0. Reports 90 functions guarded by a shared helper, 81 via an inline `ownerId` check (to migrate in T2.2), and **8 worth a human look** (see §5). |

---

## 4. What the pack describes that has moved on in the code

| Pack statement | Current reality |
|---|---|
| Two `assertModule` copies with different defaults decide who can use a mutation | **Fixed.** One implementation, in `guards.ts`; the free-plan fallback is the only one. |
| `projects.remove` and `billing.deleteAccount` use two divergent hard-coded table lists that never delete 17 tables | **Fixed.** Both call `dal.cascadeDeleteProject`, which walks 33 `by_project` tables plus the children that have no project index (`contentDocs`, `buildMessages`, `productMedia`, `personaMessages`) and deletes `projectFiles` storage blobs. `oauthStates` is intentionally skipped (short-lived, no project index). There is still no grace-period finalizer job. |
| `collections.create` checks only the plan | **Fixed.** `requireProject` now runs first. |
| `guards.ts` falls back to `scale` on reads | **Fixed.** Single `DEFAULT_PLAN = "free"`. |
| AI actions are unauthenticated | **Fixed.** They require a signed-in, non-anonymous user. They still trust a client-supplied snapshot (T0.4 remainder). |
| Connections can be marked connected without OAuth | **Fixed.** Only an internal mutation can write `connected`. |

---

## 5. Open items this audit found that the pack does not list

1. **8 public functions authenticate but never authorize** — `bun run audit:functions`
   names them: `ads/copilot.setCopilotModel`, `billing.currentPlan`,
   `files.generateUploadUrl`, `files.getFileUrl`, `projects.list`,
   `social/copilot.draftVariants`, `social/copilot.suggestSchedule`,
   `users.currentUser`. Most are self-scoped (own user row, own project list) or
   admin-gated, but `files.getFileUrl` and `social/copilot.draftVariants` should
   be confirmed by hand. `ads/copilot.copilotModel` was unauthenticated and now
   requires sign-in.
2. **81 public functions authorize inline** (`project.ownerId !== userId`) rather
   than through `requireProject`. That is the pattern that produced the
   `collections.create` bug: one forgotten line is a cross-tenant write. Migrate
   them in T2.2; the audit script already reports them.
3. **The storefront is not actually public.** `storefront.ts` gates every query on
   `requireOwnedProject`, which returns nothing for a signed-out visitor. The
   pages under `/shop/:projectId/*` therefore only render for the owner. This
   strengthens the case for T2.15 (public-origin separation + pre-rendering): the
   public read path needs to exist *and* be safe, not just be un-gated.

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
