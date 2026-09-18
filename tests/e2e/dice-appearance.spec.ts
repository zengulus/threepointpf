import { test, expect, type Page } from "@playwright/test";

/**
 * The dice appearance is applied inside the renderer's own Three.js scene, so it
 * cannot be proved with a mock: these tests read the composited pixels of the
 * dice stage while a throw is on screen. Everything else about the roll is
 * covered in `character-sheet.spec.ts`.
 */

async function loadSample(page: Page, id: string) {
  await page.getByTestId("sample-character").selectOption(id);
  await expect(page.getByTestId("sample-character")).toHaveValue(id);
}

async function dismissDice(page: Page) {
  const overlay = page.getByTestId("dice-overlay");
  if ((await overlay.count()) === 0) return;
  await page.getByTestId("dice-overlay-close").click();
  await expect(overlay).toHaveCount(0);
}

/**
 * Turns the flourishes off. A crit or natural face tints the die with its
 * flourish colour while it is on screen, which would sit on top of the colour
 * these tests are measuring.
 */
async function noFlourishes(page: Page) {
  for (const slot of [
    "dice-flourish-critical-success",
    "dice-flourish-critical-failure",
    "dice-flourish-natural-20",
    "dice-flourish-natural-1",
    "dice-flourish-ordinary",
  ])
    await page.getByTestId(slot).selectOption("none");
}

interface StageStats {
  /** The mean colour of the canvas: the surface the dice are thrown on. */
  mean: { r: number; g: number; b: number };
  /** The mean colour of the saturated pixels: the dice themselves. */
  dice: { r: number; g: number; b: number };
  dicePixels: number;
}

/** Decodes the stage's pixels in the page, where an image decoder exists. */
async function stageStats(page: Page): Promise<StageStats> {
  const png = await page.getByTestId("dice-stage").screenshot();
  return page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let dicePixels = 0;
    let diceRed = 0;
    let diceGreen = 0;
    let diceBlue = 0;
    for (let at = 0; at < data.length; at += 4) {
      const r = data[at]!;
      const g = data[at + 1]!;
      const b = data[at + 2]!;
      pixels += 1;
      red += r;
      green += g;
      blue += b;
      // Every surface is near-neutral or softly tinted, so a die wearing a
      // strong colour is the only thing on the stage this saturated.
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45 && Math.max(r, g, b) > 50) {
        dicePixels += 1;
        diceRed += r;
        diceGreen += g;
        diceBlue += b;
      }
    }
    const round = (value: number) => Math.round(value);
    return {
      mean: {
        r: round(red / pixels),
        g: round(green / pixels),
        b: round(blue / pixels),
      },
      dice: {
        r: round(diceRed / Math.max(dicePixels, 1)),
        g: round(diceGreen / Math.max(dicePixels, 1)),
        b: round(diceBlue / Math.max(dicePixels, 1)),
      },
      dicePixels,
    };
  }, png.toString("base64"));
}

/** Rolls and returns the stage once the throw is under way. */
async function rollAndMeasure(page: Page): Promise<StageStats> {
  await page.getByTestId("roll-standard-greatsword").click();
  const overlay = page.getByTestId("dice-overlay");
  await expect(overlay).toBeVisible();
  // Once the dice land, the crit/nat flourish tints the die and the values
  // appear on it — neither of which is the die's own colour, so the samples are
  // taken while the dice are still in the air.
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if ((await overlay.count()) === 0) break;
    if ((await overlay.getAttribute("data-mode")) !== "pending") break;
    const stats = await stageStats(page);
    if (stats.dicePixels > 200) {
      await dismissDice(page);
      return stats;
    }
    await page.waitForTimeout(200);
  }
  const settled = await stageStats(page);
  await dismissDice(page);
  return settled;
}

/** Settles the appearance change: the next throw rebuilds the renderer. */
async function applyAppearance(page: Page) {
  await page.waitForTimeout(600);
}

test("the dice drawer is the whole roll, with no second result surface", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await page.getByTestId("roll-standard-greatsword").click();

  const drawer = page.getByTestId("dice-drawer");
  await expect(drawer).toBeVisible();
  // The dice, the arithmetic and the outcome all live in the one drawer.
  await expect(drawer.getByTestId("dice-stage")).toBeVisible();
  await expect(drawer.getByTestId("dice-overlay-label")).toContainText(
    "Greatsword",
  );
  await expect(drawer.getByTestId("dice-overlay-faces")).toBeVisible();
  await expect(drawer.getByTestId("dice-overlay-total")).toBeVisible();
  await expect(drawer.getByTestId("dice-overlay-outcome")).toBeVisible();
  // And there is nothing beside it: the overlay holds the drawer alone, and the
  // old separate table panel is gone rather than merely hidden.
  await expect(page.locator('[data-testid="dice-overlay"] > *')).toHaveCount(1);
  await expect(page.locator(".dice-stage-wrap")).toHaveCount(0);

  // Inside the drawer, the dice sit above the arithmetic they hand off to, and
  // the whole drawer fits the viewport instead of hanging off it.
  const drawerBox = (await drawer.boundingBox())!;
  const stageBox = (await page.getByTestId("dice-stage").boundingBox())!;
  const facesBox = (await page
    .getByTestId("dice-overlay-faces")
    .boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(stageBox.x).toBeGreaterThanOrEqual(drawerBox.x - 1);
  expect(stageBox.y).toBeGreaterThanOrEqual(drawerBox.y - 1);
  expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(
    drawerBox.x + drawerBox.width + 1,
  );
  expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(
    drawerBox.y + drawerBox.height + 1,
  );
  expect(facesBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height);
  expect(drawerBox.x).toBeGreaterThanOrEqual(0);
  expect(drawerBox.y).toBeGreaterThanOrEqual(0);
  expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(
    viewport.height + 1,
  );

  await dismissDice(page);

  // The same surface holds a phone: one drawer, dice above the arithmetic.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("roll-standard-greatsword").click();
  await expect(drawer).toBeVisible();
  const phoneDrawer = (await drawer.boundingBox())!;
  const phoneStage = (await page.getByTestId("dice-stage").boundingBox())!;
  const phoneFaces = (await page
    .getByTestId("dice-overlay-faces")
    .boundingBox())!;
  expect(phoneStage.y + phoneStage.height).toBeLessThanOrEqual(
    phoneFaces.y,
  );
  expect(phoneDrawer.x + phoneDrawer.width).toBeLessThanOrEqual(391);
  expect(phoneDrawer.y + phoneDrawer.height).toBeLessThanOrEqual(845);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );

  await dismissDice(page);
});

test("the selected table surface is painted into the renderer's scene", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);

  const measure = async (surface: string) => {
    await page.getByTestId("dice-surface").selectOption(surface);
    await applyAppearance(page);
    return rollAndMeasure(page);
  };

  const felt = await measure("green-felt");
  const steel = await measure("stainless");
  const neon = await measure("cyberpunk");

  // A felt-green table: green dominates both other channels.
  expect(felt.mean.g).toBeGreaterThan(felt.mean.r + 8);
  expect(felt.mean.g).toBeGreaterThan(felt.mean.b + 8);
  // Stainless is a bright cold plate, neon is a dark one: the surface is the
  // scene's own plate, not a wrapper around the canvas.
  const brightness = (stats: StageStats) =>
    stats.mean.r + stats.mean.g + stats.mean.b;
  expect(brightness(steel)).toBeGreaterThan(brightness(felt) + 60);
  expect(brightness(steel)).toBeGreaterThan(brightness(neon) + 60);
});

test("the skin's colours are painted onto the rendered dice", async ({ page }) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);
  // The neutral plate, so the dice are the only strongly coloured pixels.
  await page.getByTestId("dice-surface").selectOption("default");

  const wear = async (background: string) => {
    await page.getByTestId("dice-color-background").fill(background);
    await page.getByTestId("dice-color-edge").fill(background);
    await applyAppearance(page);
    return rollAndMeasure(page);
  };

  const red = await wear("#ff0000");
  const blue = await wear("#0000ff");

  // The dice really are the colours the setting asked for, on the rendered die.
  expect(red.dicePixels).toBeGreaterThan(200);
  expect(red.dice.r).toBeGreaterThan(red.dice.g + 20);
  expect(red.dice.r).toBeGreaterThan(red.dice.b + 20);
  expect(blue.dicePixels).toBeGreaterThan(200);
  expect(blue.dice.b).toBeGreaterThan(blue.dice.r + 20);
  expect(blue.dice.b).toBeGreaterThan(blue.dice.g + 20);
});

test("appearance choices survive a reload and paint the next throw", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  // Editing any colour, texture, material or surface switches the skin to
  // Custom, seeded with what was on screen, and a preset would keep its own look.
  await page.getByTestId("dice-surface").selectOption("green-felt");
  await page.getByTestId("dice-color-background").fill("#123456");
  await page.waitForTimeout(400);

  await page.reload();
  await expect(page.getByTestId("dice-skin")).toHaveValue("custom");
  await expect(page.getByTestId("dice-surface")).toHaveValue("green-felt");
  await expect(page.getByTestId("dice-color-background")).toHaveValue(
    "#123456",
  );

  // The restored surface is the one the next throw is drawn on.
  await noFlourishes(page);
  const stats = await rollAndMeasure(page);
  expect(stats.mean.g).toBeGreaterThan(stats.mean.r + 8);
  expect(stats.mean.g).toBeGreaterThan(stats.mean.b + 8);
});

test("appearance changes between rolls rebuild without stale canvases", async ({
  page,
}) => {
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);

  const stageCanvases = () =>
    page.evaluate(
      () =>
        document.querySelectorAll('[data-testid="dice-stage"] canvas').length,
    );

  const rollWith = async (surface: string) => {
    await page.getByTestId("dice-surface").selectOption(surface);
    await applyAppearance(page);
    await page.getByTestId("roll-standard-greatsword").click();
    const overlay = page.getByTestId("dice-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("data-mode", "rendered", {
      timeout: 20_000,
    });
    // One live canvas, and none left behind by the renderer it replaced.
    expect(await stageCanvases()).toBe(1);
    const stats = await stageStats(page);
    await dismissDice(page);
    return stats;
  };

  const felt = await rollWith("green-felt");
  const steel = await rollWith("stainless");
  const brightness = (stats: StageStats) =>
    stats.mean.r + stats.mean.g + stats.mean.b;
  // The second throw is drawn on the surface the second choice asked for.
  expect(felt.mean.g).toBeGreaterThan(felt.mean.r);
  expect(brightness(steel)).toBeGreaterThan(brightness(felt) + 60);
});
