import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api, internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  AI_BUDGET_CONFIG,
  chargedCostMicrousd,
  dayPeriod,
  estimatePromptTokens,
  formatMicrousd,
  isAiBudgetReached,
  monthPeriod,
  platformDailyCapMicrousd,
  resolveModelPrice,
  worstCaseCostMicrousd,
  type AiBudgetUsage,
} from "@/convex/lib/aiBudget";
import { completionCalls, resetCompletionStub, stubCompletionContent } from "./stubs/vly-integrations";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * AI cost budget (owner ask, 24 Sep 2026): a hard monthly cap per
 * organization per plan and a platform-wide daily kill switch, both enforced
 * in the gateway before the provider call. Integer micro-USD throughout.
 */

// The new module is referenced by name so this suite does not depend on
// regenerated bindings.
const usageQuery = makeFunctionReference<"query", { projectId: Id<"projects"> }, AiBudgetUsage>(
  "aiBudget:usage",
);
const organizationUsageQuery = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  AiBudgetUsage
>("aiBudget:organizationUsage");

const DAILY_ENV = AI_BUDGET_CONFIG.platformDailyEnvVar;
const originalDailyEnv = process.env[DAILY_ENV];

beforeEach(() => {
  resetCompletionStub();
  delete process.env[DAILY_ENV];
});
afterEach(() => {
  resetCompletionStub();
  vi.useRealTimers();
  if (originalDailyEnv === undefined) delete process.env[DAILY_ENV];
  else process.env[DAILY_ENV] = originalDailyEnv;
});

async function customer(t: TestBackend, plan = "free", email = "owner@example.test") {
  const owner = await seedUser(t, { plan, email });
  const projectId = (await owner.as.mutation(api.projects.create, { name: "Studio" })) as Id<"projects">;
  const project = await t.run((ctx) => ctx.db.get(projectId));
  const organizationId = project?.organizationId as Id<"organizations">;
  expect(organizationId).toBeTruthy();
  return { owner, projectId, organizationId };
}

async function rollups(t: TestBackend): Promise<Doc<"aiSpendRollups">[]> {
  return await t.run((ctx) => ctx.db.query("aiSpendRollups").collect());
}

async function seedOrgSpend(
  t: TestBackend,
  organizationId: Id<"organizations">,
  period: string,
  spentMicrousd: number,
) {
  await t.run((ctx) =>
    ctx.db.insert("aiSpendRollups", {
      scope: "organization",
      organizationId,
      period,
      spentMicrousd,
      reservedMicrousd: 0,
      runCount: 1,
      currency: "USD",
      updatedAt: Date.now(),
    }),
  );
}

async function seedPlatformSpend(t: TestBackend, period: string, spentMicrousd: number) {
  await t.run((ctx) =>
    ctx.db.insert("aiSpendRollups", {
      scope: "platform",
      period,
      spentMicrousd,
      reservedMicrousd: 0,
      runCount: 1,
      currency: "USD",
      updatedAt: Date.now(),
    }),
  );
}

async function generateGaps(tenant: Tenant, projectId: Id<"projects">) {
  stubCompletionContent(JSON.stringify({ gaps: [{ title: "Extension costs" }] }));
  return await tenant.as.action(api.ai.detectContentGaps, { projectId });
}

function startArgs(userId: string, projectId: Id<"projects">, model: string, maxOutputTokens: number) {
  return {
    userId: userId as Id<"users">,
    projectId,
    agentId: "create.content_generation",
    promptVersion: "v1",
    provider: "openrouter" as const,
    model,
    autonomy: "draft" as const,
    maxOutputTokens,
    contextSources: ["project.snapshot"],
    promptChars: 300,
    messageCount: 2,
  };
}

const settled = {
  status: "succeeded" as const,
  promptTokens: 100,
  completionTokens: 100,
  totalTokens: 200,
  providerCredits: null,
  costMicrousd: null,
  costCurrency: null,
  errorCategory: null,
  finishedAt: 0,
  latencyMs: 1,
};

describe("budget arithmetic", () => {
  it("uses the documented defaults in integer micro-USD", () => {
    expect(AI_BUDGET_CONFIG.monthlyMicrousdByPlan).toEqual({
      free: 250_000,
      starter: 2_000_000,
      growth: 5_000_000,
      scale: 15_000_000,
    });
    expect(AI_BUDGET_CONFIG.platformDailyMicrousd).toBe(10_000_000);
    expect(formatMicrousd(120_000)).toBe("$0.12");
    expect(formatMicrousd(2_000_000)).toBe("$2.00");
    // Rounds up to the cent: spend is never under-stated.
    expect(formatMicrousd(1)).toBe("$0.01");
  });

  it("prices the worst case from the catalog and falls back conservatively", () => {
    const mini = resolveModelPrice("openai/gpt-4o-mini");
    expect(worstCaseCostMicrousd({ promptTokens: 1_000, maxOutputTokens: 6_000, price: mini })).toBe(3_750);
    const unknown = resolveModelPrice("someone/new-model");
    expect(unknown).toEqual(AI_BUDGET_CONFIG.unknownModelPrice);
    const stored = resolveModelPrice("someone/new-model", { promptUsdPerMillion: 1, completionUsdPerMillion: 2 });
    expect(stored).toEqual({ promptUsdPerMillion: 1, completionUsdPerMillion: 2 });
    expect(estimatePromptTokens(3_000, 2)).toBe(1_016);
  });

  it("books the provider cost, else tokens, else the full reservation", () => {
    const price = { promptUsdPerMillion: 1, completionUsdPerMillion: 2 };
    const base = { billable: true, promptTokens: 10, completionTokens: 10, price, reservedMicrousd: 999 };
    expect(chargedCostMicrousd({ ...base, costMicrousd: 42 })).toBe(42);
    expect(chargedCostMicrousd({ ...base, costMicrousd: null })).toBe(30);
    expect(chargedCostMicrousd({ ...base, costMicrousd: null, promptTokens: null, completionTokens: null })).toBe(999);
    expect(chargedCostMicrousd({ ...base, billable: false, costMicrousd: 42 })).toBe(0);
  });

  it("resets at the UTC month and day boundary", () => {
    const lastMs = Date.UTC(2026, 8, 30, 23, 59, 59, 999);
    const firstMs = Date.UTC(2026, 9, 1);
    expect(monthPeriod(lastMs).key).toBe("2026-09");
    expect(monthPeriod(firstMs).key).toBe("2026-10");
    expect(monthPeriod(lastMs).resetsAt).toBe(firstMs);
    expect(dayPeriod(lastMs).key).toBe("2026-09-30");
    expect(dayPeriod(firstMs).key).toBe("2026-10-01");
    expect(monthPeriod(Date.UTC(2026, 11, 15)).resetsAt).toBe(Date.UTC(2027, 0, 1));
  });

  it("reads the daily cap from the environment but never lets a typo lift it", () => {
    expect(platformDailyCapMicrousd(undefined)).toBe(10_000_000);
    expect(platformDailyCapMicrousd("0")).toBe(0);
    expect(platformDailyCapMicrousd("2500000")).toBe(2_500_000);
    expect(platformDailyCapMicrousd("-1")).toBe(10_000_000);
    expect(platformDailyCapMicrousd("lots")).toBe(10_000_000);
  });
});

describe("gateway enforcement", () => {
  it("refuses an over-budget request before any provider call and writes nothing billable", async () => {
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "free");
    await seedOrgSpend(t, organizationId, monthPeriod(Date.now()).key, 249_990);
    const before = await rollups(t);

    let caught: unknown;
    try {
      await generateGaps(owner, projectId);
    } catch (error) {
      caught = error;
    }
    expect(isAiBudgetReached(caught)).toBe(true);
    expect(String((caught as Error).message)).toMatch(/AI budget reached for this month/);
    expect(completionCalls).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("aiRuns").collect())).toEqual([]);
    expect(await rollups(t)).toEqual(before);
  });

  it("lets an under-budget request through and books its real cost", async () => {
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "starter");
    const result = await generateGaps(owner, projectId);
    expect(result.gaps[0]?.title).toBe("Extension costs");
    expect(completionCalls).toHaveLength(1);

    const [run] = await t.run((ctx) => ctx.db.query("aiRuns").collect());
    expect(run?.organizationId).toBe(organizationId);
    expect(run?.reservedMicrousd).toBeGreaterThan(0);
    // The offline provider reports 1 prompt + 1 completion token.
    expect(run?.chargedMicrousd).toBe(1);

    const usage = await owner.as.query(usageQuery, { projectId });
    expect(usage).toMatchObject({
      scope: "organization",
      plan: "starter",
      spentMicrousd: 1,
      reservedMicrousd: 0,
      budgetMicrousd: 2_000_000,
      currency: "USD",
      state: "available",
      platformPaused: false,
    });
  });

  it("starts a fresh budget in a new month", async () => {
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "free");
    const previous = monthPeriod(monthPeriod(Date.now()).start - 1).key;
    await seedOrgSpend(t, organizationId, previous, 250_000);

    await expect(generateGaps(owner, projectId)).resolves.toBeTruthy();
    const usage = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(usage.spentMicrousd).toBe(1);
    expect(usage.resetsAt).toBe(monthPeriod(Date.now()).resetsAt);
  });

  it("settles a run against the month it started in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 30, 23, 59, 0));
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "free");
    const runId = await t.mutation(
      internal.guards.startAiRun,
      startArgs(owner.userId, projectId, "openai/gpt-4o-mini", 1_000),
    );
    vi.setSystemTime(Date.UTC(2026, 9, 1, 0, 1, 0));
    await t.mutation(internal.guards.finishAiRun, { runId, ...settled, finishedAt: Date.now() });

    const september = (await rollups(t)).find(
      (row) => row.organizationId === organizationId && row.period === "2026-09",
    );
    expect(september).toMatchObject({ reservedMicrousd: 0, spentMicrousd: 75 });
    const october = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(october.spentMicrousd).toBe(0);
  });

  it("stops every tenant once the platform daily cap is reached", async () => {
    const t = newBackend();
    const { owner, projectId } = await customer(t, "scale");
    await seedPlatformSpend(t, dayPeriod(Date.now()).key, 10_000_000);

    await expect(generateGaps(owner, projectId)).rejects.toThrow(/AI budget reached for today across MOSAI/);
    expect(completionCalls).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("aiRuns").collect())).toEqual([]);
    expect((await owner.as.query(usageQuery, { projectId })).platformPaused).toBe(true);
  });

  it("honours the kill-switch environment variable", async () => {
    const t = newBackend();
    const { owner, projectId } = await customer(t, "scale");
    process.env[DAILY_ENV] = "0";
    await expect(generateGaps(owner, projectId)).rejects.toThrow(/AI budget reached/);
    expect(completionCalls).toHaveLength(0);
  });

  it("counts running reservations so parallel requests cannot overspend", async () => {
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "free");
    // An operator-priced model: 8,000 output tokens reserve US$0.16 each.
    await t.run((ctx) =>
      ctx.db.insert("aiModels", {
        modelId: "vendor/pricey",
        label: "Pricey",
        enabled: true,
        isDefault: false,
        promptUsdPerMillion: 1,
        completionUsdPerMillion: 20,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: owner.userId as Id<"users">,
      }),
    );
    const args = startArgs(owner.userId, projectId, "vendor/pricey", 8_000);
    const first = await t.mutation(internal.guards.startAiRun, args);
    await expect(t.mutation(internal.guards.startAiRun, args)).rejects.toThrow(/AI budget reached/);

    const held = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(held.reservedMicrousd).toBeGreaterThanOrEqual(160_000);
    expect(held.spentMicrousd).toBe(0);

    // Finishing releases the hold and books the (small) real cost.
    await t.mutation(internal.guards.finishAiRun, { runId: first, ...settled, finishedAt: Date.now() });
    const after = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(after).toMatchObject({ reservedMicrousd: 0, spentMicrousd: 2_100 });
    await expect(t.mutation(internal.guards.startAiRun, args)).resolves.toBeTruthy();
  });

  it("charges nothing for a request the gateway rejected before the provider", async () => {
    const t = newBackend();
    const { owner, projectId, organizationId } = await customer(t, "free");
    const runId = await t.mutation(
      internal.guards.startAiRun,
      startArgs(owner.userId, projectId, "openai/gpt-4o-mini", 1_000),
    );
    await t.mutation(internal.guards.finishAiRun, {
      runId,
      ...settled,
      status: "failed",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      errorCategory: "invalid_request",
      billable: false,
    });
    const usage = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(usage).toMatchObject({ reservedMicrousd: 0, spentMicrousd: 0 });
  });
});

describe("usage read model", () => {
  it("denies another tenant's project and organization", async () => {
    const t = newBackend();
    const alice = await customer(t, "growth", "alice@example.test");
    const bob = await customer(t, "free", "bob@example.test");
    await expect(bob.owner.as.query(usageQuery, { projectId: alice.projectId })).rejects.toThrow(/Not found/);
    await expect(
      bob.owner.as.query(organizationUsageQuery, { organizationId: alice.organizationId }),
    ).rejects.toThrow();
    await expect(t.query(usageQuery, { projectId: alice.projectId })).rejects.toThrow();

    const own = await alice.owner.as.query(usageQuery, { projectId: alice.projectId });
    expect(own).toMatchObject({ plan: "growth", budgetMicrousd: 5_000_000, spentMicrousd: 0, state: "available" });
  });

  it("reports locked once the month's budget is used", async () => {
    const t = newBackend();
    const { owner, organizationId } = await customer(t, "free");
    await seedOrgSpend(t, organizationId, monthPeriod(Date.now()).key, 250_000);
    const usage = await owner.as.query(organizationUsageQuery, { organizationId });
    expect(usage.state).toBe("locked");
  });
});
