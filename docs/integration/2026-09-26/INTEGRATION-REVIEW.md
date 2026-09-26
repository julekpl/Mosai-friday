# Integration review of open PRs and blueprint plan corrections (26 Sep 2026)

**Scope:** open PRs #1, #23, #24, #25, #26, #27, #28, #29 on `julekpl/Mosai-friday`, and the
four 25 Sep blueprints committed in #23 under `docs/integration/2026-09-25/`.
**Method:** four role reviews (UX, UI, business logic, business engineering), a mechanical
gate run on a local integration tree, and a supervisor pass that re-verified the
highest-consequence findings against code. This file corrects PR #23's plan; it does not
replace it. When #23 merges, its `OWNER-DECISIONS.md` and `MVP-BLUEPRINT-PLAN.md` should
absorb §5 and §6 below.

## 1. Integration tree result

Local tree: `main` (a6e9358) + #25, #27, #26, #24, #29, #23, #28 merged in sequence.

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | pass |
| `bun tsc -b --noEmit` | pass |
| `bun run lint` | 0 errors, 33 warnings (same as `main`) |
| `bun run test` | 84 files, 1208 tests pass |
| `audit:functions`, `audit:capabilities` | pass |
| `check:codegen` | not run: no `CONVEX_DEPLOYMENT` in the sandbox |
| `test:e2e`, `test:a11y` | not run |

The only textual conflict is #27 vs #28 in `src/components/app/wizard/types.ts`. The
union resolution (`BusinessSearchState` gains `"resting"`, keep `SourceFindingsStatus` and
`FoundDetails`) typechecks and passes all unit tests.

## 2. Defects the gates do not catch

1. **#26 truth defect.** `bootloader-model.ts:207-211` titles the kit "Your kit is ready"
   when any part is done or partial, even if others failed. It also treats `locked`
   (plan-gated) parts as failures, so an all-locked kit reads "We could not finish your
   kit". AGENTS.md rule 5.
2. **#24 breaks #27's e2e.** #24 renames the name-screen label to "Your website or Google
   listing (optional)"; #27's `tests/e2e/first-run-wizard.spec.ts:405,424` still selects
   `/Where can we read about it\?/`. Textually clean merge, failing browser test.
3. **#29 self-links.** `homePriorities.ts` items "Watch it build", "Open your kit" and
   "Start your kit" point to `/app`, the Home page itself. Latent until a Home UI consumes
   the query.
4. **#28 lookup budget.** A listing onboarding costs two SerpApi calls (search + details,
   `scraping.ts:444-445,465-466`). The per-user cap of 10/day allows about 5 onboardings
   per user per day; the 200/month default allows about 100 per month. The double call
   predates #27 (`readSources()` on `main`).

## 3. PR verdicts

| PR | Verdict | Fix required in the PR | Follow-up |
|---|---|---|---|
| #23 docs | Fix, then merge | Close F1 (trial requires a card) in `OWNER-DECISIONS.md`; mark §7 D8/D10 closed and §9 A1 superseded by §10; mark `research-enrichment.md` $400/month superseded by D11; mark `docs/ux/first-run-blueprint.md` question caps and `DIRECTION-COMPARISON.md` caps superseded by §11; add the naming line in §4 | none |
| #25 | Merge with a merge commit (not squash) | none | BRIEF-1: one source-of-truth per concept (goal, customers, channels) and one goal line per AI brief; no partial callers of `saveFirstRunAnswers` (it replaces all answers) |
| #27 | Merge | none | FR-M (§5); shared `TileShell` for `ChoiceTiles`/`MultiChoiceTiles`; label the summary rating "Google rating" with no stars |
| #26 | Fix, then merge | "Part of your kit is ready" with failed parts named; locked parts read as needing the Starter plan, not as a failure; unit test that fails before the fix; cubic-bezier to an `--ease` token | none |
| #28 | Rebase, fix, then merge | Union `types.ts`; map `lookup_resting` to a resting status in `readSources`, not `failed`; Search button `outline` variant; e2e for explicit search and the resting copy; ceiling values per O1 | LQ-1b: reuse the picked suggestion and skip the details call when it is enough; admin alert near the ceiling |
| #24 | Fix, then merge | Update #27's two e2e selectors; assert the new label; fix the stale comment in `classifySource.ts` | none |
| #29 | Fix, then merge | No item may link to the current page (`{to}` or an intent such as `show_kit_progress`), with a test | HM-2: goal- and channel-aware ranking, empty `postingChannels` guard; HM-3: reviewed state; KIT-F1: "Try Starter" item for locked parts |
| #1 | Close, delete branch | none | Superseded (no merge base, adds `package-lock.json`). Does not remove `.env.keys` from `main` history; see D-01 |

**Merge order:** #23, #25, #27, #26, #28, #24, #29; close #1. #25 lands first because #26
and #27 are stacked on it; retarget both to `main` after it merges. #28 owns the
`types.ts` resolution. #24 lands after #28 so its label assertion covers the final
`NameQuestion.tsx`. #29 has no UI, so it goes last.

## 4. Unifying decisions (proposed; amend #23's plan)

- **One onboarding.** The six-screen first run (owner decision, #23 §11). Discovery, if built,
  only pre-fills; its "Is this right?" card replaces the Type screen and never adds one.
- **One Home.** `home.priorities` (at most 3 items) is the model. The #26 loader is the
  detail view of the kit-working item. "Needs you", "Ready for you" and "Next" are item
  kinds. Extend `NextAction.tsx` and reuse its "Why this step" list (`NextAction.tsx:88`);
  no `src/components/agent/*` folder.
- **Naming.** "Capability" means plan/role entitlement (`src/convex/lib/capabilities.ts`).
  The agent blueprint's versioned AI work units are **skills**: `SkillId` (`domain.verb.vN`),
  `src/convex/agent/skills.ts`, `skillRuns`. "Action" is already taken by the action registry.
- **One cost mechanism, two units.** `aiSpendRollups` (microUSD) and `providerUsageRollups`
  (calls, from #28), the latter extended with scope and kind (e.g. `company_enrichment`).
  An agent cycle ceiling is the sum of `aiRuns` reservations by correlation id. No third
  budget table.
- **One job-state model.** The rule-13 states in `STARTER_KIT_STATUSES`
  (`src/shared/starterKit.ts`) move to `src/shared/jobs.ts` when a second job needs them.
  No Convex Workflow component yet (D7).
- **Provenance.** Types in `src/shared/contracts/provenance.ts`, folded into their first
  consumer. One optional side-map on the project (field path, authority, confirmedAt),
  written only where a writer could overwrite a user value. No per-field wrappers.
- **Media.** Extend `projectFiles`; no `mediaAssets` table.

## 5. Corrected blueprint rollout

| # | Ticket | Depends on | Gate | Success metric |
|---|---|---|---|---|
| 0 | PR train (§3) | none | O1 before production | CI and e2e green |
| 1 | FR-M: `firstRunStartedAt` + `lastStepReached` (additive, own DB only) | #27 | O4 (decided) | Step drop-off readable |
| 2 | KIT-F1: trial copy, once-per-verified-email trial, platform daily kit-AI cap, "Try Starter" item | #29 | F1, O3 (decided) | No kits over the cap; no locked dead end |
| 3 | HM-2: "For you now" with the loader as the kit item; uses goal and channels | #26, #29, KIT-F1 | D8 | U12: 4 of 5 name the top item |
| 4 | HM-3: "Looks right" marks the site reviewed | HM-2 | none | Top item advances within 7 days |
| 5 | MD-1, then MD-0 (photo picker, capture) | HM-2 | none | Share of kit posts with own photos |
| 6 | U12 usability sessions | 1 to 5, LQ-1 | owner runs | Go/no-go for the next wave |
| 7 | KIT-2 rescoped, carrying provenance types | U12 | none | 0 overwrites of confirmed fields |
| 8 | MK-1, then MK-3 | KIT-2 | D13 | Share of projects with a confirmed market |
| 9 | BRIEF-1, LQ-1b | after #28 | none | One goal line per brief; about 1 SerpApi call per listing onboarding |

**Deferred until U12 evidence:** work-email discovery and any paid enrichment (OD-1 to
OD-4), agent spine AG-1 to AG-4 (rename to skills when revived), Workflow component, crop
presets, Camera Coach, video, Canva and Adobe, Big Five priors, World Values Survey, GDELT,
CLDR in AI context.

## 6. Owner decisions (26 Sep 2026)

| ID | Question | Decision |
|---|---|---|
| O1 | SerpApi quota and ceiling | **Stay on the free tier.** Set `SERPAPI_MONTHLY_CEILING` to about 80% of the quota shown in the SerpApi dashboard before #28 reaches production (100 vs 250 is still unverified). Per-user cap stays 10/day. Google Places is the exit path if the free tier or legal risk becomes a problem. |
| O2 | Starter kit AI budget and default model | **Keep** the $0.40 per-kit ceiling and `gpt-4o-mini` as default; confirm the default in the production admin. |
| O3 | Platform daily cap on trial kit AI spend | **$1 per day.** At about $0.015 per kit this is roughly 65 kits per day across the platform; beyond that, trial kits show the "resting" state until the next day. Revisit if signups exceed that. |
| O4 | First-run step tracking | **Yes.** Two additive fields in MOSAI's own database, no third party. This supersedes the plan's "no new tracking" line for this purpose only. |
| O5 | `.env.keys` rotation | **Deferred** until closer to launch; tracked as D-01 in `docs/implementation/DEFERRED-WORK-BACKLOG.md`. It remains a release blocker. |
