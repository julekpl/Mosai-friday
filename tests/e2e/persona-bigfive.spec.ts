import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * Big Five honesty: a persona's AI personality scores are labelled "AI guess,
 * not measured" with a short explanation, a trait the AI did not give shows
 * as unknown (never 50), and the owner can edit or clear the scores.
 */

const PROJECT_ID = "e2e_bigfive_project";
const now = Date.UTC(2026, 8, 20);

const project = {
  _id: PROJECT_ID,
  _creationTime: now,
  ownerId: "e2e_user_1",
  name: "Studio Forma",
};

// Saved before the source existed: treated as an AI guess.
const aiPersona = {
  _id: "e2e_persona_ai",
  _creationTime: now,
  projectId: PROJECT_ID,
  name: "Anna, homeowner",
  role: "Homeowner planning an extension",
  bigFive: { openness: 72 },
  createdBy: "e2e_user_1",
  createdAt: now,
};

const ownPersona = {
  _id: "e2e_persona_own",
  _creationTime: now,
  projectId: PROJECT_ID,
  name: "Ben, landlord",
  bigFive: { conscientiousness: 80 },
  bigFiveSource: "user_assessed",
  createdBy: "e2e_user_1",
  createdAt: now,
};

const MODULES = ["understand", "journeys", "create", "build", "customers", "promote", "sell", "grow"];

test.use({
  backendData: {
    "users:currentUser": { _id: "e2e_user_1", _creationTime: now, name: "Ada", email: "ada@example.com" },
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
    "personas:list": [aiPersona, ownPersona],
    "personas:get": aiPersona,
    "journeys:list": [],
  },
});

test("AI personality scores are labelled as a guess and can be cleared", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/app/${PROJECT_ID}/understand`);

  const cards = page.getByTestId("persona-bigfive");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Big Five (AI guess, not measured): Openness 72 / 100");
  await expect(cards.nth(0)).toContainText("Nobody measured them with real customers");
  // A trait the AI did not give is not shown as a made-up 50.
  await expect(cards.nth(0)).not.toContainText("50");
  await expect(cards.nth(1)).toContainText("Your own estimate");
  await expect(cards.nth(1)).not.toContainText("Nobody measured");

  await page.getByRole("button", { name: "Edit Anna, homeowner" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit persona" });
  await dialog.getByText("Advanced personality (Big Five, optional)").click();
  await expect(dialog.getByTestId("persona-bigfive-source")).toContainText("AI guess, not measured");
  await expect(dialog.getByLabel("Openness (0–100)")).toHaveValue("72");
  await expect(dialog.getByLabel("Extraversion (0–100)")).toHaveValue("");

  // Editing marks the scores as the owner's own estimate.
  await dialog.getByLabel("Extraversion (0–100)").fill("40");
  await expect(dialog.getByTestId("persona-bigfive-source")).toContainText("Your own estimate");

  await dialog.getByRole("button", { name: "Clear personality scores" }).click();
  await expect(dialog.getByLabel("Openness (0–100)")).toHaveValue("");
  await expect(dialog.getByTestId("persona-bigfive-source")).toHaveCount(0);

  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(320);

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
