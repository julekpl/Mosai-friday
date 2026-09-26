# UX review: first run, Home, Create collisions (built PRs + unbuilt blueprints)

## 1. First run

1. **MAJOR**: Two full onboarding flows will coexist with no stated precedence.
   Built: `NewProjectWizard.tsx` (3 screens: type incl. "agency" branch →
   name+source → goal), evidenced by `steps` array lines 22-26 and
   `forClient`/`clientType` branch lines 64-69, 179-191. Blueprint:
   `9bac092a-...ONBOARDING-BLUEPRINT.md` proposes work-email → auto-discovered
   company → "Is this right?" confirm → "at most one strategic question"
   (line 1302, 1322). Nothing in the blueprint says how/whether it replaces
   the wizard's 3 questions, or how the agency/client branch (U9, wizard
   step 0) maps onto "sign up with work email" (which assumes one org, not an
   agency managing many clients). **Recommendation:** treat org-discovery as
   a *pre-step* that fills Q1 (type) and Q2 (name+source) automatically when a
   work-domain email resolves a company, and always show only the Goal
   question (and the agency/client fork) after: net question count must not
   exceed today's 3; converge by keeping `NewProjectWizard` as the manual/
   fallback path and having discovery early-populate its state rather than
   building a second, parallel entry point.
2. **MAJOR**: Question count is currently 3 (type, name+source, goal) per
   `NewProjectWizard.tsx:22-26`, but the wizard also embeds sub-choices
   (agency vs. own business, then client business type) on step 0
   (`BusinessTypeQuestion` via `clientType`, lines 64-69, 292-298): so an
   agency user actually answers 4 things before name. Layering the blueprint's
   "confirm this is your business" screen on top makes it 4-5 screens for
   agencies. **Recommendation:** count and cap total screens including the
   agency sub-branch; state the cap in `docs/ux/first-run-blueprint.md`.
3. **MINOR**: Wizard already backgrounds source reads after Q2
   (`findings` ref, `readSources()` lines 82-144) to enrich context before
   Q3/finish. This overlaps functionally with the blueprint's "enrich
   company + crawl first-party website" step: same mechanism, two different
   named flows. **Recommendation:** the blueprint should explicitly say it
   reuses `scanWebsite`/`lookupGoogleBusiness`, not a new pipeline.

## 2. Home

4. **BLOCKER**: Home stacks five distinct "what should I do" surfaces in one
   scroll, all above "Your tools": `StarterKitCards` ("Your starter kit",
   `StarterKitCards.tsx:93-95`) → `SinceYouWereAway` (`Overview.tsx:920`) →
   `ThisWeekNextStep` ("This week" card, `Overview.tsx:923-935`) → "Your
   tools" section (`Overview.tsx:938-943`): see render order at
   `Overview.tsx:909-954`. Adding the agent blueprint's "Needs you / Ready
   for you / What to do next" (`b1a9d4db-...:50-51`) makes six competing
   primary-action blocks. There is no single clear primary action today, and
   the new triad would duplicate `ThisWeekNextStep`'s job (next best action)
   and `StarterKitCards`' job (things to review). **Recommendation:** the
   agent triad should *replace* `ThisWeekNextStep` and the finished-state of
   `StarterKitCards`, not sit beside them; `SinceYouWereAway` folds into
   "Ready for you" as a sub-line, not a separate card.
5. **MAJOR**: Mobile order is unreviewed: all five blocks render as full-
   width stacked `<section>`/`<div>` with no responsive reordering
   (`Overview.tsx:909-954` has no `md:`/`lg:` order classes on these blocks,
   unlike the two-column `Reveal className="grid ... lg:grid-cols-2"` used
   later at line 972 for About/Connections). On a phone a first-time user
   scrolls past kit cards + since-away + this-week before reaching any module
   grid. **Recommendation:** define an explicit mobile-first order in the
   agent blueprint before implementation (e.g., single "what to do next" card
   first, everything else collapsed under a "See more" disclosure).

## 3. Create: picture sourcing has three unreconciled concepts

6. **MAJOR**: Three separate, non-integrated ways to attach/pick images
   exist or are proposed: (a) `SourcesPanel.tsx`: a per-content-piece
   "Sources for AI" text/file/link library (`SourcesPanel.tsx:225,307-312`)
   that is for AI grounding text, not pictures, despite living next to
   Create's AI edit flow; (b) kit `PostsCard.tsx` auto-attaches a picture
   server-side from Pexels stock or the owner's scanned website photos
   (`stock.ts:22-27` "posts with pictures", `importOwnerPhoto`/
   `searchPhotos`/`importStockPhoto`), with **no user-facing picker**: the
   owner cannot browse/swap; (c) the camera-coach blueprint proposes a full
   "Media Library" (`d8f0ec50-...:38,229,1405`) as the canonical place for
   all photos/videos across Build/Sell/Create/Promote. None of these three
   reference each other. A user asking "where do I manage my pictures" today
   finds nothing in Create; the kit's picture is invisible/unswappable; the
   future Media Library isn't wired to either. **Recommendation:** land the
   Media Library blueprint as the single picture source for both kit posts
   (replacing the internal-only `stock.ts` picker) and a new "Pictures" tab
   in `SourcesPanel` (or a sibling panel) for Create: do not ship the kit's
   auto-picture as user-invisible once a Media Library exists.

## 4. Wording/terminology

7. **MINOR**: "Sources" means two different things: `SourcesPanel.tsx`
   ("Sources for AI", text/file/URL library for one content piece) vs. the
   onboarding wizard's `source` field (`NewProjectWizard.tsx:73,93-144`,
   `classifySource`) which means "website URL or Google Business listing".
   **Recommendation:** rename the wizard's field/UI copy to "business
   website or listing" in code and docs; reserve "source(s)" for the Create
   AI-grounding library.
8. **MINOR**: "Kit" is overloaded: `starterKit` (plan/website/posts bundle,
   `kit-model.ts`, "Your starter kit") vs. brand kit (`BrandKitForm.tsx`,
   `BrandKitCard`, "Brand kit"). Both appear on Home in the same scroll
   (`Overview.tsx:911-917` and `964-970`). Fine as distinct compound terms,
   but nothing on the page explains the difference on first encounter.
   **Recommendation:** add a one-line subhead distinguishing "starter kit"
   (plan/website/posts) from "brand kit" (colors/logo/voice) the first time
   both appear together.
9. **MINOR**: "Client" is used for the agency's end-customer project
   (`createClientProject`, `clientType`, `ClientBusinessType` in
   `NewProjectWizard.tsx`), while "project" is the generic unit everywhere
   else (`projects.create`, `ProjectDoc`). An agency user's mental model of
   "client" vs. everyone else's "project" is never reconciled in copy: the
   wizard step 0 label is just "Kind of business" (line 23), not "Who is
   this project for?". **Recommendation:** align wizard step labels/UI copy
   with "client" terminology explicitly when `forClient` is true.
