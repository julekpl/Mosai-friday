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

export function stubCompletionContent(content: string) {
  nextContent = content;
}

export function resetCompletionStub() {
  completionCalls.length = 0;
  nextContent = "{}";
}

type CompletionResult = {
  success: boolean;
  data?: { choices: Array<{ message: { content: string } }> };
  error?: string;
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
        return {
          success: true,
          data: { choices: [{ message: { content: nextContent } }] },
        };
      },
    },
  };
}
