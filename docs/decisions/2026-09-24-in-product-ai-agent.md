# Decision record: the in-product AI agent

**Status:** accepted (option C) on 24 Sep 2026; decisions 2 and 4 provisional, decision 3 open · **Date:** 24 Sep 2026
**Needed because:** AGENTS.md §8 forbids adding a framework not named in an accepted ADR, and rule 11 says every AI call goes through `ModelGateway`.

## Question

The owner wants an AI agent that helps users with everything, and pointed at Nous Research's **Hermes Agent**. An AI-generated blueprint proposed running Hermes as a worker bridged to Convex. What should MOSAI build?

## Findings (sources read 24 Sep 2026)

Source code was read from the repositories behind each docs site, because the network proxy blocked the docs sites themselves.

1. **The blueprint's code is not real.**
   - `@nousresearch/hermes-agent-core` and `@nousresearch/hermes-agent` return 404 on npm.
   - `HermesAgentInstance.loadProfile` / `executeTask` do not exist anywhere in `NousResearch/hermes-agent`.
   - The npm package `hermes-agent` is an unofficial CLI wrapper published by a third party. **Do not install it**, because it would run with shell access.
2. **What Hermes is.**
   - A Python, MIT-licensed personal agent (repo HEAD `e8acdc5`, tag `v2026.9.24`, pyproject 0.21.5). It is installed from git with `uv`.
   - It offers a CLI/TUI, a Python API (`run_agent.AIAgent`) and an OpenAI-compatible HTTP server (default `127.0.0.1:8642`, one bearer key per profile).
   - It also has a messaging gateway and an MCP client, plus `hermes mcp serve`.
   - Its web dashboard is a single-operator admin console (loopback by default, password or Nous Portal OAuth otherwise).
3. **It is single-tenant by design.** `SECURITY.md`: "Hermes Agent is a single-tenant personal agent."
   - Isolation is one profile directory, meaning one process or container, per tenant.
   - Memory is a pair of small markdown files that are injected into every session.
   - The agent can create skills itself.
4. **Security model.**
   - The default terminal backend is `local`, which has no isolation.
   - Approval checks are skipped inside container backends, where the container is the boundary.
   - `SECURITY.md` states that the only boundary against an adversarial LLM is the operating system, and lists prompt injection as out of scope.
   - For MOSAI, scraped competitor pages and uploaded files are untrusted text (AGENTS.md rule 4). They would reach an agent with a shell, web access and self-editable memory. A single injection could plant a skill that affects every later session for that tenant.
5. **Models.** Hermes works with OpenRouter, but needs at least 64K context and native tool calling.

## Options

| | A. Hermes worker per tenant, bridged through Convex | B. Hermes as an internal operator tool only | C. Native copilot in Convex (recommended) |
|---|---|---|---|
| Security | Worst. Per-tenant containers, egress control and secret isolation are MOSAI's job, on a tool whose authors call it single-tenant | Acceptable on loopback / a docker backend with no customer data | Best. The agent can only call typed, guarded Convex functions; no shell |
| Cost | Tokens + a container per active tenant + Python operations | Tokens | Tokens + normal Convex compute |
| Latency | Cold start + network hop + ≥64K context re-sent each step | n/a | One action per step, streamed over Convex websockets |
| Effort | High | Low | Medium |
| Fits AGENTS.md | No (rules 3, 4, 5, 11 need heavy work) | Yes, for internal use | Yes |

## Recommendation

**Build option C.** Keep B available only as the owner's personal operations agent. Reject A.

Option C, concretely:

- **Loop.**
  - An OpenRouter tool-calling loop in a Convex action, behind `ModelGateway`.
  - The gateway already resolves the operator-approved model per project (`aiModels`) and records every call in `aiRuns`.
  - It gains a tool-calling request shape.
- **Tools are MOSAI's own typed functions, never a shell.**
  - Read tools: context pack, personas, journeys, content, Grow metrics, readiness.
  - Draft tools: create persona, draft content, plan site.
  - Everything that reaches the outside world (publish, schedule, spend) is only *proposed*. It becomes a job with an idempotency key, and runs after the user confirms (rule 5/6, autonomy levels).
- **Grounding.** Every run starts from the confirmed business profile (`lib/businessProfile.ts`). Scraped and provider text stays data, and never chooses tools or arguments (rule 4).
- **Threads and streaming.**
  - Candidate library: `@convex-dev/agent` 0.7.3 (Apache-2.0, 14 Sep 2026), which provides threads, delta streaming, tool calls, usage tracking and rate limits, with `@openrouter/ai-sdk-provider` 3.1.0. Both require `ai@^7`.
  - Adding these needs this ADR accepted.
  - The alternative is a small hand-rolled loop inside `ModelGateway`, which avoids new dependencies. **Recommendation: hand-rolled first.** The gateway already owns budgets, run records and model resolution; revisit `@convex-dev/agent` if threads or streaming grow complex.
- **Ideas worth copying from Hermes.**
  - Per-project *skills*: versioned how-to documents the agent may propose, which the owner approves.
  - Small, capped *project memory* that is edited only through a typed tool.
  - A *learning loop* that drafts a skill from a successful job for review.
  - *Unattended runs deny by default*: a job that needs approval moves to `waiting_for_user`.

## Decision (24 Sep 2026)

The owner accepted **option C**, a native copilot inside Convex. Option A (a Hermes worker per tenant) is rejected. No Hermes package, Python worker or `hermes-agent` npm package enters this repository.

| # | Question | Status |
|---|---|---|
| 1 | Option C | **Accepted.** Hermes stays available as the owner's own tool on their machine (option B), outside the product. |
| 2 | Loop | **Provisional: hand-rolled** inside `ModelGateway`, with no new dependencies. The owner can revisit this before T2.19. |
| 3 | AI budget per plan | **Open.** This is money, so it is the owner's call (AGENTS.md §7). Until then the existing per-user quota applies: one unit per user turn, plus a hard cap on steps per turn. |
| 4 | First release scope | **Provisional: navigate + read + draft.** No tool may publish, schedule, send or spend. Those arrive only as proposals once T2.12 (`ApprovalGate`) exists. |

Tickets (rows in `docs/pack/10-build-backlog.md`): **T2.17** tool calling in `ModelGateway`, **T2.18** the copilot tool registry, **T2.19** copilot threads and the app-wide dock, **T2.20** a next-step model covering all eight modules.

## Decisions the owner had to make (as originally proposed)

1. Accept option C (and whether to keep B for internal operations).
2. Hand-rolled loop vs `@convex-dev/agent` (new dependencies: `ai@^7`, `@convex-dev/agent`, `@openrouter/ai-sdk-provider`).
3. AI budget per plan, now that models are operator-selected: monthly tokens or cost per organization, enforced in the gateway.
4. First release scope. Suggested: a "Next best step" assistant that reads the whole project and drafts, but never publishes or spends.
