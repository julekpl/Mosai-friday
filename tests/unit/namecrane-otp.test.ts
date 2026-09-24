import { afterEach, describe, expect, it, vi } from "vitest";
import { sendNamecraneOtp } from "../../src/convex/auth/namecraneMailer";
import { emailOtp } from "../../src/convex/auth/emailOtp";
import { internal } from "../../src/convex/_generated/api";
import { newBackend } from "./helpers";

const sender = "info@appmosai.com";
const recipient = "customer@example.com";
const code = "123456";

afterEach(() => vi.unstubAllEnvs());

describe("OTP provider selection", () => {
  it("routes a Namecrane-configured request through the internal sender", async () => {
    vi.stubEnv("OTP_EMAIL_PROVIDER", "namecrane");
    const runAction = vi.fn().mockResolvedValue(undefined);
    const send = emailOtp.sendVerificationRequest as unknown as (
      args: { identifier: string; token: string },
      ctx: { runAction: typeof runAction },
    ) => Promise<void>;
    await send({ identifier: recipient, token: code }, { runAction });
    expect(runAction).toHaveBeenCalledWith(
      internal.auth.smtpNode.sendOtp,
      { recipient, code },
    );
  });

  it("fails closed for an unknown provider setting", async () => {
    vi.stubEnv("OTP_EMAIL_PROVIDER", "unknown");
    const send = emailOtp.sendVerificationRequest as unknown as (
      args: { identifier: string; token: string },
    ) => Promise<void>;
    await expect(send({ identifier: recipient, token: code })).rejects.toThrow(
      "OTP email provider is not configured",
    );
  });
});

describe("Namecrane OTP delivery", () => {
  it("fails closed before opening SMTP when the server-side password is absent", async () => {
    const createTransport = vi.fn();
    await expect(
      sendNamecraneOtp(recipient, code, {}, createTransport),
    ).rejects.toThrow("OTP email delivery is not configured");
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("uses the approved mailbox over verified implicit TLS and requires an SMTP acceptance", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      accepted: [recipient],
      rejected: [],
      messageId: "<test-receipt@example.com>",
    });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const receipt = await sendNamecraneOtp(
      recipient,
      code,
      { NAMECRANE_SMTP_PASSWORD: "test-only-secret" },
      createTransport,
    );

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "eu1.workspace.org",
        port: 465,
        secure: true,
        auth: { user: sender, pass: "test-only-secret" },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: recipient,
        subject: "Your MOSAI sign-in code",
        text: expect.stringContaining(code),
      }),
    );
    expect(receipt).toEqual({ messageId: "<test-receipt@example.com>" });
  });

  it("does not claim a code was sent without recipient acceptance", async () => {
    const createTransport = vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({
        accepted: [],
        rejected: [recipient],
        messageId: "<rejected@example.com>",
      }),
    });
    await expect(
      sendNamecraneOtp(
        recipient,
        code,
        { NAMECRANE_SMTP_PASSWORD: "test-only-secret" },
        createTransport,
      ),
    ).rejects.toThrow("OTP email delivery failed");
  });

  it("does not expose SMTP credentials or provider error details", async () => {
    const createTransport = vi.fn().mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(
        new Error("SMTP test-only-secret login failed"),
      ),
    });
    await expect(
      sendNamecraneOtp(
        recipient,
        code,
        { NAMECRANE_SMTP_PASSWORD: "test-only-secret" },
        createTransport,
      ),
    ).rejects.toThrow(/^OTP email delivery failed\.$/);
  });
});

describe("OTP delivery receipts", () => {
  it("claims one attempt, stores only a provider receipt, and deduplicates the code", async () => {
    const t = newBackend();
    const args = {
      idempotencyKey: "test-only-keyed-digest",
      recipientDigest: "test-only-recipient-digest",
    };
    expect(await t.mutation(internal.auth.otpDelivery.claim, args)).toBe("new");
    expect(await t.mutation(internal.auth.otpDelivery.claim, args)).toBe("claimed");
    await t.mutation(internal.auth.otpDelivery.recordAccepted, {
      idempotencyKey: args.idempotencyKey,
      providerMessageId: "<accepted@example.com>",
    });
    expect(await t.mutation(internal.auth.otpDelivery.claim, args)).toBe("accepted");
    const rows = await t.run((ctx) => ctx.db.query("otpEmailReceipts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientDigest: args.recipientDigest,
      status: "accepted",
      providerMessageId: "<accepted@example.com>",
    });
    expect(JSON.stringify(rows)).not.toContain(recipient);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("leaves an uncertain attempt unsendable and removes expired receipts", async () => {
    const t = newBackend();
    const idempotencyKey = "another-test-only-digest";
    const args = { idempotencyKey, recipientDigest: "recipient-digest" };
    await t.mutation(internal.auth.otpDelivery.claim, args);
    await t.mutation(internal.auth.otpDelivery.recordUncertain, {
      idempotencyKey,
    });
    expect(await t.mutation(internal.auth.otpDelivery.claim, args)).toBe(
      "uncertain",
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.query("otpEmailReceipts").first();
      if (!row) throw new Error("Expected receipt");
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    expect(await t.mutation(internal.auth.otpDelivery.sweepExpired, {})).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.query("otpEmailReceipts").collect()),
    ).toEqual([]);
  });
});
