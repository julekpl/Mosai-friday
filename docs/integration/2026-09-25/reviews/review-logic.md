# Backend logic review: integration worktree

## 1. Registry / cascade delete coverage: PASS
`src/convex/lib/dataRegistry.ts` has entries for all new tables: `contentSources`
(L104), `starterKits` (L119), `stockSearchCache` (L118, ephemeral/global: correct,
no tenant data), `projectVisits` (L117, with `by_user` accountCleanup),
`agencyClientLinks` (L78, `organization-links` deletion kind). No missing
registrations found.

## 2. [MEDIUM] Three overlapping "goal" fields on/around `projects`
`src/convex/schema.ts`:
- L289 `projects.goals: string[]`: legacy free-text marketing goals.
- L304 `projects.primaryGoal: PrimaryGoal` (enum, new first-run Q3, `shared/starterKit.ts`).
- L47 `businessProfileFields.primaryGoals: string[]`: AI-drafted goals inside
  `businessProfile` (separate sub-object).
Three differently-shaped, differently-scoped "goal" concepts with confusable
names (`goals` / `primaryGoal` / `primaryGoals`) and no doc cross-reference
between them. `starterKit.ts` (L666, L737-739, L783) reads `project.primaryGoal`
only; nothing reconciles it with `project.goals` or `businessProfile.primaryGoals`,
so AI prompts elsewhere that ground on `businessProfile.primaryGoals` can
recommend content that contradicts the first-run `primaryGoal` default (e.g.
site main-button/plan focus). Not a security bug, but a real drift risk.
**Fix:** rename `primaryGoal` → `firstRunGoal` (or similarly distinct), and add
a one-line schema comment stating each field's owner/consumer, or fold
`primaryGoal` into `businessProfile` generation as its seed value.

`businessType` (new, L303, enum) vs `industry` (pre-existing free text, L276,
sourced from GMB category at `projects.ts:415`): checked, these are not
duplicates: `industry` is descriptive text for AI grounding, `businessType` is
a small first-run UI-default bucket. No collision.

## 3. "Library" concepts: contentSources vs projectFiles vs blueprint mediaAssets
No actual duplication: `contentSources` (#13, `schema.ts:1250`) is a text
library scoped to one `contentPieces` (grounding for drafts). Stock/scraped
photos (#16) are stored on the pre-existing `projectFiles` table with a new
`attribution` field (`schema.ts:1102`, photographer/photographerUrl/pageUrl),
populated by `src/convex/stock.ts`. The blueprint's "mediaAssets" concept
(`d8f0ec50-MOSAI-CAMERA-COACH-MEDIA-BLUEPRINT.md`) was never implemented as a
separate table: `projectFiles` is the de facto canonical image/media owner.
**Recommendation:** document `projectFiles` explicitly as the canonical media
library in the pack so a future PR doesn't reintroduce a `mediaAssets` table.

## 4. Starter-kit job: PASS, matches AGENTS §13
`shared/starterKitJob.ts` + `starterKit.ts`: states are
queued/running/waiting_for_user/succeeded/partially_succeeded/failed (no
"canceled" state implemented, but never surfaced as needed for a synchronous
onboarding kit: minor, not blocking). Has `idempotencyKey` (schema.ts:1439,
unique `by_idempotency` index), stale-resume via `STARTER_KIT_STALE_MS`
(15 min, job runtime is 10 min max), per-part retry (`isRetryableKitStatus`),
and an explicit `budgetMicrousd`/`spentMicrousd` cap (rule 7 money: flagged
in-code for owner confirmation, good practice). Would wrap cleanly as a
capability `bootstrapProject.v1`: it already exposes discrete parts
(plan/site/posts) and a resumable status reducer, matching the blueprint's
capability-registry shape.

## 5. Model gateway: PASS, one non-issue flagged
`starterKit.ts` and `ai.ts` both call `modelComplete` from
`lib/modelGateway.ts`: no direct provider SDK calls found. Grounded drafts in
`content.ts` do not call AI directly (delegates to `ai.ts`).
`contentSourceImport.ts:94` (`fetchJson`) uses raw `fetch()`, not
`modelGateway` or `safeFetch`: but this is correct: it only calls the fixed
`serpapi.com` host for YouTube transcripts (constructed URL with an
operator-held API key, not a user-supplied URL), so it's out of scope for
both the AI-gateway rule and the safeFetch/SSRF rule. User-supplied URLs
(web-page import) do go through `safeFetch` (`contentSourceImport.ts:142/156/186`).

## 6. Agency (#21) authorization: PASS
`createClientProject` (`projects.ts:176`) creates the client org with the
caller as owner, links via `agencyClientLinks`, all in one mutation authorized
by `requireUser`. `agencyClientProjects` (`projects.ts:246`) double-checks
active membership in both the agency and client org (`memberOf.has`) plus
`hasProjectAccess` per project before returning it: no cross-tenant leak
found.

## 7. safeFetch/safeFetchBytes (#16): PASS
`stock.ts:91` downloads via `safeFetchBytes` with `IMAGE_CONTENT_TYPES`
allow-list; SSRF guard (`lib/safeFetch.ts:256`) is shared by both fetch
helpers (HTTPS-only, DNS-resolved private-range check, redirect
re-validation) and used consistently: no direct `fetch()` on a user-supplied
URL found in the reviewed diffs.

## Summary
No blocking security defects found (auth/ownership, safeFetch, model gateway,
cascade-delete registration all check out). One medium-severity naming/data-
model collision worth a follow-up ticket: three near-synonymous "goal" fields
(`projects.goals`, `projects.primaryGoal`, `businessProfile.primaryGoals`)
should be disambiguated before more code reads/writes them.
