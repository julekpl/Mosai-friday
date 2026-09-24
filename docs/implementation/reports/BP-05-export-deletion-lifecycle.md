# BP-05 — Export and deletion lifecycle

**Package:** BP-05 (Order B, first package; blueprint §5 BP-05 / §10).
**Date:** 24 September 2026 (controller follow-up). **Status:** `implemented_unverified`.

The requested base was verified before edits: `HEAD` was
`93a0df20ce5bf9568bcf5a2ebbed6080894a32f4`, branch `codex/bp-05`, and the
tracked tree was `99fc57599cb6a475f55e24d1c088c8e463115716`; the worktree was
clean. No rebase, commit, push, deployment, provider request or production
operation was performed. The shared audit proposal `8cfdac641f0a4d0e` was not
applied.

## Outcome

Implemented the recorded 30-day account-deletion grace period with durable,
idempotent jobs; rechecks immediately before deletion; paid subscription and
stale-verification blocks; shared-organization ownership resolution; separate
account and project exports; seven-day export chunk expiry; and an explicit
cancel/retry path. The existing `deleteAccount` mutation now queues the same
lifecycle and cannot directly erase an account. Account exports omit provider
credentials and shared-project content. The Stripe billing portal is presented
as the explicit cancellation option; deletion remains blocked until a verified
webhook confirms the subscription is no longer active.

Meaningful lifecycle, export, ownership, cancellation, retry, tenant-boundary,
and registry tests are in the new unit test files. The original BP-05 tests
were authored before implementation, but their first executable baseline run
was unavailable because Bun was missing and dependencies were incomplete.
For the review follow-up, the shared-project and internal-worker regressions
were run red first: shared-project deletion/ownership assertions failed, and
the internal project export ended `failed` with zero chunks. The
cancel-after-first-project regression also failed first because cancellation
resolved successfully after a project was removed. Those regressions pass.
Controller follow-up regressions cover account-parent child draining, opaque
account project cursors, durable fair scheduling, sole-active-member project
export, membership revocation, subscription cursor pagination, the final
organization-delete billing recheck, invalid organization cursor rejection,
and ownership transfer during a durable deletion. Each was run red against the
defective behavior and green after its fix. An explicit project export now
fails with an unavailable reason when another active organization member
shares it; account exports continue to omit shared project rows. A >2 member
regression with inactive rows preceding a later active member exposed the
former `.take(2)` bug in both paths. Both now query the active-membership
compound index, bounded at 101 rows; over-cap results fail closed as shared.
The organization cleanup regression also found that transferring the first
shared organization prematurely ended cleanup; the worker now resumes its
owner-index scan and completes only when no owned organization remains. The
read-only obligation report now checks every owned organization and subscription
within explicit caps (25 organizations and 100 total subscriptions); exceeding
either cap reports blocked/unknown instead of ready. A regression covers a
later organization with a later active subscription. Export workers now
revalidate project owner and active membership before every project step.
Project-bearing chunks retain an opaque project association, and chunk reads
recheck current access; chunks become unavailable after a share or ownership
transfer. Data already downloaded before an access change cannot be recalled.
The focused regression set passes 34 tests across four files; the full suite
passes 375 tests.

## Scope — changed files

- `src/convex/schema.ts` — deletion state, webhook verification timestamp,
  privacy job and export-chunk tables; optional export-project associations
  let chunk reads reauthorize after job completion.
- `src/convex/lib/dataRegistry.ts`, `src/convex/lib/dataLifecycle.ts` — full
  schema table policy registry and subscription/ownership/account lifecycle
  rules; preserve projects belonging to retained shared organizations and
  align their owner with the retained organization's selected active owner.
- `src/convex/dal.ts` — registry-driven project cascade and blob cleanup.
- `src/convex/modules/privacy/{deletionJobs,exportJobs,obligations}.ts` — new
  durable lifecycle, export and obligation endpoints/workers; internal project
  export authorizes from the durable job owner through the DAL.
- `src/convex/billing.ts`, `src/convex/billingWebhooks.ts`,
  `src/convex/crons.ts` — safe entry paths, verification receipts and scheduled
  workers.
- `src/pages/app/Billing.tsx` — request/cancel/retry status and billing portal
  option; cancellation state is shown only while the request remains queued
  within its 30-day grace period.
- There is no customer-facing self-service UI to start an account/project
  export or download its chunks in this BP-05 scope; the authenticated backend
  endpoints and status/chunk queries are implemented, but the export journey
  is not complete in the product UI.
- `src/convex/lib/capabilities.ts`, `scripts/data-registry-audit.mjs`,
  `scripts/audit-data-registry.mjs`, `package.json`,
  `.github/workflows/ci.yml` — file ownership and schema registry CI gate.
- `tests/unit/account-lifecycle.test.ts`,
  `tests/unit/data-registry.test.ts`, `tests/unit/privacy-export.test.ts`,
  `tests/unit/privacy-obligations.test.ts`.
- `docs/implementation/PROGRESS.md` and this report.

The account export retains opaque Convex project-page cursors and walks one
project row per durable step; nested project tables likewise persist parent
and child page cursors, including draining children after a parent page is
finished, with each step bounded to one row/chunk. Export processing uses
persisted service markers so a queued stream cannot starve running jobs.
Individual archive jobs omit project rows when another active organization
member exists; a sole active member can export the project. This is the
documented shared-content privacy boundary.
Project obligation counts are capped and label truncation; admin pending
deletion reports use an explicit request-time range and a 25-user cursor page.
The finalizer advances one account/project job per mutation and schedules
another pass after a terminal project job, so queued work is not stranded.

No BP-09 AI feature or BP-03 build/CMS code was changed. The requested
`review-current` deferred backlog's D-05 remains a controller integration
item: compare `schema.ts`, `dataRegistry.ts`, `capabilities.ts`, and
`PROGRESS.md` against BP-09/S1 without overlaying either branch, then rerun
documented checks on the combined tree. No such integration was attempted.

## Verification

Commands were run independently because the aggregate check must remain red at
the known secret finding (D-01). After the review follow-up, the controller
provided Bun 1.3.14. Dependencies were installed in this checkout with its
frozen lockfile; no dependency files in `review-current` were changed. A
temporary ignored symlink in this checkout's `node_modules/.bin` made the
binary resolvable to audit-gate subprocesses and is removed after verification.

| Check | Exact command | Result |
|---|---|---|
| Frozen install | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun install --frozen-lockfile` | exit 0 — 505 packages installed in this checkout; lockfile unchanged |
| Whole-app typecheck | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run typecheck` | exit 0 |
| Lint | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run lint` | exit 0 — 0 errors, 28 existing warnings |
| Focused lifecycle regression | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run test:unit -- tests/unit/privacy-obligations.test.ts tests/unit/account-lifecycle.test.ts tests/unit/privacy-export.test.ts tests/unit/deletion-completeness.test.ts` | exit 0 — 4 files, 34 tests passed after final access-change follow-up |
| Full unit suite | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run test:unit` | exit 0 — 20 files, 375 tests passed after final access-change follow-up. Audit-gate subprocesses used a temporary checkout-local `node_modules/.bin/bun` link. |
| Public function audit | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run audit:functions` | exit 0 — 232 scanned; 3 documented REVIEW entries |
| Capability audit | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run audit:capabilities` | exit 0 — 152 functions, all enforcing or documented |
| Data registry audit | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run audit:data-registry` | exit 0 — all 65 schema tables registered |
| Secret scan | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run scan:secrets` | exit 1 — known D-01/T0.1 `.env.keys:8 [dotenvx-private-key]`; value redacted; rules remain active |
| E2E | `rtk env VITE_CONVEX_URL=https://e2e-test-only.convex.cloud E2E_BASE_URL=http://127.0.0.1:5173 /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run test:e2e` | exit 0 — 15 passed, 1 live OTP test skipped. Initial run without `E2E_BASE_URL` failed because `localhost` did not reach the Vite server bound to `127.0.0.1`; corrected rerun passed. |
| Accessibility | `rtk env VITE_CONVEX_URL=https://e2e-test-only.convex.cloud E2E_BASE_URL=http://127.0.0.1:5173 /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run test:a11y` | exit 0 — 5 passed |
| Codegen drift | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run check:codegen` | exit 1 — no `CONVEX_DEPLOYMENT`; command requests `npx convex dev`; no deployment was contacted |
| Production build | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run build` | exit 0 — TypeScript and Vite build passed; only dependency annotation/empty-chunk notices |
| Aggregate documented check | `rtk /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run check` | exit 1 at `scan:secrets` on known D-01/T0.1/B3 `.env.keys:8 [dotenvx-private-key]`; typecheck, lint and all 368 unit tests passed before the scan. Unaffected audit gates and build were run individually and passed. |

The documented e2e and accessibility jobs passed against the inert test
backend. No real Stripe subscription/cancellation or Convex deployment proof
was attempted. The secret scan was not disabled or changed.

Cancellation and the finalizer both run as Convex mutations. Convex commits
their database writes atomically: if cancellation commits while the job is
still queued, the finalizer no longer selects it; if finalization commits the
`running` state first, cancellation returns `canceled: false` and leaves the
request in place. Cancellation is restricted to a queued job before its
effective time with zero completed project work. The billing UI displays this
same `canCancel` state. Shared projects move to the sole other active owner,
matching the retained organization's ownership. If there are zero or multiple
other active owners, deletion waits for ownership to be resolved. This avoids
inventing a tie-break among multiple successors; the user must leave exactly
one active owner before retrying.

## Migration, rollback and remaining proof

Schema additions are additive. Privacy jobs gain an optional `lastServedAt`
field and scheduler index; existing rows without it are treated as least
recently served using their creation time. No backfill is included. Existing subscription rows have no
`lastVerifiedAt` until a verified Stripe webhook or reconciliation updates
them, so deletion safely blocks those rows as stale. Convex code generation
was not run because this workspace has no configured dev deployment; generated
bindings were not hand-edited. Rollback limits: reverting the code would leave
the additive schema fields/tables and any queued jobs/chunks in place; no data
backfill or destructive rollback is included. Export jobs are designed to
expire chunks after seven days.

Remaining proof includes a customer-facing self-service export/download UI,
codegen with an approved development deployment,
controlled Stripe subscription cancellation confirmation, and D-05
shared-file integration review plus exact-SHA CI. No runtime proof was made
against live or test Stripe. The recorded 30-day grace and active/stale
subscription blocks have local mutation-level coverage. Per the controller's latest
owner decision, active-subscription deletion remains blocked until provider
confirmation; paid cancellation should take effect at period end, but that
policy is not wired into BP-05 and no local downgrade is treated as proof.
D-01 secret rotation/history remediation remains an owner task and blocks
release claims.
