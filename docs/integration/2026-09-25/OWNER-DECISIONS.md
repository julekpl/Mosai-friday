# MOSAI owner decisions D1 to D14 (25 Sep 2026)

For: the owner. Written in plain language. Budget rule applied throughout: this is
an MVP on a low budget, so every decision shows the cheapest workable option first,
avoids seat subscriptions and paid vendors where a free path exists, and defers
anything not needed to prove MVP value. "MVP scale" below means about 100 signups
and about 1,000 photos a month.

Source of the decision list: `docs/integration/2026-09-25/BLUEPRINT-IMPLEMENTATION-PLAN.md` section 6.
Repo facts were checked on `main` at `a5b4255`.

> Not legal advice. The privacy and consumer-law notes (D5, D12, D13, photos of
> people) are planning guidance from public sources. Have a lawyer or privacy
> adviser sign off before any paid enrichment provider is switched on.

## Decide now (one screen)

| # | Decision | Recommended option | Monthly cost at MVP scale | What it unblocks | Urgency |
|---|---|---|---|---|---|
| D1 | AI budget per starter kit | Keep the $0.40 ceiling; keep the cheap default model (gpt-4o-mini) | About $1 to $2 real spend (100 kits x about $0.01) | Nothing blocked; confirms launch setting | Now (1 minute) |
| D2 | Merge the PR train | Done: merged (`a5b4255`) | $0 | Wave 0 | Closed |
| D3 | Company lookup provider | No paid provider. Use what already ships: the owner's own website scan and the Google listing they pick | $0 (see D3 on the listing search quota) | OD-1, OD-2 | Now |
| D4 | Photo processing | No provider. Browser crop plus a small free server test (sharp in Convex) | $0 | MD-0 to MD-3 now; MD-2b after the test | Before Wave 2 (media) |
| D5 | Privacy notice for enrichment | Not needed while D3 is "no provider"; add a one-line source label on the Google listing card now | $0 now; lawyer review only if a provider is ever enabled | OD-3 (kept switched off) | Later (only if D3 changes) |
| D6 | Big Five personality priors and World Values Survey | Cut | $0 | Nothing | Closed |
| D7 | Convex Workflow component | Do not adopt; keep the existing job tables | $0 | CT-2 | Before Wave 1 ends |
| D8 | Home page: one ranked list, at most 3 items | Approve | $0 | HM-2 | Now |
| D9 | Who pays after an agency hands a client over | Defer; agency keeps paying until a real agency asks | $0 | U9 slice 2 (stays parked) | Later |
| D10 | Does a merge to `main` go live automatically? | Owner answers yes/no; if no, keep manual deploys with a short checklist | $0 | Safe first production write of `primaryGoal` | Now (you are the only one who knows) |
| D11 | Enrichment spending cap | $0 (feature switched off) | $0 | OD-3 stays off | Now |
| D12 | Look up the website at a signup email's domain | Only after sign-in, shown openly with Skip; never for gmail/outlook-type addresses | $0 | OD-1 | Now |
| D13 | Prefill shop currency from the detected market | Prefill empty fields only, labelled "Suggested" | $0 | MK-2 | Before the market lane (MK) |
| D14 | How far to build the agent spine | Stop after AG-4a; build more only when a Home or Create feature needs it | $0 | AG-4b/c (stays parked) | Wave 3 review |

Total new monthly spend if you accept every recommendation: about $1 to $2 of AI
usage, plus $0 for vendors. The only open cost risk is the Google listing search
quota (see D3).

---

## D1. AI budget per starter kit ($0.40)

Context: each new project runs a "starter kit" (plan, website, 7 post drafts) with
3 AI calls. A hard ceiling of $0.40 stops a kit from spending more
(`STARTER_KIT_BUDGET_MICROUSD = 400_000`, `src/shared/starterKitJob.ts:21`).

- Option A (cheapest, recommended): keep $0.40 as a safety ceiling and keep the
  default model at gpt-4o-mini. Pro: real cost is about $0.006 to $0.015 per kit,
  so about $1 to $2 a month at 100 signups; the ceiling never bites. Con: none
  at MVP scale. Risk: if someone switches the admin default to a premium model,
  cost per kit can rise 10 to 20 times; the $0.40 ceiling still caps it at $40 a
  month for 100 kits.
- Option B: lower the ceiling to $0.10. Pro: a tighter worst case ($10 a month).
  Con: no real saving with the cheap model; kits could fail if a pricier model is
  chosen. Risk: a failed first kit is a bad first impression.
- Option C: raise to $0.75 to $1.00 for better copy from a premium model. Con:
  spends money before MVP value is proven. Not recommended now.

Recommendation: A. The real cost lever is which model is the default in admin,
not the ceiling. Please check that production's admin "AI models" page has
gpt-4o-mini (or similar) as default.
What must be true first: nothing. Retries re-spend budget, so watch for repeated retries.
Sources: `src/convex/lib/aiModelCatalog.ts:10` (fallback model `openai/gpt-4o-mini`),
`src/convex/aiModels.ts:72` (admin default wins), `src/convex/lib/aiBudget.ts:64`
($0.15 in / $0.60 out per million tokens, recorded 24 Sep 2026);
[OpenRouter gpt-4o-mini](https://openrouter.ai/openai/gpt-4o-mini) (confirmed via search, page blocked from here).

## D2. Merge the PR train before U12

Done. The starter-kit stack was merged as `a5b4255` ("Merge starter-kit stack
#11, #12, #14-#18, #20, #21"). No further action.

## D3. Company lookup ("discovery") and which provider

Context: at signup MOSAI can prefill the business profile. Today it already scans
the owner's website and lets them pick their Google listing. The question is
whether to pay a data vendor for more.

- Option A (cheapest, recommended): no paid provider. Reuse the website scan and
  the listing picker (OD-1/OD-2). Cost: $0 for the scan. Pro: no contract, no
  privacy paperwork, fits "truth". Con: thin results for businesses without a
  website. Risk: see the listing quota note below.
- Option B: add CompanyEnrich later, switched off by default. Cost: 500 free trial
  credits, then from $49 a month; unused credits roll over. Pro: cheapest paid
  vendor per lookup. Con: no public data processing agreement found; it also
  sells people data, which MOSAI does not want. Risk: privacy review needed (D5).
- Option C: People Data Labs. Cost: Pro $98 a month includes 1,000 company
  lookups (about $0.10 each). Con: a monthly subscription for a feature not
  proven. Risk: same privacy review.
- Not suitable: Apollo and HubSpot/Clearbit (seat subscriptions), Crustdata (no
  public prices).

Listing quota note (new finding): the shipped Google listing search does not use
Google's official Places API; it uses SerpApi's Google Maps search
(`src/convex/lib/googleMaps.ts`, `src/convex/scraping.ts:388`). SerpApi's free plan
is reported as 250 searches a month (one source says 100). One signup may use 2 to
3 searches, so 100 signups sits right at the free limit. Google is also suing
SerpApi (filed Dec 2025; amended complaint 10 Aug 2026), so the service could
change. Fallback: Google's official Places API gives about 1,000 free "Place
Details with phone and website" calls a month, then about $20 per 1,000. Its terms
let you store only the place ID long term; other listing fields should be
re-fetched, not kept.

Recommendation: A now. Build OD-3 switched off; decide on a vendor only after the
OD-4 accuracy test shows a real gap. Keep an eye on SerpApi usage in its dashboard.
What must be true first: nothing for A. For B or C: D5 and D11 answered.
Sources: [CompanyEnrich overview](https://www.salesforge.ai/directory/sales-tools/companyenrich),
[PDL pricing summary](https://www.cleanlist.ai/blog/2026-09-01-people-data-labs-pricing-guide),
[Google Places pricing summary](https://www.woosmap.com/blog/google-places-api-pricing),
[Places caching rules](https://openplacesapi.com/blog/can-you-store-places-api-results),
[SerpApi free plan](https://costbench.com/software/web-scraping/serpapi/free-plan/),
[Google v. SerpApi](https://searchengineland.com/google-loses-key-dmca-claims-against-serpapi-in-scraping-lawsuit-483185).

## D4. Photo processing (resize, crop, formats)

Context: owners upload photos that need versions for posts and pages. About 1,000
photos a month with 6 versions each means about 6,000 image operations.

- Option A (cheapest, recommended): crop in the browser before upload, and make
  the resized versions on the server with the free "sharp" library inside Convex.
  Cost: $0 extra. Pro: photos never leave MOSAI's own storage; no vendor. Con:
  no automatic "smart" crop; owner sets the focus point. Risk: sharp is unproven
  in this repo; a short test (MD-S) confirms it. Convex allows it (Node actions:
  512 MB memory, 10 minute limit, 5 MB argument limit, sharp listed via
  `node.externalPackages`).
- Option B: Cloudflare Images. Cost: 5,000 unique transforms a month free; after
  that $0.50 per 1,000 (about $0.50 a month at MVP scale on the paid plan). On
  the free plan, extra new transforms simply fail (no bill). Con: needs a
  Cloudflare account; EU-only processing is an Enterprise feature.
- Option C: Cloudinary. Cost: free tier likely covers MVP; paid Plus is $89 a
  month yearly or $99 monthly; Advanced $224 or $249. Pro: best automatic crop.
  Con: free and mid plans do not bill extra use, they disable the account when
  credits run out. Risk: lock-in to its URL format.

Recommendation: A. Revisit only if customers ask for automatic smart crop or
volume passes about 50,000 photos a month (then compare Cloudflare and Cloudinary).
What must be true first: the MD-S test passes on a real Convex deployment.
Sources: Convex actions docs via Context7 ([actions](https://docs.convex.dev/functions/actions),
[bundling](https://docs.convex.dev/functions/bundling)),
[Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing),
[Cloudinary plans](https://cloudinary.com/pricing/compare-plans).

## D5. Privacy notice (GDPR Article 14) for enrichment

Context: if MOSAI gets facts about a business from someone other than the owner,
the people behind that data (for example a sole trader) must be told where it came
from. A sole trader's business details usually count as personal data.

- Option A (cheapest, recommended): no paid enrichment, so no Article 14 project.
  Add one line on the Google listing card: "Found on Google Maps", and one
  paragraph in the privacy policy naming the listing search and website scan as
  sources. Cost: $0. Risk: low.
- Option B: enable a provider with a proper notice shown at the moment the
  enriched data appears, a written "legitimate interest" assessment, a signed
  processing agreement, a deletion rule, and a way for non-customers to object.
  Cost: lawyer time (unknown) plus vendor fees. Risk: medium if any item is skipped.
- Option C: rely on "disproportionate effort" and a public notice only. Risk:
  high; regulators (Poland, France) read this exception narrowly.

Recommendation: A now; B only if D3 ever changes. If a US vendor is used, keep
standard contract clauses as a backup to the EU-US Data Privacy Framework: it is
still valid, but the Latombe appeal (Case C-703/25 P, filed 31 Oct 2025) is pending
at the EU Court of Justice with no hearing date announced as of May 2026.
Sources: [Article 14 text](https://gdpr-info.eu/art-14-gdpr/),
[ICO on sole traders](https://ico.org.uk/for-organisations/advice-for-small-organisations/news-blogs-and-events/news/new-data-protection-self-assessment-checklist-for-sole-traders/),
[IAPP on the Polish ruling](https://iapp.org/news/a/polish-court-overturns-dpas-first-gdpr-fine),
[IAPP on Latombe](https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework),
[appeal accepted](https://privacy-daily.com/article/2025/11/07/eu-high-court-accepts-latombes-appeal-on-euus-data-transfer-scheme-2511070020).

## D6. Big Five personality priors and World Values Survey data

Already decided: cut both for the MVP. $0. Revisit only with a licensed data
source and a clear feature that uses it.

## D7. Convex Workflow component

Context: long jobs (starter kit, deletions) already run on MOSAI's own job tables
with retry and resume. Convex offers a free add-on library for the same job.

- Option A (cheapest, recommended): keep the job tables. Cost: $0. Pro: already
  built and tested; no new framework (AGENTS.md needs an ADR for one). Con: new
  long jobs hand-write their retry logic.
- Option B: pilot the library on one new multi-step job. Cost: $0 licence, some
  learning time. Con: still pre-1.0 (0.4.8, released 15 Sep 2026; 0.4.7 four days
  earlier), so updates may break things. Risk: two job styles in one codebase.
- Option C: migrate everything. Not worth it for an MVP.

Recommendation: A; note it in CT-2. Revisit when a job needs pausing for days or
many parallel steps.
Sources: npm registry for `@convex-dev/workflow` (read directly, 25 Sep 2026);
[Convex Workflow component](https://www.convex.dev/components/workflow).

## D8. Home page shows one ranked list (at most 3 items)

Already recommended: approve. $0. It changes what owners see first, which is why
it needs your yes. Unblocks HM-2.

## D9. Who pays after an agency hands a client over

Context: agencies can link to client organisations today (`agencyClientLinks`,
`src/convex/organizations.ts:492-558`), but there is no way to transfer a
project's ownership or billing. Nothing in the code does a transfer.

- Option A (cheapest, recommended): defer. The agency keeps paying; hand-over is
  done by support by hand if it ever comes up. Cost: $0. Con: agencies that want
  a clean hand-over must ask. Risk: low while agencies are few.
- Option B: "client pays, agency keeps control" (like Webflow client payments).
  Cost: build time plus normal Stripe fees. Con: payment code must be receipt
  based and idempotent. Risk: medium.
- Option C: full transfer where the client adds their own card (like Wix).
  Cost: the most build time. Risk: the client must accept, or service stops.

Recommendation: A for MVP. If you later build B, design it so C can follow; avoid
GoHighLevel's trap where a billing mode blocks transfers.
Sources: [Webflow client payments](https://help.webflow.com/hc/en-us/articles/35335039878035-Client-payments),
[Wix hand-over](https://www.wix.com/studio/academy/tutorials/how-to-handover-your-site-to-clients).

## D10. Does a merge to `main` go live automatically?

Context: the only workflow file is `.github/workflows/ci.yml`. It checks code on
every push and pull request but has no deploy step. The codegen check skips
itself because the `CONVEX_DEPLOY_KEY` secret has not been added (TODO at
`ci.yml:77`). A hosting platform outside the repo could still deploy on merge.

- Option A (cheapest, recommended if nothing deploys today): stay manual with a
  one-page checklist (who runs `convex deploy`, from which commit). Cost: $0.
  Risk: someone forgets a step.
- Option B: automatic deploy to a preview on every pull request, and to
  production only after a person clicks approve. Cost: $0 on GitHub; needs the
  deploy key stored as a secret. Risk: low.
- Option C: automatic production deploy on every merge. Risk: a merge goes live
  with no human check. Not recommended before launch.

Recommendation: tell us whether your host (for example Vercel or Convex
dashboard settings) deploys on merge. If not, A now and B once the deploy key is added.

## D11. Enrichment spending cap

Recommendation: $0 while enrichment is switched off (follows D3 and D5). If a
vendor is ever enabled, start with the vendor's free credits and a hard monthly
cap per organisation (for example 5 lookups), stopping the feature with a clear
"unavailable" message when the cap is hit, never fake data. The researcher's
earlier $400 a month figure was for 10,000 signups and does not fit the MVP.

## D12. Looking up the website at a signup email's domain

Context: someone signing up as ana@northstar.coffee probably owns
northstar.coffee, but may be an employee or a contractor.

- Option A (cheapest, recommended): after sign-in only, show "Looking up
  northstar.coffee" with Skip and "Different business" one tap away. Never look
  up free-mail domains (gmail, outlook and similar). Cost: $0. Risk: low.
- Option B: ask first with an opt-in button. Safer, slightly slower. Cost: $0.
- Option C: fetch silently before sign-in. Risk: surprises people, and can pull
  a stranger's site. Not recommended.

Recommendation: A. Do not store staff names or photos found on that site.

## D13. Prefill the shop currency from the detected market

Recommendation: prefill only an empty currency field, label it "Suggested", and
never change a currency the owner already set. $0. This is a back-office default,
not a price shown to shoppers, so EU price display rules (Price Indication and
Omnibus directives) should not apply; shop prices shown to buyers still need the
configured currency and taxes. Low risk (no regulator statement found on this
exact point).

## D14. How far to build the agent spine after AG-4a

Recommendation: stop after AG-4a. Build AG-4b/c only when a Home or Create
feature actually uses capability runs. Review at the end of Wave 3. $0.

## Also flagged: photos with people in them

Recommendation: a short reminder when owners take or upload photos ("Make sure
people in your photos agree to be used in marketing"). No face recognition; any
future face detection must only locate faces, never identify them. $0.

---

## Corrections made to the researchers' notes

1. Workflow component version: 0.4.8 (15 Sep 2026), not 0.4.6.
2. Google Places does not have a "$275 a month base tier". It is pay per call:
   Place Details with phone/website is the Enterprise tier, about 1,000 free
   calls a month, then about $20 per 1,000.
3. MOSAI's shipped Google listing uses SerpApi, not the official Places API
   (`src/convex/lib/googleMaps.ts`). Free quota and the Google lawsuit added.
4. Convex Node action limits are confirmed from Convex docs (512 MB, 10 minutes),
   not unverified; added the 5 MB argument limit for Node actions.
5. Cloudinary: Plus $89 yearly or $99 monthly; Advanced $224 or $249; free and
   mid plans disable the account rather than bill extra.
6. Cloudflare free plan: new transforms past 5,000 fail with an error, no bill;
   "unique" means one image plus one set of options per month.
7. People Data Labs: "$0.01 to $0.05 per record" is not supported; Pro is $98 a
   month for 1,000 company lookups; per-credit prices are not published.
8. CompanyEnrich: only "from $49 a month" and the $549 / 500,000-credit Scale plan
   are confirmed; the "Starter 5,000 credits" figure is not. It also sells
   people data. No public DPA found.
9. EU-US framework: the pending case is the Latombe appeal C-703/25 P (filed
   31 Oct 2025). A filed noyb "Schrems III" case is not confirmed.
10. D11: the $400 a month cap was for 10,000 signups; replaced with $0 for MVP.
11. D12: the enrichment note suggested looking up domains automatically at
    signup; changed to after sign-in, shown openly, with Skip (matches the plan
    and the legal note).
12. D5: added a $0 step now (source label on the Google listing card), because
    listing data is already third-party-sourced.

## Facts still unverified

- SerpApi free quota (250 or 100 searches a month) and its paid plan prices.
- Exact Google Places prices per tier (official pages blocked from here; figures
  are from secondary sources).
- Whether CompanyEnrich offers a DPA or EU data storage; its Starter credit count.
- People Data Labs free tier (100 lookups a month) as of today.
- Cloudinary EU data residency by plan; Cloudflare Images paid-plan prerequisites.
- Which model is set as default in production's admin "AI models" page.
- Whether an external host deploys `main` automatically (D10).
- Whether sharp installs and runs within Convex's limits here (the MD-S test).
- Legal conclusions in D5, D12, D13 (no regulator statement found on the exact points).
