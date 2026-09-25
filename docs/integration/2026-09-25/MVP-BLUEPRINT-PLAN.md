# MOSAI MVP blueprint plan (budget-first, one final plan)

Supervisor 1, 25 Sep 2026. Integrates bp-review-ux, bp-review-ui, bp-review-logic,
bp-review-biz against `main` at `7d8e949` (all PRs merged: starter kit stack, #13
Create, #19 Since you were away, #22 U12 script). Supersedes the ordering in
`docs/integration/2026-09-25/BLUEPRINT-IMPLEMENTATION-PLAN.md` (BIP) where they
differ; BIP section 3 contracts stay binding. Owner constraint: MVP, lowest cost,
$0 vendors where a free path exists.

Spot checks made for this plan (main, 7d8e949): `PLAN_MODULES.free` =
understand, journeys, create (`lib/capabilities.ts:201`); kit parts need
`create.edit`, `build.edit`, `promote.edit` (`starterKit.ts:72-76`); Home order is
StarterKitCards, SinceYouWereAway, ThisWeekNextStep, ModuleGrid (`Overview.tsx:911-945`);
`Create.tsx` has no image attach today; kit posts carry `mediaUrl` + Pexels
`attribution` with no way to swap (`kit/PostsCard.tsx`); SerpApi is called from
`scraping.ts:388-451` (google_maps) and `research.ts:~170` (youtube engine);
`lookupRateLimits` is per user only (`guards.ts:1712`, google_maps 60,
website_scan 6, stock_search 5 per 10 min); `aiSpendRollups` already has a
`platform` scope; `businessProfile.market` is the free-text "Where you sell" row
(`ProjectSettings.tsx:337`, Understand "Country / market").

---

## 1. Product story (week 1 after these slices ship)

Maria runs a small bakery. She signs up, answers three questions (what kind of
business, what it is called and where we can read about it, what she wants most),
and while she reads the first screen MOSAI drafts a one-week plan, a website and
seven posts from her own site. Home shows one section, "For you now", with at most
three things and one obvious button: "Look over your website". Each post already
has a picture, with the photographer credited; when she prefers her own photo she
taps "Change picture", picks one from "Your photos" (on her phone this opens the
camera) or "From your website", and the post updates. Nothing says "live" or
"posted" until a real provider confirms it; drafts say "Draft, not on the web yet".
When she comes back on Thursday, the top line reads "Since Tuesday: 2 posts ready,
website draft updated" and the single next step has moved on. It cost MOSAI about
one cent of AI and $0 in vendors, and if the free lookup quota runs out she sees
"Business search is resting for now, type your details instead", never a fake result.

---

## 2. Unified journey, screen by screen

| # | Screen | Single primary action (final copy) | Secondary | Delivered by |
|---|---|---|---|---|
| 1 | Sign up | "Create my account" | Sign in | shipped |
| 2 | Wizard Q1 business type (`ChoiceTiles`) | "Next" | Back | shipped |
| 3 | Wizard Q2 name + one field | "Next"; field label "Your website or Google listing" | "I don't have one yet" | shipped; label FU-5; listing search guarded by LQ-1 |
| 3a | (Deferred, U12-gated) confirm card replaces Q1 | "Yes, this is us" | "It's a client", "Different business" | OD-2 (not MVP) |
| 4 | Wizard Q3 goal | "Make my starter kit" | Back | shipped |
| 5 | Home, kit running | One progress card: "Building your starter kit" with real step labels ("Reading your website", "Drafting your posts") | "Stop" deferred (KIT-1) | HM-2 |
| 6 | Home "For you now" (max 3, server ranked) | Top item button, e.g. "Look over your website" | "Why this?" (one line), "See all" | HM-1, HM-2 |
| 6a | Free plan, if F1 option (a) is chosen | "Look over your website" still works; publish button reads "Publishing needs Starter" | "See plans" | KIT-F1 |
| 7 | Website draft review | "Looks right" | "Edit" | HM-3, KIT-2 |
| 8 | Post card | "Change picture" (when a picture exists) or "Add a picture" | "Download picture", "Copy text" | MD-0 |
| 9 | MediaPicker (Sheet on phones, Dialog on desktop) | "Use this picture" | Tabs "Your photos", "From your website", "Stock photos" | MD-0 |
| 9a | Quality note after upload (U12-gated) | "Use it anyway" | "Try another" | MD-2a |
| 10 | Return visit | Same top item; subline "Since Tuesday: ..." | "See all" | HM-2 (reuses `SinceYouWereAway` data) |
| 11 | Settings, Market row | "Save" (country, currency, language; badge "Estimated" or "You confirmed this") | none | MK-1, MK-3 |

Rules: one filled button per screen; every other action is a text or outline
button. No screen uses the words capability, provenance, artifact, authority,
candidate, score. "Needs you" / "Ready for you" / "Next" are group labels inside
"For you now", not separate cards.

---

## 3. Final MVP ticket list (ordered; one PR each)

Size S < 2 days, M 2-4 days. Every ticket: `bun run check` green,
`bun run audit:functions` exit 0, `bun run audit:data-registry` green, STATUS.md
updated, PR template sections. "Regression" lists tests that must exist and pass.

| # | ID | Title | Owner value | Size | Schema | Depends on | Regression tests required | Polish / "tasty" acceptance |
|---|---|---|---|---|---|---|---|---|
| 0 | DEC-F1 | Owner decides free-plan kit (sec. 7) | Unblocks the first win | - | - | - | - | Decision recorded in `docs/decisions/` |
| 1 | CT-1 | Shared provenance + event contracts (types, `decideWrite`) | None directly; prevents three rival `SourcedValue`s | S | no | - | `decideWrite` table: locked never overwritten; lower never beats higher; first_party vs user_confirmed = `suggest`; `contextPack` behavior unchanged | `rg` finds one `SourcedValue` definition |
| 2 | FU-5 | Copy pass (includes FU-3 goal docs) | Owner reads plain words | S | comments only | - | e2e text snapshots of wizard + Home labels | Jargon table (sec. 5.4) applied; Big Five shows "AI guess, not a real customer" (copy only, replaces MK-4 for MVP) |
| 3 | LQ-1 | Platform monthly ceiling for SerpApi (and Pexels) + query cache | Keeps lookups $0, no silent failure | S | yes: `providerUsageRollups` (kind, period "2026-09", count, updatedAt; `global()` registry) | CT-1 | Per-user `consumeLookupQuota` still enforced; at ceiling `suggestGoogleBusiness`, place details and research youtube return `needs_setup`, never empty success; no key = unchanged `GOOGLE_MAPS_NOT_CONFIGURED` | UI line "Business search is resting for now, type your details instead"; wizard still completes |
| 4 | KIT-F1 | Implement owner's F1 choice | Free owner sees a real website + posts | S-M | maybe (one free kit per account marker) | DEC-F1 | Paid plans unchanged; publish/schedule/deploy still gated by `build.publish`/`promote.*` + receipts; kit budget $0.40 still enforced; cross-tenant test | Locked actions say "Publishing needs Starter", never a blank card |
| 5 | KIT-2 | Owner-confirmed profile fields win over AI drafts (`decideWrite` for kit and AI writes) | "It never undoes what I told it" | S | yes: additive `projects.profileAuthority?` map (field -> `user_confirmed`/`inferred`, confirmedAt) | CT-1 | Kit or `draftBusinessProfile` rerun after a confirm skips confirmed fields and returns a `suggest`; existing profile tests green; no client mutation writes `inferred` over `user_confirmed` | Suggestion surfaces later as a "Needs you" item, not a silent overwrite |
| 6 | HM-1 | `home.priorities` query | One ranked answer to "what now" | M | no | - | Reads only shipped tables (kit status, profile completeness, `projectVisits`, posts); no `capabilityRuns` dependency; ownership test; `ThisWeekNextStep` model outcomes preserved as rank inputs | Every item has a one-line plain reason for "Why this?" |
| 7 | HM-2 | Home "For you now" (consolidation) | Home stops being three competing cards | M | no | HM-1, FU-5 | e2e 320 px: kit found without scrolling past header; axe; `SinceYouWereAway` data now a subline (component kept for its data hook); `StarterKitCards` retry/resume still works; `ModuleGrid` below unchanged | Max 3 items; kit-running collapses to one progress card; one `aria-live` region; empty state "Nothing needs you right now" |
| 8 | HM-3 | Start-kit entry + "Looks right" | Closes the review loop | S | no | HM-2, KIT-2 | Button calls KIT-2 confirm mutation (owner only); no UI writes authority directly | Toast "Saved. MOSAI will not change this." |
| 9 | MD-1 | Media fields on `projectFiles` (additive) | Enables picker and quality note | S | yes: `kind`, `role`, `width`, `height`, `processingStatus`, `qualityFlags`, `authenticity`; `productMedia.projectFileId?`. No `camera` source, no `qualityScore`, no `mediaCrops` yet | - | Table test round-tripping every existing `source` (upload, owner_site, stock) with attribution; `importOwnerPhoto` still rejects a URL not in the server scan; stock import still writes `source: "stock"` + attribution; project deletion clean | Schema comment names each field's writer |
| 10 | MD-0 | MediaPicker, wired into kit posts | Own photos on posts in two taps | M | no | MD-1, HM-2 (Home frozen until merged) | Server mutation takes `projectFileId`, checks same project, resolves URL + attribution server side (never a client URL); foreign-project file rejected; existing Pexels attribution still shown; `Download picture` unchanged | Upload input has `accept="image/*"` + `capture` hint so phones offer the camera (replaces MD-3); focus returns to "Change picture"; picked picture fades in with existing `tw-animate` utility |
| 11 | MK-1 | `projects.marketContext` + deterministic resolver | Correct country/currency without asking | S-M | yes (additive `SourcedValue`) | CT-1 | No USD/en-US default when unresolved; `businessProfile.market` parsed only when it maps to exactly one ISO country; no public setter; `personas.country` untouched | Unresolved shows `needs_setup` wording "Tell us where you sell" |
| 12 | MK-3 | Settings "Market" row replaces "Where you sell" | One place for where/currency/language | S | no | MK-1, KIT-2 pattern | Old free text preserved and shown as "Areas you serve" note; `market.confirm` validates ISO codes server side, writes `user_confirmed`; ownership test; no event emitted (no AG-1 in MVP) | Badge "Estimated" flips to "You confirmed this" with announced toast |
| 13 | U12 | Five-owner sessions on the build with rows 1-12 | Proves or kills the next wave | owner | - | HM-2, KIT-F1, LQ-1, MD-0 | - | Additions in sec. 6 |
| 14 | MD-2a | Post-upload quality note (U12-soft-gated) | Fewer dark or blurry posts | M | no (MD-1 fields) | MD-1, U12 item 5 | Upload never blocked; decoder skips files over 15 MB or 24 MP (`unreadable`, not a guess); failure leaves file usable; HEIC = `unreadable` | Outcome words only ("Ready", "Usable", "Retake recommended"); copy "This photo looks a little dark. Use it anyway, or try another?" |
| 15 | MK-3b | Sell currency suggestion (D13) (U12 currency probe) | No wrong-currency shop | S | no | MK-1, U12 | Existing currency never changed; money stays integer minor units + code | Field hint "Suggested from your market" |

### Cut or deferred vs BIP (and why)

| BIP item | MVP status | Why |
|---|---|---|
| W0 | Done | Merged (7d8e949) |
| CT-2 ADR | Deferred to AG revival | Docs only; nothing in MVP registers capabilities or emits events |
| SEC-1 | Deferred with OD-1; interim: FU-5 note + ContextPack labels client-written scan text `untrusted_source_text` (1-line change inside KIT-2) | Coordinator verified it is provenance, not security; full server move only matters when OD-1 trusts scans |
| AG-1, AG-2, AG-4a | Deferred (D14 review after U12) | Plumbing with no owner-visible output; MK-3 and OD-2 were its only emitters and neither emits in MVP. Event types enter CT-1's union only with an emitter |
| AG-3 `modelClass`, KIT-1 cancel | Deferred | Low value at 100 signups/month; stuck kit handled by existing "Try again" and support |
| MD-0b Sell picker | Deferred | Sell is a Growth-plan module; not in the week-1 journey |
| MD-2c crop presets + `mediaCrops` table | Deferred; table renamed from `mediaVariants` to `mediaCrops` when it lands | No writer in MVP; "variant" already means SKU (`productVariants`) |
| MD-3 camera ticket | Folded into MD-0 (`capture` attribute) | One attribute; a captured file cannot be told apart from a gallery file, so no `camera` source value (truth rule) |
| MD-S sharp spike | Deferred until D4 has a paid reason | Nothing in MVP resizes server side |
| MK-2 CLDR into ContextPack | Deferred; only the Sell suggestion survives as MK-3b | Locale-flavored AI copy is polish; U12 probe first |
| MK-4 authority field | Deferred; copy label ships in FU-5 | Truth fixed by wording, no schema |
| OD-1, OD-2, OD-4 | Conditional backlog: build only if U12 shows Q2 friction | $0 path exists but value unproven; acceptance additions recorded in sec. 4 so they are not lost |
| OD-3, MK-5, AG-4b/c, MD-2b, MD-4 | Deferred (unchanged) | D3/D4/D5/D11/D14 |

---

## 4. Collision register

| # | Collision (found by) | Resolution | Owning ticket |
|---|---|---|---|
| C1 | Three "what now" blocks on Home plus AGENT NeedsYou/ReadyForYou (UX F3, UI) | One "For you now", max 3, server ranked; AGENT components are not built separately; SinceYouWereAway becomes the subline | HM-1, HM-2 |
| C2 | Picture picker vs Create "Sources for AI" vs kit inline picture (UX F4) | One `MediaPicker` for pictures; `SourcesPanel` stays text-only with its own label; never merged | MD-0 |
| C3 | Confirm card vs wizard Q1 (UX F1) | Card replaces Q1 on the resolved path; transition copy "Got it, one more thing" | OD-2 (deferred) |
| C4 | Market confirm vs wizard vs Settings (UX C4) | Settings only; never a wizard step | MK-3 |
| C5 | `marketContext` vs `businessProfile.market` vs `personas.country` (logic 1-2) | `market` is geographic free text ("Where you sell"), so MK-3 replaces that row; resolver reads it only on an exact single-country match; `personas.country` is audience targeting and never feeds `marketContext` | MK-1, MK-3 |
| C6 | Kit/AI draft overwriting owner-confirmed fields (logic 8) | `decideWrite` in kit and `draftBusinessProfile` writers; confirmed fields produce `suggest` | KIT-2 |
| C7 | `mediaVariants` vs `productVariants` naming (logic 4) | Rename to `mediaCrops`; create only with MD-2c | MD-2c (deferred) |
| C8 | `projectFiles.source` widening breaking stock/owner_site writers (logic 12-13) | No widening in MVP; table-driven round-trip test anyway | MD-1 |
| C9 | SerpApi shared free quota vs per-user limits (logic 18-19, biz) | Platform monthly ceiling + normalized-query cache; same row type counts Pexels (20k/month) | LQ-1 |
| C10 | Candidate pointer vs copy; TTL sweep blanking project provenance (logic 6) | `projects.create` copies scan fields onto the project in the same mutation; `discoveryCandidateId` is a reference only; sweep test proves project unchanged | OD-1 acceptance |
| C11 | Kit job reading half-written candidate fields (logic 7) | Copy commits in the creating mutation; kit scheduled after; test "kit's first AI call sees copied fields" | OD-1 acceptance |
| C12 | Agency member's own email domain resolved for a client project (logic 17) | Agency branch never resolves the member's email domain; only the URL typed for the client; candidate rows carry `purpose: own|client` | OD-1 acceptance |
| C13 | Schema hot spot: KIT-2, LQ-1, MD-1, MK-1 all edit `schema.ts` | Land one at a time in table order (LQ-1, KIT-2, MD-1, MK-1); last one asserts registry count == `defineTable` count minus documented exceptions | MK-1 |
| C14 | `Overview.tsx` touched by HM-2 and MD-0 | No other lane edits Home until HM-2 merges; MD-0 edits only `kit/PostsCard.tsx` | HM-2, MD-0 |
| C15 | Numeric quality score vs "no scores" rule (UI) | Store `qualityFlags` only; no `qualityScore` column | MD-1, MD-2a |
| C16 | U12 script assumes a 14-day Starter trial "per the owner's Q2 decision" while F1 is open | U12 runs on whatever DEC-F1 chooses; update script line 32 in KIT-F1 PR | KIT-F1 |

---

## 5. UI rules

### 5.1 Reuse map (new surface -> existing component)

| New surface | Build from | Genuinely new |
|---|---|---|
| "For you now" section | `SectionHeader`, `NextAction` card shape, `StatusBadge`, `ModuleEmpty`, `ModuleSkeleton`, `ModuleErrorState` | `ForYouNow.tsx` list shell; `WhyThis` as `Popover` text disclosure |
| Kit-running progress | `KitPartCard` step labels, `progress.tsx` only for real N of 3 | none |
| Since-you-were-away subline | `SinceYouWereAway` data hook | none |
| MediaPicker | `sheet.tsx` (phone) / `dialog.tsx`, `tabs.tsx`, `ModuleEmpty` per tab, existing Pexels credit markup from `PostsCard` | `MediaPicker.tsx` in `src/components/app/media/` |
| Quality note | `StatusBadge` tone + plain text in `aria-live` | none |
| Market row | `ProjectSettings` `FieldRow`, `select.tsx`, `StatusBadge`, `sonner` | none |
| Locked action (F1) | existing `locked` `ModuleEmpty` / capability words | none |
| Confirm card (deferred) | `FirstRunWelcome` layout, `ChoiceTiles` | thin wrapper only |

MediaPicker reuse rules: (1) the only picture chooser in the app; any later
surface (Create attach, Sell gallery, Build image block) opens it with a `role`
prop, never forks it; (2) it returns a `projectFileId`, and the server resolves URL
and attribution; (3) stock results always carry visible photographer credit;
(4) it never lists text sources; (5) Create and Sell integrations happen only
after the host component is extracted from the large page (AGENTS section 8).

### 5.2 States (every surface)
loading (skeleton), empty (plain sentence + one action), error (one concrete
next step, never bare "Error"), partial (`partially_succeeded` badge + note),
success, locked ("Needs Starter" plus what still works), needs_setup (LQ-1 copy).

### 5.3 Hard rules
No numeric scores, percentages, stars or confidence numbers anywhere (outcome
words only: "Ready", "Usable", "Retake recommended", "Estimated", "You confirmed
this"). Tokens only (`tile-*-soft/-ink`, type scale); no hex or `[Npx]` classes;
re-run the hex/px grep in each UI PR. 44 px targets, visible focus, one
`aria-live` region per list. No exclamation marks; second person; no
"found/verified/connected" for inferred values.

### 5.4 Copy table (FU-5)
capability -> "included in your plan" / never shown; artifact -> "draft";
provenance/evidence -> "where this came from" (only if needed); authority ->
"You confirmed this" / "MOSAI's best guess"; authenticity -> "your original
photo" / "edited by MOSAI"; Starter kit -> "your first plan, website & posts";
Brand kit -> "your colours, logo & voice"; wizard source -> "Your website or
Google listing"; Big Five -> "AI guess, not a real customer".

---

## 6. Metrics (no new tracking; existing tables)

| Slice | Metric | Source |
|---|---|---|
| KIT-F1 | % of new free projects with site + posts drafted; AI cost per kit | `starterKits` part status, `spentMicrousd`, `aiRuns` |
| Kit (baseline) | Time from start to all parts out of `queued/running`; part failure rate | `starterKits` timestamps |
| HM-2 | Outcome follow-through: % of projects where the top item's outcome row appears within 7 days (site reviewed, picture changed); return visits within 7 days | `projectVisits`, `profileAuthority.confirmedAt`, `posts` |
| KIT-2 | Suggestions produced vs overwrites (must be 0 overwrites) | `profileAuthority`, server log counter |
| LQ-1 | Monthly SerpApi and Pexels calls vs ceiling; cache hit rate; `needs_setup` responses | `providerUsageRollups`, `stockSearchCache` |
| MD-0 | % of kit posts whose picture came from `upload` or `owner_site` vs stock | `posts` + `projectFiles.source` |
| MD-2a | Share of uploads with a flag; share replaced after a flag | `projectFiles.qualityFlags` |
| MK-1/MK-3 | % projects with `marketContext` set, by authority | `projects.marketContext.authority` |

U12 additions (append to `docs/ux/u12-usability-test-script.md` section 6):
(a) "What would you do next?" asked on "For you now" before any click; pass = 4/5
name the top item. (b) Task: "Put your own photo on Monday's post"; record taps and
whether they found "Change picture". (c) Currency probe: after the kit, "What
currency do you think this shop uses?" (gates MK-3b). (d) F1 wording: does
"Publishing needs Starter" read as fair or as a trap. (e) Does the Pexels credit
read as honest or as "not mine". (f) If LQ-1 trips in a session, can they finish
by typing.

---

## 7. Owner decisions still open

**F1 / Q2. What does a free owner get from the starter kit?** (money, AGENTS section 7)
Today free completes onboarding and gets only the plan draft; site and posts show
"Needs the Starter plan". AI cost per kit is about $0.01 (ceiling $0.40).
- (a) Free may draft and preview the full kit; publish, deploy and schedule need
  Starter. One free kit per account (not per project) to stop project farming.
  Cost: about $1 per 100 signups; revenue risk: low, publishing stays paid.
- (b) 14-day Starter trial. Cost: same AI plus hosting of published sites during
  trial; today's checkout passes `trial_period_days` through Stripe, which asks
  for a card unless reconfigured, so "no card" needs a billing change (bigger PR,
  money flow).
- (c) Keep the gate with a clear blurred preview. Cost $0; U12 strategy predicts
  drop-off before any value.
- Recommendation: (a). Shows value before asking for money, keeps truth (nothing
  live), no billing change. Decide before HM-2 ships; U12 needs it.

**SP. SerpApi plan.** Free tier reportedly ~250 searches/month for the whole
platform; one signup uses 2-3 (listing search + details), research youtube also
draws from it; Google v. SerpApi litigation adds continuity risk.
- (a) Free tier + LQ-1 ceiling at 200/month, degrade to `needs_setup` (typed
  entry). $0. Enough for ~70-100 signups/month.
- (b) Paid SerpApi tier when ceiling is hit two months running. About $75/month
  (verify current price).
- (c) Replace with Google Places API (Text Search + Details) under a free monthly
  credit; ToS limits storage to place id; migration PR. $0 at low volume.
- (d) Make listing lookup opt-in ("Search Google for my listing") so only people who
  want it spend quota. $0, fewer calls.
- Recommendation: (a) + (d) now; plan (c) as the exit if the lawsuit or volume bites;
  never ship without the ceiling. Also confirm the Pexels key's monthly limit (20k).

**Remaining D-items (from OWNER-DECISIONS D1-D14):**
| # | Status now | Recommendation |
|---|---|---|
| D1 $0.40 kit ceiling | Open, 1 minute | Confirm; matters more if F1 (a) |
| D3 discovery provider | Open | No provider; OD lane only after U12 |
| D4 photo processing | Open | No provider; browser + `capture`; revisit only with a paid reason |
| D7 Workflow component | Open | Do not adopt (moot while AG deferred) |
| D8 Home one list, max 3 | Open | Approve; HM-2 depends on it |
| D10 auto-deploy of `main` | Open, only owner knows | Answer before KIT-2/MK-1 schema writes reach production |
| D12 email-domain lookup | Open | Keep rule; add agency rule C12 |
| D13 currency prefill | Open | Empty fields only, "Suggested" (MK-3b) |
| D14 agent spine scope | Changed | Stop before AG-1; review after U12 |
| D5, D6, D9, D11 | Closed or parked | Unchanged ($0) |

---

## 8. Reviewer claims rejected or corrected

1. UI and biz: `SinceYouWereAway.tsx`, `create/DraftDialog.tsx`, `DraftReport.tsx`,
   `SourcesPanel.tsx`, `wizard/ChoiceTiles.tsx`, `docs/ux/usability-strategy.md`,
   `u12-usability-test-script.md` "missing / unmerged": wrong; all on main 7d8e949.
2. Logic: plan "stale", `projectFiles` has no `source`, no `contentSources`,
   `projectVisits`: wrong commit (59bad44). On main: `source` + `attribution`
   exist, `contentSources` (schema.ts:1250), `stockSearchCache` (1463),
   `projectVisits` (1487), `lookupRateLimits` (2162), `aiSpendRollups` (2216).
3. Logic 1: `businessProfile.market` is "positioning text": corrected. It is the
   free-text "Where you sell" / "Country / market" field; see C5.
4. Logic 11: SEC-1 removal breaks onboarding: moot for MVP (SEC-1 deferred);
   coordinator verified `saveScan` excludes images, so it is provenance, not security.
5. Logic 18: platform counter "mirrors `aiSpendRollups`": adjusted; that table is
   USD-typed, and `lookupRateLimits` requires `userId`, so LQ-1 adds a tiny count
   table rather than overloading either.
6. BIP MD-3 `source: "camera"`: rejected; a file input cannot prove capture, so
   writing "camera" would be an unverified claim.
7. UX finding 4: "Create has no image attach": confirmed, and kept out of MVP
   (Create.tsx must be extracted first).
8. Biz: MK-1/MK-3 as MVP: accepted, but MK-2 cut to the Sell suggestion and gated
   on the U12 currency probe; biz's "click-through" metric replaced by outcome
   follow-through because no click analytics exist and none will be added.
9. Biz: AG-1 kept "because MK-3 and OD-2 emit into it": rejected for MVP; neither
   emits in MVP, and an events table without a consumer is the overbuild BIP warned about.
10. UI: before/after compare toggle for MediaPicker: deferred with generative edits
    (nothing in MVP produces an "after").

---

## 9. Binding amendments from the independent audit (coordinator-verified, 25 Sep 2026)

Supervisor 2 approved this plan with changes (`MVP-PLAN-AUDIT.md`). The coordinator
re-checked items A1, A3, A5 and A6 against `main` at `7d8e949`. Where this section
conflicts with sections 1-8, this section wins.

- **A1. F1 is decided, not open.** `docs/ux/usability-backlog.md:13` records the owner's
  25 Sep decision: a 14-day Starter trial, no free-plan exemption. The U12 script
  depends on it (`u12-usability-test-script.md:32`). DEC-F1 is therefore reduced to the
  one open sub-question: does the trial require a card? Today it does
  (`billing.ts:641-655` sends no `payment_method_collection`). Option (a) from section 7
  is withdrawn as the recommendation; if the owner ever revisits it, KIT-F1 is size M
  or larger because draft sites are read through `moduleQuery("build")`
  (`cms.ts:93,185,199`). Do not change the U12 script line.
- **A2. KIT-2 is rescoped.** The starter kit never writes `businessProfile`
  (it inserts contentPieces and posts only; the site part refuses to overwrite pages,
  `starterKit.ts:714-724`), and a confirmed profile is already protected
  (`projects.ts:506`). KIT-2 becomes field-level locks on the real writers:
  `ai.generateBusinessProfile` (`ai.ts:565`) and the brand rerun paths. Drop it if those
  paths already respect confirmation.
- **A3. HM-3 action fix.** "Looks right" on the website review marks the site draft as
  reviewed; it must not call the profile-lock mutation.
- **A4. LQ-1 covers every SerpApi caller:** listing search (`scraping.ts:388`),
  research (`research.ts:178`) and YouTube transcript import
  (`contentSourceImport.ts:112-120`).
- **A5. LQ-1 closes both leaks.** Replace search-as-you-type in
  `wizard/NameQuestion.tsx` with an explicit "Search Google for my listing" button
  (debounced typing currently spends a paid call per pause). Add a per-user daily cap
  of about 10 SerpApi calls on top of the platform monthly ceiling (the existing
  google_maps limit of 60 per 10 minutes in `guards.ts:1712` lets one account drain
  the month). Exhausted ceiling degrades to `needs_setup` with manual entry, never
  fake results.
- **A6. Abuse guard for trial AI spend.** Sign-in is email one-time code only
  (`auth.ts:6-10`), so accounts are cheap. Count the trial once per verified email and
  add a platform-wide daily cap on starter-kit AI spend, reusing `aiSpendRollups`.
- **A7. Truth rule for trials.** A site published during a trial must stop showing
  "live" once hosting stops (AGENTS.md rule 5).
- **Non-blocking, adopt:** relabel the persona "Country / market" field
  (`Understand.tsx:102,167`, sent to AI as "market" in `ai.ts:412,658`) in FU-5 so the
  owner never sees two "market" fields; MK-1 stores a list of markets with roles (per
  the market blueprint section 2) to avoid a later migration; media acceptance adds
  "the original photo file is never replaced" and the picker opens on "Your photos";
  HM-2 depends on DEC-F1; fold CT-1 into its first consumer PR so no PR is types-only;
  corrected paths `src/convex/lib/capabilities.ts:200` and
  `src/components/app/ProjectSettings.tsx:337`.

Blueprint basis: the four blueprints in `blueprints/` are the owner-supplied
authoritative versions (re-supplied 25 Sep and confirmed byte-identical).

## 10. Owner decisions recorded (25 Sep 2026)

- **DEC-F1 closed:** the 14-day Starter trial requires a card. Stripe checkout stays
  as it is (`billing.ts:641-655`); no billing change. KIT-F1 reduces to trial copy and
  the A6/A7 guards (once-per-verified-email trial, "live" ends when hosting ends).
- **D10 closed:** the owner merges every PR personally. Agents open PRs and drive them
  to green; they never merge to `main`.
- **D8 approved:** Home shows one "For you now" list, at most 3 items (HM-2).
