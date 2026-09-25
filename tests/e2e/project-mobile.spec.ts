import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * The project page (`/app/:projectId`, `Overview` inside `AppShell`) at phone
 * widths. Deliberately long synthetic copy (a long project name, an
 * unbroken domain, long content titles) because that is what breaks a
 * narrow layout. A page that scrolls sideways on a phone fails.
 */

const PROJECT_ID = "e2e_project_1";
const now = Date.UTC(2026, 8, 20);

const project = {
  _id: PROJECT_ID,
  _creationTime: now,
  ownerId: "e2e_user_1",
  name: "Northwind Speciality Coffee Roasters and Neighbourhood Café",
  description:
    "Small-batch roaster with two cafés, selling beans online and wholesale to independent restaurants across the region.",
  industry: "Food & beverage — speciality coffee",
  websiteUrl: "https://www.northwind-speciality-coffee-roasters-example.co.uk/shop",
  googleBusinessName: "Northwind Speciality Coffee Roasters (Harbour Street)",
  productsServices: ["single-origin beans", "espresso blends", "wholesale supply", "barista training"],
  goals: ["grow online subscriptions", "win five new wholesale accounts"],
  competitors: ["Harbourside Roasting Company", "Pioneer Coffee Collective"],
  businessProfile: {
    summary:
      "Northwind roasts to order and sells to home brewers and independent restaurants that care about traceable sourcing.",
    businessModel: "mixed",
    offerings: ["single-origin beans", "wholesale supply"],
    customerSegments: ["home brewers", "independent restaurants", "office managers"],
    notTheAudience: ["large coffee-shop chains"],
    customerProblems: ["stale supermarket coffee", "inconsistent wholesale deliveries"],
    primaryGoals: ["grow online subscriptions"],
    market: "United Kingdom",
    differentiators: ["roasted within 48 hours of the order, never left sitting in a warehouse"],
    contentThemes: ["brewing guides", "farm stories"],
    status: "ai_draft",
    updatedAt: now,
  },
};

const MODULES = ["understand", "journeys", "create", "build", "customers", "promote", "sell", "grow"];

const backendData = {
  "users:currentUser": {
    _id: "e2e_user_1",
    _creationTime: now,
    name: "Ada Lovelace",
    email: "ada.lovelace.long-address@northwind-speciality-coffee.example",
  },
  "admin:me": { isAdmin: false },
  "projects:list": [project],
  "projects:get": project,
  "projects:exportPack": { markdown: "# Northwind" },
  "entitlements:matrix": {
    plan: "growth",
    role: "owner",
    country: "Default",
    addons: [],
    modules: MODULES.map((module, index) => ({
      module,
      label: module,
      state: index < 6 ? "included" : "locked",
    })),
  },
  "billing:currentPlan": { plan: "growth", modules: MODULES.slice(0, 6) },
  "aiModels:listAvailable": [
    { modelId: "e2e-standard", label: "Standard (default)", isDefault: true },
  ],
  "personas:list": [],
  "journeys:list": [],
  "connections:list": [],
  "files:list": [
    {
      _id: "e2e_file_1",
      _creationTime: now,
      projectId: PROJECT_ID,
      storageId: "e2e_storage_1",
      name: "northwind-wholesale-price-list-and-brand-guidelines-autumn-2026-final-v3.pdf",
      mimeType: "application/pdf",
      sizeBytes: 482_113,
    },
  ],
  "content:list": [
    {
      _id: "e2e_content_1",
      _creationTime: now,
      projectId: PROJECT_ID,
      title: "Why we roast to order: a longer-than-usual title for a brief about freshness",
      body: "Draft",
      status: "draft",
    },
  ],
  "communications:list": [
    {
      _id: "e2e_comms_1",
      _creationTime: now,
      projectId: PROJECT_ID,
      name: "Roasted-to-order freshness promise for subscription customers",
      message: "Every bag is roasted within 48 hours of your order, so it tastes the way the farmer intended.",
      audience: "home brewers",
      channels: ["email", "instagram", "website"],
      rationale: "Freshness is the most-cited reason for choosing a local roaster.",
      status: "draft",
    },
  ],
};


test.use({ backendData });

/** Elements that stick out of the viewport sideways, ignoring content that a
 *  clipping or scrolling ancestor keeps inside the screen. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    // Content clipped by an `overflow: hidden|clip` ancestor that is itself on
    // screen is fine (truncation). A scrolling ancestor is not: that is a
    // sideways-scrolling box, reported below.
    const clippedInside = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "hidden" || overflowX === "clip") {
          const box = parent.getBoundingClientRect();
          return box.left >= -1 && box.right <= viewport + 1;
        }
      }
      return false;
    };
    const describe = (element: Element, note = "") => {
      const rect = element.getBoundingClientRect();
      const text = (element.textContent ?? "").trim().slice(0, 40);
      const className = element.getAttribute("class") ?? "";
      return `<${element.tagName.toLowerCase()} class="${className.slice(0, 80)}"> [${Math.round(rect.left)}→${Math.round(rect.right)}]${note} "${text}"`;
    };
    const elements = Array.from(document.body.querySelectorAll("*"));
    const sidewaysScrollers = elements
      .filter((element) => {
        const overflowX = getComputedStyle(element).overflowX;
        return (overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => describe(element, ` scrolls sideways (${element.scrollWidth} > ${element.clientWidth})`));
    const offenders = elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.right <= viewport + 1 && rect.left >= -1) return false;
        return !clippedInside(element);
      })
      .map((element) => describe(element));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewport,
      offenders: [...sidewaysScrollers, ...offenders].slice(0, 12),
    };
  });
}

async function settle(page: Page) {
  // Entrance animations translate content; measure the resting layout.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
}

for (const width of [320, 375, 414]) {
  test(`the project page fits a ${width}px-wide phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/app/${PROJECT_ID}`);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toContainText("Northwind");
    await expect(main.getByRole("heading", { name: "Your modules" })).toBeVisible();
    await expect(main.getByText("Why we roast to order")).toBeVisible();
    await expect(main.getByText(/wholesale-price-list/)).toBeVisible();
    await settle(page);

    const overflow = await horizontalOverflow(page);
    expect(overflow.offenders, overflow.offenders.join("\n")).toEqual([]);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewport);

    // The fixed mobile top bar must not cover the top of the page.
    const bar = await page.locator("div.fixed.top-0").first().boundingBox();
    const header = await main.locator("header").first().boundingBox();
    expect(bar && header && header.y >= bar.y + bar.height).toBeTruthy();

    // Edit project opens as a sheet that also fits the screen.
    await main.getByRole("button", { name: /edit project/i }).first().click();
    const sheet = page.getByRole("dialog", { name: "Edit project" });
    await expect(sheet).toBeVisible();
    for (const tab of ["Your business", "Customers", "Details"]) {
      await sheet.getByRole("tab", { name: tab }).click();
      await expect(sheet.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await settle(page);
      const sheetOverflow = await horizontalOverflow(page);
      expect(sheetOverflow.offenders, `${tab} tab:\n${sheetOverflow.offenders.join("\n")}`).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // "New with AI" opens a dialog that fits the screen.
    await main.getByRole("button", { name: /new with ai/i }).click();
    const dialog = page.getByRole("dialog", { name: /define a marketing communication/i });
    await expect(dialog).toBeVisible();
    await settle(page);
    const dialogOverflow = await horizontalOverflow(page);
    expect(dialogOverflow.offenders, dialogOverflow.offenders.join("\n")).toEqual([]);
  });
}
