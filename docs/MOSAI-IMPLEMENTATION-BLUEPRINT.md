# MOSAI implementation blueprint

**Prepared:** 23 September 2026. **Baseline:** [`julekpl/Mosai-friday@a3edd69bf813e4705f9d189fe43079aee3f2257e`](https://github.com/julekpl/Mosai-friday/tree/a3edd69bf813e4705f9d189fe43079aee3f2257e), rechecked against GitHub main while preparing this document. **Scope:** the complete product requested by the owner, not a reduced MVP. **Status:** implementation guidance; no feature is marked complete by this document.

## 1. How to use this blueprint

This is a code-directed supplement to the existing backlog, not a replacement architecture. Keep React, TypeScript, Convex, Tailwind, Radix, Tiptap, the existing CMS block model and the canonical capability registry. Preserve working functionality and unrelated changes. Implement one bounded ticket per PR, following `AGENTS.md`. A blueprint is not authorization to push, deploy, rotate secrets, migrate/delete live data, spend money or choose an unapproved provider.

Paths marked **existing** were located in the audited snapshot. Paths marked **new** are proposed files, not claims that those implementations exist. File paths and named functions are stronger anchors than line numbers. Before implementation, compare HEAD with the baseline and re-find every symbol. If an implementation already exists on a newer branch, verify it and integrate it through normal review rather than rebuilding it.

The repository is missing several documents referenced by its own instructions. The enclosing workspace contains `04-adrs.md`, `05-design-system.md`, `07-ai-agent-config.md` and `08-module-contracts.md`; read those for this plan. Add reviewed copies to `docs/pack/` in the documentation-reconciliation ticket. Do not invent missing blueprint text or silently promote a proposed ADR into an approved decision.

**Source of truth order:** owner decisions and security instructions → current executable code and tests → accepted contracts → dated ticket narratives. `docs/tickets/T2.5-data-registry-export-deletion.md` says “done”, but the audited registry is still a seed, `billing.deleteAccount` still performs its old cascade and `crons.ts` lacks the finalizer. Reconcile that discrepancy before editing; ticket prose is not proof of implementation.

## 2. What “working” means

A new customer can sign in, create a business context from verified sources, correct it, create personas/content/journeys, choose a tool and finish that tool's actual outcome. A published shop is accessible to a stranger. A deployed app runs its real backend. A campaign exists in the provider account. A scheduled post has a provider receipt. Analytics recommendations cite actual observations. Cancellation changes the provider subscription; account deletion observes the agreed lifecycle policy.

Keep each module useful without other paid modules. Improve it when others are enabled through references, events and registered actions. “All modules complete” is the final acceptance scope; sequencing work is not removing features.

### Evidence levels

| Label | Required proof |
|---|---|
| Implemented | Reviewed code and regression/contract tests pass. |
| Configured | Required credentials/scopes/account/domain settings verified without exposing values. |
| Connected | Provider identity/account verified; token presence alone is insufficient. |
| Operational | An approved test journey completed against the intended external system and stored its receipt. |
| Ready to release | Operational journeys, security/privacy checks, accessibility and output-quality checks pass for the declared countries/features. |

Show `needs_setup`, `unavailable`, `needs_attention` or a draft state while proof is missing. A saved draft is a valid success but is not a published external resource. Do not require a fictitious provider receipt for a purely local edit; require external receipts for external-success claims.

## 3. Dependency and delivery map

The labels below are work packages; split larger packages into the concrete PR slices specified inside them. Map them to existing tickets rather than creating a competing numbering scheme.

| Order | Packages | Existing backlog mapping | Exit condition |
|---|---|---|---|
| A | BP-01–04: baseline, auth, publishing truth, social defects | T0.1/T0.8, T1.5/T1.8, T2.13, E3.5 | Known failures have regressions; no false live state or broken credential handoff. |
| B | BP-05–09: lifecycle, billing/admin, jobs, connections, AI | T2.4–T2.12 | Shared contracts authorize and record work correctly. |
| C | BP-10–12: evidence, base workflow, measurement | E3.1, T2.14, E3.7 | Correctable facts and actual observations support outputs. |
| D | BP-13–18: public CMS, commerce, app builder, ads, CRM, social | T2.15, E3.2–E3.8 | Every requested tool completes its standalone customer outcome. |
| E | BP-19–20: usability, operations and full release evidence | T2.16, design/test contracts | Complete combined journeys pass with users and real test accounts. |

Each PR must have explicit predecessor checks. A module cannot claim integration complete before jobs, connections, receipts, capability checks and measurement contracts it uses are working. Follow the existing backlog's phase gates unless the owner approves a revised sequence.

## 4. Shared implementation contracts

### 4.1 Boundaries and identifiers

- Keep existing `guards.ts` builders and authorization behavior; do not create a second tenancy system.
- Current executable keys are `build.publish`, `promote.spend`, etc. Product submodules such as `build.website` and `build.app` are a different dimension. Add an explicit mapping in the canonical registry; do not scatter renamed strings through components.
- Introduce browser-safe types in **new** `src/shared/{contracts,events,refs,actions,ai}/`. Server implementations for new domain work go in **new** `src/convex/modules/<domain>/`. Extend `src/convex/lib/capabilities.ts` file ownership metadata and audit traversal as paths change. Avoid moving the entire flat backend in one PR.
- Every new table in **existing** `src/convex/schema.ts` needs authorization, indexes, export/deletion/retention rules and tests. Schema changes are additive first; use idempotent, checkpointed backfills and rollback notes. Never reset the database to resolve a migration.
- Modules own their tables. Other modules consume authorized reference DTOs or events, not raw rows. Public DTOs never contain credentials, unpublished content or internal customer information.

### 4.2 External execution protocol

1. Validate identity, role, project, capability, input and destination account.
2. Persist the proposed action and a hash of its payload, target and source revision. Capture required approval against that exact hash. Editing an approved action invalidates approval.
3. In one mutation claim the operation using a stable operation ID, payload hash, lease and attempt number. Recheck entitlement and approval immediately before execution.
4. Perform the network request in an action. Pass a stable provider idempotency key where the provider supports it.
5. In an internal mutation record a redacted provider receipt and the corresponding event; complete the job.
6. If the request may have succeeded but no receipt was saved, reconcile with the provider. Do not blindly repeat a non-idempotent publish/payment call. If reconciliation is impossible, show an uncertain outcome requiring attention.

Do not claim exactly-once network delivery. Aim for idempotent effects where supported and visible uncertainty elsewhere. Convex actions perform external calls and call queries/mutations for database work; keep token refresh and other network requests out of mutations. [Convex action documentation](https://docs.convex.dev/functions/actions).

### 4.3 Proposed records

These are schema requirements to refine into validators and migrations, not pasted production schemas.

| Record | Minimum fields and important indexes |
|---|---|
| Job | organization/project, type, state, operationId, inputRef/hash, attempt, lease owner/expiry, cursor, progress, error category, nextAttemptAt; indexes by state/due time and project. States: queued/running/waiting_for_user/succeeded/partially_succeeded/failed/canceled. |
| Provider receipt | tenant, provider, operation, operationId, providerResourceId, providerRequestId if supplied, confirmedAt, safe status summary; operation/provider-resource indexes. Never store raw secrets or assume every provider supplies a request ID. |
| Event/outbox/inbox | versioned type, tenant, aggregate ref/version, occurredAt, correlation/causation, hop count, payload; consumer+event dedupe, retry/dead-letter state. |
| Connection | tenant, provider, selected account/property, granted scopes, configuration/authorization/verification/sync states, credentialRef, expiry, last success, safe error and reconnect action. |
| Fact/evidence | tenant, field/value, sourceRef, URL/provider ref, observed/retrieved timestamps, source version/hash, extraction method, confirmed/inferred/disputed status, confidence rationale, confirming actor. |
| Metric observation | tenant, provider/account, metric/dimensions, time window, timezone, unit/currency, value, fetchedAt, attribution definition and provider revision. Upsert key includes all dimensions and the window. |
| Approval | action ref, payload hash, destination, approving actor/role, authentication strength, expiresAt, decision, supersededBy. |
| AI run | tenant, agent/prompt/model version, context refs+versions, budget/cost, output ref, errors, validation results, action/approval/receipt refs where applicable. |

## 5. Code work packages

### BP-01 — Repair the baseline and make status documentation trustworthy

**Existing:** `.github/workflows/ci.yml`, `playwright.config.ts`, `tests/e2e/{smoke,a11y,no-platform-calls}.spec.ts`, `tests/unit/platform-detach.test.ts`, `.gitleaks.toml`, `scripts/scan-secrets.mjs`, `docs/pack/{STATUS,README,10-build-backlog}.md`, `docs/tickets/T2.5-data-registry-export-deletion.md`.

**Changes:** First reproduce the current failures. Update the landing assertion to the intended current copy, while retaining a real assertion on the primary CTA and navigation. Keep signed-out redirect and sign-in response assertions. Give browser tests a documented test-only auth/backend setup instead of treating `https://placeholder.convex.cloud` as a working service. Use deterministic component/contract tests for error states and a separate real OTP journey against a test deployment. Test-only shortcuts must not ship in production or bypass server guards. Upload sanitized browser traces/screenshots on CI failure with limited retention. Inventory skipped/expected-failure tests and stale claims; do not hide them under a green headline.

Investigate the history scan without printing matched secrets. Credential revocation and any history rewrite require their own explicit operational authorization. Do not allow-list an exposed credential to pass CI. Bring the missing reference documents into the pack after reviewing their status and dates.

**Acceptance:** All existing CI jobs execute and pass, including security checks previously skipped after the history failure. Broken auth, wrong CTA navigation and planted synthetic secret fixtures fail the relevant gates. CI evidence is attached to the exact commit, and STATUS agrees with executable code.

### BP-02 — Finish sign-in, recovery and privileged access

**Existing:** `src/pages/Auth.tsx`, `src/components/RequireAuth.tsx`, `src/hooks/use-auth.ts`, `src/convex/auth.ts`, `src/convex/auth/emailOtp.ts`, `src/convex/auth.config.ts`, `src/convex/lib/platformAdmin.ts`, `src/convex/guards.ts`.

**New:** `src/convex/modules/identity/emailGateway.ts`, `src/components/app/AccountSecurity.tsx`, `tests/unit/auth-lifecycle.test.ts`, `tests/e2e/auth-lifecycle.spec.ts`.

**Changes:** Preserve passwordless email OTP unless the owner chooses another sign-in model. Explain “use a new code to sign in” in recovery UI; do not add a reset-password link with no password provider. Implement the accepted email gateway after provider/domain selection. Handle expiry, retry/resend, invalid/reused code, rate limits and provider outage with generic account-enumeration-safe errors. Keep paste/autofill and focus transitions. Validate `returnTo` as a local allowed path. Replace an indefinitely loading auth screen with a recoverable connection error without granting access.

Build step-up authentication/recovery per T2.8 for privileged spending, access changes and irreversible deletion. Admin uses the same identity system plus server-side platform-admin guards; hiding `/admin` is not authorization. Keep operator roles distinct from organization roles. Remove platform toolbar/runtime dependencies only when their replacement paths pass tests.

**Acceptance:** New and returning users finish code sign-in; expired/wrong codes recover; an unavailable backend shows retry; a non-admin cannot call admin functions directly; admin and recovery flows have keyboard coverage. Password/social sign-in, if requested, is a separately specified provider change.

### BP-03 — Stop false publishing and readiness claims

**Existing:** `src/convex/builds.ts` (`update`), `src/convex/buildWorkspace.ts` (`publishSite`), `src/convex/cms.ts`, `src/components/build/BuildWorkspace.tsx`, `src/components/app/module-kit.tsx`, `src/convex/campaigns.ts`.

**New:** `src/shared/contracts/status.ts`, `src/components/app/ReceiptBadge.tsx`, `tests/unit/publish-truth.test.ts`.

**Changes:** Remove public mutation inputs that let clients assert external publication or certified readiness. Separate draft approval, release preparation, deployment progress and verified delivery. `publishSite` should request a deployment through the BP-13 pipeline, not set `site.status = live` after database edits. Until deployment exists, label the action as preparing a release and keep it out of externally published state. Readiness comes from an audit record pinned to the revision and rule version; content changes invalidate it. Apply the same distinction to locally tracked campaigns and provider-running campaigns.

Keep legacy status values readable during migration, but mark unverified legacy resources as requiring verification rather than inventing receipts. Continue serving the last confirmed public release when a new publish fails.

**Acceptance:** A direct client call cannot manufacture live/published/paid/sent states or set SEO/WCAG compliance booleans. Failed deployment leaves the previous release intact. A successful external badge opens the actual receipt or verification record.

### BP-04 — Fix social credentials and token refresh before expanding features

**Existing:** `src/convex/social/{credentials,executor,adapters}.ts`, `src/convex/ads/{credentials,sync,control}.ts`.

**New:** `src/convex/social/credentialActions.ts`, `src/convex/ads/credentialActions.ts`, `tests/unit/social-execution.test.ts`, `tests/unit/credential-refresh.test.ts`.

**Changes:** `social.credentials.getCredId` returns a document, while `social.executor.publishOne` casts it to an ID. Prefer a clearly named internal `getCredential` query with inferred/explicit document return type and use `credential._id`. Update all social call sites and remove the incorrect cast. Do not accidentally change the ads contract: its consumers already use `cred._id`.

Both credential refresh modules perform `fetch` inside `internalMutation`. Move refresh requests to internal actions, with internal queries to load secrets and internal mutations to claim refresh/save tokens. Convert action callers from `runMutation` to `runAction` for the refresh operation. Prevent concurrent rotating-refresh-token requests using a lease/version check, and do not overwrite a newer token response. Redact provider errors. Catch refresh failure at the per-post boundary so one expired account does not abort the entire due-post batch. BP-07 adds durable execution/reconciliation before live posting is considered ready.

**Acceptance:** A stored credential reaches a mocked adapter with the right ID; expired credentials refresh through an action; revoked credentials produce a reconnect state; two concurrent refreshes cannot clobber a newer credential; one failed post does not prevent the next due post. Verify a controlled provider test after configuration, not a real campaign blast.

### BP-05 — Implement the already-decided export/deletion lifecycle

**Existing:** `src/convex/billing.ts`, `src/convex/dal.ts`, `src/convex/lib/dataRegistry.ts`, `src/convex/schema.ts`, `src/convex/crons.ts`, `src/pages/app/Billing.tsx`, `src/pages/admin/AdminPanel.tsx`, `tests/unit/deletion-completeness.test.ts`, T2.5 ticket.

**New:** `src/convex/modules/privacy/{exportJobs,deletionJobs,obligations}.ts`, `tests/unit/account-lifecycle.test.ts`.

**Preserve decisions recorded in T2.5:** 30-day grace period; active finalizer after the grace period; skip and report while a relevant paid subscription remains active; delete only solely owned organizations; preserve organizations with other active members. Do not silently replace this with automatic provider cancellation. Shared organizations need an explicit ownership-transfer/last-owner resolution; preserve them and block unresolved ownership before erasing the user.

**Changes:** Check whether the claimed implementation exists in another commit before restoring it. Make `requestAccountDeletion` create a durable job with effective date, obligations and cancellation option. Replace immediate `deleteAccount` with the same guarded lifecycle, closing the direct mutation bypass. Recheck provider obligations and ownership immediately before finalization. Stale/unavailable subscription verification must block deletion with an actionable reason. Offer a separate explicit Stripe cancellation flow and then retry once its result is confirmed.

Expand the registry to every schema table and dependent blob, including identities/sessions, organizations/memberships, invitations, credentials, jobs and billing records. Respect approved retention requirements rather than deleting financial/audit records indiscriminately. Export only data the requesting user is authorized to receive, excluding tokens and unrelated members' personal data. Chunk work, persist cursors and make retries idempotent. Add the finalizer to `crons.ts` only with the agreed grace and obligation checks.

**Acceptance:** Test free/paid, sole/shared owner, last-owner transfer, cancellation of deletion, overdue job, provider outage, partial batch retry and cross-tenant denial. Active subscriptions block deletion without claiming cancellation. Adding an unregistered table fails CI. Export and deletion enumerate the same registry under different policies.

### BP-06 — Complete billing, independently selectable tools and admin commerce

**Existing:** `src/convex/{billing,billingWebhooks,entitlements,admin}.ts`, `src/convex/lib/{billingCatalog,billingReconcile,capabilities,stripe}.ts`, `src/pages/app/Billing.tsx`, `src/pages/admin/AdminPanel.tsx`, `tests/unit/{billing,entitlements}.test.ts`.

**New:** `src/convex/modules/billing/catalogActions.ts`, `src/components/admin/{CatalogEditor,PromotionEditor}.tsx`.

**PR slices:** (1) provider-backed price display/cancellation; (2) organization-level subscription/add-on mapping; (3) operator catalog/promotions and business statistics.

Remove hard-coded price labels; display amount, currency, recurring interval and tax presentation from a server-side Stripe catalog projection. Bind checkout to an approved catalog version and price ID. If the catalog changes between viewing and buying, show the updated total. Render configuration gaps honestly. Retire local-only `cancelPlan` as a subscription cancellation API. Portal or a server action performs the approved cancellation policy and verifies it; webhook/reconciliation updates entitlement. Cancellation timing/proration/refunds must follow approved commercial policy. [Stripe cancellation semantics](https://docs.stripe.com/billing/subscriptions/cancel).

Keep plan bundles if offered, but represent separately purchased add-ons as subscription items and derive capability grants from the organization's subscription mirror. Do not derive all organization entitlements from one owner's user-level plan. Add explicit organization-scoped grants for support overrides, expiry/reason/audit trail; label them complimentary access, not paid subscriptions. Test an owner with two organizations on different packages.

Admin needs versioned price/package configuration, promotion codes/discount rules, usage limits, validity dates and provider receipts. Archive old catalog versions instead of silently rewriting existing agreements. Show user counts, active subscriptions, recognized billing measures and refunds with definitions, time windows and currency separation; do not invent MRR by multiplying users by a displayed card price. Final prices, taxes and discount rules remain owner decisions.

**Acceptance:** Display matches checkout; duplicate/out-of-order webhooks remain safe; separate organizations do not share purchases unintentionally; add-on purchase/removal changes all server/UI/job gates consistently; expired/restricted promotions fail clearly; cancellation is confirmed externally; non-admin direct calls are denied.

### BP-07 — Jobs, events, receipts and approvals

**Existing:** `src/convex/schema.ts`, `src/convex/crons.ts`, `src/convex/ads/control.ts`, `src/convex/social/executor.ts`, `src/convex/lib/capabilities.ts`.

**New:** `src/convex/modules/platform/{jobs,events,receipts,approvals,actionRegistry}.ts`, `src/shared/actions/contracts.ts`, `src/components/app/{JobProgress,ApprovalGate}.tsx`, `tests/unit/job-execution.test.ts`.

Implement section 4's claim → action → receipt protocol once. The ads path already has an idempotency-key field; ensure it actually gates concurrent execution and reaches providers that support it. Persist outbox events in the transaction that changes domain state; consumers dedupe via inbox records. Add bounded backoff, cancellation, lease recovery, dead letters and operator replay. Replay must preserve the logical operation ID.

Approval is a review of a concrete payload, account, audience, amount and revision, not a generic permission checkbox. Scheduling a post can capture approval of its exact future send; editing content after approval invalidates it. Recheck permissions and entitlement at execution. Distinguish provider acceptance from actual completion—for example, asynchronous publication processing is not yet a published post.

**Acceptance:** Concurrent click/cron executions issue at most one intended logical operation; timeout after provider success reconciles safely; late workers cannot overwrite a newer result; stale approvals cannot execute; capability removal prevents queued writes; event loops stop and appear in dead letters.

### BP-08 — One connection framework, real account selection and recovery

**Existing:** `src/convex/connections.ts`, `src/convex/ads/{oauth,credentials,platforms}.ts`, `src/convex/social/{oauth,credentials,platforms}.ts`, `src/convex/http.ts`, `src/pages/app/{Grow,Promote}.tsx`.

**New:** `src/convex/modules/connections/{registry,oauth,credentials,sync}.ts`, `src/components/app/ConnectionWizard.tsx`.

Implement distinct configuration, authorization, account selection, verification and sync states. Derive UI and available actions from the server registry, supported scopes and selected account. `beginAuthorization` must return a real authorization URL when OAuth is supported; non-OAuth providers need their actual server-side setup flow. Unsupported/unconfigured providers show setup guidance rather than a permanently disabled authorizing button.

Bind expiring single-use OAuth state to user, organization, project, provider and redirect target; apply PKCE where appropriate. Validate account access and scopes after exchange, and again before sensitive writes. Refresh and revoke in actions. Store tokens through the approved vault/encryption design; never ship tokens to components, model context or public projections. Handle canceled consent and lost scopes. A background callback uses a validated state-bound internal authorization path, not an assumed interactive session.

**Acceptance:** Wrong-tenant callback/state replay fails; user can choose among accounts/properties and recover from no accounts; expired/revoked credentials lead to reconnect; first sync records actual data/freshness; disconnect stops jobs and honors the historical-data policy.

### BP-09 — Grounded AI through one gateway

**Existing:** `src/convex/{ai,personaChat,buildPlan,buildChat,sellAI,research}.ts`, `src/convex/{ads,social}/copilot.ts`, `src/convex/guards.ts` (`actionProjectSnapshot`), `src/lib/vly-integrations.ts`.

**New:** `src/convex/modules/ai/{modelGateway,contextPack,runs}.ts`, `src/convex/agents/<agentId>/prompt.v1.ts`, `src/components/app/ContextInspector.tsx`, `tests/ai/`.

Preserve current server-side context loading. Find all actual model call sites with search; route them through the gateway rather than trusting an old count. OpenRouter can be an adapter, not a parallel path with different authorization. Every request declares agent/prompt version, output schema, budget and context refs/versions. Separate extraction, generation and tool execution. Enforce action selection and permissions outside the model. Scraped/provider/uploaded text is untrusted data even when it sounds like an instruction.

Validate structured output, cited evidence IDs and numeric claims. Bound repair attempts and budget; record failures and partial outcomes. Store safe run metadata with retention rules, not unrestricted prompts containing customer secrets. Suggestions may create drafts; external publication/spend uses BP-07. Explain source gaps and assumptions; persona conversations are labeled simulations.

**Acceptance:** Foreign-tenant context and client-forged project snapshots are rejected; injection text cannot change tools/arguments or expose secrets; every run is metered and traceable; invalid output cannot become published content. Establish evaluation datasets/floors from `07-ai-agent-config.md`, clearly distinguishing proposed quality targets from measured results.

### BP-10 — Accurate ingestion and transparent research

**Existing:** `src/convex/{scraping,research,projects,files}.ts`, `src/convex/lib/safeFetch.ts`, `src/components/app/{NewProjectWizard,ProjectFiles}.tsx`, `src/pages/app/Understand.tsx`, `src/pages/app/Create.tsx`.

**New:** `src/convex/modules/base/{sources,facts,ingestionJobs}.ts`, `src/components/app/{SourceReview,ResearchStatus}.tsx`, `tests/unit/source-provenance.test.ts`.

Split the pipeline into discover → extract → normalize → match entity → user review → confirm → version. Website crawl has bounded pages/bytes/time, canonical URL handling, SSRF-safe redirects, dedupe and clear partial coverage. An extracted heading is not a verified company fact. Return multiple Google Business matches with address/domain/place ID for confirmation instead of silently taking the first hit. Distinguish business, competitor and social-profile sources. Use supported APIs/permissions for platform data; do not promise private profile access through scraping.

Return research envelopes with provider, status (`ok`, `empty`, `needs_setup`, `rate_limited`, `failed`), hits, retrievedAt and safe error category. Do not `.catch(() => [])` away every problem. Replace the keyless YouTube HTML-as-JSON path with a supported collector or an explicit unavailable state; transcripts need a supported retrieval/licensing route, not assumed access. Retain provenance through content generation, not just a URL in a temporary UI list.

Corrected facts create a new version and flag dependent drafts/recommendations as stale. Do not silently rewrite published material. Keep raw source snapshots only under an approved retention/content-rights policy; excerpts/hashes may suffice.

**Acceptance:** Fixture sites with conflicting facts, blocked pages, malicious redirects and same-name businesses produce the right uncertainty/review state. Missing API key, no results, timeout and rate limit look different. A corrected address propagates to the next generation and flags older outputs. Run extraction quality evaluation on reviewed real business examples; do not certify accuracy from schema validity.

### BP-11 — Complete projects, personas, content and journey maps

**Existing:** `src/convex/{projects,personas,journeys,content,contentPlanning,communications}.ts`, `src/pages/app/{Understand,Journeys,Create,Overview}.tsx`, `src/components/app/{NewProjectWizard,PersonaChat,ContentEditor,RelationMap}.tsx`.

**New:** `src/convex/modules/base/contextRefs.ts`, `src/shared/refs/contracts.ts`, `tests/e2e/base-journey.spec.ts`.

Turn wizard output into confirmed context with a visible review step. Personas link needs/pains/claims to facts or labeled assumptions. Journey stages store goals, actions, touchpoints, obstacles, happy-path criteria, evidence, linked content and measurable outcomes. Gap detection must distinguish missing content from weak evidence or observed performance loss. Keep journey/content references stable so website/app/ad/social/CRM work can consume them through the shared resolver.

Support brand voice/assets, locale/channel variants, approval, version history, collaboration conflict behavior and export. Inline AI offers a proposed draft/diff and undo, without overwriting approved work. Overview should show actual project readiness and one useful next action based on missing prerequisites, rather than treating the existence of rows as task completion.

**Acceptance:** From a reviewed business source, a user creates an evidence-linked persona, journey and approved content; a module can reuse their exact versions. Deleting/disabling an optional partner leaves a meaningful fallback. A generated assumption is never relabeled as customer research.

### BP-12 — Measurement and growth recommendations

**Existing:** `src/convex/{connections,insights,schema}.ts`, `src/pages/app/Grow.tsx`, `src/convex/ads/sync.ts`, `src/convex/commerceEvents.ts`.

**New:** `src/shared/contracts/measurement.ts`, `src/convex/modules/grow/{observations,recommendations,trackingHealth}.ts`, `src/convex/modules/grow/adapters/{ga4,gsc,matomo,posthog}.ts`, `src/convex/modules/measurement/{collector,forwarders}.ts`, `src/components/measurement/ConsentControls.tsx`.

**PR slices:** (1) event/consent contract; (2) GA4/GSC account selection and ingestion; (3) Matomo/PostHog; (4) GTM installation/diagnostics and provider forwarders; (5) evidence-backed recommendations.

Specify canonical events for page view, lead, content interaction, cart, checkout and provider-confirmed purchase, including tenant/site, event ID, event time, consent snapshot and allowed fields. Do not put personal data into analytics URLs or arbitrary event parameters. GTM is a tag-management installation path, not an analytics observation source equivalent to GA4. Avoid double-installing direct and GTM tracking. Consent behavior and retention must be reviewed for chosen jurisdictions; implementation must enforce the approved policy before loading optional trackers.

Import metrics with property/account, timezone, currency, attribution model/window, dimensions, timestamps and pagination cursors. Handle late revisions and partial windows. Keep ad-reported conversions distinct from commerce-confirmed revenue. Never sum incomparable currencies or double-count the same purchase across providers. Manual insights remain allowed but labeled manual, even when the user mentions GA4.

Recommendations cite observation IDs, exact windows and reproducible calculations; unavailable data reduces confidence or blocks the claim. Route suggested changes to the owning module's action registry for review. Record before/after measurement without claiming causal lift from mere correlation.

**Acceptance:** Approved denied-consent policy yields no forbidden tracking requests; one order yields the intended deduplicated event per destination; repeated imports do not double metrics; revoked access/stale data are visible; every numeric recommendation reproduces from stored observations; the module works with only its connected analytics sources.

### BP-13 — Public website, CMS, SEO and accessibility

**Existing:** `src/main.tsx`, `src/convex/{storefront,cms,buildWorkspace,buildInternals}.ts`, `src/components/cms/{PageEditor,PageRenderer,SitePanel}.tsx`, `src/components/storefront/StorefrontApp.tsx`, `src/lib/cms/`, `WEBSITE-ARCHITECTURE.md`, `CMS-BLOCK-REGISTRY.md`.

**New:** `src/convex/modules/buildWebsite/{publicProjection,deployments,domains,audits,forms}.ts`. Public renderer entry/build layout is chosen in the hosting ADR; do not introduce another framework by assumption.

**PR slices:** public projection → deployment/domain verification → CMS completeness → generated-page quality → export parity.

Create a minimal, published-only projection resolved by verified public hostname/site ID and immutable release. Serve crawlable HTML on a separate registrable domain from the dashboard. Keep editor/admin queries protected. Signed preview URLs are scoped, expiring, noindex and separate from public caching; possession of a project ID must not expose drafts. Public pages must not require a shopper to hold MOSAI's Build/Sell capability.

Deploy immutable artifacts through the approved hosting adapter, check the target URL and TLS, save the receipt, then switch the active release. Rollback restores a known release. Domain claims require verified ownership and prevent tenant takeover/rebinding. CSP must be delivered as actual response headers where needed, including frame protections; do not assume a meta tag provides every directive.

Complete CMS navigation, page hierarchy/slugs, redirects, reusable blocks, content types, media/alt text, responsive images, revisions/review/scheduling, localization/hreflang and forms with spam protection and consent evidence. Keep Tiptap and the composed CMS per ADR-4; do not add a separate headless-CMS database without an approved architecture change. Forms emit authorized events consumed optionally by Customers; standalone sites need a real submission destination.

Generate canonical URLs, titles/descriptions, robots rules, sitemap and truthful structured data. Validate links and public HTML without JavaScript. Provide evidence-rich content for discoverability, but never promise rankings or AI-answer inclusion. Audit the generated revision: keyboard navigation, focus/labels, contrast, reflow, target sizes, drag alternatives, reduced motion, media alternatives and errors. Automated axe is one check, not a WCAG certification. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

**Acceptance:** An incognito visitor views the correct tenant's published pages with JavaScript disabled; cannot view drafts or dashboard storage; bad publish preserves old site; custom-domain verification and rollback work; a complete keyboard form journey works; exported site content matches the release and has documented backend limitations.

### BP-14 — Commerce, public feeds and Shopify integration

**Existing:** `src/convex/{products,variants,media,collections,storefront,shopifySync,commerceEvents}.ts`, `src/convex/sell/{queries,feed,readiness}.ts`, `src/pages/app/Sell.tsx`, `SELL-ARCHITECTURE.md`.

**New:** `src/convex/modules/sell/{connect,checkout,orders,payments,inventory,fulfillment,refunds,feeds,shopify}.ts`.

**PR slices:** merchant setup/catalog validation → checkout/order/payment → fulfillment/refunds/subscriptions/digital delivery → public feed submission/diagnostics → per-store Shopify sync.

Keep the approved Stripe Connect direction; confirm the precise account/charge model and supported markets before implementing money movement. Separate merchant transactions from MOSAI subscription billing. Server computes prices, discounts, stock, currency and shipping/tax through approved policies; browser input never determines amounts. Checkout uses a durable cart/order snapshot, provider idempotency and verified webhook completion. Add inventory reservation/release, partial fulfillment/refunds, failed/disputed payment and reconciliation. Do not claim payment from a success URL.

Serve XML/other required feed formats through public endpoints with stable URLs, correct variants/identifiers/prices/availability and update timestamps. A generated XML string in a private query is not a usable merchant feed. Report external feed acceptance/rejections separately from local validation.

Shopify credentials and cursors are scoped to the selected store/project. Define authoritative fields, webhook verification, conflict resolution and safe disconnect. Do not restore the disabled deployment-global Shopify sync. Honor the standalone Sell contract with a hosted checkout/feed even without a MOSAI-built site.

**Acceptance:** Signed-out test buyer completes an actual test checkout; forged/duplicate webhook cannot create payment; concurrent buyers cannot oversell; refund/fulfillment reconcile; feed fetch and provider diagnostics are recorded; one tenant cannot sync or buy against another tenant's private catalog; customer marketing consent is separate from purchase.

### BP-15 — A real application builder

**Existing:** `src/pages/app/Build.tsx`, `src/components/build/BuildWorkspace.tsx`, `src/convex/{builds,buildChat,buildPlan,buildWorkspace}.ts`. Preserve website generation here while separating app behavior.

**New:** `src/convex/modules/buildApp/{projects,sourceGraph,buildJobs,snapshots,deployments,exports}.ts`, `src/convex/modules/buildApp/sandboxRunner.ts`, `src/components/build/AppWorkspace.tsx`.

Do not represent an app as only a CMS PageDocument. Add a source-file graph, dependency manifest, runtime/build settings, backend schema/contracts, secrets references, test results and immutable snapshots. Use the ADR-3 sandbox-provider spike; selection and deployment require approval. No generated code executes inside the dashboard origin or with MOSAI master credentials. Sandboxes have scoped credentials, isolated filesystem/runtime, bounded resources, controlled egress, artifact scanning and teardown.

Implement plan → reviewed requirements → source changes → install/build/test → bounded repair → preview → approved deploy → verification/rollback. Visual edits and chat operate on the same versioned source. Handle source-control conflicts rather than overwriting user commits. Provide backend provisioning/migrations, authentication, data access and integrations through explicit project-scoped contracts. Export source plus dependency lockfile, schema/migration assets, environment-variable names and a backend portability explanation; exclude secrets. Meter model and sandbox cost before and during long jobs.

Resolve where customer backends live and what remains functional after export before claiming portability. Use confirmed persona/content/journey/analytics context to improve requirements, with traceable recommendations and no hidden access to other projects.

**Acceptance:** A representative CRUD/auth/integration app builds, runs, persists data, enforces tenant ownership, deploys and rolls back; export runs in the documented clean environment; malicious generated code cannot reach metadata/internal networks/secrets; cost limits pause work; source edits survive round trips. Define a dated, evidence-backed competitor parity matrix rather than promising “everything Lovable does” without bounded requirements.

### BP-16 — Real ad campaign creation and safe optimization

**Existing:** `src/convex/ads/{adapters,platforms,oauth,sync,control,copilot}.ts`, `src/convex/campaigns.ts`, `src/pages/app/Promote.tsx`.

**New:** `src/convex/modules/promoteAds/{campaignDrafts,readiness,creationJobs,conversionSetup}.ts`, `src/components/promote/AdCampaignWizard.tsx`.

Replace Google throw stubs with verified account discovery, campaign reporting, metric pagination and writes using a supported API version, developer token and correct manager/customer context. Extend the adapter contract beyond pause/resume/budget: draft validation, campaign/ad-group/creative/targeting creation, conversion destination and status reconciliation. Begin new test campaigns paused. Record partial resources and compensation/recovery when a multistep creation fails. [Google Ads official introduction](https://developers.google.com/google-ads/api/docs/get-started/introduction).

Simple mode asks outcome, audience/location, destination, budget and creative review; advanced configuration remains available. Prefill confirmed business context, brand and assets. Validate landing URL, conversion tracking, budget currency, account permissions and provider policies. Never activate spend merely because AI produced a plausible campaign. Apply approval to exact budget/audience/creative/account; enforce limits at execution.

For Meta and TikTok, validate current API versions, fields, token exchange, scopes, account access, units and rate-limit behavior through contract fixtures plus approved test accounts. Treat ChatGPT/OpenAI Ads as unavailable until official advertiser documentation, access and a successful test prove the specific operations; delete guessed endpoints rather than ship them as support. This blueprint does not assert current access availability.

**Acceptance:** Each advertised provider supports connect → select account → validate → create paused campaign → approved activation/change → metrics → pause/revoke. Failure after partial creation is recoverable without duplicates. Recommendations match actual source windows; no unexpected spend or unsupported currency conversion occurs.

### BP-17 — CRM, email and marketing automation

**Existing:** `src/convex/contacts.ts`, `src/convex/communications.ts`, `src/pages/app/Customers.tsx`, `src/convex/schema.ts`.

**New:** `src/convex/modules/customers/{imports,segments,consent,suppression,timeline,pipelines,automation,email,webhooks}.ts`, `src/components/customers/{ContactDetail,SegmentBuilder,AutomationBuilder}.tsx`.

**PR slices:** contact/import/consent → email sending/feedback → deterministic segments → automation engine → pipeline/inbox/reporting.

Add import mapping/preview/deduplication, contact timeline, companies, deals/stages/tasks and permissioned search/export. Record consent provenance and changes per channel/purpose; a mutable boolean is insufficient for the workflow. Add suppression, unsubscribe, bounce/complaint processing and authorized contact erasure. Choose the email service/sending domain before provider integration; validate sender authentication and send readiness.

Automation definitions are versioned graphs with schema-validated triggers, conditions, delays and actions. Instances use BP-07 jobs, not frontend timers. Check current consent/suppression immediately before every send, not only when the workflow begins. Support stop/pause, timezones, re-entry/dedupe rules, frequency limits, test mode and per-step receipts. Changes to live automations require an explicit policy for running instances. Provider delivery/open/click events have distinct meanings; do not claim delivery or reliable human engagement from send acceptance alone.

Connect site submissions and orders through events; keep manual/CSV/hosted-form paths for standalone use. Use analytics as optional evidence without making unsupported assumptions about individual identity.

**Acceptance:** Imported duplicate contacts are handled predictably; unsubscribing during a delay prevents the send; duplicate trigger/webhook causes no extra message; suppressed/erased contacts stay excluded; test automation completes with provider receipts; stopping a workflow prevents future actions; CRM roles protect records and exports.

### BP-18 — Social publishing, comments and reporting

**Existing:** `src/convex/posts.ts`, `src/convex/social/{adapters,executor,oauth,copilot}.ts`, `src/pages/app/Promote.tsx`.

**New:** `src/convex/modules/promoteSocial/{mediaJobs,inbox,comments,insights}.ts`, `src/components/promote/{PublishingCalendar,SocialInbox}.tsx`.

After BP-04/BP-07/BP-08, complete platform-specific text/media limits, upload/processing states, timezone scheduling, approval, preview, edit/cancel and per-destination outcomes. A multi-platform post may partially succeed; retain each receipt and retry only failed destinations. Reconcile asynchronous publish IDs with final public posts before marking published.

Add comment/inbox ingestion and replies only for providers/accounts with verified supported APIs and permissions. Deduplicate webhook/polling observations; associate replies with the correct account and thread. AI proposes replies for review; apply exact approved content through registered actions. Show unsupported operations plainly. Import social metrics with definitions and freshness into Grow rather than inventing aggregate engagement.

**Acceptance:** Approved test post schedules and appears on the intended account; restart/timezone/expiry cases recover; partial multi-platform failure does not duplicate successful posts; revoke prevents queued send; supported comment reply appears in its original thread; unsupported inbox capabilities do not show working controls.

### BP-19 — Make the power understandable

**Existing:** `src/components/app/{AppShell,module-kit,NewProjectWizard,RelationMap}.tsx`, `src/pages/app/{Overview,Understand,Journeys,Create,Build,Sell,Promote,Customers,Grow,Billing}.tsx`, `src/index.css`, `src/pages/DesignSystem.tsx`, `src/components/motion.tsx`.

**New:** `src/components/app/{NextAction,EvidenceDrawer,SetupChecklist}.tsx`.

Apply the existing Do → Review → Configure pattern. Each screen explains the outcome, shows one clear recommended next action, provides the workspace, and makes evidence/history available on demand. Derive setup checklists from real missing prerequisites. Reuse known business information and ask only for missing facts. Keep advanced settings reachable; fewer visible controls must not mean lost capability.

Connect context corrections, AI previews, undo, jobs and receipts across modules. Empty/loading/error/partial/locked/unavailable states must each offer a real next step. Differentiate “draft prepared”, “awaiting approval”, “provider processing” and “published”. Do not use animation to obscure slow/failing requests. Keep design tokens, keyboard focus, reduced motion, responsive reflow and accessible names. Extract large page components when touched, without bundling unrelated redesign.

**Acceptance:** Run observed sessions with at least five representative nontechnical users as an initial formative sample, not statistical proof. Proposed benchmark: at least four finish each core test task without moderator intervention; zero critical misinterpretations of paid/live/connected states; record time, errors, help requests and confidence. Use the existing proposed 5-minute project/10-minute useful-output targets as measurements, not promises. Fix observed blockers and repeat affected tasks on mobile and desktop.

### BP-20 — Operations and release proof

**Existing:** `.github/workflows/ci.yml`, `package.json`, `scripts/`, `tests/unit/`, `tests/e2e/`, `docs/runbooks/`.

**New:** `docs/release/readiness-matrix.md`, `docs/runbooks/{provider-outage,restore,public-deploy-rollback}.md`, module-specific unit/contract/browser suites.

Define safe logs, correlation IDs, provider latency/error metrics, queue age, uncertain outcomes, entitlement drift and cost alerts. Implement backup/restore and prove recovery in an isolated environment; choose RPO/RTO with the owner rather than claiming arbitrary numbers. Document provider outages, credential revocation, deploy rollback and incident ownership. Europe-focused positioning requires actual decisions/evidence for processing regions, subprocessors, retention and portability; a UI label is not a residency guarantee.

Use existing documented gates: `bun run check`, `bun run test:e2e`, `bun run test:a11y`, `bun run check:codegen` and the repository build script. For Convex changes, run documented codegen/dev verification only against the authorized development deployment. Never edit `_generated` manually. New module-alone/pairwise/removal, registry and AI-eval checks are proposed additions: implement and document them before treating them as established gates.

Every release proof row records exact commit, environment, user role, input fixture, expected/actual result, receipt/artifact, test time and unresolved limitations. Redact credentials and personal data from screenshots/traces. Keep browser contract mocks separate from real-provider proof. A fixture returning `ok` is not a verified integration.

## 6. Integration verification matrix

Provider configuration values belong in the approved secrets system, not in the repository, reports or chat. Before coding an adapter, pin its official contract/version and record the test-account restrictions. Only providers whose required journey passes may be advertised as operational.

| Provider/group | Code entry point | Proof required |
|---|---|---|
| SerpApi: Maps, news, Trends, YouTube | `scraping.ts`, `research.ts` → BP-10 source adapters | Correct entity, supported engine/schema, usable source citations, rate-limit and missing-key states. |
| Wikimedia/Wikibooks, GDELT, NewsAPI, Reddit | `research.ts` → BP-10 | Supported access method and content-use policy, fixtures + real sample, timestamps, empty/error distinction. |
| OpenRouter/AI providers | `ai.ts`, `buildChat.ts`, copilots → BP-09 | Structured output, cost accounting, residency/privacy choice, grounded evaluation; no direct feature SDK bypass. |
| Email identity and marketing | `auth/emailOtp.ts`, BP-17 | Approved provider/domain, delivery and bounce/complaint handling; distinct OTP versus marketing policy. |
| Stripe platform billing / Connect commerce | `billing.ts`, BP-14 | Separate account contexts, verified events, retries, cancellation/refund proof and reconciliation. |
| Google Ads / Meta / TikTok | `ads/` → BP-16 | Account/scopes, actual paused creation, authorized changes and metrics with correct units. |
| OpenAI/ChatGPT Ads | `ads/platforms.ts`, `ads/adapters.ts` | Official advertiser contract and access first; no inferred endpoints/scopes. |
| GA4 / GSC / Matomo / PostHog | `connections.ts` → BP-12 adapters | Real property selection, ingestion, window/unit semantics, freshness/revocation. |
| GTM | BP-12 installation/collector | Approved tag configuration, consent behavior, no duplicate direct installation, diagnostics. |
| Facebook / Instagram / LinkedIn / X / TikTok organic | `social/` → BP-18 | Per-platform publication/processing receipt; comment/reply availability verified separately. |
| Shopify | `shopifySync.ts` → BP-14 | Per-store tenancy, webhook auth, authoritative field mapping and safe conflict/retry behavior. |
| Site host / sandbox / app backend | BP-13 and BP-15 interfaces | Selected providers, region/isolation, public URL, ownership, rollback and export proof. |

## 7. Migrations, rollout and rollback

1. Add new tables/optional fields and readers that understand old/new records. Register each table and add indexes before enabling its jobs.
2. Backfill in bounded idempotent batches with checkpoints, a dry-run summary, verification counts and tenant-level failure reporting. Obtain explicit approval before data migration or destructive operations.
3. Migrate credentials through server-only routines with encryption/version metadata; never dump plaintext into export files or logs. Test rotation/revocation in a non-production environment.
4. Run new projections in comparison mode where safe. Do not dual-execute external sends, charges, publications during migration.
5. Enable the new path only after its tests and authorized provider smoke journey pass. Monitor drift and uncertain outcomes.
6. Rollback routes/projections to the last compatible version and pause new jobs. Keep receipts and new records for reconciliation. Rollback cannot unsend an email, unspend money or restore erased data automatically; document compensating operations separately.

## 8. End-to-end acceptance scenarios

| ID | Scenario | Pass evidence |
|---|---|---|
| J01 | New user registers/signs in, loses/refreshes code, signs out and returns | Real test inbox delivery, recovery/error behavior, keyboard evidence. |
| J02 | Admin signs in and manages users/catalog/promotion | Server role checks, audited changes, provider-backed prices and correct denied access. |
| J03 | Customer subscribes, adds/removes a tool, changes plan and cancels | Exact displayed/charged terms, provider receipts and reconciliation. |
| J04 | Business URL + ambiguous Business Profile + competitor sources | Reviewed matching, provenance, correction and visible partial scrape failure. |
| J05 | Persona → journey happy paths/gaps → researched content | Evidence and assumptions distinguishable; approved versions reusable. |
| J06 | Website built, edited, published, visited by a stranger | Separate public origin, crawlable HTML, valid forms, metadata and accessibility tests. |
| J07 | Products/variants → public feed → test order → refund | Provider acceptance where applicable, stock/payment/order reconciliation, receipt chain. |
| J08 | Full-stack app generated → tested → deployed → exported | Running backend/auth, isolated execution, reproducible export and rollback. |
| J09 | Analytics connects and yields a recommendation | Actual observations, correct calculations, reviewed action and subsequent measurement. |
| J10 | Ads account → paused campaign → approval → controlled activation/change | Real resource IDs, spend boundaries and metrics, no unapproved activation. |
| J11 | Social draft → approval → schedule → post → comment reply | Per-provider receipts, failure recovery and no duplicate send. |
| J12 | Contact opt-in → segment → delayed automation → unsubscribe | Consent timeline, provider event and proof suppression prevents later sends. |
| J13 | Cancel/deletion request → 30-day policy → obligations resolution | Active subscription/shared-ownership block, user-visible reasons, complete registered cleanup after resolution. |
| J14 | Each module alone, each useful pair, remove one mid-flow | Other tools remain usable; unavailable references have safe fallbacks; no cross-module raw-table dependency. |
| J15 | Foreign tenant, revoked role, malicious source, provider timeout | No data leak or external side effect; recoverable visible errors and preserved drafts. |

Tests must cover loading, empty, failure, partial, success, locked and setup-required states. Run generated public sites separately from the dashboard. Do not substitute an unauthenticated `/app` redirect for authenticated module accessibility coverage.

## 9. Decisions and constraints register

### Recorded decisions to preserve

- Bun is the package manager; committed Convex bindings and strict checks remain.
- Convex is canonical; compose the CMS from existing primitives per ADR-4.
- Stripe Connect is the chosen commerce direction; MOSAI platform subscriptions are distinct.
- Plans/prices are not final; never infer final terms from hard-coded UI cards.
- T2.5 records 30-day deletion grace, active finalizer, skip/report on active subscription and preservation of shared organizations. Reconcile missing implementation; do not re-decide policy implicitly.

### Owner input required before dependent implementation

| Decision | Why needed | Work that can proceed first |
|---|---|---|
| Final packages, add-on terms, prices, cancellation/proration/discount rules | Changes commercial agreements | Catalog abstraction, reconciliation tests and admin authorization. |
| Keep passwordless only or add password/social providers; approved email service/domain | Determines actual recovery and delivery | Existing OTP error/focus/rate-limit tests and gateway interface. |
| Launch countries/languages and specific EU data requirements | Governs localization, provider availability and processing commitments | Locale-ready UI, provider capability matrix and data inventory. |
| Public customer domain and site-host deployment adapter | Needed to verify real publication and isolation | Published-only projection, immutable releases and renderer tests. |
| App sandbox/backend host and portability promise | Needed for real app execution/export | Source graph, runner interface, budgets and adversarial test specification. |
| Precise Connect model and merchant tax/shipping/refund requirements | Determines seller transaction flows | Catalog/readiness, test webhook infrastructure and order state model. |
| Provider app approvals, scopes and test accounts | Code cannot grant external access | Contract fixtures, missing-setup states and adapter implementation. |

Do not block all work on these decisions. Keep only dependent operations pending. No passwords/API keys should be requested in plaintext conversation.

## 10. First implementation assignment

Start with **BP-01 baseline/document reconciliation**, then **BP-04 credential handoff and refresh**, then **BP-03 truthful publishing**, while preparing BP-05 from the already-recorded decisions. These are bounded, demonstrable changes; they do not justify declaring whole modules complete.

Use this handoff for each ticket:

> Implement only the selected BP package/PR slice against the current MOSAI branch. Read AGENTS.md, this blueprint, the mapped existing ticket and module contracts. Verify the audited defect is still present. Preserve unrelated work. Show a regression failing before the fix; implement the smallest coherent change; test public authorization, failure/retry and tenant isolation. Run documented checks and development-only codegen when required. Update the readiness matrix with exact evidence and remaining blockers. Do not push, deploy, operate on production or select unapproved providers. Do not replace missing backend behavior with successful UI state. Stop only when the selected ticket's acceptance criteria pass or a specific dependency is demonstrated and recorded.

## 11. Sources and verification boundary

Primary code source: GitHub commit linked at the top. Baseline CI: [run 35790335737](https://github.com/julekpl/Mosai-friday/actions/runs/35790335737). Local supporting report: `MOSAI-READINESS-AUDIT-2026-09-23.md`.

Architectural grounding: existing `AGENTS.md`, current backlog and tickets, plus workspace `04-adrs.md`, `05-design-system.md`, `07-ai-agent-config.md`, `08-module-contracts.md`. Current technical references checked for this blueprint: Convex actions, Stripe cancellation, Google Ads introduction and WCAG 2.2, linked near their guidance. Other provider contracts must be verified during their implementation tickets; no unsupported API or competitor-parity claim is assumed here.

This blueprint specifies how to reach a working product. It is not evidence that the work, deployment, integration verification, legal review or user testing has already occurred.
