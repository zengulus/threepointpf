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
  await expect(page.getByTestId("dice-overlay-label")).toContainText(
    "Greatsword standard attack",
  );
  await expect(page.getByTestId("dice-overlay-target")).toContainText(
    "unresolved",
  );
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
