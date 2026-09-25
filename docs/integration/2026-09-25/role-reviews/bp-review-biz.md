# MOSAI blueprint review: business/product read (25 Sep 2026)

Source: BLUEPRINT-IMPLEMENTATION-PLAN.md, OWNER-DECISIONS.md (D1-D14),
STATUS.md, usability-strategy.md + u12-usability-test-script.md (read from
branches `claude/app-usability-strategy-3zujnt` and
`claude/u12-test-script-and-status`; not yet merged to main: flag below).

## 1. Value ranking by ticket group

| Group | Owner outcome | Evidence | Effort | Cost | User-visible in 2-4 wks? |
|---|---|---|---|---|---|
| HM-1/HM-2/HM-3 (Home "For you now") | Cuts 10+ equal choices to one ranked next step; directly fixes usability findings F2/F5 (no result, no clear action) | Strong: code-verified findings, cites file:line, matches "one next step" north star | S+M+S | $0 | Yes: first thing shipped, gates U12 |
| U12 (usability test) | Validates whether starter kit + Home actually gets an owner to value in <10 min | Strong: pass bar defined (4/5 reach "kit ready", can name next step) | owner-run, no eng cost | ~thank-you incentive only | Not a build, but decision gate for everything after |
| Discovery OD-1/OD-2 | Prefills business info from own site scan: less typing, feels "it already knows me" | Medium: real friction (F3, 12 optional fields) but gated behind U12; no paid provider so upside is modest | M+M | $0 (no vendor; SerpApi listing already shipped) | No: explicitly gated on U12 friction result, waves 5+ |
| Agent spine AG-1..AG-4a, KIT-1 | Mostly plumbing (events table, registry, run tracking); AG-4a wraps one existing capability with idempotency/evidence, no new user output | Weak-to-none for user value in this slice; plan itself calls AGENT "overbuilt" and stops deliberately at D14 | M+S+S+M+S | $0 | No: pure infrastructure, no UI change |
| Media picker/quality/camera MD-0/1/2a/2c/3/0b/S | Real pain today: kit posts and Sell gallery need pictures; quality nudge and camera capture reduce bad photos and manual URL-pasting | Medium-strong: ties directly to U12 item 5 ("posts with no/few pictures") and Sell's URL-only rows | M+S+M+S+S+S+S | $0 (browser crop + free "sharp" spike; no Cloudinary/Cloudflare yet) | Partially: MD-0 (picker) is usable within weeks; MD-2a/2c/3 are incremental polish |
| Market MK-1..MK-4 | Correct currency/locale prefill in Sell and AI copy; avoids a US-default embarrassment for non-US owners | Medium: real but narrow (one Settings row, one Sell prefill); not a top usability finding | M+S+S+S | $0 | Marginally: MK-1..3 ship early (no U12 gate) but the win (correct currency) is a background correctness fix, not a felt "wow" |

**Ranking (value/effort, high to low):** HM-2 > U12 > MD-0 > MK-1..3 (cheap,
correctness) > MD-2a/2c/3 > OD-1/OD-2 (gated, real but delayed) > AG-1..4a/KIT-1
(plumbing, defer more).

**Plumbing vs. felt value in weeks 2-4:** Home redesign and the media picker are
the only groups a small-business owner actually *sees* by week 4. Agent spine,
CT-1/CT-2 contracts, and most of MK are invisible infrastructure or one-line
Settings changes: correct to build, wrong to market as "shipped features."

## 2. MVP cut line

**Smallest set that proves the promise** (one shared context powering website +
posts + growth, for a paying owner): W0 merge, HM-1/HM-2 (one ranked next step),
the already-shipped starter kit (website + 7 posts + plan), MD-0 (photo picker
so posts/site have real pictures instead of stock-only or broken URLs), MK-1/MK-3
(currency/locale so Sell isn't silently wrong for non-US owners), and U12 itself
to prove it lands. That is the whole loop: sign up → kit → editable result →
one next step → correct currency if they sell something.

**Cut or defer further than the current plan:**
- OD-1/OD-2 (discovery resolver + confirm card): the plan already gates this on
  U12; I'd go further and treat it as a *conditional* backlog item, not a
  scheduled Wave 5. Ship only if U12 shows the 12-field wizard is really the
  blocker (F3), not just "would be nice."
- AG-3 (modelClass hint) and KIT-1 (cancel path): real but low-value; a stuck
  starter kit is rare at 100 signups/month and can be fixed by support/admin
  panel by hand for now. Defer both to a "if support tickets show a pattern"
  trigger.
- MD-2c (crop presets) and MD-3 (camera capture): nice, not needed to prove the
  loop; MD-0 + MD-2a (quality nudge) cover the real pain (bad or missing photos).
- MK-2 (CLDR into ContextPack for AI copy): defer; MK-1+MK-3 already fix the
  money-adjacent risk (Sell currency). Locale-flavored AI copy is polish.

**Plumbing that must stay (prevents rework):** CT-1 (shared provenance/event
contracts): cheap (S) and every other ticket in every lane references its
types; skipping it means MD-1, MK-1, OD-1 each invent a slightly different
`SourcedValue`, which is exactly the kind of drift AGENTS.md rule 10 exists to
prevent. AG-1's `domainEvents`/`capabilityRuns` tables are more debatable, but
worth keeping *only because* MK-3 and OD-2 already plan to emit into it: better
one small shared table than three ad hoc ones later.

## 3. Cheap success metrics per shipped slice

- **HM-2 (Home redesign):** click-through rate on the single "This week" card
  vs. today's baseline of scattered module-card clicks (log via existing route
  analytics / `projectVisits`); % of sessions where the next click matches the
  suggested action.
- **Starter kit (already shipped):** `starterKits.spentMicrousd` vs the $0.40
  ceiling (cost sanity, already instrumented); time from "Make my starter kit"
  to all three cards leaving `queued`/`running` (the U12 "waiting time" metric,
  pulled from job-state timestamps, no new instrumentation needed).
- **MD-0 (media picker):** % of kit posts and Sell products with a real photo
  (not stock, not broken URL) before vs. after, countable from `projectFiles`/
  `productMedia` rows.
- **MK-1/MK-3:** % of new projects with `marketContext` resolved (vs. `unset`)
  broken down by authority (`first_party`/`provider`/`user_confirmed`): cheap
  aggregate query, no new table.
- **aiRuns:** cost per kit and failure rate, already the natural dashboard for
  "is AI usage under control" at 100 vs 1,000 signups.

**What U12 must test from these blueprints specifically:** the script already
covers this well: item 0 (finding the kit at 320px under the header), item 3
("Draft, not on the web yet": the truth rule, directly tests AGENTS rule 5),
item 5 (posts with no/few pictures: directly tests whether MD-0/MD-2a are
needed at all before building them), and item 7 ("Needs the Starter plan" -
tests the F1 paywall-before-value finding, which the strategy doc flags as an
unresolved owner decision, Q2). I'd add one explicit probe: after the kit
renders, ask "what currency do you think this shop is in?" to sanity-check
MK-1/MK-3 before investing further there.

## 4. Monetization / cost sanity

Per OWNER-DECISIONS.md D1-D4 (source figures, not re-derived here):
- **At 100 signups/month:** AI ~$1-2 (gpt-4o-mini default, $0.40 ceiling never
  bites), photo processing $0 (browser crop + free sharp-in-Convex spike),
  SerpApi listing search sits right at its free-tier boundary (100-250
  searches/month, one signup uses 2-3): the one real near-term cost risk.
  Total new spend: ~$1-2/month plus $0 vendor risk if SerpApi's free tier holds.
- **At 1,000 signups/month:** AI scales linearly to ~$10-20/month (still trivial
  given the $0.40 ceiling is a safety cap, not the real cost driver: the real
  driver is which model admin defaults to). SerpApi free tier is blown through
  10x over; either pay SerpApi's next tier, switch to Google Places API (~1,000
  free "Place Details" calls/month then ~$20/1,000, but ToS restricts long-term
  storage to the place ID only), or make the listing search opt-in/rate-limited
  per project. Photo volume rises to ~10,000/month; still within sharp-in-Convex
  if the MD-S spike holds: Cloudflare Images' 5,000 free unique transforms/month
  would be exceeded and fail closed (no surprise bill) rather than cost money,
  worth knowing if MD-S fails.
- **Recommended options:** stay on gpt-4o-mini default, no paid enrichment
  (D3/D11 = $0), sharp-in-Convex for photos (D4), SerpApi with a dashboard watch
  and a fallback plan to Google Places if usage/lawsuit risk materializes.
- **What could justify a paid tier later:** discovery/enrichment beyond the free
  website scan (CompanyEnrich/PDL, ~$49-98/month: only if OD-4's benchmark
  shows a real accuracy gap), automatic smart-crop/generative photo editing
  (Cloudinary, ~$89-249/month: only past ~50k photos/month or explicit
  customer asks), and a premium AI model tier for higher-quality copy (the $0.40
  ceiling already supports this as an add-on without re-architecture).

## 5. Risks to owner trust, and cheapest mitigation

- **Fake-looking discovery** (a confirm card that guesses wrong, or reads as
  "we already know everything about you"): mitigated by design already: OD-2's
  copy bans "found/verified/connected" for inferred values, uses "Our guess,"
  and writes nothing until the owner confirms. Cheapest add: make sure U12 asks
  the trust-concern debrief question specifically about this card if OD-1/OD-2
  ever ship.
- **Wrong market/currency**: a shop showing the wrong currency to real buyers is
  a credibility and possibly legal problem. Mitigated cheaply by MK's "prefill
  empty fields only, labeled Suggested, never overwrite" rule (D13): keep this
  rule strict; do not let a later ticket "helpfully" auto-correct an existing
  value.
- **Low-quality or missing photos**: the single most likely first-run
  disappointment per U12 item 5 and finding F11 (Pexels quota is shared across
  the whole app, 20,000/month). Cheapest mitigation: ship MD-2a's non-blocking
  quality nudge (upload never blocked, just a plain-language suggestion) before
  any generative/paid photo feature, and monitor Pexels usage so stock photos
  don't silently disappear at scale.
- **Paywall before value** (F1: free plan can't get a website or a post at all):
  this is the single biggest trust risk in the whole review: an owner does the
  work of a 3-question wizard and hits "Needs Starter plan" before seeing
  anything. It is an open owner decision (strategy §6 Q2, recommends free
  preview + paid publish/schedule) that the blueprint plan does not visibly
  resolve. Flag this up: it should be decided before HM-2 ships, not after.
- **General "is this real" doubt** from the monospace/terminal visual theme
  (F7) reading as a developer tool to a hairdresser or café owner: cheap
  mitigation is to add the strategy doc's trust-concern debrief question to
  U12 rather than a redesign; only act on it if 3+ of 5 owners raise it.

## Note on sourcing

`docs/ux/usability-strategy.md` and `docs/ux/u12-usability-test-script.md` are
not present on `main` in this checkout; they exist only on unmerged branches
(`claude/app-usability-strategy-3zujnt`, `claude/u12-test-script-and-status`)
and were read from there. Findings F1-F11 and the U12 script cited above should
be treated as proposed, not yet accepted into the plan: worth reconciling with
BLUEPRINT-IMPLEMENTATION-PLAN.md before Wave 2, since F1 (free-plan paywall) and
F5 (Home clutter) directly overlap HM-1/HM-2's scope.
