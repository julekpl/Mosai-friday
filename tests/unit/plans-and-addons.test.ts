import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CORE_MODULES, entitledModules } from "@/convex/lib/capabilities";
import { mapSubscriptionItems } from "@/convex/lib/billingCatalog";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * Plans & add-ons (owner decisions, 24 Sep 2026):
 *  - Understand, Journeys and Create are the always-included core bundle;
 *  - customers mix and match further tools as add-ons;
 *  - the platform admin creates and edits plans/add-ons in the admin panel.
 *
 * Also pins the audit's double-billing defect: a second checkout while a
 * subscription is active used to create a second subscription.
 * Stripe is never contacted for real: fetch is stubbed per test.
 */

const ENV_KEYS = ["STRIPE_SECRET_KEY", "MOSAI_APP_ORIGIN"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = ["sk", "test", "fixture"].join("_");
  process.env.MOSAI_APP_ORIGIN = "https://mosai.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function operator(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  return admin;
}

async function seedOrg(t: TestBackend) {
  const user = await seedUser(t, { name: "Owner", email: "owner@example.com" });
  const organizationId = await user.as.mutation(api.organizations.create, { name: "Studio", kind: "business" });
  return { user, organizationId };
}

const PROMOTE_ADDON = {
  key: "addon-promote",
  kind: "addon" as const,
  name: "Promote",
  modules: ["promote"],
  priceMinor: 1900,
  currency: "EUR",
  interval: "month" as const,
  stripePriceId: "price_addon_promote",
  highlights: [],
  status: "active" as const,
  sortOrder: 10,
};

function subscriptionEvent(organizationId: string, eventId: string, created: number, priceIds: string[]) {
  return {
    eventId,
    type: "customer.subscription.updated",
    created,
    livemode: false,
    objectId: "sub_mix",
    data: {
      id: "sub_mix",
      object: "subscription",
      status: "active",
      customer: "cus_mix",
      current_period_end: 2_000_000_000,
      cancel_at_period_end: false,
      metadata: { mosai_organization: organizationId, mosai_plan: "free" },
      items: { data: priceIds.map((id) => ({ price: { id } })) },
    },
  };
}

describe("entitled modules", () => {
  it("always includes the core bundle and adds plan and add-on modules", () => {
    expect(entitledModules({ plan: "free" })).toEqual([...CORE_MODULES]);
    expect(entitledModules({ plan: "free", addonModules: ["promote", "not-a-module"] })).toEqual([
      ...CORE_MODULES,
      "promote",
    ]);
    // An operator plan definition replaces the built-in tier's list, core stays.
    expect(entitledModules({ plan: "scale", catalogPlanModules: ["build"] })).toEqual([...CORE_MODULES, "build"]);
  });

  it("maps subscription items to one plan and any add-ons", () => {
    const mapped = mapSubscriptionItems(
      [{ price: { id: "price_plan" } }, { price: { id: "price_addon_promote" } }, { price: { id: "price_unknown" } }],
      [
        { key: "studio", kind: "plan", stripePriceId: "price_plan" },
        { key: "addon-promote", kind: "addon", stripePriceId: "price_addon_promote" },
      ],
    );
    expect(mapped).toEqual({ planKey: "studio", planPriceId: "price_plan", addonKeys: ["addon-promote"] });
  });
});

describe("operator catalog", () => {
  it("is operator-only and validates money and activation rules", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    await expect(user.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON)).rejects.toThrow(/Platform admin only/);

    const admin = await operator(t);
    await expect(
      admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, stripePriceId: undefined }),
    ).rejects.toThrow(/needs its Stripe price id/);
    await expect(
      admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, priceMinor: 19.5 }),
    ).rejects.toThrow(/whole number of cents/);
    await expect(
      admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, modules: ["create"] }),
    ).rejects.toThrow(/outside the core bundle/);

    const id = await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    await expect(
      admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, id, key: "renamed" }),
    ).rejects.toThrow(/key can't change/);
    await expect(
      admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, key: "addon-promote-2" }),
    ).rejects.toThrow(/already used/);
  });

  it("seeds draft rows from today's tiers without overwriting existing keys", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    const { created } = await admin.as.mutation(api.billingPlans.adminSeedDefaults, {});
    const rows = await t.run((ctx) => ctx.db.query("billingPlans").collect());
    expect(created).toBe(rows.length - 1);
    expect(rows.find((row) => row.key === "addon-promote")?.priceMinor).toBe(1900);
    expect(rows.filter((row) => row.key !== "free" && row.key !== "addon-promote").every((row) => row.status === "draft")).toBe(true);
  });

  it("customers only see active rows", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    await admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, key: "addon-sell", modules: ["sell"], stripePriceId: "price_addon_sell", status: "draft" });
    const customer = await seedUser(t);
    const catalog = await customer.as.query(api.billingPlans.publicCatalog, {});
    expect(catalog.addons.map((row) => row.key)).toEqual(["addon-promote"]);
    expect(catalog.core.map((module) => module.id)).toEqual([...CORE_MODULES]);
  });
});

describe("mix and match entitlement", () => {
  it("an operator-granted add-on unlocks its tool; revoking locks it again", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    const { user, organizationId } = await seedOrg(t);
    const projectId = await user.as.mutation(api.projects.create, { name: "Studio" });
    await t.run((ctx) => ctx.db.patch(projectId, { organizationId }));

    const post = () => user.as.mutation(api.posts.create, { projectId, channel: "linkedin", body: "Hi" });
    await expect(post()).rejects.toThrow(/plan does not include "promote"/);

    await expect(
      admin.as.mutation(api.billingPlans.grantAddon, { organizationId, addonKey: "addon-promote", reason: "" }),
    ).rejects.toThrow(/reason/);
    await admin.as.mutation(api.billingPlans.grantAddon, { organizationId, addonKey: "addon-promote", reason: "pilot" });
    await expect(post()).resolves.toBeTruthy();
    const matrix = await user.as.query(api.entitlements.matrix, { projectId });
    expect(matrix?.addons).toEqual(["addon-promote"]);

    await admin.as.mutation(api.billingPlans.revokeAddon, { organizationId, addonKey: "addon-promote", reason: "pilot ended" });
    await expect(post()).rejects.toThrow(/plan does not include "promote"/);
    const audit = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["organization.grant_addon", "organization.revoke_addon"]),
    );
  });

  it("a draft add-on cannot be granted", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, { ...PROMOTE_ADDON, status: "draft" });
    const { organizationId } = await seedOrg(t);
    await expect(
      admin.as.mutation(api.billingPlans.grantAddon, { organizationId, addonKey: "addon-promote", reason: "try" }),
    ).rejects.toThrow(/Only active or archived/);
  });

  it("the verified webhook adds and removes Stripe-paid add-ons and leaves operator grants alone", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    await admin.as.mutation(api.billingPlans.adminSave, {
      ...PROMOTE_ADDON,
      key: "addon-sell",
      name: "Sell",
      modules: ["sell"],
      stripePriceId: "price_addon_sell",
    });
    const { organizationId } = await seedOrg(t);
    await admin.as.mutation(api.billingPlans.grantAddon, { organizationId, addonKey: "addon-sell", reason: "comp" });

    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_1", 1000, ["price_addon_promote"]));
    let addons = await t.run((ctx) => ctx.db.query("organizationAddons").collect());
    expect(addons.find((row) => row.addonKey === "addon-promote")).toMatchObject({ status: "active", source: "stripe" });
    expect(addons.find((row) => row.addonKey === "addon-sell")).toMatchObject({ status: "active", source: "operator" });

    // The customer removes Promote in Stripe: the next event drops it.
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_2", 2000, []));
    addons = await t.run((ctx) => ctx.db.query("organizationAddons").collect());
    expect(addons.find((row) => row.addonKey === "addon-promote")?.status).toBe("canceled");
    expect(addons.find((row) => row.addonKey === "addon-sell")?.status).toBe("active");
  });
});

describe("no second subscription (double billing)", () => {
  it("refuses a new checkout while a subscription is active, before contacting Stripe", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_active", 1000, []));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      user.as.action(api.billing.startCheckout, {
        organizationId,
        plan: "starter",
        successUrl: "https://mosai.example/app/billing?checkout=success",
        cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
        expectedPriceId: "price_test_starter",
        expectedAmountMinor: 1299,
        expectedCurrency: "EUR",
      }),
    ).rejects.toThrow(/already have a subscription/);
    await expect(
      user.as.action(api.billing.startCatalogCheckout, {
        organizationId,
        addonKeys: ["addon-promote"],
        expectedLines: [{ key: "addon-promote", amountMinor: 1900, currency: "EUR" }],
        successUrl: "https://mosai.example/app/billing?checkout=success",
        cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
      }),
    ).rejects.toThrow(/already have a subscription/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a catalog checkout sends every chosen tool as one subscription after checking Stripe's prices", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.billingPlans.adminSave, PROMOTE_ADDON);
    const { user, organizationId } = await seedOrg(t);
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? "") });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/prices/price_addon_promote")) {
        return json({ id: "price_addon_promote", active: true, livemode: false, unit_amount: 1900, currency: "eur", recurring: { interval: "month", interval_count: 1 }, product: "prod_1" });
      }
      if (url.endsWith("/customers")) return json({ id: "cus_new" });
      if (url.endsWith("/checkout/sessions")) return json({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
      throw new Error(`unexpected ${url}`);
    });

    // A stale price shown in the browser is refused.
    await expect(
      user.as.action(api.billing.startCatalogCheckout, {
        organizationId,
        addonKeys: ["addon-promote"],
        expectedLines: [{ key: "addon-promote", amountMinor: 900, currency: "EUR" }],
        successUrl: "https://mosai.example/app/billing?checkout=success",
        cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
      }),
    ).rejects.toThrow(/Prices changed/);

    const result = await user.as.action(api.billing.startCatalogCheckout, {
      organizationId,
      addonKeys: ["addon-promote"],
      expectedLines: [{ key: "addon-promote", amountMinor: 1900, currency: "EUR" }],
      successUrl: "https://mosai.example/app/billing?checkout=success",
      cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
    });
    expect(result.url).toBe("https://checkout.stripe.test/cs_1");
    const session = calls.find((call) => call.url.endsWith("/checkout/sessions"));
    const params = new URLSearchParams(session?.body);
    expect(params.get("line_items[0][price]")).toBe("price_addon_promote");
    expect(params.get("mode")).toBe("subscription");
    // Nothing is granted by starting checkout.
    const addons = await t.run((ctx) => ctx.db.query("organizationAddons").collect());
    expect(addons).toEqual([]);
  });
});
