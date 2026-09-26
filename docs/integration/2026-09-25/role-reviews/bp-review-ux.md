# MOSAI end-to-end UX review: 4 blueprints on shipped UI
25 Sep 2026. Reviewed against `docs/integration/2026-09-25/INTEGRATION-PLAN.md`
(the unified model, §3) and `OWNER-DECISIONS.md` (D1-D14, budget-first). Note:
INTEGRATION-PLAN.md §3 already resolves most collisions below in the same
direction I'd recommend; I mark agree/adjust on each.

## 1. Owner journey, step by step

**A. Sign up.** Owner enters email/password (or work email). If domain
resolves, OD-1 runs `organization.resolve.v1` silently in the background
(D12: only after sign-in, never for gmail/outlook domains). 0 extra decisions
here: good, no dead end.

**B. First run: wizard.** `NewProjectWizard.tsx` steps: business type, name,
goal (3 screens, 1 primary action each: `ChoiceTiles`/`NameQuestion`/
`GoalQuestion`). If OD-1 resolved a domain, a **Confirm card** appears before
or folded into step 1 (INTEGRATION-PLAN §3.1): name, website, inferred type,
3 buttons (Yes this is us / client / different business). **Finding 1 (med,
UX):** the confirm card and wizard step 1 (`BusinessTypeQuestion.tsx`) both
ask "is this your business/type": two screens doing adjacent jobs back to
back reads as one over-long screen to a first-time user even though the
plan caps it at 2 screens for the discovery path. Recommend explicit
transition copy ("Got it: one more thing") so it doesn't feel like a retry.
**Finding 2 (low, jargon):** none of the wizard copy uses "capability" or
"provenance" today: good, must stay that way when OD-2/AG-3 land.

**C. First Home.** Starter kit is already running (D2: emits
`business.confirmed.v1`, kit job starts, no second bootstrap). Owner lands
on `Overview.tsx`. Today's shipped order (verified `Overview.tsx:909-954`):
header tiles -> StarterKitCards -> SinceYouWereAway -> ThisWeekNextStep ->
ModuleGrid -> Understanding/Brand kit/etc. **Finding 3 (high, IA):** that's
**3 separate "what do I do" blocks** stacked before the tools grid: a new
owner has to read 3 differently-designed cards to find 1 next action. This
is the single biggest journey risk pre-blueprint and the blueprints make it
worse (AGENT adds NeedsYou/ReadyForYou on top) unless resolved: see
Collision #2 below.

**D. Make a post with a picture.** Owner opens a kit post card (Ready for
you) or goes to `Create.tsx`. Path 1: kit post already has a Pexels picture
attached (U18, `attribution` shown): owner can accept as-is (1 action:
Publish/Approve). Path 2: owner wants their own photo: opens the picker
(MD-0, not yet built) which must read from the same `projectFiles` library
Create's "Sources for AI" panel populates. **Finding 4 (high, collision):**
today Create has a "Sources for AI" panel (`contentSources`, text-only) and
kit posts have inline Pexels pictures: no shared picker exists yet, so
MD-0 is landing into a UI with two different "attach something" idioms
already live. Must ship as one component, not a third. See Collision #3.
**Finding 5 (med, jargon):** MEDIA blueprint's `authenticity` field
(`authenticity=generative_edit`, line 831) and `objective` (marketing
objective, shot plan) must never leak to the owner as-is: needs plain
copy (see §4).

**E. Camera / shot plan (MEDIA).** Owner asked "what photo would help" ->
shot plan lists 1-2 shots with why. Capture is via plain file input (MD-3,
no live CV coach per D4/roadmap: device risk deferred). **Finding 6 (low):**
good: this avoids a dead end where a low-end Android/iOS browser can't run
live coaching; MVP correctly falls back to "take the photo yourself, here's
what to get."

**F. Back next week.** Home shows "Since Tuesday: 2 posts published, 1 new
contact" (INTEGRATION-PLAN §3.2 folds SinceYouWereAway into the subline of
"Ready for you," not a separate card) plus 1 next action. **Finding 7
(med):** if HM-1/HM-2 slip (roadmap Wave 2), the shipped 3-card stack
persists and the returning-owner experience stays cluttered: flag as a
release-order risk, not just a design one.

## 2. Collisions and resolved design

**Collision 1: Discovery confirm card vs wizard step 1.**
Both ask "is this the right business/type." **Resolution (agree with
INTEGRATION-PLAN §3.1):** confirm card *replaces* step 1 on the resolved
path, it's not inserted before it. Goal question is the only screen after
Yes. Owner path stays ≤2 screens as specified. Do not build the confirm
card as an extra modal on top of the wizard shell.

**Collision 2: "Needs you / Ready for you" (AGENT triad) vs
kit cards / This week / Since you were away (shipped).**
**Resolution (agree with §3.2, "For you now"):** one section, max 3 items,
server-ranked (`home.priorities`). Needs-you shows at most 1 blocking item
(rest behind "See all"); Ready-for-you absorbs StarterKitCards content and
carries SinceYouWereAway as a subline, not its own card; Next is the single
`next-action-model.ts` outcome. Kit-running state collapses all three into
one progress card. This is a real UI rewrite (`Overview.tsx`), not additive
- must be its own PR (HM-2) per AGENTS §8 (no redesign mixed with schema
work).

**Collision 3: media picker (MD-0) vs Create's "Sources for AI" panel
vs kit post inline picture.**
**Resolution:** one picker component reading `projectFiles`
(owner uploads, site photos, Pexels stock with attribution) used in 3
places: kit post picture swap, Create's image attach (new, doesn't exist
today), and any future MEDIA capture flow. Text sources
(`contentSources`, "Sources for AI") stay a completely separate, clearly
labeled panel: never merge the two pickers, they answer different
questions ("what text grounds this draft" vs "what picture goes with this
post"). Matches §3.3's `projectFiles`-is-canonical decision.

**Collision 4: market confirm (MARKET) vs project settings / wizard.**
Not yet built (Wave 6, MK-1-3 only: locale/currency/World Bank context,
no population priors per D6). **Resolution:** MK-2 currency prefill lands
inside existing project/business settings as a labelled "Suggested"
value on empty fields only (D13): not a new confirm screen, not a new
wizard step. If MARKET's later phases (cut for MVP) ever return, they
belong in Settings too, not a 4th onboarding flow.

## 3. Tasty moments (cheap, $0 vendor, budget-first)

1. **First Home already has content.** Starter kit runs during/right after
   the wizard so Home never opens empty: owner sees drafted posts/plan
   within the first session. Already shipped (`starterKitJob.ts`); just
   needs HM-2 to surface it as 1 clear card instead of 3.
2. **"Since Tuesday" subline.** Turns a stale "nothing happened" Home into
   a small win narrative each return visit: $0, pure copy/query reuse of
   `shared/sinceLastVisit.ts`.
3. **Attribution-visible stock photo.** Pexels picture on a kit post shown
   with visible photographer credit: feels honest/premium at $0 cost
   (already shipped, U18).
4. **Shot-plan "why."** One line next to a suggested photo ("this shows
   customers what to expect") makes the ask feel coached, not busywork -
   costs nothing extra since the shot plan capability already generates it.
5. **Confirm card as instant credibility.** "We found The Blue Cafe at
   bluecafe.com: is this you?" on first sign-in feels like magic for $0
   (reuses existing website scan/Google lookup, no paid enrichment per D3).

## 4. Plain-language copy list (jargon -> owner-facing label)

| Blueprint term | Owner-facing label |
|---|---|
| capability (agent capability, `*.vN`) | never shown; internal only |
| capability (plan access, `lib/capabilities.ts`) | "included in your plan" / "Upgrade to unlock" |
| artifact (ShotPlan artifact, agent artifact) | "suggestion" / "draft" |
| provenance / evidence / SourcedValue | never shown; if needed: "where this came from" |
| authority tier (user_confirmed, inferred, etc.) | never shown; UI shows only "You confirmed this" vs "MOSAI's best guess" |
| authenticity (generative_edit, camera-original) | "edited by MOSAI" vs "your original photo" |
| market scope / business criticality / population prior | never shown for MVP (cut, D6) |
| campaign objective (MEDIA) vs Goal (projects.primaryGoal) | "What this photo is for" (objective) vs "Your main goal" (goal): keep visibly distinct per glossary §3.4 |
| Sources for AI (`contentSources`) | "Sources for AI" (keep as-is, already plain) |
| Business website or listing (wizard `source`) | "Your website or listing" (FU-5, not "source") |
| Starter kit vs Brand kit | "Starter kit: your first plan, website & posts" / "Brand kit: your colors, logo & voice": one-line subheads (FU-5) |
| organization candidate / company enrichment | never shown; UI shows the confirm card only |
| Needs you / Ready for you / Next | keep as-is: already plain, ship as one "For you now" section per Collision 2 |
