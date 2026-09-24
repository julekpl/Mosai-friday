import { v } from "convex/values";
import { aiBudgetTenant, orgQuery, readAiBudgetUsage } from "./guards";
import type { AiBudgetUsage } from "./lib/aiBudget";

/**
 * AI budget read model (owner ask, 24 Sep 2026). The budget itself is enforced
 * inside the model gateway (`guards.startAiRun`); this file only reports it.
 */

/**
 * This month's AI spend for the organization that owns a project: booked
 * cost, in-flight reservations, the plan's budget and when it resets. A
 * foreign project throws "Not found" — tenants never see each other's spend.
 */
export const usage = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<AiBudgetUsage> => {
    const scope = await access.requireProject(projectId);
    return await readAiBudgetUsage(
      ctx,
      await aiBudgetTenant(ctx, { userId: scope.userId, project: scope.project }),
    );
  },
});

/** The same read for an organization the caller belongs to (Billing page). */
export const organizationUsage = orgQuery({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }, access): Promise<AiBudgetUsage> => {
    const scope = await access.requireOrganization(organizationId);
    return await readAiBudgetUsage(
      ctx,
      await aiBudgetTenant(ctx, {
        userId: scope.userId,
        project: null,
        organizationId: scope.organization._id,
      }),
    );
  },
});
