import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * MD-0 — the picture picker on the kit post cards (fixtures copied from
 * starter-kit.spec.ts).
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

const pictures = [
  { _id: "e2e_file_upload", name: "shopfront.png", source: "upload", url: PICTURE },
  { _id: "e2e_file_site", name: "team.png", source: "owner_site", url: PICTURE },
  { _id: "e2e_file_stock", name: "pexels-1", source: "stock", url: PICTURE, photographer: "Sam Rivers" },
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
    "files:pictures": pictures,
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


const finished = kit({
  plan: part({ status: "succeeded" }),
  site: part({ status: "succeeded", outputs: [{ type: "builds", id: "e2e_build_1" }] }),
  posts: part({ status: "succeeded" }),
});

async function seriousAxe(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("MD-0 picture picker", () => {
  test.use({ backendData: backendData({ "starterKit:get": finished }) });

  test("desktop: keyboard pick sends only ids, Download picture is unchanged", async ({ page }) => {
    const sent = await recordMutations(page);
    await openHome(page);
    const postsCard = page.getByRole("article", { name: "Your posts" });
    await expect(postsCard.getByRole("link", { name: /Download picture/ })).toHaveAttribute("href", PICTURE);
    await expect(postsCard.getByRole("link", { name: "Sam Rivers" })).toBeVisible();
    await expect(postsCard.getByRole("button", { name: "Add a picture for your Facebook post" })).toBeVisible();

    const change = postsCard.getByRole("button", { name: "Change picture for your Instagram post" });
    await change.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Picture for your Instagram post" });
    await expect(dialog).toBeVisible();
    for (const name of ["Your photos", "From your website", "Stock photos"]) {
      await expect(dialog.getByRole("tab", { name })).toBeVisible();
    }
    const use = dialog.getByRole("button", { name: "Use this picture" });
    await expect(use).toBeDisabled();
    await expect(dialog.locator("input[type=file][capture]")).toHaveAttribute("accept", "image/*");

    await dialog.getByRole("tab", { name: "Stock photos" }).click();
    await expect(dialog.getByText("Photo by Sam Rivers")).toBeVisible();
    await dialog.getByRole("radio").first().focus();
    await page.keyboard.press("Space");
    await expect(use).toBeEnabled();
    expect(await seriousAxe(page, "[role=dialog]")).toEqual([]);
    await use.click();
    await expect
      .poll(async () => (await sent()).find((m) => m.udfPath.startsWith("starterKit:setPostPicture"))?.args[0])
      .toEqual({ projectId: PROJECT_ID, postId: "e2e_post_1", projectFileId: "e2e_file_stock" });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(change).toBeFocused();
  });

  test("phone 320px: bottom sheet fits, passes axe, focus returns", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    const add = page.getByRole("button", { name: "Add a picture for your Facebook post" });
    await add.click();
    const sheet = page.getByRole("dialog", { name: "Picture for your Facebook post" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Take a photo" })).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflow).toBe(true);
    expect(await seriousAxe(page, "[role=dialog]")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(add).toBeFocused();
  });
});
