# BP-13/S1 — public projection seam

**Status:** bounded interface slice, `implemented_unverified`. This is not a
public website deployment, domain verification, or proof of separate-origin
delivery. The exact public customer domain and hosting adapter remain owner
decisions (O4).

## Outcome

Added `src/convex/modules/buildWebsite/publicProjection.ts` with an internal
hostname resolver for the public-site renderer contract. It resolves only a
hostname carried by a succeeded deployment row, requires that row to point to
the verified release audit and build/site/project, and returns content from
that audit's immutable route and revision snapshot. The revision must appear
in the audit's pinned revisions, and its page must belong to the same site and
project. Missing hostname receipt data, an absent verified deployment, an
unavailable route, or conflicting cross-tenant hostname bindings returns no
page. It never accepts a project or site ID as its lookup key.

The resolver is an `internalQuery`, so the dashboard client cannot call it.
The schema's optional `publicHostname` field is a future verifier contract;
this checkout has no code that writes it. Tests use synthetic receipt rows and
a deliberately corrupted cross-tenant route pin; those rows do not prove
domain ownership or provider deployment.

## Scope and limitations

The blueprint source available here is `docs/MOSAI-IMPLEMENTATION-BLUEPRINT.md`;
the referenced `MOSAI_CODE_PRODUCT_BLUEPRINT_V2.md` and pack contract
`docs/pack/08-module-contracts.md` are absent as documented in
`docs/implementation/PROGRESS.md` §7. No hosting adapter, hostname verification,
public renderer, public URL, TLS evidence, pre-rendering, or browser journey was
added. No actual site can be served from a separate registrable origin through
this interface yet. BP-13/S1 and real public-origin proof therefore remain open.

## Verification

- Red-first regression: `tests/unit/publish-truth.test.ts` failed when the
  resolver export was removed, then passed with it present.
- Focused publication-truth suite: **22/22 passed**.
- TypeScript build check: **passed** (`node_modules/.bin/tsc -b --noEmit`).
- Focused ESLint: **passed** on the changed TypeScript files.
- Public-function audit: **passed** (the new resolver is internal).
- Full unit suite: **470/470 passed** (35 test files), using the checkout's
  bundled Bun binary for the capability-audit subprocess.
- Module-capability audit: **passed**; the new internal module is registered
  as an internal Convex file.
- Public-function audit: **passed**.
- `git diff --check`: **passed**.
- Codegen drift check: **not completed**; `convex codegen` requires
  `CONVEX_DEPLOYMENT`, which is not configured here. No generated files were
  hand-edited.
- Secret scan: **still red** on the pre-existing tracked `.env.keys`
  (`dotenvx-private-key`, value redacted); no suppression or credential
  changes were made.
