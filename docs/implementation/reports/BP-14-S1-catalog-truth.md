# BP-14/S1 — merchant setup and catalog truth

## Outcome

Native Sell catalog writes now validate project-scoped collection references,
nonnegative integer minor-unit amounts and inventory values, and supported availability
and identifier values. Product readiness stays derived per variant and marks a
product without variants as blocked. Native catalog records no longer claim
`syncState: "synced"` without a provider sync.

## Local status and evidence

`products.status` remains the local catalog lifecycle (`draft`, `active`, or
`archived`). Existing storefront code uses `active` to decide whether a local
product is visible there. This field does not confirm an external feed
acceptance, merchant account connection, checkout, payment, or provider sync.
Activating a product records only the internal `product_activated` analytics
event; it creates no provider receipt.

Availability defaults to `in_stock` when inventory is untracked or positive,
and to `out_of_stock` when tracked inventory is zero. Explicit in-stock and
out-of-stock values are checked against tracked inventory. An inventory edit
updates those two availability values together; `preorder` and `backorder`
remain explicit states.

## Scope and verification

Regression coverage is in `tests/unit/sell-catalog-truth.test.ts` and checks
cross-project collection assignment, invalid prices and inventory, explicit
variant writes, local status and sync semantics, and readiness for a legacy
product without a variant.

The tests were added before the implementation. The initial attempt to run
them through `bun` could not start because Bun was absent from this agent's
`PATH`; a pre-fix failing run was not captured.

Verified with:

- `node_modules/.bin/vitest run tests/unit/sell-catalog-truth.test.ts` — 4 tests passed.
- `node_modules/.bin/tsc -b --noEmit` — passed.
- ESLint on the three changed Convex modules and the focused test — passed.
- Full unit suite — 481 passed, 6 failed in `tests/unit/audit-gate.test.ts`; those six spawn `bun`, which was unavailable on this agent's `PATH`. The other 37 test files passed.

Bun was not available on this agent's `PATH`, so the repository's documented
Bun commands could not be invoked here; the parent agent will run the combined
documented checks using its resolved Bun binary. `docs/pack/08-module-contracts.md`
is also absent in this checkout, as noted by `docs/pack/STATUS.md`.

## Limits

Controller integration rerun with the available Bun 1.3.14 binary: `bun run check` passed typecheck, lint (0 errors, 28 existing warnings), and 491/491 unit tests in 38 files, then exited 1 at the existing tracked `.env.keys:8` secret finding (value redacted). The three public-function/capability/data-registry audits and build passed separately; the hermetic browser suite passed 20 tests with one intentional live-OTP skip using the inert CI Convex URL. These browser tests cover public/auth entry points, not an authenticated merchant catalog journey. The initial browser attempt without `VITE_CONVEX_URL` rendered blank; this was corrected for the documented hermetic rerun. Release remains blocked.

This slice does not implement merchant onboarding or verification, payment,
checkout, orders, public product feeds, external feed diagnostics, Shopify
sync, or any claim of external acceptance. It makes no schema changes and adds
no provider calls. It does not claim that active products are purchasable.
