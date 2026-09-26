import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U2d — the six-screen first run at `/app/new`
 * (docs/ux/first-run-blueprint.md §2–§3, §7): kind of business (several),
 * name and website, goals, where the owner is active, customers and notes,
 * then "Here's what we found".
 *
 * Runs against the signed-in test backend double: synthetic data, no
 * network. The double does not answer mutations, so the last step checks
 * that the create request leaves the browser with the right answers rather
 * than following it to the project Home. Actions stay in flight unless the
 * test names an answer.
 */

const now = Date.UTC(2026, 8, 25);
const baseData = {
  "users:currentUser": { _id: "e2e_user_1", _creationTime: now, name: "Ada", email: "ada@example.test" },
  "admin:me": { isAdmin: false },
  "projects:list": [],
};

test.use({ backendData: baseData });

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
  return (await read()).find((m) => /^projects(\.js)?:create$/.test(m.udfPath))?.args[0];
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

/** Every tile (the label around each checkbox) is a 44 px target. */
async function expectTallTiles(page: Page, group: string, count: number) {
  const boxes = page.getByRole("group", { name: group }).getByRole("checkbox");
  await expect(boxes).toHaveCount(count);
  for (const box of await boxes.all()) {
    const id = await box.getAttribute("id");
    const tile = await page.locator(`label[for="${id}"]`).boundingBox();
    expect(tile?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

async function toNameStep(page: Page, type: RegExp | string = "Shop you can walk into") {
  await page.goto("/app/new");
  await expect(heading(page, "What kind of business is it?")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("checkbox", { name: type }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "What is it called?")).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
});

test("six short screens, each axe clean at 320 px", async ({ page }) => {
  await page.goto("/app/new");

  await expect(heading(page, "What kind of business is it?")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Step 1 of 6", { exact: true })).toBeVisible();
  await expectTallTiles(page, "What kind of business is it?", 8);
  // One column at 320 px: every tile starts at the same x.
  const lefts = await page
    .getByRole("group", { name: "What kind of business is it?" })
    .locator("label:has(input[type=checkbox])")
    .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  await expect(page.getByRole("button", { name: /Skip/ })).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByRole("checkbox", { name: "Café, restaurant, bar" }).check();
  await page.getByRole("checkbox", { name: "Shop you can walk into" }).check();
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "What is it called?")).toBeFocused();
  await expect(page.getByText("Step 2 of 6", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Skip/ })).toHaveCount(0);
  await expect(page.getByText("We read public pages to learn your services, photos and style. Nothing is posted anywhere.")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByLabel("Business name").fill("Northside Coffee");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "What do you want more of?")).toBeFocused();
  await expect(page.getByText("Step 3 of 6", { exact: true })).toBeVisible();
  await expectTallTiles(page, "What do you want more of?", 7);
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(heading(page, "Where are you already active?")).toBeFocused();
  await expectTallTiles(page, "Where are you already active?", 7);
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(heading(page, "Who are your customers?")).toBeFocused();
  await expectTallTiles(page, "Who are your customers?", 7);
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(heading(page, "Here’s what we found")).toBeFocused();
  await expect(page.getByText("Step 6 of 6", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make my starter kit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expectAxeClean(page);
});

test("the first pick is Main; Make main moves it; unpicking promotes the next", async ({ page }) => {
  await page.goto("/app/new");
  const group = page.getByRole("group", { name: "What kind of business is it?" });
  await expect(group).toBeVisible({ timeout: 15_000 });

  const cafe = page.getByRole("checkbox", { name: "Café, restaurant, bar" });
  const shop = page.getByRole("checkbox", { name: "Shop you can walk into" });
  await cafe.check();
  await shop.check();
  await expect(group.getByText("Main", { exact: true })).toHaveCount(1);
  await expect(cafe).toHaveAccessibleDescription("Main");
  const makeShopMain = page.getByRole("button", { name: "Make main: Shop you can walk into" });
  await expect(makeShopMain).toBeVisible();
  const box = await makeShopMain.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);

  await makeShopMain.click();
  await expect(shop).toHaveAccessibleDescription("Main");
  await expect(group.getByRole("status")).toHaveText("Shop you can walk into is now the main one.");
  await expect(page.getByRole("button", { name: "Make main: Café, restaurant, bar" })).toBeVisible();

  await shop.uncheck();
  await expect(cafe).toHaveAccessibleDescription("Main");
  await expect(group.getByRole("status")).toHaveText("Café, restaurant, bar is now the main one.");
  await expect(group.getByRole("button", { name: /Make main/ })).toHaveCount(0);
});

test("the client option and Nowhere yet are picked alone", async ({ page }) => {
  await page.goto("/app/new");
  const types = page.getByRole("group", { name: "What kind of business is it?" });
  await expect(types).toBeVisible({ timeout: 15_000 });

  const shop = page.getByRole("checkbox", { name: "Shop you can walk into" });
  const online = page.getByRole("checkbox", { name: "Online shop" });
  const agency = page.getByRole("checkbox", { name: "I set this up for a client" });
  await shop.check();
  await online.check();
  await agency.check();
  await expect(shop).not.toBeChecked();
  await expect(online).not.toBeChecked();
  await expect(types.getByRole("status")).toContainText("Your other picks were cleared.");
  await expect(page.getByRole("radiogroup", { name: "What kind of business is your client?" })).toBeVisible();
  await expect(page.getByLabel(/^Other/)).toHaveCount(0);

  await online.check();
  await expect(agency).not.toBeChecked();
  await expect(page.getByRole("radiogroup", { name: "What kind of business is your client?" })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Business name").fill("Studio");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(heading(page, "Where are you already active?")).toBeFocused();

  const instagram = page.getByRole("checkbox", { name: "Instagram" });
  const facebook = page.getByRole("checkbox", { name: "Facebook" });
  const nowhere = page.getByRole("checkbox", { name: "Nowhere yet" });
  await instagram.check();
  await facebook.check();
  await nowhere.check();
  await expect(instagram).not.toBeChecked();
  await expect(facebook).not.toBeChecked();
  await expect(page.getByRole("group", { name: "Where are you already active?" }).getByText("Main", { exact: true })).toHaveCount(0);
  await instagram.check();
  await expect(nowhere).not.toBeChecked();
});

test("kind of business and name are required; the rest can be skipped", async ({ page }) => {
  const sent = await recordMutations(page);
  await page.goto("/app/new");
  await expect(heading(page, "What kind of business is it?")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Pick at least one, or describe it under Other, to continue.");
  await expect(heading(page, "What kind of business is it?")).toBeVisible();

  // The owner's own words count as an answer.
  await page.getByLabel(/^Other/).fill("Dog grooming van");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "What is it called?")).toBeFocused();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Give your business a name to continue.");
  await expect(page.getByLabel("Business name")).toBeFocused();

  await page.getByLabel("Business name").fill("Studio");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(heading(page, "Here’s what we found")).toBeFocused();
  await expect(page.getByText("You didn’t add a website or Google listing. That’s fine, the kit will use your answers.")).toBeVisible();
  await page.getByRole("button", { name: "Make my starter kit" }).click();

  await expect.poll(() => createArgs(sent)).toEqual({ name: "Studio", firstRunNotes: { businessType: "Dog grooming van" } });
});

test("keyboard only: pick types, name it, pick goals, make the kit", async ({ page }) => {
  const sent = await recordMutations(page);
  await page.goto("/app/new");
  await expect(heading(page, "What kind of business is it?")).toBeVisible({ timeout: 15_000 });

  // Checkboxes: Tab moves between tiles, Space picks.
  const appointments = page.getByRole("checkbox", { name: "Services by appointment" });
  await appointments.focus();
  await page.keyboard.press("Tab");
  const trades = page.getByRole("checkbox", { name: "Trades & home services" });
  await expect(trades).toBeFocused();
  await page.keyboard.press("Space");
  await expect(trades).toBeChecked();
  await page.keyboard.press("Shift+Tab");
  await expect(appointments).toBeFocused();
  await page.keyboard.press("Space");
  await expect(appointments).toBeChecked();
  // The second pick offers "Make main"; Tab reaches it next.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Make main: Services by appointment" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(appointments).toHaveAccessibleDescription(/Main/);

  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");

  await expect(heading(page, "What is it called?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Business name")).toBeFocused();
  await page.keyboard.type("Fix-It Ltd");
  await page.keyboard.press("Enter");

  await expect(heading(page, "What do you want more of?")).toBeFocused();
  await expect(page.getByText("Pick all that matter, or skip and we’ll start with “More bookings / calls”.")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "More bookings / calls" })).toBeFocused();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Tab");
  const local = page.getByRole("checkbox", { name: "Get known locally" });
  await expect(local).toBeFocused();
  await page.keyboard.press("Space");
  await expect(local).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip for now" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Skip for now" }).focus();
  await page.keyboard.press("Enter");

  await expect(heading(page, "Here’s what we found")).toBeFocused();
  await page.getByRole("button", { name: "Make my starter kit" }).focus();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => createArgs(sent))
    .toEqual({
      name: "Fix-It Ltd",
      businessType: "appointments",
      otherBusinessTypes: ["trades"],
      primaryGoal: "awareness",
    });
});

test("every answer reaches the create request, with notes and a counter", async ({ page }) => {
  const sent = await recordMutations(page);
  await toNameStep(page, "Café, restaurant, bar");
  await page.getByLabel("Business name").fill("Northside Coffee");
  await page.getByRole("button", { name: "Continue" }).click();

  // Goals: nothing picked yet, so the type's default is named.
  await expect(page.getByText("Pick all that matter, or skip and we’ll start with “More people through the door”.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Better reviews" }).check();
  await page.getByRole("checkbox", { name: "More repeat customers" }).check();
  await page.getByLabel(/^Other/).fill("Fill the quiet Tuesdays");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("checkbox", { name: "Instagram" }).check();
  await page.getByRole("checkbox", { name: "Google Business Profile" }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "Who are your customers?")).toBeFocused();
  await page.getByRole("checkbox", { name: "Locals nearby" }).check();
  await page.getByRole("checkbox", { name: "Office workers" }).check();
  const anything = page.getByLabel(/^Anything we should know\?/);
  await expect(page.getByText("0 of 1000 characters")).toBeVisible();
  await anything.fill("Closed Mondays.");
  await expect(page.getByText("15 of 1000 characters")).toBeVisible();
  await expect(anything).toHaveAccessibleDescription("15 of 1000 characters");
  await anything.fill("x".repeat(1_200));
  await expect(page.getByText("1000 of 1000 characters")).toBeVisible();
  await anything.fill("Closed Mondays.");
  await page.getByRole("button", { name: "Continue" }).click();

  // Here's what we found: the answers, each with a Fix back to its screen.
  await expect(heading(page, "Here’s what we found")).toBeFocused();
  const goals = page.getByRole("region", { name: "What you want more of" });
  await expect(goals).toContainText("Better reviews");
  await expect(goals).toContainText("More repeat customers");
  await expect(goals).toContainText("Other: Fill the quiet Tuesdays");
  await expect(page.getByRole("region", { name: "Your customers" })).toContainText("Anything else: Closed Mondays.");

  await page.getByRole("button", { name: "Fix where you’re active" }).click();
  await expect(heading(page, "Where are you already active?")).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Instagram" })).toBeChecked();
  await page.getByRole("button", { name: "Make main: Google Business Profile" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Here’s what we found")).toBeFocused();

  await page.getByRole("button", { name: "Make my starter kit" }).click();
  await expect
    .poll(() => createArgs(sent))
    .toEqual({
      name: "Northside Coffee",
      businessType: "walk_in",
      primaryGoal: "reviews",
      otherGoals: ["repeat_customers"],
      postingChannels: ["google_business", "instagram"],
      customerGroups: ["locals", "office_workers"],
      firstRunNotes: { goal: "Fill the quiet Tuesdays", anythingElse: "Closed Mondays." },
    });
});

test("skipping the goals uses the default for the main type", async ({ page }) => {
  const sent = await recordMutations(page);
  await toNameStep(page, "Services by appointment");
  await page.getByLabel("Business name").fill("Physio Plus");
  await page.getByRole("button", { name: "Continue" }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("region", { name: "What you want more of" })).toContainText("Skipped. We’ll start with “More bookings / calls”.");
  await page.getByRole("button", { name: "Make my starter kit" }).click();
  await expect
    .poll(() => createArgs(sent))
    .toEqual({ name: "Physio Plus", businessType: "appointments", primaryGoal: "bookings" });
});

test("while the site is still being read, the summary says so and invents nothing", async ({ page }) => {
  await toNameStep(page);
  await page.getByLabel("Business name").fill("Northside Coffee");
  await page.getByLabel(/Where can we read about it\?|Your website or Google listing/).fill("northside.test");
  await page.getByRole("button", { name: "Continue" }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole("button", { name: "Skip for now" }).click();

  const found = page.getByRole("region", { name: "From your website or listing" });
  await expect(found).toContainText("We’re still reading your site.");
  await expect(found.locator("dl")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Name" })).toContainText("Read from: northside.test");

  await found.getByRole("button", { name: "Fix website or listing" }).click();
  await expect(heading(page, "What is it called?")).toBeFocused();
});

test.describe("when the site can't be read", () => {
  test.use({ backendData: { ...baseData, "action:scraping:scanWebsite": { error: "The site did not answer." } } });

  test("the summary says so plainly", async ({ page }) => {
    await toNameStep(page);
    await page.getByLabel("Business name").fill("Northside Coffee");
    await page.getByLabel(/Where can we read about it\?|Your website or Google listing/).fill("northside.test");
    await page.getByRole("button", { name: "Continue" }).click();
    for (let i = 0; i < 3; i += 1) await page.getByRole("button", { name: "Skip for now" }).click();

    const found = page.getByRole("region", { name: "From your website or listing" });
    await expect(found).toContainText("We couldn’t read your site; that’s fine, the kit will use your answers.");
    await expect(found.locator("dl")).toHaveCount(0);
    await expectAxeClean(page);
  });
});
