import { expect, test, type Page } from "@playwright/test";

async function selectTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function loadShowcase(page: Page) {
  await selectTab(page, "Summary");
  await page.getByTestId("sample-character").selectOption("showcase");
  await expect(page.getByTestId("sample-character")).toHaveValue("showcase");
}

async function dismissDice(page: Page) {
  const overlay = page.getByTestId("dice-overlay");
  if ((await overlay.count()) > 0) {
    await page.getByTestId("dice-overlay-close").click();
    await expect(overlay).toHaveCount(0);
  }
}

test("all sheet pages are reachable and Settings preserves the active sheet", async ({
  page,
}) => {
  await page.goto("/");
  for (const tab of [
    "Summary",
    "Attributes",
    "Combat",
    "Inventory",
    "Features",
    "Spells",
    "Skills",
    "Advancement",
    "Notes",
    "Settings",
  ]) {
    await selectTab(page, tab);
    await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible();
  }
  await selectTab(page, "Summary");
  await page.getByLabel("Character name").fill("Settings Return Hero");
  await selectTab(page, "Settings");
  await expect(page.getByRole("heading", { name: "Dice and table integrations" })).toBeVisible();
  await selectTab(page, "Summary");
  await expect(page.getByLabel("Character name")).toHaveValue("Settings Return Hero");
});

test("spontaneous spell casts use and persist source-owned slots", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await selectTab(page, "Spells");
  await page.getByRole("textbox", { name: "Source name", exact: true }).fill("Arcane E2E");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Name", { exact: true }).last().fill("E2E Bolt");
  await page.getByRole("button", { name: "Add custom spell" }).click();
  await page.getByLabel("Add spell to Arcane E2E").selectOption("local.e2e-bolt");
  await page.getByRole("button", { name: "Learn spell" }).click();
  await page.getByRole("button", { name: "Cast", exact: true }).click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText("E2E Bolt");
  await dismissDice(page);
  await expect(page.getByText("1", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.locator(".sheet-notice")).toContainText("Saved in this browser");
  await page.reload();
  await selectTab(page, "Spells");
  await expect(page.getByRole("heading", { name: "Arcane E2E" })).toBeVisible();
  const firstLevelSlots = page.locator(".spell-slot-table tr").filter({ has: page.getByRole("rowheader", { name: "1", exact: true }) });
  await expect(firstLevelSlots.getByRole("cell").last()).toHaveText("0");
});

test("prepared spell allocations expend independently and refresh with their source", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await selectTab(page, "Spells");
  await page.getByRole("textbox", { name: "Source name", exact: true }).fill("Prepared E2E");
  await page.getByRole("combobox", { name: "Mode", exact: true }).selectOption("prepared");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Name", { exact: true }).last().fill("Prepared Bolt");
  await page.getByRole("button", { name: "Add custom spell" }).click();
  await page.getByLabel("Add spell to Prepared E2E").selectOption("local.prepared-bolt");
  await page.getByRole("button", { name: "Add to spellbook" }).click();
  await page.getByRole("button", { name: "Prepare first spellbook entry" }).click();
  await page.getByRole("button", { name: "Cast prepared" }).click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText("Prepared Bolt");
  await dismissDice(page);
  const source = page.locator(".spell-source").filter({ hasText: "Prepared E2E" });
  await expect(source.getByText("Expended: 1")).toBeVisible();
  await expect(source.getByRole("button", { name: "Cast prepared" })).toHaveCount(0);
  await source.getByRole("button", { name: "Refresh slots and preparations" }).click();
  await expect(source.getByRole("button", { name: "Cast prepared" })).toBeVisible();
});

test("two spontaneous sources keep their own spell slots", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await selectTab(page, "Spells");
  await page.getByRole("textbox", { name: "Source name", exact: true }).fill("Arcane Source A");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Name", { exact: true }).last().fill("Shared Bolt");
  await page.getByRole("button", { name: "Add custom spell" }).click();
  await page.getByLabel("Add spell to Arcane Source A").selectOption("local.shared-bolt");
  await page.getByRole("button", { name: "Learn spell" }).click();
  await page.getByRole("textbox", { name: "Source name", exact: true }).fill("Arcane Source B");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Add spell to Arcane Source B").selectOption("local.shared-bolt");
  await page.locator(".spell-source").filter({ hasText: "Arcane Source B" }).getByRole("button", { name: "Learn spell" }).click();
  const first = page.locator(".spell-source").filter({ hasText: "Arcane Source A" });
  const second = page.locator(".spell-source").filter({ hasText: "Arcane Source B" });
  await first.getByRole("button", { name: "Cast", exact: true }).click();
  await dismissDice(page);
  const secondLevelOne = second.locator(".spell-slot-table tr").filter({ has: page.getByRole("rowheader", { name: "1", exact: true }) });
  await expect(secondLevelOne.getByRole("cell").last()).toHaveText("1");
  await second.getByRole("button", { name: "Cast", exact: true }).click();
  await dismissDice(page);
  const firstLevelOne = first.locator(".spell-slot-table tr").filter({ has: page.getByRole("rowheader", { name: "1", exact: true }) });
  await expect(firstLevelOne.getByRole("cell").last()).toHaveText("0");
});

test("Summary and Combat use paired action plans for ordinary weapon play", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await loadShowcase(page);

  const summaryAttack = page.getByTestId(
    "roll-summary-greatsword-standardAttack-attack-0",
  );
  const summaryDamage = page.getByTestId(
    "roll-summary-greatsword-standardAttack-damage-0",
  );
  await expect(summaryAttack).toBeVisible();
  await expect(summaryDamage).toBeVisible();
  const summaryDamageText = await summaryDamage.innerText();

  await summaryAttack.click();
  await expect(page.getByTestId("roll-target-prompt")).toBeVisible();
  await expect(page.getByTestId("dice-overlay")).toHaveCount(0);
  const targetInput = page.getByTestId("roll-target-prompt-input");
  const resolveTarget = page.getByRole("button", { name: "Roll vs Target AC" });
  await expect(targetInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(resolveTarget).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Roll without a target" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(targetInput).toBeFocused();
  await targetInput.fill("10");
  await resolveTarget.click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText(
    "Greatsword standard attack",
  );
  await expect(page.getByTestId("dice-overlay-target")).toContainText("vs AC 10");
  await expect(page.getByTestId("dice-overlay-close")).toBeFocused();
  await dismissDice(page);

  await summaryDamage.click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText(
    "Greatsword damage",
  );
  await expect(page.locator(".dice-topbar .eyebrow")).toContainText(
    "damage · standardAttack",
  );
  await dismissDice(page);

  // A multi-level fighter has an iterative full-attack step, and Summary keeps
  // both its attack and damage reachable without sending the player elsewhere.
  const iterativeAttack = page.getByTestId(
    "roll-summary-greatsword-fullAttack-attack-1",
  );
  const iterativeDamage = page.getByTestId(
    "roll-summary-greatsword-fullAttack-damage-1",
  );
  await expect(iterativeAttack).toBeVisible();
  await expect(iterativeDamage).toBeVisible();
  await iterativeDamage.click();
  await expect(page.locator(".dice-topbar .eyebrow")).toContainText(
    "damage · fullAttack",
  );
  await dismissDice(page);

  await selectTab(page, "Combat");
  const detailedDamage = page.getByTestId("roll-standard-damage-greatsword");
  expect((await detailedDamage.innerText()).toLowerCase()).toBe(
    summaryDamageText.toLowerCase(),
  );
  await detailedDamage.click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText(
    "Greatsword damage",
  );
  await expect(page.locator(".dice-topbar .eyebrow")).toContainText(
    "damage · standardAttack",
  );
  await dismissDice(page);

  const before = await page.getByTestId("roll-standard-greatsword").innerText();
  await selectTab(page, "Attributes");
  await page.getByLabel("Strength base score", { exact: true }).fill("20");
  await selectTab(page, "Combat");
  await expect(page.getByTestId("roll-standard-greatsword")).not.toHaveText(before);
});

test("initiative, saves, skills, target defenses and every modeled maneuver stay playable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await loadShowcase(page);

  await page.getByLabel("Roll initiative").click();
  await expect(page.getByTestId("dice-overlay-label")).toHaveText("Initiative");
  await expect(page.locator(".dice-topbar .eyebrow")).toContainText(
    "Nathan's Character",
  );
  await dismissDice(page);
  await page.getByTestId("roll-dc-summary").fill("10");
  for (const save of ["fortitude", "reflex", "will"]) {
    await page.getByLabel(`Roll ${save} save`).click();
    await expect(page.getByTestId("dice-overlay-label")).toContainText(
      `${save[0]!.toUpperCase()}${save.slice(1)} save`,
    );
    await dismissDice(page);
  }

  await selectTab(page, "Skills");
  const ranks = page.getByLabel("Acrobatics ranks");
  const before = await page.getByRole("button", { name: /^Acrobatics/ }).innerText();
  await ranks.fill("5");
  await expect(page.getByRole("button", { name: /^Acrobatics/ })).not.toHaveText(before);
  await page.getByTestId("roll-dc-skills").fill("15");
  await page.getByTestId("roll-skill-acrobatics").click();
  await expect(page.getByTestId("dice-overlay-target")).toContainText("vs DC 15");
  await dismissDice(page);

  await selectTab(page, "Combat");
  await page.getByTestId("roll-ac-attacks").fill("10");
  await page.getByTestId("roll-standard-greatsword").click();
  await expect(page.getByTestId("dice-overlay-target")).toContainText("vs AC 10");
  await dismissDice(page);
  await page.getByTestId("roll-cmd-maneuvers").fill("10");
  for (const maneuver of [
    "trip",
    "disarm",
    "bull-rush",
    "grapple",
    "sunder",
    "dirty-trick",
    "drag",
    "overrun",
    "reposition",
    "steal",
  ]) {
    await page.getByTestId(`roll-maneuver-${maneuver}`).click();
    await expect(page.getByTestId("dice-overlay-target")).toContainText("vs CMD 10");
    await dismissDice(page);
  }
});

test("a completed critical attack offers its engine-authored critical damage plan", async ({
  page,
}) => {
  // BrowserDiceProvider remains random in production. This test only replaces
  // the browser entropy source before app startup, producing a deterministic
  // natural 20 without changing application code or rule resolution.
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        values.fill(19); // 19 % 20 + 1 = 20
        return values;
      },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await loadShowcase(page);
  await page.getByTestId("roll-ac-summary").fill("10");
  await page.getByTestId("roll-summary-greatsword-standardAttack-attack-0").click();
  await expect(page.getByTestId("dice-overlay")).toHaveAttribute(
    "data-outcome",
    "criticalSuccess",
  );
  await dismissDice(page);

  const criticalDamage = page.getByTestId(
    "roll-summary-greatsword-standardAttack-critical-damage-0",
  );
  await expect(criticalDamage).toContainText("CRIT DMG ×2");
  await criticalDamage.click();
  await expect(page.getByTestId("dice-overlay-label")).toContainText(
    "critical ×2",
  );
  await expect(page.locator('[data-testid^="dice-face-"]')).toHaveCount(4);
});

test("Settings persist the browser-local dark theme without changing a sheet", async ({
  page,
}) => {
  await page.goto("/");
  await selectTab(page, "Settings");
  await page.getByTestId("theme-preference").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Dice & flourishes" })).toBeVisible();
  const characterBlobs = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("threepointpf.character."))
      .map(([, value]) => value)
      .join(" "),
  );
  expect(characterBlobs).not.toContain("\"dark\"");
  await page.reload();
  await selectTab(page, "Settings");
  await expect(page.getByTestId("theme-preference")).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
