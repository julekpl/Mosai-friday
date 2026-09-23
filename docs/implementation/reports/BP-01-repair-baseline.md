# BP-01 — Repair the baseline and make status documentation trustworthy

**Package:** BP-01 (Order A, first package; blueprint §5 / §10).
**Chat:** 1 · **Date:** 23 September 2026.
**Baseline:** branch `main` @ `a3edd69bf813e4705f9d189fe43079aee3f2257e`
(blueprint baseline; read from `.git/refs/heads/main` — git commands are
blocked in this environment, blocker **B2**).

**CI evidence (two commits, two runs — 23 September 2026):**

| Commit | Role | Run | Result |
|---|---|---|---|
| `d3f6a8e09e301944789dc2c4487a831dc7698137` | **implementation commit** (BP-01 code/tests/CI changes) | [`35828575954`](https://github.com/julekpl/Mosai-friday/actions/runs/35828575954) | **completed / failure** — typecheck, lint, unit, codegen drift, e2e, a11y passed; **both security jobs failed** at their secret-scan steps |
| `dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` | **documentation commit** (this report + PROGRESS.md + STATUS.md reconciliation); local `.git/refs/heads/main` now holds this SHA | [`35830549968`](https://github.com/julekpl/Mosai-friday/actions/runs/35830549968) | **completed / failure** — install, typecheck, lint, unit, codegen, e2e, a11y passed; **the same two secret-scan jobs failed** |

The documentation commit changed only `.md` files, and its run reproduces the
implementation run exactly: same six/seven green jobs, same two red scans.
**BP-01 status remains `implemented_unverified` and the release gate is
blocked — CI is not green and must never be described as green while these
failures stand.** See *CI reconciliation* and the *Owner remediation
checklist* below. **Forward rule:** any future commit (including the next
documentation edit) triggers a fresh CI run whose result does not exist until
it completes — it must never be claimed or implied in advance.

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

CI runs **35828575954** (`d3f6a8e`, implementation) and **35830549968**
(`dd9c163`, documentation) prove the split works structurally: both security
jobs **executed independently** (a history finding no longer skips the
working-tree scan), and the install/typecheck/lint/unit/codegen/browser jobs
all **passed** on both exact commits. Each run as a whole is a **failure**:
both scans found real exposures. That is the honest state; the release gate
stays blocked pending owner remediation (checklist below).

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
| **All existing CI jobs execute and pass, including security checks previously skipped after the history failure** | **Execute (the named defect): demonstrated by run 35828575954** — `security` and `security-history` are separate jobs; the history failure ran in its own job and did **not** skip the working-tree scan, which executed and failed on its own finding. (Within `security`, steps are sequential fail-fast: its later steps — local scan, both audits, `bun audit` — did not run after the first scan failed; their commands were verified green locally this chat. Optional `if: always()` hardening recorded, out of scope.) **Pass: NOT met.** Both security jobs **failed** (working-tree: tracked `.env.keys`; full-history: at least one historical credential — values never read or printed). Six other jobs passed on `d3f6a8e`. No scan may be weakened or allow-listed to change this; the fix is the owner remediation checklist below. **Release gate: blocked.** |
| **Broken auth fails the relevant gate** | **Planted and observed this chat:** `RequireAuth`'s signed-out redirect was disabled → `a11y "app has no serious axe violations"` **failed** (its settle asserts `/auth?returnTo=%2Fapp` and never arrived). Reverted → **7/7 green** on re-run. |
| **Wrong CTA navigation fails the relevant gate** | **Planted and observed this chat:** hero CTA `href="/auth"` → `"/signup"` → `smoke "the landing page renders and routes to sign-in"` **failed**: `Expected pattern: /\/auth$/, Received: http://localhost:5173/signup` (screenshot + error-context written to `test-results/`, exactly what CI uploads). Reverted → green. |
| **Planted synthetic secret fixtures fail the relevant gates** | Proven earlier this chat: a synthetic `CONVEX_DEPLOY_KEY` fixture → scanner printed the finding with the value redacted, exit 1; fixture removed afterwards. Permanent regressions: `tests/unit/secret-scan.test.ts` + `secret-scan-env.test.ts` (6 tests, green in the 295) plant dummy keys in throwaway directories and assert exit 1 without echoing the value. |
| **CI evidence attached to the exact commit** | **Concrete evidence on two exact commits:** implementation `d3f6a8e` → run `35828575954` and documentation `dd9c163` → run `35830549968` — typecheck, lint, unit, codegen(drift), e2e and a11y **passed on both SHAs** (install passed on the latter, explicitly); **both security jobs failed on both** (recorded above, not hidden). Failure artifacts remain configured as `e2e-results-${{ github.sha }}` / `a11y-results-${{ github.sha }}`, 7-day retention, sanitized by construction (test-only double, synthetic data, no credentials) — uploaded only for failing runs; in both runs the failures were in the security jobs, which produce no browser artifacts. The criterion's *evidence* half is met; the *all-jobs-pass* half remains blocked on owner remediation. |
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

1. ~~Push the commit and attach the CI run~~ — **done externally, twice:**
   implementation `d3f6a8e09e301944789dc2c4487a831dc7698137` → run
   `35828575954`, and documentation
   `dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6` → run `35830549968`; both
   **completed/failure** with install/typecheck/lint/unit/codegen/e2e/a11y
   passed and **both security jobs failed** (recorded above — CI is not
   green). Any subsequent commit requires a fresh run, not an assumption.
2. Full-history scan outcome is now known at the job level (failed, at least
   one historical credential) but its findings stay owner-side: `gitleaks
   detect --no-banner --config .gitleaks.toml --redact --exit-code 1` —
   never paste findings.
3. Rotate the dotenvx key + (decision §6 #2) the OTP key and untrack
   `.env.keys` (`docs/runbooks/secret-rotation.md`) — after this `bun run
   check` and the `security` job can go fully green. **Not** an allow-list
   entry.
4. Provide B1 documents (or record owner answers) when available.

## CI reconciliation (independent read-only checks, 23 September 2026)

**Run 1 — implementation commit `d3f6a8e09e301944789dc2c4487a831dc7698137`** ·
run [`35828575954`](https://github.com/julekpl/Mosai-friday/actions/runs/35828575954)
· **completed / failure** (at the time, GitHub `main` and local
`.git/refs/heads/main` both held this SHA):

| Job | Result | Note |
|---|---|---|
| typecheck | ✅ passed | `tsc -b --noEmit` clean on `d3f6a8e` |
| lint | ✅ passed | 0 errors (25 known warnings) |
| unit | ✅ passed | 295/295 incl. green R4 |
| codegen drift (Convex) | ✅ passed | bindings in sync on this commit |
| e2e (Playwright journeys) | ✅ passed | hermetic against the test-only double |
| a11y (axe) | ✅ passed | zero serious/critical, no allow-list |
| install (frozen lockfile) | ✅ passed (implied by run) | `bun.lock` clean |
| **security** (working tree · functions · capabilities · audit) | ❌ **failed** | at the working-tree secret-scan step — tracked `.env.keys` (rule `dotenvx-private-key`, line 8; value redacted, never read) |
| **security-history** (full-history secret scan) | ❌ **failed** | at the gitleaks history step — at least one historical credential (known: the dotenvx key; the OTP `x-api-key` formerly in `emailOtp.ts`). Findings redacted; none reproduced anywhere |

Consequences recorded honestly:

- The **split fixes exactly the defect it was built for**: the
  `security-history` failure did **not** skip the working-tree scan —
  `security` executed independently and failed on its own finding (before
  BP-01, one red history step silently skipped every other check).
- **Within** the `security` job, steps remain sequential fail-fast: because
  the working-tree gitleaks step failed first, that job's later steps (local
  `scan:secrets`, `audit:functions`, `audit:capabilities`, `bun audit`) did
  **not** execute in this run. Their commands were verified green locally on
  the same tree this chat (see *Verification*). Making those steps run
  `if: always()` would be a small optional hardening — **out of BP-01 scope;
  recorded, not done.**
- **CI is not green.** BP-01 stays `implemented_unverified`; the **release
  gate is blocked** until both security jobs pass through remediation, never
  through weakened rules or allow-list entries.
- The six passing jobs are SHA-bound evidence that the test/CI repairs from
  this package hold on the real runner (this also re-resolves the old dispute
  between STATUS's "13 e2e passed locally" and the baseline red run: the
  baseline failed on stale assertions; the repaired suite passes).

**Run 2 — documentation commit `dd9c1630ed084df2496ec3f1b7d9ac25ec30aaa6`**
(this report + `PROGRESS.md` + `STATUS.md` only; local `.git/refs/heads/main`
now holds this SHA) · run
[`35830549968`](https://github.com/julekpl/Mosai-friday/actions/runs/35830549968)
· **completed / failure**:

| Job | Result |
|---|---|
| install (frozen lockfile) | ✅ passed |
| typecheck | ✅ passed |
| lint | ✅ passed |
| unit | ✅ passed |
| codegen (drift) | ✅ passed |
| e2e (Playwright journeys) | ✅ passed |
| a11y (axe) | ✅ passed |
| **security** (working tree · functions · capabilities · audit) | ❌ **failed** — same working-tree finding (tracked `.env.keys`, value redacted) |
| **security-history** (full-history secret scan) | ❌ **failed** — same historical finding (values owner-side, redacted) |

The documentation commit touched only `.md` files and the outcome is
byte-for-byte consistent with run 1: the reds are the credentials, not the
docs. Two identical failures on two consecutive commits is stronger evidence
that remediation — not more documentation — is what unblocks the gate.
**Forward rule:** any new commit triggers a fresh run; its result is unknown
until GitHub reports it and must not be predicted or pre-recorded here.

## Owner remediation checklist (redacted — no values, no rotation by agents)

### Finding 1 — working-tree scan (`security` job)

**What:** the tracked file `.env.keys` at the repository root, line 8,
matches the `dotenvx-private-key` rule. The value was never read or printed;
the scanner redacts it. **Rule of record:** rotation is the fix; the file is
already covered by `.gitignore` (`.env*`, `!.env.example`) but remains
*tracked*, which is why the scan is red.

| # | Action | Who |
|---|---|---|
| 1 | Rotate the dotenvx private key (and decide, per `STATUS.md` §6 #2, whether the historical OTP email key is also yours to rotate) strictly per `docs/runbooks/secret-rotation.md` | **Owner** |
| 2 | Untrack without deleting locally: `git rm --cached .env.keys && git commit` — the local file stays for decryption and remains ignored | **Owner** (git is blocked for agents — B2) |
| 3 | Keep `.gitleaks.toml` untouched — no path allow-list for `.env.keys`, ever | Freebuff (already the state; must stay) |
| 4 | Verify: `bun run scan:secrets` exits 0 locally; re-run CI and confirm the `security` job reaches and passes its scan steps while `audit:functions` / `audit:capabilities` / `bun audit` still execute | Owner triggers CI · Freebuff verifies outputs when visible |

**Freebuff can safely do now:** keep both scans exactly as written; keep the
finding documented redacted in `STATUS.md`/this report; refuse any
allow-list change; supply and verify these commands; re-run every local gate.
**Freebuff must not:** edit `.env*` files (platform rule), run git, rotate or
handle any credential value, or mark the gate green.

### Finding 2 — full-history scan (`security-history` job)

**What:** gitleaks over the full history reports at least one historical
credential. Known candidates (from the runbook and `.gitleaks.toml` rule
descriptions, not from pasted findings): the dotenvx private key formerly in
tracked `.env.keys`, and the OTP email `x-api-key` formerly committed in
`src/convex/auth/emailOtp.ts` while the repository was public. **No finding
content has been reproduced anywhere in docs, chat or tests.**

| # | Action | Who |
|---|---|---|
| 1 | **Rotate first, always** — purge does not un-leak a live credential. Rotate the dotenvx key and (decision §6 #2) the OTP key; revoke at the provider | **Owner** |
| 2 | Authorize a history purge (e.g. `git filter-repo` / BFG) for the two known files across history — **this is a rewrite + force-push: explicit owner authorization, coordinated clones, downtime note**. Record the rewrite commit | **Owner** (git blocked for agents; ticket requires explicit operational authorization) |
| 3 | After rewrite: re-run `gitleaks detect --no-banner --config .gitleaks.toml --redact --exit-code 1` locally and CI — findings are never pasted into chat/docs; the exit code is the signal | **Owner** runs · Freebuff interprets only exit status if provided |
| 4 | Alternative (owner's call, still no allow-list): if a purge is declined, the `security-history` job **stays red as the honest state of the repository** and the release gate stays blocked until the owner explicitly records that accepted-risk decision — a green claim by any other means is prohibited | **Owner decision, recorded in STATUS** |
| 5 | Keep `--redact` on every gitleaks invocation; never echo matched spans | Everyone (already enforced in the workflow) |

**Freebuff can safely do now:** keep the `security-history` job failing
honestly; document the run/SHA evidence (done); verify the workflow still
passes `--redact`; provide the exact commands; refuse any allow-list or
rule-weakening PR. **Freebuff must not:** run or paste history-scan findings,
rewrite/force-push history, rotate credentials, or declare the job green.

**Release gate:** blocked until Findings 1 and 2 are remediated by the owner
and a subsequent CI run on a real commit shows **all jobs green** — including
both security jobs — without any change to scan rules or allow-lists.

## Data migration

None. No schema changes, no data touched.
