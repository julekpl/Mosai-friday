# MOSAI MVP: Freebuff execution blueprint

**Prepared:** 24 September 2026. **Purpose:** a chapter-by-chapter implementation handoff for Freebuff, grounded in the current development repository. This is an execution map, not a replacement for [`../MOSAI-IMPLEMENTATION-BLUEPRINT.md`](../MOSAI-IMPLEMENTATION-BLUEPRINT.md), [`PROGRESS.md`](PROGRESS.md), [`DEFERRED-WORK-BACKLOG.md`](DEFERRED-WORK-BACKLOG.md), the BP reports, or `AGENTS.md`. Recheck those files and the current code at the start of every chapter; this snapshot will age.

The owner wants a genuinely usable, simple self-service marketing operating system: sign in; build a shared project, persona, journey and content from trustworthy sources; choose modules; then operate a website/store, app, ads, CRM/automation and social publishing with connected measurement. A module must work on its own and improve with shared context. **Never call a mock, saved draft, local render or optimistic callback “live”, “connected”, “sent”, “paid” or “published”.** Show what the user can do next when a provider or setup is unavailable. Do not reduce the product vision to a polished façade.

## 1. What is actually available now

The last reviewed GitHub development baseline was `f3848a3cd7122eb528ff419c33c748d2e1dc5942`. Its [CI run 35986095558](https://github.com/julekpl/Mosai-friday/actions/runs/35986095558) passed install, codegen drift, typecheck, lint, unit, browser E2E and accessibility jobs; **both secret-scan jobs failed**. A local `bun run check` also exited 1 on a finding in tracked `.env.keys` (line 8); do not print or copy the value. The release gate is blocked until the owner remediates the exposed secret and history. Never treat passing individual jobs as a green combined gate.

The [Freebuff preview sign-in](https://old-paths-carry.freebuff.dev/auth) currently fails to send an email code. The observed Convex error is `EMAIL_OTP_API_KEY is not configured`, raised by `src/convex/auth/emailOtp.ts`; a customer **cannot yet be verified to log in on the preview**. The current flow is email OTP, so a password-reset journey is not applicable unless the owner changes the sign-in model. Browser `Permissions-Policy` and `html2canvas` tracking-prevention warnings did not cause the OTP error. The missing `/logo.png` manifest icon is a separate small defect.

`PROGRESS.md` records BP-01–05 and BP-09/S1–S2 as `implemented_unverified`, not release-complete. BP-06/S1, BP-07/08/10/11/12/S1/14/S1/15/S1/17/S1/19 have bounded or partial work. BP-13/S1 is listed `not_started` in the shared ledger; there is an **uncommitted Codex draft** in a separate checkout, so Freebuff must not start overlapping BP-13/S1 files until the controller reconciles it. Most later provider and end-to-end slices remain unstarted. Use the ledger for exact, current per-slice status rather than inferring completion from UI screens.

Freebuff's Vly environment may block Git commands and automatically manage its main-based versions. That means a Freebuff version name is not proof that its entire file tree matches GitHub. Before editing, compare the targeted files and their non-secret hashes with the controller's exact GitHub commit, and disclose any uncertainty. Do not ask Freebuff to bypass Vly's Git restriction. Do not overlap files another agent is editing.

## 2. The minimum evidence for “working”

| Evidence level | What it proves | Examples of acceptable evidence |
|---|---|---|
| Implemented | The code path exists and focused tests pass | Exact files, red-first regression where fixing a defect, test command and result |
| Configured | The required **server-side** environment or owner decision is present | Setting name and target deployment confirmed without revealing its value |
| Connected | The external service accepted auth and a scoped read/write | Test-account identity/scope, receipt or verified callback, redacted logs |
| Operational | A nontechnical person completes the journey in an authenticated browser | Start-to-finish steps, mobile and keyboard checks, empty/error/retry states |
| Release-ready | Exact revision passes the full gate and operator checks | Green exact-SHA CI including secret scans, provider receipts, rollback/restore evidence |

Every chapter report must say which level was reached. “Implemented” is useful progress; it is not an operational customer outcome. No test account, provider key, domain or legal/payment policy may be invented to close a gap.

## 3. Owner decisions already made and decisions still needed

Preserve these decisions: use the **Stripe test catalog** for package labels and prices; cancellation retains paid access through the billing-period end; an account deletion has a 30-day grace period, blocks active subscriptions, respects shared-organization ownership and retention; the first EU/EEA release is **English only** (other languages in later owner-requested phases); customer-facing and internal app outcomes have equal priority, with the audience explicitly selected. Do not silently reinterpret these.

The following remain decision or environment gates, not invitations to guess:

| Gate | Needed before | Owner question or action |
|---|---|---|
| O2 | Real OTP and CRM email sending; privileged step-up | Choose/reissue an email provider and verified sending domain; decide the privileged step-up policy. A previously exposed OTP key must not be reused. |
| O4 | Public website origin and live domain proof | Approve a public registrable domain separate from the dashboard and a hosting/domain verification path. |
| O5 | Executable app preview/deploy/export promise | Choose sandbox runner, backend host and portability boundary. |
| O6 | Real commerce money movement | Decide Connect account ownership, tax, shipping, refunds and seller responsibility. |
| O7 | Provider integration proof | Supply approved **test** accounts, OAuth scopes/API access and receipt-safe test data. Do not paste credentials into chat. |
| Operations | Release | Set recovery point/time objectives and approve secret remediation, restore and incident runbooks. |

While a gate is unresolved, implement only reversible interface/contract/tests that do not require assuming its answer. Report the exact blocker and move to an independent chapter if appropriate.

## 4. Chapter queue: one bounded slice, one new Freebuff chat

The table is an **ordered working queue**, not permission to merge unrelated code. The next chat handles one row or a smaller testable slice of it. If prerequisites remain unverified, record that and limit the result to an honest `implemented_unverified` state. Chapter names retain the blueprint BP IDs so reports and backlog reconcile.

| Priority | New-chat chapter | Customer outcome and acceptance proof | Main prerequisites / boundary |
|---|---|---|---|
| 0 | BP-02 live-auth unblock | A new user receives a real test OTP, signs in, signs out and recovers from expired/wrong code; a non-admin cannot enter admin routes. Test on the actual preview and a dev Convex deployment; never expose codes or keys in reports. | Owner O2; verify secret reaches the **preview backend**. Keep existing OTP model and security checks. |
| 1 | BP-01 security/release truth | Secret is removed from tracked/current/history paths by an owner-approved remediation; exact new revision passes both secret scans and all other required jobs. Do not “skip scan” to mark ready. | Owner-controlled rotation/history action. Freebuff may document/diagnose without handling secret values. |
| 2 | BP-06/S1–S3 and BP-05, one slice per chat | Price display matches Stripe test catalog; checkout/webhooks and period-end cancellation reconcile; organization plan/add-ons/admin catalog and statistics are authorized; export/download and 30-day deletion are usable and tenant-safe. | Real Stripe **test** proof; O2 for privileged admin policy. Keep export and destructive workflows separate from billing edits. |
| 3 | BP-07 then BP-08 then BP-09/S3 | Jobs safely claim/retry/reconcile with idempotency keys and receipts; connections expose truthful setup/refresh/scopes; AI runs are server-owned, metered, versioned and evaluated. | Confirm BP-05 deletion fence and prior BP-09 contracts; do not add a parallel gateway. |
| 4 | BP-10 then BP-11 | A user creates a project, reviews website/social/Google Business/competitor and research sources with provenance, correctable facts and explicit failures; persona, journey map, gap/happy path and reusable content cite approved evidence. | Safe fetching and provider accounts; news/wiki/YouTube/trends/GDELT/Reddit are sources with provenance, not magic completeness. |
| 5 | BP-12/S1–S5, one slice per chat | Server-held consent and a real event contract; opt-in analytics; selected GA4/GSC, Matomo, PostHog and GTM connections; observations link to recommendations with source/time and confidence. | EU/EEA English-first policy; O7 test properties. No optional tracking before consent. |
| 6 | BP-13/S1–S5, one slice per chat | Project-isolated public website on a separate registrable origin; publish/rollback confirmed by deployment; usable CMS pages/navigation/forms/media/revisions; SEO/GEO, WCAG 2.2 AA, feed links and export parity. | Controller must first reconcile uncommitted BP-13/S1 draft. O4 for real domain; avoid “published” on local preview. |
| 7 | BP-14/S1–S5, one slice per chat | Per-project merchant onboarding, correct catalog/inventory, customer checkout/order/fulfillment/refund, diagnostics for product feeds and optional Shopify sync; payment and sync states come from provider receipts. | O6 for money movement, O7 for provider tests, BP-13 public origin for feeds. Existing bounded catalog validation is not checkout. |
| 8 | BP-15/S1–S3, one slice per chat | Both a customer-facing app and an internal tool can be grounded in approved project/persona/content/measurement data, safely generated, inspected, previewed, deployed/rolled back and exported with cost visibility. | O5 for runner/host; current requirements workspace is not an executable app builder. |
| 9 | BP-16/S1–S3, one slice per chat | Clear growth workflow to connect approved Google/Meta/TikTok ad accounts, draft/approve/activate campaigns, and relate actual spend/conversions to data. OpenAI Ads remains unavailable until its documented advertiser API/account-key flow is proven. | BP-07/08 receipts/connections, O7. No guessed OAuth/endpoints or fake activation. |
| 10 | BP-17/S1–S5, one slice per chat | Import and deduplicate contacts, record/withdraw consent, segment, send tracked email, run durable automation, and use a CRM pipeline/inbox with suppression and erasure honored. | O2 sending domain, BP-07 jobs, provider feedback. Current CSV import is only a partial S1. |
| 11 | BP-18, split into testable chats | Connect social accounts, approve/schedule/publish posts, reconcile receipts, manage comments where API rights exist, and show actual metrics with permission/failure states. | BP-04/07/08 and O7. Unsupported channels stay clearly unavailable. |
| 12 | BP-19 then BP-20 | Five representative nontechnical users complete the critical flows, with no critical false-live/paid interpretations; mobile/keyboard/error states pass; exact release SHA passes secret, security, E2E, a11y, provider and restore gates. | Operational modules and owner recovery objectives. Do not mark release ready while one gate is red. |

For every module, include the same friendly UX pattern: a plain-language goal, one next action, visible progress, source/permission explanation, review before external writes, receipt-backed status and a useful retry path. Test empty, loading, error, partial, success and locked states on mobile and keyboard. An integration that cannot legally or technically perform an action should explain that limit, not offer a dead button.

## 5. Freebuff working contract

1. **Start a fresh chat for each chapter.** Paste the current exact base commit and this file, then read `AGENTS.md`, the blueprint's chapter and cross-cutting rules, `PROGRESS.md`, backlog, prior reports, relevant code/tests and design contracts. Re-find symbols; blueprint line references may be old.
2. **Verify workspace parity before editing.** If Git is blocked in Vly, report that fact and compare the target file contents/hashes against the controller's GitHub baseline. A sampled match is sampled evidence, not whole-tree parity. Stop on a collision with Codex's unpublished work.
3. **Make one coherent change.** Include acceptance tests named by the chapter, auth/ownership tests for every public function, registry changes for project data, safe job/receipt logic for external writes and UI states. Run documented Bun commands where available. Record exact results and failures; never rename a failing gate green.
4. **Stay within authority.** No live data deletion, secret handling, provider writes, deployment, production changes or release claim without owner authorization. Treat scraped/provider content as untrusted data. Do not weaken a scan or auth check. The earlier main-branch exceptions were chapter-specific; ask the controller to verify base and workflow for each new chat before it edits.
5. **End with a handoff.** Write/update a chapter report and `PROGRESS.md` only for demonstrated status, add unresolved work to `DEFERRED-WORK-BACKLOG.md`, list changed files/commit or Freebuff version, exact tests/CI/preview proof, blockers and owner decisions. Finish with a concise **copy-ready prompt for one NEW next-chapter chat**. Do not start that chat in the current one.

The Codex controller reviews each Freebuff result against code, tests, exact-sha CI and browser preview, reconciles conflicting checkouts, and tells the owner what is verified versus self-reported. Freebuff should not use its own report as the only acceptance evidence.

## 6. Copy-ready prompt for the first NEW Freebuff chat

```text
MOSAI chapter BP-02: make the existing email-OTP sign-in testable on the Freebuff preview. Work only on this bounded auth slice, not on the next BP. Read AGENTS.md, docs/implementation/FREEBUFF-MVP-EXECUTION-BLUEPRINT.md, docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md (BP-02 and shared security/truth rules), docs/implementation/PROGRESS.md, docs/implementation/DEFERRED-WORK-BACKLOG.md, the BP-02 report, and current auth code/tests before editing.

The last Codex-reviewed GitHub development baseline was f3848a3cd7122eb528ff419c33c748d2e1dc5942. Recheck current GitHub main and compare your targeted files with it. Vly may block Git; report the exact parity method and its limits. Do not edit files that another agent is actively changing. Confirm the controller/owner has authorized your workflow for this new chapter before writing to main.

Observed preview failure at https://old-paths-carry.freebuff.dev/auth: Convex auth:signIn throws “EMAIL_OTP_API_KEY is not configured” in src/convex/auth/emailOtp.ts. Determine, without reading or printing secret values, whether the preview's Convex backend has the required server-side environment variable and whether the sending provider/domain is approved. A previously exposed OTP key must not be reused. Do not paste a key into chat, source, client code, logs or a report. Ask the owner to choose/reissue the provider key and confirm the sending domain and privileged step-up policy; do not guess. If configuration is absent or unavailable, make only safe code/test/UX improvements within BP-02 and classify live login as blocked, not working.

After approved configuration exists, verify the actual preview end to end with a dedicated test account: request a code, receive it, sign in, sign out, request another code, handle wrong/expired code, and confirm a non-admin cannot open admin. The product uses email OTP, so do not invent a password-reset flow. Do not expose OTP values in evidence. Run focused auth tests, then documented repository gates; keep bun run check failed if the tracked .env.keys secret scan still fails. Record exact commands, results, backend environment target, preview URL and any skipped live tests. The unrelated Permissions-Policy/html2canvas warnings are not evidence of the OTP cause.

End with changed files, test/preview proof, status by evidence level, unresolved owner actions and a concise copy-ready prompt for a NEW next-chapter chat. Update the BP report, PROGRESS.md and deferred backlog truthfully. Do not start another chapter, deploy, contact a provider, handle live customer data, or claim release readiness.
```

If BP-02 is blocked solely on owner configuration, the controller may assign the next **independent** bounded slice while the decision is pending. The handoff must still keep login and release visibly blocked.
