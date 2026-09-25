import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U9 — agency path, first slice: the "I do marketing for clients" branch of
 * the first-run wizard and the client list on `/app`.
 *
 * Runs against the signed-in test backend double: synthetic data, no network.
 * The double does not answer mutations, so the wizard test checks the request
 * that leaves the browser rather than following it.
 */

const now = Date.UTC(2026, 8, 25);
const user = { _id: "e2e_user_1", _creationTime: now, name: "Ada", email: "ada@example.test" };

type SentMutation = { udfPath: string; args: Array<Record<string, unknown>> };

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

test.describe("wizard: I do marketing for clients", () => {
  test.use({
    backendData: {
      "users:currentUser": user,
      "admin:me": { isAdmin: false },
      "projects:list": [],
    },
  });

  test("asks the client's type on Q1, names the client on Q2 and creates a client project", async ({ page }) => {
    const sent = await recordMutations(page);
    await page.goto("/app/new");
    await expect(page.getByRole("heading", { level: 1, name: "What kind of business is it?" })).toBeVisible({ timeout: 15_000 });

    // The client group appears only for an agency.
    await expect(page.getByRole("radiogroup", { name: "What kind of business is your client?" })).toHaveCount(0);
    await page.getByRole("radio", { name: "I do marketing for clients" }).click();
    const clientTypes = page.getByRole("radiogroup", { name: "What kind of business is your client?" });
    await expect(clientTypes.getByRole("radio")).toHaveCount(3);
    await expect(clientTypes.getByRole("radio", { name: /marketing for clients/ })).toHaveCount(0);
    await clientTypes.getByRole("radio", { name: /^Shop/ }).click();
    await expect(clientTypes.getByRole("radio", { name: /^Shop/ })).toBeChecked();
    await expectNoSidewaysScroll(page);
    await expectAxeClean(page);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "What is your client’s business called?" })).toBeFocused();
    await expect(page.getByText("We read your client’s public pages to learn their services, photos and style. Nothing is posted anywhere.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Give your client’s business a name to continue.");
    await page.getByLabel("Client’s business name").fill("Northside Coffee");
    await expectNoSidewaysScroll(page);
    await expectAxeClean(page);
    await page.getByRole("button", { name: "Continue" }).click();

    // Q3 is unchanged; skipping uses the client type's default.
    await expect(page.getByRole("heading", { level: 1, name: "What do you want most right now?" })).toBeFocused();
    await expect(page.getByText("Skip this and we’ll start with “More sales”.")).toBeVisible();
    await page.getByRole("button", { name: "Make my starter kit" }).click();

    await expect
      .poll(async () => (await sent()).find((m) => m.udfPath.startsWith("projects:createClientProject"))?.args[0])
      .toEqual({ clientName: "Northside Coffee", businessType: "shop", primaryGoal: "sales" });
    expect((await sent()).some((m) => /^projects(\.js)?:create$/.test(m.udfPath))).toBe(false);
  });

  test("the client's type can be skipped", async ({ page }) => {
    const sent = await recordMutations(page);
    await page.goto("/app/new");
    await page.getByRole("radio", { name: "I do marketing for clients" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Client’s business name").fill("Studio");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Skip this if you are not sure yet.")).toBeVisible();
    await page.getByRole("button", { name: "Make my starter kit" }).click();
    await expect
      .poll(async () => (await sent()).find((m) => m.udfPath.startsWith("projects:createClientProject"))?.args[0])
      .toEqual({ clientName: "Studio" });
  });
});

const clientProjects = [
  { projectId: "e2e_client_b", projectName: "Physio Plus", clientName: "Physio Plus", updatedAt: now - 1_000 },
  { projectId: "e2e_client_a", projectName: "Northside Coffee", clientName: "Northside Coffee", updatedAt: now },
  { projectId: "e2e_client_c", projectName: "Harbour Salon", clientName: "Harbour Salon", updatedAt: now - 2_000 },
];

test.describe("/app for an agency with three clients", () => {
  test.use({
    backendData: {
      "users:currentUser": user,
      "admin:me": { isAdmin: false },
      "projects:list": clientProjects.map((c) => ({
        _id: c.projectId,
        _creationTime: c.updatedAt,
        ownerId: user._id,
        name: c.projectName,
        createdAt: c.updatedAt,
      })),
      // Served newest first, as the query returns them.
      "projects:agencyClientProjects": [...clientProjects].sort((a, b) => b.updatedAt - a.updatedAt),
    },
  });

  for (const client of clientProjects) {
    test(`${client.clientName} is one click away`, async ({ page }) => {
      await page.goto("/app");
      await expect(page.getByRole("heading", { level: 1, name: "Your clients" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("link", { name: client.clientName }).click();
      await expect(page).toHaveURL(new RegExp(`/app/${client.projectId}$`));
    });
  }

  test("lists every client newest first with one add button, axe clean at 320 px", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Your clients" })).toBeVisible({ timeout: 15_000 });
    const links = page.getByRole("list").getByRole("link");
    await expect(links).toHaveText(["Northside Coffee", "Physio Plus", "Harbour Salon"]);
    await expect(page.getByRole("link", { name: "Add a client" })).toHaveAttribute("href", "/app/new");
    await expect(page).toHaveURL(/\/app$/);
    await expectNoSidewaysScroll(page);
    await expectAxeClean(page);

    // Keyboard: the first client is reachable and opens with Enter.
    const first = page.getByRole("link", { name: "Northside Coffee" });
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/e2e_client_a$/);
  });
});

test.describe("/app for an agency with one client", () => {
  test.use({
    backendData: {
      "users:currentUser": user,
      "admin:me": { isAdmin: false },
      "projects:list": [{ _id: "e2e_client_a", _creationTime: now, ownerId: user._id, name: "Northside Coffee", createdAt: now }],
      "projects:agencyClientProjects": [clientProjects[1]],
    },
  });

  test("resumes the project as before", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/e2e_client_a$/, { timeout: 15_000 });
  });
});
