import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type AssistArgs = FunctionArgs<typeof api.ai.brandAssist>;
export type AssistField = AssistArgs["field"];
export type AssistResult = FunctionReturnType<typeof api.ai.brandAssist>;

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

/** Shared call + state for every AI helper in the Brand tab. */
export function useBrandAssist(projectId: Id<"projects">) {
  const assist = useAction(api.ai.brandAssist);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (args: Omit<AssistArgs, "projectId">): Promise<AssistResult | null> => {
    setBusy(true);
    setError(null);
    try {
      return await assist({ projectId, ...args });
    } catch (caught) {
      setError(errorText(caught));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

