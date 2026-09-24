import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** A claimed attempt is never retried automatically: SMTP may have accepted it. */
export const claim = internalMutation({
  args: { idempotencyKey: v.string(), recipientDigest: v.string() },
  handler: async (ctx, { idempotencyKey, recipientDigest }) => {
    const existing = await ctx.db
      .query("otpEmailReceipts")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing) return existing.status;

    const now = Date.now();
    await ctx.db.insert("otpEmailReceipts", {
      idempotencyKey,
      recipientDigest,
      status: "claimed",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + RECEIPT_RETENTION_MS,
    });
    return "new" as const;
  },
});

export const recordAccepted = internalMutation({
  args: { idempotencyKey: v.string(), providerMessageId: v.string() },
  handler: async (ctx, { idempotencyKey, providerMessageId }) => {
    const row = await ctx.db
      .query("otpEmailReceipts")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (!row || row.status !== "claimed") {
      throw new Error("OTP delivery claim is unavailable.");
    }
    await ctx.db.patch(row._id, {
      status: "accepted",
      providerMessageId,
      updatedAt: Date.now(),
    });
  },
});

export const recordUncertain = internalMutation({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, { idempotencyKey }) => {
    const row = await ctx.db
      .query("otpEmailReceipts")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (row?.status === "claimed") {
      await ctx.db.patch(row._id, {
        status: "uncertain",
        updatedAt: Date.now(),
      });
    }
  },
});

export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("otpEmailReceipts")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    return expired.length;
  },
});
