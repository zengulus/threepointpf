import { expect, test } from "@playwright/test";
import { openDemoSheet } from "./demo-account";

import { choiceIsolationCharacter as character } from "../fixtures/lifecycle-choice-character";

async function openChoices(page: Parameters<typeof openDemoSheet>[0]) {
  await page.getByRole("button", { name: "Level up", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Level up" });
  await dialog.getByRole("button", { name: "2. Progression" }).click();
  await dialog.getByLabel("HP gained", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "3. Choices" }).click();
  return dialog;
}

test("same-named requirements stay isolated, survive revisits and persist", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((fixture) => {
    if (!localStorage.getItem(`threepointpf.character.${fixture.id}`)) localStorage.setItem(`threepointpf.character.${fixture.id}`, JSON.stringify(fixture));
    localStorage.setItem("threepointpf.sheet.character", fixture.id);
  }, character);
  await openDemoSheet(page);
  const dialog = await openChoices(page);
  await dialog.getByLabel("First element", { exact: true }).selectOption("fire");
  await dialog.getByLabel("Second element", { exact: true }).selectOption("ice");
  await dialog.getByLabel("Specialization element", { exact: true }).selectOption("ice");
  await dialog.getByLabel("Custom answer for Other track element", { exact: true }).fill("Storm");
  await expect(dialog.getByLabel("Custom answer for First element", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("First element", { exact: true })).toHaveValue("fire");
  await expect(dialog.getByLabel("Specialization element", { exact: true })).toHaveValue("ice");
  await dialog.getByLabel("First element", { exact: true }).selectOption("");
  await expect(dialog.getByLabel("Specialization element", { exact: true })).toHaveValue("ice");
  await dialog.getByLabel("First element", { exact: true }).selectOption("fire");
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByLabel("Second element", { exact: true })).toHaveValue("ice");
  await expect(dialog.getByLabel("Custom answer for Other track element", { exact: true })).toHaveValue("Storm");
  await page.screenshot({ path: "test-results/lifecycle-choice-isolation.png", fullPage: true });
  await dialog.getByRole("button", { name: "4. Review" }).click();
  await dialog.getByLabel("Reason for custom-choice-requires-table-confirmation").fill("Approved for this test table");
  await dialog.getByRole("button", { name: "Accept this warning" }).click();
  await expect(dialog.getByRole("button", { name: "Confirm level up" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Confirm level up" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`threepointpf.character.${id}`)!), character.id);
  expect(saved.advancementSlots).toHaveLength(2);
  expect(saved.lifecycle.choiceSelections).toHaveLength(5);
  expect(saved.lifecycle.choiceSelections[0]).toEqual(character.lifecycle!.choiceSelections![0]);
  expect(new Set(saved.lifecycle.choiceSelections.map((selection: { id: string }) => selection.id)).size).toBe(5);
  expect(saved.lifecycle.choiceSelections.map((selection: { optionIds: string[] }) => selection.optionIds)).toEqual([["ice"], ["ice"], ["ice"], [], ["fire"]]);
  expect(errors).toEqual([]);
});

test("canceling a partial choice draft leaves saved character untouched and reopens blank", async ({ page }) => {
  await page.addInitScript((fixture) => { localStorage.setItem(`threepointpf.character.${fixture.id}`, JSON.stringify(fixture)); localStorage.setItem("threepointpf.sheet.character", fixture.id); }, character);
  await openDemoSheet(page);
  let dialog = await openChoices(page);
  await dialog.getByLabel("Custom answer for First element", { exact: true }).fill("Abandoned");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`threepointpf.character.${id}`)!), character.id);
  expect(saved).toEqual(character);
  dialog = await openChoices(page);
  await expect(dialog.getByLabel("Custom answer for First element", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Custom answer for Other track element", { exact: true })).toHaveValue("");
});
