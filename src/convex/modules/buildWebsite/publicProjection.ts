import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { selectConfirmedRelease } from "../../lib/deliveryGate";

/**
 * BP-13 public projection seam. Host resolution is receipt-led: neither a
 * project/site id nor a caller-provided host is sufficient. A future host
 * verifier may write `publicHostname` only after proving domain ownership;
 * until then no public hostname resolves. This internal query is for the
 * separate-origin renderer and cannot be called by the dashboard client.
 */
export const getByHostname = internalQuery({
  args: { hostname: v.string(), fullPath: v.string() },
  handler: async (ctx, { hostname, fullPath }) => {
    const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
    if (
      !normalizedHost ||
      normalizedHost.includes(":") ||
      normalizedHost.includes("/")
    ) {
      return null;
    }
    const deployments = await ctx.db
      .query("buildDeployments")
      .withIndex("by_public_hostname", (q) =>
        q.eq("publicHostname", normalizedHost),
      )
      .collect();

    // A hostname rebound across tenants is ambiguous. Fail closed instead
    // of relying on index order or choosing whichever tenant was inserted
    // first. A host adapter must prevent this state during verification.
    const bindings = new Set(
      deployments.map((row) => `${row.projectId}:${row.siteId}`),
    );
    if (bindings.size > 1) return null;
    const path = fullPath === "" ? "/" : fullPath;

    for (const deployment of deployments) {
      if (deployment.state !== "succeeded" || !deployment.releaseAuditId) {
        continue;
      }
      const audit = await ctx.db.get(deployment.releaseAuditId);
      if (
        !audit ||
        audit.phase !== "verified" ||
        audit.deploymentId !== deployment._id ||
        audit.buildId !== deployment.buildId ||
        audit.siteId !== deployment.siteId ||
        audit.projectId !== deployment.projectId
      ) {
        continue;
      }
      const site = await ctx.db.get(deployment.siteId);
      if (
        !site ||
        site.status === "suspended" ||
        site.projectId !== deployment.projectId
      ) {
        continue;
      }
      const gate = await selectConfirmedRelease(ctx, deployment.projectId);
      if (!gate.allowed || gate.audit._id !== audit._id) continue;
      const route = gate.routesByPath.get(path);
      if (!route?.title || !audit.revisionIds.includes(route.revisionId)) {
        continue;
      }
      const revision = await ctx.db.get(route.revisionId);
      if (
        !revision ||
        revision.state !== "published" ||
        revision.projectId !== deployment.projectId
      ) {
        continue;
      }
      const page = await ctx.db.get(revision.pageId);
      if (
        !page ||
        page.siteId !== deployment.siteId ||
        page.projectId !== deployment.projectId
      ) {
        continue;
      }
      return {
        siteId: site._id,
        page: {
          _id: page._id,
          title: route.title,
          seo: route.seo ?? null,
          fullPath: path,
        },
        revision,
      };
    }
    return null;
  },
});
