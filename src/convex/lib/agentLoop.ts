import { z } from "zod";
import {
  MODEL_GATEWAY_MAX_TOOL_ARGUMENT_CHARS,
  modelToolStep,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelToolMessage,
  type ModelToolStepRequest,
} from "./modelGateway";

/**
 * Bounded tool-calling loop for the in-product copilot (T2.17, decision
 * record `docs/decisions/2026-09-24-in-product-ai-agent.md`, option C).
 *
 * The model only ever *asks* for a tool. Everything that decides whether the
 * ask runs lives here, in server code:
 *
 * - Only tools passed in by the caller exist. An unknown name is refused.
 * - Arguments are parsed as JSON and validated by the tool's zod schema
 *   before the handler sees them.
 * - Tool effects are limited to `read`, `navigate` and `draft`. Nothing that
 *   publishes, schedules, sends or spends can be registered (AGENTS.md rule 5;
 *   those become ApprovalGate proposals in T2.12).
 * - Tenant identifiers are never model arguments. A tool's handler is a
 *   closure over the server-resolved user and project, so injected text cannot
 *   point a tool at another tenant's records (AGENTS.md rules 2 to 4).
 * - The loop stops after a hard step cap, and every step is its own `aiRuns`
 *   row via `modelToolStep`.
 */

export const AGENT_LOOP_MAX_STEPS = 6;
export const AGENT_TOOL_RESULT_MAX_CHARS = 12_000;

export const AGENT_TOOL_EFFECTS = ["read", "navigate", "draft"] as const;
export type AgentToolEffect = (typeof AGENT_TOOL_EFFECTS)[number];

/** Argument names reserved for server-bound tenant context. */
export const RESERVED_TOOL_ARGUMENTS = [
  "projectId",
  "userId",
  "organizationId",
  "ownerId",
] as const;

/** Throw from a handler to give the model a safe, user-facing reason. Any
 *  other error is reported to the model only as `tool_failed`. */
export class AgentToolError extends Error {}

type ParsedCall =
  | { ok: true; run: () => Promise<unknown> }
  | { ok: false; error: "invalid_arguments"; issues: string[] };

/** A registered tool. Build one with `defineAgentTool`. */
export type AgentTool = {
  readonly name: string;
  readonly effect: AgentToolEffect;
  readonly definition: ModelToolDefinition;
  parse(rawArguments: string): ParsedCall;
};

export function defineAgentTool<Schema extends z.ZodObject>(tool: {
  name: string;
  description: string;
  effect: AgentToolEffect;
  args: Schema;
  execute: (args: z.infer<Schema>) => Promise<unknown>;
}): AgentTool {
  if (!(AGENT_TOOL_EFFECTS as readonly string[]).includes(tool.effect)) {
    throw new Error(`Tool ${tool.name} has an effect the copilot may not use.`);
  }
  const reserved = Object.keys(tool.args.shape).filter((key) =>
    (RESERVED_TOOL_ARGUMENTS as readonly string[]).includes(key),
  );
  if (reserved.length) {
    throw new Error(
      `Tool ${tool.name} takes ${reserved.join(", ")} from the model; bind tenant ids on the server instead.`,
    );
  }
  const parameters = z.toJSONSchema(tool.args) as Record<string, unknown>;
  delete parameters.$schema;
  return {
    name: tool.name,
    effect: tool.effect,
    definition: { name: tool.name, description: tool.description, parameters },
    parse(rawArguments) {
      if (rawArguments.length > MODEL_GATEWAY_MAX_TOOL_ARGUMENT_CHARS) {
        return { ok: false, error: "invalid_arguments", issues: ["arguments too long"] };
      }
      let json: unknown;
      try {
        json = rawArguments.trim() ? JSON.parse(rawArguments) : {};
      } catch {
        return { ok: false, error: "invalid_arguments", issues: ["arguments are not valid JSON"] };
      }
      const parsed = tool.args.safeParse(json);
      if (!parsed.success) {
        // Paths and codes only: never echo the rejected values back.
        const issues = parsed.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`);
        return { ok: false, error: "invalid_arguments", issues };
      }
      const args = parsed.data;
      return { ok: true, run: () => tool.execute(args) };
    },
  };
}

export type AgentToolOutcome = {
  callId: string;
  name: string;
  effect: AgentToolEffect | null;
  ok: boolean;
  /** Structured handler output (server data), present when `ok`. UI such as
   *  navigation links is rendered from this, never from the model's prose. */
  result?: unknown;
  error?: "unknown_tool" | "invalid_arguments" | "tool_failed" | "step_limit";
};

export type AgentLoopRequest = Omit<ModelToolStepRequest, "tools"> & {
  tools: AgentTool[];
  maxSteps?: number;
};

export type AgentLoopResult = {
  text: string;
  stopReason: "final" | "step_limit";
  steps: number;
  outcomes: AgentToolOutcome[];
  messages: ModelToolMessage[];
};

function toolMessage(callId: string, payload: unknown): ModelToolMessage {
  let content = JSON.stringify(payload) ?? "null";
  if (content.length > AGENT_TOOL_RESULT_MAX_CHARS) {
    content = JSON.stringify({
      ok: true,
      truncated: true,
      partial: content.slice(0, AGENT_TOOL_RESULT_MAX_CHARS - 200),
    });
  }
  return { role: "tool", toolCallId: callId, content };
}

async function runCall(
  call: ModelToolCall,
  tools: Map<string, AgentTool>,
): Promise<{ outcome: AgentToolOutcome; message: ModelToolMessage }> {
  const tool = tools.get(call.name);
  if (!tool) {
    return {
      outcome: { callId: call.id, name: call.name, effect: null, ok: false, error: "unknown_tool" },
      message: toolMessage(call.id, { ok: false, error: "unknown_tool" }),
    };
  }
  const parsed = tool.parse(call.arguments);
  if (!parsed.ok) {
    return {
      outcome: { callId: call.id, name: tool.name, effect: tool.effect, ok: false, error: parsed.error },
      message: toolMessage(call.id, { ok: false, error: parsed.error, issues: parsed.issues }),
    };
  }
  try {
    const result = await parsed.run();
    return {
      outcome: { callId: call.id, name: tool.name, effect: tool.effect, ok: true, result },
      message: toolMessage(call.id, { ok: true, result }),
    };
  } catch (error) {
    const reason = error instanceof AgentToolError ? error.message.slice(0, 300) : undefined;
    return {
      outcome: { callId: call.id, name: tool.name, effect: tool.effect, ok: false, error: "tool_failed" },
      message: toolMessage(call.id, { ok: false, error: "tool_failed", ...(reason ? { reason } : {}) }),
    };
  }
}

export async function runAgentLoop(request: AgentLoopRequest): Promise<AgentLoopResult> {
  const maxSteps = Math.min(Math.max(1, request.maxSteps ?? AGENT_LOOP_MAX_STEPS), AGENT_LOOP_MAX_STEPS);
  const tools = new Map<string, AgentTool>();
  for (const tool of request.tools) {
    if (tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}.`);
    tools.set(tool.name, tool);
  }
  const definitions = request.tools.map((tool) => tool.definition);
  const messages = [...request.messages];
  const outcomes: AgentToolOutcome[] = [];
  let text = "";

  for (let step = 1; step <= maxSteps; step += 1) {
    const reply = await modelToolStep({
      ctx: request.ctx,
      userId: request.userId,
      projectId: request.projectId,
      agentId: request.agentId,
      promptVersion: request.promptVersion,
      autonomy: request.autonomy,
      contextSources: request.contextSources,
      model: request.model,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      messages,
      tools: definitions,
    });
    text = reply.text;
    if (reply.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: reply.text });
      return { text, stopReason: "final", steps: step, outcomes, messages };
    }
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    if (step === maxSteps) {
      // Out of steps: answer the pending calls without running them, so the
      // stored thread stays well-formed for the provider on the next turn.
      for (const call of reply.toolCalls) {
        outcomes.push({ callId: call.id, name: call.name, effect: tools.get(call.name)?.effect ?? null, ok: false, error: "step_limit" });
        messages.push(toolMessage(call.id, { ok: false, error: "step_limit" }));
      }
      return { text, stopReason: "step_limit", steps: step, outcomes, messages };
    }
    for (const call of reply.toolCalls) {
      const { outcome, message } = await runCall(call, tools);
      outcomes.push(outcome);
      messages.push(message);
    }
  }
  // Unreachable: the last iteration always returns above.
  return { text, stopReason: "step_limit", steps: maxSteps, outcomes, messages };
}
