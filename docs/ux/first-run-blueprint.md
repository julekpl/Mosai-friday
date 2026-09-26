# Blueprint: the first run ("starter kit")

> Superseded (26 Sep 2026): the question and screen caps here are replaced by the owner's six-screen first-run decision (`docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md` section 11).

**Date:** 25 Sep 2026 · **Status:** proposal; §9 lists the owner decisions it
depends on · **Strategy:** [`usability-strategy.md`](usability-strategy.md) ·
**Tickets:** [`usability-backlog.md`](usability-backlog.md)

## 1. Goal and measure

A new owner, on a phone, in under 10 minutes and with 3 answers, ends the first
session with:

1. **A plan on one page:** who their customers are, the three things to do this
   week, and why.
2. **A branded website:** their name, colours, photos and words, with one clear
   main button. It has a real public address once they press Publish (and their
   plan allows it).
3. **A first week of posts:** 5 to 7 posts with pictures, in their voice, ready
   to copy now, or to schedule once an account is connected.

**North-star measure:** share of new projects that reach "kit ready" in session
one, and of those, share that publish the site or use a post within 7 days.
**Guard measures:** time to kit ready (target: median under 3 minutes of waiting,
under 10 minutes total), AI cost per kit (from `aiRuns`), kits that fail or
partially fail.

These targets are proposals. Set the real baseline from the owner's analytics
first (strategy §6, Q1).

## 2. The flow

```
/auth (unchanged: email + code)
  │
  ▼
/app/new  — 3 questions, one per screen, each skippable except the name
  Q1  What kind of business?      [Services by appointment] [Shop]
                                  [Café / restaurant / salon] [I do marketing for clients]
  Q2  What is it called, and where can we read about it?
        Name (required) · Website or Google listing (optional, one field)
  Q3  What do you want most right now?
        [More bookings / calls] [More sales] [More people through the door]
        [Get known locally]
  │
  ▼   (one "Make my starter kit" button; nothing else on screen)
/app/:projectId  — Home in "kit" mode: three cards fill in as each part is ready
  ┌─ Your plan ────────┐ ┌─ Your website ─────┐ ┌─ Your posts ───────┐
  │ drafting… → ready  │ │ drafting… → ready  │ │ drafting… → ready  │
  │ [Read it (1 min)]  │ │ [Look at it]       │ │ [See 7 posts]      │
  └────────────────────┘ └────────────────────┘ └────────────────────┘
  "Something wrong? Fix the facts" → the existing business-details review
  │
  ▼   after the kit: Home becomes "This week" (§5)
```

What leaves the first run, compared with today's wizard
(`NewProjectWizard.tsx:56-60`):

| Today | Blueprint |
|---|---|
| Step "Your business": name + website + Google listing + competitors + robots.txt consent | Q2: name + one "website or Google listing" field. Competitors and robots.txt consent move to Edit project. |
| Step "Your business map": ~9 editable fields | Not shown before the kit. The facts appear on the plan card, and "Fix the facts" opens the same review later. |
| Step "Who you serve": audience, problems, service area, goals, challenges | Q1 + Q3 give type and goal. Audience, problems and area are **inferred** from the scan and shown as editable assumptions on the plan, labelled "our guess". |

Keep: the scan through `safeFetch`, the one-time consent wording for robots.txt
(in Edit project), focus management and the step-heading focus from T1.8.

## 3. Screens and copy

Tone: short, second person, no method words. Every screen has one primary button.

**Q1** — "What kind of business is it?" Four large tiles (the four types above), 44 px
minimum targets, keyboard selectable as a radio group. Helper: "This sets sensible
starting points. You can change anything later."

**Q2** — "What is it called?" + "Where can we read about it? (website or Google
listing, optional)". Helper under the second field: "We read public pages to
learn your services, photos and style. Nothing is posted anywhere."

**Q3** — "What do you want most right now?" Four tiles. Skipping picks the default
for the type (appointments → bookings; shop → sales; café → visits).

**Kit screen** — heading "Your starter kit". Each card has five states:

| State | Card shows | Truth rule |
|---|---|---|
| `queued` / `running` | "Drafting your website…" with a progress line naming the real step ("Reading your website", "Choosing photos", "Writing your homepage") | Steps are emitted by the server job; no fake timer |
| `succeeded` | Preview thumbnail + primary button | "Draft", never "live" |
| `partially_succeeded` | What worked + what did not ("3 of 7 posts have pictures; add your own for the rest") | Named gap, one button to fix |
| `failed` | "We could not draft your website. Your answers are saved." + "Try again" | Retry reuses the same kit and job id |
| `locked` | Preview visible; the action that needs a plan says so ("Publishing needs Starter") | Depends on strategy §6 Q2 |

**Website card, after the preview:** primary "Publish" → publishes through the
existing `siteHosting.deployWebsite` and shows the address only when
`siteHosting.status` reports `live`. Until then: "Draft · not on the web yet".

**Posts card:** each post has "Copy text", "Download picture" and "Schedule" (enabled
only when the platform is connected and configured; otherwise "Posting to
Instagram is not switched on yet", as already done in Promote).

**Plan card:** one screen, readable in a minute. "Your customers (our guess)",
"This week: 1. … 2. … 3. …", "Why": each point cites a fact from their site or
answers, or says "assumption". Button: "Looks right" (marks the profile
reviewed through the existing `projects.saveBusinessProfile`) or "Fix the facts".

## 4. How it works (architecture)

Built from what exists. No new provider except Pexels, which already has a
design in `docs/implementation/CREATE-VIDEO-BLUEPRINT.md` (V4).

```
wizard ──create──▶ projects.create (+ new fields: businessType, primaryGoal)
          │
          └─start─▶ starterKit.start({projectId})           orgMutation, idempotent per project
                       │ inserts starterKits row: status=queued, parts{plan,site,posts}
                       ▼
                    internal action runStarterKit          scheduled; ModelGateway only
                       1. scan (existing server scan)  → project facts
                       2. business profile draft       → existing draft path
                       3. plan  = profile + goal + type → stored as a content/plan draft
                       4. site  = buildChat.generateSite with type/goal/brand
                                  (depends on Build review P0: feed blueprint + theme)
                       5. posts = social copilot draftVariants x N, saved as `posts` drafts
                       6. images: owner's scanned photos first, then Pexels (cached)
                    each step patches parts[x].status and a human-readable step label
```

Rules this must follow (AGENTS.md):

- **Job** (rule 13): `starterKits` table with the standard states `queued,
  running, waiting_for_user, succeeded, partially_succeeded, failed, canceled`,
  per-part status, `idempotencyKey = projectId`, attempt count. One kit per
  project; "Try again" resumes failed parts only.
- **Registry** (rule 12): register `starterKits` (and any cache table) for
  authorization, export, retention and deletion; extend the data registry, not a
  hard-coded list.
- **Authorization** (rule 2): `start` and `get` are org-scoped; the action loads
  all context on the server (rule 3). No client "snapshot".
- **Capability** (T2.3): generation runs under the capability decided in §9 Q2.
  If the free plan may generate previews, add an explicit, audited exemption or
  a new `preview` verb; do not quietly open `build.edit` to `free`.
- **AI** (rule 11): every call through `ModelGateway` with agent id, budget and
  context sources; cap the kit's total budget and record it in `aiRuns`.
- **Truth** (rule 5): nothing in the kit is `published`, `scheduled` or `sent`.
  Publishing and scheduling are the existing, receipt-backed flows.
- **Scraped text is data** (rule 4): site text feeds generation as quoted source,
  never as instructions; generated HTML renders through the existing renderer and
  `sanitizeHtml`.
- **Images:** Pexels search by fixed host with the server key, results cached per
  query for 24 h, per-user limit, `rate_limited` state with reset time, and the
  "Photos provided by Pexels" link wherever results are shown (V4 terms). Owner
  photos from the scan are imported through `safeFetch`.

## 5. After the kit: Home as "This week"

Replace today's Home ordering (8 equal module cards first) with:

1. **Since you were away** (only if something changed): posts that went out (with
   receipts), new contacts, site status changes. Built from rows that already
   exist; no new provider calls.
2. **Your next step:** one card. The model (`next-action-model.ts`) moves from
   "method order" to "outcome order": publish site → use or schedule posts → add
   a way to be contacted → review results. Personas, journeys and content gaps
   become reasons shown under the step, and a place to go deeper.
3. **Your tools:** the module cards, smaller, below the fold.

The current tests in `tests/unit/overview-next-action.test.ts` encode the method
order and must be rewritten with the new order, not deleted.

## 6. Leads without a form (until the hosting decision changes)

Public sites cannot contain forms (`form-action 'none'`, hosting decision
condition 4). So the site's main button, chosen by type, is:

| Type | Main button | Implementation |
|---|---|---|
| Services by appointment | "Call" / "Book" | `tel:` link, or the owner's existing booking link (validated URL) |
| Shop | "See products" | Link to the Sell storefront once public; until then "Call" / "Email" |
| Café / restaurant / salon | "Find us" / "Call" | Map link built from the address, `tel:` |

When option A (separate domain) ships, the contact form posts to a MOSAI endpoint
that writes into Customers with a consent record. That is backlog item U8, not
the first run.

## 7. Accessibility and mobile

- Every question is one screen, works at 320 px, 44 px targets, and has a visible
  focus ring.
- The kit cards announce state changes through a polite live region ("Your
  website draft is ready").
- Progress lines are text, not only animation; honour reduced motion.
- Generated sites meet WCAG 2.2 AA contrast with the chosen brand colours; if a
  scanned colour fails, adjust the shade and say so in the plan's notes.

## 8. Test plan

- Unit (Vitest + convex-test): kit job state machine (each part fails alone;
  retry resumes only failed parts; idempotent start); authorization (foreign org
  gets nothing: add to the generated cross-tenant suite); registry includes
  `starterKits`; kit never writes `published`/`scheduled`/`sent`.
- Unit: the new next-action order.
- E2E (Playwright): three questions → kit screen shows three cards and their
  loading states (providers mocked at the contract boundary); keyboard-only run;
  axe on each question and on the kit screen.
- **Usability test (not optional):** five owners from the primary group, on their
  own phones, unaided. Pass when four of five reach "kit ready" and can say what
  they would do next. Record time and every hesitation.

## 9. Decisions this depends on

| # | Decision | Blocks | Can proceed without it |
|---|---|---|---|
| Q2 | What a free owner may generate and publish | Capability rule for the kit; the `locked` states | Job, UI, tests with a feature flag |
| Q4 | Contact form: links now, form after option A | U8 | Main-button links |
| Q7 | Pexels as the stock source for the kit, with caching | Posts pictures | Owner photos only |
| — | Build review P0 (blueprint and theme feed generation) | A site that looks like the business, not like MOSAI | Plan and posts parts |
