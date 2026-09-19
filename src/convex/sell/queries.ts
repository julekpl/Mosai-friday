import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "../_generated/server";
import { v } from "convex/values";
import { buildGoogleFeed, feedToXml } from "./feed";

/* ── Sell module read model — readiness summary + feed projection ──────── */

export const feedStatus = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return null;

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
