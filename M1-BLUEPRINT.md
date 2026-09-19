# MOSAI Sell — M1 Blueprint (Commerce Brain)

> Status: IMPLEMENTATION TARGET. Only M1. Bound by `SELL-ARCHITECTURE.md`;
> sequenced per `SELL-EXECUTION-PLAN.md`. If implementation uncovers a
> contradiction with an architecture invariant, update that document in the
> same change.
>
> Stack context (for whoever implements): Vite + React 19 + shadcn/ui +
> Tailwind v4 frontend; Convex backend (schema in `src/convex/schema.ts`,
> module tables guarded by `guards.ts`, AI via the `ai.ts` action pattern
> with `"use node"`). Field names below are concrete Convex-ready names.

---

## 1. Domain objects

### Product

```ts
products: defineTable({
  projectId: Id<"projects">,
  // identity & lifecycle
  title: string,                       // required
  slug: optional<string>,              // derived from title when generated
  description: optional<string>,
  status: "draft" | "active" | "archived",   // default "draft"
  // source authority (SELL-ARCHITECTURE §3 — populated day one, used in M2)
  source: "mosai_native" | "external",       // default "mosai_native"
  authority: string,                          // "mosai" | provider key; default "mosai"
  provider: optional<string>,
  externalId: optional<string>,
  syncState: "synced" | "syncing" | "needs_attention" | "disconnected" | "unsupported",
  lastSyncedAt: optional<number>,
  // presentation facts
  brand: optional<string>,
  productType: optional<string>,
  tags: optional<string[]>,
  // commerce facts live on the default/explicit variants (see Variant)
  collectionIds: optional<Id<"collections">[]>,
  // MOSAI enrichment (conceptually separate from commerce facts — §2)
  enrichment: optional<{
    buyerObjections?: string[],
    contentOpportunities?: string[],
    seoTitle?: string,
    seoDescription?: string,
    updatedAt?: number,
    origin: "ai" | "user",              // auditability: who produced it
  }>,
  createdAt: number,
  updatedAt: number,
})
  .index("by_project", ["projectId"])
  .index("by_project_status", ["projectId", "status"])
  .index("by_project_external", ["projectId", "provider", "externalId"]),
```

### Variant

Every Product has ≥ 1 variant (ARCHITECTURE §1). Simple products carry one
implicit default variant; ordinary UX hides it.

```ts
productVariants: defineTable({
  projectId: Id<"projects">,           // denormalized for ownership checks
  productId: Id<"products">,
  isDefault: boolean,                  // exactly one per product, enforced in mutations
  title: optional<string>,             // e.g. "Black / Standard" — explicit variants only
  sku: optional<string>,
  gtin: optional<string>,
  priceCents: optional<number>,        // minor units; the sellable fact
  compareAtPriceCents: optional<number>,
  currency: string,                    // required; project-level default applied on create
  inventoryCount: optional<number>,    // null = inventory not tracked
  availability: "in_stock" | "out_of_stock" | "backorder" | "preorder",
  availabilityDate: optional<number>,  // REQUIRED when preorder/backorder
  identifierStatus: "has_identifiers" | "no_identifiers_exist" | "unknown",
                                       // honest GTIN model (never "missing = error")
  optionValues: optional<{ name: string, value: string }[]>,  // explicit variants only
  // source authority mirrors Product (M2 import; write-back never allowed M1)
  source: "mosai_native" | "external",
  externalId: optional<string>,
  createdAt: number,
  updatedAt: number,
})
  .index("by_product", ["productId"])
  .index("by_project", ["projectId"]),
```

**Default-variant behavior (normative):**
- `create` mutation always inserts a default variant; a "simple" create
  (title + price + inventory) populates it directly.
- Exactly one `isDefault: true` per product; making another variant
  default demotes the previous one in the same transaction.
- Deleting the default variant is refused while other variants exist
  (demote-or-delete-product rule).
- A product's *display* price/availability = its default variant's, unless
  an explicit price range is rendered by the UI.

### Media

```ts
productMedia: defineTable({
  projectId: Id<"projects">,
  productId: Id<"products">,
  variantId: optional<Id<"productVariants">>,  // per-variant image (ARCHITECTURE §4)
  url: string,                        // https URL (M1); storage-backed later
  alt: optional<string>,              // AI-fixable (safe tier)
  position: number,                   // 0 = primary
  source: "mosai_native" | "external",
  createdAt: number,
}).index("by_product", ["productId"]),
```

M1 UX exposes a single "add image" field writing to this list
(`position: 0`); the model is `media[]` regardless.

### Collection

```ts
collections: defineTable({
  projectId: Id<"projects">,
  title: string,
  description: optional<string>,
  // membership is on the product side (collectionIds) for M1; a join table
  // is introduced in M2 only if queries demand it
  createdAt: number,
}).index("by_project", ["projectId"]),
```

Collections reference products; they never own product data
(ARCHITECTURE §4).

---

## 2. Relationships

```text
Project 1─n Product 1─n Variant          (≥1; exactly one default)
Project 1─n Product 1─n Media            (0..n; position 0 = primary)
Project 1─n Collection n─n Product       (via products.collectionIds)
Product.enrichment                       (MOSAI-owned, never commerce truth)
```

Ownership: every row carries `projectId`; all access passes through
`guards.ts` (`requireUser` / `ownedRow` / `assertModule("sell")`).

---

## 3. Required vs optional fields

| Field | Required | Notes |
|---|---|---|
| Product.title | ✔ | |
| Product.status, source, authority, syncState | ✔ | server-defaulted |
| Variant.currency | ✔ | project default; user may override |
| Variant.priceCents | read-ready | optional; blocks feed readiness if missing |
| Variant.availability | ✔ | default `in_stock` for native |
| Product.slug, description, brand | optional | readiness-relevant when absent |
| Variant.sku, gtin | optional | GTIN absence is a feed *issue*, not an error |
| Inventory | optional | null = untracked; never inferred |

---

## 4. Product lifecycle

```text
draft ──publish──▶ active ──archive──▶ archived
  ▲                    │
  └──── revert ────────┘
```

- `status` is user-controlled; readiness does **not** gate publishing
  (readiness informs, never blocks — a merchant may knowingly publish an
  incomplete draft).
- archiving hides from feeds/context pickers but preserves history.
- delete removes product + variants + media (transactional); deleted
  products are not referenced by feed output.

---

## 5. Collection behavior

- create/rename/delete collections freely; deleting a collection does not
  touch its products (only removes the id from `products.collectionIds`).
- M1 is manual membership. AI-suggested collections ("customers often buy
  these together") are M2+ and always propose, never auto-apply.

---

## 6. Readiness rules

Readiness is **computed in queries, never stored** (derived state). It is
resolved **per variant, displayed per product** (ARCHITECTURE §1/§5).
A product's readiness is the worst of its variants'.

### Rule set (v1)

```text
CHECK TITLE            product.title present
CHECK DESCRIPTION      product.description present and ≥ 80 chars
CHECK IMAGE            ≥1 media with url; primary media has alt text
CHECK PRICE            every variant has priceCents > 0
CHECK AVAILABILITY     every variant has availability
CHECK INVENTORY        inventoryCount present when tracking enabled
CHECK SKU              variant.sku present            (severity: info)
CHECK IDENTIFIER       variant.gtin / identifierStatus: gtin present → pass;
                       identifierStatus "no_identifiers_exist" → pass with
                       feed identifier_exists=no; "unknown" → warning, fixType
                       user_input ("Does this product have a barcode/GTIN?").
                       GTIN missing is NEVER an error — Google supports
                       identifier_exists=no for handmade/custom/vintage goods.
CHECK FEED-FIELD OK    title length 1..150; description < 5000; image ≥ 250px
```

Each check result: `{ pass: boolean, severity: "error" | "warning" | "info",
field, fixType: "auto" | "user_input" | "external", message }`.

**fixType mapping (normative):**
- auto → missing alt text; description/SEO copy generation
- user_input → GTIN, SKU, price, inventory
- external → (M2) provider-side problems

### Fix policy enforcement

`canAIFix = fixType === "auto"`. The UI renders "Fix with MOSAI" only for
auto fixes; user_input fixes render the appropriate input. GTIN is
**never** offered as an AI suggestion under any framing.

---

## 7. Google feed mapping

Feed is a **projection**: generated on demand from Product + Variant +
Media; never stored as truth (a generated XML/JSON artifact plus a cached
status row at most).

```text
Per projected item (variant-level resolution):
  id            → externalId || `${productId}_${variantId}`
  title         → product.title (+ variant optionValues when explicit:
                   `${title} ${opts}`)
  description   → product.description
  link          → storefront/product URL (M1: project.websiteUrl + /products/slug;
                   absent websiteUrl → feed issue)
  image_link    → primary media url (variant media > product primary)
  availability  → canonical availability maps 1:1 (in_stock, out_of_stock,
                  preorder, backorder are all valid Google values). preorder/
                  backorder REQUIRE availability_date in the feed — missing
                  date is a readiness issue (fixType user_input). Never map
                  backorder to in_stock; a channel that cannot represent a
                  state surfaces a channel compatibility issue instead.
  price         → `${(priceCents/100).toFixed(2)} ${currency}`
  brand         → product.brand || project.businessName
  gtin          → variant.gtin (omit if absent — do not fabricate)
  mpn           → variant.sku (mpn fallback policy: use sku)
  identifier_exists → "no" when identifierStatus = no_identifiers_exist;
                  omitted otherwise
  item_group_id → productId for products with explicit variants (shared
                  across their items); omitted for default-variant products
  availability_date → variant.availabilityDate when availability is
                  preorder/backorder
  condition     → "new" (M1)
  product_type  → collections titles joined by " > "
```

**Feed status summary** (per product): `ready | needs_attention | blocked`
— blocked when a `severity: error` check fails.

M1 delivers the generated feed as a downloadable/viewable artifact in the
Sell module. Actual Merchant Center submission is M2+.

---

## 8. AI actions

All AI runs through the existing `ai.ts` action pattern (`"use node"`,
snapshot-based, no client-visible keys). Per ARCHITECTURE §6:

| Action | Tier | Semantics | Scope |
|---|---|---|---|
| `improveDescription` | safe | **fill missing** (empty field) or **improve** (proposal from existing; no overwrite) | description |
| `generateAltText` | safe | fill missing | alt text; requires an existing image |
| `generateSeo` | safe | fill missing | seoTitle + seoDescription → enrichment |
| `suggestAttributes` | evidence | suggestion with evidence line | productType/category proposal |

**Normative constraints:**
- Surgical: prompts receive the product's *missing* fields; generation of a
  field the user already filled is refused server-side.
- Never generated, under any action: gtin, sku, price, inventory, currency,
  shipping, warranty. The generation prompt includes this prohibition and
  the mutation re-validates (defense in depth).
- Every suggestion is returned as a **proposal** (not written) and applied
  by an explicit user action, recorded in `enrichment.origin`.
- Per-field on demand only in M1. Batch/selected-product operations are
  explicitly excluded (see §18).

---

## 9. AI evidence requirements

- `suggestAttributes` (evidence tier) must show its evidence line: which
  project context (industry, productsServices, snapshot) informed it.
- Alt-text generation from an *image the product actually has*; if no image
  exists, alt text is not offered.
- All proposals display: input context summary + model provenance is
  retained server-side in the action (M1: action args are enough; dedicated
  audit rows are M2).

---

## 10. UX journeys

### J1 — New catalog
Enter Sell → empty state offers "Add product manually", "Ask MOSAI to
prepare drafts" (uses project context) → first product created in < 1 min.

### J2 — Add product
Dialog: title (required) → price + currency → inventory → image URL →
status. Server auto-creates default variant. Save → land on product with
readiness visible.

### J3 — Improve with MOSAI
Product inspector shows readiness issues → "Fix with MOSAI" on an auto
issue → proposal card (diff-style preview) → Apply / Discard.

### J4 — Resolve readiness
Readiness list per product → user_input issues open the right input
(GTIN field, price field) → re-computed immediately after save.

### J5 — Generate Google feed
"Feed" tab → readiness summary (N ready / M need attention / K blocked) →
view/download generated XML → issues link back to the specific product.

### J6 — Use product in Content (context level)
Create module product picker (existing dialog pattern) → selecting a
product injects title/description/enrichment into the AI brief context.

### J7 — Use product in Website/Build
Build page drafts can reference `productId`; rendered draft shows live
title/price placeholder resolved from canonical data.

### J8 — Use product in Campaign
Campaign create dialog gains a product context picker (same component as
J6).

### J9 — Ask MOSAI about product
Product inspector action "Ask MOSAI" opens the existing AI action with
product context prepended.

---

## 11. Screens

```text
SELL (tabs)
├ Products        list + inspector pattern (rows on desktop; card/detail on mobile)
│   └ ProductInspector  (side panel ≥lg, full-screen sheet < lg)
├ Collections     simple CRUD grid
├ Feed            Google projection status + generator + issues
└ Store           mode setup (M1: native only; M2 adds "Connect a store")
```

Reuses: `ModuleHeader`, `StatusBadge`, `SourceChip`, `Stat`, `ConfirmDelete`,
`ModuleEmpty` from `module-kit.tsx`; no new design primitives.

---

## 12. Empty / loading / error states

- Empty catalog: `ModuleEmpty` with J1 actions.
- Loading: `Loader2` spinners (house rule — no skeletons).
- AI failure: toast with retry; proposal state unchanged.
- Feed with 0 ready products: not an error — explanatory empty state with
  readiness CTA.
- Deleted product referenced by a collection: silently de-referenced; no
  dangling ids rendered.
- Save conflicts: last-write-wins with `updatedAt` toast note (M1; M2
  introduces real conflict policy with external authority).

---

## 13. Cross-module contracts

```text
useProjectSnapshot      gains products: Array<{ id, title, description,
                        priceCents, currency, status, readiness? }> —
                        only status:"active" products, capped (e.g. 50)
Content (Create)        product picker → AI brief context
Build                   page drafts may reference productId; renderer
                        resolves canonical title/price/image
Campaign                product context picker → campaign record stores
                        productIds (additive to existing schema)
Ask MOSAI               product context prepended to action payloads
```

Contract rule: other modules reference products **by id and read through
queries** — they never copy product data into their own tables.

---

## 14. Events (M1 minimal set)

```text
product.created        product.updated        product.published
product.archived       readiness.issue_detected   readiness.issue_fixed
feed.generated
```

M1: event rows are not persisted as a table; they are the analytics
instrumentation (§16) plus server-side console breadcrumb. A persisted
`commerceEvents` table arrives with M2 (per architecture §9 when consumers
exist).

---

## 15. Analytics instrumentation (pre-registered signals)

Instrumented per SELL-EXECUTION-PLAN; stored as lightweight rows in the
existing `insights`-adjacent pattern or app-level analytics log — decide
at implementation; the *signals are normative*:

```text
sell_product_created        {source: manual|ai_draft, hasPrice, hasImage}
sell_readiness_viewed       {productId, issueCount}
sell_fix_opened             {productId, checkId, fixType}
sell_fix_applied            {productId, checkId, origin: ai|user}
sell_fix_dismissed          {productId, checkId}
sell_product_used_in        {productId, surface: content|build|campaign|ask}
sell_feed_generated         {readyCount, attentionCount, blockedCount}
sell_session_return         (return visit within 7 days)
```

Time-to-value = first `sell_product_created` minus Sell entry timestamp.

---

### Feed states (content readiness ≠ publication)

`not_configured → needs_attention → ready` for the projection itself.
M1 stops at `ready` (downloadable artifact). `connected / published /
degraded` arrive with Merchant Center integration (M2+). Never label a
feed "published" because XML can be generated.

## 16. Acceptance tests

```text
AT1  create simple product → exactly one default variant auto-created;
     product presents title/price/inventory; UI shows no variant controls
AT2  add second explicit variant → default demotion rules hold; exactly
     one isDefault remains
AT3  readiness: product missing description+alt+gtin → DESCRIPTION/IMAGE-
     ALT show fixType auto; GTIN shows user_input; "Fix with MOSAI" offered
     ONLY for auto items
AT4  AI improveDescription refuses when description already present (server-side)
AT5  AI output can never contain gtin/sku/price (proposal applied without
     touching variant facts — verify variant row unchanged)
AT6  feed: default-variant product → exactly one item; explicit-variant
     product → one item per variant sharing item_group_id = productId
AT6b feed: identifierStatus=no_identifiers_exist → identifier_exists=no,
     no fabricated GTIN; unknown → item flagged, never silently omitted
AT6c feed: availability backorder without availabilityDate → readiness
     issue (user_input); backorder is NEVER remapped to in_stock
AT7  feed: product without websiteUrl on project → feed flagged with issue,
     not silently omitted
AT8  readiness resolves variant-level: one failing variant → product shows
     needs_attention with the variant named
AT9  collection delete → products de-referenced, intact
AT10 archived product absent from snapshot products[] and feed
AT11 all CRUD guarded: unauthenticated/foreign-project access returns null/error
AT12 non-owner (plan below growth) blocked by assertModule — module gate works
```

---

## 17. Explicit M1 exclusions

```text
Explicit variant-management UI (model ready; UX deferred to M2 with real data)
Multi-image gallery UI (single image field writes to media[])
Meta / TikTok feed channels
Merchant Center submission (M1 generates the artifact only)
Batch AI operations / "fix all" on selections
Write-back of any kind; external connectors; sync
commerceEvents table, automation triggers
Storefront, cart, checkout — anything in M3
```
