import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FALLBACK_MODEL_ID, isValidModelId, parseOpenRouterCatalog } from "@/convex/lib/aiModelCatalog";
import { completionCalls, resetCompletionStub, stubCompletionContent } from "./stubs/vly-integrations";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * Operator-managed AI model allow-list (owner decision 24 Sep 2026): the
 * platform admin chooses which OpenRouter models may be used and the default;
 * a project may pick one enabled model; the gateway resolves the model on the
 * server, so feature code and clients cannot name arbitrary models.
 * Also covers the gateway's single repair attempt for invalid structured
 * output. OpenRouter is the offline stub from tests/unit/setup.ts.
 */

beforeEach(() => resetCompletionStub());
afterEach(() => resetCompletionStub());

async function operator(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  return admin;
}

describe("model id and catalog parsing", () => {
  it("accepts provider/model ids and rejects anything else", () => {
    expect(isValidModelId("anthropic/claude-sonnet-5")).toBe(true);
    expect(isValidModelId("openai/gpt-4o-mini:free")).toBe(true);
    expect(isValidModelId("gpt-4o")).toBe(false);
    expect(isValidModelId("a/b c")).toBe(false);
    expect(isValidModelId("../../etc")).toBe(false);
  });

  it("converts per-token prices to per-million and filters by search", () => {
    const out = parseOpenRouterCatalog(
      {
        data: [
          { id: "anthropic/claude-sonnet-5", name: "Anthropic: Claude Sonnet 5", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" } },
          { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o-mini", pricing: { prompt: "0.00000015" } },
          { id: "bad id", name: "x" },
        ],
      },
      "claude",
    );
    expect(out).toEqual([
      {
        modelId: "anthropic/claude-sonnet-5",
        name: "Anthropic: Claude Sonnet 5",
        contextLength: 200000,
        promptUsdPerMillion: 3,
        completionUsdPerMillion: 15,
      },
    ]);
  });
});

describe("operator management", () => {
  it("only a platform admin can list or change models", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    await expect(user.as.query(api.aiModels.adminList, {})).rejects.toThrow(/Platform admin only/);
    await expect(
      user.as.mutation(api.aiModels.adminUpsert, { modelId: "openai/gpt-4.1", label: "GPT-4.1", enabled: true }),
    ).rejects.toThrow(/Platform admin only/);
    await expect(user.as.action(api.aiModels.adminCatalog, {})).rejects.toThrow(/Platform admin only/);
  });

  it("the first enabled model becomes default; the default cannot be disabled or removed", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const first = await admin.as.mutation(api.aiModels.adminUpsert, {
      modelId: "anthropic/claude-sonnet-5",
      label: "Claude Sonnet 5",
      enabled: true,
    });
    await admin.as.mutation(api.aiModels.adminUpsert, { modelId: "openai/gpt-4.1", label: "GPT-4.1", enabled: true });
    const list = await admin.as.query(api.aiModels.adminList, {});
    expect(list.models.find((m) => m.isDefault)?._id).toBe(first);

    await expect(
      admin.as.mutation(api.aiModels.adminUpsert, { modelId: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", enabled: false }),
    ).rejects.toThrow(/default/);
    await expect(admin.as.mutation(api.aiModels.adminRemove, { id: first })).rejects.toThrow(/default/);
    await expect(
      admin.as.mutation(api.aiModels.adminUpsert, { modelId: "not a model", label: "x", enabled: true }),
    ).rejects.toThrow(/OpenRouter model id/);

    const audit = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(audit.map((row) => row.action)).toEqual(["ai_model.add", "ai_model.add"]);
  });
});

describe("model resolution in the gateway", () => {
  it("uses the fallback, then the default, then the project's enabled choice", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio", industry: "Architecture" });
    stubCompletionContent(JSON.stringify({ gaps: [{ title: "Planning permission timeline" }] }));

    await owner.as.action(api.ai.detectContentGaps, { projectId });
    expect(completionCalls.at(-1)?.model).toBe(FALLBACK_MODEL_ID);

    await admin.as.mutation(api.aiModels.adminUpsert, { modelId: "anthropic/claude-sonnet-5", label: "Claude", enabled: true });
    await admin.as.mutation(api.aiModels.adminUpsert, { modelId: "openai/gpt-4.1", label: "GPT-4.1", enabled: true });
    await owner.as.action(api.ai.detectContentGaps, { projectId });
    expect(completionCalls.at(-1)?.model).toBe("anthropic/claude-sonnet-5");

    await owner.as.mutation(api.projects.setAiModel, { id: projectId, modelId: "openai/gpt-4.1" });
    await owner.as.action(api.ai.detectContentGaps, { projectId });
    expect(completionCalls.at(-1)?.model).toBe("openai/gpt-4.1");

    // Disabling the chosen model falls back to the default, never to the stale choice.
    await admin.as.mutation(api.aiModels.adminUpsert, { modelId: "openai/gpt-4.1", label: "GPT-4.1", enabled: false });
    await owner.as.action(api.ai.detectContentGaps, { projectId });
    expect(completionCalls.at(-1)?.model).toBe("anthropic/claude-sonnet-5");
  });

  it("a project cannot choose a model the operator has not enabled", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    await expect(
      owner.as.mutation(api.projects.setAiModel, { id: projectId, modelId: "openai/o3-pro" }),
    ).rejects.toThrow(/isn't available/);
    const other = await seedUser(t);
    await expect(
      other.as.mutation(api.projects.setAiModel, { id: projectId, modelId: null }),
    ).rejects.toThrow();
  });
});

describe("structured output repair", () => {
  it("retries once with the contract restated, recording both runs", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });

    let call = 0;
    const replies = ["Sure! Here are some gaps: ...", JSON.stringify({ gaps: [{ title: "Extension costs" }] })];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).hostname === "openrouter.ai") stubCompletionContent(replies[Math.min(call++, 1)]!);
      return original(input, init);
    }) as typeof fetch;
    try {
      const result = await owner.as.action(api.ai.detectContentGaps, { projectId });
      expect(result.gaps[0]?.title).toBe("Extension costs");
    } finally {
      globalThis.fetch = original;
    }
    expect(completionCalls).toHaveLength(2);
    const repairTurn = completionCalls[1]?.messages.at(-1)?.content ?? "";
    expect(repairTurn).toMatch(/could not be used/);
    const runs = await t.run((ctx) => ctx.db.query("aiRuns").collect());
    expect(runs.map((run) => run.status)).toEqual(["failed", "succeeded"]);
  });

  it("gives up after one repair attempt", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    stubCompletionContent("never JSON");
    await expect(owner.as.action(api.ai.detectContentGaps, { projectId })).rejects.toThrow(/invalid response/);
    expect(completionCalls).toHaveLength(2);
  });
});
