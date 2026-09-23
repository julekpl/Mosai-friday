# BP-09/S1 — ModelGateway and run metering

**Status: implemented, locally verified, integration pending.** This report covers the bounded S1 work in the `codex/bp-09-gateway` checkout. It does not claim BP-09 as a whole is complete.

The direct model calls in `ai.ts`, `buildPlan.ts`, `buildChat.ts`, `sellAI.ts`, `social/copilot.ts`, and `ads/copilot.ts` now route through the server-only `src/convex/lib/modelGateway.ts`. The gateway enforces request/token caps, per-user admission, safe metadata-only `aiRuns` records, finite provider-reported usage/cost (unknown values remain null), and stable error categories. Structured callers provide validators that use their parser/schema contract before a run can be recorded as succeeded. Invalid structured output is recorded as `failed/invalid_output`; calls returning plain text remain supported. Project `organizationId` is resolved from the project row inside the internal run-start mutation.

Added/changed files:

- `src/convex/lib/modelGateway.ts`, `src/convex/guards.ts`, `src/convex/schema.ts`
- `src/convex/ai.ts`, `src/convex/buildPlan.ts`, `src/convex/buildChat.ts`, `src/convex/sellAI.ts`, `src/convex/social/copilot.ts`, `src/convex/ads/copilot.ts`
- `src/convex/dal.ts`, `src/convex/billing.ts`, `src/convex/lib/dataRegistry.ts`, `src/convex/lib/capabilities.ts`
- `tests/unit/model-gateway.test.ts`, `tests/unit/deletion-completeness.test.ts`, `tests/unit/stubs/vly-integrations.ts`

The tests cover run metadata and reported usage, server-derived organization scope, provider failures, empty/malformed responses, schema-invalid output (including a valid journey stage followed by `null`), plain-text support, hard caps, terminal-write failure, and provider-call source auditing. On terminal-write failure after provider success, the action does not return success; the row may remain `running` until BP-07 reconciliation.

Validation completed locally:

- `./node_modules/.bin/vitest run tests/unit/model-gateway.test.ts tests/unit/deletion-completeness.test.ts` — 2 files, 15 tests passed.
- `./node_modules/.bin/tsc -b --noEmit` — passed.
- `./node_modules/.bin/eslint src/convex/lib/modelGateway.ts src/convex/guards.ts src/convex/schema.ts src/convex/ai.ts src/convex/buildPlan.ts src/convex/buildChat.ts src/convex/sellAI.ts src/convex/social/copilot.ts src/convex/ads/copilot.ts tests/unit/model-gateway.test.ts` — passed.
- `node scripts/audit-public-functions.mjs` — passed; it retains the existing review notices for `billing.currentPlan`, `files.generateUploadUrl`, and `users.currentUser`.
- `./node_modules/.bin/jiti scripts/audit-module-capabilities.mjs` — passed.
- `git diff --check` — passed.
- Convex codegen was not available without `CONVEX_DEPLOYMENT`; no deployment configuration was added. No provider was called and no secrets were inspected. The repository's secret scan is not claimed green.

Controller's independent follow-up on the final diff: `BUN_BIN=/private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun /private/tmp/mosai-bun-v1.3.14/bun-darwin-aarch64/bun run test` passed 17 files/345 tests; `bun tsc -b --noEmit` passed; `bun run lint` returned 0 errors and 28 existing warnings; `node scripts/audit-public-functions.mjs` and `./node_modules/.bin/jiti scripts/audit-module-capabilities.mjs` passed; `bun run build` passed; `git diff --check` passed. These are local checks, not CI or live-provider verification.

Deferred scope and integration notes:

- **BP-09/S2 ContextPack:** `ai.ts` and `buildPlan.ts` still accept client-supplied persona/journey snapshots, and build actions accept user-controlled build inputs. Project snapshots remain server loaded, but full context trust/grounding is not accepted by this S1 report.
- **BP-09/S3:** prompt governance, golden tests, and evaluation floors remain deferred. The referenced `docs/pack/07-ai-agent-config.md` is missing; no policy was invented.
- **BP-05 overlap:** `aiRuns` is registered and included in deletion handling. The project/account deletion and registry/DAL hunks overlap BP-05 work in another checkout and must be reconciled with its durable lifecycle. `billing.ts` contains only the direct cleanup hook needed by the current deletion path; reconcile it into BP-05's lifecycle before integration. This branch did not copy or modify BP-05's separate implementation.
- Provider usage is only as complete as the provider reports; unreported counts/cost are null. A process crash or failed terminal persistence can leave a `running` record; BP-07 reconciliation is required to close that lifecycle.

No commit, push, merge, deploy, or provider call was performed. BP-09/S1 integration and BP-09/S2/S3 remain outstanding.
