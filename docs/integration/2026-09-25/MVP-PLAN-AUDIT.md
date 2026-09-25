# Audit of MVP-BLUEPRINT-PLAN.md (supervisor 2, independent)

25 Sep 2026, against `main` at `7d8e949`. Audit only; no source edits. Paths below
are relative to `scratchpad/main`.

## Verdict: APPROVE WITH CHANGES

The plan is a sound, budget-first cut: one Home list with at most 3 items, one
MediaPicker, one Market row in Settings, no event spine without a consumer, no
`camera` source, and U12 as the gate before discovery work. The four blueprints'
core values survive (see section C). But it re-opens an owner decision that is
already recorded, builds KIT-2 on a code premise that does not hold, and leaves
SerpApi spend open in two places. Changes 1 to 6 below must be made before
tickets are cut.

## A. Blocking changes

1. **F1/Q2 is already decided, and the plan treats it as open.** `docs/ux/usability-backlog.md:13`
   records "strategy Q2 -> a 14-day Starter trial (the kit needs Starter; no
   free-plan exemption; whether the trial needs a card is still open)". The U12 script
   also depends on it (`docs/ux/u12-usability-test-script.md:32`). Plan sec. 7 and
   C16 call this open and recommend (a). Fix: rewrite DEC-F1 as "Trial: card or no
   card?" and KIT-F1 as trial provisioning. Option (a) can go to the owner only as an
   explicit request to reverse the decision (AGENTS.md sec. 7). The Stripe claim is
   correct: `src/convex/billing.ts:641-655` sends `mode: "subscription"` with
   `trial_period_days` and no `payment_method_collection`, so Checkout asks for a
   card. "No card" is a small change to the Stripe parameters, but it changes how
   money moves, so the owner decides it.
2. **If (a) is ever chosen, KIT-F1 is under-sized.** Row 6a ("Look over your website
   still works") cannot work on the free plan today. The draft is read through
   `cms.getSite/listPages/getPage`, which are `moduleQuery("build")`
   (`src/convex/cms.ts:93,185,199`). The kit gate is `PART_CAPABILITY`
   (`src/convex/starterKit.ts:73-77`), checked at `:955-967`. Changing that gate
   alone produces rows that a free owner cannot open. A free preview needs its own
   read path that stays inside the module rules (rule 10), so it is M/L, not S-M.
3. **KIT-2's premise is wrong. Rescope it or cut it.** The starter kit never writes
   `businessProfile`: its only inserts are `contentPieces`, `posts` and kit rows
   (`src/convex/starterKit.ts:459,501`). Its site part already refuses to overwrite
   existing pages (`:714-724`). The AI profile draft already refuses to overwrite a
   confirmed profile (`src/convex/projects.ts:506-508`) unless the owner explicitly
   asks for `replaceConfirmed` (`src/components/app/ProjectSettings.tsx:236`,
   `BrandKitForm.tsx:226`). There is no `draftBusinessProfile`; the writer is
   `ai.generateBusinessProfile` (`src/convex/ai.ts:565`). Rescope KIT-2 to
   field-level locks on the two real rerun paths (profile `ai.ts:565`, brand
   `ai.ts:920`), or drop it and keep only its test. Its metric ("0 overwrites") is
   already true by construction.
4. **HM-3 "Looks right" confirms the wrong thing.** Screen 7 is a review of the
   website draft, but HM-3 calls the KIT-2 profile-authority mutation. Confirming a
   website should mark the site draft as reviewed; it should not lock profile
   fields. Split them, or point HM-3 at a kit-part `reviewedAt` (additive, on the
   kit row).
5. **LQ-1 misses a SerpApi consumer.** YouTube transcript import in the shipped
   `contentSources` feature also calls SerpApi (`src/convex/contentSourceImport.ts:112-120`).
   Add it to the ceiling and to the list of callers that return `needs_setup`,
   next to `scraping.ts:428,449` and `research.ts`.
6. **LQ-1 cannot make SerpApi-at-$0 true unless it goes further.**
   (a) The wizard searches as the owner types: every debounced query of 3 or more
   characters is a paid call (`src/components/app/wizard/NameQuestion.tsx:51-66`).
   So "2-3 per signup" is optimistic, and option (d), an explicit "Search Google
   for my listing" button, has to be in LQ-1 rather than left as an owner choice.
   (b) The per-user limit is `google_maps: 60` per 10 minutes
   (`src/convex/guards.ts:1712`), so one account can use up the whole 200/month
   platform ceiling in one sitting and turn a cost guard into an outage for
   everyone. Add a per-user daily cap for `google_maps` of about 10 to LQ-1.

## B. Non-blocking suggestions

7. **Two fields called "market".** Plan line 20 says Understand's "Country /
   market" is `businessProfile.market`. It is actually `persona.country`
   (`src/pages/app/Understand.tsx:102,167`), and it is sent to the AI as "market"
   (`src/convex/ai.ts:412,658`). MK-3 fixes only the Settings row
   (`src/components/app/ProjectSettings.tsx:337`), so the owner still sees two
   "market" inputs. Add to FU-5: rename the persona label to "Where these
   customers live".
8. **MK-1 schema shape.** The blueprint separates legal-operating, target and sales
   markets (`MOSAI-COUNTRY-CULTURE-...md:117-126`). Store `markets: [{country,
   role}]` now and show only the primary one, which avoids a later migration. State
   that `marketContext` never feeds cultural descriptors into ContextPack in MVP
   (anti-stereotype, blueprint :108, :416).
9. **Immutable original** (media blueprint :195-197) is missing from the
   acceptance criteria. Add to MD-1/MD-2a: "original file bytes never replaced;
   derived versions are new rows". MediaPicker should open on "Your photos" by
   default (authentic by default; the kit already prefers owner images,
   `starterKit.ts:829`).
10. **Signup abuse.** Sign-in is email OTP only (`src/convex/auth.ts:6-10`), so
    alias farming is cheap. Whichever way F1 goes, cap trial or free kit spend
    per platform per day using the existing `aiSpendRollups` platform scope, and
    count the trial once per verified email, not once per organisation.
11. **MD-2a job rule.** State where decoding runs. In the browser: flags are an
    advisory client write, which is acceptable because they are not a truth state.
    On the server: a job with `processingStatus` in the rule-13 states, not an
    inline action.
12. **Truth when a trial ends.** A site published during a trial must stop showing
    "live" when hosting stops. Add a KIT-F1 acceptance test that status follows the
    hosting receipt, not the plan.
13. **Ordering.** Add DEC-F1/KIT-F1 to HM-2's `Depends on` (the text at line 220
    says so, but the table omits it). MD-0 edits `kit/PostsCard.tsx`, which
    renders inside the `StarterKitCards` block that HM-2 collapses
    (`src/pages/app/Overview.tsx:911`), so keeping MD-0 after HM-2 is right: say
    why.
14. **Path accuracy.** `lib/capabilities.ts:201` should be
    `src/convex/lib/capabilities.ts:200`, and `ProjectSettings.tsx:337` is under
    `src/components/app/`. The Home order claim (`Overview.tsx:911,920,925`) and
    the `PLAN_MODULES.free` content are correct.
15. **CT-1** ships types with at most one consumer. Merge it into the first real
    consumer (LQ-1 or the rescoped KIT-2) so no PR is types-only.

## C. Checklist results

| Area | Result |
|---|---|
| Agent blueprint (prepared work, max 3, authority order, no silent overwrite, manual path) | Kept: kit + HM-1/2 max 3, typed-entry fallback. Authority is mostly already enforced in code (item 3) |
| Discovery (discover first, confirm card, one goal question, provenance) | Goal question shipped; confirm card and discovery deferred to U12 (justified, $0, recorded in C10-C12); provenance cut to types (acceptable) |
| Media (authentic default, immutable original, one picker, outcome words) | One picker, outcome words, no `camera` claim: good. Immutable original missing (item 9) |
| Market (distinct markets, locale/currency, no stereotyping) | Currency/locale kept (MK-1/3/3b). Single-country shape (item 8); duplicate label (item 7) |
| Collisions vs shipped code | Stock import, `saveScan`/`storeServerScan`, agency C12, `contentSources` handled; `contentSources` SerpApi missed (item 5) |
| AGENTS.md | One PR per ticket; no schema+provider+redesign mixing; `audit:data-registry` exists (`package.json:21,27`); money routed to owner, but the recorded decision is ignored (item 1) |
| UX | One filled button per screen, jargon table, no scores: good. Two "market" fields (item 7) |
| Budget | AI cost fine; SerpApi ceiling leaky (items 5, 6); signup farming (item 10) |
