# U12: Five-owner usability test script (starter kit)

**Date:** 25 Sep 2026 · **Status:** ready to run once U2–U5b, U4 and U6 are merged
and deployed · **Ticket:** [`usability-backlog.md`](usability-backlog.md) U12 ·
**Design under test:** [`first-run-blueprint.md`](first-run-blueprint.md)

## 1. What we want to learn

1. Can an owner from the primary group get from sign-in to **"kit ready"** on their
   own phone, unaided, in under 10 minutes?
2. Afterwards, can they say **what they would do next**, in their own words?
3. Where do they hesitate, and what words do they misread?

**Pass (blueprint §8):** at least 4 of 5 owners reach "kit ready" and can name their
next step. Anything less means we fix the first run before building more on it.

## 2. Who

- **Five owners** of solo local service businesses (hair, physio, trades,
  coaching). This is the primary group in strategy §3. If the owner's interview
  data (strategy Q1) points to another group, swap the group, not the number.
- Each has a phone, a business website or Google listing, and has **never used
  MOSAI**.
- Exclude marketers, agency staff and anyone who has seen a MOSAI demo.

## 3. Before the sessions (owner or researcher)

| Item | Why |
|---|---|
| A test deployment with U2, U3, U4, U5, U5b and U6 merged | The first run must be real, not a prototype |
| `PEXELS_API_KEY` set on that deployment, **or** a note that stock photos are off | Otherwise posts show "0 of 7 have pictures"; decide which you are testing |
| Test accounts on a plan that includes Build and Promote (the 14-day Starter trial, per the owner's Q2 decision) | Otherwise the website and posts cards show "Needs the Starter plan", which is a different test |
| Written consent to record the screen and voice | Recording is required to count hesitations |
| A €/£/$ thank-you as agreed by the owner | Recruitment |
| This script printed, plus a timer | |

Do **not** publish the owners' sites during the test unless they ask to. Publishing
is real and public (`/s/<slug>-website`).

## 4. Session plan (30 minutes)

| Minutes | Step | Facilitator says (exactly) |
|---|---|---|
| 0–3 | Consent and set-up | "We are testing the app, not you. Please think out loud. I cannot help you during the task, but you can stop at any time." |
| 3–15 | **Task 1: first run** | "Imagine you just signed up for this to get more customers. Set it up for your business, on your own phone, and stop when you think you have something you could show a friend." |
| 15–20 | **Task 2: next step** | (on Home, after the kit is ready) "Without touching anything: what would you do next, and why?" |
| 20–25 | **Task 3: use a result** | "Pick one of the posts and get it ready to put on Instagram or Facebook." (Copying the text counts; scheduling needs a connected account.) |
| 25–30 | Debrief | "What was the most confusing moment? What would you tell a friend this does? Is there anything here you would not trust?" |

Do not explain any word on screen. If they ask "what does X mean?", answer: "What do
you think it means?" Then write down the word.

## 5. What to record, per owner

| Measure | How |
|---|---|
| Reached "kit ready" (all three cards out of `queued`/`running`) | yes / no, and the time from the first question |
| Time on each question (Q1, Q2, Q3) | from the recording |
| Waiting time on the kit screen | from pressing "Make my starter kit" until the last card settles; blueprint target: median under 3 minutes |
| Every hesitation over 3 seconds | screen, element, what they said |
| Every misread word | the word, and what they thought it meant |
| Could name the next step | their words; does it match the "This week" card? |
| Trust concerns | quote |
| AI cost of their kit | `starterKits.spentMicrousd` for their project (against the US$0.40 budget) |

## 6. What to look at first (lead's list, from the build)

These are the places the build review flagged as most likely to fail. Watch them
before anything else:

1. **Q2 "Where can we read about it?"** It is one field for a website *or* a Google
   listing. Do owners understand that a listing only counts if they pick it from
   the suggestions? A typed name that nobody picks is ignored.
2. **The wait.** Do the kit cards' real step labels ("Reading your website",
   "Writing your homepage") keep people calm? Or do they leave, or reload?
3. **"Draft · not on the web yet"** on the website card. Do owners believe the
   site is live anyway? This is the truth rule the product depends on.
4. **The website's look.** The published renderer uses a fixed colour palette, not
   the owner's brand colours (Build review P0-10 is only half done). Note any
   "this doesn't look like me" reaction; it tells us how urgent that work is.
5. **Posts with no or few pictures.** When the card says "5 of 7 posts have
   pictures; add your own for the rest", do owners know how to add one?
6. **The next step after the kit.** It goes website → posts → results. The
   contact step is only on the checklist (U6b is not built). Do owners ask how
   people will reach them?
7. **"Needs the Starter plan"**, if any card shows it. Does it read as a paywall
   before value?

## 7. After the five sessions

- Write the findings into `docs/ux/research/u12-results.md` (create the folder;
  redact names and business details) with the pass/fail line first.
- For each problem: how many of 5 hit it, severity (blocks the task / slows it /
  cosmetic), and one proposed change.
- Update the U12 row in `usability-backlog.md` to `done` only when the results file
  exists.
