# BP-15/S1a — app requirements workspace

**Status:** bounded requirements slice, `implemented_unverified`. It does not
implement or prove app source generation, execution, preview, persistence
runtime, sandbox isolation, deployment, rollback, or export. BP-15 remains open.

## Outcome

Selecting an app build now opens an app-specific requirements workspace. New
app builds save an initial draft brief and skip the website plan action and
CMS page creation path. Website creation and the website workspace continue
through their existing flow. App context is selected explicitly from records
in the same project; the workspace displays saved provenance and makes clear
that a source record is not verification evidence. Switching between app
builds remounts the editor so unsaved local text cannot carry across builds.

Every new app brief requires an explicit audience: customer-facing, internal
team, or both. Existing app records without a requirements brief show an empty
audience choice rather than receiving an inferred default.

`builds.saveAppRequirements` only accepts app builds the caller owns. It
resolves each persona, journey, or content record on the server, requires the
record to belong to the build's project, and snapshots its server-derived
label and deterministic content fingerprint. Any edit returns the record to
`draft` and removes prior review metadata. `builds.reviewAppRequirements`
requires saved app requirements, re-resolves every selected source, and
rejects review if a source changed or disappeared after the brief was saved.
It records the authenticated user and server time. Review means the brief was
reviewed; it does not mean code was generated or run.

## Verification

- `npm run typecheck` — passed.
- Focused ESLint on the changed TypeScript files — passed.
- `npm run test:unit -- tests/unit/app-requirements.test.ts` — 7/7 passed,
  covering provenance, server-only review metadata, edit invalidation,
  wrong-project and wrong-kind references, meaningful-review requirements,
  stale-source rejection, website-plan rejection, duplicate provenance, and
  build tenant ownership.
- `npm run audit:functions` — passed; the existing review notices for billing,
  files, and users remain unchanged.
- Full `npm run test:unit` — 485 passed, 6 failed in the existing capability
  audit-gate subprocess tests because Bun is unavailable (`status: null` when
  those tests attempt to launch it). These failures are environment-related;
  the focused app suite passes.
- `git diff --check` — passed.
- Capability audit could not run because its documented Bun executable is not
  installed in this environment.
- Convex codegen drift was not checked because this checkout has no configured
  development deployment. Generated bindings were not edited.

The workspace uses saved project records as source context. It does not prove
their accuracy, and no model/provider, sandbox, app runtime, external write,
or deploy path was invoked. Sandbox/backend-host decision O5 and the later
BP-15 acceptance evidence remain outstanding.

Controller integration rerun with the available Bun 1.3.14 binary: `bun run check` passed typecheck, lint (0 errors, 28 existing warnings), and 491/491 unit tests in 38 files, then exited 1 at the existing tracked `.env.keys:8` secret finding (value redacted). The three public-function/capability/data-registry audits and build passed separately; the hermetic browser suite passed 20 tests with one intentional live-OTP skip using the inert CI Convex URL. It does not reach this authenticated app workspace. The first browser attempt without `VITE_CONVEX_URL` rendered blank; the corrected run passed. Release remains blocked.
