import { expect, test } from "@playwright/test";

test("create gestalt, manage HP, level up transactionally, and export/import as a copy", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("lifecycle-test-started")) {
      localStorage.clear();
      sessionStorage.setItem("lifecycle-test-started", "yes");
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create character" }).click();
  const dialog = page.getByRole("dialog", { name: "Create character" });
  await dialog.getByLabel("Character name").fill("Gestalt Ogre");
  await page.getByLabel("Advancement tracks").selectOption("2");
  for (const [ability, score] of Object.entries({ Strength: "16", Dexterity: "12", Constitution: "14", Intelligence: "10", Wisdom: "10", Charisma: "8" }))
    await page.getByLabel(ability, { exact: true }).fill(score);
  await page.getByRole("button", { name: "2. Progression" }).click();
  await dialog.getByLabel("Custom progression name").fill("Ogre Troll");
  await dialog.getByLabel("Custom progression hit die").selectOption("12");
  await dialog.getByLabel("Custom feature name").fill("Regeneration");
  await dialog.getByLabel("Custom feature choice prompt").fill("Choose an adaptation");
  await dialog.getByLabel("Custom feature choice options").fill("Cold resistant hide, Swift hide");
  await page.getByLabel("Track A progression").selectOption("pf1e.paizo.fighter");
  await page.getByLabel("Track B progression").selectOption("homebrew.local.ogre-troll");
  await page.getByRole("button", { name: "3. Choices" }).click();
  await page.getByLabel("Choose an adaptation", { exact: true }).selectOption("cold-resistant-hide");
  await page.getByRole("button", { name: "4. Review" }).click();
  await expect(page.getByText(/Gestalt Ogre · 2-track · level 1/)).toBeVisible();
  await page.getByRole("button", { name: "Create character", exact: true }).last().click();
  await expect(page.getByLabel("Character name")).toHaveValue("Gestalt Ogre");
  await expect(page.locator(".level-summary > span")).toHaveText("Level 1");

  await page.getByLabel("Set temporary HP").fill("8");
  await page.getByRole("button", { name: "Set temp HP" }).click();
  await page.getByLabel("Damage amount").fill("12");
  await page.getByRole("button", { name: "Apply damage" }).click();
  await expect(page.locator(".health-management")).toContainText("Temporary HP0");
  await expect(page.locator(".health-management")).toContainText("Damage taken4");
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.locator(".sheet-notice")).toContainText("Saved in this browser");
  await page.reload();
  await expect(page.locator(".health-management")).toContainText("Damage taken4");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export character" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Import character file").setInputFiles(path!);
  await expect(page.getByLabel("Character name")).toHaveValue("Gestalt Ogre");
  await expect(page.locator(".health-management")).toContainText("Damage taken4");

  await page.getByRole("button", { name: "Level up" }).click();
  await page.getByRole("button", { name: "2. Progression" }).click();
  await page.getByLabel("Track A progression").selectOption("pf1e.paizo.wizard");
  await page.getByLabel("Track B progression").selectOption("homebrew.local.ogre-troll");
  await page.getByLabel("HP gained").fill("6");
  await page.getByRole("button", { name: "4. Review" }).click();
  await page.getByRole("button", { name: "Confirm level up" }).click();
  await expect(page.locator(".level-summary > span")).toHaveText("Level 2");
  await expect(page.locator(".health-management")).toContainText("Damage taken4");
  expect(pageErrors).toEqual([]);
});

test("canceling creation and level-up leaves saved characters unchanged", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("lifecycle-cancel-test-started")) {
      localStorage.clear();
      sessionStorage.setItem("lifecycle-cancel-test-started", "yes");
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.locator(".sheet-notice")).toContainText("Saved in this browser");
  const baseline = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith("threepointpf.character."));
    return entry?.[1] ?? null;
  });
  expect(baseline).toBeTruthy();

  await page.getByRole("button", { name: "Level up" }).click();
  const levelUp = page.getByRole("dialog", { name: "Level up" });
  await levelUp.getByRole("button", { name: "2. Progression" }).click();
  await levelUp.getByLabel("Class / progression progression").selectOption("pf1e.paizo.fighter");
  await levelUp.getByLabel("HP gained").fill("6");
  await levelUp.getByRole("button", { name: "4. Review" }).click();
  await levelUp.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".level-summary > span")).toHaveText("Level 1");
  expect(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("threepointpf.character."))?.[1] ?? null)).toBe(baseline);

  await page.getByRole("button", { name: "Create character" }).click();
  const creation = page.getByRole("dialog", { name: "Create character" });
  await creation.getByLabel("Character name").fill("Abandoned draft");
  await creation.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Character name")).toHaveValue("Level 1 Fighter");
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("threepointpf.character.")).map(([key]) => key))).toHaveLength(1);
});
