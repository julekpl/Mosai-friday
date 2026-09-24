# BP-02 — live-auth unblock verification (chat: 24 September 2026)

**Chapter:** BP-02 live-auth unblock (MVP execution blueprint, priority 0).
**Scope guard:** one bounded auth slice; no provider contact, no secret
handling, no deploy, no release claim.

## 1. Parity / workspace check

- Git commands are blocked in the Vly environment (B2, unchanged from chat 0).
  Checkpoint provenance therefore rests on `.git` inspection and file-level
  comparison, not on a verifiable whole-tree commit match.
- Targeted auth files inspected directly: `src/convex/auth/emailOtp.ts` and
  `src/convex/users.ts` match the tree's own committed state; no conflicting
  uncommitted drafts were found in the auth paths. No other agent is editing
  BP-02 files (the BP-13/S1 uncommitted draft lives elsewhere; untouched).

## 2. Root-cause verification of the preview OTP failure

The observed preview error at `https://old-paths-carry.freebuff.dev/auth` is
`EMAIL_OTP_API_KEY is not configured` from `src/convex/auth/emailOtp.ts`.
Verified **without reading or printing any secret value**:

- `bun convex env list` on the linked Convex deployment lists the configured
  variable **names only**. `EMAIL_OTP_API_KEY` is **absent**. Present names:
  the auth JWKS/JWT pair, `SITE_URL`, `VLY_APP_NAME`,
  `VLY_CONVEX_AUTH_ISSUER`, `VLY_INTEGRATION_BASE_URL`, `VLY_INTEGRATION_KEY`.
- Conclusion: the failure is exactly what the error says — missing server-side
  configuration on the deployment, not a code defect, not the unrelated
  Permissions-Policy/html2canvas warnings, not the missing `/logo.png`.
- Therefore **live sign-in on the preview is blocked on owner gate O2**:
  choose/reissue an approved transactional email provider key + verified
  sending domain, and decide the privileged step-up policy. A previously
  exposed OTP key must not be reused (never shared in chat; the owner sets it
  in the deployment's environment, not in source or conversation).

## 3. Gates run this chat (exact commands, exact results)

| Gate | Command | Result |
|---|---|---|
| Focused auth tests | `bun run test -- tests/unit/auth-lifecycle.test.ts` | **9/9 pass** |
| Typecheck | `bun tsc -b --noEmit` | exit 0 |
| Function authz audit | `bun run audit:functions` | exit 0 |
| Lint | `bun run lint` | 0 errors (28 pre-existing warnings) |
| Codegen drift | `bun run check:codegen` | exit 0, bindings in sync |
| Secret scan | `bun run scan:secrets` | **exit 1** — pre-existing tracked `.env.keys` finding (line 8), value redacted, never printed. Kept red; not weakened. |
| Combined `check` | — | **not claimed green**; blocked at the same D-01 secret finding |

Browser e2e was not re-run: the live-OTP test is skipped by design without a
real inbox, and no new browser-relevant code changed.

## 4. Evidence level reached

- **Implemented (verified):** the OTP code path, its error handling, keyboard
  and recovery UX from prior BP-02 chat 4 — focused auth tests pass, audits
  and codegen clean.
- **Not reached — Operational:** real OTP delivery, sign-in/sign-out, wrong/
  expired-code recovery on the actual preview. **Blocked on O2** (provider key
  + sending domain + step-up policy). Live login is **blocked, not working**.
- **Not reached — Release-ready:** release gate stays BLOCKED by D-01 (secret
  remediation + history purge); CI is never described as green.

## 5. Changed files

None in source. Documentation only: this report, a `PROGRESS.md` line for
this chat, and a backlog note under D-03.

## 6. Unresolved owner actions

1. **O2 (unblocks live sign-in):** set `EMAIL_OTP_API_KEY` on the preview's
   Convex deployment via the deployment environment (Keys panel / `convex env
   set`) with a **newly issued** key; confirm the sending domain and the
   privileged step-up policy. Do not reuse the previously exposed key; do not
   paste it into chat.
2. **D-01 (unblocks release):** rotate/untrack the exposed `.env.keys`
   credential and run the history purge; both secret scans must pass on the
   exact new commit.
3. After O2 is done: re-run the live OTP journey (request → receive → sign in
   → sign out → wrong/expired code → non-admin denied on admin routes) with a
   dedicated test account, per the copy-ready prompt in
   `docs/implementation/FREEBUFF-MVP-EXECUTION-BLUEPRINT.md` §6.

## 7. Copy-ready prompt for the NEW next-chapter chat

```text
MOSAI chapter BP-02 completion check (only after the owner confirms O2 is
resolved): the preview Convex deployment must have a newly issued
EMAIL_OTP_API_KEY set server-side and an approved sending domain. Do not
paste, print, or commit the key. Verify with `bun convex env list` that the
variable NAME is present (names only), then run the live OTP journey on the
actual preview at https://old-paths-carry.freebuff.dev/auth with a dedicated
test account: request a code, receive it, sign in, sign out, request another
code, handle a wrong and an expired code, and confirm a non-admin cannot open
admin routes. Never expose OTP values in evidence. Re-run the focused auth
tests and the documented gates; keep `bun run check` red at the pre-existing
.env.keys secret-scan finding unless the owner has completed D-01 remediation
— if both security jobs pass on the exact current commit, record the release
gate change honestly. Update the BP-02 report, PROGRESS.md and
DEFERRED-WORK-BACKLOG.md to the true evidence level. If O2 is still missing,
record live login as blocked and make only safe BP-02 code/test/UX
improvements. End with a copy-ready prompt for the next NEW chapter chat
(likely BP-01 remediation follow-up or BP-06/S2); do not start it here.
```
