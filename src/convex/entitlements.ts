import { v } from "convex/values";
import { orgQuery, projectTenant } from "./guards";
import {
  CAPABILITY_STATES,
  MODULE_DEFINITIONS,
  PLANS,
  capabilityMatrix,
  countryPolicy,
  modulesForPlan,
  type CapabilityAction,
  type ModuleCapabilityView,
} from "./lib/capabilities";

/**
 * Entitlements (MOSAI pack T2.3) — the read side of the capability registry.
 *
 * The UI never hardcodes a plan tier or a module list: it asks for the resolved
 * matrix and renders the capability state (`included | locked | needs_setup |
 * unavailable`) that the server would enforce. `moduleQuery` /
 * `moduleMutation` / `moduleAction` enforce the same states, so what the UI
 * shows and what the server allows cannot drift.
 */

type MatrixView = {
  plan: string;
  role: string;
  country: string;
  modules: ModuleCapabilityView[];
};

/**
 * The caller's resolved capability matrix for one project, or **null** when the
 * caller cannot reach the project at all.
 *
 * Null — not an envelope of empty values — is deliberate: the T2.2 generated
 * cross-tenant suite asserts a foreign caller gets `null`/`[]`/`{}` back, and it
 * caught this function returning a populated envelope instead. A foreign caller
 * must not even learn that the project exists (`AGENTS.md` §5 rule 2), and the
 * UI renders `locked`/`unavailable` from the absence of a matrix.
 */
export const matrix = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<MatrixView | null> => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;

    const tenant = await projectTenant(ctx, scope.project, scope.userId);
    if (!tenant) return null;

    // The country matrix is a stub (see the registry): the resolved policy is
    // echoed so the UI can label it honestly instead of guessing.
    const policy = countryPolicy();
    return {
      plan: tenant.plan,
      role: tenant.role,
      country: policy.label,
      modules: capabilityMatrix({ plan: tenant.plan, role: tenant.role }),
    };
  },
});

/** The plan cards, straight from the registry (module lists are not duplicated
 *  in the UI any more). Prices stay in the UI until T2.4 owns billing. */
export const plans = orgQuery({
  args: {},
  handler: async (_ctx, _args, access) => {
    await access.requireUser();
    return PLANS.map((plan) => ({
      id: plan,
      modules: modulesForPlan(plan).map((module) => {
        const definition = MODULE_DEFINITIONS.find((m) => m.id === module);
        return {
          id: module,
          label: definition?.label ?? module,
          summary: definition?.summary ?? "",
        };
      }),
    }));
  },
});

/** The capability vocabulary, for documentation and tests. */
export const vocabulary = orgQuery({
  args: {},
  handler: async (_ctx, _args, access) => {
    await access.requireUser();
    return {
      states: [...CAPABILITY_STATES],
      modules: MODULE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.label,
        summary: definition.summary,
        actions: [...definition.actions] as CapabilityAction[],
      })),
    };
  },
});
