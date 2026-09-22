import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility gate (MOSAI pack T1.5/T1.8, rule 16).
 *
 * Runs axe on the public entry points and fails on **any** serious or critical
 * violation. There is deliberately no allow-list: the dated
 * `KNOWN_VIOLATIONS` baseline from T1.5 (which excused the unnamed submit
 * button on `/auth`) was deleted in T1.8 once the sign-in form was fixed. A
 * new violation fails the job.
 *
 * The gate is proven live by planting a violation (an `<img>` with no `alt`)
 * and observing it fail — recorded in `docs/tickets/T1.8-…`.
 */

type A11yEntry = {
  name: string;
  path: string;
  /** Runs after `goto` and before axe (e.g. a redirect the entry point makes). */
  settle?: (page: Page) => Promise<void>;
};

const PAGES: A11yEntry[] = [
  { name: "landing", path: "/" },
  { name: "auth", path: "/auth" },
  {
    name: "app",
    path: "/app",
    // `/app` is behind `RequireAuth`. A signed-out visitor is redirected to the
    // sign-in screen (with the intended path preserved), which is the
    // accessible surface that renders; axe then checks whatever it renders.
    settle: async (page) => {
      await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 });
    },
  },
];

for (const entry of PAGES) {
  test(`${entry.name} has no serious axe violations`, async ({ page }) => {
    await page.goto(entry.path);
    if (entry.settle) await entry.settle(page);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    expect(
      serious.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
    ).toEqual([]);
  });
}

test("the skip link is the first keyboard stop and jumps to main content", async ({
  page,
}) => {
  await page.goto("/");
  // The landing route is lazy-loaded — wait for it to render before tabbing,
  // otherwise the first Tab lands before the skip link exists.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const skip = page.getByRole("link", { name: "Skip to content" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();

  await skip.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("the sign-in form is operable with the keyboard alone", async ({
  page,
}) => {
  await page.goto("/auth");

  // Reach the email field and submit without touching the mouse. The form must
  // respond — advancing to the code step or surfacing an error alert — rather
  // than silently doing nothing.
  const email = page.getByLabel("Email address");
  await email.focus();
  await expect(email).toBeFocused();
  await page.keyboard.type("someone@example.com");
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Check your email").or(page.getByRole("alert")).first(),
  ).toBeVisible({ timeout: 15_000 });
});
