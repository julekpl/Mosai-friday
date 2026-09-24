/**
 * Test stub for `@vly-ai/integrations` (MOSAI pack T1.7).
 *
 * The real package touches `document` at import time, so it cannot load in the
 * Vitest `edge-runtime` environment that Convex functions are tested under. The
 * Phase 0 regression tests do not exercise the platform SDK itself — they assert
 * that the server *rejects* unauthenticated callers before any provider call,
 * and that a client-supplied snapshot never reaches the prompt. Aliasing the
 * package to this stub (see `vitest.config.ts`) keeps those assertions hermetic
 * and offline, and lets R4 capture the exact prompt the server built.
 *
 * This file is test-only; nothing in `src/` imports it.
 */

export type CompletionCall = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
};

/** Every `completion()` call made during a test, in order. */
export const completionCalls: CompletionCall[] = [];

/** Set by a test to control the fake model reply. */
let nextContent = "{}";
let nextError: string | null = null;
let nextMalformedContent: unknown;
let hasMalformedContent = false;

export function stubCompletionContent(content: string) {
  nextContent = content;
}

export function stubCompletionError(message: string) {
  nextError = message;
}

export function stubMalformedCompletionContent(content: unknown) {
  nextMalformedContent = content;
  hasMalformedContent = true;
}

export function resetCompletionStub() {
  completionCalls.length = 0;
  nextContent = "{}";
  nextError = null;
  nextMalformedContent = undefined;
  hasMalformedContent = false;
}

/** Offline OpenRouter adapter used by unit tests that choose that provider. */
export function openRouterFetch(_input: RequestInfo | URL, init?: RequestInit): Response {
  let request: { model?: unknown; messages?: unknown; max_tokens?: unknown; temperature?: unknown } = {};
  try {
    request = JSON.parse(String(init?.body ?? "{}")) as typeof request;
  } catch {
    return new Response("invalid fixture request", { status: 400 });
  }
  const messages = Array.isArray(request.messages)
    ? request.messages as Array<{ role: string; content: string }>
    : [];
  completionCalls.push({
    model: typeof request.model === "string" ? request.model : "",
    messages,
    maxTokens: typeof request.max_tokens === "number" ? request.max_tokens : undefined,
    temperature: typeof request.temperature === "number" ? request.temperature : undefined,
  });
  if (nextError) return new Response(JSON.stringify({ error: nextError }), { status: 500 });
  const content = hasMalformedContent ? nextMalformedContent : nextContent;
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

type CompletionResult = {
  success: boolean;
  data?: { choices: Array<{ message: { content: string } }> };
  error?: string;
  usage?: { credits?: number; operation?: string };
};

/**
 * Minimal stand-in for the real `createVlyIntegrations` factory. The real one
 * takes `{ deploymentToken, debug }`; callers pass it, and extra arguments are
 * harmless, so the stub ignores the whole config.
 */
export function createVlyIntegrations() {
  return {
    ai: {
      completion: async (args: CompletionCall): Promise<CompletionResult> => {
        completionCalls.push(args);
        return nextError
          ? { success: false, error: nextError }
          : {
              success: true,
              data: {
                choices: [
                  {
                    message: {
                      content: hasMalformedContent
                        ? (nextMalformedContent as string)
                        : nextContent,
                    },
                  },
                ],
              },
              usage: { credits: 1, operation: "completion" },
            };
      },
    },
  };
}
