import { afterEach, describe, expect, it } from "vitest";
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
