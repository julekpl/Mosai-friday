/**
 * Billing reconciliation (MOSAI pack T2.4).
 *
 * The job answers one question with a number: **does the local mirror agree
 * with the provider?** Target is `driftCount === 0`. The comparison is a pure
 * function so it can be unit-tested directly and so the Convex job only has to
 * fetch the two sides — no business logic hides in an action.
 *
 * The local side has two layers that can each drift independently:
 *   - the `subscriptions` mirror row (what the provider told us), and
 *   - the `users.plan` / `users.planStatus` entitlement mirror (what the guards
 *     actually read — `guards.planForOrganization` reads the org owner's row).
 *
 * A subscription can be perfectly mirrored while the entitlement still says
 * `free` (a missed apply); that is drift too, and it is the dangerous one.
 */

import { planStatusForState, type PlanStatus } from "./billingCatalog";

export interface ReconcileLocalSubscription {
  organizationId: string;
  subscriptionId: string;
  plan: string;
  status: string;
  priceId?: string | null;
}

/** The entitlement mirror, as the guards read it (org owner's user row). */
export interface ReconcileLocalEntitlement {
  organizationId: string;
  plan: string | null;
  planStatus: string | null;
}

export interface ReconcileProviderSubscription {
  organizationId: string;
  subscriptionId: string;
  plan: string;
  status: string;
  priceId?: string | null;
}

export interface ReconcileInput {
  localSubscriptions: ReconcileLocalSubscription[];
  localEntitlements: ReconcileLocalEntitlement[];
  providerSubscriptions: ReconcileProviderSubscription[];
}

export interface ReconcileDrift {
  organizationId?: string;
  subscriptionId?: string;
  kind:
    | "missing_local"
    | "missing_provider"
    | "plan_mismatch"
    | "status_mismatch"
    | "mirror_mismatch"
    | "entitlement_orphan";
  local?: string;
  provider?: string;
  detail: string;
}

export interface ReconcileResult {
  checked: number;
  drifts: ReconcileDrift[];
  driftCount: number;
}

/** The "governing" local subscription per organization: the non-terminal one
 *  whose state actually entitles (or is winding down). Mirrors how the webhook
 *  apply picks a subscription to write the entitlement from. */
export function governingSubscription(
  rows: ReconcileLocalSubscription[],
): ReconcileLocalSubscription | null {
  const ranked = [...rows].sort((a, b) => {
    const rank = (s: string) =>
      s === "active" || s === "trialing" ? 0 : s === "past_due" ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });
  return ranked[0] ?? null;
}

export function reconcileBilling(input: ReconcileInput): ReconcileResult {
  const drifts: ReconcileDrift[] = [];
  const providerByOrg = new Map(
    input.providerSubscriptions.map((row) => [row.organizationId, row]),
  );
  const localByOrg = new Map<string, ReconcileLocalSubscription[]>();
  for (const row of input.localSubscriptions) {
    const list = localByOrg.get(row.organizationId) ?? [];
    list.push(row);
    localByOrg.set(row.organizationId, list);
  }

  const organizationIds = new Set([
    ...providerByOrg.keys(),
    ...localByOrg.keys(),
    ...input.localEntitlements.map((row) => row.organizationId),
  ]);

  let checked = 0;
  for (const organizationId of organizationIds) {
    checked += 1;
    const provider = providerByOrg.get(organizationId) ?? null;
    const local = governingSubscription(localByOrg.get(organizationId) ?? []);
    const entitlement = input.localEntitlements.find(
      (row) => row.organizationId === organizationId,
    );

    if (provider && !local) {
      drifts.push({
        organizationId,
        subscriptionId: provider.subscriptionId,
        kind: "missing_local",
        provider: provider.plan,
        detail: `provider has ${provider.subscriptionId} (${provider.plan}/${provider.status}) but the local mirror does not`,
      });
      continue;
    }
    if (!provider && local) {
      drifts.push({
        organizationId,
        subscriptionId: local.subscriptionId,
        kind: "missing_provider",
        local: local.plan,
        detail: `local mirror has ${local.subscriptionId} but the provider reports no subscription`,
      });
      continue;
    }

    if (provider && local) {
      if (provider.plan !== local.plan) {
        drifts.push({
          organizationId,
          subscriptionId: local.subscriptionId,
          kind: "plan_mismatch",
          local: local.plan,
          provider: provider.plan,
          detail: `plan drift: local ${local.plan} vs provider ${provider.plan}`,
        });
      }
      if (provider.status !== local.status) {
        drifts.push({
          organizationId,
          subscriptionId: local.subscriptionId,
          kind: "status_mismatch",
          local: local.status,
          provider: provider.status,
          detail: `status drift: local ${local.status} vs provider ${provider.status}`,
        });
      }
    }

    // The entitlement mirror must equal the plan the provider entitles.
    const expectedPlan = provider ? provider.plan : "free";
    const expectedStatus: PlanStatus = provider
      ? planStatusForState(provider.status)
      : "canceled";
    const mirrorPlan = entitlement?.plan ?? "free";
    const mirrorStatus = entitlement?.planStatus ?? "canceled";
    if (mirrorPlan !== expectedPlan) {
      drifts.push({
        organizationId,
        kind: "mirror_mismatch",
        local: mirrorPlan,
        provider: expectedPlan,
        detail: `entitlement plan drift: users.plan=${mirrorPlan} but provider entitles ${expectedPlan}`,
      });
    } else if (provider && mirrorStatus !== expectedStatus) {
      drifts.push({
        organizationId,
        kind: "mirror_mismatch",
        local: mirrorStatus,
        provider: expectedStatus,
        detail: `entitlement status drift: users.planStatus=${mirrorStatus} but provider state maps to ${expectedStatus}`,
      });
    }

    if (!provider && entitlement && entitlement.plan && entitlement.plan !== "free") {
      drifts.push({
        organizationId,
        kind: "entitlement_orphan",
        local: entitlement.plan,
        detail: `users.plan=${entitlement.plan} with no provider subscription`,
      });
    }
  }

  return {
    checked,
    drifts,
    driftCount: drifts.length,
  };
}
