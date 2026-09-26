# Platform decisions research (D1, D7, D10, D9): 2026-09-25

## D1: per-starter-kit AI budget ($0.40)

**Facts (repo).**
- Budget constant: `STARTER_KIT_BUDGET_MICROUSD = 400_000` (= $0.40) at
  `main/src/shared/starterKitJob.ts:21`. Unknown-call fallback cost
  `STARTER_KIT_UNKNOWN_CALL_MICROUSD = 50_000` ($0.05) at line 25.
- The kit runs three LLM-backed parts in order (`PART_ORDER` in
  `main/src/convex/starterKit.ts:71`): `plan` (Create), `site` (Build),
  `posts` (Promote, 7 drafts across facebook/instagram/linkedin/x -
  `STARTER_KIT_POST_COUNT`/`STARTER_KIT_POST_CHANNELS`,
  `starterKitJob.ts:40-42`). `STARTER_KIT_STEPS` also names a `pictures`
  step, but that is a Pexels stock-photo search
  (`stock.ts`/`lib/pexels.ts`), not a model call: so budget covers 3 model
  calls, not 5.
- The model used is **not hard-coded**: `starterKit.ts` calls `modelComplete`
  from `lib/modelGateway.ts`, which resolves the model server-side from the
  `aiModels` admin allow-list (`aiModels.ts:1-30`; "the platform admin picks
  which OpenRouter models may be used and which is the default; each project
  can choose one of the enabled models"). `FALLBACK_MODEL_ID =
  "openai/gpt-4o-mini"` (`lib/aiModelCatalog.ts:11`) is only the
  fresh-deployment default before an admin configures anything.
- `lib/aiModelCatalog.ts` reads OpenRouter's `GET /api/v1/models` catalog
  live and stores `promptUsdPerMillion`/`completionUsdPerMillion` per model,
  so actual per-call cost is priced from OpenRouter's real numbers, not a
  guess baked into the code.

**Facts (external, OpenRouter pricing, fetched 2026-09-25; direct
openrouter.ai fetch was blocked by egress proxy, so these are via search
snippets: verify on openrouter.ai/openai/gpt-4o-mini before relying on
exact figures).**
- `openai/gpt-4o-mini`: ~$0.15 / M input tokens, ~$0.60 / M output tokens,
  128K context. [OpenRouter GPT-4o-mini pricing](https://openrouter.ai/openai/gpt-4o-mini)
  (unverified beyond search snippet: EGRESS_BLOCKED on direct fetch).
- Sibling/likely alt-default models such as `openai/gpt-4.1-mini` and
  Anthropic's Haiku tier exist on OpenRouter at similar or somewhat higher
  per-token rates (not independently priced here; flagged for the owner to
  confirm current numbers against the live admin catalog rather than this
  doc, since prices move and the repo already fetches them live).

**Estimate at gpt-4o-mini pricing.** A starter-kit "plan" + "site" + 7
"posts" job is short-form marketing copy: rough order of magnitude
2,000-6,000 input tokens (business context + prior parts as context) and
1,500-4,000 output tokens per part, x3 parts. At $0.15/$0.60 per M:
- Low estimate (2K in / 1.5K out per part x3): ~$0.0036 input + ~$0.0027
  output ≈ **$0.006 total**: budget headroom ~65x.
- High estimate (6K in / 4K out per part x3, generous context re-sent each
  part): ~$0.0081 + ~$0.0072 ≈ **$0.015 total**: budget headroom ~26x.
- Even at 10x those output volumes (e.g. verbose 7-post batch as one huge
  call) the job stays under $0.10, well inside $0.40.

At gpt-4o-mini-class pricing, $0.40 is generous, not tight. The number only
gets binding if the admin's *default* model is a frontier-tier model
(GPT-4o full, Claude Sonnet, etc.) at 10-20x gpt-4o-mini's per-token price,
or if the kit is retried multiple times per project (each retry re-runs the
failed/queued parts, consuming budget again per `resetPartsForRetry`).

**Options.**
1. **Lower the budget** (e.g. to $0.15-$0.20). Pro: tighter cost control,
   forces admins toward cheap default models. Con: no real savings if
   mini-tier models are already the default (headroom was never used);
   risks failing kits for admins who pick a pricier default model, showing
   `budgetFailure()`/`needs_setup` on a normal first run: a bad first
   impression for a flagship onboarding flow.
2. **Keep $0.40** (recommended). It already comfortably covers mini-tier
   models with wide margin, and margin protects against retries and an
   admin choosing a pricier catalog model without the flow breaking. The
   real lever if cost becomes a problem is the *admin's* model choice, not
   this ceiling.
3. **Raise the budget** (e.g. $0.75-$1.00) only if the owner wants the
   *default* admin-chosen model to be a frontier tier (better copy quality)
   rather than gpt-4o-mini-class. Con: no cost benefit unless that model
   choice actually happens; makes runaway retries costlier.
4. **Per-plan budgets** (different ceiling for Free vs paid tiers). Pro:
   lets Free-tier stay cheap while paid tiers afford a better default
   model. Con: adds a second admin-configurable number to maintain
   alongside the per-model allow-list already in `aiModels.ts`; the
   allow-list is already the plan-shaping lever (which models a plan may
   use), so a second budget axis is possibly redundant: needs an owner
   call on whether plan-gating happens via model choice or via dollar
   ceiling.

**Recommendation:** keep $0.40 as-is; it is not the binding constraint for
mini-tier models. Ask the owner only which *model tier* the default admin
catalog entry should be (that decision drives real cost, not this budget
number), and confirm current OpenRouter prices for whatever model gets
picked before shipping (direct fetch was blocked in this session).

---

## D7: Convex Workflow component (`@convex-dev/workflow`)

**Facts.**
- Not currently a repo dependency: `grep -rn "@convex-dev/workflow"
  package.json` found nothing in `main`. The repo's long-running-work
  pattern today is a plain state-machine job table, e.g.
  `main/src/shared/starterKitJob.ts` (388 lines: per-part status reducer,
  retry logic, budget/failure typing) driving `internalAction`s in
  `starterKit.ts`, and `main/src/convex/modules/privacy/deletionJobs.ts`
  for cascade deletes: both hand-rolled `queued/running/.../succeeded/
  failed` state on a Convex table, matching AGENTS.md rule 13's job-state
  contract directly rather than through a library.
- Latest npm version at research time: **0.4.6** (per web search of the
  npm registry, published ~9 days before 2026-09-25). 0.x semver: pre-1.0,
  so breaking changes between minor versions are possible by convention.
  [npm: @convex-dev/workflow](https://www.npmjs.com/package/@convex-dev/workflow?activeTab=readme),
  [Convex Components: Workflow](https://www.convex.dev/components/workflow)
- Advertised features (search snippets from Convex's own docs/README):
  durable execution across server restarts, automatic retries with
  exponential backoff + jitter (default retry policy settable on the
  `WorkflowManager` or per-workflow), workflows can pause indefinitely for
  async events without consuming resources, parallel steps via
  `Promise.all()` of multiple `step.runAction()` calls, and workflows can
  be canceled and **restarted from an arbitrary step** to recover from
  third-party outages. [get-convex/workflow on GitHub](https://github.com/get-convex/workflow)
- Direct pricing/API-doc fetch of convex.dev/npmjs.com pages was not done
  (relied on search snippets); the version/maturity claims above should be
  re-verified against the actual README before adoption, since this was a
  low-effort pass.

**vs. the repo's existing job-table pattern.**
- The existing pattern already gets per-part retry, resumability
  (`resetPartsForRetry`, "Try again" resumes only unfinished parts), and
  status reduction: hand-written and fully owned/auditable in
  `starterKitJob.ts`, with no new dependency, no 0.x-versioning risk, and
  already tested by the repo's existing suite conventions.
- Workflow component would add: parallel step orchestration without
  hand-writing `Promise.all` bookkeeping, restart-from-arbitrary-step
  (the job table only resumes at the granularity the code chose, i.e.
  whole parts), and a maintained retry/backoff policy instead of
  hand-rolled retry logic: useful if jobs grow more steps or need
  cross-job orchestration (e.g. chaining starter-kit -> first publish ->
  first campaign).

**Options.**
1. **Adopt `@convex-dev/workflow` for new/complex jobs only** (e.g. a
   future multi-step agency-transfer or multi-provider publish flow),
   leaving `starterKitJob.ts`/`deletionJobs.ts` as-is. Pro: low risk, tests
   the component on a smaller surface before wider adoption. Con: two job
   patterns coexist in the codebase, more to learn.
2. **Migrate the existing job-table pattern onto Workflow.** Pro: one
   pattern, gets restart-from-step and maintained retry/backoff for free.
   Con: nontrivial migration of `starterKitJob.ts`'s already-tested status
   reducer; 0.x package means committing to tracking upstream breaking
   changes; AGENTS.md rule 8 forbids adding a framework not named in an
   accepted ADR, so this needs an ADR first regardless.
3. **Do not adopt; keep the hand-rolled pattern.** Pro: zero new
   dependency risk, matches AGENTS.md's existing job-state contract
   exactly, no 0.x breaking-change exposure. Con: the team re-implements
   retry/backoff/parallelism primitives by hand for every new long job.

**Recommendation:** option 1 (pilot on one new job, not a migration) if a
qualifying multi-step job is on the roadmap; otherwise option 3 (no
adoption yet) given the component is still pre-1.0 and AGENTS.md requires
an ADR before adding any new framework. Re-verify the version/maturity
facts above with a direct README read before committing to either.

---

## D10: is `main` auto-deployed?

**Facts (repo, `main/.github/workflows/ci.yml`, `main/convex.json`).**
- `ci.yml` triggers on `push: branches: [main]` and `pull_request`, but its
  jobs are exclusively verification: `install`, `codegen` (drift check
  only: regenerates and diffs committed bindings, does not push a
  deployment), `typecheck`, `lint`, `unit`, `security-history`, `security`
  (secret scan, function/capability/data-registry audits, `bun audit`),
  `e2e`, `a11y`. **No job runs `convex deploy`, `bun run codegen` against a
  writer key that publishes, or any Vercel/Netlify/SST deploy step.** No
  `.github/workflows/*deploy*.yml` file exists; only `ci.yml` is present in
  `.github/workflows/`.
- The `codegen` job explicitly documents this gap: it needs
  `CONVEX_DEPLOY_KEY`/`CONVEX_DEPLOYMENT` secrets that the owner has not
  yet added ("TODO(T1.5, 2026-09-22): the owner must add the
  CONVEX_DEPLOY_KEY secret... `convex codegen` needs a reachable
  deployment"); until then it just warns and exits 0.
- `convex.json` only configures the functions directory and disables
  `aiFiles`: no deploy target info.
- No `sst.config.*`, `vercel.json`, or `netlify.toml` found in the repo
  root. `docs/pack/STATUS.md` references promotion of *test* status
  (`it.fails` -> green) and capability "promotion," not deployment
  promotion: no hosting/CD runbook was found under `docs/runbooks/` in
  this pass (only referenced: `docs/runbooks/secret-rotation.md`).
- Net: **push to `main` does not appear to auto-deploy anything today.**
  CI only gates merges; actual Convex function deployment and any frontend
  hosting deploy is either fully manual (developer runs `bunx convex
  deploy` or similar locally) or handled by a platform outside this repo
  that was not found in this pass (e.g. a hosting platform's own
  git-integration deploying on push, which would not show up as a
  workflow file: worth confirming with the owner directly since the repo
  mentions "the hosting platform re-runs codegen and `tsc -b --noEmit`
  after every agent turn" in AGENTS.md, implying some external CI/CD
  surface not visible in this checkout).

**Options.**
1. **Confirm manual-only today, and stay manual** with a documented promote
   runbook (who runs `convex deploy` to prod, from which branch/tag).
   Pro: matches current reality, lowest risk, no new secrets to manage
   right now. Con: relies on a human remembering to deploy; no audit trail
   of what's live.
2. **Add a gated auto-deploy job** to `ci.yml` (or a new workflow) that
   deploys to a Convex *preview* deployment on every PR and to *production*
   only after merge to `main` and only once `CONVEX_DEPLOY_KEY` exists,
   protected by a GitHub Environment requiring manual approval. Pro:
   standard "protected environment" pattern, keeps a human gate on
   production while automating preview deploys for review. Con: needs the
   owner to provision and store `CONVEX_DEPLOY_KEY` (a secret,
   AGENTS.md rule 1: must go through the platform's secret store, never
   pasted into the repo) and decide the approval workflow.
3. **Full auto-deploy on green `main`** (no manual gate). Pro: fastest
   feedback loop. Con: conflicts with AGENTS.md's "no fake success" /
   truth ethos being extended to deploys: a merge should not silently
   become "live" without a human decision point, especially pre-1.0 with
   billing/payment code in the repo; not recommended without an explicit
   owner sign-off.

**Recommendation:** confirm with the owner whether an external
platform-level deploy hook already exists outside this checkout (the
AGENTS.md line about "the hosting platform re-runs codegen... after every
agent turn" suggests one might). If not, option 1 now, option 2 once
`CONVEX_DEPLOY_KEY` is provisioned and the owner wants CD.

---

## D9: agency hand-off billing (comparable tools + repo's current support)

**Facts (repo).** `main/src/convex/organizations.ts` has agency/client
linking (`organizations.kind: "business" | "agency"` at line 176;
`agencyClientLinks` mutations `linkAgencyClient`/`unlinkAgencyClient`
around lines 492-558, gated by `agency.link`/`agency.unlink` roles, with an
explicit check that "an agency cannot [link a client] unless the caller
also administers the client organization"). `projects.ts` has a helper for
"the caller's own agency organization" (line ~118-134). **No
transfer-of-ownership or transfer-of-billing mutation exists**:
`grep -rn "transfer" organizations.ts billing.ts projects.ts` returned
nothing. Today an agency can *link* to a client org (shared
access/visibility) but there is no built-in path to hand a project's
billing and ownership fully over to the client, matching the pattern this
decision needs to define.

**Comparable-tool models (web research, 2026-09-25).**
1. **Webflow**: separates *client payments* from *ownership*: an agency
   can turn on "Client payments" so the client's card is billed for the
   Site plan/add-ons while the site **stays in the agency's Workspace**
   (no ownership change). Separately, on Freelancer/Agency Workspace
   plans, a full **site transfer** moves the paid plan, custom domain, etc.
   to the client's own Workspace with no downtime once the client accepts
   the transfer request; workspace-level ownership transfer is a distinct,
   support-mediated flow. [Webflow: Client payments](https://help.webflow.com/hc/en-us/articles/35335039878035-Client-payments),
   [Webflow: transfer a site with a paid plan to a client](https://help.webflow.com/hc/en-us/articles/39930381200019-Can-I-transfer-a-site-with-a-paid-Site-plan-to-my-client),
   [Webflow: transfer workspace owner](https://help.webflow.com/hc/en-us/articles/35441586018835-I-need-to-transfer-my-Workspace-to-someone-else)
2. **Wix Studio**: transfers happen at the *site* level from the agency
   dashboard: either add the client as a collaborator (agency keeps
   billing) or fully "Transfer site," which moves ownership; **payment
   info is never carried over**: the new owner must attach their own
   billing on acceptance. Workspace-to-workspace bulk transfer between
   different accounts is explicitly *not* supported (an open feature
   request). [Wix: handover your site to clients](https://www.wix.com/studio/academy/tutorials/how-to-handover-your-site-to-clients),
   [Wix Studio workspace transfer request](https://support.wix.com/en/article/wix-studio-request-transferring-workspaces-between-accounts)
3. **GoHighLevel (SaaS mode)**: agencies white-label and rebill client
   "sub-accounts." Ordinary client sub-accounts can be transferred between
   agencies, but a sub-account **actively in SaaS Mode cannot** be
   transferred directly: SaaS Mode must be turned off first, and there is
   **no built-in way to carry over existing subscription/payment
   history**; the documented workaround is the client re-entering payment
   details and re-subscribing from scratch. This is the closest analogue
   to "how messy hand-off billing gets without a clean transfer feature."
   [HighLevel: sub-account transfer](https://www.ghlscaleup.com/blog/how-to-transfer-ghl-sub-account),
   [HighLevel: SaaS mode](https://help.gohighlevel.com/support/solutions/folders/48000676654)
4. **HubSpot (partner-managed)** and **Framer** were not separately
   fetched in this low-effort pass (time-boxed); general industry pattern
   from the three above generalizes: (a) *billing delegation without
   ownership change* (Webflow client payments), (b) *full transfer with
   billing reset* (Wix, Webflow site transfer, GHL sub-account transfer),
   and (c) *no clean transfer path once a recurring billing mode is
   active* (GHL SaaS mode) as a cautionary case to avoid replicating.

**Options for MOSAI.**
1. **Billing delegation, no ownership change** (Webflow client-payments
   style): agency keeps the `agencyClientLinks` relationship and the
   project stays under the agency org; a separate payer (the client) is
   attached to the Stripe subscription/customer for that project. Pro:
   smallest change on top of existing `agencyClientLinks`; matches
   AGENTS.md's "money is server-verified receipts" rule cleanly since
   billing ownership is just "which customer id pays," not a data-owner
   change. Con: client never gets full account control unless a separate
   transfer step is built later.
2. **Full transfer with billing reset** (Wix/Webflow-site-transfer style):
   a new `transferProjectOwnership` mutation moves the project (and its
   Convex rows, per `dal.ts`'s cascade-delete-equivalent ownership move)
   from the agency org to the client org; the client must attach fresh
   payment details on acceptance, old subscription is canceled server-side
   with a receipt, new one created. Pro: clean break, matches how most
   competitors actually do it, avoids indefinite dual-billing complexity.
   Con: needs a new authorized mutation + Stripe-side subscription
   cancel/recreate flow with idempotency and receipts (AGENTS.md rules 5,
   6, 7): nontrivial, and needs explicit client acceptance UX (a pending
   "transfer request" state) to avoid a client silently losing service.
3. **Avoid the GHL failure mode**: whichever option is chosen, make sure
   an in-flight billing-delegation project (option 1) can still be fully
   transferred later (option 2) without forcing the client to lose history
   or re-enter everything from scratch: i.e. don't let "delegated
   billing" become a mode that blocks transfer, as GHL's SaaS Mode does.
4. **Defer**: keep `agencyClientLinks` as view/manage-only (current state)
   and explicitly scope hand-off billing as a later ticket, since no
   transfer mutation exists yet and no ticket currently asks for it.

**Recommendation:** ship option 1 first (billing delegation on the
existing `agencyClientLinks` relationship: smallest, safest, reuses
current data model) and design it so option 2 (full transfer) can be added
later without a rewrite; explicitly avoid the GHL anti-pattern (recurring
billing mode that blocks transfer). Option 4 only if hand-off billing is
not actually on the roadmap yet: confirm with the owner which ticket this
serves before building either.
