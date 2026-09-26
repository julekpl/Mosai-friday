import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U2e — "Mosaic assembles": the full-screen kit loader on Home.
 *
 * Runs against the signed-in test backend double with synthetic kit data (no
 * network, no provider). The double answers each query once, so these specs
 * check one snapshot of the job each; the transitions between snapshots are
 * covered by the unit tests of `bootloader-model.ts`.
 */

const PROJECT_ID = "e2e_project_boot";
const KIT_ID = "e2e_kit_boot";
const MODULES = ["understand", "journeys", "create", "build", "customers", "promote", "sell", "grow"];
const FIXED = Date.UTC(2026, 8, 25);

type Part = { status: string; step?: string; message?: string; errorCode?: string };

function part(overrides: Partial<Part>) {
  return { status: "queued", outputs: [], attempts: 1, updatedAt: FIXED, ...overrides };
}

function kit(parts: Record<"plan" | "site" | "posts", ReturnType<typeof part>>, extra: Record<string, unknown>) {
  return {
    _id: KIT_ID,
    _creationTime: FIXED,
    projectId: PROJECT_ID,
    requestedBy: "e2e_user_1",
    idempotencyKey: PROJECT_ID,
    status: "running",
    parts,
    attempts: 1,
    budgetMicrousd: 400_000,
    spentMicrousd: 0,
    budgetCurrency: "USD",
    createdAt: FIXED,
    updatedAt: FIXED,
    ...extra,
  };
}

const RUNNING_PARTS = {
  plan: part({ status: "succeeded" }),
  site: part({ status: "running", step: "Writing your homepage" }),
  posts: part({ status: "queued" }),
};

function backendData(starterKit: unknown) {
  const project = {
    _id: PROJECT_ID,
    _creationTime: FIXED,
    ownerId: "e2e_user_1",
    name: "Harbour Street Physio",
    businessType: "appointments",
    primaryGoal: "bookings",
  };
  return {
    "users:currentUser": { _id: "e2e_user_1", _creationTime: FIXED, name: "Ada", email: "ada@example.test" },
    "admin:me": { isAdmin: false },
    "projects:list": [project],
    "projects:get": project,
    "entitlements:matrix": {
      plan: "growth",
      role: "owner",
      country: "Default",
      addons: [],
      modules: MODULES.map((module) => ({ module, label: module, state: "included" })),
    },
    "billing:currentPlan": { plan: "growth", modules: MODULES },
    "personas:list": [],
    "journeys:list": [],
    "connections:list": [],
    "files:list": [],
    "content:list": [],
    "communications:list": [],
    "builds:list": [],
    "posts:list": [],
    "siteHosting:status": { slug: null, path: null, state: "not_deployed", lastDeployedAt: null, error: null },
    "starterKit:get": starterKit,
    "starterKit:content": { plan: null, posts: [], website: null },
  };
}

/** A kit the job touched just now (a fixed date would read as stale). */
function withFreshRunningKit() {
  test.use({
    backendData: async ({ browser }, complete) => {
      void browser;
      await complete(backendData(kit(RUNNING_PARTS, { updatedAt: Date.now() })));
    },
  });
}

async function openHome(page: Page) {
  await page.goto(`/app/${PROJECT_ID}`);
}

async function currentTip(page: Page) {
  return page.getByTestId("kit-explainer").getAttribute("data-explainer-id");
}

test.describe("while the kit is being drafted", () => {
  withFreshRunningKit();

  test("shows the loader with the job's real steps, and Go to my kit closes it for good", async ({ page }) => {
    await openHome(page);
    const loader = page.getByRole("dialog", { name: "Making your starter kit" });
    await expect(loader).toBeVisible();

    // Checklist text comes from the job's `step`, the badge from its status.
    const site = loader.locator("[data-boot-part='site']");
    await expect(site.locator("[data-boot-text]")).toHaveText("Writing your homepage");
    await expect(site.getByText("drafting", { exact: true })).toBeVisible();
    await expect(loader.locator("[data-boot-part='plan'] [data-boot-text]")).toHaveText("Your plan is ready");
    await expect(loader.locator("[data-boot-part='posts'] [data-boot-text]")).toHaveText("Waiting to start");
    await expect(loader.getByTestId("kit-boot-checklist").getByText(/%/)).toHaveCount(0);
    await expect(loader.getByTestId("kit-boot-announcer")).toHaveAttribute("aria-live", "polite");

    // Tiles: the finished plan is solid, nothing of the queued posts is.
    const mosaic = loader.getByTestId("kit-mosaic");
    await expect(mosaic.locator("[data-tile-part='plan'][data-tile-state='filled']")).toHaveCount(4);
    await expect(mosaic.locator("[data-tile-part='posts'][data-tile-state='filled']")).toHaveCount(0);
    await expect(mosaic.locator("[data-tile-part='site'][data-tile-state='active']")).toHaveCount(1);

    // The tips say they are general info, not progress.
    await expect(loader.getByText("General info about MOSAI, not your kit's progress.")).toBeVisible();

    await loader.getByRole("button", { name: "Go to my kit" }).click();
    await expect(page.getByTestId("kit-bootloader")).toHaveCount(0);
    const heading = page.getByRole("heading", { name: "Your starter kit" });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();

    // Remembered for this viewer and this kit.
    await page.reload();
    await expect(heading).toBeVisible();
    await expect(page.getByTestId("kit-bootloader")).toHaveCount(0);
  });

  test("tips rotate on their own, and Pause stops them", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHome(page);
    const tips = page.getByTestId("kit-explainers");
    await expect(tips).toHaveAttribute("data-rotating", "true");
    const first = await currentTip(page);
    await expect.poll(() => currentTip(page), { timeout: 10_000 }).not.toBe(first);

    await tips.getByRole("button", { name: "Pause tips" }).click();
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "Go to my kit" }).focus();
    await expect(tips).toHaveAttribute("data-rotating", "false");
    const paused = await currentTip(page);
    await page.waitForTimeout(7_000);
    expect(await currentTip(page)).toBe(paused);
  });

  test("under reduced motion: no auto-rotation, no animation, manual next", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    const tips = page.getByTestId("kit-explainers");
    await expect(tips).toHaveAttribute("data-rotating", "false");
    await expect(tips.getByRole("button", { name: "Pause tips" })).toHaveCount(0);

    const first = await currentTip(page);
    await page.waitForTimeout(7_000);
    expect(await currentTip(page)).toBe(first);

    const animations = await page
      .getByTestId("kit-bootloader")
      .evaluate((element) => element.getAnimations({ subtree: true }).length);
    expect(animations).toBe(0);

    await tips.getByRole("button", { name: "Next tip" }).click();
    await expect.poll(() => currentTip(page)).not.toBe(first);
  });

  test("fits 320px and passes axe", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await expect(page.getByTestId("kit-bootloader")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      loaderScroll: document.querySelector("[data-testid='kit-bootloader']")?.scrollWidth ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.loaderScroll).toBeLessThanOrEqual(overflow.viewport);

    const results = await new AxeBuilder({ page }).include("[data-testid='kit-bootloader']").analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
    expect(serious).toEqual([]);
  });
});

test.describe("kits the loader leaves alone", () => {
  test.describe("a stale running kit", () => {
    // Last touched long ago: no run is working on it, so no loader.
    test.use({ backendData: backendData(kit(RUNNING_PARTS, { updatedAt: FIXED })) });

    test("shows only the kit cards", async ({ page }) => {
      await openHome(page);
      await expect(page.getByRole("heading", { name: "Your starter kit" })).toBeVisible();
      await expect(page.getByTestId("kit-bootloader")).toHaveCount(0);
    });
  });

  test.describe("a failed kit", () => {
    test.use({
      backendData: async ({ browser }, complete) => {
        void browser;
        await complete(
          backendData(
            kit(
              {
                plan: part({ status: "failed", errorCode: "ai_budget" }),
                site: part({ status: "failed" }),
                posts: part({ status: "failed" }),
              },
              { status: "failed", updatedAt: Date.now() },
            ),
          ),
        );
      },
    });

    test("shows the cards with Try again, not the loader", async ({ page }) => {
      await openHome(page);
      await expect(page.getByRole("heading", { name: "Your starter kit" })).toBeVisible();
      await expect(page.getByTestId("kit-bootloader")).toHaveCount(0);
    });
  });
});
