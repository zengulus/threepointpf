import { test, expect, type Page } from "@playwright/test";

/**
 * The dice overlay is the result surface; it is dismissed before the next click
 * so a long roll sequence keeps exercising the sheet rather than the overlay.
 */
async function dismissDice(page: Page) {
  const overlay = page.getByTestId("dice-overlay");
  if ((await overlay.count()) === 0) return;
  await page.getByTestId("dice-overlay-close").click();
  await expect(overlay).toHaveCount(0);
}

/**
 * Loads a sample character. The demo build opens on the level 1 fighter, so a
 * test that exercises deeper content says so instead of depending on the
 * landing sample.
 */
async function loadSample(page: Page, id: string) {
  await page.getByTestId("sample-character").selectOption(id);
  await expect(page.getByTestId("sample-character")).toHaveValue(id);
}

test("character sheet recomputes toggles and exposes provenance", async ({ page }) => {
  await page.goto("/");
  await loadSample(page, "showcase");
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
  await loadSample(page, "showcase");
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
  await loadSample(page, "showcase");
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
  await loadSample(page, "showcase");
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
  await loadSample(page, "showcase");
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
  await loadSample(page, "showcase");
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
  await dismissDice(page);
  // A roll reports the natural face and the semantic outcome separately, so a
  // threat that could still miss is never shown as a hit.
  await expect(page.locator(".top-actions")).toContainText(/trip maneuver: \d+ [+-]\d+ = \d+ · /);
  await page.getByTestId("roll-standard-greatsword").click();
  await expect(page.locator(".top-actions")).toContainText(
    /standard attack: \d+ [+-]\d+ = \d+ · (unresolved|natural 20|natural 1|criticalSuccess)/,
  );
  await dismissDice(page);
  // A step's own damage roll is part of the action's roll list, and a plain
  // roll reports its total without inventing an outcome.
  await page.getByTestId("roll-damage-greatsword").click();
  await expect(page.locator(".top-actions")).toContainText(
    /damage: \d+(, \d+)* [+-]\d+ = \d+/,
  );
  await expect(page.locator(".top-actions")).not.toContainText("unresolved");
  await dismissDice(page);
  await page.getByTestId("roll-initiative").click();
  await expect(page.locator(".top-actions")).toContainText(
    /initiative: \d+ [+-]\d+ = \d+/,
  );
  await dismissDice(page);
});

test("the demo build opens on the level 1 fighter sample", async ({ page }) => {
  await page.goto("/");
  // No server and no credentials: the build reports demo mode and lands on the
  // sample character rather than an empty sheet.
  await expect(page.getByTestId("sheet-mode")).toHaveText("DEMO");
  await expect(page.getByTestId("sample-character")).toHaveValue("level-1-fighter");
  await expect(page.getByTestId("stat-bab")).toContainText("+1");
  await expect(page.getByTestId("stat-ac")).toContainText("15");
  await expect(page.getByTestId("stat-current-hp")).toContainText("15 / 15");
  await expect(page.getByTestId("stat-cmb")).toContainText("+3");
  await expect(page.getByTestId("stat-cmd")).toContainText("15");
  // Power Attack is on: +4 to hit, and the two-handed greatsword takes the
  // two-handed damage variant while the others are shown as excluded.
  await expect(
    page.getByTestId("roll-standard-equipment.greatsword"),
  ).toContainText("+4");
  await expect(page.getByTestId("roll-damage-equipment.greatsword")).toContainText(
    /2d6\+7/,
  );
  await page.getByRole("button", { name: "Inspect Greatsword damage" }).click();
  await expect(page.locator(".breakdown")).toContainText("EXCLUDED BY CONTEXT");
  await expect(page.locator(".breakdown")).toContainText("Power Attack");
  await expect(page.locator(".breakdown")).toContainText(
    "excluded for tags weapon.two-handed, weapon.off-hand",
  );
  // Saving in demo mode keeps the sheet in this browser and reloads it.
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.locator(".top-actions")).toContainText(
    "Saved in this browser",
  );
  await page.reload();
  await expect(page.getByTestId("stat-ac")).toContainText("15");
  // Switching samples re-derives the whole sheet from different authored state.
  await loadSample(page, "showcase");
  await expect(page.getByTestId("stat-bab")).toContainText("+6");
  await expect(page.getByTestId("roll-standard-greatsword")).toBeVisible();
  await page.getByTestId("sample-reset").click();
  await expect(page.getByTestId("stat-bab")).toContainText("+6");
  await expect(page.locator(".top-actions")).toContainText(
    "Sample loaded: Showcase",
  );
});

test("an optional entered DC resolves a check or leaves it unresolved", async ({ page }) => {
  // This one deliberately runs on the demo build's landing sample.
  await page.goto("/");
  // A skill check has no automatic face rule and no known DC, so nothing is
  // resolved: the face facts are reported and no verdict is invented.
  await page.getByTestId("roll-skill-perception").click();
  await expect(page.locator(".top-actions")).toContainText(
    /Perception check: \d+ [+-]\d+ = \d+ · /,
  );
  await expect(page.locator(".top-actions")).not.toContainText("success");
  await expect(page.locator(".top-actions")).not.toContainText("failure");
  // A skill check has no automatic face rule, so its presentation is the
  // natural-face one rather than a combat critical.
  await expect(page.getByTestId("dice-overlay")).toHaveAttribute(
    "data-event",
    /natural-20|natural-1|none/,
  );
  await dismissDice(page);
  await page.getByTestId("roll-dc-skills").fill("1");
  await page.getByTestId("roll-skill-perception").click();
  // The natural face is reported alongside the outcome, and a natural face is
  // not an automatic verdict on a skill check: a natural 1 against a low DC is
  // still a success, and the notice says both.
  await expect(page.locator(".top-actions")).toContainText(
    /Perception check: \d+ [+-]\d+ = \d+ · (natural \d+ · )?(success|failure)/,
  );
  await expect(page.locator(".top-actions")).not.toContainText("unresolved");
  await dismissDice(page);
  // Saves use the defense field in the defenses panel the same way.
  await page.getByTestId("roll-dc-saves").fill("1");
  await page.getByTestId("roll-fortitude").click();
  await expect(page.locator(".top-actions")).toContainText(
    /fortitude save: \d+ [+-]\d+ = \d+ · /,
  );
  await expect(page.locator(".top-actions")).not.toContainText("unresolved");
  // Saves are combat rolls, so a natural face takes the combat presentation,
  // while anything else takes the ordinary one.
  await expect(page.getByTestId("dice-overlay")).toHaveAttribute(
    "data-event",
    /critical-success|critical-failure|none/,
  );
  await dismissDice(page);
});

test("the dice overlay shows a resolved roll and remembers dice preferences", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await page.getByTestId("roll-standard-greatsword").click();
  const overlay = page.getByTestId("dice-overlay");
  await expect(overlay).toBeVisible();
  // The dice surface reports the resolved roll; the renderer only animates its
  // faces and carries the values on its own dice once they land.
  await expect(page.getByTestId("dice-overlay-label")).toContainText("Greatsword");
  await expect(page.getByTestId("dice-overlay-total")).toContainText("=");
  await expect(page.getByTestId("dice-face-0")).toHaveAttribute(
    "data-natural",
    "true",
  );
  await expect(overlay).toHaveAttribute("data-mode", /rendered|fallback|skipped/);
  await expect(overlay).toHaveAttribute(
    "data-event",
    /critical-success|critical-failure|natural-20|natural-1|none/,
  );
  await expect(page.getByTestId("dice-stage-mode")).toContainText(
    /physics|3D dice|reduced motion|animation/,
  );
  await expect(page.getByTestId("dice-overlay-event")).toContainText("·");
  // The sequence finishes rather than stalling after the values appear: the
  // modifier, the total and the semantic outcome each arrive on the same line.
  // A slow throw is allowed for, and the result's own lifetime only starts once
  // it is on screen.
  await expect(overlay).toHaveAttribute("data-phase", "outcome", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("dice-overlay-total")).toContainText("=");
  await expect(page.getByTestId("dice-overlay-outcome")).toBeVisible();
  await dismissDice(page);

  // Dice preferences persist under their own key and stay out of character state.
  await page.getByTestId("dice-skin").selectOption("arcane");
  await page.getByTestId("dice-flourish-natural-1").selectOption("shards");
  await page.getByTestId("dice-sound").uncheck();
  await page.getByRole("button", { name: "Save character" }).click();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain("threepointpf.dice.presentation");
  const characterBlobs = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("threepointpf.character."))
      .map(([, value]) => value)
      .join(" "),
  );
  expect(characterBlobs).not.toContain("arcane");
  expect(characterBlobs).not.toContain("shards");

  await page.reload();
  await expect(page.getByTestId("dice-skin")).toHaveValue("arcane");
  await expect(page.getByTestId("dice-flourish-natural-1")).toHaveValue("shards");
  await expect(page.getByTestId("dice-sound")).not.toBeChecked();
  await expect(page.getByTestId("dice-overlay")).toHaveCount(0);

  // Reduced motion still shows the authoritative result, just without a throw.
  await page.getByTestId("dice-reduced-motion").check();
  await page.getByTestId("roll-standard-greatsword").click();
  await expect(page.getByTestId("dice-stage-mode")).toContainText("reduced motion");
  await expect(overlay).toHaveAttribute("data-mode", "skipped");
  await expect(page.getByTestId("dice-overlay-total")).toContainText("=");
  // The same sequence is shown directly: the rolled values, the arithmetic and
  // the semantic outcome, with no movement to wait through.
  await expect(overlay).toHaveAttribute("data-phase", "settled");
  await expect(page.getByTestId("dice-face-0")).toContainText(/\d+/);
  await expect(page.getByTestId("dice-overlay-outcome")).toBeVisible();
  await dismissDice(page);
});

test("the landed values leave the dice inside the renderer's own scene", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await page.getByTestId("roll-standard-greatsword").click();
  const overlay = page.getByTestId("dice-overlay");
  await expect(overlay).toHaveAttribute("data-phase", "pending");
  // The beats are recorded by observation rather than by polling for them: a
  // beat can be short, and the assertions below are not instantaneous.
  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="dice-overlay"]')!;
    const seen = [element.getAttribute("data-phase")];
    (window as unknown as { __phases: (string | null)[] }).__phases = seen;
    new MutationObserver(() => {
      const phase = element.getAttribute("data-phase");
      if (seen.at(-1) !== phase) seen.push(phase);
    }).observe(element, { attributes: true, attributeFilter: ["data-phase"] });
  });

  // This is the animated path: physical faces get a reading beat before a
  // value rises from each die.
  await expect(overlay).toHaveAttribute("data-mode", "rendered", {
    timeout: 20_000,
  });
  await expect(overlay).toHaveAttribute("data-phase", "landed", {
    timeout: 20_000,
  });
  await expect(overlay).toHaveAttribute("data-phase", "scene", {
    timeout: 20_000,
  });
  // While the values ride their dice there is nothing to read in the document:
  // the numbers on screen are the renderer's, not a panel's.
  await expect(page.getByTestId("dice-face-0")).toHaveAttribute(
    "data-revealed",
    "false",
  );
  await expect(page.getByTestId("dice-overlay-total")).toHaveAttribute(
    "data-revealed",
    "false",
  );
  // And the scene really is what is moving: the canvas changes while the
  // die-local phase runs. The samples stop at the first pair that differ, so
  // they stay inside the phase however slow a screenshot turns out to be.
  const stage = page.getByTestId("dice-stage");
  let previous = await stage.screenshot();
  let moved = false;
  for (let sample = 0; sample < 4 && !moved; sample += 1) {
    await page.waitForTimeout(250);
    const next = await stage.screenshot();
    moved = Buffer.compare(previous, next) !== 0;
    previous = next;
  }
  expect(moved).toBe(true);

  // The handoff then reveals the same authoritative values in the arithmetic.
  await expect(overlay).toHaveAttribute("data-phase", "outcome", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("dice-face-0")).toHaveAttribute(
    "data-revealed",
    "true",
  );
  await expect(page.getByTestId("dice-overlay-total")).toContainText("=");
  const phases = await page.evaluate(
    () => (window as unknown as { __phases: (string | null)[] }).__phases,
  );
  expect(phases.indexOf("landed")).toBeLessThan(phases.indexOf("scene"));
  expect(phases.indexOf("scene")).toBeLessThan(phases.indexOf("values"));
  expect(phases.indexOf("values")).toBeLessThan(phases.indexOf("outcome"));
  expect(phases).toContain("pending");
  await dismissDice(page);
});

test("mobile editors fit the viewport while N-track tables scroll within their panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await loadSample(page, "showcase");
  await page.locator(".custom-content-panel summary").click();
  await page.getByTestId("advancement-start").click();
  await page.getByTestId("advancement-add-track").click();
  await page.getByTestId("advancement-add-track").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByLabel("Class name", { exact: true })).toBeVisible();
});
