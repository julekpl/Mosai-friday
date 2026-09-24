"use node";

import { createHmac } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { sendNamecraneOtp } from "./namecraneMailer";

/** Called only by the email OTP provider. No browser-callable SMTP function. */
export const sendOtp = internalAction({
  args: { recipient: v.string(), code: v.string() },
  handler: async (ctx, { recipient, code }) => {
    const password = process.env.NAMECRANE_SMTP_PASSWORD;
    if (!password) throw new Error("OTP email delivery is not configured.");

    // A keyed digest avoids storing the six-digit code or unverified email
    // address. Concurrent or repeated calls for the same code share one claim.
    const normalizedEmail = recipient.trim().toLowerCase();
    const digest = (purpose: string, value: string) =>
      createHmac("sha256", password)
        .update(`${purpose}\0${value}`)
        .digest("hex");
    const idempotencyKey = digest("otp-delivery", `${normalizedEmail}\0${code}`);
    const recipientDigest = digest("otp-recipient", normalizedEmail);
    const state = await ctx.runMutation(internal.auth.otpDelivery.claim, {
      idempotencyKey,
      recipientDigest,
    });
    if (state === "accepted") return;
    if (state !== "new") {
      // An earlier attempt might have reached SMTP. Do not send the same code
      // twice; the user can request a fresh code instead.
      throw new Error("OTP email delivery could not be confirmed.");
    }

    try {
      const receipt = await sendNamecraneOtp(recipient, code);
      await ctx.runMutation(internal.auth.otpDelivery.recordAccepted, {
        idempotencyKey,
        providerMessageId: receipt.messageId,
      });
    } catch {
      // A failed/uncertain SMTP response may have sent mail. Preserve that
      // uncertainty; never auto-retry this same OTP as a second external write.
      try {
        await ctx.runMutation(internal.auth.otpDelivery.recordUncertain, {
          idempotencyKey,
        });
      } catch {
        // The original failure stays generic; a claimed row prevents a retry.
      }
      throw new Error("OTP email delivery failed.");
    }
  },
});
