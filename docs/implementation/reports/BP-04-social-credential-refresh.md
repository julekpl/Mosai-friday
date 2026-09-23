# BP-04 — Social credential handoff and social/ads token refresh

**Package:** BP-04 (Order A, second package; blueprint §5 BP-04 / §10).
**Chat:** 2 · **Date:** 23 September 2026.
**Status:** `implemented_unverified` — code and all mocked acceptance tests
pass (10/10 new regressions, 305/305 unit); approved external proof (a
controlled refresh against a real provider test account, owner decision
**O7**) is pending. **BP-01 remains `implemented_unverified` and the overall
release gate remains BLOCKED** (blocker **B3** — tracked `.env.keys` +
historical credential; this package waives nothing).

**Working-tree/ref note (inspected at chat start):** git commands are blocked
(B2: "Git and GitHub commands are blocked; Vly manages version control."), so
the ref was read from `.git/refs/heads/main`: **`e25639d4eb39511b859dad8d0b583c44a061814c`**
— a commit *after* `dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` (the BP-01
documentation commit) whose **CI result is unknown and must never be
assumed**. No previous BP-04 edits existed; nothing was assumed committed.

**Main-branch workflow exception (owner-approved for BP-04 only):** this
package was implemented on Freebuff/Vly's existing **main-branch autosave
workflow** — no manual commit, no push, no pull request, no deploy, no
production interaction was performed by the agent; Vly manages its normal
autosave. **The usual one-ticket / one-branch / one-PR process
(`docs/pack/10-build-backlog.md`, AGENTS.md §2) was NOT followed for
BP-04**, and this report does not claim otherwise. The exception covers
workflow only: no security or release gate is waived by it.

---

## Outcome

All three audited defects (PROGRESS §7.2) are fixed and proven by regressions
that were **shown failing first against the unfixed code**:

1. **Credential handoff (defect 1).** `social.executor.publishOne` no longer
   casts a credential *document* to an `Id`. A typed internal query
   (`social/credentials.getCredential`, by project+platform) loads the
   document and `credential._id` is handed to the refresh action. Every
   affected social call site is updated; the incorrect cast is gone; the
   existing action-safe `executor.getCred` query is preserved. The ads
   contract (`cred._id` from `ads/credentials.getCredId`, which despite its
   historic name returns the document) is **preserved unchanged**.
2. **Refresh moved out of mutations (defect 2).** No `fetch` remains inside
   any `internalMutation` (verified by grep + the regression that fails on
   Convex's "fetch is not supported in queries or mutations" error). Provider
   requests now run in two new internal actions —
   `src/convex/social/credentialActions.ts` and
   `src/convex/ads/credentialActions.ts` — following
   *internal query (load) → internal mutation (claim lease + observed
   version) → fetch in the action → internal mutation (save only while the
   lease is held AND the version is unchanged, else release)*. A rotated
   refresh token from the provider is saved; a failed claim is released (or
   expires via `refreshLeaseUntil`); a stale rotating-token response can
   never overwrite a newer token. All three callers (`social.executor`,
   `ads.sync.syncPlatform`, `ads.control.execute`) now `runAction`.
3. **Redaction + reconnect + per-post isolation (defect 3).** Provider
   failures surface as `HTTP <status>` only — the five social adapters no
   longer echo response bodies (a body can contain token material or account
   data). Refresh failures are redacted to an HTTP status and, where the
   provider speaks OAuth, the machine error code. An expired/revoked
   credential becomes an explicit **`needs_reconnect`** state
   (`refreshStatus` on the credential, set only by internal mutations) with a
   safe message. A refresh failure is caught at the **individual post**
   boundary: that post records an honest `failed` state with the redacted
   message and the due-post batch continues. No post is ever marked
   `published` without a provider receipt (`providerRef` from the adapter).
   Authorization, entitlement (`moduleAction("promote", …)`/capability) and
   idempotency checks in the touched paths are unchanged.

## Scope — files changed

| File | Change |
|---|---|
| `src/convex/schema.ts` | **Additive** optional fields on `socialCredentials` and `adsCredentials`: `refreshStatus` (`ok \| needs_reconnect`), `tokenVersion`, `refreshLeaseId`, `refreshLeaseUntil`. No existing field altered. |
| `src/convex/social/credentials.ts` | Rewritten: no `fetch`. Exports `REFRESH_LEASE_MS`, `RefreshOutcome`, `tokenIsFresh`, internal queries `getCredential` (project+platform → **document**) and `getCredentialById`, internal mutations `claimRefresh`, `saveRefreshResult` (lease + `expectedVersion` guard; bumps `tokenVersion`; clears lease), `releaseRefresh`, `markNeedsReconnect`. Old `getCredId`/`refreshIfNeeded` fetch-in-mutation path removed. |
| `src/convex/ads/credentials.ts` | Same shape for ads. `getCredId` **kept** (returns the document — the documented ads contract; callers use `cred._id`) plus `getCredentialById`, `claimRefresh`, `saveRefreshResult`, `releaseRefresh`, `markNeedsReconnect`, `tokenIsFresh`, `RefreshOutcome`. |
| `src/convex/social/credentialActions.ts` **(new)** | `internalAction refreshIfNeeded(credId)`: load → freshness check → reconnect if no refresh token → claim lease → `fetch` token URL → redacted error handling (`invalid_grant`-style ⇒ reconnect + `markNeedsReconnect`) → `saveRefreshResult` (rotated refresh token saved when supplied) or `releaseRefresh` on any failure. |
| `src/convex/ads/credentialActions.ts` **(new)** | Same protocol for `adsCredentials` (Google/Meta/TikTok/ChatGPT token URLs via `platformEnv`). |
| `src/convex/social/executor.ts` | `publishOne`: typed `getCredential` query + `credential._id` → `runAction(credentialActions.refreshIfNeeded)`; refresh failure recorded per post and returned as `{ok:false}` so `runDue` continues; cast removed; `RunCtx` now includes `runAction`; `executor.getCred` action-safe query preserved. |
| `src/convex/social/adapters.ts` | All five publish error strings redacted: `… publish failed (HTTP <status>)` — provider response bodies are no longer read into messages (Facebook, Instagram, LinkedIn, X, TikTok). |
| `src/convex/ads/sync.ts` | `syncPlatform` loads the credential doc via the preserved `getCredId`, hands `cred._id` to `runAction(ads/credentialActions.refreshIfNeeded)`; a rejection surfaces as the action's safe message and the sync stops honestly. |
| `src/convex/ads/control.ts` | `execute` (money path): same refresh-via-action handoff before any provider call; capability `promote.spend`, project access and idempotency-key checks untouched. |
| `src/convex/social/oauth.ts`, `src/convex/ads/oauth.ts` | On a successful (re)connect the stored credential writes `refreshStatus: "ok"` and increments `tokenVersion` (+1), clearing any `needs_reconnect` state and invalidating an in-flight refresh's observed version. |
| `src/convex/lib/capabilities.ts` | `CONVEX_FILE_OWNERS` registry entries: `social/credentialActions` → `internal`, `ads/credentialActions` → `internal` (required by `audit:capabilities`). |
| `tests/unit/social-execution.test.ts` **(new, 3 tests)** | Handoff + batch isolation + redaction regressions. |
| `tests/unit/credential-refresh.test.ts` **(new, 7 tests)** | Action refresh, reconnect, lease/version, outage-release, ads-caller regressions. |

**Not changed (reviewed, preserved):** `guards.ts`, `dal.ts`, `.gitleaks.toml`
(no allow-list entry), `public-functions-allowlist.json` (still 3), all public
function signatures, entitlement/capability gating, receipt/idempotency logic,
`ads/adapters.ts` (out of the named BP-04 scope — see *Observations*).

## Before → After

**Before (baseline defects, re-verified at chat start):**
- `social.credentials.getCredId` (`internalQuery`) returned the credential
  **document**; `social.executor.publishOne` cast it `as Id<"socialCredentials">`
  and passed the document where a validator expects a string → every social
  publish aborted with `Validator error: Expected 'string', got '[object Object]'`
  before any provider call.
- `refreshIfNeeded` (social **and** ads) was an `internalMutation` containing
  `fetch(env.tokenUrl, …)` → Convex refuses it at runtime
  ("`fetch` is not supported in Convex queries or mutations") — token refresh
  could never run; and had it been in an action-less path, concurrent refreshes
  had no lease/version protection, so a slow rotating-token response could
  overwrite a newer refresh token.
- Adapter failures copied `res.text()` (up to 200 chars) into `errorDetail` —
  a provider body (which may echo tokens/account data) was recorded on the
  post and shown to the user.

**After:** see *Outcome* and the acceptance table — refresh runs only in
actions under a lease/version protocol, handoff travels by `._id`, failures
are redacted to `HTTP <status>` (+ OAuth machine code) with an explicit
`needs_reconnect` state, and one failed post never aborts the batch.

## Acceptance criteria — each demonstrated

Evidence: the two new test files were written first and run against the
**unfixed** code: **10 failed / 0 passed**, including
`Validator error: Expected 'string', got '[object Object]'` (executor.ts:207,
defect 1), `` `fetch` is not supported in Convex queries or mutations. Move
this code to an action `` (defect 2) and missing `claimRefresh` /
`credentialActions` registry entries. After the fix: **10/10 pass**.

| Criterion | Evidence (test, all mocked; `fetch` fully stubbed — unrouted URLs throw "live network blocked in tests") |
|---|---|
| A stored credential reaches the correct adapter **with its ID** | `social-execution` → *"a stored credential reaches the adapter with its credential id"*: the refresh action POSTs `grant_type=refresh_token` with the stored synthetic refresh token to the platform's token URL (proving `credential._id` travelled correctly — the old doc-cast fails this at validation), and the publish reaches the LinkedIn adapter with the refreshed token. |
| An expired credential **refreshes through an action** (never a mutation) | `credential-refresh` → *"an expired credential refreshes through an action and stores the rotated refresh token"*: exactly one provider request; access token, **rotated refresh token**, `expiresAt`, `tokenVersion: 1`, cleared lease, `refreshStatus: "ok"` all persisted. The old fetch-in-mutation fails this test with Convex's runtime refusal (shown before the fix). |
| A revoked credential **needs reconnect** (redacted, safe) | `credential-refresh` → *"a revoked credential becomes a reconnect state…"* (provider 400 `invalid_grant` ⇒ `reason: "reconnect"`, `refreshStatus: "needs_reconnect"`, message contains neither the provider body marker nor the refresh token, lease released, rejected tokens untouched) and *"…with no refresh token needs reconnect without calling the provider"* (zero fetch calls). |
| **Concurrent refreshes cannot clobber a newer token** | `credential-refresh` (2 tests): a second `claimRefresh` is refused while the lease is held, and a save with a stale `expectedVersion` is **not applied** (stored newer token wins; `applied: false` path); plus *"an expired lease is claimable again and a failed claim releases cleanly"* — a crashed/held claim expires safely (`refreshLeaseUntil`). |
| **One failed post does not prevent the next due post** | `social-execution` → *"a revoked credential fails only that post with a reconnect state; the next due post still publishes"*: post A ends `failed` with a redacted reconnect message, post B ends `published` with a provider receipt; the batch function completes. |
| **Redaction — never a raw provider body** | `social-execution` → *"a provider failure is redacted on the post — never a raw provider body"*: HTTP 500 publish failure records `LinkedIn publish failed (HTTP 500)`; the planted `LEAKY-BODY-MARKER` from the provider body does **not** appear in `errorDetail`, and no `providerRef` is written (no fake success). |
| **Ads caller contract preserved** | `credential-refresh` → *"syncPlatform surfaces a rejected refresh as a safe reconnect error"*: `ads.sync` loads via the preserved `getCredId` document query, uses `cred._id`, calls the action, and surfaces only the redacted message. `audit:functions` exit 0 (no new public function). |

## Check results — actual exits (before vs after, 23 Sep 2026)

| Check | Before the change | After the change |
|---|---|---|
| `bun run check` (aggregate) | ❌ exit **1** — red only at `scan:secrets` on the pre-existing tracked `.env.keys:8 [dotenvx-private-key]` (value redacted, never read) | ❌ exit **1** — **same single pre-existing finding, no new failure**. Typecheck, lint and all 305 unit tests inside `check` passed before the scan. **The aggregate check is NOT green and is not claimed green** |
| `bun tsc -b --noEmit` | (in `check`: exit 0) | ✅ exit **0** |
| `bun run lint` | exit 0 — 0 errors / 25 warnings | ✅ exit **0** — 0 errors / **25 warnings** (unchanged baseline) |
| `bun run test` (unit, Vitest + convex-test) | 295 passing on this tree (BP-01 count) | ✅ **305/305 passed**, 15 files, exit **0** (305 = 295 + 10 new BP-04 regressions) |
| `bun run audit:functions` | exit 0 (212 authorized, 3 REVIEW, allow-list 3) | ✅ exit **0** (identical: 212 authorized, 3 REVIEW self-scoped, allow-list **unchanged at 3**) |
| `bun run audit:capabilities` | exit 0 (149 scanned, 4 exemptions) | ✅ exit **0** — 149 scanned, 142 enforced, 4 documented exemptions, 3 anonymous allow-listed; the two new files are registry-owned `internal` |
| `bun run check:codegen` | exit 0 | ✅ exit **0** — "Convex codegen is in sync" |
| `bun convex dev --once` (Convex dev check) | n/a | ✅ exit **0** — against the **confirmed dev deployment** `julekpl:mosai-another:dev/julekpl` (`adjoining-gnat-502.convex.cloud`); no server started/stopped, production untouched |
| `bun run test:e2e` | ✅ 15 passed + 1 skipped (`otp-live`, opt-in), exit 0 | ✅ **15 passed + 1 skipped**, exit **0** |
| `bun run test:a11y` | ✅ 5 passed, exit 0 (first attempt hit a transient sandbox 502, retry passed) | ✅ **5 passed**, exit **0** (zero serious/critical, no allow-list) |
| `git status/diff/log` | ❌ blocked (B2) | ❌ blocked (B2) — ref read from `.git/refs/heads/main` only |

Regression demonstration (failing run before the fix), verbatim outcomes:
10/10 failed with the two defect signatures above → after the fix 10/10 pass.
No test, lint rule, scanner or allow-list was weakened to achieve this.

## Security / tenant review

- **Tokens never leave the server.** All new functions are `internal*`
  (queries/mutations/actions); the registry marks both new files `internal`;
  nothing token-bearing is reachable from a client, component, log or error.
  `RefreshOutcome` returned by actions carries `accessToken` **inside the
  server** only (actions call actions/`runMutation`, never a client); user-facing
  messages contain status codes and OAuth machine codes, never token values.
- **No new public function** — `audit:functions` exit 0, allow-list unchanged (3).
- **Client input untrusted preserved:** credential rows are loaded server-side
  by id/project; no client-supplied snapshot enters any refresh path.
- **Redaction:** provider response bodies are read only to extract the OAuth
  `error` code (or not read at all in adapters) and are never echoed into
  posts, receipts, messages or tests; regression asserts a planted body marker
  never reaches `errorDetail`.
- **Concurrency safety:** lease (`refreshLeaseId`/`refreshLeaseUntil`, 60 s)
  + version (`tokenVersion`, bumped on save and on every OAuth reconnect)
  means a stale rotating-token response cannot overwrite a newer refresh
  token; failed claims release; expired leases are reclaimable.
- **Truth (rule 5):** `published` is written only with the adapter's
  `providerRef`; refresh failures write `failed`/`needs_reconnect`, never a
  simulated success. Ads `execute` still records a receipt either way
  (insert-only, unchanged).
- **Authorization/entitlement/idempotency:** unchanged in all touched paths —
  `moduleAction("promote")` (incl. capability `promote.spend` on execute),
  `access.requireUser()/requireProject()` re-checks, and the existing
  idempotency-key requirement preserved; both audits exit 0.
- **Tests:** live network fully blocked (stubbed `fetch`, unrouted URLs
  throw); only synthetic tokens (`test-*-…` placeholders); no real provider
  account, post or campaign was contacted; no real credential was read,
  printed, edited, rotated or allow-listed; scanners untouched.
- **Module contracts:** social and ads each touch only their own tables plus
  the shared capability registry (file-ownership entry required by the audit).

## Migration / rollback

- **Schema:** additive optional fields only (`refreshStatus`,
  `tokenVersion`, `refreshLeaseId`, `refreshLeaseUntil`) on two existing
  tables — no data migration, no backfill; rows without the fields behave as
  before (`tokenIsFresh` treats missing `expiresAt` as fresh; missing
  `refreshStatus` simply displays no reconnect state until the next
  refresh/connect writes it). Convex validators accept existing documents as
  is.
- **Rollback:** reverting the changed files is safe at any time — old code
  ignores the new optional fields; no destructive operation, no data
  rewrite. The only behavioral loss on rollback would be the three defect
  fixes themselves (which is why the regressions must be reverted with the
  fix or they will fail loudly).
- **Deployment:** codegen ran against the dev deployment only
  (`convex dev --once`, exit 0); `check:codegen` confirms the committed
  bindings are in sync. No production deployment was performed or authorized.

## Remaining provider proof and blockers

1. **Real-provider verification — PENDING (owner decision O7).** A controlled
   token refresh against an approved provider test account has not been run;
   no provider account was contacted from this environment. When O7 provides
   approved test accounts, run one refresh per provider (not a campaign
   blast), store the receipt, and confirm rotation handling against the real
   token endpoint. Until then BP-04 is `implemented_unverified`, not
   `complete`.
2. **Release gate — BLOCKED (unchanged, BP-01/B3).** The tracked `.env.keys`
   and the historical credential remain exposed; both CI security jobs failed
   on runs `35828575954` and `35830549968`. Rotation/untracking/history purge
   are **owner-run** per the BP-01 remediation checklist. This package never
   waives, weakens or allow-lists any of it; `bun run check` stays red at
   `scan:secrets` until the owner acts. Local ref now
   `e25639d4eb39511b859dad8d0b583c44a061814c` has an **unknown** CI result.
3. **Observation (out of BP-04 scope, recorded not fixed):**
   `src/convex/ads/adapters.ts` still formats some provider errors from
   response text; it is outside the package's named files
   (`ads/{credentials,sync,control}` only). Recommend folding the same
   `HTTP <status>` redaction into BP-16 (ads adapters) or BP-08.
4. **BP-08 dependency satisfied:** the refresh-in-action + lease/version
   pattern this package establishes is the one BP-08 is specified to reuse.

## Verification (commands, this chat)

```
BEFORE:
  bun run check           → exit 1, red ONLY at scan:secrets (.env.keys:8, redacted)
  bun run audit:functions → exit 0
  bun run check:codegen   → exit 0
  bun run test:e2e        → 15 passed + 1 skipped, exit 0
  bun run test:a11y       → 5 passed, exit 0 (one transient sandbox 502, retry green)

RED FIRST (regressions vs unfixed code):
  vitest {social-execution, credential-refresh} → 10 failed / 0 passed
    - "Expected 'string', got '[object Object]'" (executor doc→ID cast)
    - "fetch is not supported in Convex queries or mutations. Move this code to an action"
    - missing claimRefresh / credentialActions registry entries

AFTER:
  bun convex dev --once    → exit 0 (dev deployment adjoining-gnat-502)
  bun tsc -b --noEmit      → exit 0
  bun run lint             → exit 0 (0 errors / 25 warnings, unchanged)
  bun run test             → 305/305 passed, exit 0 (295 + 10 new)
  bun run audit:functions  → exit 0 (allow-list 3, unchanged)
  bun run audit:capabilities → exit 0 (149 scanned; new files registry-owned internal)
  bun run check:codegen    → exit 0 (bindings in sync)
  bun run check            → exit 1, SAME pre-existing scan:secrets finding only
  bun run test:e2e         → 15 passed + 1 skipped, exit 0
  bun run test:a11y        → 5 passed, exit 0
  vitest {social-execution, credential-refresh} → 10/10 passed
```
