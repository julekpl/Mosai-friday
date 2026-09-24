# Decision record: app builder generation and preview (BP-15 / E3.8, first slice)

**Status:** accepted (owner, 24 Sep 2026) · **Date:** 24 Sep 2026

## Owner answers

1. **Preview runtime:** in-browser **Sandpack** first, not a server sandbox (E2B,
   Cloudflare Sandbox and Vercel Sandbox were offered). This defers the ADR-3
   sandbox-provider spike; it does not replace it.
2. **Approach:** port **open-lovable** (MIT, `firecrawl/open-lovable`).
3. **UX:** chat first. The app brief becomes an optional panel, not a gate.

## How "port open-lovable" was applied

open-lovable is a Next.js app whose runtime is Vercel Sandbox or E2B plus
Firecrawl and direct provider SDK calls. A literal copy would break AGENTS.md
rules 3, 9 and 11 and contradict answer 1. So the **engine** was ported:
system prompt rules, the `<file path>` / `<package>` protocol, truncated-file
completion and edit-context selection. It was rebuilt on Convex, `ModelGateway`
(OpenRouter) and the org-scoped guards. Attribution: `THIRD_PARTY_NOTICES.md`.

## What exists now

- `appRuns` (one chat turn = one job), `appSnapshots` (immutable versions) and
  `appSourceFiles` (file bodies stored once per build by SHA-256). All three are
  registered in the data registry and cascade with the build and the project.
- `modules/buildApp/workspace.ts`: `workspace`, `sendMessage`, `cancelRun`,
  `saveFile` (refuses stale bases), `restoreVersion` (forward copy, history kept).
- `modules/buildApp/generate.ts`: agent `build.app_generate`. The context is
  loaded on the server: business brief, personas, journeys, active products, the
  app brief and selected content. This is the MOSAI advantage over a blank
  prompt box.
- UI: chat on the left, Preview / Code / Brief / Versions on the right.

## Security position

- Generated code runs **only** in Sandpack's iframe on `*.codesandbox.io`, a
  separate registrable domain. The dashboard CSP changed from `frame-src 'none'`
  to `frame-src https://*.codesandbox.io` (`main.ts`, `index.html`).
- The source reaches the iframe by `postMessage`. Package names and versions are
  fetched by CodeSandbox's packager, so they are visible to CodeSandbox.
- Model output is data. Paths are allow-listed (`src/**`, `.jsx/.js/.css/.json/.md/.svg`,
  no traversal, no template-owned config), sizes are bounded, and there are no tools.

## Known limits (not claims)

- No backend, auth, database, deploy, publish or export for apps yet. The UI
  says so. Open question 6 in `docs/pack/STATUS.md` (where a generated app's
  backend lives) still blocks those.
- Sandpack cannot run arbitrary Node tooling (no `npm run build`, no Vite
  plugins). Packages resolve through CodeSandbox's CDN.
- Output is capped at 8,000 tokens per model call (`ModelGateway` ceiling).
  First versions are asked to stay within 8 files. Cut-off files get one
  completion call each (up to 3); anything still cut off is reported as not
  written and the run is `partially_succeeded`.
- WebContainers (Bolt's runtime) was not chosen. Its production commercial use
  needs a paid StackBlitz licence.

## Next decisions

- ADR-3 server sandbox (E2B or Cloudflare Sandbox) when apps need a backend,
  real `npm` builds or deploys.
- Whether to raise the gateway output ceiling for `build.app_generate` only.
