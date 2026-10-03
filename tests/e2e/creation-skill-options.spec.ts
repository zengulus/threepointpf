import { expect, test } from "@playwright/test";
import { openDemoSheet } from "./demo-account";
import { maneuverCharacter } from "../fixtures/maneuver-character";

test("creation skill options update budgets, confirm rank resets, and survive reload", async ({ page }) => {
  await openDemoSheet(page);
  await page.getByRole("button", { name: "Create character", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create character" });
  await dialog.getByLabel("Character name", { exact: true }).fill("Skill Options Hero");
  await dialog.getByLabel("Six ability scores in order").fill("15 14 13 12 10 8");
  await dialog.getByRole("button", { name: "Apply scores" }).click();
  await dialog.getByRole("button", { name: "2. Progression" }).click();
  await dialog.getByLabel("Class / progression progression").selectOption("pf1e.paizo.fighter");
  const allocator = dialog.locator(".lifecycle-skill-allocation");
  await expect(allocator).toContainText("Available skill points: 5");
  await dialog.getByLabel("Creation skill variant").selectOption("classic");
  await expect(allocator).toContainText("Available skill points: 3");
  await dialog.getByLabel("Creation minimum 4 + INT skill ranks").check();
  await expect(allocator).toContainText("Available skill points: 5");
  await dialog.getByLabel("Climb ranks for this level", { exact: true }).fill("1");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await dialog.getByLabel("Creation skill variant").selectOption("consolidated");
  await expect(dialog.getByLabel("Creation skill variant")).toHaveValue("classic");
  await expect(dialog.getByLabel("Climb ranks for this level", { exact: true })).toHaveValue("1");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByLabel("Creation skill variant").selectOption("consolidated");
  await expect(allocator).toContainText("ranks assigned: 0");
  await expect(allocator).toContainText("Available skill points: 1");
  await dialog.getByLabel("Creation skill variant").selectOption("classic");
  await dialog.getByRole("button", { name: "4. Review" }).click();
  await expect(dialog).toContainText("Skill variant: Classic Skills · Minimum 4 + INT skill ranks");
  await dialog.getByRole("button", { name: "Create character", exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Skill Options Hero");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(`threepointpf.character.${localStorage.getItem("threepointpf.sheet.character")}`)!));
  expect(saved.workbookOptions).toMatchObject({ skillMode: "classic", backgroundSkills: false, minimumFourPlusIntSkillRanks: true });
  await page.getByRole("button", { name: "Level up", exact: true }).click();
  await page.getByRole("button", { name: "2. Progression" }).click();
  await expect(page.getByRole("dialog", { name: "Level up" })).toContainText("Skill variant: Classic Skills · Minimum 4 + INT skill ranks");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Create character", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(`threepointpf.character.${localStorage.getItem("threepointpf.sheet.character")}`)!))).toEqual(saved);
});

test("retired sample selection falls back while saved personal characters load unchanged", async ({ page }) => {
  const saved = { ...maneuverCharacter, id: "sample-charlie-runecarved-human", name: "My revised character", inventory: { gold: 880000 }, attacks: [{ ...maneuverCharacter.attacks[0], id: "izanamis-nodachi" }], systems: [], abilities: [] };
  await page.addInitScript((character) => {
    localStorage.setItem("threepointpf.sheet.sample", "charlie");
    localStorage.setItem("threepointpf.sheet.character", character.id);
    localStorage.setItem(`threepointpf.character.${character.id}`, JSON.stringify(character));
  }, saved);
  await openDemoSheet(page);
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(saved.name);
  await expect(page.getByTestId("sample-character").locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await expect(page.locator(".sheet-notice")).toContainText("Saved in this browser");
  const loaded = await page.evaluate((id) => JSON.parse(localStorage.getItem(`threepointpf.character.${id}`)!), saved.id);
  expect(loaded.inventory).toEqual(saved.inventory);
  expect(loaded.abilities).toEqual([]);
  expect(loaded.systems).toEqual([]);
  expect(loaded.attacks).toEqual(saved.attacks);
});
