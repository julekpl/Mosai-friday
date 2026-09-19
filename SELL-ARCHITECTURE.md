# MOSAI Sell — Architecture

> Status: ENDURING DOMAIN RULES. These invariants survive implementation
> changes and hypothesis outcomes. They are deliberately implementation-
> neutral: they say *what must hold*, never *which stack delivers it*.
>
> ## Change control
>
> **Any implementation change that violates or changes a Sell architecture
> invariant must update this document in the same change, before the new
> behavior is considered accepted.**
>
> Each invariant carries a status. Invariants are changed only by an
> explicit architecture decision with owner approval — never casually,
> because a shortcut was convenient.

---

## 0. Governing principle

> **Simple interface ≠ simplistic architecture.**

The UX may hide complexity (a simple product is really one variant; one
visible image is really a media list). The domain model never is
simplified to match a first UI.

---

## 1. Product & Variant

**INVARIANT — every Product has at least one Variant.** `Status: ACTIVE`

```text
Simple products:
- one implicit/default variant
- variant is hidden in ordinary UX
- product presents as a simple product

Complex products:
- multiple explicit variants
- variant controls become visible
```

A simple product carries title, price, stock in its default variant.
Nothing in the UI forces users to know the variant exists.

Variant attributes include SKU, GTIN/barcode, option values, price,
compare-at price, inventory, weight/dimensions, availability, image.

**INVARIANT — projection resolution.** `Status: ACTIVE`

```text
Implicit default variant → one feed item

Explicit variants → separate feed items
where channel semantics require it
```

Readiness, feeds and channel projections resolve **variant-level truth**
always. Readiness may be *displayed* at product level (aggregated from
its variants) but must never hide a variant-level failure behind a
product-level "ready."

**INVARIANT — product identity ≠ product presentation.** `Status: ACTIVE`

Canonical products contain commercial facts. Content/creative layers
(product story, buying guides, SEO copy, campaign copy) are separate
artifacts referencing the product — they never silently rewrite the
canonical record.

---

## 2. Product composition

```text
Product
├ commerce facts        (price, inventory, SKU, GTIN, identifiers, shipping/tax)
├ external references   (provider, externalId, syncState, lastSyncedAt)
├ channel projections   (feed items per channel — derived, never canonical)
└ MOSAI enrichment      (buyer objections, content opportunities, readiness
                         assessment, AI recommendations, campaign relationships)
```

**INVARIANT — field-level authority.** `Status: ACTIVE`

Authority is recorded per object **and may be recorded per field**.
An external product is not purely "owned by Shopify": commerce facts
(price, inventory, SKU) belong to the provider, while MOSAI-owned
enrichment belongs to MOSAI. The two are never merged into one
indistinguishable blob, because what is safe to sync back depends on
which fields the provider actually owns.

**INVARIANT — imported products are not copies.** `Status: ACTIVE`

For external stores:

```text
External product → normalized MOSAI representation → MOSAI enrichment
```

The normalized representation exists so MOSAI can reason consistently
across providers. It must not behave as an independently editable clone
of the provider unless write-back is explicitly enabled (see §8).

---

## 3. Source authority

**INVARIANT — every commerce object carries its source.** `Status: ACTIVE`

```text
source         mosai_native | external
provider       shopify | woocommerce | … (when external)
externalId     stable provider-side identity (never a name/title/SKU)
authority      who owns the truth for this object/field
lastSyncedAt   freshness, always visible where data is displayed
syncState      synced | syncing | needs_attention | disconnected | unsupported
```

Object identity for external records is the external ID, never titles,
names or SKUs.

**INVARIANT — remote provider wins.** `Status: ACTIVE`

For external-authoritative objects, the remote provider wins conflicts by
default. Local edits to external commerce facts are not persisted as
truth; they are either write-back proposals (§8) or discarded on sync.

---

## 4. Collections & media

**INVARIANT — collections group products; they never own product data.**
`Status: ACTIVE`

Collections reference products by ID. Membership drives navigation,
campaign targeting, content, email, ads and feed grouping.

**INVARIANT — media is a list.** `Status: ACTIVE`

Products carry `media[]` (primary image, gallery, per-variant image,
alt text; video is future). A single "add image" affordance in early UX
writes to the list; the model is never reduced to one URL.

---

## 5. Feeds & channel projections

**INVARIANT — feeds are projections, never canonical product truth.**
`Status: ACTIVE`

```text
Canonical Product
→ Channel Mapper (GoogleMerchantMapper, MetaCatalogMapper, …)
→ FeedProjection (per channel)
→ Validator → FeedIssue[]
→ Feed Status
```

Channel data is regenerated from canonical truth; it is never edited in
place and never stored as product truth.

**INVARIANT — readiness over error codes.** `Status: ACTIVE`

Users see "4 products need attention — Google needs a product identifier,"
not `merchant_error: missing_gtin`. Technical codes live behind an
Advanced/diagnostics affordance. Every issue states what happened, why it
matters, and what to do.

---

## 6. AI policy

**INVARIANT — AI never fabricates commercial facts.** `Status: ACTIVE`

AI may generate: description, short description, SEO title/description,
alt text, category/collection suggestions, benefit copy, FAQs, content
ideas — always as *reviewable suggestions*.

AI must never invent: GTIN, SKU, price, inventory, tax, warranty,
shipping promises, legal certification, product composition — unless the
value is directly supported by a source the user supplied.

**INVARIANT — AI fixes are confidence-tiered.** `Status: ACTIVE`

```text
Safe (apply directly, still reviewable):
  alt text from image · rewrite supplied copy · shorten title · meta description

Requires evidence (ask, never guess):
  material · dimensions · compatibility · use cases

Never infer:
  GTIN · price · inventory · certification · warranty · shipping date
```

**INVARIANT — AI enrichment is surgical, not wholesale.** `Status: ACTIVE`

Enrichment fills what is missing; it does not regenerate what is good. A
product with a good title/description and missing alt text gets alt text
only. Bulk operations require explicit batch flows with limits and cost
transparency — a "Fix all" button must never become an accidental
catalog-wide generation event.

---

## 7. Connectors

**INVARIANT — one interface, capability-negotiated.** `Status: ACTIVE`

All external platforms implement one MOSAI-owned connector interface
(products, collections, inventory, orders, customers, optional writes,
webhooks). The UI adapts to declared capabilities and expresses them in
plain language ("MOSAI can read products and orders; MOSAI cannot yet
change prices") — never as technical flags.

**INVARIANT — a connector is supported only after live acceptance.**
`Status: ACTIVE`

Auth/reconnect, token expiry, pagination, rate limits, webhook
create/update/delete, idempotency, currency, timezone, deletions, partial
failures, stale data, permission downgrade, disconnect, reconciliation.
An API route existing is not support. Connectors are added one at a time,
ordered by validated user demand.

---

## 8. Sync & write-back

**INVARIANT — sync must remain correct even if webhook delivery is
delayed, duplicated, missed, or temporarily unavailable.** `Status: ACTIVE`

Architectural consequence: synchronization is built from webhooks +
reconciliation + idempotency. Whether reconciliation is performed by a
cron, queue, worker, scheduled function or workflow engine is an
implementation decision, not an architecture assumption. Webhooks are an
optimization, never a correctness dependency.

**INVARIANT — default external posture is read-only.** `Status: ACTIVE`

```text
Default:   read · analyse · recommend
Later:     review → approve → write back (with provider receipt + re-sync)
Never:     AI silently changes remote commerce data
```

Any external write-back flows through an explicit propose → human approve
→ execute → receipt → re-sync cycle.

**INVARIANT — disconnect preserves history.** `Status: ACTIVE`

Disconnecting stops live sync and disables writes; historical observations
remain until the user separately chooses to delete imported data (which
obeys retention/privacy rules). Migration between modes is an explicit,
separate workflow — never automatic.

---

## 9. Commerce events

**INVARIANT — commerce behavior is emitted as normalized events.**
`Status: ACTIVE`

Events such as `product.created`, `inventory.changed`, `cart.abandoned`,
`order.paid`, `order.fulfilled`, `feed.issue_detected` carry source,
object IDs, timestamp and schema version. Events drive CRM, automation,
analytics, Grow and recommendations; every consumer reads the same event
vocabulary regardless of provider.

**INVARIANT — no invisible metric blending.** `Status: ACTIVE`

Numbers from different sources are never silently merged. Each figure
displays its source and freshness; honest disagreement between sources is
shown as disagreement, with a path to review — never averaged away.

---

## 10. Independence

**INVARIANT — Sell stands alone.** `Status: ACTIVE`

Sell must be fully useful with zero personas, journeys, content, CRM or
ads configured. It asks only for the minimum information it needs.
Connected context accelerates; it is never a prerequisite. Conversely,
commerce context must never be *silently required* by other modules.

**INVARIANT — commerce truth is single-sourced.** `Status: ACTIVE`

No second product truth, customer truth, permission system, campaign
system or analytics semantic model is introduced. External providers are
adapters; MOSAI intelligence sits above them.
