/**
 * External delivery gate (BP-03 review follow-ups).
 *
 * A prepared release is NOT externally delivered. The public read paths
 * (`cms.getPublishedByPath`, `storefront.getPublishedPage`) may serve
 * content only from the **last confirmed public release**: the newest
 * `buildReleaseAudits` row that is phase `verified` AND whose
 * `deploymentId` points at a `buildDeployments` row in state `succeeded`.
 * Both rows are written exclusively by server code holding the provider
 * receipt (BP-13's verifier); no client-callable function can create them.
 *
 * BP-03: "Continue serving the last confirmed public release when a new
 * publish fails." Therefore the gate must NOT read the newest audit
 * (a later prepared or failed release would cut off a still-verified
 * earlier one) and must NOT read pages through their mutable
 * `publishedRevisionId` pointer (release B's preparation moves it, which
 * would leak B's content under a fallback to A's audit). Instead:
 *
 *  - `selectConfirmedRelease` picks the newest audit whose receipt chain is
 *    intact (verified + succeeded deployment) — earlier than a newer
 *    prepared/failed audit is fine;
 *  - the audit's `revisionIds` pin the exact content that release served;
 *    readers resolve a page through that pin, never the current pointer.
 *
 * Compatibility rule: an audit without a route snapshot, or with any route
 * lacking its frozen title, cannot safely reconstruct public routing or
 * metadata from mutable CMS rows. It therefore fails closed and requires a
 * newly verified release. No old route or metadata is inferred.
 *
 * Paths (new pages) and redirects that exist only in a later, unverified
 * release stay hidden: a page not in the pinned revision set has nothing to
 * serve, and redirects must only be honored once the release that produced
 * them is itself verified.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Result of the delivery gate: the confirmed release, or why there is none. */
export type DeliveryGate =
  | {
      allowed: true;
      audit: Doc<"buildReleaseAudits">;
      /** revision ids this release pinned, by page */
      pinnedByPage: Map<Id<"cmsPages">, Id<"pageRevisions">>;
      /** the release's route snapshot: fullPath → pinned revision + frozen metadata */
      routesByPath: Map<
        string,
        { revisionId: Id<"pageRevisions">; title?: string; seo?: { title?: string; metaDescription?: string; noindex?: boolean; ogImageUrl?: string } }
      >;
      /** the release's redirect snapshot: fromPath → {to, statusCode} */
      redirectsByPath: Map<
        string,
        { to: string; statusCode: 301 | 302 }
      >;
    }
  | { allowed: false; reason: "no_verified_deployment" };

/**
 * The last confirmed public release for a project's website build: the
 * newest audit with an intact verified-deployment receipt chain and a
 * complete route snapshot. Returns `allowed: false` when none exists
 * (nothing externally delivered yet, every verified release has been
 * superseded by a failed/canceled one, or only incompatible legacy audits
 * exist).
 */
export async function selectConfirmedRelease(
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
  audits.sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime);

  // Newest audit whose receipt chain is intact. A newer prepared or failed
  // audit does NOT disqualify an older verified one — that is exactly the
  // "last confirmed release keeps serving" guarantee.
  for (const audit of audits) {
    if (audit.phase !== "verified" || !audit.deploymentId) continue;
    const deployment = await ctx.db.get(audit.deploymentId);
    if (deployment && deployment.state === "succeeded") {
      const pinnedByPage = new Map<Id<"cmsPages">, Id<"pageRevisions">>();
      for (const revisionId of audit.revisionIds) {
        const revision = await ctx.db.get(revisionId);
        if (revision) {
          pinnedByPage.set(revision.pageId, revision._id);
        }
      }
      // Route/redirect snapshots (present on audits written after the
      // third BP-03 review follow-up; legacy audits without them fail closed
      // below because current page rows cannot prove historical routing).
      const routesByPath = new Map<
        string,
        { revisionId: Id<"pageRevisions">; title?: string; seo?: { title?: string; metaDescription?: string; noindex?: boolean; ogImageUrl?: string } }
      >();
      for (const r of audit.routes ?? []) {
        routesByPath.set(r.fullPath, {
          revisionId: r.revisionId,
          title: r.title,
          seo: r.seo,
        });
      }
      const redirectsByPath = new Map<
        string,
        { to: string; statusCode: 301 | 302 }
      >();
      for (const r of audit.redirects ?? []) {
        redirectsByPath.set(r.fromPath, {
          to: r.to,
          statusCode: r.statusCode,
        });
      }
      // A pre-snapshot audit cannot safely reconstruct its original routes
      // or metadata from mutable CMS rows. It remains recorded and readable
      // for provenance, but must not be treated as a current public release.
      if (audit.routes === undefined || audit.routes.some((route) => !route.title)) {
        return { allowed: false, reason: "no_verified_deployment" };
      }
      return {
        allowed: true,
        audit,
        pinnedByPage,
        routesByPath,
        redirectsByPath,
      };
    }
  }
  return { allowed: false, reason: "no_verified_deployment" };
}

/**
 * Convenience wrapper for readers that only need the yes/no gate plus the
 * pinned revision for one page (resolved from the audit's pins, never from
 * the page's current `publishedRevisionId`).
 */
export async function hasVerifiedDeployment(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<DeliveryGate> {
  return selectConfirmedRelease(ctx, projectId);
}
