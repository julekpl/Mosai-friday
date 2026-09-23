# BP-03 — Stop false publishing and readiness claims

**Package:** BP-03 (Order A, third package; blueprint §5 BP-03 / §10; backlog
T2.13). **Chat:** 3 · **Date:** 23 September 2026.
**Status:** `implemented_unverified` — code and all mocked acceptance tests
pass (10/10 BP-03 regressions, 324/324 unit); no external proof applies to
this package (everything it asserts is database-verifiable, see *Truth
boundaries*). **BP-01 and BP-04 remain `implemented_unverified` and the
overall release gate remains BLOCKED** (blocker **B3** — tracked `.env.keys`
+ historical credential; this package waives nothing and does not touch,
read, print, allow-list or weaken anything involving real credential
values).

**Working-tree/ref note (inspected at chat start):** git commands are blocked
(B2: "Git and GitHub commands are blocked; Vly manages version control.") and
the audited-symbol re-check ran with `rg` instead of blueprint line numbers.
CI for whatever commit Vly autosaves is **unknown and must never be
assumed**. BP-04's committed correction (GitHub main `8f62c83d…`, CI run
35842652198, unit/typecheck/lint/e2e/a11y/codegen green, both security jobs
failing only on the pre-existing secret-scan blocker) was the verified
starting point; its provider receipts, reconnect states, lease/version
refresh protocol and provider-error redaction are **preserved untouched**.

**Main-branch workflow exception (owner-approved for BP-03 only):** this
package was implemented on Freebuff/Vly's existing **main-branch autosave
workflow** — no manual commit, no push, no pull request, no deploy, no
production interaction, no real provider contact was performed by the agent;
Vly manages its normal autosave. **The usual one-ticket / one-branch /
one-PR process was NOT followed for BP-03**, and this report does not claim
otherwise. The exception does **not** carry to BP-02 and waives no security
or release gate.

---

## Outcome

A client can no longer manufacture external success or compliance, and the
product no longer claims "live"/"published" without a deployment receipt.
The four delivery phases (draft approval → release preparation → deployment
progress → externally verified delivery) are now separated in code, in the
schema and in the UI, with readiness derived from a server-written,
revision-pinned audit record.

**Red-first record.** The regression suite `tests/unit/publish-truth.test.ts`
(10 tests) was written against the unfixed tree; the tests covering
manufactured success, failed-preparation preservation and legacy truth
failed there (`builds.update` accepted client `status`/compliance inputs;
`publishSite` wrote external states; `getReadiness`/`getSiteDelivery`/
`campaigns.getDelivery` did not exist; `ReceiptBadge` was missing). The
record is in the test file header.

### What changed

1. **No client-writable external state or compliance booleans.**
   `builds.update` no longer accepts `status`-as-external-state,
   `seoReady` or `wcagReady` from the client — the fields are gone from the
   public validator, so a direct client call is refused and nothing is
   written (pinned by regression, including the "nothing was written"
   assertion). Only internal/server code may write those fields.
2. **`publishSite` prepares, never publishes.**
   `src/convex/buildWorkspace.ts` `publishSite` (a `moduleMutation("build")`
   with the `build.publish` capability) no longer writes
   `sites.status = "live"` or `builds.status = "published"`. It now:
   1. validates every page draft **before any mutation** — an invalid draft
      fails the whole preparation and the previously prepared release stays
      fully intact (Convex's atomic transaction makes this hold even on a
      mid-write failure);
   2. promotes drafts through the canonical revision path (approved
      revision inserted, page pointer flipped, prior revision immutable);
   3. writes the server-only `buildReleaseAudits` row pinned to the promoted
      revision ids, their versions and `READINESS_RULE_VERSION`;
   4. records `releaseState: "prepared"` + `lastReleaseAuditId` on the build
      — and nothing external.
   The site row keeps the local lifecycle value it was created with; no
   externally published status exists until BP-13's deployment adapter
   writes a receipt. A regression pins that after a successful preparation
   the site is **not** live/published and after a failed one the previously
   served release still answers `cms.getPublishedByPath`.
3. **Readiness derived from a revision-pinned audit.**
   `builds.getReadiness` (new module query) returns the honest delivery view:
   `release_prepared` while the current drafts equal the audited revisions'
   content, `content_changed` once a draft is edited in place, with
   `ruleVersion` and the audited revision ids surfaced. Verification is by
   `contentFingerprint` equality (`src/shared/contracts/status.ts`,
   key-order-insensitive) between the draft and the audited revisions, so an
   in-place content edit invalidates the claim immediately. A regression
   demonstrates verified-then-stale across a content edit.
4. **Site delivery view.**
   `buildWorkspace.getSiteDelivery` (new module query, `requireProject`
   ownership guard) reports the external truth: `deployment` is `null`
   because BP-13 does not exist and nothing may claim otherwise; the label is
   `release_prepared` after an accepted preparation, `deployment_missing`
   before one, `requires_verification` for a legacy pre-BP-03 `published`
   build — never a green claim without a receipt. A regression pins both the
   honest no-deployment view and the cross-tenant refusal.
5. **Campaigns: local vs provider-tracked.**
   `campaigns.create` stamps `trackingSource: "local"`; `campaigns.update`
   refuses client lifecycle/budget writes on provider-tracked rows (only
   server code holding a provider receipt may move them); `campaigns.getDelivery`
   (new) reports `trackingSource` and a `verified` delivery only when a
   server-recorded provider reference exists — no invented receipts.
   Regression covers refusal on provider rows, end-to-end local updates, and
   both delivery views.
6. **`src/shared/contracts/status.ts` (new).** Dependency-free, browser-safe
   vocabulary: the four delivery phases, honest non-delivery states
   (`content_changed`, `requires_verification`, `deployment_missing`,
   `unavailable`), legacy labels kept readable, the tone classifier
   (`receiptTone`: only `verified` is green), `READINESS_RULE_VERSION` and
   `contentFingerprint`. Shared by backend and UI so a pin can never
   disagree with itself.
7. **`src/components/app/ReceiptBadge.tsx` (new).** Renders a label from the
   status contract. `verified` without a stored receipt is **demoted** to
   `requires_verification` at render time (a green badge without a receipt
   is a lie). A `verified` badge is an anchor to the real stored receipt URL
   and is only rendered when one exists. Tones use the terminal design
   tokens; honest labels per state (`Release prepared — not yet live`,
   `Requires verification (legacy)`, …) are pinned by regression.
8. **`BuildWorkspace.tsx` fake verified badge removed.** The toolbar
   previously rendered `<ReceiptBadge state="verified" href="#" />` for a
   legacy `releaseState === "verified"` build — a false external claim with
   a dead link. It now renders the honest `requires_verification` badge
   ("no receipt on record") and a failed release shows
   `deployment_missing` ("last confirmed release intact").
9. **Legacy truth.** A pre-BP-03 `status: "published"` build is readable via
   `getReadiness` but labelled `requires_verification`, `legacy: true`,
   `verified: false`, no receipt — regression-pinned. Legacy
   `seoReady`/`wcagReady` values surface only as `legacyClaims` in the
   readiness view, never as compliance.

### Registration duties (AGENTS.md rule 12)

`buildReleaseAudits` and `buildDeployments` (the BP-13 placeholder table the
schema reserves for the receipt chain) are added to `cascadeDeleteProject`'s
`PROJECT_TABLES` in `src/convex/dal.ts` — extended, not hard-coded — and
deletion-completeness fixtures were added for both (the fixture test failed
first: one table missing from the fixture set, one table not cleared by
deletion).

### Preserved (BP-04 and prior)

Provider receipts, reconnect (`needs_reconnect`) states, the
claim(lease+version)→fetch→conditional-save/release refresh protocol, and
provider-error redaction are untouched. `cms.publishPage` keeps the
canonical page-level publish path; the regression confirms it approves a
draft without marking the *site* externally live.

---

## Scope boundary

BP-13 is **not** built: there is no deployment adapter, no
`buildDeployments` writer, no public URL, no hosting integration. Every
"verified"/deployment capability intentionally stops at `release_prepared`,
and the queries/comment seams leave the receipt chain ready for BP-13
without implementing any of it. No other package (BP-02, BP-05, …) was
started.

---

## Truth boundaries and honesty record

- **No deploy, publish, spend, or provider contact.** Every path exercised
  by the new tests is database-only; no live network call exists in the
  suite; no real provider account was touched.
- **Nothing here can be proven externally by design** — the package's
  claims are exactly that a *false* external claim is impossible. The
  acceptance evidence is the mocked regression suite plus the repository
  gates; that is what `implemented_unverified` records.
- **Gates are not all green and are not claimed to be.** At chat start and
  again after the work: `bun run check` exits 1 **only** at the
  pre-existing secret-scan finding (`.env.keys`, blocker B3 — never
  allow-listed, never weakened, value never read or printed). Everything
  after it in the chain was run separately and passes: typecheck clean,
  lint 2 new-errors fixed and 0 remaining, unit **324/324**, `bun convex
  dev --once` clean, `audit:functions` ✓, `audit:capabilities` ✓ (152
  scanned, 145 capability-gated, 4 documented exemptions, 3 allow-listed).
  e2e/a11y were not re-run in this chat (no UI-route changes beyond the
  badge swap; recorded honestly as not-run-here).
- **CI unknown** for the autosaved tree (B2); never assumed.
- **Release gate remains BLOCKED** (B3). Credential rotation and repository
  remediation remain owner actions.

## Verification

1. `bun convex dev --once` — clean codegen.
2. `bun vitest run tests/unit/publish-truth.test.ts` — **10/10**.
3. `bun vitest run` — **324/324** (includes the updated deletion fixtures).
4. `bun tsc -b --noEmit` — clean.
5. `bun run lint` — 0 errors.
6. `bun run audit:functions` / `bun run audit:capabilities` — exit 0.
7. `bun run scan:secrets` — still failing at the pre-existing `.env.keys`
   finding only (unchanged, tracked, owner action).

---

## Review follow-up (same chat, 23 September 2026 — GitHub main `be1ade5a`, CI run 35866805693)

The GitHub review of BP-03 at `be1ade5a` found two correctness gaps. Both
fixes below ship with **red-first regressions** (each new test was run and
failed against the unfixed tree before the fix; the record is in the suite
header of `tests/unit/publish-truth.test.ts`).

1. **`publishSite` was skip-and-promote, not all-or-nothing.** It claimed to
   validate every page before mutation, but an invalid or empty page was
   skipped while the valid pages were still promoted — a partial release.
   The blueprint has **no partial-release clause**; its BP-03 Changes
   section says "Continue serving the last confirmed public release when a
   new publish fails", which implies a failed preparation must not ship a
   half-revised site. Preparation is now all-or-nothing: any invalid or
   empty page throws with a per-page problem list and the transaction
   aborts before promotion (nothing changes). Regression: a valid+invalid
   mix fails the whole preparation with the prior audit intact and the
   broken page never promoted; an empty page in the mix also fails with
   zero audits written.
2. **Public read paths served prepared content before any deployment.**
   `cms.getPublishedByPath` (unauthenticated public query) and
   `storefront.getPublishedPage` returned approved pages as soon as a
   preparation promoted them — before BP-13. Both are now gated by
   `src/convex/lib/deliveryGate.ts` (`hasVerifiedDeployment`): external
   serving requires the receipt chain — newest `buildReleaseAudits` row in
   phase `verified` whose `deploymentId` points at a `buildDeployments` row
   in state `succeeded`. Both rows are server-written only (no client-
   callable writer exists), so a preparation alone can never open external
   delivery, and a later failed/canceled deployment supersedes an older
   verified one — the last *confirmed* release is what keeps serving.
   Owner preview is preserved: the workspace renders drafts directly via
   `buildWorkspace.getPreviewData` and `builds.getReadiness`, neither of
   which uses the gate. Regressions: both public paths serve nothing after
   preparation alone, then serve the prepared document after a simulated
   server-written verified deployment (the exact shape BP-13's verifier
   will produce — no BP-13 implementation was added).
3. **Honest `publishSite` return and wording.** The return value no longer
   says `published`; it is `{ prepared: number }`, and the workspace toast
   says "Release prepared … Saved as a prepared release — not live yet.
   Deployment to a public URL arrives with hosting setup." (the old copy
   counted "pages approved" and implied saved-published equivalence).

**Follow-up verification:** unit **328/328** (14/14 BP-03 suite), tsc, lint
(0 errors), codegen, `audit:functions` and `audit:capabilities` all exit 0
(`lib/deliveryGate` registered as an internal file in the capability
registry; the audit-gate test failed first on the unregistered file). `bun
run check` still exits 1 **only** at the pre-existing `.env.keys`
secret-scan finding (B3, untouched). e2e/a11y were not re-run locally; CI
run 35866805693 at `be1ade5a` had passed them, and the follow-up commits
are autosaved after that run — **their CI status is unknown and must not be
assumed**. Release gate remains BLOCKED (B3). BP-13 is still not
implemented: no adapter, no deployment writer, no public URL; the verified
deployments in the tests are hand-written test fixtures proving the gate
opens only on the receipt chain.

---

## Second review follow-up (same chat, 23 September 2026 — GitHub commit
`d8d8c35`, CI run 35870794832: unit/typecheck/lint/codegen/e2e/a11y passed on
that exact SHA; both security scans failed on the known secret findings;
release remains BLOCKED; CI not called green overall)

The review found one remaining acceptance gap: the delivery gate read only
the **newest** audit and resolved pages through the **current** page
pointer, so after release A was verified and release B was merely prepared
(or B's deployment failed), both public read paths returned nothing —
violating BP-03's "Continue serving the last confirmed public release when
a new publish fails" — and a naive fallback to A's audit would have leaked
B's content, because B's preparation moves each page's
`publishedRevisionId`.

**Fix (red-first — both new tests failed against the `d8d8c35` code before
the fix):**

- `lib/deliveryGate.ts` now selects the **last confirmed release**: the
  newest audit whose receipt chain is intact (phase `verified` +
  `deploymentId` → `buildDeployments.state = "succeeded"`). A newer
  prepared or failed audit no longer disqualifies an older verified one.
- Readers resolve a page from the confirmed audit's **pinned revisions**
  (`revisionIds` mapped by page), never from the mutable
  `publishedRevisionId` pointer — so B's content cannot leak under A, and
  pages that exist only in a later unverified release are not served.
- Redirects added by B are honored only once B's release is verified: a
  redirect is returned only when its target page is pinned by the confirmed
  release (a redirect retargeting an already-confirmed A path still
  resolves safely inside A's content — no leak path).

**Regressions added to `tests/unit/publish-truth.test.ts`:**
1. A verified → B prepared → both paths still serve A's pinned revision
   (asserted by revision id and document) → B's deployment fails → both
   still serve A → B verified → both serve B.
2. A new page and a new redirect added by B stay hidden (both paths) until
   B is verified; after verification the page serves and the redirect
   resolves.

**Gates after the fix:** unit **330/330** (16/16 BP-03 suite), codegen,
tsc, lint (0 errors), `audit:functions` ✓, `audit:capabilities` ✓; `bun run
check` exits 1 **only** at the pre-existing `.env.keys` secret-scan finding
(B3, untouched). e2e/a11y were not re-run locally; CI run 35870794832
passed them at `d8d8c35`, and the commits autosaved after it have **unknown
ci status that must not be assumed**. Release gate remains BLOCKED (B3).
No BP-13 adapter or real publish was added; the verified/failed deployments
in the tests remain hand-written fixtures proving the gate's behavior.

**Handoff correction (recorded here because it fixes this report's own
text):** BP-02 is **sign-in/recovery/privileged access** — not "fix the CI
pipeline" as an earlier version of this report's handoff prompt stated.
BP-02 is already being worked by Codex in an isolated branch; **no new BP-02
chat should be started and BP-03 must not overwrite that work.**

---

## Third review follow-up (same chat, 23 September 2026 — GitHub main
`d3434a64`, CI run 35875669379: unit/typecheck/lint/codegen/e2e/a11y/install
passed on that exact SHA; both security jobs failed on the known secret
findings; release gate remains BLOCKED; CI not called green overall)

The review found one more last-confirmed-release gap: `cms.updatePage` can
move a published page's `fullPath` (and auto-creates the 301) immediately,
while both public readers resolved paths through the **live**
`by_site_path` index before applying the content pins — so a slug move for
unverified release B cut off A's confirmed route (`/old` served nothing)
and B's new path served A's pinned content (leak). A content-revision pin
alone is insufficient, exactly as the review stated.

**Fix (red-first — the new test failed against the `d3434a64` code before
the fix):** the release audit now snapshots the release's **routing** at
preparation time, and the readers resolve externally through that snapshot:

- `buildReleaseAudits` gains optional `routes` (fullPath → pinned revision
  id) and `redirects` (fromPath → {to, statusCode}) arrays;
  `publishSite` writes both at preparation.
- `lib/deliveryGate.selectConfirmedRelease` exposes the confirmed audit's
  `routesByPath` / `redirectsByPath` snapshots. When the confirmed audit
  has a route snapshot it is **authoritative**: `cms.getPublishedByPath`
  and `storefront.getPublishedPage` resolve paths through it and never
  consult the live index. At this stage, the intended behavior was to use a
  pin-based fallback for legacy audits without snapshots; the fifth review
  follow-up below supersedes that plan because current CMS rows cannot prove
  historical routes or metadata safely. The fallback is also skipped when a
  snapshot is present, because a naive pin lookup by page id would otherwise
  serve A's revision under B's new path.
- Result: A verified at `/` → slug moved to `/new` for B → before B
  verification (and after B's deployment fails), `/` still serves A's
  pinned revision on both readers; `/new` and B's redirect stay hidden;
  after B verifies, `/new` serves B and the old route disappears (the
  homepage is the one path `updatePage` deliberately does not auto-301 —
  its `oldPath !== "/"` guard — so no phantom `/` redirect is asserted;
  snapshot-gated auto-redirects for non-root moves are covered by the
  second-follow-up test).
- Tie-breaker fix found while verifying: two audits written in the same
  millisecond made "newest" ambiguous; the gate and the test helper now
  sort by `createdAt` then `_creationTime`.

Schema note at this review stage: the new `routes`/`redirects` fields are
**additive and optional** — no row migration is needed. The original plan was
to keep pre-snapshot releases serving through a pin fallback. The fifth review
follow-up below supersedes that behavior: audits without complete frozen route
and title metadata now fail closed and require a fresh verified release.

**Gates after the fix:** unit **331/331** (17/17 BP-03 suite), codegen,
tsc, lint (0 errors), `audit:functions` ✓, `audit:capabilities` ✓; `bun run
check` exits 1 **only** at the pre-existing `.env.keys` secret-scan finding
(B3, untouched). e2e/a11y not re-run locally; CI run 35875669379 passed
them at `d3434a64`, and commits autosaved after it have **unknown CI status
that must not be assumed**. Release gate remains BLOCKED (B3). BP-02
untouched (in progress by Codex in an isolated branch). No BP-13 adapter or
real publish.

---

## Fourth review follow-up (same chat, 23 September 2026 — GitHub main
`61f0605`, CI run 35878361142: application, e2e and a11y jobs passed on that
exact SHA; **both security jobs still failed** — never called green;
release gate remains BLOCKED)

Two correctness gaps in the route-snapshot work, both fixed **red-first**
(the new tests failed against the `61f0605` code before the fixes):

1. **Live-redirect fallback leaked B's auto-301 before verification.**
   `storefront.getPublishedPage` fell back to the live `cmsRedirects` table
   whenever `redirectsByPath.size === 0` — but a *new* audit with an
   intentionally empty snapshot also has size 0. For a non-homepage A page
   at `/old`, `cms.updatePage` slug `/new` auto-creates the 301
   `/old→/new`; before B verified, storefront exposed that redirect instead
   of serving A at `/old`. (The third follow-up's test missed this because
   it moved the homepage, which does not auto-redirect, and its route
   expression always selected `/`.) Fix: the fallback now keys on snapshot
   **absence** (`audit.redirects === undefined`, i.e. pre-snapshot legacy
   audits only) — a present-but-empty snapshot is authoritative, so B's
   redirect cannot appear before B verifies. Regression: non-homepage A
   page moved to `/new` for B → before verification and after B's failure,
   `/old` serves A (not the redirect) and `/new` is not found; after B
   verifies the redirect resolves.
2. **Public readers served mutable page metadata.** Both readers returned
   the live row's `title`/`seo` and checked the mutable `page.status`, so a
   title or SEO edit for B appeared publicly before B verified. Fix: the
   route snapshot now carries the metadata frozen at preparation
   (`routes[].title`, `routes[].seo`), and both readers serve title/SEO
   from the confirmed snapshot with no mutable `page.status` check — the
   snapshot is authoritative for the confirmed release. Regression: A
   verified → title+SEO edit for B → B prepared/failed: A's metadata still
   serves on both readers; after B verifies, B's metadata appears.

One existing test was reordered (not weakened): the "pages and redirects
added by B" test had inserted its redirect *after* B's preparation, which
the snapshot semantics correctly ignore — it now inserts the redirect
before preparation, which is the real workflow it meant to pin.

Schema note: `routes[].title`/`routes[].seo` are additive/optional; no
migration.

**Gates after the fixes:** unit **333/333** (19/19 BP-03 suite), codegen,
tsc, lint (0 errors), `audit:functions` ✓, `audit:capabilities` ✓; `bun run
check` exits 1 **only** at the pre-existing `.env.keys` secret-scan finding
(B3, untouched). e2e/a11y not re-run locally; CI run 35878361142 passed
them at `61f0605`; CI for commits autosaved after it is **unknown and not
assumed**. Release gate remains BLOCKED (B3). BP-02 untouched (Codex,
isolated branch). No BP-13 adapter or real publish.

## Proof

- `tests/unit/publish-truth.test.ts` — the five acceptance classes plus the
  review-follow-up suite:
  1. direct client call cannot manufacture `published`/compliance (and
     writes nothing);
  2. failed preparation preserves the previously served release (and a
     foreign-organization caller cannot prepare);
  3. content edits invalidate revision-pinned readiness;
  4. unverified legacy records stay readable, labelled
     `requires_verification`, with no invented receipt;
  5. `ReceiptBadge` never fakes green and a verified badge requires a real
     stored receipt;
  6. valid+invalid and empty-page mixes fail the whole preparation
     (all-or-nothing, red-first);
  7. `cms.getPublishedByPath` and `storefront.getPublishedPage` serve
     nothing before a verified deployment receipt and content after one
     (red-first; gate = `lib/deliveryGate.ts`);
  8. last-confirmed-release across prepare/fail (second follow-up, red-
     first) — A's pinned revision serves until B verifies;
  9. B-only pages and redirects stay hidden until B verifies (second
     follow-up, red-first);
  10. A's route survives a slug move to `/new` until B verifies (third
      follow-up, red-first; route/redirect snapshots in the release audit);
  11. a non-homepage A route survives B's auto-created redirect until B
      verifies (fourth follow-up, red-first; snapshot presence beats the
      live redirect table);
  12. metadata edits for B never appear publicly before B verifies (fourth
      follow-up, red-first; title/SEO frozen in the route snapshot).
- Red-first record in the suite header; deletion-fixture regressions in
  `tests/unit/deletion-completeness.test.ts`.

---

## Fifth review follow-up — legacy snapshot compatibility (23 Sep 2026)

Review identified two schema/delivery compatibility gaps in the prior
follow-up. First, `buildReleaseAudits.routes[].title` had become required even
though the preceding committed writer stored only `fullPath` and `revisionId`;
this risks rejecting existing audit rows. Second, the public readers required
a route snapshot despite comments describing a legacy pin fallback. That
fallback cannot safely reconstruct historical routes or metadata because
current CMS rows may already contain an unverified B slug/title/SEO edit.

**Compatibility behavior:** `routes[].title` is optional in the schema, so
older snapshot rows remain schema-compatible. The delivery gate permits
serving only when the verified audit has a route snapshot and every route has
a frozen title. An audit with no route snapshot or incomplete legacy metadata
is retained as historical evidence but public delivery returns not-found until
a new release is prepared and verified. No current CMS route/title/SEO is
copied into that old audit. Snapshot-complete verified A continues serving
across B preparation and failed deployment; the existing A→B regression pins
that behavior.

**Red-first regressions:** two focused tests were run against the old
implementation. The missing-title test failed because CMS served the legacy
row. The pre-snapshot test asserts neither the former path nor a mutated path
can be inferred, including after restoring the historical verified receipt
shape. Both CMS and storefront readers now fail closed. These are database
fixtures only; no production rows were queried or changed.

**Migration and rollback:** no row migration is required: the schema change
widens validation by making `title` optional and does not rewrite stored data.
Rollback is code-only: restoring the previous schema/readers re-enables the
old behavior. Do not roll back while rows with missing title or absent routes
exist unless a separately reviewed migration/backfill can reconstruct them
from immutable evidence; a backfill from mutable CMS records is unsafe. No
claim is made about whether such live rows exist. Any release rollback plan
must inventory their presence before changing this behavior.

**Verification in this checkout (Bun 1.3.14):** frozen-lockfile dependency
install exit 0. Focused test before implementation: exit 1 with the expected
legacy-title serving failure; focused suite after implementation: exit 0,
21/21. Full unit suite: exit 0, 335/335. `bun run typecheck`: exit 0.
`bun run lint`: exit 0, 0 errors and 28 existing warnings. `audit:functions`:
exit 0 (221 scanned; 3 existing review notices). `audit:capabilities`: exit 0
(152 scanned). `bun run check`: exit 1 at the unchanged `.env.keys` finding;
typecheck, lint, and unit stages passed before the secret scanner stopped the
chain. Secret scan exit 1 for the same tracked `.env.keys` private-key finding;
value was not read or printed, scan was not weakened.

`bun run codegen`: exit 1 because no `CONVEX_DEPLOYMENT` is configured.
`bun convex dev --once`: exit 1: network name lookup failed (`ENOTFOUND`) while
Convex attempted local-deployment setup; no deployment was configured or
contacted. Without `VITE_CONVEX_URL`, a reviewer observed a blank app; their
full E2E run had five browser failures and was interrupted (exit 130). This
is environment configuration, not a BP-03 regression: `src/main.tsx` passes
`import.meta.env.VITE_CONVEX_URL` directly to `ConvexReactClient`, and this
checkout has no `.env` (only `.env.example`). The E2E fixture intercepts
backend traffic, but Vite still needs a syntactically valid URL at startup.
I independently ran `tests/e2e/smoke.spec.ts` with the inert
`VITE_CONVEX_URL=https://e2e-test-only.convex.cloud` and Bun on PATH; landing
and not-found passed 2/2 (exit 0). I did not complete a full-suite or a11y
run. The controller independently verified the local inert URL
`http://127.0.0.1:9999`: focused landing a11y passed 1/1 and the full suite
passed 15, skipped 1 real-OTP test, exit 0 (33.6s). Those latter results are
controller-reported, not run in this session. CI status for this checkout is
unknown. Session audit was invoked, exit 1 before repository edits due to a
permission error writing the central proposal under `~/.hermes/.../proposals`;
no proposal was applied.

**Independent BP-03 inspection:** verified-phase receipt rows have no current
production writer. `builds.auditReadiness` writes `draft_approved`;
`buildWorkspace.publishSite` writes `release_prepared`. BP-13's deployment
verifier is absent. This makes old verified rows unreachable from current
server writers but does not establish whether older persisted rows exist.
No provider or production inspection was performed. The fail-closed legacy
behavior may withdraw a historical release on upgrade; preserve that as an
explicit upgrade limitation, not as proof the last-confirmed-release
guarantee holds for route-less legacy rows.

**Handoff:** controller review should decide how to inventory old persisted
audits before rollout and sequence any customer-visible reverification with
BP-13. Safe migration can only use immutable historical evidence; current CMS
rows are not a valid source for restoring historical routes/title/SEO. BP-02
remains isolated and owner-blocked for provider/domain and step-up choices.
