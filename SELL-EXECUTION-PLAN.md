# MOSAI Sell — Execution Plan

> Status: CURRENT DELIVERY SEQUENCE. Scope, acceptance and decision gates
> only. Ambition lives in `SELL-VISION.md`; the rules that must not break
> live in `SELL-ARCHITECTURE.md`.
>
> Decision gates use **pre-registered signals** (defined before launch) and
> **decision questions**, not invented thresholds. Thresholds are set from
> early beta data once signals exist.

---

## Integration levels

"Integrated" is made testable by levels. Each milestone names its level
explicitly; a milestone is not done because its integrations are
"planned," but because its level is demonstrated.

### Level 1 — Context
Products become available to other modules. No commerce behavior required.

```text
Product → Content
Product → Website/Build
Product → Campaign
Product → Ask MOSAI
```

### Level 2 — Signals
Real commerce behavior informs downstream modules.

```text
Inventory · Orders · Views · Purchases · Feed status
→ CRM · Grow · Ads · Customer Intelligence
```

### Level 3 — Actions / Closed loop
Signal → recommendation → approval → action in Content/Website/Campaign/
Automation → measured outcome.

---

## M1 — COMMERCE BRAIN

**Hypothesis tested:** A (commerce intelligence on a MOSAI-native catalog)
and partially C (products as context for the rest of MOSAI).

### User problem

A business owner can list products somewhere, but nothing tells them what
is missing, what is broken, or how to get their catalog selling across
channels — and their product data is trapped, unable to power content,
website or campaigns.

### In scope

```text
Product management
Default/explicit variant model (default variant hidden in ordinary UX)
Collections
Media model (media[] with primary image; single-image UX is fine)
Basic inventory
Source / authority / external reference fields (from day one)
Readiness engine (per-product, aggregated from variants)
Google Merchant feed projection
AI product improvement (confidence-tiered, surgical)
```

Integration level: **CONTEXT** — products usable in Content,
Website/Build, Campaign, Ask MOSAI.

### Out of scope

```text
Explicit variant-management UX (model supports it; UI arrives with M2 data)
Multi-image gallery UI
Storefront, cart, checkout, payments, orders, refunds
External connectors and sync
Meta/TikTok feed channels
Automation triggers
Write-back of any kind
```

### Acceptance

```text
A user creates products and sees readiness states that match reality
(exercising the variant-level projection rule, incl. the default-variant case).
A readiness issue explains what is wrong, why it matters, and offers a fix —
with AI fixes limited to the safe tier and GTIN/price/inventory never offered.
The Google feed projection regenerates from canonical products and contains
one item for a default-variant product.
A product appears as selectable context in Content, Build and Campaign.
Every AI suggestion records its input context and is reviewable before apply.
```

### Pre-registered signals (instrument at launch)

```text
Product activation
- product created/imported
- product reaches readiness state (any channel-ready state)

Readiness engagement
- recommendation viewed
- fix opened
- fix applied
- fix dismissed

Cross-module use (Context level)
- product used in Content
- product used in Website/Build
- product used in Campaign

Time-to-value
- time from Sell entry to first useful outcome

Return behavior
- user returns to Sell
- user updates products
- user acts on another recommendation
```

### Decision gate (M1 → M2)

Continue into M2 if, on review of the signals:

```text
Users repeatedly act on readiness recommendations,
AND/OR products measurably increase usage of Content / Build / Campaign,
AND merchants treat catalog/feed assistance as solving a real problem
(not a novelty).
```

Otherwise: simplify or reposition Sell before investing in connectors.

---

## M2 — CONNECTED COMMERCE

**Hypothesis tested:** A vs B — does "understand my existing store"
deliver more value than native features would?

### User problem

A merchant already sells on Shopify (or WooCommerce — platform chosen by
validated target-market demand, exactly one platform first). They will not
migrate. They want MOSAI to understand their store and make the rest of
MOSAI work off it.

### In scope (sequenced strictly in this order)

```text
1. Connect (OAuth/API) + capability negotiation in plain language
2. Product import
3. Variant import (this is where explicit-variant UX earns its existence)
4. Collection import
5. Inventory import
6. Manual sync ("Sync now") + scheduled pull
7. Readiness applied to imported products
8. AI enrichment on imported products
9. Content/Campaign reuse of imported products
```

Then, only after the catalog layer proves itself:

```text
10. Orders import
11. CRM customer linking (identity match → Contact; consent stays owned by CRM)
```

Integration level: **SIGNALS** once orders/purchases flow.

### Out of scope

```text
Write-back (propose → approve → execute arrives later, using the
  established change-request pattern)
Webhook-first sync (sync design assumes webhooks may fail per the
  architecture invariant; reconciliation is the baseline)
Second and third connectors
Meta/TikTok feeds (add only if Google projection has real usage)
```

### Acceptance

```text
An external merchant connects, imports their catalog, and sees readiness
states without MOSAI claiming to own provider truth.
Sync survives a missed/duplicated sync cycle without producing duplicates
or stale-silent data (idempotency + reconciliation demonstrated).
Imported products flow into Content/Campaign with source labels visible.
Disconnection preserves history and explains itself in plain language.
```

### Decision gate (M2 → direction)

Evidence is evaluated against the three vision hypotheses:

```text
A. Commerce Intelligence — connected stores show the strongest engagement:
   → expand connectors, deepen intelligence, feeds, automation.

B. Native Commerce — merchants ask MOSAI to run commerce too:
   → invest in M3.

C. Commerce as supporting context — products/orders mainly power other
   modules while Sell's standalone surface sees little direct use:
   → reduce standalone Sell surface; treat commerce as a capability.

Possibly: A + B together, with sequencing decided by which signal is
stronger.
```

---

## M3 — NATIVE COMMERCE  ·  CONDITIONAL

**Built only if the M2 gate returns B (or a strong A+B).** If evidence
never supports B, this milestone may never be built — that is an
acceptable outcome, not a failure.

### In scope (when triggered)

```text
Storefront generation from business context
Commerce component blocks referencing canonical IDs (never copied data)
Cart
Checkout with a PaymentProvider boundary (payment truth from the provider's
  authoritative events, never from browser redirects)
Orders, inventory reservation
Refunds, fulfilment
CRM capture on every completed purchase
```

### Acceptance

```text
The full journey works end-to-end:
create store → add product → AI improves it → collection → storefront →
publish → cart → checkout → payment → order → CRM → automation → Grow insight.
Guest checkout supported; order email separated from marketing consent;
consequential actions auditable.
```

### Decision gate

Native commerce continues only while it outperforms the alternatives on
the same signals (activation, time-to-value, return behavior). If
connected-commerce intelligence consistently outperforms, native
transactions are reduced to the minimum that Hypothesis-B customers
demonstrably need.

---

## Standing rules

```text
1. Architecture invariants (SELL-ARCHITECTURE.md) bind every milestone.
   A change that violates one must update the document in the same change.

2. One connector / one channel / one platform at a time — supported means
   live-acceptance-tested, never "code path exists."

3. AI cost control is architectural: surgical enrichment, per-field
   generation, batch flows with explicit limits for large catalogs.

4. Sell stands alone: no milestone may make another module a prerequisite.
```
