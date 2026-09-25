# Usability backlog (U-series)

**Date:** 25 Sep 2026 · **Source:** [`usability-strategy.md`](usability-strategy.md),
[`first-run-blueprint.md`](first-run-blueprint.md)

Follows `docs/tickets/README.md`: one ticket = one branch = one PR, and a full
ticket file is written when its chat starts, from the entry below. Status markers
are honest: `not started` · `in progress` · `blocked (reason)` · `done`.

Each ticket names its acceptance tests (AGENTS.md rule 17). None combines a schema
migration, provider OAuth and a visual redesign (AGENTS.md §8).

**Owner decisions recorded (25 Sep 2026):** strategy Q2 → a **14-day Starter trial**
(the kit needs Starter; no free-plan exemption; whether the trial needs a card is
still open); Q4 → call/email/booking/map links now, no form on `/s/*`; Q7 → Pexels
with the V4 design. **Status words:** "code done" means merge-ready with its tests
passing in CI except the pre-existing full-history secret scan; "merged" means on
`main`. Neither means proven with real owners (U12).

| ID | Ticket | Depends on | Size | Status |
|---|---|---|---|---|
| U0 | Quick wins: resume last project, honest "not available yet" in Promote, plain-language copy | — | S | **done**, merged (PR #11, `a5b4255`) |
| U1 | Research inputs: redacted interview + analytics summary in `docs/ux/research/`; baseline funnel numbers | owner | S | blocked (owner, strategy Q1) |
| U2 | Three-question wizard | — | M | **merged** (`a5b4255`, 25 Sep 2026), PR #14 · unit + e2e (3 screens, keyboard, axe at 320 px) pass; not yet used by real owners (U12) |
| U3 | Starter-kit job (`starterKits` table, state machine, registry) | U2 · strategy Q2 for gating | L | **merged** (`a5b4255`, 25 Sep 2026), PR #12 (table) + #15 (job) · 17 job tests incl. cross-tenant; per-kit AI budget (US$0.40) awaits owner confirmation |
| U4 | Kit screen on Home (three cards, five states, live region) | U3 | M | **merged** (`a5b4255`, 25 Sep 2026), PR #20 · 10 unit + 6 e2e (all five states, live region, draft vs live, 320 px, axe); the wizard now starts the kit |
| U5 | Posts with pictures (owner photos, then Pexels with cache) | U3 · Q7 | M | **merged** (`a5b4255`, 25 Sep 2026), PR #16 (adapter, `safeFetchBytes`) + #18 (U5b, wired into the kit) · needs `PEXELS_API_KEY` on the deployment |
| U6 | "This week" Home + outcome-ordered next step | U4 | M | **merged** (`a5b4255`, 25 Sep 2026), PR #17 · 22 unit tests; contact step is checklist-only until U6b; no browser test of the card with a live site yet |
| U7 | "Since you were away" | U6 | S | **merged** (`a5b4255`, 25 Sep 2026), PR #19 · 10 tests (receipt-backed only); no browser test of a returning visit yet |
| U8 | Website contact form into Customers | option A hosting · Q4 | L | blocked (hosting decision) |
| U9 | Agency path: many client projects, hand-off | U2 | M | **first slice merged** (`a5b4255`), PR #21 · client set-up in three questions and a one-click client list on `/app` (7 unit + 7 e2e); **hand-off to the client not started** (needs an owner decision on who pays after hand-off) |
| U10 | Module naming test and rename | Q5 | S | blocked (owner, naming test) |
| U11 | Readability test: proportional body font in the app | Q6 | S | blocked (owner) |
| U12 | Moderated usability test, 5 owners, after U4 | U4 | S | script ready ([`u12-usability-test-script.md`](u12-usability-test-script.md)); sessions not run (owner) |
| U5b | Pictures in the kit's posts and the `starterKit.content` query (U3 × U5 integration) | U3 · U5 | S | **merged** (`a5b4255`, 25 Sep 2026), PR #18 · 9 tests incl. per-user limit reuse |
| U6b | Contact details in Edit project (phone, email, booking link), restoring "add a way to be contacted" as a real next step and "Book" on the website | U6 | S | not started (found in U6 review) |
| U4b | Kit follow-ups from review: (1) put the kit above Overview's header in kit mode (at 320 px it sits below four "0" tiles, method words and "workspace"); (2) a "start your kit" entry on Home when a project has none; (3) a server mutation to mark the plan "Looks right" without inventing profile data | U4 | S | not started |

---

### U2 — Three-question wizard
**Outcome:** a new owner starts with 3 questions, not 3 steps and about 12 fields.
**Scope:** `NewProjectWizard.tsx` (extract per-question components first, then
change); add `businessType` and `primaryGoal` to `projects` (additive, optional).
Move competitors and robots.txt consent to Edit project.
**Acceptance:** only the name is required; each question is one screen at 320 px;
keyboard-only completion; axe clean; existing scan still goes through `safeFetch`;
unit test for the type → default-goal mapping; e2e for the three screens.

### U3 — Starter-kit job
**Outcome:** one idempotent server job produces plan, site and posts drafts.
**Scope:** `starterKits` table (standard job states, per-part status, step label,
idempotency key = project), `starterKit.start` / `starterKit.get` (org-scoped),
internal `runStarterKit` through `ModelGateway`, a budget cap, registry entries.
**Acceptance:** each part can fail alone and retry resumes only failed parts;
duplicate `start` returns the same kit; a foreign org gets nothing (added to the
generated cross-tenant suite); the registry test includes the table; no write of
`published` / `scheduled` / `sent`; `audit:functions` and `audit:capabilities`
exit 0.

### U4 — Kit screen
**Outcome:** the owner watches the kit fill in and gets one button per result.
**Scope:** new component under `src/components/app/`, rendered by Overview when
a kit exists and is not dismissed. Uses `StatusBadge`, tokens only.
**Acceptance:** all five states rendered from fixtures; polite live region
announces each part; reduced motion honoured; "Draft" wording until
`siteHosting.status` says `live`; e2e with mocked providers.

### U5 — Posts with pictures
**Outcome:** posts come with fitting pictures, the owner's own first.
**Scope:** reuse the V4 Pexels adapter design (fixed host, server key, 24 h cache,
per-user limit, `rate_limited`), attribution link wherever results show, import
by id via `safeFetch`.
**Acceptance:** no key → `needs_setup` and owner photos still used; cached repeat
search makes no provider call; 429 → `rate_limited` with reset time.

### U6 — "This week" Home and outcome-ordered next step
**Outcome:** Home shows one next step in outcome order (publish site → use posts
→ be contactable → check results); modules move below.
**Scope:** `next-action-model.ts`, `NextAction.tsx`, `Overview.tsx` ordering.
**Acceptance:** rewritten `overview-next-action.test.ts` covers each step,
locked states and the "nothing to do" state; no step says "complete" or
"verified" without a stored review.

### U7 — Since you were away
**Outcome:** a returning owner sees what changed in one glance.
**Scope:** per-user, per-project `lastSeenAt`; a summary built from existing rows
(posts with receipts, new contacts, site status).
**Acceptance:** nothing shown when nothing changed; only receipt-backed events
counted as "posted"; unit test on the summary function.

### U8 — Website contact form (blocked)
**Outcome:** visitors can leave their details on the owner's site; they land in
Customers with consent.
**Blocked by:** hosting option A (separate registrable domain) or a new decision
replacing condition 4 of `2026-09-24-hosting-public-sites.md`.

### U9 — Agency path
**Outcome:** someone running several clients sets up each in three questions and
switches fast.
**Scope:** Q1 "I do marketing for clients" creates the org/client link (T2.1);
a client list at `/app` when an agency has several projects.
**Acceptance:** agency with 3 clients reaches each in one click from `/app`;
role checks from T2.1 unchanged.

### U10 — Module naming (blocked)
**Outcome:** module names a non-marketer understands at first sight.
**Method:** first-click test with 5 owners on current vs proposed names
(strategy §6 Q5); rename app, module landing pages and marketing site together.

### U11 — Readability test (blocked)
**Outcome:** evidence on whether monospace body text costs owners time or trust.
**Method:** two versions of Home, 5 owners each, task time and a trust rating.

### U12 — Moderated usability test
**Outcome:** real evidence before the next round. Five owners from the primary
group, own phones, unaided, recorded with consent. Pass: 4 of 5 reach "kit ready"
and can name their next step.
