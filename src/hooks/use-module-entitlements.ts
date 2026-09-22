import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CapabilityState, ModuleId } from "@/convex/lib/capabilities";

/**
 * The caller's capability states for one project, straight from the server
 * (T2.3). The routes, the sidebar locks and the module cards all render this,
 * so the UI cannot show a module the guards would refuse — and, because the
 * matrix is resolved from the **organization's** plan and the caller's role,
 * a teammate no longer sees a different module list than the server enforces.
 *
 * No project selected yet (the project switcher, `/app` before a project
 * exists): fall back to `billing.currentPlan`, which is the same registry read
 * without a tenant.
 */
export type ModuleEntitlements = {
  /** True while neither query has resolved. */
  loading: boolean;
  plan: string | null;
  role: string | null;
  /** The country policy label ("Default" while the matrix is a stub). */
  country: string | null;
  /** The state the server would enforce for this module, or null if unknown. */
  stateOf: (module: string) => CapabilityState | null;
  /** Labels for the modules whose state is `included`. */
  included: ModuleId[];
  /** Human label for a module id, from the registry. */
  labelOf: (module: string) => string;
};

export function useModuleEntitlements(
  projectId?: Id<"projects">,
): ModuleEntitlements {
  const matrix = useQuery(
    api.entitlements.matrix,
    projectId ? { projectId } : "skip",
  );
  const billing = useQuery(api.billing.currentPlan);

  const modules = matrix?.modules ?? [];

  const stateOf = (module: string): CapabilityState | null => {
    const resolved = modules.find((m) => m.module === module);
    if (resolved) return resolved.state;
    if (!matrix && billing) {
      // No project scope: the plan's module list is still the registry's.
      return (billing.modules as readonly string[]).includes(module)
        ? "included"
        : "locked";
    }
    return null;
  };

  return {
    loading: matrix === undefined && billing === undefined,
    plan: matrix?.plan ?? billing?.plan ?? null,
    role: matrix?.role ?? null,
    country: matrix?.country ?? null,
    stateOf,
    included: modules
      .filter((m) => m.state === "included")
      .map((m) => m.module),
    labelOf: (module) =>
      modules.find((m) => m.module === module)?.label ?? module,
  };
}

/** The honest label for a non-`included` capability state (blueprint §3). */
export function capabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case "locked":
      return "upgrade";
    case "needs_setup":
      return "needs setup";
    case "unavailable":
      return "unavailable";
    case "included":
      return "included";
  }
}
