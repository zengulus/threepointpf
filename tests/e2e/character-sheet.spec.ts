import { test, expect } from "@playwright/test";

test("character sheet recomputes toggles and exposes provenance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stat-ac")).toContainText("12");
  await expect(page.getByTestId("stat-max-hp")).toContainText("52");
  await expect(page.getByTestId("stat-current-hp")).toContainText("47 / 52");
  await expect(page.getByTestId("roll-attack-greatsword")).toBeVisible();
  await page.getByRole("button", { name: "Toggle Rage" }).click();
  await expect(page.getByTestId("stat-ac")).toContainText("10");
  await expect(page.getByTestId("stat-current-hp")).toContainText("49 / 54");
  await page.getByTestId("stat-ac").click();
  await expect(page.locator(".breakdown")).toContainText("Base AC");
  await expect(page.locator(".breakdown")).toContainText("Rage");
  await page.getByLabel("Acrobatics ranks").fill("4");
  await expect(page.getByRole("button", { name: /Acrobatics/ })).toContainText("+9");
});

test("N-track advancement editor persists ordered choices and exposes a shared BAB fact", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("advancement-start").click();
  await page.getByTestId("advancement-add-track").click();
  await page.getByTestId("advancement-add-level").click();
  await page.getByLabel("Level 2 track 2 progression").selectOption("wizard");
  await expect(page.getByTestId("progression-level-fighter")).toContainText("Level 3");
  await page.getByTestId("progression-level-fighter").click();
  await expect(page.locator(".breakdown")).toContainText("Fighter level 3");
  await expect(page.getByTestId("stat-bab")).toContainText("+2");
  await page.getByTestId("stat-bab").click();
  await expect(page.locator(".breakdown")).toContainText("Track track-1 BAB");
  await expect(page.locator(".breakdown")).toContainText("Character-global");
  await page.getByRole("button", { name: "Save character" }).click();
  await page.getByLabel("Level 2 track 2 progression").selectOption("rogue");
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByLabel("Level 2 track 2 progression")).toHaveValue("wizard");
});
