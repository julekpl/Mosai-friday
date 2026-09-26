import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { rankHomePriorities, type HomePrioritiesInput } from "@/shared/homePriorities";
import { PUBLISH_LOCKED_LABEL } from "@/components/app/kit/kit-model";
import { lockedReason } from "@/components/app/next-action-model";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * KIT-F1 (owner decision F1: the 14-day Starter trial requires a card; no
 * billing model change). One trial per account, marked only by the verified
 * webhook; a free owner's locked kit gets a "Try Starter" item; locked
 * publish actions say "Publishing needs Starter". Stripe is never contacted
 * for real: fetch is stubbed.
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

const STARTER_PLAN = {
  key: "starter-trial",
  kind: "plan" as const,
  name: "Starter",
  modules: ["build", "promote"],
  priceMinor: 1299,
  currency: "EUR",
  interval: "month" as const,
  stripePriceId: "price_starter_trial",
  trialDays: 14,
  highlights: [],
  status: "active" as const,
  sortOrder: 1,
};

async function seedCatalogOrg(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  await admin.as.mutation(api.billingPlans.adminSave, STARTER_PLAN);
  const user = await seedUser(t, { name: "Owner", email: "owner@example.com" });
  const organizationId = await user.as.mutation(api.organizations.create, { name: "Studio", kind: "business" });
  return { user, organizationId };
}

function stubStripe(): Array<{ url: string; body: string; key: string | null }> {
  const calls: Array<{ url: string; body: string; key: string | null }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, body: String(init?.body ?? ""), key: headers.get("Idempotency-Key") });
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/prices/price_starter_trial")) {
      return json({
        id: "price_starter_trial",
        active: true,
        livemode: false,
        unit_amount: 1299,
        currency: "eur",
        recurring: { interval: "month", interval_count: 1 },
        product: "prod_starter",
      });
    }
    if (url.endsWith("/customers")) return json({ id: "cus_trial" });
    if (url.endsWith("/checkout/sessions")) return json({ id: "cs_trial", url: "https://checkout.stripe.test/cs_trial" });
    throw new Error(`unexpected ${url}`);
  });
  return calls;
}

function checkout(organizationId: Id<"organizations">) {
  return {
    organizationId,
    planKey: "starter-trial",
    addonKeys: [],
    expectedLines: [{ key: "starter-trial", amountMinor: 1299, currency: "EUR" }],
    successUrl: "https://mosai.example/app/billing?checkout=success",
    cancelUrl: "https://mosai.example/app/billing?checkout=cancelled",
  };
}

function subscriptionEvent(organizationId: string, eventId: string, created: number, status: string) {
  return {
    eventId,
    type: "customer.subscription.updated",
    created,
    livemode: false,
    objectId: "sub_trial",
    data: {
      id: "sub_trial",
      object: "subscription",
      status,
      customer: "cus_trial",
      current_period_end: 2_000_000_000,
      cancel_at_period_end: false,
      metadata: { mosai_organization: organizationId, mosai_plan: "starter-trial" },
      items: { data: [{ price: { id: "price_starter_trial" } }] },
    },
  };
}

function sessionParams(calls: Array<{ url: string; body: string }>, index: number) {
  const sessions = calls.filter((call) => call.url.endsWith("/checkout/sessions"));
  return new URLSearchParams(sessions[index]?.body);
}

async function ownerMarker(t: TestBackend, userId: string) {
  return await t.run(async (ctx) => (await ctx.db.get(userId as Id<"users">))?.trialStartedAt ?? null);
}

describe("one Starter trial per account", () => {
  it("the first checkout offers the trial; after the webhook marks it, a second checkout gets none", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedCatalogOrg(t);
    const calls = stubStripe();

    await user.as.action(api.billing.startCatalogCheckout, checkout(organizationId));
    expect(sessionParams(calls, 0).get("subscription_data[trial_period_days]")).toBe("14");
    // Starting checkout marks nothing: only the verified webhook does.
    expect(await ownerMarker(t, user.userId)).toBeNull();

    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_trial", 1000, "trialing"));
    const marked = await ownerMarker(t, user.userId);
    expect(typeof marked).toBe("number");

    // The trial ends without paying; the subscription is canceled.
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_cancel", 2000, "canceled"));
    // A later trialing event never moves the marker.
    expect(await ownerMarker(t, user.userId)).toBe(marked);

    await user.as.action(api.billing.startCatalogCheckout, checkout(organizationId));
    const second = sessionParams(calls, 1);
    expect(second.get("mode")).toBe("subscription");
    expect(second.get("subscription_data[trial_period_days]")).toBeNull();
    // A different Stripe idempotency key, so Stripe cannot replay the trial session.
    const sessionKeys = calls.filter((call) => call.url.endsWith("/checkout/sessions")).map((call) => call.key);
    expect(sessionKeys[0]).not.toBe(sessionKeys[1]);
  });

  it("an owner who already had a trial in another organization gets none", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedCatalogOrg(t);
    await t.run((ctx) => ctx.db.patch(user.userId as Id<"users">, { trialStartedAt: 1 }));
    const calls = stubStripe();
    await user.as.action(api.billing.startCatalogCheckout, checkout(organizationId));
    expect(sessionParams(calls, 0).get("subscription_data[trial_period_days]")).toBeNull();
  });

  it("an active (non-trial) subscription does not use up the trial", async () => {
    const t = newBackend();
    const { user, organizationId } = await seedCatalogOrg(t);
    await t.mutation(internal.billingWebhooks.applyEvent, subscriptionEvent(organizationId, "evt_active", 1000, "active"));
    expect(await ownerMarker(t, user.userId)).toBeNull();
  });

  it("the marker is written only by the webhook path, never by client-callable code", () => {
    const root = join(process.cwd(), "src");
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "_generated") walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const source = readFileSync(path, "utf8");
        if (/trialStartedAt\s*:/.test(source.replace(/trialStartedAt:\s*v\.optional/g, ""))) {
          writers.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(writers).toEqual(["convex/billingWebhooks.ts"]);
  });
});

const LOCKED_KIT: HomePrioritiesInput["kit"] = {
  status: "waiting_for_user",
  parts: {
    plan: { status: "succeeded" },
    site: { status: "queued", locked: true },
    posts: { status: "queued", locked: true },
  },
};
const BASE: HomePrioritiesInput = {
  projectId: "p1",
  kit: LOCKED_KIT,
  build: { included: false, website: "none" },
  promote: { included: false },
  profile: { complete: true },
  contactable: true,
  posts: { drafted: 0, missingPictures: 0 },
  since: null,
};

describe("\"Try Starter\" on Home for a free owner's locked kit", () => {
  it("offers the trial and links to plans", () => {
    const [item] = rankHomePriorities({ ...BASE, plan: { free: true, trialAvailable: true } });
    expect(item).toEqual({
      id: "next-try-starter",
      kind: "next",
      title: "Try Starter",
      reason: "Your website and posts need Starter. The free trial asks for a card.",
      action: { kind: "link", label: "Try Starter", to: "/app/billing" },
      state: "ready",
    });
  });

  it("once the trial is used, it says Get Starter and never promises a trial", () => {
    const [item] = rankHomePriorities({ ...BASE, plan: { free: true, trialAvailable: false } });
    expect(item).toMatchObject({ title: "Get Starter", reason: "Your website and posts need Starter." });
    expect(item.action).toMatchObject({ label: "See plans", to: "/app/billing" });
  });

  it("names a single locked part with the right verb", () => {
    const [item] = rankHomePriorities({
      ...BASE,
      kit: { ...LOCKED_KIT!, parts: { ...LOCKED_KIT!.parts, posts: { status: "succeeded" } } },
      plan: { free: true, trialAvailable: true },
    });
    expect(item.reason).toBe("Your website needs Starter. The free trial asks for a card.");
  });

  it("a paid owner, or an unknown plan, keeps the kit's own item", () => {
    for (const plan of [{ free: false, trialAvailable: true }, undefined]) {
      const [item] = rankHomePriorities({ ...BASE, plan });
      expect(item.id).toBe("needs-you-kit");
    }
  });

  it("home.priorities: free owner with a locked kit gets Try Starter, then Get Starter after the webhook marker", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "free", email: "free@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const now = Date.now();
    const lockedPart = { status: "queued" as const, errorCode: "needs_plan", message: "Needs the Starter plan", outputs: [], attempts: 0, updatedAt: now };
    await t.run((ctx) =>
      ctx.db.insert("starterKits", {
        projectId,
        requestedBy: owner.userId as Id<"users">,
        idempotencyKey: String(projectId),
        status: "waiting_for_user",
        parts: {
          plan: { status: "succeeded", outputs: [], attempts: 1, updatedAt: now },
          site: lockedPart,
          posts: lockedPart,
        },
        attempts: 1,
        budgetMicrousd: 400_000,
        spentMicrousd: 0,
        budgetCurrency: "USD",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const before = await owner.as.query(api.home.priorities, { projectId });
    expect(before[0]).toMatchObject({ id: "next-try-starter", title: "Try Starter" });

    await t.run((ctx) => ctx.db.patch(owner.userId as Id<"users">, { trialStartedAt: now }));
    const after = await owner.as.query(api.home.priorities, { projectId });
    expect(after[0]).toMatchObject({ id: "next-try-starter", title: "Get Starter" });
  });
});

describe("locked actions are never blank", () => {
  it("reads \"Publishing needs Starter\"", () => {
    expect(PUBLISH_LOCKED_LABEL).toBe("Publishing needs Starter");
    expect(lockedReason("build", "Publishing")).toBe("Publishing needs Starter");
    expect(lockedReason("promote", "Posting")).toBe("Posting needs Starter");
  });
});
