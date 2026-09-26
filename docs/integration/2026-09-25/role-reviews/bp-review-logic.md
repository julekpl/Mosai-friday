# Blueprint backend review vs current main (59bad44, 25 Sep 2026)

## 0. Verification note
The plan claims `projectFiles.source: upload|owner_site|stock` exists at
schema.ts:1089-1112 (marked "verified"). On this checkout, `projectFiles`
(schema.ts:1072-1082) has NO `source` field at all: `projectId, name,
mimeType, sizeBytes, storageId, excerpt, uploadedBy, createdAt`. MD-1's
"additive fields" framing is correct in effect (source is new, not renamed),
but the plan's own fact-check is stale: re-verify all "(verified)" line
numbers before coding; several may have drifted between the plan's baseline
and this checkout. No `projectVisits`, `sinceLastVisit`, or `contentSources`
table exists yet either, confirming #19/#13/#22 are not merged here.

## 1. Schema collisions and naming

1. [HIGH] `projects.marketContext` vs `businessProfile.market` (schema.ts:38,
   `market: v.optional(v.string())`) vs `personas.country` (schema.ts:389).
   Three "where" fields at three granularities: free-text business market,
   project-level resolved `{country,currency,locale}`, and per-persona
   country. Plan already documents authority order for marketContext (3.
   MK-1) but never states whether `businessProfile.market` should be
   deprecated, read-only, or kept as a distinct "market position" concept
   (it reads like ICP description, not geography: e.g. "premium urban
   coffee drinkers"). Rename risk: `market` is ambiguous. Recommend keeping
   `businessProfile.market` as-is (positioning text) and documenting in CT-1
   / MK-1 that it is NOT a source for `marketContext.country`, only
   `websiteScan.businessDetails.country`, Google listing, and confirmed
   profile are. The plan's own section 2.2 already makes this call: put it
   in the schema comment too, not just the doc, or a future agent will wire
   `market` into the resolver by pattern-matching field names.
2. [MED] `personas.country` and `projects.marketContext.country` can
   disagree (a persona may legitimately target a different country than the
   business's own market). Not a clash, but MK-2/AG-4b must state which one
   the market-aware AI prompts use for which claim (own currency/locale =
   marketContext; persona targeting = personas.country). Add one sentence to
   MK-2's acceptance criteria.
3. [MED] Discovery/organization naming: plan already caught and fixed the
   `organization.resolve.v1` / `src/convex/organization/` clash with the
   billing "Organization" glossary term (section 2.2, corrected to
   `discovery/` and `business.resolve.v1`). Confirmed current
   `src/convex/organizations.ts` (agency links, schema.ts orgRoleValidator)
   is the only existing "organization" meaning: rename is correct and
   necessary; flag as done-in-plan, not a new finding.
4. [LOW] `mediaVariants.preset` vs `productMedia.position`/`variantId`
   (schema.ts ~644-654, `productVariants`/`variantId` already means SKU
   variant, e.g. size/color). "Variant" is now overloaded: product SKU
   variant vs image crop variant. Recommend `mediaCrops` instead of
   `mediaVariants` to avoid a second reader assuming it relates to
   `productVariants`.
5. [HIGH] Registry coverage: `domainEvents`, `capabilityRuns`,
   `discoveryCandidates`, `mediaVariants` are all new project- or user-scoped
   tables. AGENTS.md rule 12 requires each be registered in
   `dataRegistry.ts` (currently 82 entries covering 77 tables 1:1 minus a
   few, `src/convex/lib/dataRegistry.ts`) and CI (`audit:data-registry`)
   fails otherwise. AG-1/MD-1/OD-1 tickets state this but there is no single
   ticket item verifying `bun run check` after all four schema PRs land
   together: with four lanes landing schema changes into the same file
   (section 5 "conflict hot spots"), a registry entry is the easy thing to
   drop in a rebase. Add an explicit acceptance line to CT-2 or to whichever
   ticket merges last: "registry entry count == defineTable count minus
   documented exceptions."
6. [MED] `discoveryCandidates` deletion policy: OD-1 says "user-scoped
   registry entry with `accountCleanup` and an expiry sweep" but the table
   also holds a `scan snapshot` (website scan text/images): same category of
   data the SEC-1 finding worries about. If a project is created from a
   candidate then the candidate deleted later (account cleanup, TTL sweep),
   the project's copy must already be independent (plan says "copies the
   scan server-side" into `projects.discoveryCandidateId?`: but that field
   is only a reference id, not a copy, unless the referenced scan text is
   also duplicated onto the project). Verify `projects.create` actually
   copies scan fields rather than just storing the pointer; otherwise a later
   candidate-row sweep silently blanks project provenance. File to check:
   whichever implements OD-1's "projects.create accepts candidateId".

## 2. Data flow / authority / races

7. [HIGH] Starter-kit race: `projects.create` (schema.ts businessProfile
   fields, `src/convex/projects.ts`) kicks off the starter-kit job
   asynchronously (existing shipped behavior). OD-1/OD-2 now also want
   `projects.create` to accept `candidateId` and copy scan-derived fields
   (name, businessType, description) in the same call. If the starter kit
   job reads `businessProfile`/`websiteScan` mid-write (job starts before
   the candidate-copy finishes, or vice versa), the kit can draft content
   from half-written fields. Needs an explicit ordering rule: candidate copy
   commits synchronously in the same mutation as project creation, kit job
   scheduled only after that mutation returns (this is likely already true
   given Convex's single mutation transaction model, but the ticket should
   say so plainly and add a test: "kit's first AI call sees copied
   candidate fields, not defaults").
8. [MED] `AUTHORITY_ORDER` (CT-1, section 3) has no explicit interaction
   with the starter kit's own AI-drafted `businessProfile` (authority
   presumably `inferred`, lowest tier). If the starter kit runs and writes a
   draft profile, then OD-2's confirm card is answered by the user
   afterward (unusual order but possible if OD-1 crawl is slow and kit
   finishes first), `decideWrite` must ensure the confirm-card's
   `user_confirmed`/`accepted_artifact` always wins over the kit's
   `inferred` draft. This is exactly what `decideWrite` is for, but no
   ticket wires the kit's write path through it: AG-4a wraps
   `business.understand.v1` but plan explicitly says "no prompt change" and
   doesn't say the kit's *write* now goes through `decideWrite` rather than
   a raw upsert. Add to AG-4a acceptance: "kit write path calls
   `decideWrite`, not `ctx.db.patch` directly, for any field OD-1/OD-2 can
   also write."
9. [MED] Idempotency: OD-1 dedupes by `(userId, domain)` with an `expiresAt`
   sweep (good: matches AGENTS rule 6 spirit for external reads, though
   this is a read not a write). MK-3's `market.confirm` orgMutation and
   OD-2's project-creation-from-card are the two true external-facing writes
   here (well, internal writes) and both plans state single-emit tests. No
   ticket states an idempotency key for `capabilityRuns` beyond "idempotent
   by input hash" (AG-4a): confirm that hash includes `projectId` +
   relevant source field versions (not just literal input args), or two
   different confirm-card runs with the same shape produce a false-cached
   hit and skip a needed re-run.
10. [LOW] Home priorities (HM-1) reading from `capabilityRuns`/kit status:
    if HM-1 ships before AG-1 (dependency graph section 5 shows
    `HM-1 --> HM-2 --> HM-3` and AGENT lane separately after CT-1/CT-2, not
    gated on HM-1), HM-1 cannot depend on `capabilityRuns` existing yet.
    Confirm HM-1's "For you now" query reads only shipped tables (kit
    status, project completeness) at first and AG-4a's evidence is an
    additive enhancement later, not a hard dependency: the table doesn't
    show this dependency and should.

## 3. Regression risk vs shipped features

11. [HIGH] `saveScan` (`src/convex/projects.ts:370-376`, confirmed
    `orgMutation` writing client-supplied `scanFields`, deliberately
    excluding `images` per section 8's correction) is the wizard's current
    write path; SEC-1 removes its client callers. Regression test needed:
    existing `NewProjectWizard.tsx` flow that calls `saveScan` today must
    keep working (or be migrated in the same PR): a removed caller with no
    replacement breaks onboarding, not just a "nice to fix." Required test:
    end-to-end wizard scan still populates `businessProfile` draft after
    SEC-1, using `storeServerScan` only.
12. [HIGH] `importOwnerPhoto` re-validates picked images against
    `websiteScan` images server-side (per plan 2.1): MD-0/MD-1 change
    `projectFiles.source` to include `camera` and add `kind/role`. Required
    regression test: `importOwnerPhoto`'s existing re-validation still
    rejects a client-forged URL after MD-1's schema additions (field
    additivity alone doesn't guarantee the validator wasn't refactored
    around the same PR).
13. [HIGH] `stock.ts`/stock import path (MD-0 "reuses `files.list`,
    `stock.*`"): required regression test: stock-imported files still
    carry `source: "stock"` and Pexels `attribution` after MD-1 widens the
    `source` union; a `v.union` widened without checking every existing
    write site can silently narrow inference if any call site used
    `v.literal("stock")` type assertions that now mismatch. Grep every
    current writer of `projectFiles` (`src/convex/files.ts:41`, stock
    importer) before merging MD-1 and add a table-driven test enumerating
    all four `source` values round-tripping through create+read.
14. [MED] `productMedia.projectFileId?` (MD-1) is additive per schema.ts:644
    (current `productMedia` has no such field): required regression test:
    existing URL-only `productMedia` rows (no `projectFileId`) still render
    in Sell (MD-0b's own acceptance line covers this: good, keep it).
15. [MED] `dataRegistry.ts` deletion test: current suite presumably asserts
    `cascadeDeleteProject` covers every `project()`-scoped table (AGENTS
    rule 12, `bun run audit:data-registry`). Every new project table (AG-1's
    two, MD-1's `mediaVariants`, MK-1's none since `marketContext` is a
    field not a table) needs a project-deletion test that a fresh project
    with rows in that table is fully cleaned. Add explicitly to AG-1 and
    MD-1 "definition of done," not just "registry entries added."
16. [MED] `audit:functions` allow-list (`scripts/public-functions-allowlist.json`,
    4 entries today, all OAuth callbacks + one public CMS read): none of
    AG/MD/MK/OD tickets should need a new entry; every new public function
    listed (`market.confirm`, `business.resolve.v1`'s wrapping mutation,
    `MediaPicker`'s server mutation) must call `requireUser`/`requireProject`.
    Explicit regression check: run `bun run audit:functions` after each
    ticket, not just once at the end: the table doesn't list this as a
    per-ticket test though CT's own definition of done implies it.
17. [LOW] Agency client projects: `agencyClientLinks`
    (`src/convex/organizations.ts:492-558`) is unaffected by any of the four
    blueprints directly, but OD-1's `discoveryCandidates` keyed by
    `(userId, domain)` and D12's "after sign-in" gate need to confirm which
    `userId` is used when an agency member creates a project inside a client
    org: must not resolve/cache a candidate under the agency member's own
    domain when the target is the client's business. No ticket mentions this
    interaction; add one line to OD-1 acceptance criteria.

## 4. SerpApi budget-safe fallback (D3/D11 follow-through)

18. [HIGH] `scraping.ts:388` area + `lib/googleMaps.ts` already has a
    per-user `lookupRateLimits` table (schema.ts:2025-2032, kind
    `"google_maps"`, windowed): a real, already-shipped per-user throttle.
    What's missing for the blueprint's OD-1/OD-4 additions is a **global**
    monthly ceiling: SerpApi's free tier (100-250 searches/month per
    OWNER-DECISIONS D3) is shared across ALL users, but `lookupRateLimits`
    only bounds one user's rate, not total account spend. Proposed design:
    add a `platform` scope row (mirrors `aiSpendRollups`'s existing
    `scope: "platform"` pattern at schema.ts, period `"2026-09-24"` daily or
    monthly) tracking SerpApi call count; `suggestGoogleBusiness` and OD-1's
    crawl-confirmation path both check-and-increment it before calling
    SerpApi; once over a configured monthly ceiling (e.g. 200, leaving
    headroom under 250), the function returns `needs_setup` (never a fake
    empty result) and the UI shows "Business search is temporarily
    unavailable" (reusing the existing user-facing string at
    scraping.ts:380/385) rather than silently degrading to no suggestions.
19. [MED] Cache: OD-1's `discoveryCandidates` already caches per
    `(userId, domain)` with `expiresAt`: extend this to also cache
    SerpApi/Google-listing results independent of the resolve flow (e.g. the
    typeahead `suggestGoogleBusiness`) so repeated typing by the same user in
    one session doesn't multiply calls; current `lookupRateLimits` bounds
    call rate but not redundant identical queries. Add a short-TTL
    (in-memory or a small keyed table) cache on the normalized query string.
20. [LOW] Owner decision D3/D11 says "no paid provider" and enrichment
    switched off ($0). OD-3 must ship gated behind a feature flag that
    defaults false (no `featureFlags.ts` exists yet per plan 2.1 finding) -
    confirm whichever ticket eventually enables OD-3 also adds the flag
    infrastructure; do not hardcode `if (false)` as the gate since a later
    accidental flip has no audit trail.

## 5. Cost-spend guard inventory

21. [table] AI calls (all): guarded by existing `aiBudget.ts` /
    `STARTER_KIT_BUDGET_MICROUSD` ceiling ($0.40/kit) and `aiRateLimits`
    per-user window: AG-3's `modelClass` hint must not bypass
    `resolveForRequest`'s existing budget check; AG-3 ticket already says
    "callers without it unchanged": good, keep as an explicit regression
    test.
22. [table] SerpApi (Google listing search): guarded today only by
    per-user `lookupRateLimits`; missing platform-wide ceiling: see finding
    18, needed before OD-1/OD-4 land (OD-4's benchmark script itself will
    burn real quota against owner-supplied fixtures: OD-4 ticket already
    says "manual only, never in CI," but should also state a fixed max
    fixture count per run, e.g. 20 domains, to bound spend of a manual
    re-run).
23. [table] Media processing (MD-2a quality check, MD-S sharp spike): $0
    guard is structural (no external provider), but a pure-JS decoder
    (`jpeg-js`/`upng-js`) run as a scheduled node action on every upload has
    a compute-time cost inside Convex's own action minutes; MD-2a should cap
    max input size before decoding (reject/skip quality-check, not upload,
    for files above e.g. 20MB) to avoid a large-file DoS-by-cost on the
    action budget. No ticket states this ceiling.
24. [table] Enrichment / person lookups (OD-3, deferred): D11 sets cap to $0
    while off; when ever enabled, guard must be a hard per-organization
    monthly counter mirroring `aiSpendRollups`'s pattern, checked
    server-side before the provider call, returning `needs_setup` at cap -
    not built yet, correctly deferred, but the *pattern* to reuse
    (`aiSpendRollups` scope union) should be named in whatever future ticket
    revives OD-3 so it doesn't invent a third rollup shape.
25. [table] World Bank cache (MK-5, deferred) and CLDR subset (MK-2,
    committed static file, no network): no spend risk; MK-2 correctly has
    no runtime cost since CLDR ships as a build-time generated file, not a
    live fetch, per plan section 4 MK-2 description.

## Proposed final names (summary)
- Keep `projectFiles` table name; add fields as MD-1 lists, rename
  `mediaVariants` -> `mediaCrops` (finding 4).
- `projects.marketContext` (as proposed): do not touch
  `businessProfile.market` (positioning text, distinct concept).
- `src/convex/discovery/resolve.ts`, `business.resolve.v1`,
  `discoveryCandidates` (as corrected in plan section 2.2/7).
- `domainEvents`, `capabilityRuns` as proposed, both registered in
  `dataRegistry.ts` with `project()` scope before merge (finding 5).
- New `lookupRateLimits`-sibling platform-scope tracking row (reuse
  `aiSpendRollups` shape) for SerpApi monthly ceiling: no new table name
  needed if folded into a generalized `platform` scope row keyed by
  `kind: "serpapi_google_maps"` alongside the existing `aiSpendRollups`
  pattern, or a minimal new `lookupSpendRollups` table mirroring it 1:1.
