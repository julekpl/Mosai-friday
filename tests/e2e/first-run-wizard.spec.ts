import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U2 — the three-question first run at `/app/new`
 * (docs/ux/first-run-blueprint.md §2–§3, §7).
 *
 * Runs against the signed-in test backend double: synthetic data, no
 * network. The double does not answer mutations, so the last step checks
 * that the create request leaves the browser with the right answers rather
 * than following it to the project Home.
 */

const now = Date.UTC(2026, 8, 25);

test.use({
  backendData: {
    "users:currentUser": { _id: "e2e_user_1", _creationTime: now, name: "Ada", email: "ada@example.test" },
    "admin:me": { isAdmin: false },
    "projects:list": [],
  },
});

type SentMutation = { udfPath: string; args: Array<Record<string, unknown>> };

/**
 * Record the Convex mutation requests the page sends. The socket is routed by
 * the backend double, so the frames are read in the page by wrapping
 * `WebSocket.prototype.send` before the app loads.
 */
async function recordMutations(page: Page): Promise<() => Promise<SentMutation[]>> {
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as { __e2eMutations: unknown[] }).__e2eMutations = sent;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data) {
      if (typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message.type === "Mutation") sent.push({ udfPath: message.udfPath, args: message.args });
        } catch {
          // not JSON: ignore
        }
      }
      return send.call(this, data);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __e2eMutations: SentMutation[] }).__e2eMutations);
}

async function createArgs(read: () => Promise<SentMutation[]>) {
  return (await read()).find((m) => m.udfPath.startsWith("projects:create"))?.args[0];
}

/** Let the step slide and the heading focus finish before measuring. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() =>
    document.getAnimations().every(
      (animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity,
    ),
  );
}

async function expectAxeClean(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
});

test("three questions, one screen each, axe clean at 320 px", async ({ page }) => {
  await page.goto("/app/new");

  await expect(page.getByRole("heading", { level: 1, name: "What kind of business is it?" })).toBeVisible({ timeout: 15_000 });
  const types = page.getByRole("radiogroup", { name: "What kind of business is it?" });
  await expect(types.getByRole("radio")).toHaveCount(4);
  for (const radio of await types.getByRole("radio").all()) {
    const box = await radio.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What is it called?" })).toBeFocused();
  await expect(page.getByText("We read public pages to learn your services, photos and style. Nothing is posted anywhere.")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByLabel("Business name").fill("Northside Coffee");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What do you want most right now?" })).toBeFocused();
  await expect(page.getByRole("radiogroup", { name: "What do you want most right now?" }).getByRole("radio")).toHaveCount(4);
  // One primary action; Back is the only other button in the step bar.
  await expect(page.getByRole("button", { name: "Create my project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);
});

test("only the name is required", async ({ page }) => {
  const sent = await recordMutations(page);
  await page.goto("/app/new");
  await page.getByRole("button", { name: "Continue" }).click(); // skip Q1
  await expect(page.getByRole("heading", { level: 1, name: "What is it called?" })).toBeFocused();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Give your business a name to continue.");
  await expect(page.getByLabel("Business name")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "What is it called?" })).toBeVisible();

  await page.getByLabel("Business name").fill("Studio");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create my project" }).click(); // skip Q3

  await expect.poll(() => createArgs(sent)).toEqual({ name: "Studio" });
});

test("keyboard only: pick a type, name it, pick a goal, make the kit", async ({ page }) => {
  const sent = await recordMutations(page);
  await page.goto("/app/new");
  const heading = page.getByRole("heading", { level: 1, name: "What kind of business is it?" });
  await expect(heading).toBeVisible({ timeout: 15_000 });

  // Q1: Tab into the tiles, arrow to "Shop", Space picks it.
  const appointments = page.getByRole("radio", { name: /Services by appointment/ });
  await appointments.focus();
  await page.keyboard.press("ArrowDown");
  const shop = page.getByRole("radio", { name: /^Shop/ });
  await expect(shop).toBeFocused();
  await page.keyboard.press("Space");
  await expect(shop).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Enter");

  // Q2: the heading takes focus; Tab to the name, type, Enter moves on.
  await expect(page.getByRole("heading", { level: 1, name: "What is it called?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Business name")).toBeFocused();
  await page.keyboard.type("Northside Coffee");
  await page.keyboard.press("Enter");

  // Q3: skip mentions the shop default; pick "Get known locally" instead.
  await expect(page.getByRole("heading", { level: 1, name: "What do you want most right now?" })).toBeFocused();
  await expect(page.getByText("Skip this and we’ll start with “More sales”.")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "More bookings / calls" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "More sales" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "More people through the door" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const local = page.getByRole("radio", { name: "Get known locally" });
  await expect(local).toBeFocused();
  await page.keyboard.press("Space");
  await expect(local).toBeChecked();
  await page.keyboard.press("Tab"); // Back
  await page.keyboard.press("Tab"); // Create my project
  await expect(page.getByRole("button", { name: "Create my project" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => createArgs(sent))
    .toEqual({ name: "Northside Coffee", businessType: "shop", primaryGoal: "awareness" });
});

test("skipping the goal uses the default for the type", async ({ page }) => {
  const sent = await recordMutations(page);
  await page.goto("/app/new");
  await page.getByRole("radio", { name: /Services by appointment/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Business name").fill("Physio Plus");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create my project" }).click();
  await expect
    .poll(() => createArgs(sent))
    .toEqual({ name: "Physio Plus", businessType: "appointments", primaryGoal: "bookings" });
});
