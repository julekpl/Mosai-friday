# Build module backend review (websites and apps from chat)

**Date:** 24 Sep 2026 · **Tree:** `b62c29f` · **Type:** read-only review. No source files were changed.
**Scope:** `src/convex/{buildChat,buildInternals,buildPages,buildPlan,buildWorkspace,builds,cms}.ts`, `lib/{modelGateway,contextPack,deliveryGate,businessProfile,aiModelCatalog}.ts`, the build parts of `guards.ts` and `schema.ts`, `src/lib/cms/blocks.ts`, plus the callers in `src/components/build/BuildWorkspace.tsx` and `src/pages/app/Build.tsx`.
**Missing inputs:** `docs/pack/07-ai-agent-config.md` and `docs/pack/08-module-contracts.md` are not in the repository (`docs/pack/STATUS.md` §7 records this). Where the brief pointed to them, this review uses AGENTS.md, `docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md` (BP-07, BP-09, BP-13, BP-15) and the two proposed decision records in `docs/decisions/`. `M1-BLUEPRINT.md` covers Sell. Only its J7 section (Build pages reference `productId`) applies here.

---

## 0. Verdict

MOSAI's "Build" produces **no code**. It is a chat-driven generator of **CMS block documents**: a JSON `PageDocument` of 11 registry blocks per page, stored as `pageRevisions`. An "app" build stops at a reviewed requirements form. This is a defensible product choice for small-business marketing sites. It is safer, cheaper, SEO-friendly, editable without code and needs no sandbox. It also means that most of what Lovable, Bolt, v0, Dyad and Caffeine do (source graphs, sandboxes, dependency installs, build/repair loops) **does not apply to the website path**, and must not be copied into it by reflex.

The truth layer is strong. The release/deployment gate (`lib/deliveryGate.ts`, `cms.getPublishedByPath`) is careful and tested. Nothing is served publicly without a verified deployment receipt, and no deployment writer exists yet.

The **generation layer** is weak. It is a synchronous request/response action that sends one un-streamed JSON blob per request, with no structured-output enforcement. Every edit rewrites the whole page, the model sees props truncated to 200 characters, the prompt contradicts the validator, and nothing sanitizes on save. This creates silent data loss and silently dropped pages. There is no job, no idempotency, no cost budget and no evaluation. Two parallel Build pipelines exist and do not connect.

---

## 1. How the pipeline works today (end to end)

There are **two unconnected pipelines**.

### 1A. "Blueprint" pipeline (legacy, `Build.tsx` manage view)

| Step | Where | What happens |
|---|---|---|
| Create build | `builds.ts:81-111` (`builds.create`) | A client mutation inserts a `builds` row: `kind: website\|app`, idea, persona and journey ids, status `draft`. |
| Plan | `buildPlan.ts:171-290` (`generateBuildPlan`) | A plain `action` (not `moduleAction`). It loads the server `ContextPack` (`guards.ts:1608`), makes one model call through `modelComplete`, and returns positioning, goals and 4–8 pages to the **client**. The client persists them through `builds.update` and `buildPages.create` (`Build.tsx:119-160`). |
| Page draft | `buildPlan.ts:314-361` (`generatePageDraft`) | Returns **raw HTML** to the client. The client writes it into `buildPages.draft` (a free-form string) and sets `status: "drafted"` through `buildPages.update` (`Build.tsx:497-498`). The preview sanitizes at render (`Build.tsx:662`). |
| Output | `buildPages` table | The HTML is **never** converted into CMS pages. Nothing downstream reads `buildPages.draft`. |

### 1B. Chat workspace pipeline (current, `BuildWorkspace.tsx`)

| Step | Where | What happens |
|---|---|---|
| Plan chat | `buildChat.ts:148-223` (`planSite`) | Stores the user message, sends the last 8 messages plus `siteContext` (`buildChat.ts:67-89`) to the model and expects `{reply, pages[{name,goal}]}`. It stores the assistant message with suggestions. Nothing is materialized. |
| First generation | `buildChat.ts:239-396` (`generateSite`) | One model call (`maxTokens 6000`, `buildChat.ts:260-281`) returns the **whole site** as JSON: pages → sections → props. It ignores the plan-chat suggestions and the `buildPages` blueprint and replans from `build.idea` and `message`. |
| Materialize | `buildInternals.ts:152-237` (`ensureSiteWithPages`) | Creates the `sites` row (one per project) and an empty `cmsPages` row plus a v1 draft `pageRevisions` row for every planned path that does not exist yet. |
| Write drafts | `buildChat.ts:324-355` → `buildInternals.ts:240-285` (`saveDraftInternal`) | For each page: look it up by normalized path, build a `PageDocument` with random block ids, `validateDocument`, then **patch the draft revision in place**. A page that is not found or invalid is skipped with `continue`. |
| Version | `buildInternals.ts:73-108` + `288-330` | `collectSnapshot` JSON-serializes every page's current draft. `applyEditWithSnapshot` inserts a `buildVersions` row (whole-site snapshot, version N+1). |
| Chat edit | `buildChat.ts:400-544` (`editPage`) | Resolves one target page and sends a **200-character-truncated** summary of each block (`buildChat.ts:460-464`) inside the **system** prompt. It asks for the **full** new block list (`maxTokens 2400`), regenerates every block id, saves the draft in place, then snapshots. |
| Preview | `buildWorkspace.ts:20-69` (`getPreviewData`) → `PageRenderer.tsx` | A reactive query returns every page's latest draft document. The React renderer maps blocks to JSX. Rich text goes through `sanitizeHtml` at render (`PageRenderer.tsx:64-69`). |
| Restore | `buildWorkspace.ts:210-260` (`restoreVersion`) | Copies each snapshot page back into its draft (patched in place, or a new draft revision if the current one is not a draft). It does not remove pages created later. |
| "Publish" | `buildWorkspace.ts:283-453` (`publishSite`) | All-or-nothing validation. It inserts a `pageRevisions` row with `state:"published"`, sets `cmsPages.status:"published"` and `publishedRevisionId`, writes a `buildReleaseAudits` row (`phase:"release_prepared"`, route and redirect snapshot) and sets `builds.releaseState:"prepared"`. |
| Public serving | `cms.ts:185-230` + `lib/deliveryGate.ts` | Serves only from an audit with `phase:"verified"` and a `buildDeployments` row in state `succeeded`. **No code writes `buildDeployments`** (`schema.ts:820-850` comment, `buildWorkspace.ts:116-118`). Nothing is public today. The hosting decision is still proposed (`docs/decisions/2026-09-24-hosting-public-sites.md`). |
| App builds | `builds.ts:148-266`, `AppWorkspace.tsx` | Requirements form, review and staleness check only. BP-15 states it plainly: "current requirements workspace is not an executable app builder". |

**Model boundary.** Every call goes through `lib/modelGateway.ts:208-242`. The gateway resolves an operator-allow-listed model per project (`aiModels.ts:76-79`), makes an OpenRouter `chat/completions` call with **no `stream`, no `response_format`, no `tools`** (`modelGateway.ts:177-192`), and applies a 90 s timeout and an 8,000-token output cap. On validator failure it makes one repair attempt. It records an `aiRuns` row for every attempt, with token and cost usage.

**Budget.** `consumeAiQuota` (`guards.ts:1625-1655`) allows 30 requests per user per 10 minutes and counts requests, not cost.

---

## 2. Defects and risks

Severity: **S1** = data loss, security issue or truth violation that users will hit. **S2** = correctness or robustness problem that users will notice. **S3** = hygiene. Each item has a file:line reference and, where one applies, a repro sketch.

### 2.1 Correctness and data loss

| # | Sev | Finding | Evidence |
|---|---|---|---|
| C1 | **S1** | **Chat edits corrupt any block whose props exceed 200 characters.** The model sees `JSON.stringify(b.props).slice(0, 200)` and is told to "Keep untouched blocks exactly as they were" and to return the FULL list. For richText HTML, FAQ lists and feature grids it cannot know the rest, so it truncates or invents content on **every** edit of the page, even edits aimed at another block. | `buildChat.ts:460-464`, `:479` |
| C2 | **S1** | **Prompt and validator contradict each other, so pages are silently dropped.** The prompt offers `image: alt, caption` and `productGrid: collectionId (omit)` (`buildChat.ts:230,237`). The registry makes `image.assetId` and `productGrid.collectionId` **required** (`src/lib/cms/blocks.ts:69,179-183`). Any AI page containing either block fails `validateDocument` and is skipped with `continue` (`buildChat.ts:347-348`). In `editPage` it throws inside `saveDraftInternal` after the quota and model call have been spent. The pre-check `validateGeneratedSitePlan` passes when **any one** page is valid (`buildChat.ts:104-116`), so the repair turn does not fire. | as cited |
| C3 | **S1** | **Nested or trailing-slash paths lose their content.** `generateSite.normPath` keeps `/` (`buildChat.ts:300-310`), while `ensureSiteWithPages.norm` turns `/` into `-` (`buildInternals.ts:171-177, 204-206`). A planned `/services/web-design` is created as `/services-web-design`, the lookup at `buildChat.ts:327-331` returns null, and the page stays **empty**. The same happens to `/about/`. | as cited |
| C4 | **S1** | **Empty pages then block "publish".** Pages from C2 and C3 exist with empty drafts. `publishSite` is all-or-nothing and rejects empty drafts (`buildWorkspace.ts:325-327`), so the user's first release fails with no chat-level explanation. The success message still claims the planned pages as changed: `changedPaths` lists **planned**, not written, pages (`buildChat.ts:387`). | as cited |
| C5 | **S1** | **Manual edits are lost with no undo.** `saveDraftInternal` patches the draft revision in place (`buildInternals.ts:264-265`), as does `cms.saveDraft` (`cms.ts:517-521`), so drafts have no history. `buildVersions` snapshots are taken only **after** AI operations (`buildChat.ts:359-378`, `:505-529`). Editor changes made between two AI operations are overwritten by the next AI edit or restore and are recoverable nowhere. The header comment says "every request snapshots a version first" (`buildChat.ts:22-23`). The code does the opposite. | as cited |
| C6 | S2 | **`publishSite` writes duplicate revision numbers and never supersedes.** `nextVersion = latest?.version ?? 0` has no `+ 1` (`buildWorkspace.ts:360-367`), so the new published row repeats the draft's version number. It also never marks the prior published revision `superseded` (contrast `cms.publishPage`, `cms.ts:632-634`), which breaks WEBSITE-ARCHITECTURE rule 7. The doc comment says "promotes drafts to the approved revision state", but the code writes `state:"published"`. | as cited |
| C7 | S2 | **Block identity is not stable.** Every edit regenerates every block id with `Math.random` (`buildChat.ts:341,497`). That breaks WEBSITE-ARCHITECTURE rule 5 ("stable ids"), makes editor selection jump after an AI edit, and rules out block-level diffs, comments and analytics. | as cited |
| C8 | S2 | **One site per project, many builds per project.** `sites` is resolved `by_project` everywhere. Two website builds (or an **app** build, see S4) edit the same site, and each keeps its own `buildVersions`. Restoring build A's version overwrites build B's work. `getSiteDelivery` picks the first website build (`buildWorkspace.ts:96-103`). | as cited |
| C9 | S2 | **Regeneration leaves stale pages.** Re-running `generateSite` on an existing site keeps pages that are not in the new plan and overwrites drafts of matching paths without confirmation (`buildInternals.ts:203-207`). | as cited |
| C10 | S2 | **Validation is shallow.** `validateBlock` skips list fields entirely (`blocks.ts:212`), accepts unknown prop keys, has no length limits and does not check URL schemes on `ctaHref` or `buttonHref`. `PageRenderer` renders `it?.title` directly (`PageRenderer.tsx:120-127`). An AI list item whose `title` is an object therefore crashes the preview ("Objects are not valid as a React child"). | as cited |
| C11 | S2 | **`editPage` sees less context than `generateSite`.** No `siteContext`, no chat history and no other pages, so the business brief, personas and products are missing from edits (`buildChat.ts:466-485`). | as cited |
| C12 | S3 | **`buildVersions` snapshots the whole site as JSON strings on every edit.** Storage grows with pages × edits. A large site nears Convex's 1 MiB document limit, and nothing prunes or compacts old versions. `schema.ts:898-918` still describes `draft` as "the page HTML draft". | as cited |
| C13 | S3 | `builds.remove` deletes only `buildPages` (`builds.ts:499-511`). It leaves `buildMessages`, `buildVersions` and `buildReleaseAudits` orphaned. The project-level cascade covers them; build-level deletion does not (AGENTS.md rule 12). | as cited |
| C14 | S3 | `schemaValidation: false` (`schema.ts:1849`) means none of the table validators above are enforced at write time. Correctness rests entirely on function argument validators, and `props: v.any()` accepts anything. | as cited |

### 2.2 Security

| # | Sev | Finding | Evidence |
|---|---|---|---|
| S1 | **S1** | **AI rich text is not sanitized on save.** `sanitizeDocument` runs only in `cms.saveDraft` (`cms.ts:511`). `saveDraftInternal` (`buildInternals.ts:255-257`), `restoreVersion` (`buildWorkspace.ts:221-228`) and `publishSite` store AI HTML as generated, which breaks the T0.7 "sanitize-on-save" rule that `blocks.ts:229-239` itself describes. Render-time sanitization protects the dashboard today. The future public renderer and exports (BP-13) would inherit unsanitized rows. | as cited |
| S2 | S2 | **Link injection path.** Prompt injection in scraped text can reach generated sites. `siteContext` puts `pack.businessBrief` into the prompt under a heading that tells the model to "ground everything in this" (`buildChat.ts:82-88`). The brief can come from an **AI-drafted, unconfirmed** profile derived from a website scan (`businessProfile.ts:139-171`). Page props from earlier generations are inserted into the **system** role in `editPage` (`buildChat.ts:467-471`). No tools are exposed, so the blast radius is content: injected text, and external links in `ctaHref`, `buttonHref` and richText `<a>` that are not scheme- or domain-checked (see C10). Today CTAs render as `<span>` (`PageRenderer.tsx:56-60,110-112`), so this becomes live only when a real renderer emits `<a>`. Fix it before BP-13. | as cited |
| S3 | S2 | **The Build capability check is missing on two AI actions.** `generateBuildPlan` and `generatePageDraft` are plain `action`s (`buildPlan.ts:171,314`). `loadContextPack` checks project **access** (`guards.ts:1531`) but not the `build` module capability. A tenant without the Build add-on can spend AI budget through them. `buildChat.*` uses `moduleAction("build")` correctly. | as cited |
| S4 | S2 | **`kind` is not enforced on the server.** `planSite`, `generateSite` and `editPage` never check `build.kind === "website"`. The app/website split is enforced only in the UI (`Build.tsx:723`), so an app build id can generate and overwrite the project's CMS site. | `buildChat.ts:148-544` |
| S5 | S3 | **Client-writable HTML store.** `buildPages.update` accepts any `draft` string and `status: "approved"` from the client (`buildPages.ts:50-72`). The only renderer sanitizes today (`Build.tsx:662`), but the field is untrusted HTML labelled "AI-generated". | as cited |
| S6 | ok | **Checked and fine:** ownership (`requireOwnedBuild` plus org-scoped `projectAccessForAction`, `buildChat.ts:119-144`); the cross-project page id guard in `editPage` (`buildChat.ts:415-422`, regression-tested in `tests/unit/audit-2026-09-24-regressions.test.ts:81`); context loaded server-side; the client cannot choose the model. SSRF does not apply to Build: no build function fetches a URL, and scans live in `lib/websiteScan.ts` behind `safeFetch`. | — |

### 2.3 Truth (AGENTS.md rule 5)

| # | Sev | Finding |
|---|---|---|
| T1 | S2 | **Client-callable mutations write `published`.** `publishSite` (`buildWorkspace.ts:368-382`) and `cms.publishPage` (`cms.ts:636-648`) both write `pageRevisions.state:"published"` and `cmsPages.status:"published"`. Public serving is correctly gated on a deployment receipt, so nothing false reaches visitors. The **label** is still the forbidden word, written with no receipt, and the dashboard shows it: `SitePanel.tsx:169` renders `<StatusBadge status={p.status}>`, which shows "published" for a page that is only in a prepared release. The same list also shows "unpublished draft changes" permanently, because the draft pointer is never cleared (`SitePanel.tsx:156`). Rename the page-level state to `approved` or `release_prepared` (an owner decision on vocabulary, see §4). |
| T2 | S3 | The success copy "The preview on the right is **live**" (`buildChat.ts:380`) and the toast "The preview is live" (`BuildWorkspace.tsx:94`) use "live" for a draft preview. They should say "updated". |
| T3 | ok | Checked and fine: `builds.update` cannot write `published` (`builds.ts:31-34`); the delivery views are derived on the server (`buildWorkspace.ts:84-164`, `builds.ts:342-497`); legacy rows show as `requires_verification`. |

### 2.4 Jobs, idempotency, streaming and recovery

| # | Sev | Finding |
|---|---|---|
| J1 | **S1** | **Long work runs inside a public action, not a job** (AGENTS.md rule 13). `generateSite` runs one generation of up to 6,000 tokens, plus a possible repair turn (up to about 180 s), plus N×3 sequential mutations and queries, while the browser awaits one promise (`BuildWorkspace.tsx:88-103`). A closed tab, network blip or timeout leaves a **partial site** (C4) with no status row. The repo already has the job pattern (`google/sync.ts:226` queue-and-schedule, `modules/privacy/*Jobs.ts`). |
| J2 | S2 | **No idempotency.** Double-submit, retry or a second tab starts two generations. Both spend quota and both write drafts; the last writer wins and two versions are created. `buildReleaseAudits.operationKey` exists in the schema (`schema.ts:811`), but `publishSite` never sets it. |
| J3 | S2 | **No streaming.** `modelGateway.ts:185-190` sends no `stream: true`. The user watches a spinner for 30–120 s on the surface billed as "describe it · watch it build" (`BuildWorkspace.tsx:109`). Every competitor streams. |
| J4 | S2 | **No structured-output enforcement.** JSON is extracted with a regex between the first `{` and the last `}` (`buildChat.ts:91-98`). The 6,000-token site plan is the most likely to be truncated. OpenRouter supports `response_format: {type:"json_schema", strict:true}` and a `response-healing` plugin for non-streaming requests ([docs](https://openrouter.ai/docs/guides/features/structured-outputs)). Neither is used. The gateway does not read `finish_reason`, so it cannot tell "truncated" from "wrong". |
| J5 | S2 | **Failures are not recoverable per page.** One generation writes all pages. A failure means regenerating everything and paying again. There is no "retry page X". |
| J6 | S3 | Quota is consumed **before** the call and never refunded on provider failure (`buildChat.ts:154,245,424`). This is defensible for abuse control, but it should be explicit. |

### 2.5 Cost and budget

| # | Sev | Finding |
|---|---|---|
| B1 | S2 | **The budget counts requests, not cost.** A 6,000-token site generation on a premium allow-listed model costs the same one unit as a 200-token edit (`guards.ts:1619-1655`). There is no per-organization or per-plan monthly limit. `aiRuns` records `costMicrousd` (OpenRouter now returns `usage.cost` on every response, [docs](https://openrouter.ai/docs/guides/guides/administration/usage-accounting)), but nothing reads it back to enforce a budget. The per-plan AI budget is an **open owner decision** (`docs/decisions/2026-09-24-in-product-ai-agent.md`, decision 3). |
| B2 | S3 | `contextSources` for `buildChat` are fixed strings (`["build.context","request.context"]`, `buildChat.ts:47`). `buildPlan` sends real `ref@version` evidence ids (`buildPlan.ts:115-117`). As a result, Build chat runs are not traceable to the context versions they used (BP-09). |

### 2.6 Versioning and rollback

- The good part: `buildVersions` is a Lovable-style whole-site timeline, and restore validates each document (`buildWorkspace.ts:227-228`).
- Gaps:
  - C5: nothing is captured before an AI operation, and manual edits are never captured.
  - Restore is not itself undoable except through the next snapshot.
  - Restore does not remove pages added after the version, or recreate pages deleted since (`buildWorkspace.ts:219-220` skips them).
  - Versions have no diff view and no per-page restore.
  - Rollback of a **public release** cannot exist until BP-13 writes deployments.

### 2.7 Tests and evaluation

- Build truth is well tested (`tests/unit/publish-truth.test.ts`, about 20 cases). Cross-tenant access is tested (`cross-tenant.generated.test.ts`).
- **No test** covers generation correctness: C1–C4 and C7 would each have been caught by one `convex-test` case with a stubbed gateway.
- **No evaluation harness** exists for generation quality. The pack's AI evaluation floors live in the missing `07-ai-agent-config.md`.

---

## 3. Comparison with leading builders (verified 24 Sep 2026)

Sources were read where the egress proxy allowed. `openrouter.ai` and `dyad.sh` were blocked, so those facts come from search summaries and are cited as such.

| Practice | Who does it (source) | MOSAI today | Fits MOSAI's block model? |
|---|---|---|---|
| **Structured artifact protocol parsed incrementally from the stream** | bolt.diy parses `<boltArtifact>`/`<boltAction type="file\|shell\|start\|supabase">` with a resumable parser that keeps state across chunks ([message-parser.ts](https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/runtime/message-parser.ts)). Dyad uses `<dyad-write>`-style tags ([repo](https://github.com/dyad-sh/dyad)). | ❌ One JSON blob, regex-extracted after completion. | **Yes, strongly.** Emit **one block per line (NDJSON)** or `<block>` tags. Validate and persist each block as it arrives, so the preview fills in block by block. This is the single biggest UX gain and it needs no sandbox. |
| **Streaming UI** | All of them. Vercel AI SDK `streamText` / `Output.object()` partial streams (AI SDK 6 deprecates `streamObject` in favour of `output` on the text functions: [AI SDK 6](https://vercel.com/blog/ai-sdk-6)). Convex's own pattern: persist deltas and let clients subscribe ([persistent-text-streaming](https://github.com/get-convex/persistent-text-streaming), [Convex agents streaming](https://docs.convex.dev/agents/streaming)). | ❌ | **Yes.** In Convex no new dependency is needed: the job action writes blocks and progress rows, and the existing reactive `getPreviewData` query *is* the stream. |
| **Schema-constrained output** | OpenRouter `response_format: json_schema, strict` plus the `response-healing` plugin ([docs](https://openrouter.ai/docs/guides/features/structured-outputs)). AI SDK `Output.object` with Zod. | ❌ Hand-written validators and one repair turn. | **Yes.** Generate a JSON Schema from `BLOCK_REGISTRY` (one source of truth). This fixes C2 by construction. Fall back to validator plus repair for models without strict support. |
| **Targeted edits instead of full rewrites** | Aider's benchmarks: unified diffs made GPT-4 Turbo "3X less lazy" (score 20%→61%) against search/replace; whole-file rewrites score lower on newer models ([aider unified diffs](https://aider.chat/docs/unified-diffs.html), [edit formats](https://aider.chat/docs/more/edit-formats.html)). open-lovable supports "surgical" edits ([repo](https://github.com/firecrawl/open-lovable)). Lovable's agent reads files on demand and edits across files ([Lovable agent mode](https://lovable.dev/blog/agent-mode-beta)). | ❌ Full-page rewrite from a truncated view (C1). | **Yes. This is the model's natural fit.** Blocks are already addressable. Use typed operations, `update_block(id, patch)`, `insert_block(after_id, block)`, `move_block`, `delete_block`, as JSON Patch against **stable ids**. Untouched blocks cannot be corrupted because the model never re-emits them. Puck's JSON-tree model makes the same case ("diffs are meaningful, AI output is always schema-valid"; [Puck AI](https://puckeditor.com/blog/puck-ai)). |
| **Plan-then-act agent loop with tool calls** | Codebuff: file-picker → planner → editor → reviewer agents ([summary](https://amplifying.ai/coding-agents/codebuff); [freebuff repo](https://github.com/CodebuffAI/freebuff)). OpenHands SDK: agent + tools + workspace, with context "condensers" that report up to 2× lower cost ([arXiv 2511.03690](https://arxiv.org/pdf/2511.03690)). AI SDK tool calling with `stopWhen` ([docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)). | 🟡 Plan mode exists (`planSite`) but is discarded by `generateSite`. There are three disconnected "plans": plan chat, `generateBuildPlan` and `buildPages`. | **Yes, in its light form.** Two stages: (1) an **outline** (pages → section types and intents, cheap and user-approvable); (2) **per-page content** generation in parallel, each a small call. Tool calling for *edits* (the operations above) fits the proposed "option C" copilot. No shell tools, ever. |
| **Autofix / post-processing pipeline** | v0's composite model: RAG + frontier LLM + a streaming "LLM Suspense" layer and deterministic plus fine-tuned autofixers. Vercel reports LLM code errors "as often as 10% of the time" ([how we made v0 an effective coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent), [composite model family](https://vercel.com/blog/v0-composite-model-family)). | 🟡 A validator plus one repair turn for the whole payload. | **Yes, cheaply.** Add deterministic fixers per block before validation: drop unknown props, coerce list items to strings, strip `assetId`-required image blocks into a placeholder `needs_setup` state, normalize and whitelist hrefs to site paths. Most C2 and C10 failures disappear with no model call. |
| **Component registry** | v0 and shadcn: the model composes from a known component set. | ✅ `BLOCK_REGISTRY` (11 blocks) is exactly this, and a moat for SEO, editability and safety. | **Yes.** It is too thin for competitive output: no testimonial, pricing, logo cloud, gallery, team, contact/form, map, hours or comparison blocks, and no variants or layout props. Growing the registry (with the theme tokens in `sites.theme`) is where visual quality comes from. |
| **Sandboxed code execution** | bolt.diy on WebContainers, which needs a StackBlitz commercial licence in production ([repo README](https://github.com/stackblitz-labs/bolt.diy)). open-lovable on Vercel Sandbox or E2B. E2B runs Firecracker microVMs, Hobby free with $100 credit, Pro $150/mo, about $0.05/vCPU-hour ([e2b.dev](https://e2b.dev/), [comparison](https://vercel.com/kb/guide/vercel-sandbox-vs-e2b)). OpenHands uses Docker/remote workspaces. | ❌ No code is generated. | **Not for websites.** Blocks render in MOSAI's own renderer, so no sandbox is needed. **Only for BP-15 apps**, and that needs an owner decision on provider and cost (O5). Caffeine's model deserves note for apps: Motoko orthogonal persistence makes an upgrade that would lose data **fail** ([VentureBeat](https://venturebeat.com/ai/dfinity-launches-caffeine-an-ai-platform-that-builds-production-apps-from)). This is the "safe migrations" property BP-15 should demand from whatever backend it picks. |
| **Git-style versioning / checkpoints** | Dyad on git ([repo](https://github.com/dyad-sh/dyad)); bolt.diy diff view and revert. | 🟡 Whole-site JSON snapshots, taken after AI operations only. | **Yes.** Checkpoint **before** each AI operation, store per-page revision ids rather than JSON copies (revisions are already immutable rows if drafts stop being patched in place), and show a block-level diff. |
| **Clone from URL (scrape → site)** | open-lovable: Firecrawl scrape → React app ([repo](https://github.com/firecrawl/open-lovable)). | 🟡 Website scan feeds the business brief, not the layout. | **Partly.** Using an existing site's *facts* is on-model. Copying its *layout* is legal and brand risk and should not be the default. Scraped text must stay labelled untrusted evidence (S2). |
| **Evaluation harness** | v0 trains autofixers on production generations. Aider publishes edit benchmarks. | ❌ | **Yes.** Keep a fixed set of 20–30 business profiles. Deterministic metrics: validity rate, pages written/planned, empty-page rate, prop preservation across unrelated edits (C1), invented statistics or prices (grounding), tokens/cost/latency per site. Add an optional LLM judge for "specific vs generic". Run in CI with a recorded-response stub, and nightly against real models. |
| **Visual/direct edits sharing one source of truth with chat** | Lovable Visual Edits ([blog](https://lovable.dev/blog/introducing-visual-edits)). | ✅ The block editor and chat edit the same `PageDocument`. | Already on-model. The gap is C5 (edits are unversioned) and C7 (ids churn under chat edits). |

**Freebuff (Codebuff free tier)** is a terminal coding agent, not a site builder. The lesson worth taking from it is architectural (specialized sub-agents, model-agnostic through OpenRouter), not a product surface to match.

---

## 4. Recommendations

Effort: S ≤ 1 day, M = 2–4 days, L = 1–2 weeks. "Ticket" means the item can ship alone as one branch and one PR under AGENTS.md.

### P0: stop data loss and silent failure (do first, all small)

| # | Change | Files | Why | Effort | Ticket |
|---|---|---|---|---|---|
| P0-1 | Send full block props (bounded by page, not by block) to `editPage`. Better still, jump straight to P1-2. Put the current document in the **user** message as JSON data, not in the system prompt. Add a regression test: an edit to block 1 preserves block 3's 1,000-character `html` byte for byte (stubbed gateway). | `buildChat.ts:460-485`, `tests/unit/build-generation.test.ts` (new) | C1, S2 | S | ✅ |
| P0-2 | Generate the per-block prop spec from `BLOCK_REGISTRY` instead of the hand-written `SITE_GEN_PROPS`. Remove `image` and `productGrid` from AI output, or allow them as placeholder states that the validator accepts in drafts and publish-checks block. Make `validateGeneratedSitePlan` require **every** page to be valid, so the repair turn fires. | `buildChat.ts:100-117,227-237`, `src/lib/cms/blocks.ts` | C2 | S | ✅ |
| P0-3 | Use **one** path normalizer shared by `generateSite` and `ensureSiteWithPages`. Have `ensureSiteWithPages` return a `{plannedPath → pageId}` map instead of re-looking up by path. Report `changedPaths` from pages actually written. On any skipped page, surface a per-page reason in the reply and do not leave it empty. | `buildChat.ts:300-357,387`, `buildInternals.ts:152-237` | C3, C4 | S | ✅ |
| P0-4 | Run `sanitizeDocument` in `saveDraftInternal`, `restoreVersion` and `publishSite` (promote path). Add a test that stores `<img onerror>` through `generateSite` and reads back clean HTML. | `buildInternals.ts:255`, `buildWorkspace.ts:221-228,337` | S1 (T0.7 remainder) | S | ✅ |
| P0-5 | Before every AI write (`generateSite`, `editPage`, `restoreVersion`), take a **pre-operation checkpoint** (`buildVersions` row labelled "Before: …"), so manual edits are always recoverable. | `buildChat.ts`, `buildWorkspace.ts`, `buildInternals.ts` | C5 | S | ✅ |
| P0-6 | Server-side guards: `build.kind === "website"` in all three `buildChat` actions, and `moduleAction("build")` (or `requireActionCapability`) on `generateBuildPlan` and `generatePageDraft`. Extend `tests/unit/entitlements.test.ts`. | `buildChat.ts`, `buildPlan.ts:171,314` | S3, S4 | S | ✅ |
| P0-7 | Fix `publishSite`: `+ 1` on the version, and supersede the prior published revision (mirror `cms.ts:632-634`). Correct the comment. Regression test for duplicate versions. | `buildWorkspace.ts:360-382` | C6 | S | ✅ |

### P1: make it competitive (UX parity with streaming builders, same truth guarantees)

| # | Change | Files | Why | Effort | Ticket |
|---|---|---|---|---|---|
| P1-1 | **Site generation as a job with progress.** A public mutation `startSiteGeneration(buildId, message, operationKey)` inserts a `buildJobs` row (states per AGENTS.md rule 13) and schedules an internal action. It returns the existing job for a duplicate `operationKey`. Stage 1: outline (pages → section intents), persisted and shown. Stage 2: one call per page, each written as it completes. Progress fields update reactively, and per-page failure gives `partially_succeeded` with "retry page". Register the new table (rule 12). Reuse the claim and lease pattern from `google/sync.ts` rather than inventing one. If BP-07's shared jobs module lands first, use it. | new `src/convex/buildJobs.ts`, `schema.ts`, `BuildWorkspace.tsx`, `lib/dataRegistry.ts` | J1, J2, J5, C4; also faster (parallel pages) | M–L | ✅ (depends on BP-07 if that is the owner's order) |
| P1-2 | **Typed block operations instead of full-page rewrites.** The model returns `ops: [{op:"update", id, props}, {op:"insert", after, block}, {op:"move", id, after}, {op:"delete", id}]`. The server applies them to the current document, validates, and keeps ids stable. It can later serve as the tool schema for the option-C copilot. | `buildChat.ts:400-544`, `src/lib/cms/blocks.ts` (apply and validate ops) | C1, C7, cost (output tokens scale with the change, not the page) | M | ✅ |
| P1-3 | **Streaming.** Add `stream: true` to the gateway (SSE parse, `usage` taken from the final chunk) and emit blocks as NDJSON, persisting each valid block as it arrives. Clients already subscribe to `getPreviewData`, so the preview fills live with no new client transport. | `lib/modelGateway.ts`, the job action from P1-1 | J3 | M | ✅ (after P1-1) |
| P1-4 | **Schema-constrained output.** Build a JSON Schema from `BLOCK_REGISTRY` and send `response_format: json_schema, strict` when the resolved model supports it (store a capability flag on `aiModels`). Keep the validator and repair turn as a fallback. Read `finish_reason` and classify truncation as its own error. | `lib/modelGateway.ts`, `aiModels.ts`, `lib/aiModelCatalog.ts` | J4, C2 | S–M | ✅ |
| P1-5 | **Deterministic autofix before validation.** Drop unknown props; coerce list items; clamp lengths; allow `href` only for site-relative paths, `mailto:`, `tel:`, or `https:` on the project's own domains (anything else becomes a `needs_setup` link state); strip richText outside the allow-list. The same function feeds P0-4. | `src/lib/cms/blocks.ts` (new `normalizeBlock`) | C10, S2 | S | ✅ |
| P1-6 | **One plan, not three.** `generateSite` consumes the approved plan (plan-chat suggestions, or `buildPages` rows with persona and journey stage) when one exists. Retire `generatePageDraft`'s raw-HTML path, or convert its output into blocks. Delete `buildPages.draft` once migrated (additive first). | `buildChat.ts`, `buildPlan.ts`, `buildPages.ts`, `Build.tsx` | Duplicate pipelines; the "strategy-first" promise is not reaching generation | M | ✅ |
| P1-7 | **Cost budget in the gateway.** Pre-flight estimate (prompt characters + `maxOutputTokens` × model price from the catalog) against a per-organization monthly budget. Post-flight debit from `aiRuns.costMicrousd`. A job pauses to `waiting_for_user` when the budget is spent. Needs the owner decision below. | `lib/modelGateway.ts`, `guards.ts`, `aiModels.ts` | B1 | M | ✅ (after owner decision) |
| P1-8 | **Generation evaluation harness.** `tests/ai/build/` holds a fixed set of profiles, recorded responses for CI (deterministic metrics listed in §3) and a nightly live run that writes a report. Floors come from the missing `07-ai-agent-config.md`, or owner-set values. | new `tests/ai/build/*` | §2.7 | M | ✅ |
| P1-9 | **Grow the block registry** with testimonial, pricing, logoCloud, gallery, team, contact/form (BP-13 forms), hours/location and comparison, plus a `variant` prop on existing blocks tied to `sites.theme` tokens. Every addition needs registry, validator, renderer, editor and a11y support. | `src/lib/cms/blocks.ts`, `PageRenderer.tsx`, `PageEditor.tsx`, `CMS-BLOCK-REGISTRY.md` | Output quality is capped by 11 blocks | M per 3–4 blocks | ✅ (several) |

### P2: structure and hygiene

| # | Change | Files | Effort | Ticket |
|---|---|---|---|---|
| P2-1 | Put `siteId` on `builds` (or `buildId` on `sites`) so a website build owns exactly one site. Refuse a second website build per site, or support many sites (C8). Additive schema with a backfill migration. | `schema.ts`, `buildInternals.ts`, `buildWorkspace.ts` | M | ✅ |
| P2-2 | Versions reference immutable per-page revision ids instead of JSON copies. Stop patching drafts in place: create a revision per save, or coalesce autosaves within N minutes. Add version pruning and a block-level diff view. | `buildInternals.ts`, `cms.ts:495-545`, `buildWorkspace.ts` | M | ✅ |
| P2-3 | `builds.remove` cascades `buildMessages`, `buildVersions` and `buildReleaseAudits` through the data registry, not a hand list (rule 12). | `builds.ts:499-511` | S | ✅ |
| P2-4 | Give `editPage` the same `siteContext` and the last N chat turns as `generateSite`. Send real `ref@version` `contextSources`, as `buildPlan` does (B2). | `buildChat.ts` | S | ✅ |
| P2-5 | Copy fixes: replace "live" with "updated" in the preview messages (T2). | `buildChat.ts:380`, `BuildWorkspace.tsx:94` | S | ✅ |
| P2-6 | Turn `schemaValidation` back on (C14) after a data audit. This is a repo-wide change, not Build-only. | `schema.ts:1849` | M | ✅ (owner, see §7 of AGENTS.md: data migration) |
| P2-7 | Owner-gated: the BP-15 app builder. Do **not** grow it out of the block pipeline. It needs a source graph, a sandbox (E2B/Vercel Sandbox/Daytona; WebContainers needs a commercial licence) and a backend with safe-migration guarantees in the spirit of Caffeine's. Start with the ADR-3 sandbox spike. | new `modules/buildApp/*` | L+ | ✅ (several) |

### Decisions the owner must make (AGENTS.md §7)

1. **What "published" means at page level (T1).** Today a client mutation writes `cmsPages.status = "published"` and `pageRevisions.state = "published"` with no receipt, and the dashboard badge shows it.
   - Options: (a) rename both to `approved`/`release_prepared` and reserve `published` for the BP-13 verifier; (b) keep the stored value and change only the badge label.
   - **Recommendation: (a).** It is an additive migration: add the new literal, backfill, and keep the old literal readable as legacy. It removes the last "published" writer that holds no receipt.
2. **AI budget per plan (B1, P1-7).** Choose monthly cost or monthly tokens per organization, what happens at the limit (hard stop or `waiting_for_user`), and whether a site generation is priced as one "credit". This affects money and plan terms.
3. **Allowed link targets in generated sites (P1-5, S2).** Should AI-generated external links be allowed at all, or should only site-internal, `mailto:` and `tel:` links be allowed until the owner approves a domain allow-list?
4. **One site per project, or one per build (P2-1).** This changes what a customer sees as "my website".
5. **App builder host and portability (P2-7, BP-15 O5).** Sandbox provider, cost and where customer backends live.
6. **The missing `07`/`08` pack documents.** Supply them, or set the AI evaluation floors for P1-8 directly.

---

## 5. What is good and must be kept

- The receipt-gated public delivery path (`lib/deliveryGate.ts`, `cms.getPublishedByPath`) and all-or-nothing release preparation, with thorough tests (`tests/unit/publish-truth.test.ts`).
- Blocks-not-HTML as the storage contract, commerce blocks that store ids only (`blocks.ts:218-226`), and one renderer contract shared by preview and future public serving.
- Server-side context loading with evidence trust labels (`lib/contextPack.ts`), model selection by operator allow-list only, and per-attempt `aiRuns` metering with no prompt or output retention (`modelGateway.ts:203-207`).
- Org-scoped ownership checks and the regression-tested cross-project page guard in `editPage`.
