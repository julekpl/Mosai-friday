# BP-16/S0 — OpenAI Ads truth boundary

**Date:** 24 September 2026
**Scope:** Correct the OpenAI/ChatGPT Ads availability claim and ensure the retained platform identity cannot make provider requests.

## Finding

The repository treated OpenAI Ads as OAuth, inventing `CHATGPT_ADS_CLIENT_ID` / `CHATGPT_ADS_CLIENT_SECRET`, authorization URLs and `ads:read` / `ads:write` scopes. Its adapter called guessed `/ads/v1/advertisers` campaign and insights endpoints on `api.openai.com`. Those calls could make the UI claim connection and attempt operations despite having no verified contract.

The current official contract instead documents bearer API keys scoped to one ad account at `https://api.ads.openai.com/v1`, with account verification at `GET /v1/ad_account`. This change intentionally does not add key onboarding or campaign writes: MOSAI has no approved account-key credential model or verified operational implementation yet.

## Change

- Keep `chatgpt` in the platform identity list so existing records and UI mappings remain valid.
- Make OpenAI Ads always unavailable and unconfigured, regardless of legacy OAuth-shaped environment variables. Existing legacy credentials are not reported as connected.
- Remove the invented OAuth configuration and reject an OpenAI token exchange before any network request.
- Replace all OpenAI adapter reads with unavailable errors and writes with explicit failed results. No OpenAI ad network request is issued.
- Add focused regression coverage for config, legacy connection status, OAuth, and all adapter operations.

## Verification

`node_modules/.bin/vitest run tests/unit/openai-ads-truth.test.ts` — passed, 1 test file / 5 tests. Tests stub `fetch` and assert it is never called for OpenAI operations. `node_modules/.bin/tsc -b --noEmit` and scoped ESLint on the four changed TypeScript files also passed. `git diff --check` passed for the scoped files.

The repository-documented `bun` command could not be invoked because `bun` is not installed on this shell's PATH. No provider calls or credentials were used.

Controller integration rerun with the available Bun 1.3.14 binary: `bun run check` passed typecheck, lint (0 errors, 28 existing warnings), and 491/491 unit tests in 38 files, then exited 1 at the existing tracked `.env.keys:8` secret finding (value redacted). The three public-function/capability/data-registry audits and build passed separately; the hermetic browser suite passed 20 tests with one intentional live-OTP skip using the inert CI Convex URL. It does not prove an OpenAI Ads connection or provider operation. Release remains blocked.

## Official references

- [OpenAI Advertiser API overview](https://developers.openai.com/ads/api-overview)
- [OpenAI Advertiser API authentication](https://developers.openai.com/ads/api-reference/authentication)
