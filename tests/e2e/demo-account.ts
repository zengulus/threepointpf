import { expect, type Page } from "@playwright/test";

/** Each Playwright test gets a fresh browser context and its own local DM. */
export async function openDemoSheet(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create your DM account" }).or(page.getByTestId("character-sheet-view"))).toBeVisible();
  if (await page.getByRole("heading", { name: "Create your DM account" }).isVisible()) {
    await page.getByLabel("Display name").fill("Test DM");
    await page.getByLabel("Username").fill("testdm");
    await page.getByLabel("Password").fill("TestPassword123!");
    await page.getByRole("button", { name: "Create account" }).click();
  }
  await expect(page.getByTestId("character-sheet-view")).toBeVisible();
}
