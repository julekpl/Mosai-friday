"use node";

import nodemailer from "nodemailer";

const SMTP_HOST = "eu1.workspace.org";
const SMTP_PORT = 465;
const SMTP_USER = "info@appmosai.com";

type SmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  tls: { minVersion: "TLSv1.2" };
};

type MailOptions = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
};

type TransportFactory = (options: SmtpOptions) => {
  sendMail(options: MailOptions): Promise<{
    accepted: Array<string | { address: string }>;
    rejected: Array<string | { address: string }>;
    messageId: string;
  }>;
};

/** Only the trusted backend calls this. Never log SMTP errors, credentials or codes. */
export async function sendNamecraneOtp(
  recipient: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  createTransport: TransportFactory = (options) =>
    nodemailer.createTransport(options),
): Promise<{ messageId: string }> {
  const password = env.NAMECRANE_SMTP_PASSWORD;
  if (!password) {
    throw new Error("OTP email delivery is not configured.");
  }
  if (
    recipient.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
    !/^\d{6}$/.test(code)
  ) {
    throw new Error("OTP email delivery failed.");
  }

  try {
    const transport = createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: SMTP_USER, pass: password },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
      tls: { minVersion: "TLSv1.2" },
    });
    const receipt = await transport.sendMail({
      from: { name: "MOSAI", address: SMTP_USER },
      to: recipient,
      subject: "Your MOSAI sign-in code",
      text: `Your MOSAI sign-in code is ${code}. It expires in 15 minutes. If you did not request it, you can ignore this message.`,
    });
    const accepted = receipt.accepted.some(
      (value) =>
        (typeof value === "string" ? value : value.address).toLowerCase() ===
        recipient.toLowerCase(),
    );
    if (!accepted || receipt.rejected.length > 0 || !receipt.messageId) {
      throw new Error("SMTP did not accept the message.");
    }
    // SMTP acceptance is the strongest immediate receipt available; it is not
    // proof of delivery to the inbox.
    return { messageId: receipt.messageId };
  } catch {
    // Nodemailer errors can include auth/server details. Keep the client and
    // Convex logs free of provider responses, credentials and OTP values.
    throw new Error("OTP email delivery failed.");
  }
}
