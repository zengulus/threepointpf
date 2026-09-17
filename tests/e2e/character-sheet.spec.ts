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
  await expect(page.getByRole("button", { name: /Acrobatics/ })).toContainText("+11");
});

test("N-track advancement editor persists ordered choices and exposes a shared BAB fact", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("advancement-start").click();
  await page.getByTestId("advancement-add-track").click();
  await page.getByLabel("Level 1 track 2 progression").selectOption("pf1e.paizo.wizard");
  await page.getByTestId("advancement-add-level").click();
  await page.getByLabel("Level 2 track 1 progression").selectOption("pf1e.paizo.rogue");
  await page.getByLabel("Level 2 track 2 progression").selectOption("pf1e.paizo.fighter");
  await page.getByLabel("Level 2 track 1 progression").selectOption("pf1e.paizo.wizard");
  await expect(page.getByLabel("Level 2 track 2 progression").locator('option[value="pf1e.paizo.wizard"]')).toBeDisabled();
  await expect(page.getByTestId("progression-level-pf1e.paizo.fighter")).toContainText("Level 2");
  await page.getByTestId("progression-level-pf1e.paizo.fighter").click();
  await expect(page.locator(".breakdown")).toContainText("Fighter level 2");
  await expect(page.getByTestId("stat-bab")).toContainText("+2");
  await page.getByTestId("stat-bab").click();
  await expect(page.locator(".breakdown")).toContainText("Track track-1 BAB");
  await expect(page.locator(".breakdown")).toContainText("Character-global");
  await page.getByRole("button", { name: "Save character" }).click();
  await page.getByLabel("Level 2 track 2 progression").selectOption("pf1e.paizo.rogue");
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByLabel("Level 2 track 2 progression")).toHaveValue("pf1e.paizo.fighter");
  await page.reload();
  await expect(page.getByLabel("Level 2 track 2 progression")).toHaveValue("pf1e.paizo.fighter");
});

test("custom classes, granted effects, equipment and movement survive browser reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".custom-content-panel summary").click();
  await page.getByLabel("Class name", { exact: true }).fill("Star Knight");
  await page.getByLabel("Custom class BAB progression").selectOption("full");
  await page.locator(".check-grid").getByLabel("Spellcraft", { exact: true }).check();
  await page.getByLabel("Custom class feature name").fill("Starlight strength");
  await page.getByLabel("Class feature effect target").selectOption("ability.str");
  await page.getByLabel("Class feature effect value").fill("2");
  await page.getByRole("button", { name: "+ Feature", exact: true }).click();
  await page.getByTestId("custom-class-save").click();
  await page.getByLabel("Experience track", { exact: true }).selectOption("pf1e.autosheet.experience-medium");
  await page.getByLabel("Experience points", { exact: true }).fill("2500");
  await expect(page.getByTestId("experience-level")).toContainText("Eligible level 2");
  await page.getByTestId("advancement-start").click();
  await page.getByLabel("Level 1 track 1 progression").selectOption("homebrew.local.star-knight");
  await expect(page.getByTestId("progression-level-homebrew.local.star-knight")).toContainText("Level 1");
  await page.getByLabel("Spellcraft ranks", { exact: true }).fill("1");
  await expect(page.getByRole("button", { name: /^Spellcraft/ })).toContainText("class");
  await page.getByLabel("Catalog equipment").selectOption("pf1e.autosheet.chain-shirt");
  await page.getByRole("button", { name: "+ Equip selected" }).click();
  await expect(page.getByTestId("stat-ac")).toContainText("16");
  await page.getByLabel("fly base speed").fill("60");
  await page.getByLabel("Catalog feature or condition").selectOption("pf1e.paizo.haste");
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(page.getByTestId("speed-fly")).toContainText("90 ft");
  await page.getByTestId("speed-fly").click();
  await expect(page.locator(".breakdown")).toContainText("Haste");
  await page.getByRole("button", { name: "Save character" }).click();
  await page.reload();
  await expect(page.getByTestId("speed-fly")).toContainText("90 ft");
  await expect(page.getByLabel("Experience points", { exact: true })).toHaveValue("2500");
  await expect(page.getByTestId("progression-level-homebrew.local.star-knight")).toBeVisible();
  await expect(page.getByLabel("Equip Chain Shirt")).toBeChecked();
  expect(errors).toEqual([]);
});

test("invalid custom charts produce a visible error and preserve the prior character", async ({ page }) => {
  await page.goto("/");
  await page.locator(".custom-content-panel summary").click();
  await page.getByLabel("Class name", { exact: true }).fill("Broken Chart");
  await page.getByRole("button", { name: "+ Chart row" }).click();
  await page.getByLabel("Chart row 1 level").fill("2");
  await page.getByTestId("custom-class-save").click();
  await expect(page.getByRole("alert")).toContainText("contiguous");
  await expect(page.getByTestId("stat-bab")).toContainText("+6");
  await expect(page.getByLabel("Class name", { exact: true })).toHaveValue("Broken Chart");
});

test("custom armor and profile-based weapons persist with inspectable numeric effects", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Custom armor, shield or magic item", { exact: true }).click();
  await page.getByLabel("Custom item name", { exact: true }).fill("Rune coat");
  await page.getByLabel("Item bonus", { exact: true }).fill("5");
  await page.getByLabel("Maximum Dexterity (blank = no limit)").fill("0");
  await page.getByLabel("Armor check penalty", { exact: true }).fill("-3");
  await page.getByRole("button", { name: "+ Custom item", exact: true }).click();
  await expect(page.getByTestId("stat-ac")).toContainText("15");
  await expect(page.getByTestId("stat-touch-ac")).toContainText("10");
  await page.getByLabel("Custom equipment name", { exact: true }).fill("Starblade");
  await page.getByLabel("Custom equipment dice", { exact: true }).fill("2d6");
  await page.getByLabel("Custom equipment attack profile", { exact: true }).selectOption("pf1e.autosheet.finesse");
  await page.getByLabel("Weapon enhancement", { exact: true }).fill("2");
  await page.getByRole("button", { name: "+ Custom weapon", exact: true }).click();
  await expect(page.getByTestId("roll-attack-equipment.equipment-starblade-1")).toContainText("+13");
  await page.getByRole("button", { name: "Inspect Starblade damage", exact: true }).click();
  await expect(page.locator(".breakdown")).toContainText("Weapon enhancement");
  await page.getByRole("button", { name: "Save character" }).click();
  await page.reload();
  await expect(page.getByLabel("Equip Rune coat", { exact: true })).toBeChecked();
  await expect(page.getByTestId("roll-attack-equipment.equipment-starblade-1")).toContainText("+13");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("contextual actions expose step roles, exclusions and maneuver plans", async ({ page }) => {
  await page.goto("/");
  // The curated Power Attack declares contextual damage variants; the demo
  // greatsword is two-handed, so the one-handed and off-hand variants are
  // authored but excluded, and that exclusion is visible.
  await page.getByLabel("Catalog feature or condition").selectOption("pf1e.paizo.power-attack");
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(page.getByTestId("roll-attack-greatsword")).toContainText("PRIMARY");
  await page.getByRole("button", { name: "Inspect Greatsword damage" }).click();
  await expect(page.locator(".breakdown")).toContainText("EXCLUDED BY CONTEXT");
  await expect(page.locator(".breakdown")).toContainText(
    "excluded for tags weapon.two-handed, weapon.off-hand",
  );
  await expect(page.getByTestId("roll-standard-greatsword")).toContainText("STANDARD");
  await page.getByTestId("roll-maneuver-trip").click();
  await expect(page.locator(".top-actions")).toContainText("trip maneuver");
  // A roll reports the natural face and the semantic outcome separately, so a
  // threat that could still miss is never shown as a hit.
  await expect(page.locator(".top-actions")).toContainText(/trip maneuver: \d+ [+-]\d+ = \d+ · /);
  await page.getByTestId("roll-standard-greatsword").click();
  await expect(page.locator(".top-actions")).toContainText(
    /standard attack: \d+ [+-]\d+ = \d+ · (unresolved|natural 20|natural 1|criticalSuccess)/,
  );
  // A step's own damage roll is part of the action's roll list, and a plain
  // roll reports its total without inventing an outcome.
  await page.getByTestId("roll-damage-greatsword").click();
  await expect(page.locator(".top-actions")).toContainText(
    /damage: \d+(, \d+)* [+-]\d+ = \d+/,
  );
  await expect(page.locator(".top-actions")).not.toContainText("unresolved");
  await page.getByTestId("roll-initiative").click();
  await expect(page.locator(".top-actions")).toContainText(
    /initiative: \d+ [+-]\d+ = \d+/,
  );
});

test("mobile editors fit the viewport while N-track tables scroll within their panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".custom-content-panel summary").click();
  await page.getByTestId("advancement-start").click();
  await page.getByTestId("advancement-add-track").click();
  await page.getByTestId("advancement-add-track").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByLabel("Class name", { exact: true })).toBeVisible();
});
