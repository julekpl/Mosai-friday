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

## Proof

- `tests/unit/publish-truth.test.ts` — the five acceptance classes:
  1. direct client call cannot manufacture `published`/compliance (and
     writes nothing);
  2. failed preparation preserves the previously served release (and a
     foreign-organization caller cannot prepare);
  3. content edits invalidate revision-pinned readiness;
  4. unverified legacy records stay readable, labelled
     `requires_verification`, with no invented receipt;
  5. `ReceiptBadge` never fakes green and a verified badge requires a real
     stored receipt.
- Red-first record in the suite header; deletion-fixture regressions in
  `tests/unit/deletion-completeness.test.ts`.
