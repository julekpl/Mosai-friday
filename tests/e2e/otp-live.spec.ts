import { expect, test } from "@playwright/test";

/**
 * Real OTP journey — deliberately separate from the hermetic browser gates
 * (MOSAI pack BP-01).
 *
 * This is the ONE spec that must talk to a real Convex deployment, because a
 * real send is the only proof the OTP path works end to end. It never runs by
 * default: `bun run test:e2e` skips it with the reason on screen, so the skip
 * is visible evidence, not a hidden hole (see the BP-01 inventory in
 * `docs/pack/STATUS.md`).
 *
 * To run it, start the dev server with a TEST deployment and a TEST inbox
 * address (owner decisions O2/O7 — never a production sender or a real
 * customer address):
 *
 *   VITE_CONVEX_URL=<test-deployment-url> \
 *   E2E_LIVE_CONVEX_URL=<test-deployment-url> \
 *   E2E_LIVE_TEST_EMAIL=<test-inbox@example.test> \
 *   bun run test:e2e tests/e2e/otp-live.spec.ts
 *
 * Note this spec imports `@playwright/test` directly — NOT the test-only
 * backend fixture — because the point is to leave the building. Everything it
 * touches is opt-in via the two variables above; there is no fallback URL and
 * no silent degradation to the double.
 */

const liveUrl = process.env.E2E_LIVE_CONVEX_URL ?? "";
const liveEmail = process.env.E2E_LIVE_TEST_EMAIL ?? "";

test.describe("real OTP journey (test deployment)", () => {
  test.skip(
    !liveUrl || !liveEmail,
    "No test deployment configured — set E2E_LIVE_CONVEX_URL and " +
      "E2E_LIVE_TEST_EMAIL (owner decisions O2/O7). Documented in the " +
      "BP-01 inventory in docs/pack/STATUS.md; never runs in default CI.",
  );

  test("a real code send reaches the code step and a wrong code is rejected", async ({
    page,
  }) => {
    await page.goto("/auth");
    await page.getByPlaceholder("name@example.com").fill(liveEmail);
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    // Real backend: the send action must succeed for the test inbox.
    await expect(page.getByText("Check your email")).toBeVisible({
      timeout: 20_000,
    });

    // Real backend rejection of a code that was never issued — no inbox
    // access needed, and it proves server-side verification is live.
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: /verify code/i }).click();
    await expect(page.getByRole("alert")).toContainText(
      /that code didn't work or may have expired/i,
      { timeout: 20_000 },
    );
  });
});
