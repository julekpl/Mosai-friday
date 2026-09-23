import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { vly } from "../../lib/vly-integrations";

export const MODEL_GATEWAY_MAX_OUTPUT_TOKENS = 2_000;
export const MODEL_GATEWAY_MAX_INPUT_CHARS = 100_000;

export type ModelProvider = "vly" | "openrouter";
export type AiAutonomy = "assistive" | "draft";
export type AiErrorCategory =
  | "provider_error"
  | "empty_response"
  | "invalid_request"
  | "invalid_output";

export type OutputValidator = (text: string) => void;

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelGatewayRequest = {
  ctx: ActionCtx;
  userId: Id<"users">;
  projectId?: Id<"projects">;
  agentId: string;
  promptVersion: string;
  autonomy: AiAutonomy;
  contextSources: string[];
  provider?: ModelProvider;
  model: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  temperature?: number;
  validateOutput?: OutputValidator;
};

export type ProviderUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  providerCredits: number | null;
  costMicrousd: number | null;
  costCurrency: "USD" | null;
};

export type ModelGatewayResult = {
  text: string;
  usage: ProviderUsage;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeOpenRouterResponse(value: unknown): {
  text: string;
  usage: ProviderUsage;
} {
  const data = record(value);
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  const firstChoice = record(choices[0]);
  const message = record(firstChoice?.message);
  const usage = record(data?.usage);
  const cost = finiteNumber(usage?.cost);
  const costMicrousd = cost === null ? null : finiteNumber(Math.round(cost * 1_000_000));
  return {
    text: typeof message?.content === "string" ? message.content.trim() : "",
    usage: {
      promptTokens: finiteNumber(usage?.prompt_tokens),
      completionTokens: finiteNumber(usage?.completion_tokens),
      totalTokens: finiteNumber(usage?.total_tokens),
      providerCredits: null,
      costMicrousd,
      costCurrency: costMicrousd === null ? null : "USD",
    },
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyUsage(): ProviderUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    providerCredits: null,
    costMicrousd: null,
    costCurrency: null,
  };
}

function validateRequest(request: ModelGatewayRequest): AiErrorCategory | null {
  const maxTokens = request.maxOutputTokens;
  if (
    !request.agentId.trim() ||
    !request.promptVersion.trim() ||
    !request.model.trim() ||
    request.model.length > 120 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > MODEL_GATEWAY_MAX_OUTPUT_TOKENS ||
    !request.messages.length ||
    request.messages.some((message) => typeof message.content !== "string") ||
    request.contextSources.length > 20 ||
    request.contextSources.some((source) => !source.trim() || source.length > 80) ||
    request.messages.reduce((sum, message) => sum + message.content.length, 0) >
      MODEL_GATEWAY_MAX_INPUT_CHARS
  ) {
    return "invalid_request";
  }
  return null;
}

async function persistRunFinish(
  ctx: ActionCtx,
  args: {
    runId: Id<"aiRuns">;
    status: "succeeded" | "failed";
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    providerCredits: number | null;
    costMicrousd: number | null;
    costCurrency: "USD" | null;
    errorCategory: AiErrorCategory | null;
    finishedAt: number;
    latencyMs: number;
  },
) {
  try {
    await ctx.runMutation(internal.guards.finishAiRun, args);
  } catch {
    // Keep storage internals out of user-visible errors. The durable row stays
    // running and is an unknown outcome until BP-07 reconciliation exists.
    throw new Error("AI run status could not be recorded.");
  }
}

async function callVly(request: ModelGatewayRequest, maxTokens: number) {
  const result = await vly.ai.completion({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    maxTokens,
  });
  const usage = (result as unknown as { usage?: { credits?: unknown } }).usage;
  const content = result.data?.choices?.[0]?.message?.content;
  return {
    text: result.success && typeof content === "string" ? content.trim() : "",
    failed: !result.success,
    usage: {
      ...emptyUsage(),
      providerCredits: finiteNumber(usage?.credits),
    },
  };
}

async function callOpenRouter(request: ModelGatewayRequest, maxTokens: number) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("provider configuration unavailable");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://mosai.app",
      "X-Title": "MOSAI Ads Copilot",
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: maxTokens,
      temperature: request.temperature ?? 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("provider request failed");

  const normalized = normalizeOpenRouterResponse(await response.json());
  return {
    text: normalized.text,
    failed: false,
    usage: normalized.usage,
  };
}

/**
 * The only model-provider boundary for Convex features. It records safe run
 * metadata before and after each provider request; prompts and outputs stay in
 * the caller's memory and never enter the run table.
 */
export async function modelComplete(
  request: ModelGatewayRequest,
): Promise<ModelGatewayResult> {
  const provider = request.provider ?? "vly";
  const maxTokens = Math.min(
    request.maxOutputTokens,
    MODEL_GATEWAY_MAX_OUTPUT_TOKENS,
  );
  const startedAt = Date.now();
  const runId = await request.ctx.runMutation(internal.guards.startAiRun, {
    userId: request.userId,
    projectId: request.projectId,
    agentId: request.agentId,
    promptVersion: request.promptVersion,
    provider,
    model: request.model,
    autonomy: request.autonomy,
    maxOutputTokens: maxTokens,
    contextSources: request.contextSources,
  });

  const invalidRequest = validateRequest(request);
  if (invalidRequest) {
    await persistRunFinish(request.ctx, {
      runId,
      status: "failed",
      ...emptyUsage(),
      errorCategory: invalidRequest,
      finishedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
    });
    throw new Error("AI request is outside the configured gateway limits.");
  }

  let result:
    | Awaited<ReturnType<typeof callVly>>
    | Awaited<ReturnType<typeof callOpenRouter>>;
  try {
    result =
      provider === "openrouter"
        ? await callOpenRouter(request, maxTokens)
        : await callVly(request, maxTokens);
  } catch {
    // The provider message may contain customer data or secret material.
    // Store only a fixed error category and return a stable safe message.
    await persistRunFinish(request.ctx, {
      runId,
      status: "failed",
      ...emptyUsage(),
      errorCategory: "provider_error",
      finishedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
    });
    throw new Error("AI provider request failed. Try again later.");
  }

  const errorCategory: AiErrorCategory | null = result.failed
    ? "provider_error"
    : result.text
      ? null
      : "empty_response";
  let outputError: AiErrorCategory | null = errorCategory;
  if (!outputError && request.validateOutput) {
    try {
      request.validateOutput(result.text);
    } catch {
      outputError = "invalid_output";
    }
  }
  await persistRunFinish(request.ctx, {
    runId,
    status: outputError ? "failed" : "succeeded",
    ...result.usage,
    errorCategory: outputError,
    finishedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
  });
  if (outputError === "provider_error") {
    throw new Error("AI provider request failed. Try again later.");
  }
  if (outputError === "empty_response") {
    throw new Error("AI returned an empty response.");
  }
  if (outputError === "invalid_output") {
    throw new Error("AI returned an invalid response.");
  }
  return { text: result.text, usage: result.usage };
}
