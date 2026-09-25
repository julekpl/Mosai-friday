import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U4 — the starter kit cards on Home (docs/ux/first-run-blueprint.md §3, §7).
 *
 * Runs against the signed-in test backend double: synthetic kit fixtures in
 * each part state, no network and no provider. The double does not answer
 * mutations, so buttons that write (Try again, Hide the kit) are checked by
 * the request that leaves the browser.
 */

const PROJECT_ID = "e2e_project_kit";
const now = Date.UTC(2026, 8, 25);
const PICTURE = "https://e2e-test-only.convex.cloud/api/storage/e2e-picture-1";
// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const project = {
  _id: PROJECT_ID,
  _creationTime: now,
  ownerId: "e2e_user_1",
  name: "Harbour Street Physio",
  description: "Sports and back-pain physiotherapy on Harbour Street.",
  websiteUrl: "https://harbour-physio.example",
  businessType: "appointments",
  primaryGoal: "bookings",
};

const MODULES = ["understand", "journeys", "create", "build", "customers", "promote", "sell", "grow"];

type Part = {
  status: string;
  step?: string;
  message?: string;
  errorCode?: string;
  outputs: Array<{ type: string; id: string }>;
  attempts: number;
  updatedAt: number;
};

function part(overrides: Partial<Part>): Part {
  return { status: "queued", outputs: [], attempts: 1, updatedAt: now, ...overrides };
}

function kit(parts: { plan: Part; site: Part; posts: Part }, extra: Record<string, unknown> = {}) {
  return {
    _id: "e2e_kit_1",
    _creationTime: now,
    projectId: PROJECT_ID,
    requestedBy: "e2e_user_1",
    idempotencyKey: PROJECT_ID,
    status: "running",
    parts,
    attempts: 1,
    budgetMicrousd: 400_000,
    spentMicrousd: 0,
    budgetCurrency: "USD",
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

const plan = {
  customers: [
    { text: "Runners with knee pain who want to keep training", basis: "fact" },
    { text: "Office workers with a stiff back", basis: "assumption" },
  ],
  thisWeek: [
    { action: "Add a Book now button to your homepage", why: "Your site lists bookings by phone only", basis: "fact" },
    { action: "Post a stretching tip on Instagram", why: "Tips bring people who are not ready to book", basis: "assumption" },
    { action: "Ask three patients for a review", why: "Reviews help people choose a clinic nearby", basis: "assumption" },
  ],
};

const posts = [
  {
    _id: "e2e_post_1",
    channel: "instagram",
    body: "Knee pain after your long run? Three stretches we give every runner, and when to come and see us instead of pushing through it.",
    status: "draft",
    mediaUrl: PICTURE,
    attribution: { photographer: "Sam Rivers", photographerUrl: "https://www.pexels.com/@sam-rivers" },
  },
  {
    _id: "e2e_post_2",
    channel: "facebook",
    body: "Stiff back from the desk? Book a 30-minute assessment this week.",
    status: "draft",
  },
];

function backendData(overrides: Record<string, unknown>) {
  return {
    "users:currentUser": { _id: "e2e_user_1", _creationTime: now, name: "Ada", email: "ada@example.test" },
    "admin:me": { isAdmin: false },
    "projects:list": [project],
    "projects:get": project,
    "projects:exportPack": { markdown: "# Harbour Street Physio" },
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
    "starterKit:content": { plan, posts, website: { buildId: "e2e_build_1" } },
    ...overrides,
  };
}

type SentMutation = { udfPath: string; args: Array<Record<string, unknown>> };

/** Record the Convex mutations the page sends (the double never answers them). */
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

async function openHome(page: Page) {
  await page.route(PICTURE, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.goto(`/app/${PROJECT_ID}`);
}

/** Wait for entrance animations to end (infinite ones, like the pulse, are allowed). */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
}

async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).include("section[aria-labelledby='starter-kit-title']").analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("finished and partial parts", () => {
  test.use({
    backendData: backendData({
      "starterKit:get": kit({
        plan: part({ status: "succeeded", outputs: [{ type: "contentPieces", id: "c1" }] }),
        site: part({ status: "running", step: "Writing your homepage" }),
        posts: part({
          status: "partially_succeeded",
          message: "1 of 2 posts has a picture; add your own for the rest",
        }),
      }),
    }),
  });

  test("the cards show the real step, the draft wording and the named gap", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openHome(page);
    const kitSection = page.getByRole("region", { name: "Your starter kit" });
    await expect(kitSection).toBeVisible();

    const planCard = kitSection.getByRole("article", { name: "Your plan" });
    await expect(planCard.getByText("Your plan is ready")).toBeVisible();
    await expect(planCard.getByText("draft", { exact: true })).toBeVisible();

    const siteCard = kitSection.getByRole("article", { name: "Your website" });
    await expect(siteCard.getByText("Drafting your website…")).toBeVisible();
    await expect(siteCard.getByText("Writing your homepage")).toBeVisible();
    await expect(siteCard.getByText(/%/)).toHaveCount(0);

    const postsCard = kitSection.getByRole("article", { name: "Your posts" });
    await expect(postsCard.getByText("1 of 2 posts has a picture; add your own for the rest")).toBeVisible();
    await expect(postsCard.getByRole("link", { name: "Add your own pictures" })).toHaveAttribute(
      "href",
      `/app/${PROJECT_ID}/promote`,
    );
    await expect(postsCard.getByRole("img", { name: "Picture for your Instagram post" })).toBeVisible();
    const photographer = postsCard.getByRole("link", { name: "Sam Rivers" });
    await expect(photographer).toHaveAttribute("href", "https://www.pexels.com/@sam-rivers");
    await expect(photographer).toHaveAttribute("rel", "noopener noreferrer");
    await expect(postsCard.getByRole("link", { name: "Photos provided by Pexels" })).toHaveAttribute(
      "href",
      "https://www.pexels.com",
    );
    await expect(postsCard.getByRole("link", { name: /Download picture/ })).toHaveAttribute("href", PICTURE);

    // The polite live region announces the finished parts, not the running one.
    const announcer = page.getByTestId("kit-announcer");
    await expect(announcer).toHaveAttribute("aria-live", "polite");
    await expect(announcer).toContainText("Your plan is ready.");
    await expect(announcer).toContainText("Your posts are ready to use, with one gap");
    await expect(announcer).not.toContainText("website");

    // Copy text announces politely.
    await postsCard.getByRole("button", { name: /Copy text of your Instagram post/ }).click();
    await expect(postsCard.getByRole("status")).toHaveText("Copied");

    // The plan reads in one screen, each point labelled by where it came from.
    await planCard.getByRole("button", { name: "Read it (1 min)" }).click();
    const dialog = page.getByRole("dialog", { name: "Your plan" });
    await expect(dialog.getByText("Your customers (our guess)")).toBeVisible();
    await expect(dialog.getByText("from your website").first()).toBeVisible();
    await expect(dialog.getByText("our guess", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(5);
    await expect(dialog.getByText("Why: Your site lists bookings by phone only")).toBeVisible();
    await dialog.getByRole("button", { name: "Fix the facts" }).click();
    await expect(page.getByRole("dialog", { name: "Edit project" })).toBeVisible();
  });

  test("fits 320px, animates only without reduced motion, and passes axe", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await expect(page.getByRole("heading", { name: "Your starter kit" })).toBeVisible();
    await settle(page);
    const overflow = await sidewaysOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewport);

    const pulse = page.locator("[data-kit-state='working'] [data-kit-pulse]").first();
    expect(await pulse.evaluate((element) => element.getAnimations().length)).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => pulse.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });

    expect(await seriousAxe(page)).toEqual([]);
  });
});

test.describe("failed and locked parts", () => {
  test.use({
    backendData: backendData({
      "starterKit:get": kit({
        plan: part({ status: "failed", errorCode: "ai_budget" }),
        site: part({ status: "queued", errorCode: "needs_plan", message: "Needs the Starter plan" }),
        posts: part({ status: "failed", errorCode: "rate_limited" }),
      }),
      "starterKit:content": { plan: null, posts: [], website: null },
    }),
  });

  test("failed parts keep the answers and retry; locked parts point to plans", async ({ page }) => {
    const sent = await recordMutations(page);
    await openHome(page);
    const kitSection = page.getByRole("region", { name: "Your starter kit" });
    const planCard = kitSection.getByRole("article", { name: "Your plan" });
    await expect(planCard.getByText("We could not draft your plan. Your answers are saved.")).toBeVisible();
    await expect(
      kitSection.getByRole("article", { name: "Your posts" }).getByText("We could not draft your posts. Your answers are saved."),
    ).toBeVisible();

    const siteCard = kitSection.getByRole("article", { name: "Your website" });
    await expect(siteCard.getByText("Needs the Starter plan")).toBeVisible();
    await expect(siteCard.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing");

    await expect(page.getByTestId("kit-announcer")).toContainText("We could not draft your plan.");

    await planCard.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(async () => (await sent()).find((m) => m.udfPath.startsWith("starterKit:start"))?.args[0])
      .toEqual({ projectId: PROJECT_ID });

    await kitSection.getByRole("button", { name: "Hide the kit" }).click();
    await expect
      .poll(async () => (await sent()).find((m) => m.udfPath.startsWith("starterKit:dismiss"))?.args[0])
      .toEqual({ projectId: PROJECT_ID });

    await settle(page);
    expect(await seriousAxe(page)).toEqual([]);
  });
});

test.describe("draft versus live website", () => {
  const finished = kit({
    plan: part({ status: "succeeded" }),
    site: part({ status: "succeeded", outputs: [{ type: "builds", id: "e2e_build_1" }] }),
    posts: part({ status: "succeeded" }),
  });

  test.describe("not on the web yet", () => {
    test.use({ backendData: backendData({ "starterKit:get": finished }) });

    test("a finished website is a draft until hosting says live", async ({ page }) => {
      await openHome(page);
      const siteCard = page.getByRole("article", { name: "Your website" });
      await expect(siteCard.getByText("Draft · not on the web yet")).toBeVisible();
      await expect(siteCard.getByText(/\blive\b/i)).toHaveCount(0);
      const buildHref = `/app/${PROJECT_ID}/build?build=e2e_build_1`;
      await expect(siteCard.getByRole("link", { name: "Look at it" })).toHaveAttribute("href", buildHref);
      await expect(siteCard.getByRole("link", { name: "Publish" })).toHaveAttribute("href", buildHref);
      await expect(page.getByTestId("kit-announcer")).toContainText("Your website draft is ready.");
    });
  });

  test.describe("live", () => {
    test.use({
      backendData: backendData({
        "starterKit:get": finished,
        "siteHosting:status": {
          slug: "harbour-physio",
          path: "/s/harbour-physio-website",
          state: "live",
          lastDeployedAt: now,
          error: null,
        },
      }),
    });

    test("the address shows only when hosting reports live", async ({ page }) => {
      await openHome(page);
      const siteCard = page.getByRole("article", { name: "Your website" });
      const address = siteCard.getByRole("link", { name: /\/s\/harbour-physio-website$/ });
      await expect(address).toBeVisible();
      await expect(address).toHaveAttribute("rel", "noopener noreferrer");
      await expect(siteCard.getByText("Draft · not on the web yet")).toHaveCount(0);
      await expect(siteCard.getByRole("link", { name: "Publish" })).toHaveCount(0);
    });
  });
});

test.describe("hidden kit", () => {
  test.use({
    backendData: backendData({
      "starterKit:get": kit(
        { plan: part({ status: "succeeded" }), site: part({ status: "succeeded" }), posts: part({ status: "succeeded" }) },
        { dismissedAt: now },
      ),
    }),
  });

  test("a hidden kit renders nothing", async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText("Harbour Street Physio");
    await expect(page.getByRole("heading", { name: "Your starter kit" })).toHaveCount(0);
  });
});
