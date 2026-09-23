import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

/* ── Campaigns: user-tracked lifecycle + delivery truth (BP-03) ───────────
 *
 * A campaign row is user-tracked unless server code (ads sync, BP-04 social
 * receipts) flips it to provider-tracked. "running" on a local row means
 * "the user says they are working this campaign locally" — it is a local
 * label, not a provider fact. Provider-tracked rows move only through
 * server code holding a provider receipt; a client-callable mutation can
 * never write their lifecycle.
 */

export const list = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("campaigns")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("promote", {
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    channel: v.string(), // email | social | ads
    budgetCents: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    const { projectId, ...rest } = args;
    return await ctx.db.insert("campaigns", {
      projectId,
      ...rest,
      status: "draft" as const,
      // Client-created rows are local by definition; provider tracking is
      // granted only by server code that talked to the provider.
      trackingSource: "local" as const,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("promote", {
  args: {
    id: v.id("campaigns"),
    name: v.optional(v.string()),
    channel: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("done"),
      ),
    ),
    budgetCents: v.optional(v.number()),
    personaId: v.optional(v.id("personas")),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    // BP-03: the client may not author provider-tracked lifecycle. Only
    // internal/server mutations holding a provider receipt may move those.
    if (
      row.trackingSource === "provider" &&
      (patch.status !== undefined || patch.budgetCents !== undefined)
    )
      throw new Error(
        "This campaign is tracked by the ads provider. MOSAI reflects the provider's state after sync — it cannot be changed here.",
      );
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = moduleMutation("promote", {
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/* ── Delivery view: local tracking vs externally verified delivery ──────── */

export const getDelivery = moduleQuery("promote", {
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) return null;
    // A local row has no provider receipt by definition — never invent one.
    // A provider-tracked row is verified only when server code recorded a
    // receipt reference (BP-04 social/ads receipts); otherwise it shows the
    // honest requires_verification state.
    const verified = row.trackingSource === "provider" && Boolean(row.providerRef);
    return {
      trackingSource: row.trackingSource ?? ("local" as const),
      status: row.status,
      delivery: {
        verified,
        receiptId: verified ? row.providerRef : undefined,
        label: verified
          ? "verified"
          : row.trackingSource === "provider"
            ? "requires_verification"
            : "local",
      },
    };
  },
});
