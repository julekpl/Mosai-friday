import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionCtx } from "@/convex/_generated/server";
import type { Id } from "@/convex/_generated/dataModel";
import { internal } from "@/convex/_generated/api";
import { validateJourneyMapOutput } from "@/convex/ai";
import {
  MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
  modelComplete,
  normalizeOpenRouterResponse,
  type ModelGatewayRequest,
} from "@/convex/lib/modelGateway";
import {
  completionCalls,
  resetCompletionStub,
  stubCompletionContent,
  stubCompletionError,
  stubMalformedCompletionContent,
} from "./stubs/vly-integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBackend, seedProject, seedUser } from "./helpers";

const userId = "users:test" as Id<"users">;
const projectId = "projects:test" as Id<"projects">;

function mockContext() {
  const runMutation = vi
    .fn()
    .mockResolvedValueOnce("aiRuns:test")
    .mockResolvedValue(undefined);
  return {
    ctx: { runMutation } as unknown as ActionCtx,
    runMutation,
  };
}

function request(
  ctx: ActionCtx,
  overrides: Partial<Omit<ModelGatewayRequest, "ctx" | "userId" | "projectId">> = {},
) {
  return {
    ctx,
    userId,
    projectId,
    agentId: "create.content_generation",
    promptVersion: "v1",
    autonomy: "draft" as const,
    contextSources: ["project.snapshot", "request.context"],
    model: "gpt-4o-mini",
    messages: [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: "user content" },
    ],
    maxOutputTokens: 900,
    temperature: 0.7,
    ...overrides,
  };
}

describe("ModelGateway S1", () => {
  beforeEach(() => resetCompletionStub());
  afterEach(() => resetCompletionStub());

  it("records one safe run and stores only provider-reported usage", async () => {
    const { ctx, runMutation } = mockContext();
    stubCompletionContent("generated draft");

    const result = await modelComplete(request(ctx));

    expect(result.text).toBe("generated draft");
    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0]?.maxTokens).toBe(900);
    expect(runMutation).toHaveBeenCalledTimes(2);
    const [, startArgs] = runMutation.mock.calls[0] ?? [];
    const [, finishArgs] = runMutation.mock.calls[1] ?? [];
    expect(startArgs).toMatchObject({
      userId,
      projectId,
      agentId: "create.content_generation",
      promptVersion: "v1",
      provider: "vly",
      maxOutputTokens: 900,
      contextSources: ["project.snapshot", "request.context"],
    });
    expect(startArgs).not.toHaveProperty("messages");
    expect(finishArgs).toMatchObject({
      status: "succeeded",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      providerCredits: 1,
      costMicrousd: null,
      errorCategory: null,
    });
  });

  it("uses the namespaced OpenRouter model id and records the request in the offline adapter", async () => {
    const { ctx } = mockContext();
    stubCompletionContent("openrouter draft");

    const result = await modelComplete(request(ctx, {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    }));

    expect(result.text).toBe("openrouter draft");
    expect(completionCalls[0]).toMatchObject({
      model: "openai/gpt-4o-mini",
      maxTokens: 900,
    });
  });

  it("persists metadata-only running and terminal states through internal mutations", async () => {
    const t = newBackend();
    const alice = await seedUser(t);
    const ownedProjectId = (await seedProject(t, alice.userId)) as Id<"projects">;
    const runId = await t.mutation(internal.guards.startAiRun, {
      userId: alice.userId,
      projectId: ownedProjectId,
      agentId: "create.content_generation",
      promptVersion: "v1",
      provider: "vly",
      model: "gpt-4o-mini",
      autonomy: "draft",
      maxOutputTokens: 900,
      contextSources: ["project.snapshot"],
    });
    const running = await t.run((ctx) => ctx.db.get(runId));
    expect(running).toMatchObject({
      userId: alice.userId,
      projectId: ownedProjectId,
      status: "running",
      promptTokens: null,
      costMicrousd: null,
      costCurrency: null,
    });
    expect(running).not.toHaveProperty("prompt");
    expect(running).not.toHaveProperty("output");

    await t.mutation(internal.guards.finishAiRun, {
      runId,
      status: "succeeded",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      providerCredits: 1,
      costMicrousd: null,
      costCurrency: null,
      errorCategory: null,
      finishedAt: 123,
      latencyMs: 12,
    });
    await t.mutation(internal.guards.finishAiRun, {
      runId,
      status: "failed",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      providerCredits: null,
      costMicrousd: null,
      costCurrency: null,
      errorCategory: "provider_error",
      finishedAt: 124,
      latencyMs: 13,
    });
    const finished = await t.run((ctx) => ctx.db.get(runId));
    expect(finished).toMatchObject({ status: "succeeded", providerCredits: 1 });
  });

  it("derives a project run organization from the stored project", async () => {
    const t = newBackend();
    const alice = await seedUser(t);
    const organizationId = await t.run((ctx) => ctx.db.insert("organizations", {
      name: "Tenant org",
      slug: `tenant-${Date.now()}`,
      createdAt: Date.now(),
    }));
    const ownedProjectId = await t.run((ctx) => ctx.db.insert("projects", {
      ownerId: alice.userId,
      organizationId,
      name: "Tenant project",
      createdAt: Date.now(),
    }));
    const runId = await t.mutation(internal.guards.startAiRun, {
      userId: alice.userId,
      projectId: ownedProjectId,
      agentId: "create.content_generation",
      promptVersion: "v1",
      provider: "vly",
      model: "gpt-4o-mini",
      autonomy: "draft",
      maxOutputTokens: 900,
      contextSources: ["project.snapshot"],
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ organizationId });
  });

  it("records a safe failure category without persisting provider error text", async () => {
    const { ctx, runMutation } = mockContext();
    const marker = "provider-private-error-marker";
    stubCompletionError(marker);

    await expect(modelComplete(request(ctx))).rejects.toThrow(
      "AI provider request failed. Try again later.",
    );

    const calls = JSON.stringify(runMutation.mock.calls);
    expect(calls).not.toContain(marker);
    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "provider_error",
      promptTokens: null,
      costMicrousd: null,
    });
  });

  it("records an empty provider result as failed, not successful", async () => {
    const { ctx, runMutation } = mockContext();
    stubCompletionContent("   ");

    await expect(modelComplete(request(ctx))).rejects.toThrow(
      "AI returned an empty response.",
    );

    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "empty_response",
    });
  });

  it("records schema-invalid structured output as failed and keeps plain text supported", async () => {
    const invalid = mockContext();
    stubCompletionContent('{"pages":[]}');
    await expect(
      modelComplete(request(invalid.ctx, {
        validateOutput: (text) => {
          const parsed = JSON.parse(text) as { pages?: unknown };
          if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) throw new Error("invalid pages");
        },
      })),
    ).rejects.toThrow("AI returned an invalid response.");
    expect(invalid.runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "invalid_output",
    });

    const plain = mockContext();
    stubCompletionContent("ordinary prose");
    await expect(modelComplete(request(plain.ctx))).resolves.toMatchObject({ text: "ordinary prose" });
    expect(plain.runMutation.mock.calls.at(-1)?.[1]).toMatchObject({ status: "succeeded" });
  });

  it("fails a journey map containing a valid stage followed by null before success is recorded", async () => {
    const { ctx, runMutation } = mockContext();
    stubCompletionContent('{"stages":[{"stage":"Awareness"},null]}');

    await expect(modelComplete(request(ctx, { validateOutput: validateJourneyMapOutput }))).rejects.toThrow(
      "AI returned an invalid response.",
    );
    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "invalid_output",
    });
  });

  it("treats malformed Vly and OpenRouter content as empty without throwing parser details", async () => {
    const { ctx, runMutation } = mockContext();
    stubMalformedCompletionContent(42);

    await expect(modelComplete(request(ctx))).rejects.toThrow(
      "AI returned an empty response.",
    );
    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "empty_response",
    });

    expect(normalizeOpenRouterResponse(null)).toEqual({
      text: "",
      toolCalls: [],
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        providerCredits: null,
        costMicrousd: null,
        costCurrency: null,
      },
    });
    expect(
      normalizeOpenRouterResponse({
        choices: [{ message: { content: 42 } }],
        usage: { prompt_tokens: "unknown", cost: "unknown" },
      }),
    ).toMatchObject({ text: "", usage: { promptTokens: null, costMicrousd: null } });
    expect(
      normalizeOpenRouterResponse({
        choices: [{ message: { content: "reply" } }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 5,
          total_tokens: 13,
          cost: 0.000001,
        },
      }),
    ).toEqual({
      text: "reply",
      toolCalls: [],
      usage: {
        promptTokens: 8,
        completionTokens: 5,
        totalTokens: 13,
        providerCredits: null,
        costMicrousd: 1,
        costCurrency: "USD",
      },
    });
  });

  it("leaves a run running if the terminal write fails after provider success", async () => {
    let persistedStatus: "absent" | "running" | "succeeded" = "absent";
    let attemptedFinish: unknown;
    const ctx = {
      runMutation: vi.fn(async (_reference: unknown, args?: unknown) => {
        if (persistedStatus === "absent") {
          persistedStatus = "running";
          return "aiRuns:terminal-write-failure";
        }
        attemptedFinish = args;
        const status = (args as { status: "failed" | "succeeded" }).status;
        if (status === "succeeded") throw new Error("database write unavailable");
        persistedStatus = status;
        return undefined;
      }),
    } as unknown as ActionCtx;
    stubCompletionContent("provider returned this");

    await expect(modelComplete(request(ctx))).rejects.toThrow(
      "AI run status could not be recorded.",
    );
    // The provider did respond, but the gateway never turns an unpersisted
    // completion into a success. BP-07 can reconcile stale running records.
    expect(completionCalls).toHaveLength(1);
    expect(attemptedFinish).toMatchObject({ status: "succeeded" });
    expect(persistedStatus).toBe("running");
  });

  it("rejects requests above the hard output cap before calling a provider", async () => {
    const { ctx, runMutation } = mockContext();

    await expect(
      modelComplete(
        request(ctx, { maxOutputTokens: MODEL_GATEWAY_MAX_OUTPUT_TOKENS + 1 }),
      ),
    ).rejects.toThrow("configured gateway limits");

    expect(completionCalls).toHaveLength(0);
    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({
      status: "failed",
      errorCategory: "invalid_request",
    });
  });

  it("allows the configured maximum used by structured website generation", async () => {
    const { ctx } = mockContext();
    stubCompletionContent("{} ");

    await modelComplete(request(ctx, { maxOutputTokens: MODEL_GATEWAY_MAX_OUTPUT_TOKENS }));

    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0]?.maxTokens).toBe(MODEL_GATEWAY_MAX_OUTPUT_TOKENS);
  });

  it("keeps direct provider calls out of all AI feature files", () => {
    const root = process.cwd();
    const files = [
      "src/convex/ai.ts",
      "src/convex/buildPlan.ts",
      "src/convex/buildChat.ts",
      "src/convex/sellAI.ts",
      "src/convex/social/copilot.ts",
      "src/convex/ads/copilot.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).toContain("modelComplete");
      expect(source, file).not.toMatch(/vly\.ai\.completion|OPENROUTER_API_KEY|openrouter\.ai\/api\/v1/);
    }
    for (const file of [
      "src/convex/ai.ts",
      "src/convex/buildPlan.ts",
      "src/convex/sellAI.ts",
      "src/convex/buildChat.ts",
      "src/convex/social/copilot.ts",
      "src/convex/ads/copilot.ts",
    ]) {
      expect(readFileSync(join(root, file), "utf8"), file).toContain(
        "consumeAiQuotaForAction",
      );
    }

    const filesBelowConvex = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== "_generated") {
          return filesBelowConvex(path);
        }
        return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
      });
    const directCalls = filesBelowConvex(join(root, "src/convex"))
      .filter((file) => !file.endsWith("/lib/modelGateway.ts"))
      .filter((file) => /vly\.ai\.completion|openrouter\.ai\/api\/v1\/chat\/completions/.test(readFileSync(file, "utf8")));
    expect(directCalls).toEqual([]);
  });
});
