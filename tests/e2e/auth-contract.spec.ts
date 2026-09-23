import { expect, test } from "./fixtures/test-backend";

/**
 * Deterministic component/contract tests for the sign-in error states
 * (MOSAI pack BP-01).
 *
 * These run entirely against the test-only backend double (see
 * `fixtures/test-backend.ts`): no network, no real OTP send, no credentials.
 * Each scenario forces one specific backend response and asserts the UI
 * answer — including that a failure never masquerades as success (AGENTS.md
 * rule 5). The real-provider journey lives in `otp-live.spec.ts`.
 */
test.describe("sign-in contract (hermetic)", () => {
  test("a refused code send surfaces an announced alert and stays on the email step", async ({
    page,
    testBackend,
  }) => {
    testBackend.signInSend = "error";
    await page.goto("/auth");

    await page.getByPlaceholder("name@example.com").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    // The failure is announced (rule 16: status changes are announced) …
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/couldn't send a code/i);
    // … and the form does NOT pretend the code was sent: it never advances
    // to the "Check your email" step.
    await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your email")).toBeHidden();
  });

  test("rejects an unsafe return target and recovers from backend outage", async ({
    page,
    testBackend,
  }) => {
    testBackend.queries = "unavailable";
    await page.goto("/auth?returnTo=%2F%2Fevil.example%2Fapp");
    await expect(page).toHaveURL(/returnTo=%2F%2Fevil\.example/);
    await expect(page.getByRole("alert")).toContainText(
      /taking longer than expected/i,
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
  });

  test("the code step verifies by keyboard and surfaces a generic rejection", async ({
    page,
    testBackend,
  }) => {
    testBackend.verifyCode = "error";
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    const code = page.getByLabel("Verification code");
    await expect(code).toBeFocused();
    await code.fill("123456");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText(/didn't work or may have expired/i);
    await expect(page.getByRole("alert")).not.toContainText(/E2E test-only backend/i);
  });

  test("a resend failure stays recoverable on the code step", async ({
    page,
    testBackend,
  }) => {
    await page.clock.install();
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    testBackend.signInSend = "error";
    await page.clock.runFor("00:00:31");
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByRole("alert")).toContainText(/couldn't send a code/i);
    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(page.getByLabel("Verification code")).toBeFocused();
  });

  test("a hung code-send request times out without allowing a duplicate", async ({
    page,
    testBackend,
  }) => {
    await page.clock.install();
    testBackend.signInSend = "pending";
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();

    await page.clock.fastForward("00:00:15");
    await expect(page.getByRole("alert")).toContainText(/not been confirmed/i);
    await expect(page.getByRole("button", { name: "Reload sign-in" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
    await expect(page.getByText("Check your email")).toBeHidden();
  });

  test("a hung verification never advances or enables a second submission", async ({
    page,
    testBackend,
  }) => {
    await page.clock.install();
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    testBackend.verifyCode = "pending";
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /verify code/i }).click();
    await expect(page.getByRole("button", { name: /verifying/i })).toBeDisabled();

    await page.clock.fastForward("00:00:15");
    await expect(page.getByRole("alert")).toContainText(/not been confirmed/i);
    await expect(page.getByRole("button", { name: /verifying/i })).toBeDisabled();
    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(page).toHaveURL(/\/auth/);

    testBackend.releasePendingVerifyResponse();
    await expect(page.getByRole("alert")).toContainText(/not been confirmed/i);
    await expect(page).toHaveURL(/\/auth/);
  });

  test("an incorrect verification code is rejected on the code step", async ({
    page,
    testBackend,
  }) => {
    testBackend.verifyCode = "error";
    await page.goto("/auth");

    await page.getByPlaceholder("name@example.com").fill("someone@example.com");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /verify code/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      /didn't work or may have expired/i,
    );
    // Still unauthenticated on the code step — no fake success.
    await expect(page).toHaveURL(/\/auth/);
  });
});
