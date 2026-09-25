> **MOSAI status (25 Sep 2026): principles adopted, machinery deferred.**
>
> - **Adopted now:** modelGateway stays the only AI boundary; one user-authority order (user_confirmed + locked flag > accepted_artifact > first_party > provider > public_source > population_prior > inferred) enforced by `decideWrite` (CT-1); no silent overwrite of confirmed facts (KIT-2); "What needs you / Ready for you / What to do next" becomes one Home "For you now" list, max 3 items, with "Why this?" (HM-1, HM-2); manual path kept everywhere.
> - **Changed:** capability registry lives in `src/convex/agent/` (not `capabilities/`, which already means plan access in `lib/capabilities.ts`); the starter-kit job is the bootstrap workflow, no second bootstrap; event names follow `<entity>.<past_tense>.vN` and only enter the union when something emits them.
> - **Deferred until after U12 (D14):** Convex Workflow component (pre-1.0; keep job tables, D7), `domainEvents`, `capabilityRuns`, agentArtifacts, projectMemory, orchestrator, modelClass, evals harness, Ask MOSAI.
> Binding plan: `../MVP-BLUEPRINT-PLAN.md` (sections 3, 9 and 10 win over this file). Owner decisions: `../OWNER-DECISIONS.md`. Where this blueprint and the plan disagree, follow the plan. The original blueprint text below is kept unchanged for reference.

---

# MOSAI Future-Proof Agent Architecture Blueprint

**Status:** implementation blueprint  
**Date:** 25 September 2026  
**Target:** MOSAI / `julekpl/Mosai-friday`  
**Primary stack:** React + Convex + OpenRouter + MOSAI `modelGateway`  
**Audience:** product owner, product designer, backend engineer, Codex/AI coding agent  
**Priority:** architecture stability, user value, controllable autonomy, low coupling, cost control

---

## 0. Executive decision

MOSAI should **not** be architected around a specific agent framework, a specific LLM, or today's module names.

The durable architecture is:

```text
Convex               = source of truth
OpenRouter            = inference/provider layer
MOSAI modelGateway    = only model boundary
Convex Workflow       = durable automation
MOSAI Project State   = deterministic understanding of what exists/is missing/stale
MOSAI Orchestrator    = decides what work should happen
Capability Registry   = stable contract between orchestration and product features
Artifacts             = prepared work
Recommendations       = prioritized user-facing decisions
Project Memory        = confirmed facts, preferences and constraints
Approval Policy       = boundary between "prepare" and "act"
```

The most important future-proofing rule is:

> **The orchestrator depends on versioned capabilities and contracts, never directly on UI pages, feature modules, vendor SDKs, or individual prompt implementations.**

This lets MOSAI replace or reorganize its modules, models, providers, prompts, storage, UI and specialist agents without rewriting the orchestration system.

---

# 1. Goals

## 1.1 Product goals

The agent layer must make MOSAI feel simpler as the application becomes more capable.

The user experience should converge toward:

```text
What needs you
Ready for you
What to do next
```

rather than exposing the increasing internal complexity of:

```text
personas
journeys
CMS
products
analytics
SEO/GEO
campaigns
CRM
social
ads
media
automation
models
research providers
```

The system should:

1. Prepare useful work automatically.
2. Reuse what MOSAI already knows instead of repeatedly asking the user.
3. Ask only questions that materially affect the outcome.
4. Preserve manual workflows.
5. Preserve and prioritize confirmed user decisions.
6. Prevent silent destructive/external actions.
7. Remain stable when modules or providers change.
8. Be observable, testable and cost-bounded.
9. Fail locally, not cascade through the product.
10. Allow individual capabilities to be upgraded independently.

## 1.2 Technical goals

- No provider-specific logic in the orchestrator.
- No direct OpenRouter calls outside `modelGateway`.
- No giant autonomous loop.
- No coupling between route names/UI pages and agent decisions.
- Versioned schemas for capability input/output.
- Event-driven invalidation instead of arbitrary regeneration.
- Durable multi-step workflows.
- Idempotency at workflow and capability level.
- Source hashes to avoid unnecessary model calls.
- Explicit provenance and user-authority hierarchy.
- Strong tenancy, authorization and least-privilege boundaries.
- Bounded retries, cost, steps and tool calls.
- Backward-compatible evolution paths.

## 1.3 Non-goals for MVP

Do **not** make these architectural prerequisites:

- multi-agent swarms;
- Hermes;
- LangGraph;
- unrestricted MCP;
- autonomous publishing;
- autonomous ad spend;
- autonomous CRM outreach;
- arbitrary shell/browser access;
- one universal "super-agent" prompt;
- replacing existing MOSAI feature code.

They can be introduced later behind the capability boundary if they create measurable value.

---

# 2. Current MOSAI baseline

Repository inspected: `julekpl/Mosai-friday`.

The existing code already provides much of the infrastructure an agent system needs:

```text
src/convex/ai.ts
src/convex/aiBudget.ts
src/convex/aiModels.ts
src/convex/research.ts
src/convex/personas.ts
src/convex/personaChat.ts
src/convex/journeys.ts
src/convex/buildChat.ts
src/convex/buildPlan.ts
src/convex/buildWorkspace.ts
src/convex/cms.ts
src/convex/products.ts
src/convex/sellAI.ts
src/convex/shopifySync.ts
src/convex/projects.ts
src/convex/schema.ts
src/convex/lib/modelGateway.ts
```

`modelGateway.ts` already centralizes:

- model/provider resolution;
- OpenRouter access;
- output token ceiling;
- request timeout;
- validation;
- one structured-output repair attempt;
- AI run recording;
- token/cost metadata;
- budget reservation/charging.

This is valuable. **Do not bypass it.**

The correct extension is orchestration around existing capabilities, not a parallel AI stack.

---

# 3. Architecture

## 3.1 Logical architecture

```text
                          USER / SYSTEM EVENT
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ Event Normalizer │
                         └────────┬─────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Project State Engine    │
                    │ deterministic           │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │ MOSAI Orchestrator      │
                    │ policy + prioritization │
                    └───────────┬─────────────┘
                                │
                   selects versioned capability
                                │
                                ▼
                    ┌─────────────────────────┐
                    │ Capability Registry     │
                    └───────────┬─────────────┘
                                │
                    starts durable workflow
                                │
                                ▼
                    ┌─────────────────────────┐
                    │ Convex Workflow         │
                    └───────────┬─────────────┘
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
        Existing MOSAI      Provider adapter    modelGateway
        business logic      / external APIs          │
                                                     ▼
                                                  OpenRouter
             └──────────────────┬──────────────────┘
                                ▼
                   artifacts / recommendations
                                │
                                ▼
                         Convex source of truth
                                │
                                ▼
                         reactive MOSAI UI
```

Convex's Workflow component is specifically intended for durable multi-step operations with persisted progress, retries and resumability. Individual steps should be idempotent, and large data should be stored in application tables with IDs passed between steps rather than moving large payloads through workflow state. [S1][S2]

---

# 4. Architectural invariants

These are non-negotiable rules.

## 4.1 Source of truth

Convex is the authoritative project state.

LLM conversation history, enrichment providers, browser state and workflow state are **not** authoritative business truth.

## 4.2 Inference boundary

All generative/model inference routes through:

```text
src/convex/lib/modelGateway.ts
```

No capability is allowed to:

```text
fetch("https://openrouter.ai/...")
```

directly.

This preserves:

- budgets;
- model controls;
- provider policy;
- telemetry;
- auditing;
- future provider changes.

OpenRouter supports provider failover and optional model fallback chains, so resilience can evolve inside the gateway without changing capabilities. [S6][S7]

## 4.3 Decision versus execution

The model may propose an action.

Authorization must be deterministic.

Never let an LLM output alone decide:

- whether a user has permission;
- whether money can be spent;
- whether data can be deleted;
- whether something can be published;
- whether a provider OAuth scope is allowed.

OWASP's current agent security guidance explicitly recommends least privilege, schema validation, human oversight for high-impact actions, bounded cost/tool chains, and separating decision-making from irreversible execution. [S11][S12]

## 4.4 User authority

Priority:

```text
1. user-confirmed + locked
2. user-confirmed
3. user manual edit
4. accepted MOSAI artifact
5. connected first-party data
6. public/business evidence
7. MOSAI inference
8. generic model knowledge
```

A lower tier can never silently overwrite a higher tier.

---

# 5. Capability Registry

## 5.1 Why

Today MOSAI has pages/modules called Understand, Create, Build, Customers, Promote, Grow and Sell.

Those names may change.

The orchestrator should not know them.

It knows outcomes:

```text
business.understand.v1
brand.derive.v1
audience.personas.prepare.v1
journey.prepare.v1
content.gaps.detect.v1
content.prepare.v1
website.plan.v1
website.page.prepare.v1
commerce.catalog.audit.v1
performance.analyze.v1
media.prepare.v1
```

## 5.2 Contract

Create:

```text
src/convex/capabilities/
  registry.ts
  contracts.ts
  errors.ts
  business/
  audience/
  journey/
  content/
  website/
  commerce/
  performance/
  media/
```

Suggested TypeScript concept:

```ts
type CapabilityId = `${string}.v${number}`;

type CapabilityContext = {
  projectId: Id<"projects">;
  userId: Id<"users">;
  organizationId?: Id<"organizations">;
  sourceHash: string;
  correlationId: string;
};

type CapabilityResult<T> = {
  capabilityId: CapabilityId;
  schemaVersion: number;
  output: T;
  artifactIds: string[];
  evidenceRefs: EvidenceRef[];
  warnings: string[];
  confidence?: Confidence;
};

interface Capability<I, O> {
  id: CapabilityId;
  inputSchemaVersion: number;
  outputSchemaVersion: number;

  canRun(ctx: CapabilityContext): Promise<CanRunResult>;
  execute(ctx: CapabilityContext, input: I): Promise<CapabilityResult<O>>;
}
```

Do not over-generalize the runtime. The common contract should remain small.

## 5.3 Registry

Conceptually:

```ts
const REGISTRY = {
  "business.understand.v1": understandBusinessV1,
  "audience.personas.prepare.v1": preparePersonasV1,
  "journey.prepare.v1": prepareJourneyV1,
  "content.gaps.detect.v1": detectContentGapsV1,
  "website.plan.v1": prepareWebsitePlanV1,
} satisfies CapabilityRegistry;
```

The orchestrator calls by ID:

```ts
runCapability("audience.personas.prepare.v1", ...)
```

not:

```ts
import { generatePersona } from "../ai";
```

---

# 6. Versioning strategy

Use explicit immutable versions for public/internal contracts.

Semantic Versioning is based on declaring a public API and not modifying a released version in place. Apply the same idea to MOSAI capability contracts. [S8]

## 6.1 What to version

Version:

- capability ID;
- input schema;
- output schema;
- project-state schema;
- artifact schema;
- event type;
- prompt version;
- policy version;
- recommendation scoring version;
- provider-normalization schema.

Example:

```text
audience.personas.prepare.v1
project.created.v1
BusinessProfile.v2
AgentArtifact.v1
RecommendationScore.v3
```

## 6.2 What not to encode into IDs

Do not expose:

```text
gpt-5.6-persona-v2
apollo-company-enrichment-v1
cloudinary-enhance-v1
```

as product contracts.

Those are implementation/provider details.

## 6.3 Schema validation

Use runtime validators for all boundaries.

MOSAI is TypeScript, but TypeScript disappears at runtime. Validate:

- provider responses;
- LLM structured output;
- workflow arguments;
- event payloads;
- capability results.

JSON Schema exists specifically to define and validate JSON structure; Draft 2020-12 is the current published draft. [S9][S10]

Zod/Convex validators are fine in code, but keep the conceptual schemas explicit and testable.

---

# 7. Events

## 7.1 Event contract

Events describe facts, not commands.

Good:

```text
project.created.v1
business_profile.confirmed.v1
persona.confirmed.v1
website.published.v1
analytics.synced.v1
product.changed.v1
media.asset.ready.v1
```

Bad:

```text
generateNewContent
rerunPersona
startAgent
```

Commands belong in workflow tasks.

## 7.2 Event shape

```ts
type MosaiEvent<T> = {
  id: string;
  type: string;
  schemaVersion: number;
  occurredAt: number;

  projectId: Id<"projects">;
  organizationId?: Id<"organizations">;
  actor: {
    kind: "user" | "system" | "provider";
    id?: string;
  };

  payload: T;
  correlationId: string;
  causationId?: string;
};
```

## 7.3 Event processing rule

An event does **not** directly trigger model generation.

It triggers:

```text
event
  ↓
recalculateProjectState()
  ↓
calculateInvalidations()
  ↓
orchestrator
  ↓
0..N bounded tasks
```

This prevents "one edit = five unnecessary AI calls".

---

# 8. Project State Engine

The Project State Engine is deterministic.

No LLM is required to answer:

- Does a confirmed business profile exist?
- Are personas missing?
- Was the persona changed after the journey?
- Is analytics connected?
- Is a website plan based on an old business profile?

Suggested state:

```ts
type Readiness =
  | "missing"
  | "inferred"
  | "draft"
  | "confirmed"
  | "stale"
  | "blocked"
  | "not_applicable";

type ProjectState = {
  schemaVersion: 1;
  business: Readiness;
  brand: Readiness;
  audience: Readiness;
  journey: Readiness;
  content: Readiness;
  website: Readiness;
  commerce: Readiness;
  acquisition: Readiness;
  measurement: Readiness;
  media: Readiness;
};
```

The state engine should also emit reasons:

```json
{
  "journey": {
    "state": "stale",
    "reason": "persona_version_changed",
    "dependsOn": ["persona:abc@7"],
    "currentSourceHash": "..."
  }
}
```

---

# 9. Dependency graph and invalidation

Do not hard-code "persona changed → regenerate everything".

Maintain dependency metadata:

```text
BusinessProfile
   ├→ Brand
   ├→ Personas
   │    └→ Journeys
   │          ├→ Content gaps
   │          └→ Website plan
   └→ Products
        └→ Website / Sell outputs
```

Each artifact records dependencies:

```ts
dependencies: [
  { ref: "businessProfile", version: 4 },
  { ref: "persona:abc", version: 7 },
  { ref: "brandProfile", version: 2 }
]
```

When a dependency changes, mark dependent artifacts `stale`.

Do **not** automatically destroy/regenerate them.

Then policy decides:

```text
stale + cheap + low-risk       → refresh automatically
stale + expensive              → queue for later
stale + user-edited            → propose update, never overwrite
stale + published              → recommendation only
```

---

# 10. Source hashes and idempotency

Every expensive operation needs an idempotency key.

```text
capabilityId
projectId
input schema version
relevant source versions
prompt version
policy version
```

Hash those values.

Example:

```ts
sourceHash = sha256(
  canonicalJson({
    capability: "content.gaps.detect.v1",
    businessProfileVersion: 4,
    personaVersions: [7, 2],
    journeyVersions: [3],
    promptVersion: "v3"
  })
);
```

Before executing:

```text
same capability + same sourceHash + usable artifact exists
→ reuse
```

This is a major cost and consistency control.

---

# 11. Workflow architecture

Install/use Convex Workflow rather than building retry orchestration manually.

Current docs:

```bash
npm install @convex-dev/workflow
```

and register the component in `convex.config.ts`. [S1][S3]

The repository currently sets:

```json
{
  "functions": "src/convex/"
}
```

Therefore the app's component configuration belongs in the Convex functions directory:

```text
src/convex/convex.config.ts
```

Confirm generated paths with the currently installed Convex version when implementing.

## 11.1 Workflow design rules

Each workflow:

- is finite;
- has named steps;
- has explicit retry policy;
- passes IDs rather than huge documents;
- can be cancelled;
- records progress;
- has a max cost/call budget;
- is idempotent;
- does not publish externally.

Example:

```text
bootstrapProject.v1

1 resolve business context
2 crawl website
3 prepare business profile
4 research business
5 prepare personas
6 prepare journeys
7 detect content opportunities
8 prepare website plan
9 score next actions
10 finalize onboarding
```

Where dependencies allow:

```text
crawl complete
  ├→ market research
  ├→ brand analysis
  └→ website quality analysis
```

Convex Workflow supports sequential/parallel steps, persisted progress, retries, cancellation and reactive status. [S1]

---

# 12. Orchestrator

The orchestrator is **mostly code**.

Do not send the whole application state to a model and ask, "What should happen?"

Suggested pipeline:

```text
getProjectState()
getUserAutomationPreferences()
getPolicy()
getStaleDependencies()
getExistingTasks()
      ↓
deterministic candidate tasks
      ↓
priority scoring
      ↓
optional LLM only for ambiguous strategic ranking
      ↓
bounded task list
```

## 12.1 Example deterministic rules

```ts
if (state.business === "missing")
  schedule("business.understand.v1");

if (state.business === "confirmed" && state.audience === "missing")
  schedule("audience.personas.prepare.v1");

if (personaChanged && journeyIsUserEdited)
  recommend("journey.refresh", { autoRun: false });

if (analyticsFresh && noRecentPerformanceAnalysis)
  schedule("performance.analyze.v1");
```

## 12.2 Limits

An orchestration cycle should have configurable ceilings:

```ts
MAX_TASKS_PER_CYCLE
MAX_AI_CALLS_PER_CYCLE
MAX_ESTIMATED_COST_MICROUSD
MAX_TOOL_CHAIN_DEPTH
MAX_RETRIES_PER_STEP
```

OWASP warns about "denial of wallet" and unbounded agent loops, so these controls are security controls, not only finance features. [S11]

---

# 13. Artifacts

Agent work should produce durable artifacts, not only chat text.

Suggested table:

```text
agentArtifacts
```

Fields:

```ts
{
  projectId,
  organizationId,

  artifactType,
  artifactSchemaVersion,

  capabilityId,
  capabilityRunId,
  workflowId,

  status:
    "draft" |
    "accepted" |
    "rejected" |
    "superseded" |
    "stale",

  payloadRef,
  summary,

  sourceHash,
  dependencies,
  evidenceRefs,

  createdBy: "agent" | "user",
  userEdited: boolean,

  createdAt,
  updatedAt
}
```

Prefer references to domain tables when the canonical output already belongs elsewhere.

Example:

```text
agentArtifact
  payloadRef = persona:abc
```

not a second copy of the entire persona.

---

# 14. Provenance

Every meaningful inferred fact must be traceable.

```ts
type EvidenceRef = {
  sourceType:
    | "user"
    | "website"
    | "file"
    | "analytics"
    | "crm"
    | "product"
    | "research"
    | "provider"
    | "model_inference";

  sourceId: string;
  version?: string;
  retrievedAt?: number;
  url?: string;
};
```

Derived facts:

```ts
type SourcedValue<T> = {
  value: T;
  provenance: EvidenceRef[];
  authority:
    | "user_locked"
    | "user_confirmed"
    | "first_party"
    | "external"
    | "inferred";
  confidence?: number;
};
```

This foundation is reused by the organization-enrichment blueprint.

---

# 15. Project Memory

Memory should store explicit durable user knowledge, not raw chat history.

```text
projectMemory
```

Examples:

- "Never call customers users."
- "We do not target freelancers."
- "Primary market is Benelux + Germany."
- "Do not use discounts in luxury brand messaging."
- "Main conversion is booking a demo."

Fields:

```ts
{
  projectId,
  scope,
  kind: "fact" | "preference" | "constraint" | "instruction",
  value,
  authority,
  locked,
  sourceRef,
  createdAt,
  updatedAt
}
```

Do not let model summaries silently become permanent memory.

Promotion to durable memory should require one of:

- explicit user statement;
- explicit user confirmation;
- deterministic first-party source;
- carefully defined product rule.

---

# 16. Human control and approval

## 16.1 Autonomy levels

```text
OBSERVE
analyse only

PREPARE
create drafts/artifacts

MODIFY INTERNAL DRAFTS
change reversible MOSAI state

ACT EXTERNALLY
publish/send/spend/delete/contact
```

MVP policy:

```text
Observe              automatic
Prepare              automatic
Modify confirmed     approval / diff
Act externally       always explicit approval
```

Convex Agent supports tool-level approval and can pause execution until a user approves/denies a tool call. This is useful when MOSAI later introduces external actions. [S5]

## 16.2 Manual path

Every AI surface must retain:

```text
Create manually
Edit manually
Keep mine
Use suggestion
Try again
Dismiss
Undo
```

Manual editing is not a fallback. It is a supported product mode.

---

# 17. Provider abstraction

Everything volatile goes behind an adapter:

```text
ModelProvider
CompanyIntelligenceProvider
SearchProvider
MediaProcessingProvider
AnalyticsProvider
AdsProvider
EmailProvider
CommerceProvider
```

Do not let business/domain logic depend on vendor response shapes.

Adapter pattern:

```text
vendor API
  ↓
provider adapter
  ↓
MOSAI normalized contract
  ↓
capability
```

Provider responses must be normalized and validated before they enter project context.

---

# 18. OpenRouter evolution

Keep the current `modelGateway`.

Future enhancements belong there:

- model classes (`fast`, `standard`, `reasoning`);
- model fallback chains;
- provider allow/deny rules;
- latency/cost constraints;
- zero-data-retention policy where needed;
- per-capability routing;
- circuit breaker;
- compatibility tests.

OpenRouter supports provider routing and automatic provider fallback; cross-model fallback is configurable via a model list. [S6][S7]

Capabilities should request:

```text
modelClass: "fast"
```

not:

```text
model: "vendor/model-name"
```

The gateway maps classes to currently approved models.

---

# 19. Security

## 19.1 External content is untrusted

Website content, uploaded files, provider records and research results are **data**, never instructions.

Your existing `ai.ts` already contains this principle. Keep it central.

External content must not be able to:

- choose tools;
- change permissions;
- reveal secrets;
- override policy;
- select arbitrary models;
- publish content;
- spend money.

OWASP recommends separating instructions from untrusted data, validating tool calls, least-privilege access and applying stronger screening at high-risk action boundaries. [S11][S12]

## 19.2 Tenant isolation

Every capability receives a verified:

```text
userId
organizationId
projectId
```

Never trust those IDs directly from the model.

All database writes re-check authorization.

## 19.3 Kill switch

Add platform controls:

```text
agentAutomationEnabled
externalActionsEnabled
capabilityDisabled[capabilityId]
providerDisabled[provider]
```

A bad provider or bad capability must be stoppable without redeploying the whole product.

---

# 20. Observability

Add a correlation ID across:

```text
event
→ orchestration cycle
→ workflow
→ capability run
→ model run
→ artifact
→ recommendation
```

You already record `aiRuns`.

Add:

```text
agentRuns
capabilityRuns
```

Do not log sensitive prompts by default.

Record:

```text
IDs
versions
status
latency
token/cost totals
retry count
source hash
error category
artifact IDs
```

Admin UX should answer:

- Why did this task run?
- What triggered it?
- Which capability version ran?
- Which data versions were used?
- What did it cost?
- Did it retry?
- What artifact did it create?
- Was it accepted/edited/rejected?

---

# 21. Evals

Every capability needs a fixture suite.

Example:

```text
tests/evals/audience-personas/
  b2b-saas.json
  restaurant.json
  ecommerce.json
  local-service.json
  sparse-context.json
  conflicting-context.json
  malicious-website-content.json
```

Score:

- schema validity;
- use of evidence;
- unsupported factual claims;
- audience correctness;
- constraint adherence;
- duplicate output;
- user-memory adherence;
- token/cost range.

Do not update prompts/models in production only because outputs "look better".

Run regression evals.

---

# 22. Feature flags and migrations

Every major capability release:

```text
off
internal
beta cohort
percentage rollout
default
```

Keep old capability version runnable during migration.

Example:

```text
audience.personas.prepare.v1  90%
audience.personas.prepare.v2  10%
```

Measure:

- acceptance;
- edit distance;
- dismissals;
- cost;
- latency;
- downstream action rate.

Then migrate.

---

# 23. UX contracts independent of backend

Frontend consumes stable view models:

```ts
type ReadyItem = {
  id: string;
  category: string;
  title: string;
  summary: string;
  state: "ready" | "needs_input" | "working";
  actions: UserAction[];
};
```

The UI should never need to know:

- which model ran;
- which agent framework ran;
- which provider created company data;
- which file contained the prompt.

This allows UI redesign without backend redesign.

---

# 24. File-level implementation plan

## Phase A: foundation

Create:

```text
src/convex/convex.config.ts
src/convex/agent/
src/convex/capabilities/
```

Add Workflow component.

Add tables:

```text
agentTasks
agentArtifacts
agentRecommendations
agentFeedback
projectMemory
capabilityRuns
```

## Phase B: contracts

Implement:

```text
capabilities/contracts.ts
capabilities/registry.ts
agent/events.ts
agent/projectState.ts
agent/policy.ts
```

No new LLM calls yet.

## Phase C: adapt existing features

Wrap existing functionality:

```text
business.understand.v1
audience.personas.prepare.v1
journey.prepare.v1
content.gaps.detect.v1
website.plan.v1
```

Do not rewrite the implementations.

## Phase D: bootstrap workflow

Implement bounded:

```text
bootstrapProject.v1
```

Add cancellation/status.

## Phase E: Ready for You

UI:

```text
src/components/agent/
  NeedsYou.tsx
  ReadyForYou.tsx
  ReadyCard.tsx
  AgentProgress.tsx
  WhyThis.tsx
  ArtifactDiff.tsx
```

## Phase F: feedback/memory

Add:

```text
Accept
Edit
Regenerate
Dismiss
Tell MOSAI what's wrong
Lock fact
```

## Phase G: Ask MOSAI

Only after the artifact workflow works.

Evaluate `@convex-dev/agent` for persistent threads/tool approval. Do not migrate core inference just to use it. Convex Agent provides persistent threads, tools and context, but the existing MOSAI gateway remains the budget/provider boundary. [S4][S5]

---

# 25. Acceptance criteria

## Architecture

- [ ] Orchestrator imports no feature-page components.
- [ ] Orchestrator does not call OpenRouter directly.
- [ ] Every capability has an immutable version ID.
- [ ] Every capability validates input/output.
- [ ] Every model call uses `modelGateway`.
- [ ] Every expensive run has an idempotency/source hash.
- [ ] Every workflow is bounded.
- [ ] Every external action is authorization-gated.
- [ ] Providers can be replaced behind adapters.
- [ ] A provider outage does not corrupt project state.

## User value

- [ ] Agent prepares work rather than only chats.
- [ ] User sees no more than 3 top priorities by default.
- [ ] User corrections affect future output.
- [ ] The system explains why important recommendations exist.
- [ ] Stale outputs are identified rather than silently overwritten.

## User control

- [ ] Manual creation remains possible.
- [ ] Confirmed user content cannot be silently overwritten.
- [ ] User can stop workflows.
- [ ] User can dismiss suggestions.
- [ ] User can restore prior versions.
- [ ] Publish/send/spend/delete require explicit approval.

## Reliability

- [ ] Workflow resumes from failed step.
- [ ] Duplicate event does not duplicate artifact.
- [ ] Model/provider changes can be rolled out behind a flag.
- [ ] Old capability versions can complete while a new version exists.
- [ ] Evals cover common project types and adversarial content.

---

# 26. Codex implementation constraints

Give Codex these guardrails:

```text
1. Do not rewrite existing MOSAI AI features.
2. Wrap existing features behind capability contracts.
3. Keep modelGateway as the only inference boundary.
4. Introduce no new agent framework unless a milestone explicitly requires it.
5. Implement M0-M3 before Ask MOSAI or external action tools.
6. Never mix schema migration, UX redesign and provider replacement in one milestone.
7. Run typecheck, lint and relevant tests after each milestone.
8. Stop after 3 milestones and report repository state.
9. No speculative refactors outside touched capability boundaries.
10. Do not automatically publish, send, delete or spend.
```

---

# 27. Decision summary

The future-proof unit in MOSAI is **not an agent**.

It is a **versioned capability contract**.

Agents, workflows, providers and modules are replaceable implementations.

That is what keeps the application evolvable.

---

# 28. Sources

**Repository baseline**

- MOSAI repository: https://github.com/julekpl/Mosai-friday

**Convex**

- [S1] Convex Workflow component, durable workflows, retries, cancellation and reactive status: https://www.convex.dev/components/workflow
- [S2] Convex agent workflows and idempotent durable steps: https://docs.convex.dev/agents/workflows
- [S3] Convex Components setup and isolation: https://docs.convex.dev/components/using
- [S4] Convex Agent overview, threads/context/tools: https://docs.convex.dev/agents/overview
- [S5] Convex Agent tool approval: https://docs.convex.dev/agents/tool-approval

**OpenRouter**

- [S6] Model fallback behavior: https://openrouter.ai/docs/guides/routing/model-fallbacks
- [S7] OpenRouter model/provider routing overview: https://openrouter.ai/blog/insights/model-routing/

**Contract/version standards**

- [S8] Semantic Versioning 2.0.0: https://semver.org/
- [S9] JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12/
- [S10] JSON Schema validation specification: https://json-schema.org/draft/2020-12/json-schema-validation

**Agent security**

- [S11] OWASP AI Agent Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- [S12] OWASP LLM Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

---

## Research note

All external capabilities and APIs referenced above were checked against current public documentation on 25 September 2026. Vendor APIs, pricing and beta statuses can change. The capability/provider abstraction in this blueprint is intentionally designed so such changes do not become MOSAI-wide rewrites.
