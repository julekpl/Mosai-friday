> **MOSAI status (25 Sep 2026): markets and locale only; psychographics cut.**
>
> - **Adopted now:** markets are a list with roles, never one country field (`projects.marketContext`, MK-1), resolved on the server from the site scan, Google listing and confirmed profile; one Settings "Market" row replaces "Where you sell" (MK-3); no USD/en-US default when unknown; the persona "Country / market" field is relabelled so the owner never sees two market fields (FU-5).
> - **After U12:** Sell currency suggestion for empty fields only, labelled "Suggested" (MK-3b, D13).
> - **Cut (D6):** Big Five population priors and World Values Survey data. Existing persona Big Five values are an AI guess and are labelled "AI guess, not a real customer".
> - **Deferred:** CLDR into ContextPack (MK-2), World Bank indicators (MK-5), UNDP, OECD, Eurostat, Cloudflare Radar, GDELT, Wikidata.
> Binding plan: `../MVP-BLUEPRINT-PLAN.md` (sections 3, 9 and 10 win over this file). Owner decisions: `../OWNER-DECISIONS.md`. Where this blueprint and the plan disagree, follow the plan. The original blueprint text below is kept unchanged for reference.

---

# MOSAI Country, Culture & Psychographic Intelligence Blueprint

**Status:** implementation blueprint  
**Date:** 25 September 2026  
**Target:** MOSAI / `julekpl/Mosai-friday`  
**Audience:** product owner, UX designer, data engineer, backend engineer, AI engineer, Codex/AI coding agent  
**Depends on:** MOSAI Future-Proof Agent Architecture and MOSAI Organization Discovery & Smart Onboarding

## 0. Executive decision

MOSAI should add a dedicated **Market & Culture Intelligence Layer**.

Its job is to answer:

- Where is this business based?
- Which markets and regions is it targeting?
- Which languages/locales matter?
- What demographic, economic and digital context is useful?
- What does credible research say about broad population personality patterns?
- Which facts should affect content, personas, campaigns or website delivery?
- How current, representative and reliable is each source?

Architecture:

```text
Project / Persona / Target Market
              |
              v
     Market Resolution Layer
              |
              v
+---------------------------------------+
| Country & Culture Intelligence        |
|                                       |
| identity / locale                     |
| demographics                          |
| economy                               |
| gender indicators                     |
| human development                     |
| digital infrastructure                |
| cultural/value signals                |
| Big Five population priors            |
| history / contextual narrative        |
| current contextual signals            |
+-----------------+---------------------+
                  |
                  v
       Evidence + Provenance Layer
                  |
                  v
           ContextPack Builder
                  |
                  v
   MOSAI capabilities / modelGateway
```

The central rule is:

> **Country, age, sex/gender and cultural datasets are population context. They are never facts about an individual.**

User-confirmed facts, first-party customer evidence and observed behavior always outrank population priors.

---

# 1. Why MOSAI needs this

MOSAI already has a Big Five structure on personas:

```ts
bigFive: {
  openness,
  conscientiousness,
  extraversion,
  agreeableness,
  neuroticism
}
```

A model should not invent those values from general knowledge.

The new layer gives MOSAI a defensible way to use:

- open psychometric datasets;
- official country statistics;
- age and demographic context;
- language/locale data;
- human development indicators;
- gender-related official statistics;
- regional statistics;
- digital-infrastructure evidence;
- carefully licensed cultural/value data;
- historical context;
- current market context.

It can improve:

- persona creation;
- journey hypotheses;
- localization;
- copy/content strategy;
- campaign/channel planning;
- website UX;
- performance budgets;
- availability/resilience recommendations;
- product merchandising;
- market-expansion work.

It must not become a "national stereotypes engine".

---

# 2. Do not create one `project.country`

MOSAI needs distinct geographic concepts.

```ts
type ProjectMarketContext = {
  businessHomeCountry?: CountryCode;
  legalOperatingCountries: CountryCode[];

  primaryTargetMarkets: MarketRef[];
  secondaryTargetMarkets: MarketRef[];

  contentLocales: LocaleRef[];
  salesMarkets: MarketRef[];
  operationalMarkets: MarketRef[];
  hostingRegions: InfrastructureRegionRef[];

  defaultMarket?: MarketRef;
};
```

Example:

```text
Founder nationality: Poland
Business location: Netherlands
Business home market: Netherlands
Primary audience: Amsterdam residents
Secondary audience: international visitors
Content: Dutch + English
Sales market: Netherlands + Belgium
Hosting/data region: EU
```

These facts must not collapse into "country = Poland" or "country = Netherlands".

Define scopes:

```ts
type MarketScope =
  | "business_home"
  | "target_market"
  | "persona_market"
  | "content_locale"
  | "sales_market"
  | "operational_market"
  | "infrastructure_market";
```

---

# 3. Market resolution during onboarding

Try to resolve market context automatically from:

1. explicit user selection;
2. confirmed company/business address;
3. confirmed service area;
4. first-party website location/contact information;
5. connected business/commerce data;
6. organization-enrichment provider;
7. locale, currency and domain signals;
8. inference.

A country-code top-level domain is evidence, not proof of target market.

UX:

```text
I found your main market

Netherlands

You also appear to serve:
Belgium

Languages found:
Dutch
English

[Looks right]
[Change markets]
```

Store a reusable market object:

```ts
type MarketRef = {
  countryCode: string;
  regionCode?: string;
  cityId?: string;

  role: MarketScope;

  sourceRefs: EvidenceRef[];
  confidence: number;

  status: "inferred" | "confirmed" | "locked";
};
```

Use ISO-normalized codes internally, not free-text country names.

---

# 4. Source hierarchy

Different questions require different sources.

## Tier A: official/statistical

- World Bank
- UN / UNSD
- UNDP
- OECD
- Eurostat
- national statistical offices
- Unicode CLDR

## Tier B: scientific/open research

- IPIP / Johnson personality datasets
- OECD PIAAC
- peer-reviewed/open datasets

## Tier C: structured open knowledge

- Wikidata
- Wikimedia
- properly licensed archival sources

## Tier D: current signals

- Cloudflare Radar
- GDELT
- other verified current data

## Tier E: model knowledge

Use only for synthesis when authoritative structured evidence is unavailable.

---

# 5. The CIA World Factbook is historical now

The CIA sunset The World Factbook on **4 February 2026**. Its farewell page states that the publication has ended. [S1]

Do not build a new production dependency around it.

Replacement matrix:

| Need | Preferred source |
|---|---|
| country codes / locale | ISO + Unicode CLDR |
| population | World Bank / UN |
| GDP / income | World Bank / IMF |
| development | UNDP |
| gender indicators | World Bank Gender Data Portal / UNDP / UNSD |
| internet/mobile | World Bank / ITU-derived indicators |
| EU subnational stats | Eurostat |
| language populations | Unicode CLDR |
| historical/basic facts | Wikidata/Wikimedia |
| current internet quality/outages | Cloudflare Radar |
| current events/media context | GDELT |
| old Factbook facts | archived final edition, clearly historical |

A community-maintained continuation may be a secondary archival convenience only after provenance and licensing are reviewed. It must not be presented as an official CIA successor.

---

# 6. Provider-neutral Country Intelligence Gateway

Create:

```text
src/convex/intelligence/market/
  contracts.ts
  gateway.ts
  sources.ts
  normalize.ts
  freshness.ts
  licenses.ts

  providers/
    worldBank.ts
    undp.ts
    unsd.ts
    oecd.ts
    eurostat.ts
    cldr.ts
    cloudflareRadar.ts
    wikidata.ts
    wikimedia.ts
    gdelt.ts
```

Contract:

```ts
interface MarketDataProvider {
  id: string;

  supports(
    metric: MarketMetric,
    geography: GeographyRef
  ): boolean;

  get(
    request: MarketDataRequest
  ): Promise<NormalizedMarketObservation[]>;
}
```

No feature module should parse a World Bank, OECD or Eurostat payload directly.

---

# 7. Country Context Pack

Build a compact normalized object:

```ts
type CountryContextPack = {
  schemaVersion: 1;

  geography: {
    countryCode: string;
    regionCode?: string;
    name: string;
    region?: string;
    subregion?: string;
  };

  locale: LocaleContext;
  demographics: DemographicContext;
  economy: EconomicContext;
  humanDevelopment: HumanDevelopmentContext;
  genderIndicators: GenderContext;
  digital: DigitalInfrastructureContext;

  personalityPrior?: PersonalityPopulationPrior;
  culturalSignals?: CulturalSignalSet;

  history?: CountryNarrativeContext;
  currentContext?: CurrentContext;

  sources: EvidenceRef[];
  dataAsOf: number;
};
```

Only inject data relevant to the current MOSAI task. Do not put hundreds of country indicators into every prompt.

---

# 8. World Bank baseline

The World Bank Indicators API is a sensible default statistical provider because it exposes a V2 API and does not require API keys. [S2]

Use a curated indicator set such as:

```text
population
urbanization
GDP / income context
labor-market indicators
internet use
mobile subscriptions
fixed broadband
electricity access
selected education/literacy indicators
```

Each normalized observation must preserve:

```text
indicator code
name
unit
source
period/year
geography
retrievedAt
```

Never remove the year.

---

# 9. World Bank Gender Data Portal

The World Bank Gender Data Portal is available through the World Bank Indicators API using the gender data source/database. [S3]

Potentially useful categories:

- labor-force participation;
- education;
- entrepreneurship;
- financial access;
- digital access;
- employment structure.

These are market indicators, not descriptions of an individual woman or man.

Never transform a country-level difference into a personal stereotype.

---

# 10. UNDP

UNDP's Human Development platform provides:

- Human Development Index;
- inequality-adjusted HDI;
- Gender Development Index;
- Gender Inequality Index;
- time series;
- Human Development Data API 2.0. [S4]

Use these for context such as development, inequality and access.

Do not turn a composite index directly into copywriting instructions.

---

# 11. UN SDG API

The UN Statistics Division provides an official SDG API with disaggregated dimensions. [S5]

It can supplement:

- demographic/social indicators;
- gender-disaggregated indicators;
- development signals;
- regional comparisons.

Use selected relevant series only.

---

# 12. OECD and PIAAC

OECD should be an important provider for participating economies.

PIAAC Cycle 2 Round 1 includes 31 countries and collected data from September 2022 to August 2023. OECD publishes Public Use Files, questionnaires, codebooks and supporting material. [S6][S7]

Coverage is not identical across countries. Some files or variables can be unavailable due to national restrictions. Therefore MOSAI must support "no data" and partial coverage.

Do not write code assuming every country has the same PIAAC fields.

---

# 13. Eurostat and regional context

For EU projects, Eurostat can provide country and subnational data.

Its Statistics API supports JSON-stat and relevant datasets can be filtered by:

```text
country
NUTS 1
NUTS 2
NUTS 3
city
```

[S8]

This matters because local businesses may need city or regional context more than national averages.

Example:

```text
Amsterdam context > Netherlands average
```

when a reliable city/regional source exists.

---

# 14. Unicode CLDR

Use Unicode CLDR as the locale/language foundation.

CLDR territory-language information includes:

- language population;
- population percentage;
- official status;
- regional official status. [S9][S10]

Use CLDR for:

- language candidates;
- locale conventions;
- regional language support;
- date/number/currency formatting;
- writing-system context.

Do not choose content language solely from the largest national language. User and first-party site evidence wins.

---

# 15. Big Five: correct product interpretation

MOSAI should maintain a versioned **population personality prior** dataset.

Potential dimensions:

```text
country
age band
source-defined sex/gender dimension
instrument
sample size
survey period
representativeness
```

Use it only as a weak contextual prior.

Never do:

```text
User is Dutch
→ Openness = 73
→ Extraversion = 61
```

A large cross-country IPIP-NEO-120 study with 130,602 participants across 22 countries found country membership explained about 1.8% of trait variation on average. [S11]

Within-country individual differences are much larger than country-average differences.

Therefore population personality data can inform hypotheses, not define people.

---

# 16. IPIP is appropriate, but "official norms" are not

The official International Personality Item Pool says its items and scales are in the public domain and may be copied, edited, translated and used without a fee. [S12]

However, the official IPIP norms page explicitly warns against generic "canned norms" and says locally relevant norms are more defensible. [S13]

So MOSAI should call derived results:

```text
population reference data
population personality prior
```

not:

```text
official IPIP norm
```

---

# 17. Canonical open Big Five source

A strong source is the Johnson/Kajonius PsychArchives material.

It includes:

```text
IPIP-NEO-300: 307,313 cases
IPIP-NEO-120: 619,150 cases
scoring/documentation
```

[S14]

Use the original documented source as canonical input.

Do not make a convenience GitHub mirror the primary production source if its standalone licensing is unclear.

---

# 18. GitHub data is useful, but not automatically production-safe

The public `automoto/big-five-data` repository contains scored Big Five results for 307,313 respondents and fields for:

```text
country
age
biological sex
Big Five scores
```

[S15]

It is useful for:

- prototyping;
- reproducing score calculations;
- data exploration;
- validating your ETL.

But the repository page reviewed does not itself establish a clear standalone commercial license for the derived repository.

Production rule:

```text
canonical source = documented upstream dataset
GitHub derivative = reference/testing unless licensing is confirmed
```

---

# 19. Avoid the known problematic Big Five dataset

The official IPIP data guidance warns against an older OpenPsychometrics dataset with 19,719 cases because of scoring/label issues.

IPIP points instead to:

- a later >1 million case IPIP-FFM dataset;
- Johnson's IPIP-NEO repositories. [S13]

Therefore:

```text
DO NOT use the old 19,719-row dataset as a production norm source.
```

---

# 20. Two-tier personality strategy

## Tier A: large open IPIP reference

Use Johnson/IPIP as broad fallback.

Advantages:

- very large sample;
- age/country/sex fields;
- open personality instrument;
- broad global coverage.

Limitations:

- self-selected online sample;
- English-language bias;
- country samples vary;
- not nationally representative;
- historical.

## Tier B: representative contemporary data

Use representative datasets such as OECD PIAAC where suitable and available.

A 2026 paper using representative adult samples in 27 countries, total N=143,313, found Big Five gender differences vary across countries. [S16]

Do not merge PIAAC and IPIP raw scores into one average. They use different instruments and methodologies.

---

# 21. Keep instruments separate

Store:

```text
instrument:
  IPIP_NEO_120
  IPIP_NEO_300
  BFI_2
  ...
```

Never calculate:

```text
(IPIP raw mean + BFI-2 raw mean) / 2
```

without a validated linking/calibration method.

Preferred logic:

```text
representative source available and validated
  → use as preferred contextual prior

otherwise large IPIP aggregate available
  → use as reference prior

otherwise
  → no personality prior
```

"No data" is a valid and desirable state.

---

# 22. Preserve sex versus gender semantics

The GitHub IPIP derivative describes its field as:

```text
biological sex
1 = male
2 = female
```

[S15]

Other sources may measure sex, gender identity, legal sex or another variable.

Do not rename all of them to "gender".

Schema:

```ts
type DemographicDimension = {
  sourceVariable: string;

  concept:
    | "sex"
    | "gender"
    | "unknown";

  categories: string[];

  sourceDefinition?: string;
};
```

MOSAI must preserve what the source actually measured.

---

# 23. Age bands

Avoid generational stereotypes such as:

```text
Gen Z personality
Millennial personality
```

Use transparent age bands, for example:

```text
18-24
25-34
35-44
45-54
55-64
65+
```

or source-defined bands.

Age-band definitions must be versioned.

A future statistically stronger implementation can use continuous age models or hierarchical smoothing.

MVP should stay transparent.

---

# 24. Minimum sample and uncertainty

Never expose a country × age × sex/gender mean based on a tiny sample.

Every aggregate stores:

```ts
{
  n,
  effectiveN?,
  mean,
  standardDeviation,
  standardError?,
  confidenceInterval?,
  samplingMethod,
  representativePopulation
}
```

Thresholds must be calibrated from the data, not invented by the LLM.

Fallback:

```text
country × age × demographic group
           ↓
country × age
           ↓
country
           ↓
region
           ↓
source-global reference
           ↓
none
```

Each prior tells the consumer which fallback level was actually used.

---

# 25. Personality prior schema

```ts
type PersonalityPopulationPrior = {
  schemaVersion: 1;

  geography: GeographyRef;
  ageBand?: string;

  demographicDimension?: {
    concept: "sex" | "gender";
    category: string;
  };

  instrument: string;
  datasetVersion: string;

  sample: {
    n: number;
    effectiveN?: number;

    representativeness:
      | "representative"
      | "weighted_survey"
      | "self_selected"
      | "unknown";
  };

  traits: {
    openness: TraitEstimate;
    conscientiousness: TraitEstimate;
    extraversion: TraitEstimate;
    agreeableness: TraitEstimate;
    neuroticism: TraitEstimate;
  };

  limitations: string[];
  sourceRefs: EvidenceRef[];
};
```

```ts
type TraitEstimate = {
  standardizedMean?: number;
  rawMean?: number;
  standardDeviation?: number;
  standardError?: number;
  confidenceInterval?: [number, number];
};
```

---

# 26. How Big Five may influence content

Use it as a **hypothesis generator**.

Examples:

```text
higher openness context
→ test novelty, exploration and variety framing

higher conscientiousness context
→ test structure, reliability and detailed planning

higher extraversion context
→ test energetic/social framing

higher agreeableness context
→ test cooperation/community/support framing

higher neuroticism/negative emotionality context
→ test clarity, reassurance and uncertainty reduction
```

These are experiment hypotheses, not diagnoses.

Prefer:

```text
Test two message variants
```

over:

```text
People in country X want this.
```

---

# 27. Persona authority order

A persona can contain:

```ts
bigFiveSource:
  | "user_assessed"
  | "customer_research"
  | "first_party_behavior"
  | "population_prior"
  | "ai_hypothesis";
```

Authority:

```text
actual assessment/customer research
>
user-confirmed persona
>
first-party behavior
>
population prior
>
AI hypothesis
```

Population priors never overwrite confirmed persona values.

---

# 28. Prevent stereotype feedback loops

Bad:

```text
country prior
→ persona
→ content
→ content is later treated as proof of persona
→ original assumption becomes "evidence"
```

Every derived artifact must preserve provenance.

If persona Big Five was based on `population_prior`, downstream artifacts continue pointing back to that source.

Derived AI output is not independent evidence.

---

# 29. Cultural/value data is separate from personality

Do not treat Big Five as a complete culture model.

Create:

```text
CulturalSignalSet
```

Potential sources:

- World Values Survey;
- European Values Study;
- official national attitude surveys;
- other properly licensed evidence.

Licensing is critical.

The reviewed World Values Survey download conditions require non-profit use for those files and prohibit redistribution. [S17]

Therefore WVS must be:

```text
license_status = restricted_for_default_commercial_use
```

unless MOSAI obtains appropriate permission.

"Free to download" does not mean "free for a commercial SaaS product".

---

# 30. Source license registry

Create:

```text
marketDataSources
```

Fields:

```ts
{
  sourceId,
  name,
  sourceUrl,

  license,

  commercialUse:
    | "allowed"
    | "restricted"
    | "unknown";

  redistribution:
    | "allowed"
    | "restricted"
    | "unknown";

  attributionRequired: boolean;

  reviewedAt,
  reviewedBy,
  notes
}
```

Production ingestion must refuse:

```text
commercialUse != "allowed"
```

unless a documented legal/product override exists.

---

# 31. Country history and descriptive context

MOSAI does not need a long encyclopedia in every prompt.

Create a bounded:

```text
CountryNarrativeContext
```

Potential sources:

- Wikidata;
- Wikimedia REST;
- official sources where relevant.

Wikimedia offers a public REST API for content and metadata. [S18]

Wikidata exposes a SPARQL query service for structured knowledge. [S19]

Use these for:

- basic historic context;
- administrative relationships;
- cities/regions;
- name changes;
- bounded descriptive context.

For numerical claims, prefer official statistical sources.

---

# 32. Current context is separate from cultural facts

Create optional:

```text
CurrentContext
```

Potential source:

```text
GDELT
```

Use it only for time-bounded questions such as:

- major current disruptions;
- high-salience market events;
- news environment.

Never let a temporary event rewrite a permanent "national culture" profile.

---

# 33. Digital Infrastructure Context

Create:

```ts
type DigitalInfrastructureContext = {
  internetUse?: Observation;
  mobileSubscriptions?: Observation;
  fixedBroadband?: Observation;
  electricityAccess?: Observation;

  internetQuality?: Observation;
  recentOutages?: Observation;

  sourceRefs: EvidenceRef[];
};
```

World Bank can provide slower-changing structural measures.

Cloudflare Radar exposes Internet Quality Index data and outage endpoints by location. [S20][S21]

Use both types of evidence differently:

```text
World Bank = structural baseline
Cloudflare Radar = current/near-current signal
```

---

# 34. Country data should inform delivery, not dictate uptime

Correct relationship:

```text
COUNTRY / NETWORK DATA
→ delivery and resilience strategy

BUSINESS CRITICALITY
→ service-level target
```

Do not say:

```text
Market X has weaker infrastructure
→ uptime target should be lower
```

If connectivity is challenging, the product often needs greater resilience.

Country/network context can influence:

- initial JS budget;
- image size/quality presets;
- video autoplay;
- lazy loading;
- caching;
- edge/CDN use;
- retries;
- progressive enhancement;
- offline-tolerant flows;
- mobile-first design;
- font strategy;
- fallback behavior.

Reliability SLO should depend on:

- revenue dependency;
- booking/payment dependency;
- traffic;
- business criticality;
- support model;
- failure cost.

---

# 35. Market Technical Profile

```ts
type MarketTechnicalProfile = {
  market: MarketRef;

  connectivityClass:
    | "strong"
    | "mixed"
    | "constrained"
    | "unknown";

  mobileImportance:
    | "high"
    | "medium"
    | "low"
    | "unknown";

  reliabilityRisk:
    | "elevated"
    | "normal"
    | "unknown";

  recommendations: TechnicalRecommendation[];
  evidenceRefs: EvidenceRef[];
};
```

Avoid labels such as "poor country".

Describe evidence, not value judgments.

---

# 36. Example technical recommendations

When evidence indicates constrained connectivity:

```text
reduce initial payload
aggressively optimize images
limit unnecessary client JS
use strong caching
prefer progressive enhancement
make forms resilient to retry
avoid unnecessary autoplay
```

When mobile usage is important:

```text
mobile-first navigation
touch-friendly controls
mobile checkout/booking tests
mobile performance budget
```

When outages are a real concern:

```text
CDN/edge resilience
cached read experiences
retry/queue for non-critical writes
clear offline/error states
```

The Build capability decides implementation. Country Intelligence provides evidence and recommendations.

---

# 37. Locale Context

```ts
type LocaleContext = {
  primaryLanguages: LanguageObservation[];
  officialLanguages: string[];

  suggestedContentLocales: string[];

  currency?: string;
  timezoneCandidates: string[];

  dateConvention?: string;
  numberConvention?: string;

  sourceRefs: EvidenceRef[];
};
```

Combine:

```text
user choice
website language
customer data
CLDR
market evidence
```

Do not infer language from nationality alone.

---

# 38. Gender context

Keep these separate:

```text
gender-related market indicators
```

and:

```text
personality demographic dimensions
```

Useful market signals may include:

- employment participation;
- entrepreneurship;
- financial access;
- digital access;
- education.

These can describe market structure or access.

They do not justify simplistic claims such as:

```text
women prefer X
men prefer Y
```

Any demographic messaging hypothesis should be evidence-backed, cautious and testable.

---

# 39. Demographic guardrails

Do not use this layer for:

- employment selection;
- credit/insurance decisions;
- individual price discrimination;
- exclusion from essential services;
- hidden individual personality scoring from demographic proxies;
- inferring sensitive traits.

For MOSAI marketing:

```text
aggregate market context
+
user-confirmed persona
+
first-party behavior
```

should be the normal model.

---

# 40. Context weighting

Each market-context item should expose:

```ts
{
  authority,
  relevance,
  freshness,
  uncertainty,
  geographicFit,
  demographicFit
}
```

Conceptually:

```text
evidenceWeight =
 sourceAuthority
 × marketMatch
 × freshness
 × dataQuality
 × taskRelevance
```

The exact scoring should be calibrated and versioned.

---

# 41. ContextPack integration

Add a market section to MOSAI's existing server-built context.

Example:

```text
BUSINESS
confirmed business facts

BRAND
confirmed brand

AUDIENCE
persona/customer evidence

MARKET
country/region/locale

DEMOGRAPHICS
relevant official indicators

CULTURAL SIGNALS
approved/licensed evidence only

PERSONALITY PRIOR
weak population prior, if available

TECHNICAL MARKET
network/device/delivery context
```

Central system instruction:

```text
Population statistics and personality aggregates are contextual priors.
They do not describe an individual.

Never turn country, age, sex or gender averages into deterministic claims
about a customer or persona.

Prefer user-confirmed facts, first-party evidence and observed behavior.

When evidence is weak, label an assumption or recommend a test.
```

Do not duplicate this wording independently in dozens of prompts.

---

# 42. Content behavior

Market context can legitimately influence:

- language;
- locale;
- currency;
- units;
- date/time;
- examples;
- local terminology;
- reading complexity;
- channel availability;
- formality hypotheses;
- trust/reassurance hypotheses;
- technical delivery.

Avoid:

```text
"Dutch people are direct, therefore write blunt copy."
```

Prefer:

```text
Target locale: nl-NL
Brand voice: direct and practical
Current first-party copy: concise
Market/cultural evidence: weak supporting signal

Recommendation:
test concise copy against a more explanatory variant.
```

---

# 43. Persona behavior

Persona creation should prioritize:

1. products/offer;
2. customer research;
3. CRM;
4. analytics;
5. website;
6. user input;
7. search/market evidence;
8. official market statistics;
9. population personality prior.

Each persona should distinguish:

```text
Evidence
Assumptions
Unknowns
```

Example:

```text
Evidence:
Most leads are 25-44 and Amsterdam-based.

Market context:
High digital adoption.

Personality prior:
Low-weight self-selected/reference dataset.

Assumption:
Time saving matters more than price.

Needs validation:
Actual price sensitivity.
```

---

# 44. Do not show personality country scores by default

Avoid a default screen such as:

```text
Netherlands
Openness: 72
Neuroticism: 41
```

It invites false precision and stereotyping.

Instead:

```text
MOSAI used population-level market research as a low-weight context signal.

[Why?]
```

Advanced explanation can show:

```text
Instrument
Dataset
Sample N
Age/sex/gender scope
Representativeness
Limitations
```

---

# 45. Up-to-date personality strategy

Personality data is not a daily API.

Maintain:

```text
personalityDatasetRegistry
```

```ts
{
  datasetId,
  instrument,
  version,
  publicationDate,
  downloadedAt,
  sourceUrl,
  license,
  population,
  countries,
  methodology,
  processingVersion,
  status
}
```

Refresh only when:

- a new public-use release appears;
- a suitable peer-reviewed dataset becomes available;
- known errors are fixed;
- methodology changes;
- licensing changes.

---

# 46. Big Five ETL

Do not ship raw million-row personality files in production.

Offline pipeline:

```text
download canonical dataset
        |
verify checksum/version
        |
read documentation
        |
score instrument correctly
        |
validate missingness/ranges
        |
normalize country codes
        |
derive transparent age bands
        |
preserve demographic semantics
        |
aggregate
        |
calculate uncertainty
        |
quality checks
        |
publish compact versioned aggregates
```

Production Convex reads only the prepared aggregates.

---

# 47. Population personality table

```text
populationPersonalityNorms
```

Suggested fields:

```ts
{
  datasetId,
  processingVersion,

  countryCode,
  regionCode?,

  ageBand?,

  demographicConcept?,
  demographicCategory?,

  instrument,

  sampleN,
  effectiveN?,

  representativeness,

  openness,
  conscientiousness,
  extraversion,
  agreeableness,
  neuroticism,

  uncertainty,

  sourceRefs,
  createdAt
}
```

---

# 48. Survey weighting

Representative survey data such as PIAAC may require survey weights and methodology-specific variance estimation.

Do not simply load PIAAC CSV and calculate unweighted means.

Store methodology metadata such as:

```text
weighted
weightVariable
varianceMethod
replicateWeights
```

when applicable.

Before trusting the pipeline, reproduce at least one published OECD/statistical result from the same PUF using the documented methodology.

---

# 49. Cross-cultural validity

Cross-cultural personality comparison has limits.

Research has found measurement problems in some non-WEIRD survey contexts and warns against naive interpretation of Big Five responses across populations. [S22]

Store:

```text
comparabilityNotes
instrumentLanguage
samplingMethod
measurementLimitations
```

MOSAI should never publish internal rankings such as:

```text
"most agreeable countries"
```

That is not needed for the product and encourages overinterpretation.

---

# 50. Freshness classes

Define:

```text
STATIC
SLOW
PERIODIC
DYNAMIC
```

Examples:

```text
ISO country code             STATIC
language/locale reference    SLOW
personality dataset          SLOW
HDI                          PERIODIC
population/GDP               PERIODIC
internet penetration         PERIODIC
internet outage              DYNAMIC
current event context        DYNAMIC
```

---

# 51. Suggested refresh behavior

```text
CLDR
→ on release

World Bank
→ periodic metadata/data refresh, retain latest non-missing period

UNDP
→ on release

UNSD
→ periodic according to selected series

OECD / PIAAC
→ on official release/revision

Eurostat
→ according to dataset cadence

Personality dataset
→ version-triggered/manual

Cloudflare Radar
→ on demand + short cache

Wikidata/Wikimedia
→ cached, periodic

GDELT
→ on-demand and tightly scoped
```

Do not hammer free APIs.

---

# 52. Observation contract

Every normalized external number:

```ts
type Observation = {
  metricId: string;
  geography: GeographyRef;

  value: number | string;
  unit?: string;

  period: string;

  sourceId: string;
  sourceDataset?: string;
  sourceSeries?: string;

  retrievedAt: number;
  qualityFlags?: string[];
};
```

Never remove:

```text
period
unit
source
```

---

# 53. Context snapshots

Create:

```text
marketContextSnapshots
```

```ts
{
  projectId,
  market,
  contextVersion,

  sourceVersions,
  payload,

  sourceHash,
  builtAt,
  expiresAt
}
```

Generated work should reference the snapshot it used.

That provides reproducibility:

```text
Homepage draft
→ Market Snapshot v7
→ World Bank series X, period 2025
→ CLDR 49
→ personality dataset 2026.1
```

---

# 54. License gate

Create:

```text
scripts/audit-market-data-licenses.ts
```

Production source activation should fail when:

```text
commercialUse = "restricted"
```

unless a documented approval/contract exists.

This is mandatory for cultural/value datasets.

---

# 55. Recommended source catalog

## Production-ready core candidates

### World Bank
Population, economy, digital access, development and gender data.

### Unicode CLDR
Languages, locale structure and regional language status.

### UNDP
Human development, inequality and gender-development context.

### UNSD SDG API
Selected official/disaggregated statistics.

### OECD
Comparative indicators and PIAAC.

### Eurostat
EU country, NUTS and city/regional statistics.

### Cloudflare Radar
Current internet quality/outage context.

### Wikidata/Wikimedia
Structured/history/descriptive context.

## Conditional sources

### World Values Survey
Potentially useful, but reviewed download terms require non-profit use for relevant files. Do not enable by default for commercial MOSAI without permission/license. [S17]

### European Values Study
Review dataset-specific GESIS/EVS terms before production use.

### Our World in Data
Useful as a discovery/visualization layer, but underlying source licenses differ. Inspect original-source metadata before commercial ingestion/redistribution.

---

# 56. Technical website recommendations

Country Intelligence should expose structured recommendations:

```ts
type TechnicalRecommendation = {
  code:
    | "reduce_initial_payload"
    | "mobile_first"
    | "aggressive_image_optimization"
    | "edge_cache"
    | "offline_resilience"
    | "multi_region"
    | "locale_support";

  priority: "low" | "medium" | "high";

  reason: string;
  evidenceRefs: EvidenceRef[];
};
```

The Build module decides implementation.

Country Intelligence does not mutate websites directly.

---

# 57. Uptime and reliability profile

Create separately:

```text
BusinessCriticalityProfile
```

Inputs:

```text
website type
commerce/payment dependency
booking dependency
lead-generation dependency
revenue exposure
traffic
failure tolerance
support model
```

Then:

```text
BusinessCriticalityProfile
+
MarketTechnicalProfile
→ ReliabilityArchitectureRecommendation
```

This makes country/network context useful without making it the sole determinant of availability.

---

# 58. Example: Amsterdam café

```text
businessHomeCountry = NL
primaryTargetMarket = Amsterdam
contentLocales = nl-NL, en-NL
secondaryAudience = international visitors
```

Useful context:

```text
CLDR:
language/locale

Eurostat / local official data:
regional/city context where relevant

World Bank:
national structural digital/economic baseline

Cloudflare:
current network context when needed

Big Five:
NL population prior only as low-weight hypothesis
```

Wrong behavior:

```text
"Average Dutch personality = personality of this café customer."
```

---

# 59. Example: Polish founder, Dutch SaaS, German expansion

```text
founder nationality = PL
business home = NL
existing customers = NL
new target market = DE
content locale = de-DE
hosting = EU
```

German market context can affect:

- market-entry copy;
- local SEO;
- localization;
- campaign planning;
- delivery/performance.

Founder nationality should not affect German-customer psychographic assumptions.

---

# 60. User controls

Project Settings:

```text
Markets

Primary market
Netherlands

Target regions
Amsterdam

Languages
Dutch
English

MOSAI market intelligence
ON

Population personality research
ON

Current market context
ON
```

Users can disable personality priors without disabling personas or country localization.

---

# 61. Explainability

For an important recommendation:

```text
Why this?
```

Example:

```text
This recommendation uses:

✓ Your customer data
✓ Your confirmed Dutch market
✓ Your website language
✓ Public market statistics

Population personality research:
Low influence
```

This is more honest than pretending MOSAI has a precise psychological model of a country.

---

# 62. Data tables

Suggested new tables:

```text
projectMarkets
marketObservations
marketContextSnapshots
marketDataSources
marketSourceReleases

populationPersonalityDatasets
populationPersonalityNorms

marketCulturalSignals
marketTechnicalProfiles
countryNarratives
```

Do not append all source-specific fields to `projects`.

---

# 63. Provider caching

Cache by:

```text
provider
metric
country/region
period
```

Do not call external APIs for every content-generation request.

Correct flow:

```text
external source
    |
normalized observation cache
    |
market context snapshot
    |
many MOSAI capabilities
```

---

# 64. Error behavior

World Bank unavailable:

```text
use latest valid cached observation
mark freshness
```

No personality prior:

```text
personalityPrior = undefined
```

Restricted source:

```text
provider disabled in commercial production
```

Conflicting sources:

```text
retain source refs
apply authority/freshness policy
flag conflict
```

Never ask the LLM to invent the missing figure.

---

# 65. Data update observability

Admin dashboard:

```text
Source              Latest ingest      Status
World Bank          25 Sep 2026        OK
CLDR                 current release    OK
UNDP                 2025 release       OK
PIAAC Cycle 2        current revision   OK
IPIP Johnson         dataset 2026.1     OK
Cloudflare Radar     15 min ago         OK
WVS                   disabled           LICENSE REVIEW
```

---

# 66. Dataset pinning

Pin:

```text
dataset version
source URL
download date
checksum
processing code version
```

Create MOSAI releases:

```text
mosai-personality-priors-2026.1
```

Never silently recompute historical content against a different dataset version.

---

# 67. Reproducible personality build

Suggested:

```text
data/personality/README.md

scripts/personality/
  download.ts
  validate.ts
  score.ts
  aggregate.ts
  report.ts
```

Generated report:

```text
source/version
checksum
rows read
rows excluded
country coverage
age coverage
demographic-variable semantics
missingness
trait distributions
small-cell fallbacks
```

Commit scripts/manifests. Store raw large datasets according to license and storage policy.

---

# 68. Evaluate whether Big Five actually improves MOSAI

Before production:

1. Does it improve human-rated relevance?
2. Does it reduce editing?
3. Does it improve acceptance?
4. Does it create stereotyped language?
5. Are small demographic cells unstable?
6. Does it improve real content/campaign tests?
7. Does it add enough value to justify complexity?

A/B:

```text
A = normal MOSAI context
B = normal context + population personality prior
```

Measure:

```text
human preference
edit distance
acceptance
task completion
campaign performance
stereotype/error flags
```

If B does not outperform A, reduce the prior's influence.

---

# 69. Test fixtures

Include:

```text
NL local café
DE B2B SaaS
PL e-commerce
SG hospitality
BR consumer brand
IN local service
US enterprise software
multilingual Belgium
multi-market EU business
country with no personality data
country with weak sample
```

Validate:

- correct market;
- correct locale;
- no unsupported personality claim;
- no stereotype language;
- proper fallback;
- source/provenance retention;
- technical recommendations based on data.

---

# 70. Big Five-specific tests

```text
small cell
→ fallback

missing age
→ broader prior

demographic field unknown
→ no forced category

confirmed persona Big Five
→ overrides population prior

market changed
→ previous prior stale

different instrument
→ no raw score merge

PIAAC unavailable
→ validated IPIP fallback

no source
→ undefined, never invented
```

---

# 71. Security and sensitive data

Treat all external text/data as untrusted input.

External sources cannot:

- change tool permissions;
- reveal secrets;
- select arbitrary models;
- publish content;
- override system policy;
- modify tenant IDs.

Keep market intelligence aggregate/project-level where possible.

Do not automatically infer sensitive personal traits such as:

```text
religion
ethnicity
sexual orientation
health
political ideology
```

from country or region.

---

# 72. Capability contracts

Expose through the Future-Proof Capability Registry:

```text
market.resolve.v1
market.context.build.v1
market.personality_prior.v1
market.technical_profile.v1
market.locale_context.v1
market.current_context.v1
```

No module calls official APIs directly.

---

# 73. Event contracts

Examples:

```text
project.market.confirmed.v1
project.market.changed.v1
market.context.refreshed.v1
market.personality_dataset.released.v1
market.technical_context.changed.v1
```

When market changes:

```text
mark dependent artifacts stale
```

Do not overwrite confirmed pages/personas automatically.

---

# 74. Dependency invalidation example

Target market changes:

```text
NL → DE
```

Likely stale:

```text
persona localization
content strategy
local SEO assumptions
copy locale
campaign recommendations
technical market profile
```

Not stale:

```text
legal company name
product facts
brand logo
confirmed business identity
```

---

# 75. Implementation milestones

## M0: market model

Implement:

```text
projectMarkets
MarketRef
MarketScope
market.resolve.v1
```

Connect it to organization discovery/onboarding.

## M1: core country context

Implement:

```text
World Bank provider
CLDR provider
normalized observation cache
market context snapshot
```

Use a small curated indicator set.

## M2: Big Five offline pipeline

Implement:

```text
dataset registry
canonical source download
scoring validation
country normalization
age bands
demographic semantics
aggregation
uncertainty
fallback
validation report
```

Do not inject it into prompts yet.

## M3: persona integration

Inject the population prior at low weight.

Add centralized prompt safeguards.

Run regression/evaluation suite.

## M4: official context expansion

Add only if product use cases need them:

```text
UNDP
UN SDG
OECD
Eurostat
```

## M5: digital/technical market profile

Add:

```text
World Bank digital series
Cloudflare Radar
MarketTechnicalProfile
```

Connect to Build recommendations.

## M6: cultural/value signals

Only after commercial licensing review.

## M7: narrative/current context

Add:

```text
Wikidata/Wikimedia
GDELT
```

only to capabilities that need them.

---

# 76. Suggested MVP indicator set

Start with roughly 15-25 indicators, not hundreds.

Categories:

```text
population
urbanization
GDP/income context
internet use
mobile subscription
fixed broadband
electricity access
selected gender digital/economic indicators
HDI
GDI/GII
language context
```

Each indicator needs a documented MOSAI use case.

---

# 77. MVP UX

During project setup:

```text
MOSAI found your main market:
Netherlands

Languages:
Dutch
English

[Continue]
[Change]
```

Persona:

```text
Market context
Netherlands

MOSAI used public market data to improve this draft.

[Why?]
```

Build:

```text
Technical market context

Mobile-first recommended
Image optimization priority: High

[View evidence]
```

Do not create a giant country-dashboard requirement for MVP.

---

# 78. Product metrics

Track:

```text
market auto-detection accuracy
market correction rate
context build latency
provider failure rate
personality prior coverage
personality prior usage
personality prior override rate
content acceptance/edit distance
technical recommendation adoption
source freshness
external API cost
```

The key question is:

> Does this context make MOSAI's output better?

not:

> How much data did MOSAI ingest?

---

# 79. Acceptance criteria

## Market model

- [ ] Business home, target, persona, locale, sales and infrastructure markets are distinct.
- [ ] A project supports multiple markets.
- [ ] User can confirm/override inferred markets.
- [ ] Market changes invalidate only dependent artifacts.

## Big Five

- [ ] Production uses a documented canonical dataset.
- [ ] GitHub derivative is not assumed commercially licensed merely because it is public.
- [ ] Country × age × demographic cells expose N and uncertainty.
- [ ] Source sex/gender semantics are preserved.
- [ ] Different instruments are not merged naively.
- [ ] Small cells fallback.
- [ ] Population prior never overwrites confirmed persona data.
- [ ] User can disable population personality priors.
- [ ] No individual receives a personality score from demographics alone.

## Country intelligence

- [ ] Every numerical observation has source, period and unit.
- [ ] Official API responses are normalized behind adapters.
- [ ] Locale uses CLDR + project evidence.
- [ ] Restricted cultural datasets cannot enter commercial production without approval.
- [ ] CIA Factbook is treated only as historical/archival.

## Website technical context

- [ ] Country alone does not define uptime SLO.
- [ ] Market digital context influences delivery/performance recommendations.
- [ ] Business criticality remains the primary reliability input.
- [ ] Technical recommendations have evidence refs.

## AI

- [ ] ContextPack labels population data as contextual prior.
- [ ] Prompts prohibit individual demographic stereotyping.
- [ ] Missing data remains missing rather than hallucinated.
- [ ] User and first-party evidence outrank population data.
- [ ] Generated outputs are traceable to market snapshots.

---

# 80. Codex implementation constraints

```text
1. Do not modify persona Big Five generation until the dataset layer exists.
2. Do not commit third-party raw data without license review.
3. Do not use automoto/big-five-data as canonical production data by default.
4. Do not ingest the known problematic old 19,719-row dataset.
5. Preserve instrument and source demographic semantics.
6. Do not merge IPIP and BFI-2 raw scales directly.
7. Do not infer individual personality from country/age/sex/gender.
8. Keep World Bank/OECD/UNDP/etc. behind provider adapters.
9. Do not dump hundreds of indicators into ContextPack.
10. Market infrastructure may affect delivery, not directly set business SLO.
11. All model calls remain behind modelGateway.
12. All new functions are versioned capability contracts.
13. Produce data-validation reports before enabling personality priors.
14. Add stereotype/unsupported-claim evals.
15. Stop after every 3 implementation milestones and report state.
```

---

# 81. Suggested file structure

```text
src/convex/intelligence/
  market/
    contracts.ts
    gateway.ts
    resolution.ts
    snapshots.ts
    freshness.ts
    licenses.ts

    providers/
      worldBank.ts
      undp.ts
      unsd.ts
      oecd.ts
      eurostat.ts
      cldr.ts
      cloudflareRadar.ts
      wikidata.ts
      wikimedia.ts
      gdelt.ts

  personality/
    contracts.ts
    resolver.ts
    fallback.ts
    confidence.ts

src/convex/capabilities/market/
  resolve.v1.ts
  context.build.v1.ts
  personality_prior.v1.ts
  technical_profile.v1.ts
  locale_context.v1.ts

scripts/personality/
  download.ts
  validate.ts
  score.ts
  aggregate.ts
  report.ts

scripts/market/
  refresh-world-bank.ts
  refresh-cldr.ts
  audit-licenses.ts

data/personality/
  README.md
  manifests/
```

---

# 82. Product principles

1. **MOSAI should know the market before asking the user to describe it.**
2. **Official and first-party facts outrank personality/cultural priors.**
3. **Population averages are contextual hints, not individual identities.**
4. **Country is not one field.**
5. **Only inject market data relevant to the current task.**
6. **Country data can influence delivery; business criticality determines reliability goals.**
7. **Every external fact needs provenance, geography, period and source.**
8. **Free download does not automatically mean commercial-use permission.**
9. **No data is better than invented data.**
10. **Use population priors to create testable hypotheses, not stereotypes.**

---

# 83. Sources

All sources were checked against current public material on 25 September 2026.

## CIA World Factbook

**[S1] CIA, "Spotlighting The World Factbook as We Bid a Fond Farewell"**  
CIA states that The World Factbook has sunset, dated 4 February 2026.  
https://www.cia.gov/stories/story/spotlighting-the-world-factbook-as-we-bid-a-fond-farewell/

## World Bank

**[S2] World Bank Indicators API documentation**  
V2 API; API key not required.  
https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

**[S3] World Bank Gender Data Portal API help**  
Gender data is accessible through the World Bank Indicators API.  
https://genderdata.worldbank.org/en/help

## UN / UNDP

**[S4] UNDP Human Development documentation and downloads**  
HDI, IHDI, GDI, GII and Human Development Data API 2.0.  
https://hdr.undp.org/data-center/documentation-and-downloads

**[S5] United Nations Statistics Division SDG API**  
Official SDG data and disaggregation endpoints.  
https://unstats.un.org/SDGAPI/swagger/

## OECD / PIAAC

**[S6] PIAAC 2nd Cycle Database**  
Round 1 country coverage, PUFs, codebooks and source documentation.  
https://www.oecd.org/en/data/datasets/piaac-2nd-cycle-database.html

**[S7] PIAAC data and methodology**  
https://www.oecd.org/en/about/programmes/piaac/piaac-data.html  
https://www.oecd.org/en/about/programmes/piaac/piaac-frequently-asked-questions-faqs.html

## Eurostat

**[S8] Eurostat Statistics API**  
JSON-stat API and country/NUTS/city geography support where available.  
https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/api

## Unicode CLDR

**[S9] CLDR Territory-Language Information**  
https://www.unicode.org/cldr/charts/49/supplemental/language_territory_information.html

**[S10] CLDR JSON territory information**  
https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/territoryInfo.json

## Big Five / personality

**[S11] Kajonius & Mac Giolla, "Personality traits across countries: Support for similarities rather than differences"**  
Large IPIP-NEO-120 analysis across 22 countries; country explained about 1.8% of trait variation on average.  
https://pmc.ncbi.nlm.nih.gov/articles/PMC5473578/  
https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0179646

**[S12] Official International Personality Item Pool**  
IPIP items/scales are public domain.  
https://ipip.ori.org/

**[S13] Official IPIP Norms and Data Sets guidance**  
Warns against generic canned norms, warns about the older problematic 19,719-case dataset, and points to better-documented larger datasets.  
https://www.ipip.ori.org/newNorms.htm

**[S14] PsychArchives Johnson/Kajonius supplementary material**  
IPIP-NEO-300, N=307,313; IPIP-NEO-120, N=619,150; documentation/scoring materials.  
https://psycharchives.org/en/item/e42a4531-1daa-4f3d-aef4-58f085c77cd8

**[S15] automoto/big-five-data GitHub**  
Derived scored dataset with country, age, binary biological-sex field and Big Five scores. Use as reference/prototyping unless licensing is separately confirmed.  
https://github.com/automoto/big-five-data

**[S16] "Revisiting gender differences in personality: New evidence on Big Five domains and facets with large-scale samples from 27 nations" (2026)**  
Representative adult samples, N=143,313.  
https://www.sciencedirect.com/science/article/pii/S0191886926001704

**[S22] "Challenges to capture the big five personality traits in non-WEIRD populations"**  
Cross-cultural measurement warning.  
https://pmc.ncbi.nlm.nih.gov/articles/PMC6620089/

## Cultural/value data

**[S17] World Values Survey Conditions of Use**  
Reviewed download terms specify non-profit use and restrict redistribution for the relevant data files.  
https://www.worldvaluessurvey.org/AJDownloadLicense.jsp  
https://www.worldvaluessurvey.org/WVSContents.jsp?CMSID=intconduse

## History / structured knowledge

**[S18] Wikimedia REST API**  
https://www.mediawiki.org/wiki/Wikimedia_REST_API

**[S19] Wikidata Query Service**  
https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service  
https://query.wikidata.org/sparql

## Digital infrastructure

**[S20] Cloudflare Radar Internet Quality Index API**  
https://developers.cloudflare.com/api/resources/radar/subresources/quality/

**[S21] Cloudflare Radar outage API**  
https://developers.cloudflare.com/api/resources/radar/subresources/annotations/subresources/outages/

---

# 84. Final system map

```text
PROJECT CREATION
      |
      v
MARKET RESOLUTION
      |
      + business home
      + target market
      + persona market
      + locale
      + infrastructure market
      |
      v
COUNTRY INTELLIGENCE GATEWAY
      |
      + World Bank
      + CLDR
      + UNDP
      + UNSD
      + OECD
      + Eurostat
      + Cloudflare Radar
      + Wikidata/Wikimedia
      + approved optional sources
      |
      v
VERSIONED MARKET OBSERVATIONS
      |
      + demographics
      + economy
      + gender indicators
      + locale
      + digital infrastructure
      + history/current context
      |
      +---------------------------+
      |                           |
      v                           v
PERSONALITY DATA PIPELINE    CULTURAL SIGNALS
      |                           |
      v                           v
POPULATION PRIORS            LICENSED CONTEXT
      |                           |
      +-------------+-------------+
                    |
                    v
          MARKET CONTEXT SNAPSHOT
                    |
                    v
              CONTEXTPACK
                    |
                    v
             MOSAI CAPABILITY
                    |
                    v
              modelGateway
                    |
                    v
             USER-FACING WORK

RULE:
Population context may inform a hypothesis.
It may not define a person.
```
