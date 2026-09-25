# MOSAI Zero-Input Organization Discovery & Smart Onboarding Blueprint

**Status:** implementation blueprint  
**Date:** 25 September 2026  
**Target:** MOSAI onboarding + Project Bootstrap  
**Reference pattern:** Ploy-style work-email → company discovery → minimal confirmation  
**Audience:** product owner, UX designer, backend engineer, privacy reviewer, Codex/AI coding agent

---

# 0. Executive decision

MOSAI should adopt a **discover before asking** onboarding model.

Target experience:

```text
Sign up with work email
        ↓
derive company domain
        ↓
resolve likely organization
        ↓
enrich company
        +
crawl first-party website
        +
extract business/brand/offering signals
        ↓
reconcile evidence
        ↓
show a short "Is this right?" confirmation
        ↓
ask only what MOSAI could not know
        ↓
start MOSAI bootstrap workflow
        ↓
first useful artifacts already waiting
```

The Ploy pattern is publicly visible. Ploy's current demo states that the user provides a work email and Ploy reads the company/site automatically, asking only for information it cannot find. [S1]

Ploy's Contact Tools documentation also shows company enrichment from a domain, company name or LinkedIn company page, and people enrichment from email/name+domain/LinkedIn URL. [S2]

MOSAI should copy the **product behavior**, not presume or copy Ploy's private implementation.

---

# 1. Product goals

## 1.1 Primary goal

Reduce onboarding from:

```text
Company name
Industry
Company size
Website
Description
Products
Audience
Competitors
Goals
Channels
Tone
...
```

to ideally:

```text
Work email
+
one business-goal decision
```

Everything else should be:

```text
found
inferred
prepared
or asked only when genuinely uncertain
```

## 1.2 Desired first-run feeling

The first MOSAI screen should not be empty.

Example:

```text
Hi Anna. I found North Star Coffee.

Amsterdam · Café / specialty coffee

What I found:
✓ Website and location
✓ Main offer
✓ Brand style
✓ Likely customer groups
✓ Social links

I'm already preparing:
○ Customer profiles
○ Content opportunities
○ Website improvements

One thing I need from you:

What matters most right now?

[More local customers]
[More repeat visits]
[Better content]
[Improve website]
[I'm not sure]
```

## 1.3 Success metrics

Track:

- time from signup → company match;
- company-match acceptance rate;
- fields automatically resolved;
- number of onboarding questions shown;
- time to first useful artifact;
- correction rate per field;
- wrong-company rate;
- enrichment cost per activated user;
- enrichment provider coverage;
- bootstrap completion rate;
- drop-off before first value.

---

# 2. Research: what Ploy publicly demonstrates

## 2.1 Signup/demo pattern

Ploy's demo currently says:

> "Drop your work email and Ploy reads your company and site automatically. No forms to fill out — we only ask for what we can't find."

Source: [S1].

This validates the UX pattern.

## 2.2 Enrichment capabilities

Ploy's public docs say its Contact Tools can:

- enrich companies from domain, company name or LinkedIn company page;
- enrich people from LinkedIn URL, email, or name + company domain;
- return company data such as industry, description, employee count, headquarters, founding year, funding history and technology stack. [S2]

Ploy does not publicly identify the exact underlying enrichment vendor in the documentation reviewed.

Do not claim that Ploy uses Apollo, CompanyEnrich, Clearbit, LinkedIn APIs or any other specific provider without evidence.

## 2.3 Privacy model

Ploy's privacy policy states it receives company/business information from third-party enrichment providers and public sources, including firmographic and technographic information. [S3]

MOSAI should implement its own lawful, minimized data model rather than mirror every field Ploy may collect.

---

# 3. Principle: company enrichment first, personal enrichment later

For MOSAI onboarding, the valuable chain is:

```text
anna@northstarcoffee.nl
        ↓
northstarcoffee.nl
        ↓
North Star Coffee
        ↓
business context
```

MOSAI does **not** need a deep employee dossier to understand the company.

MVP should avoid unnecessary personal enrichment such as:

- private phone number;
- employment history;
- education;
- personal social graph;
- personal interests.

The user's authenticated name/email is enough for account identity.

The enrichment system's job is primarily:

> Identify and understand the organization the user wants MOSAI to work on.

This is both simpler and more aligned with GDPR data-minimisation principles. [S8]

---

# 4. Input hierarchy

The resolver accepts:

```ts
type OrganizationResolutionInput = {
  authenticatedEmail?: string;
  claimedWebsite?: string;
  claimedCompanyName?: string;
  claimedLinkedInCompanyUrl?: string;
};
```

Preferred identifiers:

```text
1. user-provided website/domain
2. work-email domain
3. LinkedIn company URL if explicitly supplied
4. company name + location
```

A domain is usually a stronger unique organization identifier than a display name. Ploy explicitly recommends using a company domain rather than only a company name. [S2]

Apollo's organization enrichment API also accepts domain, LinkedIn URL, website or company name, and says multiple identifiers can improve match accuracy. [S4]

---

# 5. Work-email domain resolver

## 5.1 Normalize

Example:

```text
Anna.Meyer@WWW.NorthStarCoffee.nl
→ northstarcoffee.nl
```

Rules:

- lowercase;
- trim whitespace;
- IDN/punycode normalize;
- reject malformed addresses;
- derive registrable domain carefully;
- never treat subdomain blindly as company;
- maintain personal/free-email domain list;
- maintain disposable-email domain detection.

## 5.2 Personal domains

If:

```text
@gmail.com
@outlook.com
@hotmail.com
@icloud.com
@yahoo.com
@proton.me
...
```

do not guess the business.

Show:

```text
What's your business website?

[ northstarcoffee.nl ]

Don't have a website?
[Enter business name instead]
```

## 5.3 Agency/freelancer edge case

A user's email domain may be their agency while the project is for a client.

Therefore company discovery is a **candidate**, not a permanent account binding.

Screen:

```text
I found Pocket Department.

Is this the business you want to work on?

[Yes]
[Create a different business]
```

Support multiple projects/organizations from day one.

---

# 6. Provider abstraction

Create:

```text
src/convex/intelligence/company/
  contracts.ts
  gateway.ts
  resolve.ts
  reconcile.ts
  confidence.ts

  providers/
    apollo.ts
    companyEnrich.ts
```

Do not call a vendor directly from onboarding UI.

Contract:

```ts
interface CompanyIntelligenceProvider {
  id: string;

  enrichByDomain(
    domain: string,
    ctx: ProviderContext
  ): Promise<NormalizedCompanyCandidate | null>;

  enrichByWebsite?(
    website: string,
    ctx: ProviderContext
  ): Promise<NormalizedCompanyCandidate | null>;

  enrichByLinkedInCompanyUrl?(
    url: string,
    ctx: ProviderContext
  ): Promise<NormalizedCompanyCandidate | null>;
}
```

## 6.1 Normalized candidate

```ts
type NormalizedCompanyCandidate = {
  legalOrDisplayName?: SourcedValue<string>;
  domain?: SourcedValue<string>;
  websiteUrl?: SourcedValue<string>;
  linkedinUrl?: SourcedValue<string>;

  industry?: SourcedValue<string>;
  description?: SourcedValue<string>;
  employeeRange?: SourcedValue<string>;
  headquarters?: SourcedValue<string>;
  foundedYear?: SourcedValue<number>;
  revenueRange?: SourcedValue<string>;
  technologies?: SourcedValue<string[]>;

  providerRecordId?: string;
  retrievedAt: number;
};
```

Vendor-specific fields do not leak into project tables.

---

# 7. MVP provider candidates

## 7.1 Apollo

Apollo's current Organization Enrichment endpoint can identify companies using:

- domain;
- LinkedIn company URL;
- website;
- name.

Potential data includes:

- industry;
- employee count;
- revenue;
- funding;
- locations;
- technology information;
- organization hierarchy. [S4]

Apollo currently lists organization enrichment as one credit per organization. Pricing/contracts should still be checked before production launch. [S4]

### Strengths for MOSAI

- established B2B enrichment;
- multiple matching identifiers;
- technology/funding/headcount useful for B2B context;
- people enrichment available later if product needs it.

### Weaknesses

- SMB/local hospitality coverage must be tested, not assumed;
- much returned data is irrelevant to a café/restaurant;
- external business database can be stale.

## 7.2 CompanyEnrich

CompanyEnrich documents:

- company enrichment by domain/name/social profile;
- reverse work-email lookup;
- company search;
- people search;
- workforce data;
- MCP access. [S5]

Its domain endpoint says domain is the preferred company-enrichment path and costs one credit per call in current docs. [S6]

### Strengths

- domain-centric API matches the MOSAI pattern;
- simple real-time interface;
- broad company-intelligence feature set.

### Weaknesses

- provider maturity/coverage should be benchmarked;
- do not choose on feature-list alone.

## 7.3 Provider decision

Do not decide in architecture.

Run a bake-off using 50-100 known businesses across:

```text
B2B SaaS
local café
restaurant
e-commerce
agency
freelancer
professional services
hospitality
retail
startup
larger enterprise
NL/PL/DE/UK/US examples
```

Score:

```text
correct match
coverage
name accuracy
domain accuracy
industry
location
employee count
social links
tech stack
freshness
latency
credit cost
error rate
```

Choose the MVP default based on measured coverage for MOSAI's target users.

---

# 8. First-party website intelligence is more important than enrichment alone

An enrichment provider tells MOSAI:

```text
what company database providers think the company is
```

The website tells MOSAI:

```text
what the company currently says it sells
```

For marketing work, the latter is often more useful.

Therefore:

```text
provider enrichment
+
first-party website crawl
```

must be reconciled.

Your existing MOSAI research/scraping capabilities should be reused.

Prioritize pages:

```text
/
about
products/services
pricing/menu
locations/contact
case studies/customers
FAQ
blog/resources
```

Extract:

- organization name;
- headline/value proposition;
- offerings;
- audience references;
- locations;
- language;
- contact/location facts;
- social links;
- pricing/menu indicators;
- brand terminology;
- logo/brand assets;
- structured metadata;
- schema.org organization/local-business/product data where present.

---

# 9. Never scrape LinkedIn as a core dependency

Do not make MOSAI's onboarding dependent on custom LinkedIn scraping.

Prefer:

1. company LinkedIn URL returned by an enrichment provider;
2. LinkedIn URL linked from the company's own website;
3. LinkedIn OAuth/API only for officially supported user-authorized use cases;
4. provider-enriched public business data where contractually permitted.

LinkedIn should be an **evidence reference**, not the fragile core of identity resolution.

---

# 10. Resolution pipeline

```text
Authenticated email
        ↓
Domain classifier
        ↓
personal domain? ──yes──→ ask website/business
        │
        no
        ↓
Company provider gateway
        │
        ├→ Provider A
        └→ optional fallback
        ↓
Website resolver
        ↓
First-party crawl
        ↓
Structured extraction
        ↓
Reconciliation engine
        ↓
Business candidate
        ↓
confidence evaluation
        ↓
high   → concise confirmation
medium → confirmation + one ambiguity
low    → ask website/name
```

---

# 11. Reconciliation

Do not let the model arbitrarily decide which provider is correct.

Use deterministic evidence precedence.

Suggested authority:

```text
user confirmed
user supplied website
company first-party website
verified connected business account
reputable enrichment provider
search/public business source
model inference
```

Example conflict:

```text
Apollo:     HQ = London
Website:    "Amsterdam office"
User:       "We're based in Amsterdam"
```

Result:

```text
primary business location = Amsterdam
source = user_confirmed
```

Keep the conflicting evidence if useful, but do not let it override.

---

# 12. Confidence

Confidence must not be merely "LLM says 0.91".

Construct it from signals.

Example factors:

```text
exact domain match
website resolves
website organization name matches provider name
LinkedIn domain matches
location agreement
business description agreement
provider freshness
multiple independent signals
```

Example:

```ts
confidence =
  domainMatch * 0.35 +
  websiteNameMatch * 0.20 +
  crossSourceAgreement * 0.20 +
  websiteResolution * 0.10 +
  locationAgreement * 0.05 +
  providerQuality * 0.10;
```

The exact weights need evaluation data.

Policy:

```text
>= 0.85 high
0.65-0.84 medium
< 0.65 low
```

Do not hard-code thresholds before testing.

---

# 13. BusinessCandidate lifecycle

Do not immediately write inferred data into confirmed `projects.businessProfile`.

Use:

```text
organizationCandidates
```

or an agent artifact.

State:

```text
resolving
candidate
needs_confirmation
confirmed
rejected
expired
```

After user confirmation:

```text
business.confirmed.v1
```

Then normal MOSAI bootstrap begins.

---

# 14. Provenance model

Every field needs source metadata.

```ts
type SourcedValue<T> = {
  value: T;

  authority:
    | "user_confirmed"
    | "first_party"
    | "provider"
    | "public_source"
    | "inferred";

  sourceRefs: EvidenceRef[];
  confidence?: number;
  retrievedAt?: number;
};
```

Example:

```json
{
  "employeeRange": {
    "value": "51-200",
    "authority": "provider",
    "sourceRefs": [
      {"provider": "apollo", "recordId": "..."}
    ],
    "confidence": 0.8
  }
}
```

If user changes it:

```json
{
  "employeeRange": {
    "value": "20-30",
    "authority": "user_confirmed"
  }
}
```

The provider must never overwrite it.

---

# 15. Smart onboarding UX

## Screen 1: registration

```text
Create your MOSAI account

Work email
[ anna@northstarcoffee.nl ]

[Continue]

Using a personal email?
That's fine too.
```

Do not explain enrichment yet in a paragraph.

Provide short privacy disclosure and link.

## Background

Immediately:

```text
resolve domain
start provider lookup
resolve website
start lightweight crawl
```

## Screen 2: progressive state

Avoid spinner-only UX.

```text
Getting your workspace ready

✓ Found North Star Coffee
✓ Reading your website
○ Understanding your offer
○ Preparing your workspace
```

## Screen 3: confirmation

```text
I found your business

North Star Coffee
Amsterdam
Specialty café and coffee shop

What you offer:
• Specialty coffee
• Brunch
• Pastries

Likely customers:
• Local residents
• Remote workers
• Weekend visitors

[Yes, this is us]

[Fix something]
[Different business]
```

Do not show employee count/funding/tech stack unless it helps the user.

## Screen 4: ask what cannot be inferred

```text
One thing I can't know from your website:

What matters most right now?

[Bring in more customers]
[Increase repeat visits]
[Create better content]
[Improve our website]
[Sell more online]
[I'm not sure]
```

This is a human business decision, so it should be asked.

---

# 16. Progressive bootstrap

As soon as company identity is sufficiently resolved:

```text
start low-risk work
```

but do not treat unconfirmed strategic facts as final.

Parallel tasks may prepare:

- crawl inventory;
- brand asset discovery;
- technical website audit;
- initial business profile draft.

After confirmation:

- personas;
- journeys;
- content gaps;
- website plan;
- next-best actions.

This minimizes time-to-first-value.

---

# 17. "Only ask what we can't find" needs a second rule

A dangerous interpretation is:

> If we can infer it, never ask.

Better:

> **Only ask when the answer is either unknowable from evidence or important enough that a wrong assumption would materially change the outcome.**

Examples.

Do not ask:

```text
What is your website?
```

if domain resolves confidently.

Ask:

```text
Do you primarily want local foot traffic or online orders?
```

because the website may not reflect the owner's current priority.

---

# 18. Handling ambiguous company matches

Example:

```text
email: anna@acme-group.com
provider returns multiple subsidiaries
```

Show:

```text
Which business should MOSAI work on?

Acme Group
Acme Netherlands
Acme Retail

[Select]
```

Do not silently choose.

---

# 19. Personal email fallback

For Gmail/etc.:

```text
I couldn't identify a business from this email.

What's the business website?

[example.com]

or

[Search by business name]
```

If no website:

```text
Business name
City / country
```

Then resolve via provider/search.

---

# 20. Businesses without a traditional website

Important for cafés/restaurants/local services.

Allow:

```text
Google Business name
Instagram handle
Facebook page
business name + city
```

as discovery aids.

But normalize the result into the same BusinessCandidate contract.

Do not make social platforms the canonical project identity.

---

# 21. Multi-business users

A user account can belong to many organizations/projects.

Do not encode:

```text
user.emailDomain == user.organization forever
```

Instead:

```text
account identity
≠
active business/project
```

After first project:

```text
Create another project
```

can repeat discovery independently.

---

# 22. Privacy and GDPR design

This blueprint is product/technical guidance, not legal advice. Obtain legal review before launch.

## 22.1 Data minimisation

The European Commission identifies data minimisation and purpose limitation as core GDPR principles. Only collect/process personal data necessary for the stated purpose. [S8]

For company onboarding, MOSAI usually needs:

```text
user identity
company identity
company business facts
```

not:

```text
employee personal history
private contact details
personal social data
```

## 22.2 Transparency

If personal data is obtained from sources other than the person, GDPR Article 14 transparency obligations may apply. The EDPB's SME guidance explains that information duties differ between direct and indirect collection and generally must be fulfilled no later than the applicable Article 14 timeframe. [S9]

Therefore:

- privacy notice must clearly describe enrichment;
- list categories/sources at an appropriate level;
- document lawful basis;
- provide correction/deletion mechanisms;
- maintain provider DPAs and transfer safeguards;
- log which source produced which personal data;
- avoid enriching people unless needed.

## 22.3 Company versus personal data

A company record can still contain personal data, e.g.:

```text
founder name
work email
phone belonging to individual
```

Treat it appropriately.

"Business data" does not automatically mean "not personal data".

---

# 23. Security

Provider response is untrusted input.

Validate:

- URL schemes;
- domain shape;
- field lengths;
- array limits;
- redirects;
- HTML;
- provider payload schemas.

Website content may contain prompt injection.

Pass it to AI as **evidence data**, not instructions.

Never allow crawled content to:

- select tools;
- expose secrets;
- change project access;
- trigger arbitrary provider calls.

---

# 24. Cost controls

Organization discovery has external API costs.

Rules:

1. Cache successful company-domain resolution with freshness timestamp.
2. Do not pay for enrichment on every login.
3. Avoid duplicate requests for same normalized domain.
4. Use one provider first, fallback only when needed.
5. Stop person enrichment in MVP.
6. Separate enrichment credit budget from AI budget.
7. Track cost to activated project, not merely lookup count.

Suggested:

```text
companyLookupUsage
```

with:

```text
provider
domainHash
status
credits
latency
matched
createdAt
```

Do not store provider secrets or unnecessary raw records.

---

# 25. Freshness

Different fields age differently.

Example:

```text
domain/name         long TTL
HQ/location         medium TTL
employee count      shorter TTL
funding             medium TTL
technology stack    shorter TTL
website content     invalidate when recrawled
```

Do not force one TTL on all data.

Confirmed user facts do not expire merely because provider cache does.

---

# 26. Provider fallback strategy

Example:

```text
domain
  ↓
Provider A
  ↓
high-confidence match? yes → stop
  │
  no
  ↓
Provider B or first-party crawl/search
```

Do not query every paid provider for every signup.

A waterfall is cheaper and easier to debug.

---

# 27. Implementation schema

Suggested tables:

```text
organizationCandidates
organizationEvidence
companyEnrichmentRuns
```

Candidate:

```ts
{
  userId,
  domain,
  status,

  normalizedCandidate,
  confidence,

  providerIds,
  evidenceRefs,

  createdAt,
  confirmedAt,
  rejectedAt
}
```

Enrichment run:

```ts
{
  userId,
  domainHash,
  provider,
  status,
  creditsUsed,
  startedAt,
  finishedAt,
  errorCategory
}
```

---

# 28. Integration with Future-Proof Agent Blueprint

Organization discovery exposes a capability:

```text
organization.resolve.v1
```

Output:

```text
BusinessCandidate.v1
```

Confirmation emits:

```text
business.confirmed.v1
```

The MOSAI orchestrator then starts:

```text
bootstrapProject.v1
```

The onboarding UI does **not** call persona/content/site generators directly.

---

# 29. Testing matrix

Create automated/manual fixtures:

| Case | Expected |
|---|---|
| exact B2B work domain | match automatically |
| Gmail signup | ask website |
| domain redirects | canonicalize |
| holding-company domain | ask selection |
| local café | match/crawl gracefully |
| no website | business name/location fallback |
| website in Polish/Dutch | language-safe extraction |
| company renamed | reconcile |
| stale enrichment | prefer website/user |
| wrong provider match | easy reject |
| agency email + client project | allow different business |
| two brands one domain | ask brand |
| malicious website prompt | treated as data |
| provider 429 | fallback/retry without UX corruption |

---

# 30. Provider benchmark before committing

Build a script:

```text
scripts/benchmark-company-enrichment.ts
```

Input CSV:

```text
domain,expected_name,expected_country,expected_industry
```

Output:

```text
provider
match
latency
coverage
field accuracy
credit cost
```

Use real companies from MOSAI target segments.

Do not choose a provider from marketing copy.

---

# 31. MVP scope

MVP:

- work-email domain extraction;
- personal-domain fallback;
- one default CompanyIntelligenceProvider;
- first-party website crawl;
- normalized BusinessCandidate;
- provenance;
- confidence;
- confirmation screen;
- one "goal" question;
- `business.confirmed.v1`;
- bootstrap workflow.

Not MVP:

- employee prospecting;
- private email discovery;
- phone enrichment;
- job history;
- intent data;
- visitor deanonymization;
- large-scale prospect search.

---

# 32. Acceptance criteria

## User

- [ ] User can create first project with work email + at most one strategic question in the happy path.
- [ ] User sees the discovered business before MOSAI commits it.
- [ ] Wrong business can be corrected in one action.
- [ ] Personal email still works.
- [ ] User can choose a different business than email domain.
- [ ] User sees useful project progress immediately after confirmation.

## Data

- [ ] Every enriched field has provenance.
- [ ] User-confirmed value outranks provider.
- [ ] Provider cannot overwrite locked value.
- [ ] Raw provider schema does not leak into project schema.
- [ ] Duplicate lookup is avoided.
- [ ] Company data can be refreshed independently.

## Privacy

- [ ] Privacy notice discloses enrichment/public-source use.
- [ ] MVP does not perform unnecessary person enrichment.
- [ ] Data retention is defined.
- [ ] User can correct/delete data according to product/privacy policy.
- [ ] Provider DPAs/transfers are reviewed before production.

## Reliability

- [ ] Provider outage does not block signup.
- [ ] Website crawl failure does not block account creation.
- [ ] Ambiguous company match asks rather than guesses.
- [ ] Provider swap requires adapter/config change, not UX rewrite.

---

# 33. Recommended rollout

## Phase 1
Domain + website crawl only.

Prove:

```text
Can MOSAI correctly identify the company?
```

## Phase 2
Add enrichment provider.

Measure incremental value over website-only.

## Phase 3
Add second-provider fallback if coverage justifies cost.

## Phase 4
Add richer context only where a MOSAI feature actually uses it.

Do not collect data because an API offers it.

---

# 34. Sources

**Ploy**

- [S1] Ploy demo, work-email automatic company/site discovery: https://ploy.ai/demo
- [S2] Ploy Contact Tools: https://docs.ploy.ai/contact-tools
- [S3] Ploy Privacy Policy, third-party/public enrichment sources: https://ploy.ai/privacy

**Enrichment providers**

- [S4] Apollo Organization Enrichment: https://docs.apollo.io/reference/organization-enrichment
- [S5] CompanyEnrich getting started/API overview: https://docs.companyenrich.com/docs/getting-started
- [S6] CompanyEnrich domain enrichment: https://docs.companyenrich.com/reference/get_companies-enrich

**Privacy**

- [S8] European Commission, GDPR processing principles: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en
- [S9] European Data Protection Board, right to be informed and direct/indirect collection: https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en

**MOSAI architecture dependency**

- Convex Workflow: https://www.convex.dev/components/workflow
- MOSAI repo: https://github.com/julekpl/Mosai-friday

---

## Research note

Ploy's public materials establish the product pattern and its general enrichment capabilities, but do **not** establish which specific enrichment vendor(s) implement Ploy's onboarding. This blueprint deliberately avoids that unsupported inference.

All vendor capabilities referenced were checked against public documentation on 25 September 2026. Coverage, price and contractual terms must be re-checked before production procurement.
