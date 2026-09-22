import { orgQuery } from "../guards";
import { v } from "convex/values";
import { buildGoogleFeed, feedToXml } from "./feed";

/* ── Sell module read model — readiness summary + feed projection ──────── */

export const feedStatus = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;
    const project = scope.project;

    const products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const bundles = await Promise.all(
      products.map(async (product) => {
        const [variants, media] = await Promise.all([
          ctx.db
            .query("productVariants")
            .withIndex("by_product", (q) => q.eq("productId", product._id))
            .collect(),
          ctx.db
            .query("productMedia")
            .withIndex("by_product", (q) => q.eq("productId", product._id))
            .collect(),
        ]);
        return { product, variants, media };
      }),
    );

    const projection = buildGoogleFeed({
      products: bundles,
      websiteUrl: project.websiteUrl,
      businessName: project.businessName,
    });

    return {
      state: projection.state,
      itemCount: projection.items.length,
      issues: projection.issues,
      xml: feedToXml(projection),
    };
  },
});
