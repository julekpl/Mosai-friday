# First run and Home: Direction A vs Direction B

> Superseded (26 Sep 2026): the question and screen caps here are replaced by the owner's six-screen first-run decision (`docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md` section 11).

Supervising architect, 26 Sep 2026. Read-only review of `origin/main` (a6e9358), the
approved plan (`docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md` sections 2, 3, 9, 10),
`docs/ux/first-run-blueprint.md`, and branches pr25, pr26, pr27. Nothing was merged or changed.

## 1. How each direction feels to the owner

**Direction A (approved plan, mostly shipped).** Maria signs up and sees three screens.
Screen 1: "What kind of business is it?", one tap on one of four tiles. Screen 2: the
business name plus one optional field "Your website or Google listing" (a few words
typed, or "I don't have one yet"). Screen 3: "What do you want most right now?", one tap,
and the button "Make my starter kit". About 5 taps and one short line of typing, roughly
one minute. She lands on Home, which shows one progress card with real step names, then
one "For you now" list of at most 3 items with one obvious button ("Look over your
website"). Audience, service area and customers are guessed from her website and shown
later as "our guess" she can fix. An agency adds one client question (4 screens).

**Direction B (PRs #25, #26, #27).** Maria sees six screens with a "Step 1 of 6" bar.
Screen 1: tick one or more of 8 business types (the first ticked is "Main", others can be
made main), with an "Other" box. Screen 2: name plus website or listing (must answer).
Screen 3: tick one or more of 7 goals. Screen 4: where she already posts (6 networks or
"Nowhere yet"). Screen 5: who her customers are (7 groups) plus "Anything we should know?"
(free text with a counter). Screens 3 to 5 have "Skip for now". Screen 6: "Here's what we
found", the website read results and all her answers, each with a "Fix" link, then "Make
my starter kit". Realistic path: 10 to 15 taps, possibly some typing, about 2 to 4
minutes. Home then opens a full-screen "Mosaic assembles" loader: tiles fill in as each
kit part really progresses, a live checklist, and rotating "While you wait" tips, with
"Go to my kit" always visible. Later, "Your answers" in Edit project lets her change all
of it. Agency is the same six screens (client type is a sub-question on screen 1).

## 2. Side by side

| Topic | A (approved) | B (#25/#26/#27) |
|---|---|---|
| Happy-path screens, owner | 3 | 6 (4 if she skips 3 to 5, but she still sees them) |
| Happy-path screens, agency | 4 | 6 |
| Required answers | type, name (link optional), goal (skip = default) | type, name; goals, channels, customers skippable |
| Choice style | single pick, 4 tiles | multi-select, 6 to 8 tiles plus "Other" boxes |
| Time to first useful output | about 1 min to kit start | about 2 to 4 min to kit start; kit itself same speed |
| What AI gets | type, goal, name, website scan | same plus other types, other goals, channels, customer groups, owner notes (quoted as data) |
| Does richer data measurably improve output? | n/a | Not measured. Real, deterministic effects: posts only for networks she uses (`kitPostChannels`), extra website buttons per extra type, plan ordered by goals, named customer groups. No before/after sample or eval in the PRs |
| Home blocks on first visit | 1 progress card, then "For you now" max 3 (HM-2) | Full-screen loader over today's Home (StarterKitCards, SinceYouWereAway, ThisWeekNextStep, ModuleGrid all still under it) |
| Mobile 320px | 4 large tiles fit one screen | 7 to 8 tiles with "Main" badge and "Make main" buttons need scrolling; PR does test axe at 320px on every screen |
| One primary action per screen | yes | yes (Next / Skip for now / Make my starter kit) |
| Max 3 Home items (D8) | yes | loader is a separate full-screen layer, not counted but adds a surface HM-2 did not plan |
| "Only ask what cannot be found" | yes; audience and area inferred | asks customers and channels, which the scan often can find (social links are already discovered in D-25) |
| Discovery blueprint (caps 3 owner / 4 agency / 2 discovery; goals = shipped 4 plus "Not sure yet") | fits | breaks both caps and the goal list (7 goals, no "Not sure yet") |
| Agent blueprint "max 3 priorities" | fits | loader is not priorities, so no direct break; but it adds a second "what is happening" surface next to HM-2 |
| Schema impact | none from these PRs | 5 optional fields on `projects` (additive, low migration risk); new public mutation `saveFirstRunAnswers` |
| Conflicts with our PRs | n/a | #28 LQ-1: text conflict in `wizard/types.ts` and both edit `schema.ts` (plan C13 says one schema PR at a time). #24 FU-5: no file overlap, but FU-5 wizard copy tests and #27's rewritten wizard e2e will diverge. #29 HM-1: no file overlap; #26 edits `Overview.tsx`, which plan C14 freezes until HM-2 merges |
| Tests | U2 unit + e2e, 3 screens, axe at 320px | strong: 3 new unit files (~790 lines), 4 e2e specs incl. 320px, axe, reduced motion |
| Reversibility | n/a | #25 easy (optional fields, can stay unused). #26 easy (one component, one line in Overview). #27 hardest: rewrites wizard, 6 screen specs, agency spec |
| Owner decision on record | D8, plan approved 25 Sep | commits say "owner review, 25 Sep 2026", but no entry in `usability-backlog.md`, `OWNER-DECISIONS.md` or the plan on any branch |

## 3. Fair assessment

**Genuinely good in B that A lacks**
- Real businesses are mixed (cafe that sells online, trades with a shop). A forces one box.
- Posts only for networks the owner actually uses. This is a cheap, visible win: today the kit may write X or LinkedIn posts for a bakery that only uses Instagram.
- "Here's what we found" shows what the website read returned before the kit starts, with "Fix" links. That is the discovery blueprint's confirmation idea, done honestly (only what the scan returned).
- "Your answers" in Edit project gives a place to change first-run answers later. A has no such place.
- Owner's own words, bounded and quoted as data, is a safe way to capture nuance.
- The loader follows the truth rule well: tiles fill only from real job steps, tips are labelled general, reduced motion respected, polite live region.
- Test quality is high; `normalizeFirstRunAnswers` is careful (agency never mixed, "Nowhere yet" dropped next to a real network).

**What in A that B breaks**
- The 3/4/2 screen caps and the "shipped 4 goals plus Not sure yet" rule written into the discovery blueprint header.
- "Only ask what cannot be found": customers and networks are asked up front instead of guessed and shown as "our guess".
- Time to first value roughly doubles to triples, before any U12 evidence says owners want more questions.
- Home consolidation: the loader adds a full-screen layer while HM-2 is meant to collapse kit-running into one progress card; it also edits `Overview.tsx` during the freeze (C14).
- Schema order (C13) and a text conflict with LQ-1.

## 4. Options

**Option 1. Keep A; take B's data model (#25) and the loader idea as a Home item.**
- User impact: first run stays 3 screens and about 1 minute. Posts still follow networks once known (from the scan or later edit). Loader becomes the HM-2 "kit running" card, reusing `bootloader-model.ts` for honest step tiles, not full screen.
- Effort: small to medium. Rebase #25 after LQ-1 (schema order); fold `bootloader-model.ts` into HM-2; keep "Your answers" form from #27 as a separate small PR.
- Risk: low. Lose the multi-select first run until evidence supports it.
- PRs: #25 merge (after #28); #26 closed, model reused in HM-2; #27 closed, `FirstRunAnswersForm` and `selection.ts` salvaged. #24, #28, #29 unchanged.

**Option 2. Adopt B fully and amend the plan.**
- User impact: richer kit for owners who finish; longer first run, more drop-off risk on phones; two "what is happening" surfaces on Home.
- Effort: medium. Rewrite plan sections 2, 4, 9 and the discovery caps; resolve LQ-1 conflict; redo FU-5 wizard copy on the new screens; re-sequence HM-2 around the loader.
- Risk: medium to high. Goes against a written owner-approved plan without recorded evidence; U12 script was written for 3 screens.
- PRs: #25, #26, #27 merge in order; #28 rebases; #24 needs a follow-up copy pass; #29/HM-2 must be redesigned around the loader.

**Option 3 (recommended). Hybrid: 3 required screens, B's extra questions after the kit starts.**
- Screens 1 to 3 as today, but Q1 and Q3 allow extra picks via an optional "Also..." (first stays main, small on screen). Kit starts at once. On Home, while the kit runs, one "For you now" item: "Tell us more (1 min)" opening B's channels, customers and notes screens; answers feed the kit if it has not reached that step, and later reruns always. "Here's what we found" becomes the HM-3 review card.
- User impact: first value as fast as A; owners who want to add detail can, while they wait (turns dead time into useful time).
- Effort: medium. Reuse #25 whole, #27's `MultiChoiceTiles`, `selection.ts`, question components and `FirstRunAnswersForm`; #26's model inside the HM-2 progress card.
- Risk: low to medium. Needs a small rule for "answers arrived mid-kit" (posts step reads channels when it starts; no silent rewrite of finished parts).
- PRs: #25 merge after #28; #27 reworked into two smaller PRs (wizard "Also" picks, "Tell us more" plus Edit project answers); #26 folded into HM-2. #24 and #29 unchanged; #28 lands first.

## 5. What must be true before choosing

1. The owner confirms whether the "owner review, 25 Sep 2026" cited in #25 to #27 was a real decision for six screens. If yes, record it; it would override section 9 of the plan.
2. U12 tests both flows (3-screen vs 6-screen, or 3 plus "Tell us more") with 5 owners on phones: completion rate, time to kit start, and whether owners notice better posts.
3. A small before/after check: same 5 sample businesses, kit output with and without the extra answers, judged blind. If the difference is only "right networks", Option 1 or 3 captures it cheaply.
4. Schema order agreed: LQ-1 (#28) first, then #25.
5. HM-2 design decides where kit progress lives (card vs full screen) before #26 lands.
