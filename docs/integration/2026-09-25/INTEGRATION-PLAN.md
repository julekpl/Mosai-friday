# MOSAI integration plan: open PRs #11-#22 and the four new blueprints

Supervising architect, 25 Sep 2026. Inputs: review-ux, review-ui, review-logic,
review-biz, four blueprints, trial merge in `integ/` (main 57479a7 + #21 + #19 +
#13 + #22: no conflicts, tsc clean, 1098/1098 unit, audit:functions pass, lint
0 errors). Claims below marked (verified) were re-read in `integ/`.

Blueprint short names: AGENT (future-proof agent), DISCOVERY (org discovery
onboarding), MEDIA (camera coach), MARKET (country/culture intelligence).

---

## 1. Verdict per PR and merge order

All open PRs target `main` directly (verified via GitHub API), so every stacked
PR's diff shows its ancestors. The stack is linear by content:
#11 -> #12 -> #14 -> #15 -> #16 -> #17 -> #18 -> #20 -> #21, with #19 off #17.

| PR | Scope | Verdict |
|---|---|---|
| #11 | Usability strategy, U0 quick wins | Merge as is (arrives via #21) |
| #12 | U2a `businessType`, `primaryGoal`, empty `starterKits` | Merge with follow-up FU-3 (goal field docs) |
| #14 | U2 three-question wizard | Merge with follow-up FU-5 (copy: "website or listing") |
| #15 | U3 starter-kit job | Merge as is; $0.40 kit budget stays an owner item (D1) |
| #16 | U5 Pexels backend, `safeFetchBytes` | Merge as is; needs `PEXELS_API_KEY` on deployment |
| #17 | U6 "This week" Home | Merge with follow-up HM-1 (Home IA) |
| #18 | U5b pictures in kit posts | Merge with follow-up (MD-0 makes pictures swappable) |
| #20 | U4 kit cards on Home | Merge with follow-up U4b + HM-1 |
| #21 | U9 agency first slice | Merge as is (authorization verified by review-logic) |
| #19 | U7 Since you were away | Merge with follow-up FU-2 (typography) and HM-1 |
| #13 | Create: source library, grounded drafts, selection edits | Merge after two small pre-merge fixes (section 2) |
| #22 | Docs: U12 script, backlog, STATUS | Merge last as is (it records #19 and #21 as code done) |
| #1 | Draft P0 foundation (codex) | Out of scope; stays draft, do not merge in this train |

**Stack handling: merge #21 once, with "Create a merge commit".** Do not squash
or rebase: a merge commit makes the head SHAs of #11, #12, #14-#18, #20
reachable from `main`, so GitHub marks those PRs merged automatically and
history keeps per-ticket commits for bisecting. One-by-one merging adds nine CI
runs and nine chances for someone to squash by mistake, with no extra safety,
because the full union is already verified. If any ancestor PR does not flip to
merged, close it with a link to the #21 merge commit.

Exact order:
1. #21 (merge commit). Carries #11, #12, #14, #15, #16, #17, #18, #20.
2. #19 (merge commit; "Update branch" first so CI runs on the union with #21;
   both touch `Overview.tsx` and `AppIndex.tsx`, trial merge was clean).
3. #13 after its two pre-merge fixes (independent of the chain; touches
   `docs/pack/STATUS.md` like #22, trial merge clean).
4. #22 last (docs describe the merged state).
5. After each step: `bun run check`, `bun run test:e2e`, `bun run test:a11y` on
   `main`. `check:codegen` needs `CONVEX_DEPLOYMENT` in CI (container lacked it;
   environmental, not a defect).

Deploy note: nothing in the train writes a truth state from the client; the kit
writes drafts only. Deploying before U12 is fine, but see D10 before the first
production write of `primaryGoal`.

---

## 2. Pre-merge fixes vs post-merge follow-ups

Rule used: fix before merge only if it is tiny, lives in a leaf PR (no restack),
and is a genuine defect (a11y/contrast). Everything in the stack is fixed
after merge, because amending #12-#20 forces a restack of up to nine PRs.

### Pre-merge (on #13 only, one commit, one regression test each)
- **PF-1 Contrast.** `src/components/app/create/DraftReport.tsx:43` uses
  `text-terminal-green` / `text-terminal-amber` for text (verified). Swap to
  `text-terminal-green-ink` / `text-terminal-amber-ink` (tokens exist at
  `index.css:125-126`, dark mode maps them back at `:211-212`). Test: axe run on
  the draft report, or a unit snapshot asserting the `-ink` class.
- **PF-2 DraftDialog radio.** `DraftDialog.tsx:~146` uses bare
  `<input type="radio">` with no focus styling (verified). Replace with
  `src/components/ui/radio-group.tsx` (exists) plus the `focus-visible` ring and
  `min-h-11` targets. Do not import `wizard/ChoiceTiles` into Create: that is
  another feature's folder (AGENTS rule 10). If a shared tile is wanted, promote
  `ChoiceTiles` to `module-kit.tsx` in a separate PR (FU-4). Test: keyboard
  arrow selection + visible focus in a component test.

### Post-merge follow-ups (each one small PR)
- **FU-1 `FirstRunWelcome` `cn()`** (`AppIndex.tsx:82`). Cosmetic; bundle with FU-2.
- **FU-2 SinceYouWereAway typography**: `font-mono text-small/text-caption` to
  match `NextAction`/`ModuleGrid`. Likely superseded by HM-1; do only if HM-1 slips.
- **FU-3 Goal fields (docs + seed, no rename).** Three fields exist (verified):
  `projects.goals: string[]` (legacy free text), `projects.primaryGoal`
  (enum bookings|sales|visits|awareness), `businessProfile.primaryGoals: string[]`
  (AI draft). Decision: **keep `primaryGoal` as the one canonical goal** (it is
  what DISCOVERY's single question and AGENT memory need; renaming to
  `firstRunGoal` would misname it once Settings can edit it). Ship: schema
  comments naming owner and consumer for each; `businessProfile` generation
  seeds from `primaryGoal` and may not contradict it; `goals` marked deprecated
  (read-only, no new writers). Test: businessProfile prompt builder includes
  `primaryGoal` when set.
- **FU-4 Promote `ChoiceTiles`** to the shared module kit (optional).
- **FU-5 Terminology copy pass** (glossary in section 3.4): wizard label
  "Business website or Google listing" (not "source"); agency path heading
  "Who is this project for?" and "client" wording when `forClient`; one-line
  subheads distinguishing "Starter kit" and "Brand kit" on Home. Copy only,
  keep code identifiers (`source`, `classifySource`) to avoid churn.
- **U4b** (already in backlog): kit above the header on phones, "start your
  kit" entry, server "Looks right" mutation. Folded into HM-1/HM-2 below.
- **U6b** (already in backlog): contact details in Edit project.

---

## 3. Unified product model

### 3.1 One onboarding flow
There is one flow: **the existing `NewProjectWizard`**. DISCOVERY is a
resolver that pre-fills it, not a second entry point.

- Resolver `organization.resolve.v1` accepts any of: work-email domain, website
  URL, Google listing. It reuses `lib/websiteScan.ts` / `scraping.ts` and the
  Google lookup the wizard already runs in `readSources()`; the only new part
  is the optional enrichment provider (D3). No new crawl pipeline.
- Signup with a work domain that resolves: **Confirm card** (name, website,
  inferred business type, editable inline) with three answers:
  [Yes, this is us] -> Goal question -> done (2 screens).
  [I'm setting this up for a client] -> wizard agency branch (client type,
  client name + website, goal); the resolver re-runs on the client's website.
  [Different business] -> the normal wizard.
- No domain, personal email, or a new project for an existing user: the
  3-question wizard as shipped; entering a website in Q2 runs the same resolver
  in the background and pre-fills the Understanding card.
- Goal question: DISCOVERY's six options are replaced by the shipped four
  `PRIMARY_GOALS` plus "Not sure yet" (which applies `defaultGoalFor(type)`).
  "Create better content" and "Improve our website" are tasks, not goals.
- Cap, written into `docs/ux/first-run-blueprint.md`: owner path max 3
  decision screens, agency path max 4 (type, client type, client name/site,
  goal), discovery path max 2. A confirm card counts as a screen.
- Confirmation emits `business.confirmed.v1`; the existing starter-kit job
  starts. No second bootstrap.
- Gate: DISCOVERY UI ships only after U12 shows Q1/Q2 friction (review-biz).

### 3.2 One Home information architecture
Today (verified, `Overview.tsx:909-954`): header/overview tiles, StarterKitCards,
SinceYouWereAway, ThisWeekNextStep, Your tools, then Understanding, Brand kit,
About + Connections, Attached files, Communications. Three "what to do" blocks
sit above the tools, and the kit is below the header tiles on phones (U4b).

Final order (mobile and desktop identical, single column top part):
1. **Compact header** (project name, switcher, edit). Overview number tiles
   move down into "About this project" on phones.
2. **Needs you / Ready for you / Next** as ONE section, "For you now", rendering
   at most **3 items**, ranked server-side by one query `home.priorities`:
   a. Needs you: blocking items only (kit part failed, approval waiting,
      connection expired). Max 1 shown, rest behind "See all".
   b. Ready for you: kit parts ready to review (StarterKitCards content), agent
      artifacts later. SinceYouWereAway becomes the subline of this group
      ("Since Tuesday: 2 posts published, 1 new contact"), not a card.
   c. Next: the single outcome-ordered step from `next-action-model.ts`.
   If the kit is running, the kit progress card IS the section (one item).
3. **Your tools** (ModuleGrid).
4. **About this project** (collapsed on phones): Understanding, Brand kit,
   About, Connections, Files, Communications.

What AGENT's triad replaces: it replaces the three separate sections
(StarterKitCards placement, SinceYouWereAway card, ThisWeekNextStep card) with
one ranked list. It does not replace their models: `kit-model.ts`,
`next-action-model.ts` and `shared/sinceLastVisit.ts` become the first three
providers of `home.priorities`. AGENT Phase E components (`NeedsYou`,
`ReadyForYou`, `ReadyCard`) are this section; they use `StatusBadge`/
`ReceiptBadge`, `ModuleEmpty`, tile tokens (review-ui #9). No new badge system.

### 3.3 One picture/media owner
Verified today: four places hold picture-like data.
- `projectFiles` (uploads, owner-site photos, Pexels with `attribution`;
  shown on Home as "Attached files"; `excerpt` for AI text).
- `productMedia` (Sell gallery, raw URL + alt, `media.ts`).
- `contentSources` (text only, per content piece, grounding).
- MEDIA's proposed `mediaAssets` (not built).

Decision: **`projectFiles` is the canonical media asset row.** MEDIA's
`mediaAssets` is implemented as additive optional fields on `projectFiles`
(`kind` image|video|document, `role`, `width`, `height`, `checksum`,
`authenticity`, `derivedFromFileId`, `processingStatus`, `source` gains
`camera`). MEDIA's `mediaOperations`, `mediaVariants`, `mediaUsage` become new
child tables keyed by `projectFileId`, each registered in `dataRegistry.ts`.
`productMedia` gains optional `projectFileId` (additive); URL-only rows keep
working. `contentSources` stays text grounding only and never holds images; its
UI name is "Sources for AI". Kit posts pick from the same library, and the
picker (MD-0) makes the kit's picture visible and swappable.
Do not create `src/convex/media/` next to the existing `media.ts` (same module
path, confusing API namespace); use `src/convex/mediaLibrary/`.

### 3.4 Glossary (canonical terms, UI word / code word)
| UI word | Code | Meaning | Not to be confused with |
|---|---|---|---|
| Project | `projects` | One business being marketed | Organization (billing/team) |
| Client | project with `agencyClientLinks` | A project an agency runs | "customer" (the owner's buyers) |
| Customers | `contacts` | The owner's buyers | Client |
| Goal | `projects.primaryGoal` | The one thing that matters most now | `goals` (legacy), campaign objective |
| Campaign objective | MEDIA "objective" | Goal of one campaign/shoot | Goal |
| Starter kit | `starterKits` | Plan + website + posts drafts | Brand kit |
| Brand kit | brand profile | Colors, logo, voice | Starter kit |
| Pictures / Media library | `projectFiles` (image/video) | Owner, camera, stock pictures | Sources for AI |
| Sources for AI | `contentSources` | Text grounding for one piece | Business website or listing |
| Business website or listing | wizard `source` field | Where we read the business from | Sources for AI |
| Draft / Ready / Published | status | Published only with provider receipt | "live" without receipt |
| Plan access (locked, needs setup) | `lib/capabilities.ts` | What the plan/role allows | Agent capability |
| Agent capability | AGENT registry, `*.vN` IDs | A versioned AI work unit | Plan access |

---

## 4. Cross-blueprint contracts

### 4.1 Real inconsistencies found
1. **`SourcedValue` defined three ways.** AGENT §14: `{value, provenance:
   EvidenceRef[], authority: user_locked|user_confirmed|first_party|external|
   inferred}`. DISCOVERY §14: `{value, authority: user_confirmed|first_party|
   provider|public_source|inferred, sourceRefs, confidence, retrievedAt}`
   (no `user_locked`, different field name). MARKET `MarketRef.status:
   inferred|confirmed|locked` is a third vocabulary.
2. **AGENT disagrees with itself**: §4.4 lists 8 authority tiers (incl. manual
   edit, accepted artifact, generic model knowledge) but its `SourcedValue`
   has 5.
3. **MARKET §27 ranks "assessment/customer research" above "user-confirmed
   persona"**, contradicting AGENT §4.4 (user-confirmed always wins).
4. **`EvidenceRef` shape**: AGENT `{sourceType, sourceId, version,
   retrievedAt, url}`; DISCOVERY example uses `{provider, recordId}`. The code
   already has `ContextEvidence {ref, version, source, trust, ...}` in
   `lib/contextPack.ts` (verified), which none of the blueprints mention.
5. **Event names**: AGENT `business_profile.confirmed.v1` vs DISCOVERY
   `business.confirmed.v1`; MARKET prefixes `project.market.*` while AGENT
   uses `persona.confirmed.v1` without prefix. No events table exists yet
   and `docs/pack/08-module-contracts.md` is missing from the repo (STATUS
   §"pack files" confirms), so there is no house convention to defer to.
6. **"Capability" collides** with the shipped plan/role registry
   `src/convex/lib/capabilities.ts` (T2.3). AGENT's `src/convex/capabilities/`
   would put two unrelated registries under one word.
7. **Autonomy**: code has `AiAutonomy = "assistive" | "draft"` (verified,
   `modelGateway.ts:16`); AGENT §16 has observe|prepare|modify|act.
8. **Bootstrap**: AGENT Phase D and DISCOVERY §28 both plan a new
   `bootstrapProject.v1` workflow; the starter-kit job already is one
   (idempotency key, parts, resumable, budget; review-logic #4).
9. **Goal**: DISCOVERY's 6 goal options vs shipped 4 `PRIMARY_GOALS`; MEDIA's
   "marketing objective" and MARKET's "business criticality" are separate
   concepts that must not be stored as goals.
10. **Big Five already exists** on personas (`schema.ts:409`,
    `ContextPersona.bigFive`, `country`, `culturalContext`). MARKET proposes a
    parallel personality prior without mentioning it.
11. **Model choice**: AGENT wants `modelClass: fast|standard|reasoning`; the
    gateway today takes `model?` resolved by `aiModels.resolveForRequest`.
12. **Workflow component**: AGENT Phase A adds `convex.config.ts` + Convex
    Workflow; that is a new framework (AGENTS §8) and needs an ADR.

### 4.2 Shared primitives (one definition each, in `src/shared/contracts/`)
- `provenance.ts`: one `EvidenceRef = {sourceType, sourceId, version?,
  retrievedAt?, url?, trust}` where `trust` reuses `ContextTrust`. `ContextPack`
  evidence maps onto it (no second evidence type).
- One `SourcedValue<T> = {value, authority, evidence: EvidenceRef[],
  confidence?, observedAt?, locked?: boolean}`. `locked` is a flag, not an
  authority tier.
- **Reconciled authority order** (highest first), used by all four blueprints:
  1 `user_confirmed` (manual edit counts; `locked` blocks all automated
  change) > 2 `accepted_artifact` (owner approved a MOSAI draft) >
  3 `first_party` (own website, connected accounts, customer research, owner
  uploads) > 4 `provider` (enrichment) > 5 `public_source` (search, Wikidata,
  official statistics) > 6 `population_prior` (MARKET aggregates) >
  7 `inferred` (model). A lower tier never overwrites a higher one; if
  first-party evidence contradicts a user-confirmed value, raise a "Needs you"
  suggestion instead (resolves inconsistency 3). `MarketRef.status` maps to
  inferred/user_confirmed/locked.
- **Agent capability IDs** `domain.verb.vN`, registry at
  `src/convex/agent/registry.ts` (not `capabilities/`). Canonical set for now:
  `organization.resolve.v1`, `business.understand.v1`,
  `audience.personas.prepare.v1`, `journey.prepare.v1`,
  `content.gaps.detect.v1`, `website.plan.v1`, `media.shot_plan.v1`,
  `market.resolve.v1`, `market.context.build.v1`, `bootstrapProject.v1`.
  Every capability's `canRun` first calls `resolveCapabilityState` from
  `lib/capabilities.ts` (plan access).
- **Events**: `<entity>.<past_tense>.vN`, entity without `project.` prefix
  (projectId is in the envelope). Canonical: `project.created.v1`,
  `business.confirmed.v1` (drop `business_profile.confirmed.v1`),
  `persona.confirmed.v1`, `market.confirmed.v1`, `market.changed.v1`,
  `media.captured.v1`, `media.asset.ready.v1`, `website.published.v1`
  (server with receipt only, rule 5). One `domainEvents` table, registered.
- **`bootstrapProject.v1` = the starter-kit job.** Wrap `starterKit.ts` and
  `shared/starterKitJob.ts` as the capability; add the missing `canceled`
  state (AGENTS rule 13). No second workflow.
- **ModelGateway**: add optional `modelClass` to `ModelGatewayRequest`,
  resolved inside `aiModels`; `agentId`, `autonomy`, `contextSources`, budget
  stay mandatory. Extend `AiAutonomy` additively to
  `"assistive" | "draft" | "modify_internal" | "act_external"` (map observe to
  assistive, prepare to draft); `act_external` always requires approval.
- **Status words**: media `processingStatus: uploading|processing|ready|failed`
  is fine; never `published/live` without receipt.
- **Registry**: `organizationCandidates`, `companyEnrichmentRuns` are
  user-scoped (exist before a project) and need `accountCleanup` entries like
  `projectVisits`; all MEDIA/MARKET/AGENT tables are project-scoped entries.

---

## 5. Sequenced roadmap (one PR each; AGENTS §8: no schema + OAuth + redesign mix)

Wave 0: land the train (section 1) and PF-1/PF-2.

Wave 1: cleanup and contracts (no product change)
- FU-3 goal field docs + businessProfile seed.
- FU-5 copy pass. (FU-1/FU-2 only if HM-1 slips.)
- CT-1 `src/shared/contracts/provenance.ts` (EvidenceRef, SourcedValue,
  authority order) + unit tests; docs note in pack. Types only.
- CT-2 ADR: agent capability registry naming, event naming, `domainEvents`
  table, Workflow component yes/no (D7). Docs only.

Wave 2: Home
- HM-1 `home.priorities` query (server, pure ranking from kit, next-action and
  since-last-visit models) + unit tests. No UI change.
- HM-2 Home redesign to section 3.2 order, max 3 items, mobile header fix
  (U4b-1), e2e at 320 px + axe. UI only.
- HM-3 U4b-2/3: "start your kit" entry and server "Looks right" mutation.
- U6b contact details.
- U12 usability sessions (owner) run on HM-2 build.

Wave 3: agent spine (AGENT Phases A-C only, after D7)
- AG-1 `domainEvents` table + registry entry + `emit` helper (schema only).
- AG-2 `agent/registry.ts` + contracts; wrap starter-kit as
  `bootstrapProject.v1` with `canceled` state. No new LLM calls.
- AG-3 gateway `modelClass` + `AiAutonomy` extension.
- AG-4 wrap `business.understand.v1` and `audience.personas.prepare.v1`.

Wave 4: media (MD) before discovery; bounded, no new provider needed for MD-0/1
- MD-0 Picture picker: kit posts and Create choose from `projectFiles`
  (owner/site/stock), swap and remove. UI only.
- MD-1 `projectFiles` additive media fields + `mediaVariants`/`mediaUsage`
  tables + registry. Schema only.
- MD-2 Server-side post-upload quality feedback and crop presets (Sharp or
  Cloudinary per D4). Provider PR, no UI redesign.
- MD-3 Shot planner (`media.shot_plan.v1`) with capture via file input.
- Deferred: live in-browser CV coach (M3), video (M5), Canva/Adobe/generative (M6).

Wave 5: discovery (only if U12 shows first-run friction)
- OD-1 `organization.resolve.v1` on website/listing/domain using existing
  scan; `organizationCandidates` table (schema + resolver, no provider).
- OD-2 Confirm card in the wizard + `business.confirmed.v1` (UI).
- OD-3 Enrichment provider adapter behind a flag, after D3 and legal (D5).

Wave 6: market (narrow)
- MK-1 `ProjectMarketContext` + `market.resolve.v1` from confirmed address,
  website, locale (schema + resolver).
- MK-2 CLDR locale/currency context into ContextPack (no external API key).
- MK-3 World Bank digital-context observations cache (provider PR).

Cut or deferred, with reason:
- MARKET Big Five population priors, WVS/EVS, ETL/weighting (§15-27, §46-51):
  cut for MVP. Stereotype risk, licensing, no small-business value a
  tone A/B test cannot give. Existing `persona.bigFive` stays, labeled
  `inferred` unless user-confirmed.
- AGENT Phases D-G (workflow engine, memory, Ask MOSAI): after Wave 3 proves
  value; D is already covered by the kit.
- DISCOVERY person enrichment, ambiguous matching, multi-business: out of MVP
  in the blueprint itself.
- MEDIA live CV coaching: device risk; server-side feedback first.

---

## 6. Owner decisions needed (AGENTS §7)

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Per-kit AI budget (US$0.40, rule 7) | confirm / raise / per-plan | Confirm $0.40 for launch, review after U12 |
| D2 | Merge the train before U12? | merge now / hold for U12 | Merge now (drafts only, no truth states); U12 on HM-2 build |
| D3 | Build DISCOVERY and which provider | skip / resolver on existing scan only / + Apollo or CompanyEnrich bake-off | Resolver on existing scan only (OD-1/2); bake-off budget only if U12 shows need |
| D4 | Media processing provider | Convex storage + Sharp worker / Cloudinary (cost, EU residency) | Start MD-0/1 with no provider; decide at MD-2, lean Cloudinary EU if budget allows |
| D5 | GDPR Art. 14 notice for enrichment | legal review before any live call / skip enrichment | Legal review before OD-3; OD-1/2 need none (user's own site) |
| D6 | Big Five population priors and WVS | build / cut / license WVS | Cut both for MVP |
| D7 | Adopt Convex Workflow component (new framework) | adopt via ADR / keep job tables + scheduler | Keep the starter-kit job pattern; revisit at Phase D |
| D8 | Home IA change (three blocks to one ranked list, max 3) | approve / keep sections | Approve; it changes what owners see first |
| D9 | Agency hand-off: who pays after hand-off (U9 remainder) | agency / client / either | Owner call; blocks U9 slice 2 |
| D10 | Is `main` auto-deployed to production? | yes / no | If yes, FU-3 is docs-only anyway (no rename), so no migration risk |
