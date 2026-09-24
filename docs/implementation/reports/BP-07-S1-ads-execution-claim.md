# BP-07/S1 — Ads execution claim and receipt

**Status: implemented_unverified.** This report covers one narrow slice of
BP-07 on branch `codex/bp-07-s1-receipt` at `origin/main` (`93a0df2`). It does
not claim BP-07 complete.

## Outcome

The existing ads change executor now atomically claims an approved logical
operation before credential refresh or provider work. A second invocation sees
the claim and cannot issue another provider request. The claim token gates the
receipt mutation, so a stale result cannot overwrite a completed execution or
create a second receipt. It also rechecks project access and `promote.spend`
after token refresh immediately before the adapter call, so capability removal
during refresh stops the write and records an honest failed execution. No test
contacted a real provider.

Claims are intentionally not auto-released. If an action stops after a request
may have reached its provider, the row remains `executing` for reconciliation;
automatic retry could duplicate a non-idempotent write. This slice does not yet
implement lease expiry, provider reconciliation, or operator replay.

## Scope and overlap

- `src/convex/ads/control.ts`: claim before external work; token-checked receipt
  recording.
- `src/convex/schema.ts`: additive `executing` status and optional claim token
  on `adsChangeRequests`; `adsExecutions.by_change` index.
- `tests/unit/ads-execution.test.ts`: red-first concurrent-claim and stale
  receipt regressions, plus a stubbed refresh-gap capability-removal regression.
- `docs/implementation/reports/BP-07-S1-ads-execution-claim.md`: slice status
  and remaining scope.

No table was added, so `dataRegistry.ts` and `dal.ts` were not changed. BP-05
also edits `schema.ts`, so the `adsChangeRequests` and `adsExecutions` additions
must be reconciled with that chapter before integration.

## Verification

- The new test file failed before implementation because `claimExecution` did
  not exist.
- `./node_modules/.bin/vitest run tests/unit/ads-execution.test.ts` — passed,
  3 tests. The capability-removal case allowed only the mocked OAuth refresh
  request; the attempted Google Ads adapter call is blocked by the post-refresh
  guard.
- `./node_modules/.bin/tsc -b --noEmit` — passed.
- `./node_modules/.bin/eslint src/convex/ads/control.ts src/convex/schema.ts tests/unit/ads-execution.test.ts` — passed.
- Convex codegen was not run because the documented command requires a reachable
  deployment; no deployment or external provider was contacted.
- The required `session-audit` command was attempted and failed with
  `PermissionError` writing its central proposal under `~/.hermes/...`, outside
  this checkout's writable roots. It was not retried.

The capability probe and provider request cannot share a database transaction:
an entitlement change after the immediate pre-call probe, including while the
provider request is in flight, cannot be canceled by this action.

## Remaining BP-07 scope

Durable job records and lease recovery, unknown-outcome reconciliation,
provider idempotency-key propagation where supported, stale-worker fencing after
recovery, bounded retry/backoff, cancellation, dead letters and replay,
transactional outbox/inbox deduplication, approval payload/revision binding,
and broader acceptance coverage remain open.
