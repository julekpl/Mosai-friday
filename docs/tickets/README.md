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
| 1 | T1.1–T1.8 | T1.1 ✅ done · T1.2 ✅ done · T1.3 ✅ done · T1.4 ✅ done · T1.5–T1.8 not started | G-P1 |
| 2 | T2.1–T2.16 | create when reached | G-P2 |
| 3 | E3.1–E3.10 | create when reached | per add-on |

Do not start a phase before the previous gate passes.

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
| T1.7 | Write R1–R12 as real tests — the code is in place, the proof is not. |
