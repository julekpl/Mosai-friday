import { expect, test } from "@playwright/test";

/**
 * Browser smoke journeys (MOSAI pack T1.5).
 *
 * These prove the e2e harness renders the real app. They are not the critical
 * Phase 0 journeys — R7 (sanitized HTML never executes) and R12 (no platform
 * calls) belong to T1.7 and plug into this same Playwright setup.
 */
test.describe("marketing and auth smoke", () => {
  test("the landing page renders and routes to sign-in", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /persona to revenue/i,
    );
    await expect(page.getByText("mosai", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /start free/i }).first().click();
    await expect(page).toHaveURL(/\/auth$/);
    // `CardTitle` renders a div, so assert on the text, not a heading role.
    await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
  });

  test("an unknown route shows the not-found page", async ({ page }) => {
    await page.goto("/definitely-not-a-real-route");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/page not found/i)).toBeVisible();
  });
});
