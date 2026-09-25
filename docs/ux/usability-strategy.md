# MOSAI usability strategy

**Date:** 25 Sep 2026 · **Status:** proposal, awaiting owner decisions (§6) ·
**Baseline:** `32263ad` (main) · **Companion docs:**
[`first-run-blueprint.md`](first-run-blueprint.md) (the detailed design),
[`usability-backlog.md`](usability-backlog.md) (tickets).

## 0. What this is based on, and what it is not

| Input | Status |
|---|---|
| Code walk-through of four journeys (first run, "more customers this week", returning user, Promote end to end) | Done. Every finding below cites `file:line`, and the key claims were re-checked by hand. |
| UI audit (navigation, density, visual language, states, mobile, copy) | Done, code only; the app was not run. |
| Desk research on small-business marketing and competitor onboarding | Done. Sources in §7, with confidence stated. |
| **Interviews and product analytics** | **Not used.** The owner has them; they were not in the repository. Every "user" claim below is a hypothesis until checked against them (§6, Q1). |
| Moderated usability tests | Not done. None of this replaces watching five real owners try the product. |

`docs/reviews/build-ux-review.md` (24 Sep 2026) already covers the Build module. This
document does not repeat it; it depends on its P0 items.

## 1. The standard

> Using MOSAI is as simple as making a PB&J sandwich; the result is worth far more
> than the effort.

In practice, for an owner who gives marketing about an hour a day or less:

1. **Three questions, then a result.** The first session ends with something the
   owner can show another person: a real website address, posts they can use
   today, and a plan they can read in one minute.
2. **One next step, always.** Every screen answers "what do I do now?" with one
   primary button.
3. **Outcome first, method later.** Personas, journeys and content gaps are how
   MOSAI thinks. The owner meets them as editable results ("we think your
   customers are…"), never as homework before the first result.
4. **Their words, not ours.** No "persona", "journey", "GMB", "robots.txt",
   "provider", "origin" or "workspace" in the default path.
5. **Truth stays.** The truth rule (AGENTS.md §5.5) is a feature for this
   audience, not friction. "Draft", "ready to post" and "live at this address"
   are different words for different states, and each state stays honest.

## 2. What is wrong today (verified)

Ranked by time lost × share of owners affected.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **The free plan cannot produce any result an owner values.** `free` unlocks only Understand, Journeys and Create; Build and Promote start at `starter`. A new owner can write personas and content drafts, but cannot get a website or a post without paying. | `src/convex/lib/capabilities.ts:201-202` | Critical, needs an owner decision (§6, Q2) |
| F2 | **The app teaches marketing method before delivering an outcome.** The single "next best step" can only point at Understand → Journeys → Create, in that order, starting with "Write your first audience profile". It never suggests a website, a post or a campaign. | `src/components/app/next-action-model.ts:63-101`, `NextAction.tsx:19-38` | Critical |
| F3 | **Onboarding asks for a lot.** 3 steps with about 12 optional fields after the name (business details, audience, problems, service area, goals, challenges). They are optional but look required. Durable asks 3 questions (vendor claim). | `NewProjectWizard.tsx:56-60, 873-1005` | High |
| F4 | **The first result is a wait, not a result.** After the wizard, the business summary is drafted in the background; the owner lands on "MOSAI is getting to know your business". | `NewProjectWizard.tsx:523-528`, `Overview.tsx:942-968` | High |
| F5 | **Home shows 10+ equal choices.** 2 header buttons, 8 same-weight module cards and a next-step card. | `Overview.tsx:246-252, 434-488` | High |
| F6 | **Navigation labels need a marketing degree.** "Understand", "Journeys" and "Grow" do not say what they do; descriptions are hidden on desktop. | `ModuleNav.tsx:39-48` | High, owner decision (§6, Q5) |
| F7 | **The whole UI is monospace in a "terminal" theme.** `--font-sans` is IBM Plex Mono; tokens are `terminal-*`, `bg-scanlines`. This reads as a developer tool to a hairdresser. Hypothesis to test, not a verdict: the choice is deliberate (commit `c00e2ed`). | `src/index.css:281-284, 45-56, 525-531` | Medium, brand decision (§6, Q6) |
| F8 | **Returning owners get no "since you were away".** `/app` jumped to whichever project the list returned first. | `AppIndex.tsx:117-119` (fixed, §5) | Medium |
| F9 | **Dead end in Promote.** An unconfigured social provider showed "setup needed" and "An administrator must configure the provider and trusted app return origin". For a solo owner, there is no administrator, and the setup is MOSAI's job, not theirs. | `Promote.tsx:127-136` (fixed, §5) | Medium |
| F10 | **The website form the owner wants is forbidden by an accepted decision.** Public sites under `/s/*` send `form-action 'none'` and must not include any form handler. | `docs/decisions/2026-09-24-hosting-public-sites.md` conditions 2 and 4 | High, owner decision (§6, Q4) |
| F11 | **Stock images are designed but not built, and the quota is shared.** Pexels appears only in `docs/implementation/CREATE-VIDEO-BLUEPRINT.md`: 200 requests/hour and 20,000/month for the whole app. | blueprint D6, V4 | Medium, capacity risk |

Things that are already right and must be kept: honest draft/publish wording in
Promote (`Promote.tsx:198-200, 467-470`), empty states that name the next step
(`module-kit.tsx:477-522`), a real mobile navigation pattern
(`AppShell.tsx:252-411`), and the accessibility work from T1.8.

## 3. Who we design for

The owner named four groups: solo local services, small shops, agencies and
hospitality. Designing one first run for all four at equal weight produces a
first run that fits none of them. The resolution:

- **One flow, one question that branches it.** The first question is "What kind of
  business?", with four plain choices. The answer changes defaults (the website's
  main button, post topics, plan focus), not the number of steps.

  | Choice | Website main button | First posts about | Plan focus |
  |---|---|---|---|
  | Services by appointment (hair, physio, trades, coaching) | "Book" / "Call" | Before/after, tips, availability | Get booked |
  | Shop (products) | "Shop" / "See products" | Products, offers | Get sales |
  | Café, restaurant, salon (walk-in) | "Find us" / "See menu" | Today, the place, the people | Get visits and reviews |
  | I run marketing for clients | Chosen per client project | As per the client's type | Speed across many projects |

- **Agencies are a second journey, not a variant.** Their pain is running many
  projects and handing work to clients (organizations and client links exist since
  T2.1). The first run serves them as "set up your first client in three
  questions"; everything after that is a separate backlog item (U9).
- **Primary for testing:** solo local services. They have the least time, the
  least skill and the clearest outcome (bookings and calls). If the flow works for
  a plumber on a phone, it works for the others. This is a recommendation, and
  the owner's interview data should confirm or overturn it (§6, Q1).

## 4. The strategy in one picture

```
Today:      Sign in → 3-step form (~12 fields) → Home (10+ choices)
            → "Write your first audience profile" → … → (paid) website

Proposed:   Sign in → 3 questions → Starter kit, built live on one screen:
               1. Your plan on one page (what to do this week)
               2. Your website, branded, with a real address when published
               3. Your first week of posts, with pictures, ready to copy or schedule
            → Home = "This week" (one next step) + what changed since last visit
            → Personas, journeys, content gaps: visible as "why we suggested this",
              editable any time, never a prerequisite
```

The detailed screens, states, copy, data and truth rules are in
[`first-run-blueprint.md`](first-run-blueprint.md).

## 5. Quick wins shipped in this change

Small, reversible, no schema change, no new provider. Each is plain-language copy
or a one-line behaviour fix.

| Fix | Files | Proof |
|---|---|---|
| `/app` reopens the project the owner last used, instead of whichever came first in the list; it falls back safely when storage is blocked or the project is gone | `src/lib/last-project.ts`, `AppIndex.tsx`, `AppShell.tsx` | `tests/unit/last-project.test.ts` (4 cases) |
| Unconfigured social platforms say "not available yet" and "There is nothing for you to set up. You can still write and save drafts here." instead of asking an administrator to configure a return origin; the operator-level `setupDetail` no longer shows as a tooltip | `Promote.tsx` | Copy change; typecheck |
| Promote header buttons wrap on phones | `Promote.tsx` | Class change |
| Wizard: "GMB" → "Google", "Build my business map" → "Find my business details", step "Your business map" → "What we found" | `NewProjectWizard.tsx` | Copy change |
| Home module cards describe outcomes in plain words ("How people go from hearing about you to buying") instead of method ("stages, lanes and the experience curve") | `Overview.tsx` | Copy change |

Not done as quick wins, on purpose: renaming modules (changes the landing pages
and marketing site too, §6 Q5), reordering the next step (it is the core of the
blueprint and needs the plan decision), and the visual theme (brand decision).

## 6. Questions for the owner

Each has a recommendation. Work that does not depend on the answer can start now
(see the backlog).

1. **Share the interviews and analytics.** Which of the findings F2–F7 do they
   confirm or contradict? Specifically: how many new sign-ups finish the wizard,
   how many ever open Build or Promote, and what owners said they wanted in week
   one. *Recommendation:* put a redacted summary in `docs/ux/research/` so every
   later ticket can cite it.
2. **What does a free owner get?** (money decision, AGENTS.md §7) Options:
   (a) the full starter kit is free to generate and preview; publishing the site
   and scheduling posts need `starter`; (b) a 14-day `starter` trial with no card;
   (c) keep today's gate. *Recommendation:* (a). It shows the value before asking
   for money, keeps AI cost bounded (one kit per project, existing AI budget), and
   never implies something is live that is not. Costs of AI generation per kit
   should be measured in `aiRuns` before launch.
3. **Is the public site address good enough as the first win?** Today it is
   `appmosai.com/s/<slug>-website` (option B). *Recommendation:* yes for the MVP,
   show it plainly, and offer a custom domain later.
4. **Contact form on the website.** The accepted hosting decision forbids forms
   on `/s/*`. Options: (a) until option A, the site's main button is "Call",
   "Email" or "Book" (`tel:`/`mailto:` or an external booking link the owner
   pastes), which needs no form; (b) bring option A (separate domain) forward so
   a form can post to a MOSAI endpoint that writes into Customers with consent;
   (c) amend the decision to allow one POST target. *Recommendation:* (a) now,
   (b) next. Option (c) weakens a security decision to save a few weeks.
5. **Module names.** Proposed: Understand → "Your customers", Journeys → merged
   into "Your customers" as a tab, Create → "Content", Build → "Website & app",
   Customers → "Contacts", Promote → "Posts & ads", Sell → "Products",
   Grow → "Results". *Recommendation:* rename in the app, the module landing pages
   and the marketing site in one change, after five owners pass a naming test
   (card sort or first-click test).
6. **Visual language.** Keep the terminal identity for the marketing site and
   the admin panel, and switch the app's body text to a proportional sans for
   readability? *Recommendation:* test it. Put both versions of Home in front of
   five owners; choose by task success and stated trust, not taste.
7. **Images.** Pexels only, with the shared 200/hour quota, is enough for a few
   dozen new sign-ups an hour if results are cached (as the video blueprint
   specifies). *Recommendation:* reuse the V4 stock adapter and cache for the
   starter kit, and prefer the owner's own photos from the scanned website or
   Google listing first.
8. **Languages and countries at launch.** Copy tone and plain-language rewrites
   depend on it (already an open item in the implementation blueprint §9).

## 7. Research notes (desk research, 25 Sep 2026)

Facts, with confidence. Interpretation is in §1 and §4.

- **Confidence is falling while effort rises.** 18% of small businesses feel
  confident in their marketing results, down from 27% in 2024. Constant Contact
  with Ascend2, 2,500 decision-makers in AU, CA, UK and US, June 2025, published
  3 Sep 2025. Vendor survey.
  [PR Newswire](https://www.prnewswire.com/news-releases/the-state-of-small-business-marketing-effort-is-up-while-confidence-has-declined-302544971.html)
  · Verified against the release.
- **The most time-consuming tasks** are posting on social media, planning and
  working out what works (reported as 51%, 40%, 35%). Same study, per secondary
  summaries only; the percentages were **not** confirmed in the release.
- **Time budget:** about 58% of owners spend five hours a week or less on
  marketing. Compilation by Postcardmania (2026); the primary survey was not
  identified. **Low confidence.**
- **Competitor first runs (vendor claims, not tested):** Durable asks three
  questions (type, name, location) and generates a site in about 30 seconds
  ([durable.com](https://durable.com/ai-website-builder)); GoDaddy Airo asks one
  question per screen and reports sites in minutes
  ([godaddy.com](https://www.godaddy.com/resources/skills/godaddy-airo-site-designer-for-wordpress));
  Wix retired its questionnaire-based ADI on 10 Nov 2024 in favour of a
  describe-your-business prompt
  ([wix.com](https://www.wix.com/blog/wix-artificial-design-intelligence)).
  HubSpot Starter's time to value is weeks, per consultant blogs. **Low
  confidence.**
- **Not found:** a dated primary study on why small businesses abandon marketing
  tools, and on all-in-one versus separate tools. Do not quote the circulating
  "43% of churn in the first 90 days" figure; no primary source was found.
- **Trust in AI copy:** consumer research suggests many buyers prefer brands that
  do not use generative AI in customer-facing messages (NIM, "Transparency
  without trust"; figure not verified at the source). Design consequence: the
  owner always reviews and can edit before anything is posted, and posts are
  written in the owner's voice from their own website text.
