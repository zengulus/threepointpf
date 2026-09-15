import { test, expect } from "@playwright/test";

test("character sheet recomputes toggles and exposes provenance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stat-ac")).toContainText("12");
  await expect(page.getByTestId("stat-max-hp")).toContainText("52");
  await expect(page.getByTestId("roll-attack-greatsword")).toBeVisible();
  await page.getByRole("button", { name: "Toggle Rage" }).click();
  await expect(page.getByTestId("stat-ac")).toContainText("10");
  await page.getByTestId("stat-ac").click();
  await expect(page.locator(".breakdown")).toContainText("Base AC");
  await expect(page.locator(".breakdown")).toContainText("Rage");
  await page.getByLabel("Acrobatics ranks").fill("4");
  await expect(page.getByRole("button", { name: /Acrobatics/ })).toContainText("+9");
});
