import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { orgMutation, orgQuery, projectCapability } from "./guards";
import type { CapabilityKey } from "./lib/capabilities";
import { selectConfirmedRelease } from "./lib/deliveryGate";
import {
  summarizeSinceLastVisit,
  type SinceDeployment,
  type SinceLastVisitSummary,
} from "../shared/sinceLastVisit";

/**
 * U7 — "Since you were away". Each caller has their own `projectVisits` row;
 * nothing here ever reads or writes another member's row.
 */

async function ownVisit(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Doc<"projectVisits"> | null> {
  return await ctx.db
    .query("projectVisits")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
}

async function included(
  ctx: QueryCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  capability: CapabilityKey,
): Promise<boolean> {
  const resolution = await projectCapability(ctx, project, userId, capability);
  return resolution?.state === "included";
}

/**
 * The live-site receipt, read from the same truth source as
 * `siteHosting.status`: the newest confirmed release whose deployment
 * succeeded, for a project that has a public website slug.
 */
async function confirmedLiveDeployment(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<SinceDeployment[]> {
  const publicSite = await ctx.db
    .query("publicSites")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", projectId).eq("kind", "website"),
    )
    .first();
  if (!publicSite?.slug) return [];
  const gate = await selectConfirmedRelease(ctx, projectId);
  if (!gate.allowed || !gate.audit.deploymentId) return [];
  const deployment = await ctx.db.get(gate.audit.deploymentId);
  if (!deployment || deployment.projectId !== projectId) return [];
  return deployment.state === "succeeded" ? [deployment] : [];
}

export const sinceLastVisit = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (
    ctx,
    { projectId },
    access,
  ): Promise<SinceLastVisitSummary | null> => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;
    const { userId, project } = scope;
    const visit = await ownVisit(ctx, userId, projectId);
    if (!visit) return null; // First visit: nothing to compare against.
    const since = visit.lastSeenAt;

    const posts = (await included(ctx, project, userId, "promote.view"))
      ? await ctx.db
          .query("posts")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", projectId).eq("status", "published"),
          )
          .collect()
      : null;
    const contacts = (await included(ctx, project, userId, "customers.view"))
      ? (
          await ctx.db
            .query("contacts")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
        ).filter((c) => c.createdAt > since)
      : null;
    const deployments = (await included(ctx, project, userId, "build.view"))
      ? await confirmedLiveDeployment(ctx, projectId)
      : null;

    return summarizeSinceLastVisit({ since, posts, contacts, deployments });
  },
});

export const markSeen = orgMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<null> => {
    const { userId } = await access.requireProject(projectId);
    const now = Date.now();
    const existing = await ownVisit(ctx, userId, projectId);
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("projectVisits", {
        projectId,
        userId,
        lastSeenAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});
