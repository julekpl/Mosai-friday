# BP-01 — Repair the baseline and make status documentation trustworthy

**Package:** BP-01 (Order A, first package; blueprint §5 / §10).
**Chat:** 1 · **Date:** 23 September 2026.
**Baseline:** branch `main` @ `a3edd69bf813e4705f9d189fe43079aee3f2257e`
(blueprint baseline; read from `.git/refs/heads/main` — git commands are
blocked in this environment, blocker **B2**).

---

## Outcome

The browser gates no longer treat `https://placeholder.convex.cloud` as a
working service: every Convex call in tests is intercepted by a documented
test-only double, the real OTP journey is a separate opt-in spec, the CI
security job is split so a history finding can no longer skip the working-tree
scan and the audits, failure artifacts are uploaded SHA-named with 7-day
retention, the smoke assertions match the current landing copy, stale status
claims in `STATUS.md` are corrected to agree with executable code, and the
T2.5 "done" discrepancy is reconciled as **not implemented** (fix belongs to
BP-05 — deliberately not done here).

## Scope (files changed)

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Full-history secret scan split into its own `security-history` job so a history finding can no longer skip the working-tree scan, local scan, both authorization audits or the dependency audit. Browser jobs use the inert `VITE_CONVEX_URL: https://e2e-test-only.convex.cloud`. On failure both browser jobs upload `test-results/` as artifacts named with `${{ github.sha }}`, retention 7 days, `if-no-files-found: ignore`. |
| `playwright.config.ts` | Bounded workers (CI 1, local 2 — the default worker count crashed renderers under cold-start load), `trace: on-first-retry`, `screenshot: only-on-failure`, 1 retry in CI. |
| `tests/e2e/fixtures/test-backend.ts` **(new)** | Test-only backend double: intercepts the Convex WebSocket sync protocol and the HTTP `/api/action` envelope before the network; signed-out queries resolve `null`; `TestBackendControl` switches send/verify steps between success and error. Lives under `tests/`, never imported by `src/`, simulates responses only — no server, no guard bypass, no credentials, no real OTP. |
| `tests/e2e/smoke.spec.ts` | Assertions updated to the intended current copy (H1 "Your marketing, coming together.", brand "mosai", primary CTA "Create your workspace" → real click → `/auth` URL assertion, "Get Started", OTP placeholder, 404). |
| `tests/e2e/auth-contract.spec.ts` **(new)** | Deterministic error-state contract tests against the double: a refused code send surfaces an announced `role="alert"` and never advances to "Check your email" (no fake success); an incorrect verification code is rejected on the code step. |
| `tests/e2e/otp-live.spec.ts` **(new)** | The one real-OTP journey. Never runs by default: `test.skip` with the reason on screen unless `E2E_LIVE_CONVEX_URL` + `E2E_LIVE_TEST_EMAIL` are set (owner decisions O2/O7). Imports `@playwright/test` directly — no fallback to the double. |
| `tests/e2e/a11y.spec.ts`, `tests/e2e/no-platform-calls.spec.ts` | Import the test-only fixture so the signed-out `/app → /auth?returnTo` redirect and the network assertions resolve deterministically in CI; `settleForAxe` now waits for content + fonts + finite entrance animations with double-sample stability (fixes a mid-fade race that produced one bogus serious `color-contrast` node). |
| `src/pages/Landing.tsx` | Real axe defect fixed: `list`/`listitem` violation (`<Reveal>` divs as `<ol>` children) — found while making the a11y gate honest, not weakened. |
| `docs/pack/STATUS.md` | Stale claims corrected to agree with code (see *Inventory* below); T2.5 reconciled in §2b; missing reference documents recorded in new §7; honest reds recorded (secret scan, owner-run history scan). |
| `docs/tickets/T2.5-data-registry-export-deletion.md` | Annotated with the same reconciliation finding (ticket says done; tree does not contain it). |

**Not changed (reviewed, no change needed):** `.gitleaks.toml` (no
allow-list entry added), `scripts/scan-secrets.mjs`,
`docs/pack/README.md`, `docs/pack/10-build-backlog.md`,
`tests/unit/platform-detach.test.ts`.

## Before → After

**Before (baseline):**
- CI handed the app `https://placeholder.convex.cloud` and implicitly treated
  it as a working service; signed-out-redirect and sign-in-response
  assertions hung or silently depended on whatever backend happened to answer
  (and locally performed a *real* OTP send).
- The full-history secret scan was the first step of the `security` job, so a
  history finding skipped the working-tree scan, the local scan, both
  authorization audits and the dependency audit — real checks hidden behind
  one red step.
- The smoke spec asserted copy from before the 22 Sep landing rewrite and was
  red in baseline CI run 35790335737.
- `STATUS.md` claimed 13 e2e / 263 unit tests / R4 blocked / `bun run check`
  exit 0 — none matched the tree.

**After (measured this chat):** see Verification. The one remaining red is the
working-tree secret scan finding the **tracked** `.env.keys` — an owner
rotation/untracking action, never an allow-list entry.

## Verification — gate outputs reproduced this chat (23 Sep 2026)

| Gate | Result |
|---|---|
| `bun run check` → typecheck | ✅ exit 0, 0 errors |
| → lint | ✅ exit 0, **0 errors / 25 warnings** (unchanged T1.4 baseline) |
| → unit (Vitest) | ✅ **295/295 passed**, 13 files, ~9s. **No `it.fails` anywhere — R4 is green** |
| → `scan:secrets` | ❌ **exit 1 — honest red**: `.env.keys:8  [dotenvx-private-key]`, value redacted by the scanner. Fix = owner rotation + untracking (`docs/runbooks/secret-rotation.md`). Never allow-listed. Because `check` chains with `&&`, the two audits were run separately (next rows) |
| `bun run audit:functions` | ✅ exit 0 — 218 scanned, 212 guard/org-authorized, 3 REVIEW (self-scoped), allow-list unchanged at 3 |
| `bun run audit:capabilities` | ✅ exit 0 — 149 scanned, 142 enforced, 4 documented exemptions, 3 anonymous allow-listed |
| `bun run test:e2e` | ✅ **15 passed + 1 visibly skipped** (`otp-live`, opt-in) in 1.3m, hermetic against the double |
| `bun run test:a11y` | ✅ **5 passed** — `/`, `/auth`, `/app` zero serious/critical, no allow-list, plus skip-link and keyboard-only sign-in |
| `git` | ❌ blocked ("Vly manages version control") — **B2 re-confirmed live this chat** |
| `gitleaks` binary | not installed — full-history scan is **owner-run evidence** (command in *Security* below) |

## Acceptance criteria — each demonstrated

| Criterion | Demonstration |
|---|---|
| **All existing CI jobs execute and pass, including security checks previously skipped after the history failure** | The split guarantees execution: `security-history` and `security` are separate jobs, so a history finding can no longer skip the working-tree scan, local scan, `audit:functions`, `audit:capabilities` or `bun audit`. Every job's command is green locally **except two owner-gated honest reds, recorded not hidden**: (1) `scan:secrets` fails on the tracked `.env.keys` — fix is rotation + untracking per runbook, `git` blocked for agents (B2/B3); (2) `security-history` needs the gitleaks binary + git history — owner-run, command below. The `codegen` job's dated TODO (warns and skips without `CONVEX_DEPLOY_KEY`) is pre-existing, staged honesty, unchanged. |
| **Broken auth fails the relevant gate** | **Planted and observed this chat:** `RequireAuth`'s signed-out redirect was disabled → `a11y "app has no serious axe violations"` **failed** (its settle asserts `/auth?returnTo=%2Fapp` and never arrived). Reverted → **7/7 green** on re-run. |
| **Wrong CTA navigation fails the relevant gate** | **Planted and observed this chat:** hero CTA `href="/auth"` → `"/signup"` → `smoke "the landing page renders and routes to sign-in"` **failed**: `Expected pattern: /\/auth$/, Received: http://localhost:5173/signup` (screenshot + error-context written to `test-results/`, exactly what CI uploads). Reverted → green. |
| **Planted synthetic secret fixtures fail the relevant gates** | Proven earlier this chat: a synthetic `CONVEX_DEPLOY_KEY` fixture → scanner printed the finding with the value redacted, exit 1; fixture removed afterwards. Permanent regressions: `tests/unit/secret-scan.test.ts` + `secret-scan-env.test.ts` (6 tests, green in the 295) plant dummy keys in throwaway directories and assert exit 1 without echoing the value. |
| **CI evidence attached to the exact commit** | Configured: artifacts are named `e2e-results-${{ github.sha }}` / `a11y-results-${{ github.sha }}`, uploaded on `failure()`, 7-day retention, sanitized by construction (test-only double, synthetic data, no credentials). Actually *attaching a run* to a commit requires pushing/Actions — **owner-run (B2)**; the workflow definition guarantees the SHA binding whenever CI runs. |
| **STATUS agrees with executable code** | Stale claims corrected (Inventory below) and re-verified against today's outputs: 295 unit / 15+1 e2e / 5 a11y / audits exit 0 / check red only at `scan:secrets` / R4 green / T2.5 not implemented / missing docs in §7. |

## Inventory — skipped tests, expected failures, stale claims (scope item 6)

**Skipped (visible, documented — not hidden under a green headline):**
1. `tests/e2e/otp-live.spec.ts` — the real OTP journey; skipped with the
   reason on screen unless `E2E_LIVE_CONVEX_URL` + `E2E_LIVE_TEST_EMAIL` are
   set. Needs a test deployment + test inbox (owner decisions O2/O7).
2. CI `codegen` job — warns and exits 0 without `CONVEX_DEPLOY_KEY`
   (pre-existing dated TODO, T1.5); not BP-01's to enable (an account/key
   decision).

**Expected-failure tests: none.** The previously "deliberately red" R4 was
**promoted to green** on 22 Sep (T0.4's server-side context loading landed);
`it.fails` count on this tree is **0** and all 295 unit tests pass. PROGRESS §3
("R4 deliberately red") was stale and is superseded by this report.

**Stale claims fixed in STATUS.md:** unit count 263 → **295**; R4 "blocked
(it.fails)" → **green, promoted 22 Sep, re-verified**; T0.4's client snapshot
validator "still present" → **gone** (server-loaded `actionProjectSnapshot`;
only the per-user rate limit remains open); "bun run check exit 0" → **red at
`scan:secrets` on the tracked `.env.keys`** (honest); "13 e2e passed" → **15 +
1 skipped**; T2.5 "done" → **reconciled: not implemented** (below).

## History scan investigation (scope item 7)

- Investigated **without printing any matched secret**: the scanner's own
  output redacts matched spans (`[redacted]`), and this report reproduces only
  rule ids, paths and line numbers.
- What is known: the working-tree scan's only finding is the **tracked**
  `.env.keys` at line 8 (`dotenvx-private-key` rule); `.gitleaks.toml` also
  carries the `vly-email-otp-key` rule for the OTP key that was committed in
  `emailOtp.ts` while the repo was public — both are documented in
  `docs/runbooks/secret-rotation.md` as compromised.
- What could **not** run here: the full-history gitleaks scan — git is blocked
  for agents (B2) and the gitleaks binary is not installed. Owner-run command
  (findings are never pasted into chat/docs):
  `gitleaks detect --no-banner --config .gitleaks.toml --redact --exit-code 1`
- **No allow-list entry was added** to `.gitleaks.toml` or
  `public-functions-allowlist.json` (still 3). Silencing an exposed credential
  to pass CI is prohibited by the ticket and AGENTS.md §5.1.
- Credential rotation and any history rewrite require the owner's explicit
  operational authorization (ticket text; runbook exists).

## T2.5 discrepancy — reconciled, not fixed (scope item 8)

Recorded identically in `STATUS.md` §2b and annotated in the ticket header.
**True state on this tree:** `src/convex/lib/dataRegistry.ts` still labels
itself the T2.1 seed (~14 org/billing tables); `lib/dataLifecycle.ts` does not
exist; `crons.ts` has **no** account-deletion finalizer; `billing.deleteAccount`
still performs the old immediate `dal.cascadeDeleteProject` cascade
(L383–395); `data.exportProject` / `data.exportAccount` / `data.obligations` /
`ACCOUNT_DELETION_GRACE_DAYS` have **no matches** in `src/convex`;
`scripts/audit-data-registry.mjs` and `tests/unit/data-registry.test.ts` do not
exist. The ticket header's **Status: done** is therefore disproven by code.
The four owner decisions (D2) remain valid policy — **implementing them is
BP-05**, deliberately not touched in this package.

## Missing reference documents (scope item 9 / blocker B1)

The B1 files (`MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md`, `docs/pack/01–09` incl.
`04-adrs.md`, `05-design-system.md`, `07-ai-agent-config.md`,
`08-module-contracts.md`, `MOSAI-READINESS-AUDIT-2026-09-23.md`) were **not
provided** this chat. Per the ticket's only-if-provided condition and the
blueprint's prohibition on inventing content, they were **not** brought into
`docs/pack/` and none of their content was fabricated. They are recorded as
permanently missing **with per-document impact** in `STATUS.md` §7;
`README.md` and `10-build-backlog.md` were reviewed and need no change.
Impact: AI eval floors (07) and ADR-3/4/6/7-dependent choices in
BP-09/BP-13/BP-14/BP-15 stay open until the files or explicit owner answers
arrive; no test/CI or other code work is blocked.

## Security and privacy

- Test-only shortcuts are confined to `tests/`; `src/` never imports them; they
  simulate *responses* and never authenticate anyone or bypass a server guard
  (no server is involved).
- No secret values were read, printed, committed or allow-listed this chat;
  findings appear only as rule id + path + line with `[redacted]` values.
- CI artifacts are sanitized by construction: synthetic data only (test-only
  double, `example.com` addresses), 7-day retention.
- `.gitleaks.toml` allow-list unchanged (docs-naming-paths only);
  `public-functions-allowlist.json` unchanged (3).

## Verification (commands, this chat)

```
bun run check                 → red ONLY at scan:secrets (.env.keys:8, redacted)
  typecheck                   → exit 0
  lint                        → 0 errors / 25 warnings
  test:unit                   → 295/295 passed
bun run audit:functions       → exit 0 (218 scanned, allow-list 3)
bun run audit:capabilities    → exit 0 (149 scanned, 4 exemptions)
bun run test:e2e              → 15 passed + 1 skipped (otp-live, visible)
bun run test:a11y             → 5 passed (zero serious/critical, no allow-list)
plant: RequireAuth redirect disabled → a11y app gate FAILED   → reverted → 7/7 green
plant: hero CTA → /signup      → smoke URL assertion FAILED   → reverted → 7/7 green
plant: synthetic CONVEX_DEPLOY_KEY (earlier this chat) → scan exit 1, redacted → removed
git / gitleaks                → blocked / not installed (B2): owner-run evidence
```

## Proof / remaining owner-run evidence (B2, B3)

1. Push the commit and attach the CI run (workflow guarantees SHA-named
   artifacts); agent cannot run git/GitHub commands.
2. Full-history scan: `gitleaks detect --no-banner --config .gitleaks.toml
   --redact --exit-code 1` — never paste findings.
3. Rotate the dotenvx key + OTP key and untrack `.env.keys`
   (`docs/runbooks/secret-rotation.md`) — after this `bun run check` goes fully
   green. **Not** an allow-list entry.
4. Provide B1 documents (or record owner answers) when available.

## Data migration

None. No schema changes, no data touched.
