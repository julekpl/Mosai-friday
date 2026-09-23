import { expect, test } from "./fixtures/test-backend";

/**
 * Browser smoke journeys (MOSAI pack T1.5, refreshed by BP-01).
 *
 * These prove the e2e harness renders the real app and that the primary CTA
 * really navigates to sign-in. They run against the test-only backend double
 * (`fixtures/test-backend.ts`) — no live service, no real OTP send.
 *
 * BP-01 note: the old assertions (`/persona to revenue/i`, a "Start free"
 * link) went stale when the landing page was rewritten on 22 Sep 2026
 * (`src/pages/Landing.tsx` mtime 21:41 > spec mtime 10:02) and the baseline
 * CI run went red. The assertions now match the intended current copy while
 * keeping a real check on the primary CTA and its navigation.
 */
test.describe("marketing and auth smoke", () => {
  test("the landing page renders and routes to sign-in", async ({ page }) => {
    await page.goto("/");

    // Intended current copy (source of truth: `src/pages/Landing.tsx`).
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /your marketing,\s*coming together/i,
    );
    await expect(page.getByText("mosai", { exact: true }).first()).toBeVisible();

    // Primary CTA (the hero link) must exist and really navigate to /auth.
    // `.first()`: the closing CTA under `#start` repeats the same label by
    // design; the hero is the first “Create your workspace” link in <main>.
    const primaryCta = page
      .getByRole("main")
      .getByRole("link", { name: /create your workspace/i })
      .first();
    await expect(primaryCta).toBeVisible();
    await primaryCta.click();
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
