import { v } from "convex/values";
import { moduleMutation } from "./guards";

/* ── M1 Media — model is media[]; M1 UX writes position 0 ──────────────── */

export const setPrimary = moduleMutation("sell", {
  args: {
    productId: v.id("products"),
    url: v.string(),
    alt: v.optional(v.string()),
  },
  handler: async (ctx, { productId, url, alt }, access) => {
    const product = await access.ownedRow(await ctx.db.get(productId));
    if (!product) throw new Error("Not found");
    if (!/^https?:\/\//.test(url)) throw new Error("Image URL must be http(s)");

    const existing = await ctx.db
      .query("productMedia")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const primary = existing
      .filter((m) => !m.variantId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];

    if (primary) {
      await ctx.db.patch(primary._id, { url, alt });
    } else {
      await ctx.db.insert("productMedia", {
        projectId: product.projectId,
        productId,
        url,
        alt,
        position: 0,
        source: "mosai_native",
        createdAt: Date.now(),
      });
    }
  },
});

/** Alt-text updates — the ai_safe fix target. */
export const setAlt = moduleMutation("sell", {
  args: {
    productId: v.id("products"),
    alt: v.string(),
  },
  handler: async (ctx, { productId, alt }, access) => {
    const product = await access.ownedRow(await ctx.db.get(productId));
    if (!product) throw new Error("Not found");

    const existing = await ctx.db
      .query("productMedia")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const primary = existing
      .filter((m) => !m.variantId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    if (!primary) throw new Error("No primary image");

    await ctx.db.patch(primary._id, { alt });
  },
});
