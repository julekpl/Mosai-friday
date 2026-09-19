# CMS-CONNECTOR-CONTRACT.md

Status: W5 (commerce read connector) · created 2026-09-19
Reference implementation studied: **svelte-commerce** (itswadesh, MIT — see
THIRD_PARTY_NOTICES.md)

## Scope

This contract governs **commerce connectors** that feed MOSAI storefront
blocks. CMS connectors (WordPress/Webflow, W6) are a separate contract — a
provider can participate in both (WooCommerce + WordPress).

## Modes (§65)

```text
READ      MOSAI resolves provider catalog data into normalized Sell tables
PUBLISH   MOSAI writes approved content into the provider   (W6, not yet)
RUNTIME   MOSAI storefront consumes provider data/actions live (W6 handoff)
```

Not every connector supports every mode. The UI renders the actual matrix.

## First connector: Shopify (READ)

Endpoint mapping and normalized model derive from svelte-commerce's
`@misiki/shopify-connector` (Storefront API 2025-01, GraphQL). Capabilities
used: products, collections, product images, price, availability.

```text
Shopify products.graphql        → products + productVariants + productMedia
Shopify collections.graphql     → collections
```

Provider authority rules (§142):

- products get `source: "external"`, `authority: "shopify"`,
  `provider: "shopify"`, `externalId` = Shopify product GID
- collections get matching external identity fields
- MOSAI never mutates provider facts; local enrichment (seoTitle etc.)
  stays MOSAI-owned and is preserved across syncs

## Capability matrix (rendered in the Connections UI)

```text
Shopify  READ
  browse            ✅ products, collections, images
  price/variants    ✅ resolved from canonical variants at render
  availability      ✅ in_stock / out_of_stock
  cart/checkout     ⛔ not in this connector — W6 adds checkout handoff URLs
  refunds/orders    ⛔ provider-side only
```

Following svelte-commerce discipline: a capability a provider lacks renders
as an explicit "not supported", never a silent fallback or fake stub.

## Credential handling

- `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_ACCESS_TOKEN` are project
  env keys set through the Keys/API keys UI — never stored in Convex rows
- sync runs server-side in a Convex action (`"use node"`); tokens never
  reach the client

## Sync semantics

- full-catalog sync on demand (`shopifySync.syncCatalog`)
- upsert by `externalId`; provider rows are updated, never duplicated
- MOSAI enrichment is preserved on re-sync
- errors surface per-collection ("Sync failed: …") — no silent partial state
