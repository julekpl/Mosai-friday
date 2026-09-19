# WEBSITE-VISION.md

Status: W0 contract · created 2026-09-19
Scope: MOSAI website / CMS / ecommerce storefront layer

## One-liner

MOSAI gives every project a native website: pages, drafts, publishing and a
block-based visual builder — while business facts (products, prices,
availability, contacts, consent) stay in their canonical modules and are only
ever *referenced* by the CMS.

## The three capabilities

```text
WEBSITE / CMS   owns pages, layout, content, navigation, forms, SEO,
                revisions, publishing
SELL            owns products, variants, collections, availability, pricing
CONNECTORS      connect external CMS/commerce systems (W6, later)
```

## Core principle

> Simple editing experience, explicit publishing model, canonical domain
> ownership.

Users think: create page → edit page → preview → publish. The backend may be
sophisticated; the UX must not expose that complexity.

## The single most important rule

The CMS must never copy commerce facts into page content.

```text
Correct:  ProductGrid { collectionId: "col_123" }
Wrong:    ProductGrid { products: [{ title, price: 99, stock: 4 }] }
```

Pages reference canonical commerce IDs. The runtime resolves current data.

## Milestones (each useful independently)

```text
W0  CMS domain contracts          ← done (docs)
W1  Pages, revisions, assets, SEO, navigation   ← this implementation
W2  Visual editor + component registry (Puck spike first)
W3  Preview, publish runtime, domains
W4  Forms + Customers integration
W5  Commerce-aware storefront blocks
W6  External CMS connectors (WordPress first)
W7  Native transaction engine (conditional, evaluate Medusa)
W8  Advanced publishing / localization / multisite
```

## What W1 gives MOSAI

> A Site with a homepage, hierarchical unique URLs, immutable published
> revisions, draft safety, version history with restore, assets, navigation,
> redirects, and SEO defaults with per-page overrides.
