# MOSAI Country, Culture & Psychographic Intelligence - Implementation Plan (MK)

Scope: the narrow "Wave 6: market" slice already agreed in
`docs/integration/2026-09-25/INTEGRATION-PLAN.md` (MK-1..MK-3). Big Five
population priors and World Values Survey are cut per the binding decision
(D6) and are not re-opened here.

## 1. Critical review

### What earns its keep
The blueprint (2,913 lines) covers a full personality-prior pipeline,
WVS/EVS ETL and weighting, and a large evidence taxonomy of its own. Against
the current codebase, three things give real, shippable value:

1. **A resolved market context per project** (country, currency, locale)
   derived from data MOSAI already has (confirmed address, site scan,
   `businessProfile.market` free text) instead of being guessed inline by
   whichever prompt needs it. Today `businessProfile.market` (schema.ts:48)
   is an untyped free string and `personas.country` (schema.ts:406) is a
   free string the AI fills in with no cross-checking. Nothing feeds
   currency or number/date format into Build or Sell.
2. **CLDR locale/currency/language data** feeding AI content generation
   (`src/convex/ai.ts`), the Sell currency field (schema.ts:641, 1694) and
   Build's `lang`/format defaults. Static, license-clean, keyless data -
   best value-per-line item in the blueprint.
3. **A handful of World Bank digital-context indicators** (internet
   penetration, mobile subscriptions, connection quality) cached per
   country, used only as a soft Build hint, never a gate.

Everything else (gender indicators, GDP/income series, a "world model," a
provider health page, a redistribution-safe WVS pipeline) is speculative
value for a small-business tool or blocked on legal review the owner has not
done, and stays cut.

### Factual claims worth flagging (not browsed, per instructions)
- **[S1] CIA Factbook sunset "4 February 2026."** Consistent with today's
  date (2026-09-25) being after it, but not independently fetched here.
  Low risk: the only thing the ticket needs ("do not depend on Factbook")
  holds regardless of the exact date. Cite as "per the blueprint's source,
  unverified here" rather than restate the date as fact in code comments.
- **[S11] IPIP-NEO-120, 130,602 participants / 22 countries / ~1.8% of
  trait variance explained by country.** Direction matches well-known
  personality-psychology findings (nationality explains little Big Five
  variance) and is reasonable rationale for cutting population priors
  (D6), but the exact figures are not independently checked. Use as
  supporting rationale, not as a precise number in user-facing copy.
- **[S17] WVS non-profit / no-redistribution terms.** Consistent with WVS's
  publicly known licensing; keep WVS cut (already decided).
- World Bank Indicators API v2 (keyless), World Bank Gender Data Portal via
  the same API, and Unicode CLDR are stable, well-known public
  infrastructure that does not need independent verification for planning.

### Big Five today, and the label question
`src/convex/ai.ts` (`PERSONA_JSON_SHAPE`, `parsePersona`, ~lines 104-155)
has the model invent `bigFive` scores (0-100/trait) inside one free-form
persona-generation call grounded only in the business brief - no population
data, no country prior, no statistical anchor. Same call that invents the
persona's name and pains. The prompt already calls these "Big Five
hypotheses (0-100, non-clinical)" when reused later (`ai.ts:545`), and
INTEGRATION-PLAN.md already states: *"Existing `persona.bigFive` stays,
labeled `inferred` unless user-confirmed."*

That intent has no structured provenance yet: `bigFive` is a plain object on
the persona row, no `SourcedValue`/authority wrapper. Once CT-1's
`SourcedValue`/`EvidenceRef` land, `persona.bigFive` should default to
`authority: "inferred"` (lowest tier), promotable to `user_confirmed` only
if a human edits the sliders. It should be labeled `inferred`, not
`ai_hypothesis` - that is not a tier in the reconciled authority order
(`user_confirmed > accepted_artifact > first_party > provider >
public_source > population_prior > inferred`). UI copy can still say
"AI hypothesis, not a real customer" for readers; the stored field should
use the shared vocabulary so persona/business/market context render
consistently.

## 2. Tickets

Dependencies for all tickets: **CT-1** (`src/shared/contracts/provenance.ts`
- `EvidenceRef`, `SourcedValue`, authority order) must have landed. **OD-1/
OD-2** (organization resolve + onboarding confirm card) give a first-party
confirmed address; if not yet built, MK-1 falls back to site-scan-derived
country/locale only and re-reads the confirmed address once OD lands (no
schema change needed for that upgrade).

### MK-1 - `ProjectMarketContext` + `market.resolve.v1`
**Goal:** one authoritative, versioned market context per project (country,
ISO currency, primary locale), replacing scattered free text.

**Files:** `src/convex/market/resolve.ts` (new, `market.resolve.v1`
capability: resolves `SourcedValue<{country, currencyCode, primaryLocale}>`
in authority order - user-confirmed setting > OD-confirmed address >
site/domain TLD + detected page language from the existing scan/`safeFetch`
pipeline > `businessProfile.market` free text (`inferred`) > unresolved
(`needs_setup`, never a silent guessed default)); `src/convex/schema.ts`
(additive `projects.marketContext: v.optional(v.object(...))` holding the
`SourcedValue`; existing `market`/`country` fields kept read-only for
back-compat); `src/convex/agent/registry.ts` (register alongside AG-2's
capabilities once that exists).

**Tests:** authority fallback order (user-confirmed > site-scan >
free-text > `needs_setup`); regression that a client cannot spoof a
country (must resolve server-side, AGENTS rule 3).

**Acceptance:** `marketContext` populates for a project with a confirmed
address with no new provider call; never invents a country from no
evidence; `bun run audit:functions` and `check:codegen` pass.

**Dependencies:** CT-1; OD-1/OD-2 (degrades gracefully if absent). **Size:** M.

### MK-2 - CLDR locale/currency into `ContextPack`
**Goal:** real locale/currency/number-format defaults into AI content and
Sell's currency field, from static CLDR data, no API key.

**Files:** `src/convex/lib/cldr.ts` (new - a small, checked-in CLDR
territory/language/currency subset, generated at build time from a vendored
CLDR package or committed static JSON; no live network call at request
time, keeps `bun.lock` the only lockfile per AGENTS §4); `src/convex/lib/
contextPack.ts` (extend `ContextPack` with optional `market?: {country,
currencyCode, primaryLocale, currencySymbol, dateFormat}`, added to
`ai.ts`'s evidence as `static_reference` trust - a new `ContextTrust` value,
flag for CT-1 to define once centrally); `src/convex/ai.ts` (pass market
context into prompts; no change to `parsePersona`'s Big Five handling,
tracked separately per §1).

**Tests:** known country resolves to correct currency/locale; unresolved
market falls back to "unavailable" formatting hints, never a silent
USD/en-US default (rule 5).

**Acceptance:** Sell's currency field can be pre-filled (never auto-changed
without confirmation) from `marketContext`; generated content for a
non-US project uses the right currency symbol.

**Dependencies:** MK-1. **Size:** S.

### MK-3 - World Bank digital-context cache (Build performance hints)
**Goal:** a few slow-changing digital-infrastructure indicators per
country, cached, used only as a soft Build hint, never a gate or a claim
about the specific customer.

**Files:** `src/convex/market/worldBank.ts` (new provider adapter, World
Bank Indicators API v2, keyless, called only through `safeFetch` per rule 8
even though the URL is server-built from a country code, not raw user
input); `src/convex/schema.ts` (new table `marketDigitalIndicators`,
**country-scoped shared reference data, not project/user data** - keyed by
ISO country code, no `cascadeDeleteProject` entry needed, but one line in
`lib/dataRegistry.ts` marking it non-personal so the registry audit does
not flag it as orphaned); `src/convex/crons.ts` (low-frequency refresh job,
standard job states per rule 13, only for countries actually resolved by a
project's `marketContext`, not all ~200); Build's supporting server code
(surface as a read-only hint string, e.g. "slower mobile networks common
here, keep hero images light" - never a raw number shown to the end
customer).

**Tests:** provider adapter returns `needs_setup`/`unavailable` (never
fabricated numbers, rule 5) when unreachable; cron only fetches
markets-in-use; idempotent cache write (rule 6, receipt = the World Bank
response's own `lastupdated` field).

**Acceptance:** a Build session for a resolved market shows a hint sourced
from a cached value with its retrieval date on hover; unresolved market
shows nothing.

**Dependencies:** MK-1. **Size:** M.

**Source licence registry:** required because MK-3 is the only ticket that
ingests third-party data. One entry each in a small `docs/pack/
data-sources.md`: World Bank Indicators API (CC-BY 4.0, attribution in the
hint's tooltip); Unicode CLDR (MK-2, permissive license, attribution in an
about/NOTICE page, not per-value - also ingested as a build-time asset, so
it belongs in the same registry even though it is not a live call). No
entry for WVS/Big Five priors since both are cut.

## 3. UX: where markets get confirmed

Two surfaces, matching the existing OD confirm-card pattern rather than a
new flow:

1. **Onboarding confirm card (primary).** Under OD-2's confirmed address,
   add one read-only line: "Market: `<country>` · `<currency>` ·
   `<locale>`" with a "That's not right" link opening a plain
   country/currency picker (three fields, no map) that writes a
   `user_confirmed` `marketContext`. No new wizard step - rides the
   existing confirm step.
2. **Project Settings (secondary, always available).**
   `src/components/app/ProjectSettings.tsx` gets one "Market" row with the
   same three fields plus an authority badge ("confirmed" vs "estimated",
   design-system rule 15), editable any time - the only place to correct a
   market after onboarding.
3. No new screen for Big Five or persona nationality; stays in the existing
   persona editor, re-labeled per §1 once CT-1 lands.

Both surfaces write through a `market.confirm` mutation requiring
ownership (`requireProject`, AGENTS rule 2) - never a raw client-supplied
country string accepted as `user_confirmed` directly.

## 4. Owner decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| MKD-1 | Ship MK-3 with MK-1/2, or defer until Build has a hint slot? | ship together / defer MK-3 | Defer MK-3; land MK-1/MK-2 first since Sell/AI already consume them |
| MKD-2 | CLDR data: vendor static JSON vs. npm package at build time | static JSON / npm package | npm package via `bun install`, generated into a committed file by a `scripts/` step, so `bun.lock` stays the only lockfile |
| MKD-3 | Attribution surface for World Bank/CLDR | footer / tooltip only | Tooltip only for now; revisit if legal wants a persistent footer notice |
| MKD-4 | `persona.bigFive` re-labeling: bundle into CT-1 or a separate ticket | bundle / separate | Separate follow-up once CT-1 lands (touches `personas.ts` mutation surface), so CT-1 stays types-only as scoped |
