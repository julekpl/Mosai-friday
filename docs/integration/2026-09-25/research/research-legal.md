# Legal/privacy research: D5, D12, D13, camera capture (2026-09-25)

Not legal advice. General guidance only, for planning purposes; get counsel sign-off
before launch. Sources cited per item; a few items marked UNVERIFIED (only
secondary/aggregator sources found in the time box).

## D5: Art. 14 notice when enriching a company from a third-party provider

**Is a sole trader's business record personal data?** Yes, generally. GDPR defines
personal data as anything relating to an identified/identifiable natural person; a
sole trader operates under their own legal personality, so their name, trading
name, business email/phone and address are normally personal data. The UK ICO
confirms sole traders have full GDPR obligations and no sole-trader exemption
([ICO, sole trader self-assessment](https://ico.org.uk/for-organisations/advice-for-small-organisations/news-blogs-and-events/news/new-data-protection-self-assessment-checklist-for-sole-traders/);
[ICO B2B marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)).
A Polish court case confirms this extends even to suspended sole-trader
registrations ([IAPP summary of Polish court ruling](https://iapp.org/news/a/polish-court-overturns-dpas-first-gdpr-fine)).
Employee/founder names and work emails found in a company record are personal
data of those individuals even though the "subject" of the record is a company.

**Options and risk:**

| Option | Risk | Notes |
|---|---|---|
| A. Send Art. 14 notice by email to every enriched contact within 1 month or at first contact (whichever earlier) | Low legal risk, highest ops cost | Required content: identity/contact of controller, purposes, legal basis, categories of data, **named source/register** (generic "our data provider" is not enough), recipients, retention, rights, right to complain to a DPA: [Art. 14 GDPR text](https://gdpr-info.eu/art-14-gdpr/), [EDPB-aligned summary](https://www.legiscope.com/blog/gdpr-article-14-third-party.html) |
| B. Rely on Art. 14(5)(b) "disproportionate effort" and instead publish a public notice (privacy policy page) | High risk if invoked casually | Regulators read this narrowly. A CNIL-style and Polish-DPA pattern of enforcement targets exactly this: B2B SaaS/enrichment vendors invoking disproportionate effort without a documented assessment. Cost alone does NOT establish disproportionate effort: courts have rejected "it would cost as much as our annual revenue" ([IAPP](https://iapp.org/news/a/polish-court-overturns-dpas-first-gdpr-fine)). Must have a **written, reasoned assessment** (volume vs. individual impact, alternative less-effortful means considered) plus the compensating public notice, appropriate measures (e.g. searchable public page), and data protection principles otherwise fully respected. |
| C. Legitimate interest as legal basis + Art. 14 notice at first meaningful contact (e.g. when the founder is shown the enriched draft persona/company profile, before it's saved) | Recommended | Matches MOSAI's UX: enrichment happens in-flow during signup/onboarding, so "first communication to the data subject" is essentially immediate: satisfies the tighter of Art. 14(3)(a)/(b) deadlines automatically. Legitimate interest is the standard basis used in B2B enrichment/cold-outreach practice ([overview](https://blog.betterenrich.com/gdpr-and-data-enrichment-what-is-legal), [Sales Force Europe](https://salesforceeurope.com/blog/what-is-legitimate-interest-for-gdpr-cold-email-b2b-rules)) but requires a documented Legitimate Interest Assessment (LIA): purpose, necessity, balancing test against the individual's expectations. |

**Contract vs. legitimate interest:** the enrichment subject (e.g. a founder found
in a public company register) is not the MOSAI customer under contract: the
*business* is. So "necessary for performance of a contract" does not usually cover
processing a third individual's personal data; legitimate interest (Art. 6(1)(f))
is the fitting basis, not contract.

**What the privacy notice must say (Art. 14(1)-(2) checklist):**
- Controller identity and contact details (+ DPO contact if any)
- Purposes of processing and the legal basis relied on
- If legitimate interest: what that legitimate interest actually is
- Categories of personal data concerned (name, role/title, work email, etc.)
- **Source**, and whether it came from publicly accessible sources: name the
  actual register/provider, not "marketing partners" or "third-party providers"
  generically ([Art. 14 GDPR](https://gdpr-info.eu/art-14-gdpr/))
- Recipients or categories of recipients (including MOSAI's enrichment sub-processor)
- International transfer safeguard, if any (see below)
- Retention period or criteria used to determine it
- Rights: access, rectification, erasure, restriction, objection (with explicit
  right to object to processing for legitimate-interest purposes), and the right
  to lodge a complaint with a supervisory authority
- Whether provision is a statutory/contractual requirement (N/A here: say so)
- Timing: within a reasonable period and at latest **1 month** after obtaining the
  data, or at first communication with that individual, whichever is earlier
  ([Art. 14(3)](https://gdpr-info.eu/art-14-gdpr/))

**Retention:** keep enriched personal data only as long as needed for the stated
purpose (persona/company context); define a retention period tied to project
lifecycle and delete on project deletion per `cascadeDeleteProject` in `dal.ts`
per AGENTS.md rule 12. Recommend explicit TTL (e.g. re-verify or purge stale
enrichment data after a defined period, e.g. 12-24 months): treat as a product
decision, not settled by this research.

**DPA with provider:** MOSAI is a controller for the enriched personal data
(it decides purposes/means); the enrichment API provider is a processor if it
only fetches/returns data on MOSAI's instructions, or a separate controller if
it curates/sells its own database. Confirm the provider's role contractually and
put a GDPR Art. 28 Data Processing Agreement in place before launch either way
(controller-controller relationships still need a data-sharing agreement).
**Action item, not yet verified against a specific vendor: get the DPA/contract
in writing before enabling this feature in production.**

**International transfers / EU-US DPF status (2026):** the EU-US Data Privacy
Framework remains valid adequacy law as of September 2026: the EU General Court
upheld the Commission's adequacy decision in **September 2025**, rejecking a
first annulment action: but a further appeal is pending before the CJEU, and
NOYB/Schrems has filed a second challenge ("Schrems III") arguing US executive
order 14086 and PCLOB independence are insufficient safeguards; PCLOB lost
quorum after member removals in Jan 2025 ([DLA Piper, Sept 2025](https://privacymatters.dlapiper.com/2025/09/eu-u-s-data-privacy-framework-survives-first-challenge/);
[activeMind.legal on Supreme Court FTC removal-power ruling risk](https://www.activemind.legal/guides/dpf-supreme-court/);
[EuropeanMartech 2026 status explainer, UNVERIFIED aggregator](https://europeanmartech.eu/blog/eu-us-data-privacy-framework-2026-status)).
**Recommendation:** if the enrichment provider is US-based, verify current DPF
self-certification status at transfer time (it can lapse) and keep Standard
Contractual Clauses as a fallback in the DPA in case DPF is invalidated
("Schrems III" risk is live, not hypothetical): do not hard-code DPF-only as
the transfer mechanism.

**Before launch, must be true:**
1. LIA documented and kept on file for the legitimate-interest basis.
2. In-product Art. 14 notice shown at/near first display of enriched data (not
   buried only in a general privacy policy): named source, categories, rights.
3. DPA signed with the enrichment provider; transfer mechanism (DPF cert check
   or SCCs) confirmed and re-checked periodically.
4. Retention/deletion rule wired into `cascadeDeleteProject` and a standalone
   TTL for stale enrichment.
5. An objection/erasure path exists for a data subject who is not a MOSAI
   customer (e.g. a named founder who wants their info removed): this needs a
   support workflow since they have no MOSAI account.

**Recommendation:** Option C (legitimate interest + immediate in-flow Art. 14
notice). Do not rely on 14(5)(b) disproportionate-effort as the primary basis -
current enforcement trend (Poland, CNIL) treats it as an exception requiring a
documented, defensible assessment, not a default shortcut, and MOSAI's per-user
in-flow UX makes proper notice cheap to deliver anyway.

---

## D12: Auto-fetching the public website at a signup email's domain before user confirms

Fetching a company's already-public website (no login, no personal account) is
generally lower risk than personal-data enrichment because:
- The site is public by the site owner's own choice, and MOSAI's own
  `safeFetch` SSRF guard already applies (AGENTS.md rule 8), so this is a security
  non-issue technically, only a transparency/expectations issue.
- ePrivacy Directive mainly restricts storing/reading information *on the user's
  own device* (cookies, terminal equipment) and unsolicited electronic
  communications; a server-side fetch of a public webpage by MOSAI is not
  ePrivacy "terminal equipment" access and not itself a marketing communication,
  so ePrivacy's consent-for-cookies/consent-for-marketing rules do not squarely
  apply to this specific action. (No direct authority found in the time box;
  flagging as UNVERIFIED but low-risk by nature of the mechanism.)
- If the fetched page contains personal data (e.g. an "our team" page with
  named staff, photos), the same Art. 14 analysis as D5 could in principle apply
  if MOSAI stores and structures those individuals' personal data for a new
  purpose: but a one-time transient prefill of business content (colors, logo,
  copy) used to speed up the *user's own* onboarding is materially different
  from building/storing a database on third parties. Risk rises if MOSAI stores
  scraped personal data (staff names/photos) longer-term or reuses it for
  another purpose.

**Options:**

| Option | Risk | Notes |
|---|---|---|
| A. Fetch silently before confirmation, no disclosure | Medium (trust/UX risk even if technically lawful) | Surprises users ("how did it already know my site"); erodes trust even without a clear legal violation |
| B. Disclose ("We found a website at yourdomain.com: want us to pull your logo and colors?") with a skip/decline option, fetch only after | Low | Matches AGENTS.md rule 3 ("client input is untrusted... load context on server") is not violated since this is a first-party convenience fetch, not passing client-supplied context into an AI call without basis; still recommend explicit disclosure for trust and to avoid surprising business-email domains that aren't the company site (e.g. gmail.com, generic ISPs: must skip free-mail domains) |
| C. Fetch only after explicit opt-in click | Lowest risk, slower UX | Safer if the target domain sometimes isn't the user's own business (e.g. shared/parent-company domains) |

**Recommendation:** Option B: disclose what was found and offer a one-click
skip before using the fetched content, and explicitly exclude common free-email
domains (gmail/outlook/etc.) from any auto-fetch trigger to avoid fetching
unrelated third-party sites. Do not persist or display any personal data
(staff names/photos) found on the fetched page without going through the same
Art. 14 treatment as D5 if it will be stored/reused.

---

## D13: Prefilling store currency from detected market

Reviewed against the EU Price Indication Directive and the "Omnibus" Directive
(2019/2161, amending Unfair Commercial Practices/Consumer Rights Directives).
Those rules govern how a **trader displays prices to consumers** (selling-price
transparency, prior-price disclosure for discounts, marketplace ranking
disclosures): they do not regulate a merchant's own back-office currency
*default* in a store-setup form. Prefilling an **empty** seller setting that the
merchant can review and change before publishing is a UX default, not a price
representation to consumers, so it does not engage Price Indication Directive or
Omnibus obligations. UNVERIFIED against a specific regulator statement (no
direct authority found in the time box on "prefilled currency setting" as a
term of art); conclusion is based on the general scope of those directives
(consumer-facing price display, not merchant back-office defaults).

**Recommendation:** Low risk: confirmed. Ship as-is, provided: (1) it only
prefills an editable, empty field and never silently overrides an
already-configured currency; (2) the storefront still displays final prices
inclusive of VAT/taxes and in the currency actually configured at publish time,
per standard Price Indication Directive/Omnibus consumer-facing requirements
(those apply to what's *shown to buyers*, unaffected by this ticket).

---

## Camera capture of photos with people in them (media blueprint)

Not deeply researched in this time box (out of core scope of D5/D12/D13) but
noting the shape of the issue since it was flagged:
- If MOSAI's in-app camera captures photos of identifiable people (customers,
  staff, bystanders) for the business's own marketing content, **the business
  (data controller for that photo)** is responsible for its own lawful basis
  (e.g. consent from people photographed, or legitimate interest with
  appropriate notice): this is normally the *device owner's* responsibility
  under GDPR, similar to any camera app, not something MOSAI as platform
  provider can discharge on the business's behalf.
- MOSAI's own responsibility: (a) do not silently upload/process captured
  photos for MOSAI's own purposes (e.g. training, moderation ML) beyond what's
  disclosed; (b) if MOSAI runs any face-detection (not identification) for
  UX features (e.g. auto-crop/auto-focus), keep it strictly detection-only
  (bounding box, no biometric template/identification) to stay outside GDPR's
  special-category biometric-data regime (Art. 9), and say so in the privacy
  notice; face *recognition*/identification would trigger Art. 9 special
  category data and require explicit consent or another Art. 9(2) condition -
  avoid that entirely unless a ticket specifically calls for it.
- **Recommendation:** ship a short in-app reminder/tooltip when the camera
  feature is used ("Make sure you have permission from anyone in your photos
  before using them in ads/marketing"): an owner-responsibility disclosure,
  not a blocking consent flow: and keep any on-device face detection
  non-identifying. Flag for a follow-up ticket/ADR before any face-recognition
  or biometric feature is added.

---

## Privacy notice checklist (consolidated, for D5 + D12)

- [ ] Controller name/contact (+DPO if applicable)
- [ ] Named source of enrichment data (specific register/provider, not generic)
- [ ] Categories of personal data enriched (name, role, work email, etc.)
- [ ] Purpose(s) and legal basis (legitimate interest: LIA on file)
- [ ] Recipients/processors (enrichment vendor, hosting)
- [ ] International transfer mechanism named (DPF cert check date, or SCCs)
- [ ] Retention period / deletion trigger tied to `cascadeDeleteProject`
- [ ] Rights notice incl. right to object to legitimate-interest processing
- [ ] Right to complain to supervisory authority, with contact/link
- [ ] Notice delivered at/near first display of enriched data (not just in a
      general ToS/Privacy Policy page)
- [ ] Free-mail domains excluded from auto-fetch (D12)
- [ ] Disclosure + skip option shown before using fetched website content (D12)
- [ ] DPA signed with enrichment provider before production launch
