# BP-02 — Sign-in, recovery and privileged access

**Package:** BP-02 (Order A; blueprint §5 BP-02 / §10; backlog T0.8, T2.8).
**Date:** 23 September 2026. **Status:** `implemented_unverified` for the
independently implementable auth UI/return-path slice. Provider operation,
step-up and release proof remain blocked or unverified as detailed below.

**Working tree:** specified isolated worktree `bp-02-codex`, branch
`codex/bp-02-auth`, starting commit `be1ade5a6832418a455d7086037c18c34130c245`;
initial status was clean. BP-03-owned paths were not touched. The required
session audit was attempted once; it failed before completion because the
sandbox denied its central proposal write under `~/.hermes`. No repository
files were written by that audit.

## Outcome

Passwordless email OTP remains the sign-in model. The auth UI now restricts
post-auth navigation to local dashboard, app and admin paths; gives generic
send/resend errors; explains that an invalid or expired OTP is recovered by
requesting a new sign-in code; and exposes retryable, announced errors for
both unresolved auth/backend loading and OTP actions that take over 15 seconds.
Timed-out actions stay disabled until reload; their late promise results cannot
advance the UI or trigger a redirect. The test-only backend can leave auth
queries and send/verify actions unresolved, and can deliver a successful
verification after timeout. No auth provider, email domain, privileged-action
policy, real account, or external system was changed.

## Changed files

| File | Change |
|---|---|
| `src/lib/auth-return-to.ts` | New same-origin URL parser and allowlist for `/dashboard`, `/app…`, and `/admin…`; malformed, external, protocol-relative, backslash, control-character and disallowed targets fall back safely. |
| `src/pages/Auth.tsx` | Uses the validated return path; hides raw provider/backend error detail; adds invalid/expired-code recovery copy, 10-second auth-load and 15-second action timeouts; ignores late results for UI success/navigation, locks retry until reload, and restores focus after requests settle. |
| `tests/unit/auth-lifecycle.test.ts` | Return-path allowlist and rejection cases, including validated fallback. |
| `tests/e2e/fixtures/test-backend.ts` | Adds unavailable-query and pending action modes plus a late verification response hook; test-only and does not authenticate or bypass server guards. |
| `tests/e2e/auth-contract.spec.ts` | Adds outage/retry, keyboard OTP rejection, resend recovery, hung send/verify, disabled duplicate submission and late-success-ignore journeys. |
| `docs/implementation/reports/BP-02-auth.md` | This evidence and blocker report. |
| `docs/implementation/PROGRESS.md` | Updates BP-02 status and records exact scope/evidence. |

## Acceptance status

| Criterion | Status and evidence |
|---|---|
| Passwordless OTP preserved; no password reset flow | Implemented by retaining `email-otp`; recovery copy directs users to request a fresh code. |
| `returnTo` is local and allowed | Implemented in `resolveAuthReturnTo`; unit tests cover allowed paths, external/protocol-relative URLs, backslashes, non-auth routes, JavaScript scheme and unsafe fallback. Direct Node runtime assertions passed; full unit suite passed. |
| Wrong/expired code recovery and generic failures | UI handles provider verification rejection generically and points to a new code; existing provider max-age is 15 minutes. Browser regressions cover wrong-code response and resend failure. Expiry/reuse/rate-limit behavior in the provider was not operationally exercised. |
| Backend and pending action outages recover without granting access or duplicate submissions | 10-second auth-load and 15-second action timeouts show reload recovery, disable all auth controls, and ignore late results for UI success/navigation. Browser regressions cover unanswered queries, hung send/verify, and late successful verify; all passed. Reload is a user retry path, not external-service recovery proof. |
| Non-admin cannot directly call admin functions | Existing `requirePlatformAdmin` guard is applied server-side. Existing `tests/unit/billing.test.ts` directly invokes admin query and mutation as a non-admin and expects denial. All 333 unit tests passed. |
| Keyboard/accessibility coverage | Existing focus management/autofill retained; keyboard verification and post-request focus tested. Full e2e and standalone a11y gates passed. |
| New/returning user real sign-in | Not proven. Existing live OTP test is opt-in and requires the approved deployment and test inbox; neither was accessed. Test-double success is not treated as identity proof. |
| Email gateway/provider/domain | **Blocked on owner decision O2** recorded in ticket index/blueprint. Current legacy sender remains unchanged; no gateway or domain was selected. |
| Step-up auth/recovery for spending, access changes and irreversible actions (T2.8) | **Blocked pending a scoped privileged-action/authentication-strength policy.** No passkey/step-up implementation or irreversible action was claimed. Existing platform-admin guard remains active. |

## Verification record

- `python3 …/maintain.py session-audit --cwd "$PWD"` — failed with
  `PermissionError` creating a proposal under `/Users/julianwitkowski/.hermes/…`;
  no repository change from the audit.
- Official Bun 1.3.14 (SHA-256 verified by the controller) and frozen-lockfile
  dependencies were later made available in this worktree.
- `bun run typecheck` — exit 0 (`tsc -b --noEmit`).
- `bun run lint` — exit 0, 28 existing warnings, zero errors. The new
  `no-control-regex` and `react-hooks/set-state-in-effect` errors were fixed
  without disabling rules.
- `bun run test:unit` — exit 0, 333/333 tests (17 files).
- `bun run audit:functions` — exit 0 (221 scanned; 3 existing REVIEW entries).
- `bun run audit:capabilities` — exit 0 (152 scanned; 4 documented exemptions).
- `bun run check:codegen` — exit 1 because `CONVEX_DEPLOYMENT` is not set;
  no deployment was configured or contacted.
- `VITE_CONVEX_URL=https://e2e-test-only.convex.cloud bun run test:e2e` — exit
  0, 20 passed and the opt-in real OTP test skipped. The URL was test-only;
  the fixture intercepted Convex requests.
- `VITE_CONVEX_URL=https://e2e-test-only.convex.cloud bun run test:a11y` — exit
  0, 5/5 passed.
- `bun run check` — exit 1 at `scan:secrets` because of the already-present
  tracked `.env.keys` dotenvx private key; scanner output redacted its value.
  No secret-scan rule was changed, no key value was printed, and the file was
  not modified. Typecheck, lint and all unit tests passed earlier in the same
  `check` run; the standalone audits passed separately.
- **Red-first:** with `AUTH_ACTION_TIMEOUT_MS` temporarily raised to 150 seconds,
  the hung-send browser regression failed (no recovery alert after 15 seconds).
  Restored 15 seconds; final auth contract suite passed 7/7 as part of the full
  browser suite. The final late-success test confirms no redirect after a
  timed-out verify request.
- `rtk git diff --check` — exit 0. CI status was not queried and is unknown.

## Copy-ready next-chapter prompt

```text
Implement only MOSAI BP-05 (export/deletion lifecycle) in the owner-designated
isolated worktree. Read AGENTS.md, docs/pack/README.md,
docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md §5 BP-05 and cross-cutting sections,
docs/implementation/PROGRESS.md, prior BP reports, T2.5 and current code/tests
before editing. Preserve the recorded 30-day grace, active-subscription block,
shared-organization ownership and retention decisions; reconcile T2.5 prose
against executable code. Do not touch BP-03's build/CMS/status paths or expand
into BP-06. Demonstrate regressions red-first and run the documented Bun checks
only if Bun/dependencies are available; record exact outputs and exact scope,
and never claim an unrun or failing gate is green. Do not delete live data,
contact providers, commit, push, create a PR, deploy, create a worktree or edit
the root coordination file without explicit authorization. Preserve BP-02's
status and note that its email provider/domain and step-up policy remain blocked
pending owner decisions.
```
