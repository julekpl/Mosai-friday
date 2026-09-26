# Discovery & Smart Onboarding: implementation plan (OD tickets)

Grounded in current main (this checkout), AGENTS.md, docs/ux/first-run-blueprint.md,
docs/integration/2026-09-25/INTEGRATION-PLAN.md, and
docs/integration/2026-09-25/blueprints/MOSAI-ORGANISATION-DISCOVERY-ONBOARDING-BLUEPRINT.md.
Owner decisions D1-D10 in the integration plan are binding; this plan does not
relitigate them, only D3/D5 are opened wider in section 4 because DISCOVERY is
the ticket set that spends them.

## 1. Critical review vs actual code

**1.1 The wizard already does most of "discover before asking."**
`src/components/app/NewProjectWizard.tsx` is a 3-question flow (type, name+source,
goal). At Q2 the owner can paste a website or pick a Google listing; the read
starts in the background (`readSources()`, NewProjectWizard.tsx:95-144) the
moment they leave Q2, keyed so back-and-edit never double-reads
(NewProjectWizard.tsx:78-82, 96-99). `handleFinish` (NewProjectWizard.tsx:158-239)
pre-fills `businessName`, `websiteUrl`, `industry`, `description`,
`productsServices` from the scan or listing, creates the project, saves the raw
scan (`saveScan`), fires `draftBusinessProfile` in the background, and starts
the starter kit. This is already "found, inferred, prepared" for the one signal
MOSAI can get without a paid provider: the owner's own website or a listing
they picked. The blueprint's executive-summary diagram (blueprint lines 14-30)
describes this loop as new work; for the website leg it is not. OD tickets
must say "reuse `readSources`/`scanWebsite`/`saveScan`", not build a second
crawl path.

**1.2 `websiteScan.ts` is already a fairly complete extractor.**
`src/convex/lib/websiteScan.ts` does robots.txt + sitemap crawling
(`parseRobotsTxt`, `isAllowedByRobots`, lines 126-194), JSON-LD organization/
product parsing (`collectJsonLd`, lines 208-244), heading/meta/description
extraction, social link detection, phone/email/address/country extraction
(lines 374-386), and page prioritization (`prioritizeSiteUrls`, lines 404-424)
that already ranks product/pricing/about/contact pages over blog/cart/login.
The blueprint's "extract business/brand/offering signals" step (blueprint
lines 20-22) is this file. What is genuinely missing for DISCOVERY: (a) domain
-> organization resolution when the signup email itself is the only input (no
website typed yet), and (b) a paid enrichment lookup for company facts a
website does not state (headcount, industry taxonomy, funding). Only (a) and
optionally (b) are new.

**1.3 GMB path is real but is a listing lookup, not company enrichment.**
`scraping.ts` exposes `lookupGoogleBusiness` used at NewProjectWizard.tsx:118;
it is address/phone/rating/category from a place the owner explicitly picked
from a list (`selectedBusiness`), never auto-applied. DISCOVERY's Apollo/
CompanyEnrich sections (blueprint lines 373-420) propose a different kind of
signal (firmographics) that the current schema and UI have no home for; do not
conflate "Google listing" (shipped) with "company enrichment provider" (not
shipped, gated behind D3).

**1.4 GDPR and cost risk is real and understated for the provider leg, not for
the website leg.** Crawling the owner's own website they typed in is first-party
data collected directly from the data subject's own published page; GDPR
Article 14 (indirect collection, blueprint line 1025) does not apply to it,
matching D5's split (OD-1/2 need no legal review). A domain-only resolve step
that queries a third-party company database (Apollo/CompanyEnrich) before the
owner ever typed a URL is indirect collection about a legal entity, and in
solo-founder/sole-trader cases indirect collection about a natural person, so
Article 14 transparency and a documented lawful basis apply the moment OD-3
makes a live call, not before. Cost risk: Apollo bills "one credit per
organization" enrichment (blueprint line 392) with pricing unconfirmed; a
domain-resolve-on-every-signup design without a budget guard would spend money
on every bot/duplicate/typo signup. Integration plan D1's $0.40 kit budget
covers AI, not enrichment credits; DISCOVERY needs its own budget line, which
the integration plan already scopes as D3 ("bake-off budget only if U12 shows
need"). Recommend a hard per-org monthly cap plus a dedupe-by-domain cache
(`organizationCandidates` with a domain unique index) before any live call.

**1.5 Weak/overreaching claims in the blueprint to drop.**
- The "Hi Anna, I found North Star Coffee... ✓ Brand style ✓ Likely customer
  groups" first-run mock (blueprint lines 91-115) promises brand style and
  audience inference from a domain alone; the current pipeline can only offer
  that once a website is actually scanned (post Q2), not from an email domain
  before any crawl. OD-2's confirm card must not show checkmarks for signals
  it has not actually gathered yet (AGENTS rule 5, no fake success, extends to
  UI: never imply "found" for something inferred/pending).
- Blueprint's 6 goal options ("More local customers", "Better content",
  "Improve our website", "I'm not sure") do not match the shipped
  `PRIMARY_GOALS` enum (`bookings|sales|visits|awareness`, see
  `src/shared/starterKit.ts`); integration plan already resolved this
  (collapse to 4 + "Not sure yet"). OD tickets must use the shipped enum only,
  never introduce a fifth goal source.
- Blueprint's `SourcedValue`/`EvidenceRef`/authority vocabulary (blueprint
  section 14, lines ~600-730) conflicts with AGENT's and MARKET's own versions
  (integration plan 4.1, items 1-2, 4-5). OD tickets must consume the
  reconciled shared contract in `src/shared/contracts/provenance.ts` (CT-1),
  not define a fourth `SourcedValue`.
- Blueprint proposes new tables `organizationCandidates`,
  `companyEnrichmentRuns` (blueprint line 1166) as if greenfield; these must be
  additive to the existing `schema.ts` and registered per AGENTS rule 12
  (deletion cascade / data registry), and are user-scoped (pre-project), which
  the cascade in `dal.ts` does not currently cover: needs an `accountCleanup`
  entry, not a `cascadeDeleteProject` entry (integration plan 4.2, "Registry").

## 2. Ticket list (OD-1..OD-6)

All OD tickets are Wave 5 in the integration plan: **gated, do not start until
U12 (docs/ux/first-run-blueprint.md test script) shows Q1/Q2 friction**, and
depend on CT-1 (`src/shared/contracts/provenance.ts`) and AG-1 (`domainEvents`
table + `emit` helper) landing first. Phase 1 is website/domain resolution
only; no paid provider call ships enabled.

### OD-1: `organization.resolve.v1` on domain + first-party website only
- Goal: given a signup email domain or a typed website URL, produce a
  candidate organization (name, website, inferred business type, confidence)
  using only the existing crawl path, no third-party company database.
- Files: `src/convex/organization/resolve.ts` (new, thin: derive domain from
  email -> `https://{domain}` -> call `scanWebsite`/`websiteScan.ts` exactly as
  `readSources()` does); `src/convex/schema.ts` (add `organizationCandidates`
  table, additive); `src/convex/dal.ts` or new `accountCleanup.ts` registry
  entry; `src/shared/contracts/provenance.ts` (consume, do not redefine).
- Schema (additive only): `organizationCandidates { userId, domain (unique
  index), status: pending|resolved|no_match|failed, businessName?,
  websiteUrl?, businessType?: BusinessType, scan: WebsiteScan snapshot,
  confidence, evidence: EvidenceRef[], createdAt, expiresAt }`. TTL/expiry so
  stale scans are not served into a confirm card months later.
- Tests: unit: free-mail domains (gmail.com, outlook.com, icloud.com, common
  regional providers) never resolve (must return `no_match` immediately, no
  crawl attempt, cite a maintained free-mail list not a guess); a work domain
  with a reachable HTTPS site resolves with evidence citing the scanned URL;
  a domain that fails DNS/`safeFetch` returns `failed` not `no_match` (UX
  differs, see section 3); a second resolve for the same domain within the TTL
  reuses the cached row (no duplicate crawl/cost). Convex-test for the mutation/
  action split (crawl is an action per existing `scanWebsite` pattern).
- Acceptance: no call reaches any host `safeFetch` would not already allow;
  zero new outbound provider; `bun run audit:functions` passes (this is a
  user-scoped, authenticated action, not a public no-auth function).
- Dependencies: CT-1 (provenance types), reuses `scraping.ts`/`websiteScan.ts`
  unchanged.
- Size: M (2-3 days). No UI.

### OD-2: Confirm card in the existing wizard + `business.confirmed.v1`
- Goal: when OD-1 resolved a candidate before the wizard opens (work-email
  signup), show a confirm card as a **replacement first screen** of
  `NewProjectWizard`, not a second flow. Three answers per integration plan
  3.1: Yes this is us -> goal question -> done; I'm setting this up for a
  client -> existing agency branch, re-run OD-1 on the client's site; Different
  business -> falls through to the normal 3-question wizard untouched.
- Files: `src/components/app/NewProjectWizard.tsx` (add an optional step 0
  branch, conditionally rendered only when a resolved candidate is passed in
 : do not restructure the `steps` array for the non-discovery path);
  `src/components/app/wizard/ConfirmCard.tsx` (new, follows `BusinessTypeQuestion.tsx`
  patterns for focus/keyboard); wherever signup currently routes into the
  wizard (check `src/pages/` auth callback) to pass the OD-1 result down.
  `src/convex/projects.ts` `create`/`createClientProject` gain an optional
  `provenance`/`resolvedFrom` field (additive) so the created project can cite
  the confirm-card source, not a bare string.
- Schema: none beyond OD-1's; add `business.confirmed.v1` to `domainEvents`
  (depends on AG-1).
- Tests: component test: candidate found -> confirm card renders editable
  name/website/type, all three answers navigate correctly, no field is shown
  as a checkmark/"found" for data OD-1 did not actually return (closes 1.5);
  a11y test: confirm card keyboard reachable, focus lands on heading (matches
  `focusStepHeading` pattern at NewProjectWizard.tsx:56-62); e2e: full signup
  with a seeded resolved candidate ends on `/app/{id}` in <=2 screens.
- Acceptance: screen cap enforced (owner path with a resolved candidate = 2
  screens: confirm, goal; without one, wizard is unchanged at 3 screens;
  agency path still <=4). No candidate data written to `projects` until the
  owner clicks "Yes, this is us" or edits and confirms (client input is
  proposed, not trusted, until confirmed: AGENTS rule 3 extended to the
  confirm card).
- Dependencies: OD-1, CT-1, AG-1 (event), integration plan FU-5 (copy pass)
  should land first so wording matches ("Business website or listing").
- Size: M (3-4 days). UI change; **blocked on U12 gate** (integration plan
  3.1 "Gate", D2).

### OD-3: Enrichment provider adapter, built disabled
- Goal: implement one provider adapter (Apollo or CompanyEnrich, owner picks,
  D3) behind a feature flag that defaults off in every environment, so OD-1's
  candidate can optionally be enriched with firmographics once the owner
  approves spend and legal signs off (D5). No code path calls the provider
  unless the flag is explicitly on.
- Files: `src/convex/organization/providers/apollo.ts` or `companyEnrich.ts`
  (new, one file, mirrors the ads/social adapter pattern already used in
  `src/convex/ads/`); `src/convex/lib/featureFlags.ts` (or wherever existing
  flags live: grep before adding a new mechanism); `companyEnrichmentRuns`
  table (additive, user-scoped, registered in `accountCleanup`).
- Schema: `companyEnrichmentRuns { userId, domain, provider, status:
  queued|succeeded|failed, idempotencyKey, receipt (raw provider response id),
  costCredits, createdAt }`. Idempotency key per AGENTS rule 6; every external
  write needs a receipt even though this is a read-mostly call, so retries are
  provably safe and auditable for the budget cap.
- Tests: unit: flag off means the action throws/no-ops before any `fetch`
  (assert no network call, e.g. via a spy that fails the test if reached);
  flag on but budget cap exceeded for the month returns `unavailable`, never a
  fake enrichment result; provider timeout/error maps to `failed` with receipt
  showing the attempt, not silently swallowed (AGENTS rule 6).
- Acceptance: with the flag off (default), `bun run audit:functions` and
  `bun run check` are unaffected; the adapter is reachable only from OD-1's
  resolve path and only for authenticated, project/account-owning callers.
- Dependencies: OD-1; **owner decision on provider (D3) and GDPR Article 14
  notice (D5) must be closed before the flag is ever turned on** in any
  environment, including staging with real domains.
- Size: M (3-4 days), most of it the adapter's mapping/error handling, not UI.
  Ships with the flag off; turning it on is a separate, reversible config
  change, not a code change.

### OD-4: Benchmark script (accuracy, cost, latency)
- Goal: a repeatable, offline-runnable script that measures OD-1's website-
  only resolve against a fixed seed set of real business domains (owner-
  supplied, not scraped from prospects), so D3's "bake-off" decision has data
  instead of the blueprint's unverified vendor claims (blueprint explicitly
  disclaims vendor identity for Ploy, lines 161).
- Files: `scripts/benchmarkOrgResolve.mjs` (new, follows the `scripts/`
  pattern of `audit-public-functions.mjs`); a small fixture file of domains +
  expected business name/type (not committed with real customer PII: use
  MOSAI's own team's public businesses or public test fixtures).
- Tests: the script itself needs a dry-run mode test (assert it does not call
  `safeFetch` against non-fixture hosts); no acceptance criteria beyond "runs
  in CI as `bun run bench:org-resolve` and prints a report", it is a tool, not
  a shipped feature.
- Acceptance: report includes match rate, false-positive rate (wrong company),
  p50/p95 latency, and, once OD-3 exists, cost per resolved org with the
  provider enabled vs disabled: this is the artifact D3's "bake-off" needs
  before any provider is turned on for real users.
- Dependencies: OD-1 (required), OD-3 (optional, only needed for the
  cost/accuracy delta run).
- Size: S (1-2 days).

### OD-5: Ambiguous-match and ownership-conflict handling
- Goal: OD-1 sometimes resolves a domain to zero, one, or multiple plausible
  organizations (subdomains, rebrands, franchise sites); OD-2's confirm card
  needs a defined behavior for "not confident" that is not a silent guess.
- Files: `src/convex/organization/resolve.ts` (confidence threshold, return
  `no_match` below it rather than a low-confidence guess); `ConfirmCard.tsx`
  fallback state (falls straight into the normal 3-question wizard with no
  card shown, per integration plan 3.1 "No domain, personal email... the
  3-question wizard as shipped").
- Schema: none beyond OD-1.
- Tests: unit: confidence below threshold never reaches the UI as a
  candidate; two existing MOSAI projects already claim the same domain
  (someone else's account) -> resolve must not leak that other account's data
  into this signup's candidate (ownership check, AGENTS rule 2 applied to a
  pre-project resolver).
- Acceptance: no scenario produces a confirm card the owner did not ask for
  and cannot dismiss into the plain wizard in one tap.
- Dependencies: OD-1.
- Size: S (1-2 days).

### OD-6: Docs and STATUS update
- Goal: record OD-1..5 as done/partial in `docs/pack/STATUS.md`, update
  `docs/ux/first-run-blueprint.md` if U12 findings changed the screen caps,
  and add the confirm-card path to the U12 test script's scenarios.
- Files: `docs/pack/STATUS.md`, `docs/ux/first-run-blueprint.md`, whichever
  file holds the U12 script (see `docs/ux/*.md`).
- Tests: none (docs).
- Acceptance: STATUS accurately reflects flag-off state of OD-3 so no future
  agent assumes enrichment is live.
- Dependencies: OD-1..OD-5 merged.
- Size: XS.

## 3. Exact UX flow per path (reconciled with the shipped wizard)

All paths share the same 3-question `NewProjectWizard` skeleton (type, name+
source, goal) unless noted. Screen counts follow integration-plan caps: owner
<=3, agency <=4, discovery <=2. A confirm card counts as one screen.

**Work email, high-confidence resolve (OD-1 returns a resolved candidate
before the wizard mounts).** Screens: 2.
1. Confirm card (OD-2): business name, website, inferred type shown editable
   inline, each field visibly marked as found-from-website (not a bare
   checkmark list); three buttons: "Yes, this is us" / "I'm setting this up
   for a client" / "Different business".
2a. "Yes, this is us" -> goal question (shipped `GoalQuestion`, 4 options +
    "Not sure yet") -> `handleFinish` runs unchanged (create, saveScan from
    OD-1's snapshot, draftBusinessProfile, startKit). Total: 2 screens.
2b. "I'm setting this up for a client" -> falls into the existing agency
    branch at wizard step 0 with `businessType` pre-set to `agency`; OD-1
    re-runs on the client's own site once they type it at the name+source
    step. Total: back to the shipped agency flow, <=4 screens (blueprint's
    own diagram never claims agency stays at 2; integration plan cap applies).
2c. "Different business" -> discard the candidate, render the normal 3-
    question wizard from step 0. Total: 3 screens (no time lost, no card
    counted against the cap since it was dismissed in one tap).

**Personal email (gmail/outlook/icloud/etc.) or work email that fails to
resolve (OD-1 returns `no_match` or `failed`).** Screens: 3 (unchanged today).
No confirm card is shown; OD-1 either was never called (free-mail domains
short-circuit per OD-1's dedupe list) or ran and found nothing. The wizard
proceeds exactly as shipped: type, name+source (owner may paste a website or
pick a Google listing here, which still runs `readSources()` today), goal.
This is not a regression path to explain to the owner; it is the current
product with no visible change.

**Agency signing up.** Screens: <=4, unchanged from shipped (type=agency,
client type, client name+website, goal). OD-1 may run in the background once
the client's website is typed at the name+source step, exactly like today's
`readSources()`, so the client's confirm-worthy facts land in `saveScan`
without adding a screen. No confirm card is inserted into the agency path in
Phase 1; a future ticket could add one (out of OD-1..6 scope).

**No website (owner has only a Google listing, or neither).** Screens: 3.
Same as personal-email path: OD-1 has nothing to resolve from a bare email
domain that is not a business, and Q2's Google listing picker (shipped) is
the enrichment. No new screens.

**Ambiguous match (OD-5: multiple candidates or confidence below threshold).**
Screens: 3. Treated identically to `no_match`: no confirm card, straight to
the shipped 3-question wizard. Showing a disambiguation picker ("Which of
these is you?") was in the blueprint's spirit but is explicitly out of MVP
scope per the integration plan (4.1 item, "DISCOVERY... ambiguous matching...
out of MVP in the blueprint itself"); OD-5 exists to make sure ambiguity fails
closed to the safe, already-shipped path, not to build a picker UI.

## 4. Owner decisions (AGENTS §7, all already flagged in the integration plan;
restated with the DISCOVERY-specific stakes)

- **Provider (D3).** Confirm: Phase 1 ships with no provider call, ever, by
  default (OD-1 is website/domain-only). Decide only after OD-4's benchmark
  report exists whether Apollo or CompanyEnrich is worth turning on for OD-3,
  and at what per-org credit cap. Recommendation unchanged from integration
  plan: resolver-only for now.
- **Budget.** OD-3's `companyEnrichmentRuns` needs its own monthly credit cap,
  separate from the $0.40 starter-kit AI budget (D1). This is a new number the
  owner has not set; recommend starting at $0 (flag off) and setting a cap
  only when D3 is answered yes.
- **Privacy notice (D5).** A GDPR Article 14 notice is required before OD-3's
  flag is ever enabled in any environment that touches real signups (indirect
  collection about a company, potentially a natural person for sole traders).
  OD-1/OD-2 need no such notice: they only read the domain/website the owner
  themselves is signing up with or typed in, first-party collection. Legal
  review is a hard gate on OD-3, not on OD-1/OD-2/OD-4/OD-5/OD-6.
