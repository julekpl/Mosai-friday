import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { vly } from "../../lib/vly-integrations";

// The site generator emits a structured multi-page plan (3-6 pages x 3-6
// blocks); 3,000 tokens truncated it in practice. Long-form content and full
// site plans need room, so the ceiling is 8,000 output tokens per request.
export const MODEL_GATEWAY_MAX_OUTPUT_TOKENS = 8_000;
export const MODEL_GATEWAY_TIMEOUT_MS = 90_000;
/** Structured outputs that fail validation get one repair attempt. */
export const MODEL_GATEWAY_REPAIR_ATTEMPTS = 1;
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
  /** Omit to use the operator-configured model for this project
   *  (aiModels.resolveForRequest). Feature code should omit it. */
  model?: string;
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
    !request.model?.trim() ||
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
    /** False when no provider call was made; defaults to billable. */
    billable?: boolean;
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

async function callVly(request: ResolvedRequest, maxTokens: number) {
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

async function callOpenRouter(request: ResolvedRequest, maxTokens: number) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("provider configuration unavailable");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://mosai.app",
      "X-Title": "MOSAI",
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: maxTokens,
      temperature: request.temperature ?? 0.7,
      // Ask OpenRouter to report the real cost so the budget books it.
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(MODEL_GATEWAY_TIMEOUT_MS),
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
 *
 * Cost control: every attempt (including the repair turn) starts with
 * `guards.startAiRun`, which refuses with an "AI budget reached" ConvexError
 * when the organization's monthly budget or the platform's daily cap
 * (lib/aiBudget.ts) cannot cover the request's worst-case cost. The refusal
 * happens before any provider call and writes no run.
 */
export async function modelComplete(
  request: ModelGatewayRequest,
): Promise<ModelGatewayResult> {
  const provider = request.provider ?? "vly";
  const model =
    request.model ??
    (
      await request.ctx.runQuery(internal.aiModels.resolveForRequest, {
        projectId: request.projectId,
      })
    ).modelId;
  const resolved: ResolvedRequest = { ...request, provider, model };

  let messages = resolved.messages;
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await runOnce({ ...resolved, messages });
    if (outcome.ok) return outcome.result;
    const canRepair =
      outcome.error === "invalid_output" &&
      Boolean(request.validateOutput) &&
      attempt < MODEL_GATEWAY_REPAIR_ATTEMPTS;
    if (!canRepair) throw new Error(errorMessage(outcome.error));
    // One repair turn: show the model its own reply and restate the contract.
    // The rejected text is model output (never user data), bounded in size.
    messages = [
      ...resolved.messages,
      { role: "assistant", content: outcome.text.slice(0, 12_000) },
      {
        role: "user",
        content:
          "That reply could not be used: it did not match the required format or was cut off. Reply again with ONLY the complete output in exactly the requested format — no commentary, no markdown fences — and keep it within the length limit.",
      },
    ];
  }
}

function errorMessage(category: AiErrorCategory): string {
  switch (category) {
    case "invalid_request":
      return "AI request is outside the configured gateway limits.";
    case "empty_response":
      return "AI returned an empty response.";
    case "invalid_output":
      return "AI returned an invalid response.";
    default:
      return "AI provider request failed. Try again later.";
  }
}

type ResolvedRequest = ModelGatewayRequest & { provider: ModelProvider; model: string };

type AttemptOutcome =
  | { ok: true; result: ModelGatewayResult }
  | { ok: false; error: AiErrorCategory; text: string };

/** One recorded provider call: its own aiRuns row, so cost stays honest. */
async function runOnce(request: ResolvedRequest): Promise<AttemptOutcome> {
  const provider = request.provider;
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
    // Budget estimate only: sizes, never content.
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    messageCount: request.messages.length,
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
      billable: false,
    });
    return { ok: false, error: invalidRequest, text: "" };
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
    return { ok: false, error: "provider_error", text: "" };
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
  if (outputError) return { ok: false, error: outputError, text: result.text };
  return { ok: true, result: { text: result.text, usage: result.usage } };
}
