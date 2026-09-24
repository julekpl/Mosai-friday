import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import type { GenericActionCtxWithAuthConfig } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest(
    { identifier: email, token },
    ctx?: GenericActionCtxWithAuthConfig<DataModel>,
  ) {
    const provider = process.env.OTP_EMAIL_PROVIDER ?? "freebuff";
    if (provider === "namecrane") {
      // Convex Auth passes the action context at runtime even though the
      // upstream Auth.js callback type models only the first argument.
      if (!ctx) throw new Error("OTP email delivery is unavailable.");
      await ctx.runAction(internal.auth.smtpNode.sendOtp, {
        recipient: email,
        code: token,
      });
      return;
    }
    if (provider !== "freebuff") {
      throw new Error("OTP email provider is not configured.");
    }
    // The key comes from the deployment's env (Keys / API keys UI). It used to
    // be hardcoded here and is therefore considered compromised — rotate it and
    // set EMAIL_OTP_API_KEY. Never commit the value again.
    const apiKey = process.env.EMAIL_OTP_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EMAIL_OTP_API_KEY is not configured — add it in the Keys / API keys panel.",
      );
    }
    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
    } catch (error) {
      // Never stringify the raw error: an axios error carries `config.headers`,
      // which would serialize the x-api-key into logs or client responses.
      // Surface only a status, never the request or its credentials.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      throw new Error(
        status
          ? `OTP email service failed with status ${status}.`
          : "OTP email service is unreachable. Try again shortly.",
      );
    }
  },
});
