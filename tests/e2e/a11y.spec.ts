import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures/test-backend";

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
 *
 * BP-01: tests import the test-only backend fixture, so the signed-out
 * redirect and the keyboard sign-in response resolve deterministically
 * instead of hanging on a backend that does not exist in CI.
 */

/**
 * Settle the page before axe samples it.
 *
 * Two timing hazards make the gate flaky without any real violation:
 *   - web fonts swap in after first paint;
 *   - the mosaic entrance animations (`mosaic-in` / `mosaic-pop`, 0.55s plus
 *     staggered delays) fade content in, and axe samples real rendered
 *     colours — a scan that races the fade reports a bogus `color-contrast`
 *     violation (observed once under parallel cold-start load: one serious
 *     node on `/auth`, unreproducible once warm).
 *
 * The steady state is what the gate must judge, so wait for fonts and for
 * every finite entrance animation to finish. The infinite decorative
 * `mosaic-float` loops are deliberately excluded or this would never end.
 */
async function settleForAxe(page: Page): Promise<void> {
  // 1. The lazy route must have actually rendered. Without this the two
  // checks below run against the loading fallback, pass vacuously, and axe
  // samples the page mid-fade — the bogus serious `color-contrast` observed
  // on `/` and `/auth` (hero CTA at 1.99:1 mid-animation).
  await page.waitForSelector("#main-content > *", { timeout: 15_000 });

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // 2. Every finite entrance animation must be finished — verified on two
  // samples ≥150ms apart, because `getAnimations() === []` is
  // indistinguishable between "not started yet" and "finished": a
  // not-yet-started animation would otherwise pass while still fading.
  const deadline = Date.now() + 15_000;
  let firstPassAt: number | null = null;
  while (Date.now() < deadline) {
    const allDone = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*")).every((element) =>
        (element.getAnimations?.() ?? []).every((animation) => {
          const name = (animation as { animationName?: string }).animationName;
          if (name === "mosaic-in" || name === "mosaic-pop") {
            return animation.playState === "finished";
          }
          return true;
        }),
      ),
    );
    const now = Date.now();
    if (!allDone) {
      firstPassAt = null;
    } else if (firstPassAt !== null && now - firstPassAt >= 150) {
      return; // stable: held for 150ms, nothing started in between
    } else {
      firstPassAt = now;
    }
    await page.waitForTimeout(75);
  }
  // Deadline exceeded: fall through and let axe report whatever is on the
  // page — a real violation must fail the gate, not hide behind a settle
  // timeout.
}

type A11yEntry = {
  name: string;
  path: string;
  /** Runs after `goto` and before axe (e.g. a redirect the entry point makes). */
  settle?: (page: Page) => Promise<void>;
};

const PAGES: A11yEntry[] = [
  { name: "landing", path: "/" },
  { name: "auth", path: "/auth" },
  // Module landing pages share one template; cover a core module and one
  // with the setup note (the only conditional block).
  { name: "module landing (understand)", path: "/modules/understand" },
  { name: "module landing (promote)", path: "/modules/promote" },
  {
    name: "app",
    path: "/app",
    // `/app` is behind `RequireAuth`. A signed-out visitor must be redirected
    // to the sign-in screen with the intended path preserved (`returnTo`),
    // which is the accessible surface that renders; axe then checks whatever
    // it renders. The test-only backend answers `users.currentUser` with
    // "no user", so this resolves deterministically — no live service.
    settle: async (page) => {
      await expect(page).toHaveURL(/\/auth\?returnTo=%2Fapp/, {
        timeout: 15_000,
      });
    },
  },
];

for (const entry of PAGES) {
  test(`${entry.name} has no serious axe violations`, async ({ page }) => {
    await page.goto(entry.path);
    if (entry.settle) await entry.settle(page);
    await settleForAxe(page);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    // On failure, name the offending nodes — an id/count alone cannot be
    // diagnosed from CI output.
    if (serious.length) {
      for (const violation of serious) {
        console.log("VIOLATION", violation.id, violation.help);
        for (const node of violation.nodes) {
          console.log("TARGET", JSON.stringify(node.target));
          console.log("HTML", node.html);
          console.log("SUMMARY", node.failureSummary);
        }
      }
    }
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
