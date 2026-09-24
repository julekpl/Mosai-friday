import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  assertStripeModeAllowed,
  stripeMode,
  verifyStripeSignature,
} from "@/convex/lib/stripe";
import { WIND_DOWN_GRACE_MS } from "@/convex/lib/billingCatalog";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * T2.4 — Stripe billing (checkout, portal, webhooks, dunning, reconciliation)
 * and the platform admin panel.
 *
 * The acceptance criteria this suite pins down:
 *   - duplicate deliveries change nothing twice;
 *   - out-of-order deliveries change nothing (a late replay cannot un-do a
 *     newer state);
 *   - a browser redirect (a completed checkout on its own) never grants a plan;
 *   - reconciliation reports 0 drift in a consistent state and names every
 *     disagreement otherwise;
 *   - `past_due` → `wind_down` is honest and does not delete anything;
 *   - the operator allow-list grants the bootstrap admin, and the panel refuses
 *     everyone else;
 *   - a regression for the invoice-before-subscription defect.
 *
 * No network is used: the webhook apply and the reconciliation apply are
 * internal functions the tests call directly, exactly as the cron/http route
 * would.
 */

async function seedOrg(t: TestBackend, email = "owner@example.com") {
  const user = await seedUser(t, { name: "Owner", email });
  const organizationId = await user.as.mutation(api.organizations.create, {
    name: "Acme",
    kind: "business",
  });
  return { user, organizationId };
}

function subscriptionEvent(input: {
  organizationId: string;
  eventId: string;
  created: number;
  status?: string;
  plan?: string;
}) {
  const plan = input.plan ?? "starter";
  return {
    eventId: input.eventId,
    type: "customer.subscription.updated",
    created: input.created,
    livemode: false,
    objectId: "sub_1",
    data: {
      id: "sub_1",
      object: "subscription",
      status: input.status ?? "active",
      customer: "cus_1",
      current_period_end: 2_000_000_000,
      cancel_at_period_end: false,
      metadata: {
        mosai_organization: input.organizationId,
        mosai_plan: plan,
      },
      items: {
        data: [{ price: { id: "price_1", metadata: { mosai_plan: plan } } }],
      },
    },
  };
}

describe("T2.4 — webhook idempotency and ordering", () => {
  it("a duplicate delivery changes nothing twice", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    const event = subscriptionEvent({
      organizationId,
      eventId: "evt_dup",
      created: 1000,
    });

    const first = await t.mutation(internal.billingWebhooks.applyEvent, event);
    expect(first).toMatchObject({ applied: true, duplicate: false });

    const second = await t.mutation(internal.billingWebhooks.applyEvent, event);
    expect(second).toMatchObject({ applied: false, duplicate: true });

    const subscriptions = await t.run((ctx) =>
      ctx.db.query("subscriptions").collect(),
    );
    expect(subscriptions).toHaveLength(1);
    const events = await t.run((ctx) => ctx.db.query("billingEvents").collect());
    expect(events).toHaveLength(1);
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("starter");
    expect(owner?.planStatus).toBe("active");
  });

  it("an out-of-order delivery does not un-do a newer state", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await t.mutation(
      internal.billingWebhooks.applyEvent,
      subscriptionEvent({
        organizationId,
        eventId: "evt_new",
        created: 2000,
        status: "active",
      }),
    );
    // A late replay of an older event that would cancel the subscription.
    const late = await t.mutation(
      internal.billingWebhooks.applyEvent,
      subscriptionEvent({
        organizationId,
        eventId: "evt_old",
        created: 1000,
        status: "canceled",
      }),
    );
    expect(late).toMatchObject({
      applied: false,
      note: "out-of-order delivery",
    });

    const subscription = await t.run((ctx) =>
      ctx.db.query("subscriptions").first(),
    );
    expect(subscription?.status).toBe("active");
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("starter");
    expect(owner?.planStatus).toBe("active");
  });

  it("a browser redirect (a completed checkout alone) never grants a plan", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    const result = await t.mutation(internal.billingWebhooks.applyEvent, {
      eventId: "evt_checkout",
      type: "checkout.session.completed",
      created: 500,
      livemode: false,
      objectId: "cs_1",
      data: {
        id: "cs_1",
        object: "checkout.session",
        customer: "cus_1",
        client_reference_id: organizationId,
        amount_paid: 2900,
        currency: "eur",
        metadata: {
          mosai_organization: organizationId,
          mosai_plan: "starter",
        },
      },
    });

    expect(result).toMatchObject({ applied: true });
    // The receipt exists…
    const receipts = await t.run((ctx) =>
      ctx.db.query("billingReceipts").collect(),
    );
    expect(receipts).toHaveLength(1);
    // …but the entitlement was NOT granted: no subscription was confirmed.
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("free");
    expect(
      await t.run((ctx) => ctx.db.query("subscriptions").collect()),
    ).toHaveLength(0);
  });

  it("an invoice that arrives before its subscription is ignored (regression)", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    // A paying customer already granted by a support override.
    await t.run((ctx) =>
      ctx.db.patch(user.userId as Id<"users">, {
        plan: "growth",
        planStatus: "active",
      }),
    );

    // The invoice races ahead of the subscription mirror.
    const result = await t.mutation(internal.billingWebhooks.applyEvent, {
      eventId: "evt_invoice_race",
      type: "invoice.payment_failed",
      created: 10,
      livemode: false,
      objectId: "in_1",
      data: {
        id: "in_1",
        object: "invoice",
        status: "open",
        subscription: "sub_not_mirrored",
        amount_due: 7900,
        amount_paid: 0,
        currency: "eur",
        attempt_count: 1,
        subscription_details: {
          metadata: { mosai_organization: organizationId },
        },
      },
    });
    expect(result).toMatchObject({
      applied: false,
      note: "invoice arrived before its subscription was mirrored",
    });

    // Before the fix, `syncEntitlement` found no governing subscription and
    // silently downgraded this customer to free.
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("growth");
    expect(owner?.planStatus).toBe("active");
  });
});

describe("T2.4 — reconciliation reports entitlement drift", () => {
  it("reports 0 drift when the mirror matches the provider", async () => {
    const t = newBackend();
    const { organizationId } = await seedOrg(t);
    await t.mutation(
      internal.billingWebhooks.applyEvent,
      subscriptionEvent({ organizationId, eventId: "evt_1", created: 1000 }),
    );

    const run = await t.mutation(
      internal.billingWebhooks.applyReconciliation,
      {
        source: "test",
        providerRows: [
          {
            organizationId,
            subscriptionId: "sub_1",
            plan: "starter",
            status: "active",
            priceId: "price_1",
          },
        ],
      },
    );
    expect(run.driftCount).toBe(0);
    expect(run.checked).toBe(1);
  });

  it("names every disagreement when a plan drifts", async () => {
    const t = newBackend();
    const { organizationId } = await seedOrg(t);
    await t.mutation(
      internal.billingWebhooks.applyEvent,
      subscriptionEvent({ organizationId, eventId: "evt_1", created: 1000 }),
    );

    const run = await t.mutation(
      internal.billingWebhooks.applyReconciliation,
      {
        source: "test",
        providerRows: [
          {
            organizationId,
            subscriptionId: "sub_1",
            plan: "growth",
            status: "active",
            priceId: "price_1",
          },
        ],
      },
    );
    expect(run.driftCount).toBeGreaterThan(0);
    const kinds = run.drifts.map((drift) => drift.kind);
    expect(kinds).toContain("plan_mismatch");
    expect(kinds).toContain("mirror_mismatch");
  });
});

describe("T2.4 — past_due winds down honestly", () => {
  it("keeps entitlement during the grace period, then moves to wind_down", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(
      internal.billingWebhooks.applyEvent,
      subscriptionEvent({
        organizationId,
        eventId: "evt_past_due",
        created: 1000,
        status: "past_due",
      }),
    );

    // Grace period: still entitled, honest `past_due` status.
    let owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("starter");
    expect(owner?.planStatus).toBe("past_due");

    // Past the grace period the sweep winds it down; nothing is deleted.
    const sweep = await t.mutation(internal.billingWebhooks.windDownSweep, {
      now: Date.now() + WIND_DOWN_GRACE_MS + 60_000,
    });
    expect(sweep.moved).toBe(1);

    owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.planStatus).toBe("wind_down");
    expect(owner?.plan).toBe("free");
    const subscription = await t.run((ctx) =>
      ctx.db.query("subscriptions").first(),
    );
    expect(subscription?.status).toBe("wind_down");
  });
});

describe("T2.4 — Stripe client guards", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
  });

  it("refuses a live key unless the owner opted in", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    expect(stripeMode()).toBe("live");
    expect(() => assertStripeModeAllowed()).toThrow(/live key/i);

    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    expect(stripeMode()).toBe("test");
    expect(() => assertStripeModeAllowed()).not.toThrow();
  });

  it("verifies a webhook signature and rejects a stale or wrong one", async () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_1", type: "x", created: 1 });
    const stamp = 1_700_000_000;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${stamp}.${payload}`),
    );
    const signature = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const valid = await verifyStripeSignature({
      payload,
      header: `t=${stamp},v1=${signature}`,
      secret,
      now: stamp,
    });
    expect(valid.valid).toBe(true);

    const wrong = await verifyStripeSignature({
      payload,
      header: `t=${stamp},v1=deadbeef`,
      secret,
      now: stamp,
    });
    expect(wrong.valid).toBe(false);

    const stale = await verifyStripeSignature({
      payload,
      header: `t=${stamp},v1=${signature}`,
      secret,
      now: stamp + 10_000,
    });
    expect(stale.valid).toBe(false);

    const unconfigured = await verifyStripeSignature({
      payload,
      header: `t=${stamp},v1=${signature}`,
      secret: null,
      now: stamp,
    });
    expect(unconfigured.valid).toBe(false);
  });
});

describe("BP-06/S1 — customer catalog and cancellation", () => {
  const envKeys = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_STARTER",
    "STRIPE_PRICE_GROWTH",
    "STRIPE_PRICE_SCALE",
    "STRIPE_BILLING_PORTAL_CONFIGURATION",
    "MOSAI_APP_ORIGIN",
  ] as const;
  const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function clearBillingConfig() {
    for (const key of envKeys) delete process.env[key];
  }

  function configureTestCatalog() {
    process.env.STRIPE_SECRET_KEY = ["sk", "test", "fixture"].join("_");
    process.env.STRIPE_PRICE_STARTER = "price_test_starter";
    process.env.STRIPE_PRICE_GROWTH = "price_test_growth";
    process.env.STRIPE_PRICE_SCALE = "price_test_scale";
    process.env.MOSAI_APP_ORIGIN = "https://mosai.example";
  }

  function configureTestPortal() {
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = "bpc_test_safe";
  }

  function stubCatalogFetch(includePlanMetadata = true) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const plan = url.includes("starter")
        ? "starter"
        : url.includes("growth")
          ? "growth"
          : "scale";
      const priceId = `price_test_${plan}`;
      return new Response(JSON.stringify({
        id: priceId,
        active: true,
        livemode: false,
        unit_amount: plan === "starter" ? 1299 : plan === "growth" ? 4999 : 9999,
        currency: "eur",
        tax_behavior: "exclusive",
        ...(includePlanMetadata ? { metadata: { mosai_plan: plan } } : {}),
        recurring: { interval: "month", interval_count: 1 },
        product: { id: `prod_${plan}`, name: `Provider ${plan}`, active: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("displays only active recurring Stripe test prices and product names", async () => {
    clearBillingConfig();
    configureTestCatalog();
    stubCatalogFetch();
    const t = newBackend();
    const { user } = await seedOrg(t);

    const catalog = await user.as.action(api.billing.catalog, {});
    expect(catalog.configured).toBe(true);
    expect(catalog.mode).toBe("test");
    expect(catalog.plans.find((entry) => entry.plan === "starter")).toMatchObject({
      configured: true,
      productName: "Provider starter",
      priceId: "price_test_starter",
      amountMinor: 1299,
      currency: "EUR",
      interval: "month",
      intervalCount: 1,
      taxBehavior: "exclusive",
    });
    expect(catalog.portalReady).toBe(false);
  });

  it("returns needs-setup plan entries without making provider calls when test setup is absent", async () => {
    clearBillingConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user } = await seedOrg(t);

    const catalog = await user.as.action(api.billing.catalog, {});
    expect(catalog.configured).toBe(false);
    expect(catalog.plans.find((entry) => entry.plan === "starter")).toMatchObject({
      configured: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose a Stripe live-mode price in the test catalog", async () => {
    clearBillingConfig();
    configureTestCatalog();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const plan = url.includes("starter")
        ? "starter"
        : url.includes("growth")
          ? "growth"
          : "scale";
      return new Response(JSON.stringify({
        id: `price_test_${plan}`,
        active: true,
        livemode: true,
        unit_amount: 1299,
        currency: "eur",
        tax_behavior: "exclusive",
        metadata: { mosai_plan: plan },
        recurring: { interval: "month", interval_count: 1 },
        product: { id: `prod_${plan}`, name: `Provider ${plan}`, active: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const t = newBackend();
    const { user } = await seedOrg(t);

    const catalog = await user.as.action(api.billing.catalog, {});
    expect(catalog.plans.find((entry) => entry.plan === "starter")).toMatchObject({
      configured: false,
    });
  });

  it("accepts a configured test price ID when Stripe price metadata is absent", async () => {
    clearBillingConfig();
    configureTestCatalog();
    stubCatalogFetch(false);
    const t = newBackend();
    const { user } = await seedOrg(t);

    const catalog = await user.as.action(api.billing.catalog, {});
    expect(catalog.plans.find((entry) => entry.plan === "starter")).toMatchObject({
      configured: true,
      priceId: "price_test_starter",
    });
  });

  it("rejects a configured test price whose present plan metadata conflicts", async () => {
    clearBillingConfig();
    configureTestCatalog();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const plan = url.includes("starter")
        ? "starter"
        : url.includes("growth")
          ? "growth"
          : "scale";
      return new Response(JSON.stringify({
        id: `price_test_${plan}`,
        active: true,
        livemode: false,
        unit_amount: 1299,
        currency: "eur",
        metadata: { mosai_plan: "scale" },
        recurring: { interval: "month", interval_count: 1 },
        product: { id: `prod_${plan}`, name: `Provider ${plan}`, active: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const t = newBackend();
    const { user } = await seedOrg(t);

    const catalog = await user.as.action(api.billing.catalog, {});
    expect(catalog.plans.find((entry) => entry.plan === "starter")).toMatchObject({
      configured: false,
    });
  });

  it("rejects client redirects outside the configured app billing page before provider calls", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = stubCatalogFetch();
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await expect(user.as.action(api.billing.startCheckout, {
      organizationId,
      plan: "starter",
      successUrl: "https://attacker.example/collect",
      cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
      expectedPriceId: "price_test_starter",
      expectedAmountMinor: 1299,
      expectedCurrency: "EUR",
    })).rejects.toThrow(/trusted app billing page/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an untrusted portal return URL before provider calls", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await expect(user.as.action(api.billing.openPortal, {
      organizationId,
      returnUrl: "https://attacker.example/collect",
    })).rejects.toThrow(/trusted app billing page/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the portal only with a retrieved test configuration that uses period-end cancellation", async () => {
    clearBillingConfig();
    configureTestCatalog();
    configureTestPortal();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/billing_portal/configurations/")) {
        return new Response(JSON.stringify({
          id: "bpc_test_safe",
          active: true,
          livemode: false,
          features: { subscription_cancel: { enabled: true, mode: "at_period_end" } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      expect(url).toContain("/billing_portal/sessions");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("configuration")).toBe("bpc_test_safe");
      return new Response(JSON.stringify({ url: "https://billing.stripe.test/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billing.recordCustomer, {
      organizationId,
      customerId: "cus_portal_test",
      createdBy: user.userId as Id<"users">,
      livemode: false,
    });

    const result = await user.as.action(api.billing.openPortal, {
      organizationId,
      returnUrl: "https://mosai.example/app/billing",
    });
    expect(result.url).toBe("https://billing.stripe.test/session");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a portal configuration that allows immediate cancellation", async () => {
    clearBillingConfig();
    configureTestCatalog();
    configureTestPortal();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "bpc_test_safe",
      active: true,
      livemode: false,
      features: { subscription_cancel: { enabled: true, mode: "immediately" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await expect(user.as.action(api.billing.openPortal, {
      organizationId,
      returnUrl: "https://mosai.example/app/billing",
    })).rejects.toThrow(/period-end or disabled cancellation/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a Stripe portal response omits the cancellation enabled flag", async () => {
    clearBillingConfig();
    configureTestCatalog();
    configureTestPortal();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "bpc_test_safe",
      active: true,
      livemode: false,
      features: { subscription_cancel: { mode: "at_period_end" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await expect(user.as.action(api.billing.openPortal, {
      organizationId,
      returnUrl: "https://mosai.example/app/billing",
    })).rejects.toThrow(/period-end or disabled cancellation/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops checkout when the displayed Stripe amount no longer matches", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        id: "price_test_starter",
        active: true,
        livemode: false,
        unit_amount: 1300,
        currency: "eur",
        tax_behavior: "exclusive",
        metadata: { mosai_plan: "starter" },
        recurring: { interval: "month", interval_count: 1 },
        product: { id: "prod_starter", name: "Provider Starter", active: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);

    await expect(user.as.action(api.billing.startCheckout, {
      organizationId,
      plan: "starter",
      successUrl: "https://mosai.example/app/billing?checkout=success",
      cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
      expectedPriceId: "price_test_starter",
      expectedAmountMinor: 1299,
      expectedCurrency: "EUR",
    })).rejects.toThrow(/catalog changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/prices/price_test_starter");
  });

  it("schedules cancellation at period end only after Stripe confirms and keeps entitlement active", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new URLSearchParams(String(init?.body)).get("cancel_at_period_end")).toBe("true");
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
        "mosai-cancel-period-end-sub_1-evt_bp06_cancel_seed",
      );
      return new Response(JSON.stringify({
        id: "sub_1",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: 2_000_000_000,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_cancel_seed",
      created: 1000,
    }));

    const result = await user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    });
    // Stripe reports seconds; the mirror and the UI use epoch milliseconds,
    // the same unit the webhook writes (audit 24 Sep 2026: the UI showed a
    // date around the year 50,000 after a webhook).
    expect(result).toEqual({ cancelAtPeriodEnd: true, currentPeriodEnd: 2_000_000_000_000 });
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("starter");
    expect(owner?.planStatus).toBe("active");
    const subscription = await t.run((ctx) => ctx.db.query("subscriptions").first());
    expect(subscription).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: 2_000_000_000_000,
    });
    const receipts = await t.run((ctx) => ctx.db.query("billingReceipts").collect());
    expect(receipts).toContainEqual(expect.objectContaining({
      eventType: "subscription.cancel_at_period_end.confirmed",
      objectId: "sub_1",
      organizationId,
      livemode: false,
    }));
  });

  it("does not change state when Stripe does not confirm period-end cancellation", async () => {
    clearBillingConfig();
    configureTestCatalog();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_cancel_unconfirmed_seed",
      created: 1000,
    }));

    await expect(user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    })).rejects.toThrow(/did not confirm/i);
    const subscription = await t.run((ctx) => ctx.db.query("subscriptions").first());
    expect(subscription?.cancelAtPeriodEnd).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("billingReceipts").collect())).toHaveLength(0);
  });

  it("does not record a scheduled cancellation when Stripe returns a non-active status", async () => {
    clearBillingConfig();
    configureTestCatalog();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      id: "sub_1",
      status: "canceled",
      cancel_at_period_end: true,
      current_period_end: 2_000_000_000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_cancel_unexpected_status_seed",
      created: 1000,
    }));

    await expect(user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    })).rejects.toThrow(/status canceled.*no scheduled-cancellation receipt/i);
    const subscription = await t.run((ctx) => ctx.db.query("subscriptions").first());
    expect(subscription?.cancelAtPeriodEnd).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("billingReceipts").collect())).toHaveLength(0);
  });

  it("refuses cancellation when the organization has multiple eligible subscriptions", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_ambiguous_seed",
      created: 1000,
    }));
    await t.run((ctx) => ctx.db.insert("subscriptions", {
      organizationId,
      provider: "stripe",
      subscriptionId: "sub_ambiguous_2",
      customerId: "cus_1",
      plan: "starter",
      status: "trialing",
      livemode: false,
      cancelAtPeriodEnd: false,
      dunningStage: 0,
      lastEventCreated: 1001,
      createdAt: 1001,
      updatedAt: 1001,
    }));

    await expect(user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    })).rejects.toThrow(/ambiguous billing state/i);
    expect(fetchMock).not.toHaveBeenCalled();
    const subscriptions = await t.run((ctx) => ctx.db.query("subscriptions").collect());
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.every((subscription) => !subscription.cancelAtPeriodEnd)).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("billingReceipts").collect())).toHaveLength(0);
  });

  it("denies a different tenant's cancellation without contacting Stripe", async () => {
    clearBillingConfig();
    configureTestCatalog();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { organizationId } = await seedOrg(t, "owner-a@example.com");
    const outsider = await seedOrg(t, "owner-b@example.com");
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_foreign_seed",
      created: 1000,
    }));

    await expect(outsider.user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    })).rejects.toThrow(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the plan unchanged when Stripe setup is absent", async () => {
    clearBillingConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent({
      organizationId,
      eventId: "evt_bp06_cancel_unconfigured_seed",
      created: 1000,
    }));

    await expect(user.as.action(api.billing.cancelSubscriptionAtPeriodEnd, {
      organizationId,
    })).rejects.toThrow(/Stripe is not configured/i);
    const owner = await t.run((ctx) => ctx.db.get(user.userId as Id<"users">));
    expect(owner?.plan).toBe("starter");
    expect(owner?.planStatus).toBe("active");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails conservatively instead of scanning unbounded subscription history", async () => {
    const t = newBackend();
    const { organizationId } = await seedOrg(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("subscriptions", {
          organizationId,
          provider: "stripe",
          subscriptionId: `sub_history_${index}`,
          customerId: "cus_history",
          plan: "starter",
          status: index === 100 ? "active" : "canceled",
          livemode: false,
          cancelAtPeriodEnd: false,
          dunningStage: 0,
          lastEventCreated: index,
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    await expect(t.query(internal.billing.subscriptionForOrganization, {
      organizationId,
    })).rejects.toThrow(/too many subscription history records/i);
  });
});

describe("T2.4 — platform admin", () => {
  it("grants the bootstrap operator by email, and the panel refuses everyone else", async () => {
    const t = newBackend();
    const operator = await seedUser(t, {
      name: "Operator",
      email: "julian.s.witkowski@gmail.com",
    });
    const other = await seedUser(t, {
      name: "Other",
      email: "other@example.com",
    });

    const me = await operator.as.query(api.admin.me, {});
    expect(me.isAdmin).toBe(true);
    expect(me.email).toBe("julian.s.witkowski@gmail.com");

    const notAdmin = await other.as.query(api.admin.me, {});
    expect(notAdmin.isAdmin).toBe(false);

    await expect(other.as.query(api.admin.overview, {})).rejects.toThrow(
      /Platform admin only/i,
    );
    await expect(
      other.as.mutation(api.admin.requestReconciliation, {}),
    ).rejects.toThrow(/Platform admin only/i);
  });

  it("marks the subscription counts as a capped sample above the overview limit", async () => {
    const t = newBackend();
    const operator = await seedUser(t, {
      name: "Operator",
      email: "julian.s.witkowski@gmail.com",
    });
    const { organizationId } = await seedOrg(t);

    await t.run(async (ctx) => {
      for (let index = 0; index < 5_001; index += 1) {
        await ctx.db.insert("subscriptions", {
          organizationId: organizationId as Id<"organizations">,
          provider: "stripe",
          subscriptionId: `sub_${index}`,
          customerId: "cus_test",
          plan: "starter",
          status: "active",
          livemode: false,
          cancelAtPeriodEnd: false,
          dunningStage: 0,
          lastEventCreated: index,
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    const overview = await operator.as.query(api.admin.overview, {});

    expect(overview).toMatchObject({
      subscriptions: 5_000,
      subscriptionsCapped: true,
      activeSubscriptions: 5_000,
      pastDue: 0,
    });
  });

  it("reports exact current subscription counts below the sample limit", async () => {
    const t = newBackend();
    const operator = await seedUser(t, {
      name: "Operator",
      email: "julian.s.witkowski@gmail.com",
    });
    const { organizationId } = await seedOrg(t);

    await t.run(async (ctx) => {
      for (const [subscriptionId, status] of [
        ["sub_active", "active"],
        ["sub_due", "past_due"],
      ] as const) {
        await ctx.db.insert("subscriptions", {
          organizationId: organizationId as Id<"organizations">,
          provider: "stripe",
          subscriptionId,
          customerId: "cus_test",
          plan: "starter",
          status,
          livemode: false,
          cancelAtPeriodEnd: false,
          dunningStage: 0,
          lastEventCreated: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    const overview = await operator.as.query(api.admin.overview, {});

    expect(overview).toMatchObject({
      subscriptions: 2,
      subscriptionsCapped: false,
      activeSubscriptions: 1,
      pastDue: 1,
    });
  });

  it("lets an operator override a plan and records the action", async () => {
    const t = newBackend();
    const operator = await seedUser(t, {
      name: "Operator",
      email: "julian.s.witkowski@gmail.com",
    });
    const owner = await seedUser(t, {
      name: "Owner",
      email: "owner@example.com",
    });
    const organizationId = await owner.as.mutation(api.organizations.create, {
      name: "Acme",
      kind: "business",
    });

    await operator.as.mutation(api.admin.setOrganizationPlan, {
      organizationId,
      plan: "scale",
      reason: "support comp, ticket 42",
    });

    const updated = await t.run((ctx) =>
      ctx.db.get(owner.userId as Id<"users">),
    );
    expect(updated?.plan).toBe("scale");
    expect(updated?.planStatus).toBe("active");

    const log = await operator.as.query(api.admin.auditLog, {});
    expect(log.some((entry) => entry.action === "organization.set_plan")).toBe(
      true,
    );

    // A non-operator cannot perform the override.
    await expect(
      owner.as.mutation(api.admin.setOrganizationPlan, {
        organizationId,
        plan: "free",
        reason: "downgrade",
      }),
    ).rejects.toThrow(/Platform admin only/i);
  });

  it("grants and revokes operator access, and refuses self-revocation", async () => {
    const t = newBackend();
    const operator = await seedUser(t, {
      name: "Operator",
      email: "julian.s.witkowski@gmail.com",
    });
    const member = await seedUser(t, {
      name: "Member",
      email: "member@example.com",
    });

    await operator.as.mutation(api.admin.setUserOperator, {
      userId: member.userId as Id<"users">,
      enabled: true,
    });
    expect((await member.as.query(api.admin.me, {})).isAdmin).toBe(true);

    await expect(
      operator.as.mutation(api.admin.setUserOperator, {
        userId: operator.userId as Id<"users">,
        enabled: false,
      }),
    ).rejects.toThrow(/cannot revoke your own/i);

    await operator.as.mutation(api.admin.setUserOperator, {
      userId: member.userId as Id<"users">,
      enabled: false,
    });
    expect((await member.as.query(api.admin.me, {})).isAdmin).toBe(false);
  });
});
