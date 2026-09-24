# BP-07/BP-05 — Ads execution and deletion fence

**Status: implemented_unverified.** This is a narrow integration safety fix on
`codex/bp-07-bp05-deletion-fence`, based on integration commit `99e9452`.

Ads claims now refuse when the project's owner has requested account deletion
or a queued/running project or account deletion job exists. The project
cascade checks the indexed `adsChangeRequests.by_project_status` range before
every bounded deletion step. If an operation is still `executing`, both
project and account deletion retain their cursor and rows, persist a blocked
reason, and schedule a delayed retry. The execution's success or error record
must commit before cleanup can resume.

An execution that never records an outcome remains `executing`; it is not
automatically cleared or retried, and deletion remains blocked until operator
reconciliation. This preserves the possibility of an unknown provider result
instead of erasing its claim. This slice does not add reconciliation or a
manual claim-resolution endpoint. Existing error outcomes are recorded as
failed execution rows; callers still need to distinguish definitive provider
rejection from transport uncertainty in a future BP-07 recovery slice.

## Verification

`tests/unit/execution-deletion-fence.test.ts` was run red first: all four
initial cases failed (claims were allowed after deletion requests and both
cascades completed over active executions). After the fix, the focused suite
passes five tests covering project/account request fencing, project/account
cascade waiting through a success receipt, and project cascade waiting through
a failed execution record. The exact combined command
`./node_modules/.bin/vitest run tests/unit/execution-deletion-fence.test.ts
tests/unit/ads-execution.test.ts tests/unit/account-lifecycle.test.ts
tests/unit/deletion-completeness.test.ts` passed 4 files / 27 tests. All tests
seed local Convex state and do not call providers.

Using `/private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun` (Bun 1.3.14),
the combined focused lifecycle command passed 4 files / 27 tests, `bun run
typecheck` passed, and `bun run lint` passed with 0 errors and 28 existing
warnings. `bun run audit:functions`, `bun run audit:capabilities`, and `bun run
audit:data-registry` passed (233 public functions, 152 module functions, and
all 66 schema tables registered). `git diff --check` passed. Convex codegen
was not run; this slice does not change schema or generated bindings. No schema
or registry changes were needed.

The project deletion completion regression also asserts that the retained job
clears its prior blocked reason once it reaches `succeeded`.
