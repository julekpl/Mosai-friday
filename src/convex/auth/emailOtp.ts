import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

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
  async sendVerificationRequest({ identifier: email, token }) {
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
      throw new Error(JSON.stringify(error));
    }
  },
});
