import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/signed-in-backend";

/**
 * U2d: "Your answers" in Edit project shows the stored first-run answers in
 * the same multi-select tiles as the wizard (first pick is the main one),
 * and stays usable and accessible at 320 px.
 */

const PROJECT_ID = "e2e_answers_project";
const now = Date.UTC(2026, 8, 20);

const project = {
  _id: PROJECT_ID,
  _creationTime: now,
  ownerId: "e2e_user_1",
  name: "Harbour Café",
  businessType: "walk_in",
  otherBusinessTypes: ["online_shop"],
  primaryGoal: "visits",
  otherGoals: ["reviews"],
  postingChannels: ["instagram"],
  customerGroups: ["locals", "tourists"],
  firstRunNotes: { anythingElse: "We close on Mondays." },
};

test.use({
  backendData: {
    "projects:get": project,
    "projects:list": [project],
  },
});

test("Edit project shows the stored answers with the main pick first", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/app/${PROJECT_ID}?edit=understanding`);
  const sheet = page.getByRole("dialog", { name: "Edit project" });
  const answers = sheet.getByRole("region", { name: "Your answers" });
  await expect(answers).toBeVisible();

  const types = answers.getByRole("group", { name: "Kind of business" });
  await expect(types.getByRole("checkbox", { name: /Café, restaurant, bar/ })).toBeChecked();
  await expect(types.getByRole("checkbox", { name: /Online shop/ })).toBeChecked();
  await expect(types.getByText("Main", { exact: true })).toHaveCount(1);

  // Making the other type main moves the badge.
  await types.getByRole("button", { name: /Make main: Online shop/ }).click();
  await expect(types.getByRole("button", { name: /Make main: Café, restaurant, bar/ })).toBeVisible();

  // The agency journey is never offered here.
  await expect(types.getByRole("checkbox", { name: /for a client/i })).toHaveCount(0);

  const customers = answers.getByRole("group", { name: "Who your customers are" });
  await expect(customers.getByRole("checkbox", { name: /Tourists and visitors/ })).toBeChecked();
  await expect(answers.getByRole("textbox", { name: /anything we should know/i })).toHaveValue("We close on Mondays.");
  await expect(answers.getByRole("button", { name: "Save answers" })).toBeVisible();

  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(320);

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
