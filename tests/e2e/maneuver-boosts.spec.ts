import { expect, test, type Page } from "@playwright/test";
import { openDemoSheet } from "./demo-account";
import { maneuverCharacter } from "../fixtures/maneuver-character";

const characterKey = "threepointpf.character.test-maneuver-character";
const boostId = "test-boost";
const boostCard = (page: Page) => page.locator(".system-entry-card").filter({ has: page.locator(".system-entry-title b", { hasText: /^Test boost$/ }) });
async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}
async function openManeuverCharacter(page: Page) {
  await page.addInitScript((character) => {
    if (!localStorage.getItem(`threepointpf.character.${character.id}`)) localStorage.setItem(`threepointpf.character.${character.id}`, JSON.stringify(character));
    localStorage.setItem("threepointpf.sheet.character", character.id);
  }, maneuverCharacter);
  await openDemoSheet(page);
  await tab(page, "Spells");
  await expect(boostCard(page)).toBeVisible();
}
async function saveState(page: Page) {
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.locator(".sheet-notice")).toContainText("Saved in this browser");
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), characterKey);
}

for (const control of ["Use", "Active effect"] as const) {
  test(`${control} atomically activates a boost, persists it, and cannot bypass recovery`, async ({ page }) => {
    await openManeuverCharacter(page);
    const card = boostCard(page);
    await expect(card.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeDisabled();
    await card.getByRole("checkbox", { name: "Readied", exact: true }).check();
    if (control === "Use") {
      // Two synchronous clicks exercise the controller's current-state guard,
      // rather than relying only on the next React render disabling the button.
      await card.getByRole("button", { name: "Use", exact: true }).evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
    } else {
      await card.getByRole("checkbox", { name: "Active effect" }).check();
    }
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeChecked();
    await expect(card.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    const activated = await saveState(page);
    const entry = activated.systems[0].entries.find((item: { id: string }) => item.id === boostId);
    expect(entry).toMatchObject({ active: true, expended: true, usesSpent: 1 });
    expect(activated.turnActions).toEqual({ swiftSpent: true });
    await page.reload();
    await tab(page, "Spells");
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeChecked();
    await card.getByRole("checkbox", { name: "Active effect" }).uncheck();
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    const ended = await saveState(page);
    expect(ended.systems[0].entries.find((item: { id: string }) => item.id === boostId)).toMatchObject({ active: false, expended: true, usesSpent: 1 });
    expect(ended.turnActions).toEqual({ swiftSpent: true });
    await tab(page, "Summary");
    await page.getByRole("button", { name: "Start new turn" }).click();
    await tab(page, "Spells");
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeDisabled();
    await card.getByRole("button", { name: "Restore one use of Test boost" }).click();
    await card.getByRole("button", { name: "Use", exact: true }).click();
    await expect(card.getByRole("checkbox", { name: "Active effect" })).toBeChecked();
  });
}

test("a spent swift action blocks both boost controls and stance switching remains exclusive", async ({ page }) => {
  await openManeuverCharacter(page);
  const aura = page.locator(".system-entry-card").filter({ has: page.locator(".system-entry-title b", { hasText: /^Test stance one$/ }) });
  const glare = page.locator(".system-entry-card").filter({ has: page.locator(".system-entry-title b", { hasText: /^Test stance two$/ }) });
  await aura.getByRole("checkbox", { name: "Active stance" }).check();
  const card = boostCard(page);
  await card.getByRole("checkbox", { name: "Readied", exact: true }).check();
  const before = await saveState(page);
  await card.getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already spent");
  await card.getByRole("checkbox", { name: "Active effect" }).click();
  await expect(page.getByRole("alert")).toContainText("already spent");
  await expect(card.getByRole("checkbox", { name: "Active effect" })).not.toBeChecked();
  expect(await saveState(page)).toEqual(before);
  await tab(page, "Summary");
  await page.getByRole("button", { name: "Start new turn" }).click();
  await tab(page, "Spells");
  await glare.getByRole("checkbox", { name: "Active stance" }).check();
  await expect(glare.getByRole("checkbox", { name: "Active stance" })).toBeChecked();
  await expect(aura.getByRole("checkbox", { name: "Active stance" })).not.toBeChecked();
  const switched = await saveState(page);
  expect(switched.systems[0].entries.filter((entry: { category?: string }) => entry.category === "Stance").every((entry: { expended?: boolean }) => entry.expended === false)).toBe(true);
});
