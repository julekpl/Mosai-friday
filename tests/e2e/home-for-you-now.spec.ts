import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * HM-2 — Home's one "For you now" list (max 3, ranked on the server by
 * `home.priorities`). Runs against the signed-in test backend double with
 * synthetic data only (no network, no provider).
 */

const PROJECT_ID = "e2e_project_home";
const MODULES = ["understand", "journeys", "create", "build", "customers", "promote", "sell", "grow"];
const FIXED = Date.UTC(2026, 8, 25);
const DAY = 24 * 60 * 60 * 1000;

type Part = { status: string; step?: string; errorCode?: string; message?: string };
const part = (overrides: Partial<Part>) => ({ status: "queued", outputs: [], attempts: 1, updatedAt: FIXED, ...overrides });

const READY_ITEMS = [
  {
    id: "ready-site",
    kind: "ready",
    title: "Look over your website",
    reason: "You want more bookings, and your website draft is ready to look over.",
    action: { kind: "link", label: "Look over your website", to: `/app/${PROJECT_ID}/build` },
    state: "ready",
  },
  {
    id: "ready-posts",
    kind: "ready",
    title: "Use this week's posts",
    reason: "7 posts are ready to use for Instagram.",
    action: { kind: "link", label: "Review your posts", to: `/app/${PROJECT_ID}/promote` },
    state: "ready",
  },
  {
    id: "next-contact",
    kind: "next",
    title: "Add a way to reach you",
    reason: "Save a phone, email or address so customers can reach you.",
    action: { kind: "link", label: "Add contact details", to: `/app/${PROJECT_ID}?edit=details` },
    state: "ready",
  },
];

function backendData(extra: Record<string, unknown>) {
  const project = {
    _id: PROJECT_ID,
    _creationTime: FIXED,
    ownerId: "e2e_user_1",
    name: "Harbour Street Physio",
    description: "Physiotherapy for runners and desk workers in the harbour district, open six days a week.",
    industry: "Health",
    businessType: "appointments",
    primaryGoal: "bookings",
    postingChannels: ["instagram"],
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
    "starterKit:get": null,
    "starterKit:content": { plan: null, posts: [], website: null },
    ...extra,
  };
}

async function openHome(page: Page) {
  await page.goto(`/app/${PROJECT_ID}`);
  await expect(page.getByTestId("for-you-now")).toBeVisible({ timeout: 15_000 });
}

test.describe("a finished kit on a return visit", () => {
  test.use({
    backendData: async ({ browser }, complete) => {
      void browser;
      await complete(
        backendData({
          "home:priorities": READY_ITEMS,
          "visits:sinceLastVisit": { since: Date.now() - 2 * DAY, posted: 2 },
        }),
      );
    },
  });

  test("shows at most three server-ranked items, one live region, and the since line under the top item", async ({ page }) => {
    await openHome(page);
    const list = page.getByTestId("for-you-now");
    await expect(list.getByRole("heading", { name: "For you now" })).toBeVisible();
    await expect(list.locator("[data-item-id]")).toHaveCount(3);
    await expect(list.locator("[data-item-id]").first()).toHaveAttribute("data-item-id", "ready-site");
    await expect(list.locator("[aria-live]")).toHaveCount(1);
    await expect(page.getByTestId("for-you-now-announcer")).toHaveText("For you now: Look over your website.");

    const top = list.locator("[data-item-id]").first();
    await expect(top.getByTestId("since-subline")).toHaveText(/^Since \w+day: 2 posts went out$/);
    await expect(top.getByRole("list", { name: "Why this?" })).toContainText("You want more bookings");
    await expect(top.getByRole("link", { name: "Look over your website" })).toHaveAttribute(
      "href",
      `/app/${PROJECT_ID}/build`,
    );

    // The old cards are gone: no separate "This week" or "Since you were away".
    await expect(page.getByText("Your week at a glance")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Since you were away" })).toHaveCount(0);
  });

  test("at 320px the top item is visible without scrolling past the header, and axe passes", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    const button = page.getByTestId("for-you-now").getByRole("link", { name: "Look over your website" });
    await expect(button).toBeInViewport();
    const layout = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(layout.scrollY).toBe(0);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);

    const results = await new AxeBuilder({ page }).include("[data-testid='for-you-now']").analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
    expect(serious).toEqual([]);
  });
});

test.describe("nothing to do", () => {
  test.use({ backendData: backendData({ "home:priorities": [] }) });

  test("says so plainly", async ({ page }) => {
    await openHome(page);
    await expect(page.getByTestId("for-you-now").getByText("Nothing needs you right now", { exact: true })).toBeVisible();
    await expect(page.getByTestId("for-you-now-announcer")).toHaveText("Nothing needs you right now.");
  });
});

test.describe("a kit part that failed", () => {
  test.use({
    backendData: backendData({
      "starterKit:get": {
        _id: "e2e_kit_home",
        _creationTime: FIXED,
        projectId: PROJECT_ID,
        requestedBy: "e2e_user_1",
        idempotencyKey: PROJECT_ID,
        status: "partially_succeeded",
        parts: {
          plan: part({ status: "succeeded" }),
          site: part({ status: "failed", errorCode: "ai_error" }),
          posts: part({ status: "succeeded" }),
        },
        attempts: 1,
        budgetMicrousd: 400_000,
        spentMicrousd: 0,
        budgetCurrency: "USD",
        createdAt: FIXED,
        updatedAt: FIXED,
      },
      "home:priorities": [
        {
          id: "needs-you-site",
          kind: "needs_you",
          title: "We could not draft your website",
          reason: "Something went wrong while MOSAI worked on it. Your answers are kept.",
          action: { kind: "intent", label: "Try again", intent: "retry_kit_part", part: "site" },
          state: "needs_input",
        },
      ],
    }),
  });

  test("Try again on the item runs the kit's retry; the kit cards stay below", async ({ page }) => {
    await openHome(page);
    // The kit cards (with their own retry) are still on Home.
    await expect(page.getByRole("heading", { name: "Your starter kit" })).toBeVisible();
    const retry = page.getByTestId("for-you-now").getByRole("button", { name: "Try again" });
    await expect(retry).toHaveAttribute("data-intent", "retry_kit_part");
    await retry.click();
    // The `starterKit.start` mutation is in flight (the double never answers it).
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await expect(retry).toBeDisabled();
  });
});
