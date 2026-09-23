/**
 * External delivery gate (BP-03 review follow-up).
 *
 * A prepared release is NOT externally delivered. The public read paths
 * (`cms.getPublishedByPath`, `storefront.getPublishedPage`) may serve
 * approved content only when the site's build holds a **verified
 * deployment**: a `buildReleaseAudits` row in phase `verified` whose
 * `deploymentId` points at a `buildDeployments` row in state `succeeded`.
 * Both rows are written exclusively by server code holding the provider
 * receipt (BP-13's verifier); no client-callable function can create them.
 *
 * Until BP-13 exists, no verified deployment can exist — so nothing is
 * served externally after a mere preparation, while owner preview stays
 * intact (the workspace renders drafts directly through
 * `buildWorkspace.getPreviewData` / `builds.getReadiness`, which do not use
 * this gate). The last confirmed public release keeps serving: its audit
 * remains `verified` unless a newer phase supersedes it.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Result of the delivery gate: whether external serving is allowed. */
export type DeliveryGate =
  | { allowed: true; audit: Doc<"buildReleaseAudits"> }
  | { allowed: false; reason: "no_verified_deployment" };

/**
 * Is there a verified, still-current deployment for this project's site?
 * Reads the build's newest release audit and requires the receipt chain:
 * audit phase `verified` + deployment state `succeeded`.
 */
export async function hasVerifiedDeployment(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<DeliveryGate> {
  const builds = await ctx.db
    .query("builds")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const websiteBuild = builds.find((b) => b.kind === "website");
  if (!websiteBuild) return { allowed: false, reason: "no_verified_deployment" };

  const audits = await ctx.db
    .query("buildReleaseAudits")
    .withIndex("by_build", (q) => q.eq("buildId", websiteBuild._id))
    .collect();
  // Newest audit decides the current phase; a later failed/canceled
  // deployment attempt supersedes an older verified one.
  audits.sort((a, b) => b.createdAt - a.createdAt);
  const latest = audits[0];
  if (!latest || latest.phase !== "verified" || !latest.deploymentId) {
    return { allowed: false, reason: "no_verified_deployment" };
  }
  const deployment = await ctx.db.get(latest.deploymentId);
  if (!deployment || deployment.state !== "succeeded") {
    return { allowed: false, reason: "no_verified_deployment" };
  }
  return { allowed: true, audit: latest };
}
