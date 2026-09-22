# Tickets — one file per unit of work

**Convention:** one ticket = one file = one branch = one pull request = one agent
chat. A chat opens the ticket file, does exactly that scope, and closes with a
completion summary plus a handoff prompt for the next ticket.

- Index and ordering: `docs/pack/10-build-backlog.md`
- Current state before you start: `docs/pack/STATUS.md`
- Rules you must follow: `AGENTS.md` (wins on security and truthfulness; the
  ticket wins on scope)

A ticket file is created when its chat starts, from its section in the backlog,
expanded to the same detail as Phase 0–1. Do not pre-write tickets whose scope
will be different by the time they are reached.

## Naming

```
docs/tickets/T1.1-single-package-manager.md
docs/tickets/T2.9-model-gateway.md
```

## Status markers

Use these in the file header and keep them honest: `not started` · `in progress` ·
`blocked (reason)` · `code done, proof outstanding` · `done`.

A ticket is **done** only when every acceptance criterion has a test or a recorded
check — not when the code merely looks finished (`AGENTS.md` §6).

## Order of work

| Phase | Tickets | Files | Gate |
|---|---|---|---|
| 0 | T0.1–T0.10 | 🔒 closed (code); four owner actions outstanding | G-P0 |
| 1 | T1.1–T1.8 | T1.1 ✅ done · T1.2 ✅ done · T1.3 ✅ done · T1.4 ✅ done · T1.5 ✅ done · T1.6 ✅ done · T1.7 ✅ done · T1.8 ✅ done | G-P1 |
| 2 | T2.1–T2.16 | T2.1 ✅ done (22 Sep 2026) · T2.2 ✅ done (22 Sep 2026) · T2.3 ✅ done (22 Sep 2026) · T2.4 ✅ done (22 Sep 2026) · T2.5–T2.16 create when reached | G-P2 |
| 3 | E3.1–E3.10 | create when reached | per add-on |

Do not start a phase before the previous gate passes.

## Phase 2 — progress

| Ticket | Status | File |
|---|---|---|
| T2.1 | ✅ **done** (22 Sep 2026) — organizations, memberships, roles, invitations; idempotent migration under each owner's personal organization; agency client links; last-owner protection. Proof: 9 new unit tests. | `docs/tickets/T2.1-organizations-memberships-roles-invitations.md` |
| T2.2 | ✅ **done** (22 Sep 2026) — `orgQuery`/`orgMutation`/`orgAction` + `OrgAccess` in `guards.ts`; all 81 inline `ownerId` checks migrated (27 modules) so a member of the owning organization can reach the project; lint ban on raw `ctx.db` project reads; audit now fails on an unscoped public function; generated 163-case cross-tenant suite (every record-scoped public function) proving a foreign organization gets nothing and writes nothing. Proof: `tests/unit/cross-tenant.generated.test.ts` + `audit-gate.test.ts` (170 tests with the registry/fixture helpers). | `docs/tickets/T2.2-org-scoped-function-builders.md` |
| T2.3 | ✅ **done** (22 Sep 2026) — one capability registry (`src/convex/lib/capabilities.ts`): 8 modules × 5 verbs, the plan → module matrix (re-exported by `billing.ts`), the role → action matrix, the four blueprint §3 states and a country stub. `guards.ts` resolves plan × role for the **organization** (not the caller) and the new `moduleQuery`/`moduleMutation`/`moduleAction` enforce the capability before a write handler runs; all **149 module functions in 31 files** migrated; the scheduled-post job refuses to publish without `promote.publish`; the UI routes and locks read `entitlements.matrix`. Gate: `bun run audit:capabilities` (in `check` + CI) fails on an ungated module function, an unclassified file, a public export from a library file and a missing/stale exemption. Proof: `tests/unit/entitlements.test.ts` (26, generated over the registry) + `audit-gate.test.ts` (11 total) — including regressions for three defects and the plan-locked/role-locked/job axes. | `docs/tickets/T2.3-capability-registry.md` |
| T2.4 | ✅ **done** (22 Sep 2026) — Stripe Billing + the platform admin panel. Owner decisions recorded (Connect for E3.4; Stripe Tax on; plans/prices **not** final → price ids are env config). `lib/stripe.ts` (REST client, test-mode-only guard, mandatory idempotency key, HMAC-SHA256 signature verification), `lib/billingCatalog.ts` (registry plans → `STRIPE_PRICE_*`), `lib/billingReconcile.ts` (pure drift computation). New tables `billingCustomers`/`subscriptions`/`billingEvents`/`billingReceipts`/`billingInvoices`/`reconciliationRuns` + `platformAdmins`/`adminAuditLog`. `billing.startCheckout`/`openPortal` (org actions, return a URL and write no plan); `POST /api/stripe/webhook` → internal `billingWebhooks.applyEvent` (idempotent by event id, out-of-order-safe by `lastEventCreated`, a completed checkout alone never grants a plan); dunning + `past_due`→`wind_down` sweep + daily reconciliation cron. `/admin` panel: operator resolution via `lib/platformAdmin.ts` (bootstrap `julian.s.witkowski@gmail.com`, extensible with `PLATFORM_ADMIN_EMAILS`), stats, webhook ledger, reconciliation report, audited plan overrides and operator grant/revoke. Proof: `tests/unit/billing.test.ts` (12) — duplicate + out-of-order no-ops, redirect never grants, 0-drift reconciliation, wind-down, signature/test-mode guards, admin gating, and a regression for an invoice-before-subscription defect. | `docs/tickets/T2.4-stripe-billing.md` |

## Phase 0 — remaining owner actions (not code)

Tracked here because they block G-P0 and only the owner can close them:

| Action | Ticket | Status |
|---|---|---|
| Revoke the OTP email API key; re-key dotenvx; purge history with `git filter-repo` | T0.1 | ⬜ waiting on owner |
| Choose the transactional email provider + sending domain, then implement `EmailGateway` and remove the platform toolbar | T0.8 | ⬜ waiting on owner decision |
| Confirm whether the exposed secrets were issued by the platform (and whether the platform stays for any production service) | T0.1 / ADR-9 | ⬜ waiting on owner |
| Decide the authoritative package manager (bun today, npm in the blueprint's commands) | T1.1 | ✅ decided: **bun** (22 Sep 2026) — lockfile consolidated, runtime pinned |

## Phase 0 — code that is still open

| Ticket | Open part |
|---|---|
| T0.4 | Replace the client-supplied `projectSnapshotValidator` with server-loaded context (`projectId` + internal ownership query), and add per-user rate limits. |
| T0.7 | Sanitize on save (server side, needs an isomorphic sanitizer) and add the content-security policy. |
| T0.8 | `EmailGateway` + toolbar removal (blocked on the owner decision above). |
| T1.7 | ✅ done (22 Sep 2026) — R1–R12 are real tests and run in CI (33 unit + 3 browser). **R4 remains `blocked` on T0.4** and is kept red in the suite (`it.fails`) rather than deleted or weakened. Writing R10 also fixed a real defect in `dal.cascadeDeleteProject` (`buildVersions` had no `by_project` index, so every project deletion threw). |

## Blocked tests (the code, not the test, is missing)

A test is listed here when it is written but cannot pass yet. It is never deleted
or weakened: it stays in the suite as an expected failure so the gap is visible
and closes loudly.

| Test | Blocked on | Where it lives |
|---|---|---|
| **R4** — AI actions load context server-side | T0.4's remainder: replace the client-supplied `projectSnapshotValidator` with a server-loaded `projectId`. | `tests/unit/phase0-regressions.test.ts` (`it.fails`, with a `BLOCKED(T0.4)` comment) |
