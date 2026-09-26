# MOSAI Future-Proof Agent Architecture: implementation plan (Phases A-C)

> Naming (26 Sep 2026): `capabilityRuns`, `CapabilityId` and `Capability<I,O>` below are renamed to skills (`skillRuns`, `SkillId`, `Skill<I,O>`) per `MVP-BLUEPRINT-PLAN.md` section 12. "Capability" means plan entitlement.

Scope: blueprint Phases A-C, reconciled with INTEGRATION-PLAN.md sections 3-6,
against current main (`a5b4255`, starter-kit stack merged). Phases D-G
deferred per the integration plan's wave sequencing (D1, D7).

## 1. Critical review: blueprint vs code

**Already built; the blueprint should reuse, not re-propose:**

- `src/convex/lib/modelGateway.ts:16`, `AiAutonomy = "assistive" | "draft"`
  already matches §4.2's inference-boundary invariant. Blueprint §16 invents
  a second four-level vocabulary (`observe|prepare|modify|act`) for the same
  axis. Follow INTEGRATION-PLAN's additive extension instead
  (`assistive|draft|modify_internal|act_external`).
- `src/convex/schema.ts:2124` (`aiRuns`) already records agentId,
  promptVersion, provider, model, autonomy, tokens, cost, status per
  request. This is the observability the blueprint's `capabilityRuns` (§24
  Phase A) should wrap, not duplicate.
- `src/convex/aiBudget.ts` + `guards.ts` (`startAiRun`, `aiBudgetTenant`,
  `readAiBudgetUsage`) already reserve/charge budget per organization inside
  the gateway path. Nothing to add for Phase A-C beyond a `modelClass`
  passthrough.
- `src/convex/lib/contextPack.ts:5-11` already defines `ContextEvidence
  {ref, version, source, title, trust, text, truncated}` and `ContextTrust =
  "workspace_entry"|"untrusted_source_text"|"provider_data"`. This is the
  correct base for the shared `EvidenceRef`, not the blueprint's §14 sketch
  (`{sourceType, sourceId, version, retrievedAt, url}`), which has no
  trust/tenancy field: a real gap in the blueprint.
- `src/shared/starterKitJob.ts` (status reducer: queued/running/succeeded/
  failed/waiting_for_user/partially_succeeded, `isRetryableKitStatus`,
  `isStaleKit`) plus `src/convex/modules/privacy/deletionJobs.ts:42-134`
  (same vocabulary, including `canceled`) are two working durable-job
  implementations already in production. `find src/convex -iname
  convex.config*` returns nothing: the Workflow component is not installed.
  Adopting it is a new framework (AGENTS §8) and needs an ADR (D7), not a
  default yes. Agree with INTEGRATION-PLAN D7: keep the job-table pattern
  for Phase A-C.
- `src/convex/lib/capabilities.ts` (656 lines, CI-enforced via
  `scripts/audit-module-capabilities.mjs`) answers "is this plan/role
  allowed to use this module": access control, not "what versioned agent
  work unit ran." Putting the blueprint's new registry at
  `src/convex/capabilities/` would collide on the word in every grep.
  INTEGRATION-PLAN's fix (`src/convex/agent/registry.ts`, id shape
  `domain.verb.vN`) is correct and adopted below unchanged.
- `src/shared/contracts/` already exists (`status.ts`, `measurement.ts`) as
  a dependency-free, browser-and-server-safe contracts folder;
  `provenance.ts` belongs there by existing convention.

**What the blueprint gets wrong or overbuilds:**

- Phase A bundles a new framework (Convex Workflow) with six new tables in
  one step; that alone violates AGENTS §8 (no schema + framework + redesign
  mixing) before Phase B even starts. Split: ADR first, then schema, then
  registry.
- §5.2's `Capability<I,O>` never mentions tenancy; `execute()` must run
  inside `orgQuery`/`orgMutation`/`orgAction` (guards.ts, T2.2) like every
  other module function, and `canRun` must call `resolveCapabilityState`
  from `lib/capabilities.ts` for plan/role gating.
- §7 events use a vocabulary that disagrees with DISCOVERY and MARKET
  (INTEGRATION-PLAN §4.1 item 5) and has no real emitter until a Wave 4/5
  capability needs one. Ship the table and a typed `emit()` helper only in
  AG-1; do not backfill events for capabilities that have no consumer yet
  (the blueprint's own §26 rule 9 says no speculative code).
- §24 Phase C wraps five capabilities in one ticket, spanning unrelated
  feature files (`ai.ts`/`research.ts`, `personas.ts`, `journeys.ts`,
  `buildPlan.ts`). Too large for one PR; split below into one ticket per
  capability.
- The blueprint never mentions `src/convex/lib/dataRegistry.ts` (AGENTS
  rule 12): every new project-scoped table in AG-1 needs a `DATA_REGISTRY`
  entry or CI's audit fails.
- `modelClass: fast|standard|reasoning` needs a concrete landing spot:
  `aiModels.resolveForRequest` (`aiModels.ts:76`) resolves by project/
  operator config today, not by class. AG-3 adds it as an optional hint
  inside that resolver, not a bypass of it.

## 2. Tickets (Phases A-C)

### AG-0: ADR: keep job-table pattern, defer Convex Workflow (D7)
Goal: settle D7 in writing before schema work starts, citing
`starterKitJob.ts` / `deletionJobs.ts` as the existing pattern.
Files: `docs/decisions/2026-XX-XX-agent-workflow-pattern.md` (new, docs
only). Schema: none. Tests: none. Acceptance: AG-1 cites this ADR instead
of re-arguing D7. Dependencies: none. Size: S.

### AG-1: `domainEvents` + `capabilityRuns` tables and registry entries
Goal: land only the schema Phase B-C actually needs. Skip
`agentTasks`/`agentArtifacts`/`agentRecommendations`/`agentFeedback`/
`projectMemory`: those are Phase D/E/F concerns and would be dead code now.
Tables: `domainEvents` (append-only: type, projectId, payload, emittedAt,
correlationId); `capabilityRuns` (capabilityId, projectId, userId,
organizationId, inputHash, status: queued|running|succeeded|
partially_succeeded|failed|waiting_for_user|canceled, copies
`deletionJobs.ts` vocabulary plus `canceled`, artifactIds,
evidenceRefCount, timestamps).
Files: `src/convex/schema.ts` (additive), `src/convex/lib/dataRegistry.ts`
(register both, project-scoped, cascade-with-project), `src/convex/agent/
events.ts` (typed `emit()` helper, no consumers yet).
Schema changes: additive only. Tests: `emit()` writes the expected row
shape; data-registry audit passes with both tables registered.
Acceptance: `bun run audit:functions` and `tsc -b` clean; no existing table
touched. Dependencies: AG-0. Size: M.

### AG-2: `agent/registry.ts` + capability contract types
Goal: the `Capability<I,O>` interface and empty registry, wired to
`orgQuery`/`orgMutation`/`orgAction` tenancy and `resolveCapabilityState`.
No implementations, no LLM calls (blueprint's own Phase B instruction).
Files: `src/convex/agent/registry.ts`, `agent/contracts.ts`,
`agent/errors.ts`, `agent/policy.ts` (authority-order helper),
`src/shared/contracts/provenance.ts` (see §3).
Schema changes: none. Tests: authority-ordering unit tests (a `locked`
value is never overwritten: the exact case INTEGRATION-PLAN §4.2 calls
out); unregistered capability id throws a typed error.
Acceptance: `CapabilityId` rejects a non `domain.verb.vN` string; registry
lookup is O(1) by id. Dependencies: AG-1. Size: S.

### AG-3: `modelGateway` `modelClass` + `AiAutonomy` extension
Goal: add optional `modelClass: "fast"|"standard"|"reasoning"` to
`ModelGatewayRequest`, consumed inside `resolveForRequest` as a hint when no
explicit `model` is given; extend `AiAutonomy` additively to
`"assistive"|"draft"|"modify_internal"|"act_external"`, with
`act_external` left unimplemented pending an approval-gate ticket (do not
let any Phase C wrapper claim it).
Files: `src/convex/lib/modelGateway.ts`, `src/convex/aiModels.ts`,
`src/convex/schema.ts` (`aiRuns.autonomy`/new `modelClass` field, additive
union widening on an existing table).
Schema changes: additive union widening; old rows unaffected, no migration
script needed. Tests: `resolveForRequest` picks a model per `modelClass`
when `model` is omitted; regression test that existing callers (no
`modelClass`) behave identically (AGENTS rule 17).
Acceptance: no existing `modelGateway` caller needs to change.
Dependencies: AG-2 (shared vocabulary only, no hard import). Size: S.

### AG-4a/b/c: Wrap one existing feature each as a capability
Goal: thin wrappers, no prompt or output change: `business.understand.v1`
(source in `ai.ts`/`research.ts`, confirm exact function at ticket start),
`audience.personas.prepare.v1` (`personas.ts`), `journey.prepare.v1`
(`journeys.ts`). Each is its own PR (three tickets, same shape), independent
of each other, both dependent on AG-2.
Files per ticket: one new `src/convex/agent/<domain>/<name>.ts` wrapper,
registered in `agent/registry.ts`.
Schema changes: none. Tests: wrapper returns `CapabilityResult` with
`evidenceRefs` mapped from existing `ContextEvidence[]`; existing feature
tests stay green (no behavior change). Acceptance: idempotent by
`sourceHash`; respects `resolveCapabilityState`; wrap only, no rewrite.
Dependencies: AG-2. Size: M each.

### Deferred (Phases D-G), with reason

- **Phase D `bootstrapProject.v1`**: already implemented as the starter-kit
  job. The one real gap is the missing `canceled` state (AGENTS rule 13).
  Fold that into its own small ticket against `starterKit.ts` later; do not
  build a second bootstrap workflow.
- **Phase E "Ready for You" UI**: depends on Wave 2 `home.priorities`
  (a separate ticket chain) and an approved Home IA change (D8, still
  open). Building it first would rank nothing real.
- **Phase F feedback/memory**: needs at least one live capability (AG-4a/b/c)
  producing artifacts to react to; building the loop first is speculative.
- **Phase G Ask MOSAI**: the blueprint itself gates this on the artifact
  workflow already working.

## 3. Contracts other blueprints will consume

`src/shared/contracts/provenance.ts` (dependency-free, same convention as
`status.ts`):

```ts
export type ContextTrust =
  | "workspace_entry" | "untrusted_source_text" | "provider_data";

export type EvidenceRef = {
  sourceType: string;   // e.g. "contextPack", "projectFile", "provider"
  sourceId: string;
  version?: string;      // contextVersion()-style hash when applicable
  retrievedAt?: number;
  url?: string;          // only for externally fetched sources (safeFetch)
  trust: ContextTrust;
};

// Highest tier first. Lower never silently overwrites higher; a first-party
// contradiction of a user_confirmed value becomes a "Needs you" suggestion.
export const AUTHORITY_ORDER = [
  "user_confirmed", "accepted_artifact", "first_party", "provider",
  "public_source", "population_prior", "inferred",
] as const;
export type Authority = (typeof AUTHORITY_ORDER)[number];

export type SourcedValue<T> = {
  value: T;
  authority: Authority;
  evidence: EvidenceRef[];
  confidence?: number;
  observedAt?: number;
  locked?: boolean;      // flag, not a tier; true only when authority is user_confirmed
};

export function canOverwrite<T>(
  current: SourcedValue<T> | undefined,
  incoming: SourcedValue<T>,
): boolean {
  if (!current) return true;
  if (current.locked) return false;
  return AUTHORITY_ORDER.indexOf(incoming.authority)
       <= AUTHORITY_ORDER.indexOf(current.authority);
}
```

`src/convex/agent/events.ts` (event envelope):

```ts
export type DomainEvent<T = unknown> = {
  type: string;              // "<entity>.<past_tense>.vN", no "project." prefix
  projectId: Id<"projects">;
  organizationId?: Id<"organizations">;
  payload: T;
  emittedAt: number;
  correlationId: string;     // ties an event to the capabilityRun that caused it
};
export async function emit<T>(
  ctx: MutationCtx, event: Omit<DomainEvent<T>, "emittedAt">,
): Promise<void>;
```

`src/convex/agent/registry.ts` (capability id/registry):

```ts
export type CapabilityId = `${string}.v${number}`;

export type CapabilityContext = {
  projectId: Id<"projects">; userId: Id<"users">;
  organizationId?: Id<"organizations">; sourceHash: string; correlationId: string;
};
export type CanRunResult =
  | { ok: true } | { ok: false; reason: "plan" | "role" | "setup" | "country" };
export type CapabilityResult<O> = {
  capabilityId: CapabilityId; schemaVersion: number; output: O;
  artifactIds: string[]; evidenceRefs: EvidenceRef[]; warnings: string[];
  confidence?: number;
};
export interface Capability<I, O> {
  id: CapabilityId; inputSchemaVersion: number; outputSchemaVersion: number;
  canRun(ctx: CapabilityContext): Promise<CanRunResult>; // calls resolveCapabilityState
  execute(ctx: CapabilityContext, input: I): Promise<CapabilityResult<O>>;
}
export const AGENT_REGISTRY: Partial<Record<CapabilityId, Capability<unknown, unknown>>> = {};
```

## 4. Risks and owner decisions

- **D7 (Convex Workflow)**: recommend keeping the job-table pattern through
  Phase A-C; two production implementations already prove it out. Revisit
  only if a Phase D bootstrap rewrite is separately requested.
- **Naming collision**: `agent/registry.ts` vs `lib/capabilities.ts` will
  still be called "capabilities" in conversation. Cross-reference comments
  in both files to stop a future merge of the two.
- **Events with no callers**: AG-1 ships `domainEvents`/`emit()` unused.
  Intentional per the blueprint's own "no speculative refactors" rule, but
  means AG-1's tests only prove plumbing, not a real flow. Owner should
  confirm this is acceptable versus deferring AG-1 until AG-4a has
  something to emit.
- **`act_external` has no approval mechanism yet**: AG-3 adds the value,
  not the gate. Any capability later claiming it needs its own ticket for
  an approval record and UI.
- **AG-4a source ambiguity**: exact current home of "business understanding"
  generation needs a quick `rg` at ticket start rather than a guessed line
  number here.
- **Schema union widening on `aiRuns` (AG-3)**: additive per Convex
  validators, but any exhaustive `switch (autonomy)` downstream gets new TS
  cases to handle: grep for such switches before merging, do not rely on
  `tsc -b` alone to catch UI-side string comparisons.
- **No new AGENTS §7 escalation required**: this ticket set touches no
  money, legal wording, or data exposure; D7 is the only open owner item,
  already tracked in INTEGRATION-PLAN §6.
