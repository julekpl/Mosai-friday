# BP-17/S1a — Contact import and consent truth

**Status: implemented in this checkout; integration and release gates remain open.** This is a bounded first slice of BP-17/S1, not a complete CRM or consent-management implementation.

## Scope delivered

- Manual contact creation no longer accepts a caller-supplied `consentMarketing` boolean. It stores no new consent claim.
- Email addresses supplied to manual create/update are trimmed, lowercased and validated. Repeated canonical addresses in the same project are handled deterministically; update collisions are rejected. Existing records are not overwritten by a repeated create/import.
- Customers can upload a CSV up to 128 KB and 100 contacts / 20 columns, map name/email/company/tags, review a preview, and explicitly submit the batch. Repeated addresses in the file and invalid addresses are identified before submission.
- A single project-authorized Convex mutation revalidates bounds and fields, skips duplicate rows and existing canonical project emails, and returns exact inserted/skipped/invalid counts. The mutation accepts no consent field and does not trigger sending.
- The previous consent toggle and claims that campaigns check opt-in at send time were removed. A legacy `consent.marketing=true` value is displayed as **“Unverified legacy value — not subscribed”**; it is not presented as proof of opt-in.

## Files

- `src/convex/contacts.ts`
- `src/lib/customerCsv.ts`
- `src/pages/app/Customers.tsx`
- `tests/unit/customer-import.test.ts`
- `docs/implementation/reports/BP-17-S1a-contact-import.md`

## Verification

- `node_modules/.bin/vitest run tests/unit/customer-import.test.ts` — 7 tests passed.
- `node_modules/.bin/tsc -b --noEmit` — passed.
- `node_modules/.bin/eslint src/convex/contacts.ts src/pages/app/Customers.tsx src/lib/customerCsv.ts tests/unit/customer-import.test.ts` — passed.
- `node scripts/audit-public-functions.mjs` — passed authorization audit (235 scanned; three existing REVIEW notices remain for `billing.currentPlan`, `files.generateUploadUrl`, and `users.currentUser`).
- `git diff --check` — passed.
- Controller integration run with the bundled Bun binary: full unit suite **473/473**, `bun run typecheck`, `bun run lint` (0 errors, 28 pre-existing warnings), `bun run build`, `bun run audit:functions`, `bun run audit:capabilities`, and `bun run audit:data-registry` all passed in the shared checkout containing the uncommitted BP-13 slice. Hermetic `bun run test:e2e` passed **20**, with **1** live OTP test skipped; it does not exercise an authenticated CRM import. `bun run scan:secrets` failed on the pre-existing tracked `.env.keys` finding (value redacted). Codegen could not run without `CONVEX_DEPLOYMENT`; this slice adds a method to the already generated `contacts` module and does not add a Convex module file. No provider calls or deployment were made.
- Exact development-main commit `a594cf75175287f63967264b2b5852cb4e3d792b`: [CI 35977893382](https://github.com/julekpl/Mosai-friday/actions/runs/35977893382) passed install, Convex codegen drift, typecheck, lint, unit, Playwright journeys and axe accessibility. The working-tree and full-history secret-scan jobs failed. Release remains blocked.

## Still open

- This does not implement an append-only consent history, channel/purpose policy, evidence capture, withdrawal ledger, suppression or contact erasure. Existing boolean records cannot be retroactively treated as verified consent. Owner-approved consent capture semantics remain necessary before adding a grant flow.
- No email sender or send-time consent/suppression enforcement was added; BP-17/S2 remains blocked by the approved email provider/domain decision (O2).
- Import deduplication uses the existing exact `by_project_email` index. New writes are canonical, but older mixed-case records may not be found by that index. A bounded indexed migration or normalized-email schema field is needed before claiming full legacy-data deduplication. The import preview checks in-file duplicates; the authoritative server receipt reports existing canonical addresses skipped at commit.
- Contacts continue to use the existing `contacts` table and project privacy registry entry. No new table or schema migration was required. Role-protected exports, contact-level erasure history and organization ownership details were not independently verified by this slice.
- `docs/pack/08-module-contracts.md` is referenced by AGENTS/README but absent in this checkout, so module-contract guidance could not be independently reconciled.
- This checkout also contains concurrent BP-13 work in `docs/implementation/DEFERRED-WORK-BACKLOG.md`, `src/convex/lib/capabilities.ts`, `src/convex/schema.ts`, `tests/unit/publish-truth.test.ts`, `docs/implementation/reports/BP-13-S1-public-projection.md`, and `src/convex/modules/buildWebsite/`. This chapter did not modify those paths. Combined integration verification remains the controller's responsibility.
