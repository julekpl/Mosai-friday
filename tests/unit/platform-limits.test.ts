import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { dayPeriod, isAiBudgetReached } from "@/convex/lib/aiBudget";
import { currentUtcPeriod } from "@/convex/lib/providerUsage";
import { LIMIT_SPECS, resolveLimit } from "@/convex/lib/platformLimits";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * Operator-editable limits (owner ask, 26 Sep 2026): the platform admin sets
 * the SerpApi/Pexels ceilings, the per-user SerpApi cap, the platform AI day
 * cap and the trial AI day cap ($1 default, decision O3) in admin > Limits.
 * Resolution is admin value > environment > default; env
 * `MOSAI_AI_DAILY_CAP_MICROUSD=0` stays the deployment kill switch.
 */

const ENV_VARS = [
  "SERPAPI_MONTHLY_CEILING",
  "SERPAPI_USER_DAILY_CAP",
  "PEXELS_MONTHLY_CEILING",
  "MOSAI_AI_DAILY_CAP_MICROUSD",
  "MOSAI_AI_TRIAL_DAILY_CAP_MICROUSD",
] as const;
const originalEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const key of ENV_VARS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_VARS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function operator(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  return admin;
}

async function trialCustomer(t: TestBackend, planStatus: "trialing" | "active") {
  const owner = await seedUser(t, { plan: "starter", email: `${planStatus}@example.test` });
  await t.run((ctx) => ctx.db.patch(owner.userId as Id<"users">, { planStatus }));
  const projectId = (await owner.as.mutation(api.projects.create, { name: "Cafe" })) as Id<"projects">;
  return { owner, projectId };
}

function startArgs(userId: string, projectId: Id<"projects">) {
  return {
    userId: userId as Id<"users">,
    projectId,
    agentId: "create.content_generation",
    promptVersion: "v1",
    provider: "openrouter" as const,
    model: "openai/gpt-4o-mini",
    autonomy: "draft" as const,
    maxOutputTokens: 1_000,
    contextSources: ["project.snapshot"],
    promptChars: 300,
    messageCount: 2,
  };
}

async function seedTrialSpend(t: TestBackend, spentMicrousd: number) {
  await t.run((ctx) =>
    ctx.db.insert("aiSpendRollups", {
      scope: "trial",
      period: dayPeriod(Date.now()).key,
      spentMicrousd,
      reservedMicrousd: 0,
      runCount: 1,
      currency: "USD",
      updatedAt: Date.now(),
    }),
  );
}

async function trialRollup(t: TestBackend): Promise<Doc<"aiSpendRollups"> | null> {
  return await t.run((ctx) =>
    ctx.db
      .query("aiSpendRollups")
      .withIndex("by_scope_period", (q) => q.eq("scope", "trial").eq("period", dayPeriod(Date.now()).key))
      .first(),
  );
}

describe("resolveLimit (pure precedence)", () => {
  it("uses admin value, then environment, then default", () => {
    expect(resolveLimit("serpapiMonthlyCeiling", undefined, {})).toEqual({ value: 200, source: "default" });
    expect(resolveLimit("serpapiMonthlyCeiling", undefined, { SERPAPI_MONTHLY_CEILING: "150" })).toEqual({
      value: 150,
      source: "env",
    });
    expect(resolveLimit("serpapiMonthlyCeiling", 120, { SERPAPI_MONTHLY_CEILING: "150" })).toEqual({
      value: 120,
      source: "admin",
    });
    expect(resolveLimit("aiTrialDailyMicrousd", undefined, {})).toEqual({ value: 1_000_000, source: "default" });
  });

  it("keeps the deployment AI kill switch above any admin value", () => {
    expect(resolveLimit("aiPlatformDailyMicrousd", 50_000_000, { MOSAI_AI_DAILY_CAP_MICROUSD: "0" })).toEqual({
      value: 0,
      source: "kill_switch",
    });
  });

  it("ignores an out-of-range stored value and keeps existing env parsing", () => {
    const max = LIMIT_SPECS.serpapiMonthlyCeiling.max;
    expect(resolveLimit("serpapiMonthlyCeiling", max + 1, {}).source).toBe("default");
    expect(resolveLimit("serpapiMonthlyCeiling", 1.5, {}).source).toBe("default");
    // LQ-1 behaviour: a 0 or junk lookup ceiling from the environment falls back.
    expect(resolveLimit("serpapiMonthlyCeiling", undefined, { SERPAPI_MONTHLY_CEILING: "0" }).value).toBe(200);
    expect(resolveLimit("serpapiMonthlyCeiling", undefined, { SERPAPI_MONTHLY_CEILING: "lots" }).value).toBe(200);
    // An admin 0 is allowed and means "stop".
    expect(resolveLimit("serpapiMonthlyCeiling", 0, {})).toEqual({ value: 0, source: "admin" });
  });
});

describe("admin > Limits", () => {
  it("only a platform admin can read or change limits and usage", async () => {
    const t = newBackend();
    const user = await seedUser(t, { email: "someone@example.test" });
    await expect(user.as.query(api.admin.limits, {})).rejects.toThrow(/Platform admin only/);
    await expect(
      user.as.mutation(api.admin.setLimits, { changes: { serpapiMonthlyCeiling: 5_000 } }),
    ).rejects.toThrow(/Platform admin only/);
    await expect(
      user.as.mutation(api.admin.setProviderUsageCount, { kind: "serpapi", count: 0 }),
    ).rejects.toThrow(/Platform admin only/);
  });

  it("saves, reports, clears and audits a limit; rejects invalid values", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.admin.setLimits, { changes: { aiTrialDailyMicrousd: 2_000_000 } });
    let view = await admin.as.query(api.admin.limits, {});
    expect(view.limits.find((l) => l.key === "aiTrialDailyMicrousd")).toMatchObject({
      value: 2_000_000,
      source: "admin",
      defaultValue: 1_000_000,
    });

    await expect(
      admin.as.mutation(api.admin.setLimits, { changes: { serpapiMonthlyCeiling: -1 } }),
    ).rejects.toThrow(/whole number/);

    await admin.as.mutation(api.admin.setLimits, { changes: { aiTrialDailyMicrousd: null } });
    view = await admin.as.query(api.admin.limits, {});
    expect(view.limits.find((l) => l.key === "aiTrialDailyMicrousd")).toMatchObject({
      value: 1_000_000,
      source: "default",
      adminValue: null,
    });

    const audits = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(audits.map((a) => a.action)).toEqual(["limits.update", "limits.update"]);
  });
});

describe("SerpApi limits set in admin are enforced", () => {
  it("an admin ceiling wins over the environment variable", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const { userId } = await seedUser(t, { email: "owner@example.test" });
    process.env.SERPAPI_MONTHLY_CEILING = "500";
    await admin.as.mutation(api.admin.setLimits, { changes: { serpapiMonthlyCeiling: 2 } });

    const reserve = () =>
      t.mutation(internal.lib.providerUsage.reserveSerpApiCall, { userId: userId as Id<"users"> });
    expect(await reserve()).toEqual({ ok: true });
    expect(await reserve()).toEqual({ ok: true });
    expect(await reserve()).toEqual({ ok: false, reason: "ceiling" });
  });

  it("setting the count to match the dashboard moves where the ceiling stops", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.admin.setProviderUsageCount, { kind: "serpapi", count: 199 });
    const view = await admin.as.query(api.admin.limits, {});
    expect(view.usage.serpapiThisMonth).toBe(199);

    const { userId } = await seedUser(t, { email: "owner@example.test" });
    const reserve = () =>
      t.mutation(internal.lib.providerUsage.reserveSerpApiCall, { userId: userId as Id<"users"> });
    expect(await reserve()).toEqual({ ok: true });
    expect(await reserve()).toEqual({ ok: false, reason: "ceiling" });

    await admin.as.mutation(api.admin.setProviderUsageCount, { kind: "serpapi", count: 80 });
    const row = await t.run((ctx) =>
      ctx.db
        .query("providerUsageRollups")
        .withIndex("by_kind_period", (q) => q.eq("kind", "serpapi").eq("period", currentUtcPeriod()))
        .unique(),
    );
    expect(row?.count).toBe(80);
  });

  it("an admin per-person daily cap is enforced", async () => {
    const t = newBackend();
    const admin = await operator(t);
    await admin.as.mutation(api.admin.setLimits, { changes: { serpapiUserDailyCap: 1 } });
    const { userId } = await seedUser(t, { email: "owner@example.test" });
    const reserve = () =>
      t.mutation(internal.lib.providerUsage.reserveSerpApiCall, { userId: userId as Id<"users"> });
    expect(await reserve()).toEqual({ ok: true });
    expect(await reserve()).toEqual({ ok: false, reason: "daily_cap" });
  });
});

describe("trial AI day cap (decision O3, $1 default)", () => {
  it("refuses a trialing organization once trial spend today reaches the cap", async () => {
    const t = newBackend();
    const { owner, projectId } = await trialCustomer(t, "trialing");
    await seedTrialSpend(t, 999_990);

    let caught: unknown;
    try {
      await t.mutation(internal.guards.startAiRun, startArgs(owner.userId, projectId));
    } catch (error) {
      caught = error;
    }
    expect(isAiBudgetReached(caught)).toBe(true);
    expect(String((caught as { data?: unknown }).data)).toMatch(/trial accounts today/);
    const runs = await t.run((ctx) => ctx.db.query("aiRuns").collect());
    expect(runs).toHaveLength(0);
  });

  it("does not limit a paying organization with the trial cap", async () => {
    const t = newBackend();
    const { owner, projectId } = await trialCustomer(t, "active");
    await seedTrialSpend(t, 999_990);
    await expect(
      t.mutation(internal.guards.startAiRun, startArgs(owner.userId, projectId)),
    ).resolves.toBeTruthy();
  });

  it("uses the admin value, and reserves then settles the trial rollup", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const { owner, projectId } = await trialCustomer(t, "trialing");
    await seedTrialSpend(t, 999_990);
    await admin.as.mutation(api.admin.setLimits, { changes: { aiTrialDailyMicrousd: 2_000_000 } });

    const runId = await t.mutation(internal.guards.startAiRun, startArgs(owner.userId, projectId));
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.trialBudget).toBe(true);
    expect((await trialRollup(t))?.reservedMicrousd).toBeGreaterThan(0);

    await t.mutation(internal.guards.finishAiRun, {
      runId,
      status: "succeeded",
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      providerCredits: null,
      costMicrousd: 75,
      costCurrency: "USD",
      errorCategory: null,
      finishedAt: Date.now(),
      latencyMs: 1,
    });
    const settled = await trialRollup(t);
    expect(settled?.reservedMicrousd).toBe(0);
    expect(settled?.spentMicrousd).toBe(999_990 + 75);
  });

  it("the platform AI day cap set in admin applies to everyone", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const { owner, projectId } = await trialCustomer(t, "active");
    await admin.as.mutation(api.admin.setLimits, { changes: { aiPlatformDailyMicrousd: 0 } });
    await expect(
      t.mutation(internal.guards.startAiRun, startArgs(owner.userId, projectId)),
    ).rejects.toThrow(/AI budget reached/);
  });
});
