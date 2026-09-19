# MOSAI Sell — Vision

> Status: NORTH STAR. This document describes ambition, not delivery order.
> Sequencing lives in `SELL-EXECUTION-PLAN.md`. Enduring domain rules live in
> `SELL-ARCHITECTURE.md`. Nothing here is a commitment.

---

## 1. The defining idea

> MOSAI should be able to **run the store** or **understand the store**.
> Everything above the commerce boundary should work the same either way.

MOSAI Sell is not "another Shopify admin" and not "just a product feed tool."
It is a **commerce operating layer inside MOSAI**.

The same loop must work whether the underlying store is MOSAI-native,
Shopify, WooCommerce, Medusa, Vendure, Saleor, or anything else:

```text
UNDERSTAND CUSTOMER → CREATE CONTENT → SELL PRODUCT → CAPTURE CUSTOMER
→ FOLLOW UP → PROMOTE → MEASURE → LEARN ↺
```

> Design principle: **Commerce infrastructure can differ.
> MOSAI intelligence and user experience should not.**

---

## 2. Strategic hypotheses

Sell's future is decided by evidence against three hypotheses. They are
mutually compatible — more than one can be true — but they imply very
different investments.

### Hypothesis A — Commerce Intelligence

> Merchants want MOSAI to understand and improve the commerce stack
> they already use.

Connected Shopify/Woo merchants use MOSAI for product quality, feed
readiness, customer intelligence, content, campaigns, ads, automation and
growth advice — without migrating. If A dominates, connectors and the
intelligence layer are the product.

### Hypothesis B — Native Commerce

> A meaningful segment also wants MOSAI to replace the commerce stack
> itself.

These merchants want storefront, cart, checkout, payments, orders,
refunds and fulfilment run by MOSAI. If B proves out, native transactions
become a major investment. If B is weak, native checkout may **never** be
built — and that is an acceptable outcome.

### Hypothesis C — Commerce as context, not destination

> Users primarily interact with Content, Campaigns, Grow and Ask MOSAI;
> Sell quietly supplies product/order context underneath.

If C dominates, the correct decision is not "expand Sell" but to treat
commerce as a **capability** woven through other modules rather than a
major top-level product area.

The execution plan's decision gates exist to resolve A / B / C with
evidence, not opinion.

---

## 3. The two Sell modes

### Mode A — Build and run my store with MOSAI

MOSAI is the canonical source of truth for products, variants,
collections, inventory, prices, promotions, storefront, cart, checkout,
orders, refunds, fulfilment state and feeds.

```text
MOSAI Commerce → MOSAI Storefront → Cart → Checkout
→ Payment provider → Order → CRM → Automation / Campaign / Grow
```

### Mode B — Connect my existing store

The external platform remains authoritative for the data it owns. MOSAI
connects through an adapter and builds a normalized projection:

```text
External store → CommerceConnector → MOSAI normalized projection
→ Intelligence / Content / CRM / Campaigns / Ads / Automation / Grow
```

MOSAI never pretends to own external commerce state.

Users never see the words "projection," "connector," or "authority."
The first Sell screen asks:

```text
How do you sell today?

[ Build my store with MOSAI ]

[ Connect an existing store ]
```

And surfaces show either `Managed in MOSAI` or `Synced from Shopify`.

---

## 4. Future surface (no sequencing promised)

Everything below is in-scope for the vision, in some order, conditional
on the hypotheses:

**Catalog & commerce core** — products, variants, collections, media,
inventory, prices, promotions, shipping/tax profiles.

**Storefront & transactions** — storefront generation from business
context, commerce component blocks referencing canonical IDs, cart,
checkout with a PaymentProvider boundary, orders, refunds, fulfilment.

**Connected commerce** — one connector at a time, each "supported" only
after live acceptance testing; capability negotiation surfaced in plain
language; sync states in user language; controlled write-back behind
review-and-approve.

**Feeds** — channel projections (Google Merchant, Meta Catalog, TikTok),
readiness engine, AI-assisted fixing, feed health.

**Cross-module integration** — commerce as context for Content,
Website/Build, Campaigns, Email, Social, Ads, CRM, Customer
Intelligence, Automation, Grow and Ask MOSAI — at whatever integration
level the evidence supports.

**AI** — contextual product assistance, readiness fixing with a strict
fact policy, merchandising recommendations, Ask MOSAI over commerce.

---

## 5. North-star outcomes

Sell succeeds when these statements are true:

```text
A new merchant can create a credible online shop without ecommerce expertise.

An existing Shopify/WooCommerce merchant can connect MOSAI without migrating.

Products flow into content, website, email, social and ads without re-entering data.

Orders automatically enrich CRM and analytics.

AI helps users understand and improve commerce, but never fabricates commercial facts.

Every feed problem explains what is wrong and how to fix it.

Every commerce insight leads to an understandable action.

A connected store becomes more valuable because it participates in the whole MOSAI ecosystem.

Sell remains useful even when nothing else in MOSAI has been set up —
connected context is an accelerator, never a prerequisite.
```
