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
    await expect(alert).toContainText(/could not send the code/i);
    // … and the form does NOT pretend the code was sent: it never advances
    // to the "Check your email" step.
    await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your email")).toBeHidden();
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
      /verification code you entered is incorrect/i,
    );
    // Still unauthenticated on the code step — no fake success.
    await expect(page).toHaveURL(/\/auth/);
  });
});
