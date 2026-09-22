# Runbook — rotating exposed secrets (pack T0.1 / G19)

The repository was public while it contained a live OTP email API key
(`src/convex/auth/emailOtp.ts`) and the dotenvx private key file (`.env.keys`,
added in commit `6d343a7`). **Rotation is the fix.** Purging history is
hygiene: anyone who cloned or forked before the purge still has the old value.

Order matters — revoke first, then redeploy with the new value, then clean up.

## 1. Revoke and re-issue

| Secret | Where it lives | Action |
|---|---|---|
| OTP email API key | `EMAIL_OTP_API_KEY` (env) | Ask the OTP service operator (`auth.freebuff.app`) to revoke the old key and issue a new one. If the product is detaching from that platform (ticket T0.8), skip re-issuing and move to your own transactional email provider. |
| dotenvx private key | `.env.keys` | Generate a new keypair (`dotenvx` docs: rotate), re-encrypt every `.env*` file, distribute the new private key through the Keys / API keys panel only. |
| Anything else that ever sat in `.env*` | Supabase/Stripe/Google/Meta/TikTok/Shopify/SerpApi keys | Assume compromise if the file was tracked. Rotate each in its provider console. |

Never paste a key value into code, tests, tickets, a commit message or chat.

## 2. Verify the old value is dead

Make one call with the old credential and confirm it is rejected (401/403).
Record the date, the credential name and the result in the incident log — not
the value.

## 3. Keep it out of the tree

`.gitignore` now ignores `.env*` and un-ignores `.env.example`. Confirm with:

```bash
git check-ignore -v .env.keys .env.local .env
```

Both commands must report a matching rule.

## 4. Purge history (hygiene, after rotation)

```bash
# Install once: pipx install git-filter-repo
git filter-repo --invert-paths --path .env.keys
git filter-repo --replace-text <(echo 'OLD_KEY_VALUE==>REDACTED')
git push --force-with-lease origin main
```

Then: rotate again if any fork or clone is outside your control, ask GitHub
Support to garbage-collect the repository, and have every clone re-clone.

## 5. Prevent recurrence

```bash
# Local pre-commit check
gitleaks detect --no-banner --config .gitleaks.toml --redact
```

CI must run the same command over full history plus the working diff (ticket
T1.5 adds the job). A planted dummy secret must fail the build. Do not add
allowlist entries for anything but documentation and `.env.example`.
