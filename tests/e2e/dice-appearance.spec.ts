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

/* ------------------------------------------------------------------ *
 * Reading the renderer's own generated textures.
 *
 * The dice and the table are a handful of pixels on the stage, so a numeral or a
 * grain line is one or two pixels there. Both are baked by the renderer into a
 * canvas and handed to Three.js, so these helpers observe those canvases: the
 * stage is still driven entirely by the real renderer, and the assertions are
 * made against the real generated texture at its own resolution rather than
 * inferring a numeral from a 60-pixel die.
 * ------------------------------------------------------------------ */

interface GeneratedCanvasEntry {
  canvas: HTMLCanvasElement;
  strokes: { text: string; style: string; lineWidth: number; font: string }[];
  fills: { text: string; style: string }[];
}

/**
 * Records every 2D canvas the renderer creates, and the text it draws on it.
 * This is a read-only observation — the returned context is the renderer's own,
 * with its `strokeText`/`fillText` wrapped so their arguments can be inspected —
 * and it is installed before any app code runs.
 */
async function recordGeneratedCanvases(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as { __diceCanvases?: GeneratedCanvasEntry[] };
    scope.__diceCanvases = [];
    const wrapped = new WeakSet<object>();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      const context = (
        original as unknown as (
          this: HTMLCanvasElement,
          type: string,
          ...rest: unknown[]
        ) => CanvasRenderingContext2D | null
      ).call(this, type, ...args);
      if (type === "2d" && context && !wrapped.has(context)) {
        wrapped.add(context);
        const entry: GeneratedCanvasEntry = {
          canvas: this,
          strokes: [],
          fills: [],
        };
        scope.__diceCanvases!.push(entry);
        const strokeText = context.strokeText.bind(context);
        const fillText = context.fillText.bind(context);
        context.strokeText = ((text: string, x: number, y: number) => {
          entry.strokes.push({
            text: String(text),
            style: String(context.strokeStyle),
            lineWidth: context.lineWidth,
            font: context.font,
          });
          return strokeText(text, x, y);
        }) as typeof context.strokeText;
        context.fillText = ((text: string, x: number, y: number) => {
          entry.fills.push({
            text: String(text),
            style: String(context.fillStyle),
          });
          return fillText(text, x, y);
        }) as typeof context.fillText;
      }
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

/** Starts an assertion from the next renderer-generated face textures only. */
async function clearGeneratedCanvases(page: Page) {
  await page.evaluate(() => {
    const scope = window as unknown as { __diceCanvases?: GeneratedCanvasEntry[] };
    scope.__diceCanvases = [];
  });
}

interface FaceTextureReport {
  /** Numeral fills drawn in the skin's foreground colour. */
  fills: number;
  /** Numeral strokes drawn in the expected outline colour. */
  outlineStrokes: number;
  /** Thinnest outline stroked around any numeral, in texture pixels. */
  minOutlineWidth: number;
  /**
   * Fraction of the numeral's edge pixels that lead into a contiguous run of
   * outline pixels at least four deep. This is the visible ring: the patched
   * stroke leaves roughly half its width outside the glyph, while the body
   * colour and any texture behind the numeral leave a run of one or two.
   */
  ringFraction: number;
  /** Pixels of the outline colour in the face texture. */
  inkPixels: number;
  /** How many distinct landed values were seen. */
  distinctValues: number;
}

/** Inspects the real face textures the renderer generated, at 512px. */
async function faceTextureReport(
  page: Page,
  foreground: string,
  outline: string,
  inkThreshold = 40,
): Promise<FaceTextureReport> {
  return page.evaluate(
    ({ foreground, outline, inkThreshold }) => {
      const scope = window as unknown as {
        __diceCanvases?: GeneratedCanvasEntry[];
      };
      const entries = scope.__diceCanvases ?? [];
      const isNumeral = (text: string) => /^[0-9]+$/.test(text.trim());
      const sameColor = (a: string, b: string) =>
        a.toLowerCase() === b.toLowerCase();
      const strokes = entries
        .flatMap((entry) => entry.strokes)
        .filter((stroke) => isNumeral(stroke.text));
      const fills = entries
        .flatMap((entry) => entry.fills)
        .filter((fill) => isNumeral(fill.text));
      const foregroundFills = fills.filter((fill) =>
        sameColor(fill.style, foreground),
      );
      const outlineStrokes = strokes.filter((stroke) =>
        sameColor(stroke.style, outline),
      );
      const minOutlineWidth = outlineStrokes.length
        ? Math.min(...outlineStrokes.map((stroke) => stroke.lineWidth))
        : 0;
      let ringFraction = 0;
      let inkPixels = 0;
      const entry = entries.find((candidate) =>
        candidate.fills.some(
          (fill) => isNumeral(fill.text) && sameColor(fill.style, foreground),
        ),
      );
      if (entry) {
        const rgb = (hex: string) => {
          const value = Number.parseInt(hex.slice(1), 16);
          return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
        };
        const target = rgb(foreground);
        const ink = rgb(outline);
        const context = entry.canvas.getContext("2d")!;
        const { width, height } = entry.canvas;
        const data = context.getImageData(0, 0, width, height).data;
        const near = (at: number, colour: number[], threshold: number) =>
          Math.abs(data[at]! - colour[0]!) <= threshold &&
          Math.abs(data[at + 1]! - colour[1]!) <= threshold &&
          Math.abs(data[at + 2]! - colour[2]!) <= threshold;
        const isFill = (x: number, y: number) =>
          near((y * width + x) * 4, target, 60);
        const isInk = (x: number, y: number) =>
          near((y * width + x) * 4, ink, inkThreshold);
        const neighbours: [number, number][] = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ];
        for (let y = 0; y < height; y += 1)
          for (let x = 0; x < width; x += 1)
            if (isInk(x, y)) inkPixels += 1;
        let edges = 0;
        let ringed = 0;
        for (let y = 2; y < height - 2; y += 1)
          for (let x = 2; x < width - 2; x += 1) {
            if (!isFill(x, y)) continue;
            // A numeral edge pixel: the glyph's interior is not needed here.
            const boundary = neighbours.some(
              ([dx, dy]) => !isFill(x + dx, y + dy),
            );
            if (!boundary) continue;
            edges += 1;
            let deepest = 0;
            for (const [dx, dy] of neighbours) {
              let run = 0;
              for (let step = 1; step <= 24; step += 1) {
                const nx = x + dx * step;
                const ny = y + dy * step;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
                if (!isInk(nx, ny)) break;
                run += 1;
              }
              deepest = Math.max(deepest, run);
            }
            if (deepest >= 4) ringed += 1;
          }
        ringFraction = edges ? ringed / edges : 0;
      }
      return {
        fills: foregroundFills.length,
        outlineStrokes: outlineStrokes.length,
        minOutlineWidth,
        ringFraction: Number(ringFraction.toFixed(3)),
        inkPixels,
        distinctValues: new Set(
          foregroundFills.map((fill) => fill.text.trim()),
        ).size,
      };
    },
    { foreground, outline, inkThreshold },
  );
}

interface TableTextureSample {
  /** 90th-percentile per-pixel luminance residual of the rendered table. */
  renderedResidual: number;
  /** The same residual computed on the generated map at 512px. */
  canvasResidual: number;
  /** The generated map's own mean colour, which should be the authored tint. */
  canvasMean: [number, number, number];
}

/** Samples the rendered table and the map its material actually wears. */
async function sampleTableTexture(
  page: Page,
  tint: string,
): Promise<TableTextureSample> {
  const png = await page.getByTestId("dice-stage").screenshot();
  const renderedResidual = await page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { width, height } = canvas;
    const data = context.getImageData(0, 0, width, height).data;
    const lum = (x: number, y: number) => {
      const at = (y * width + x) * 4;
      return (
        0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!
      );
    };
    const residuals: number[] = [];
    for (let y = 1; y < height - 1; y += 1)
      for (let x = 1; x < width - 1; x += 1) {
        const centre = lum(x, y);
        const neighbours =
          (lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1)) / 4;
        residuals.push(Math.abs(centre - neighbours));
      }
    residuals.sort((a, b) => a - b);
    return (
      residuals[Math.floor(residuals.length * 0.9)] ??
      0
    );
  }, png.toString("base64"));
  const map = await page.evaluate((tint) => {
    const scope = window as unknown as {
      __diceCanvases?: GeneratedCanvasEntry[];
    };
    const rgb = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
    };
    const target = rgb(tint);
    const candidates = (scope.__diceCanvases ?? []).filter(
      (entry) => entry.canvas.width === 512 && entry.canvas.height === 512,
    );
    let best: {
      mean: [number, number, number];
      residual: number;
      distance: number;
    } | null = null;
    for (const entry of candidates) {
      const context = entry.canvas.getContext("2d")!;
      const data = context.getImageData(0, 0, 512, 512).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let at = 0; at < data.length; at += 4) {
        r += data[at]!;
        g += data[at + 1]!;
        b += data[at + 2]!;
      }
      const count = data.length / 4;
      const mean: [number, number, number] = [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
      ];
      const distance =
        Math.abs(mean[0] - target[0]!) +
        Math.abs(mean[1] - target[1]!) +
        Math.abs(mean[2] - target[2]!);
      let residual = 0;
      let samples = 0;
      for (let y = 1; y < 512; y += 2)
        for (let x = 1; x < 512; x += 1) {
          const at = (y * 512 + x) * 4;
          const left = at - 4;
          const up = at - 512 * 4;
          residual +=
            (Math.abs(data[at]! - data[left]!) +
              Math.abs(data[at]! - data[up]!)) /
            2;
          samples += 1;
        }
      const found = { mean, residual: residual / samples, distance };
      if (!best || found.distance < best.distance) best = found;
    }
    return best ?? { mean: [0, 0, 0], residual: 0, distance: 255 };
  }, tint);
  return {
    renderedResidual,
    canvasResidual: map.residual,
    canvasMean: map.mean,
  };
}

/** Rolls and waits for the dice to land, without dismissing the overlay. */
async function rollToLanding(page: Page) {
  await page.getByTestId("roll-standard-greatsword").click();
  const overlay = page.getByTestId("dice-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("data-mode", "rendered", {
    timeout: 20_000,
  });
  return overlay;
}

test("the skulls face texture outlines its numerals so they stay readable", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await recordGeneratedCanvases(page);
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);
  await page.getByTestId("dice-surface").selectOption("default");
  await page.getByTestId("dice-texture").selectOption("skulls");
  await page.getByTestId("dice-material").selectOption("plastic");
  await page.getByTestId("dice-color-foreground").fill("#ffffff");
  await page.getByTestId("dice-color-background").fill("#303030");
  await applyAppearance(page);

  // Several throws, because the landed face is the throw's, not the test's: every
  // face that does land must carry the same outlined numeral.
  let distinct = 0;
  for (let throwNumber = 0; throwNumber < 3; throwNumber += 1) {
    await rollToLanding(page);
    const report = await faceTextureReport(page, "#ffffff", "#050608");
    expect(report.fills, "the numeral colour reaches the face texture").toBeGreaterThan(
      0,
    );
    expect(
      report.outlineStrokes,
      "every numeral is stroked with the automatic dark outline",
    ).toBeGreaterThanOrEqual(report.fills);
    expect(
      report.minOutlineWidth,
      "the outline is wider than upstream's five-pixel hairline",
    ).toBeGreaterThanOrEqual(8);
    expect(
      report.ringFraction,
      "the white numerals are ringed by their dark outline",
    ).toBeGreaterThan(0.35);
    distinct = Math.max(distinct, report.distinctValues);
    await dismissDice(page);
  }
  expect(distinct, "more than one value was actually rolled").toBeGreaterThan(1);

  // The inverse: dark numerals on a light, busy texture take the off-white ink.
  await page.getByTestId("dice-color-foreground").fill("#111111");
  await page.getByTestId("dice-color-background").fill("#d8d2c4");
  await applyAppearance(page);
  await rollToLanding(page);
  // The light body cannot be mistaken for the off-white ink, so its ring is
  // counted directly rather than measured against a busy background.
  const inverse = await faceTextureReport(page, "#111111", "#f7f7f2", 20);
  expect(inverse.fills).toBeGreaterThan(0);
  expect(inverse.outlineStrokes).toBeGreaterThanOrEqual(inverse.fills);
  expect(inverse.minOutlineWidth).toBeGreaterThanOrEqual(8);
  expect(
    inverse.inkPixels,
    "the dark numerals are ringed by their off-white outline",
  ).toBeGreaterThan(1000);
  await dismissDice(page);

  // A custom skin can legitimately choose the same dark ink for its body and
  // its automatic outline. The upstream `l != a` shortcut used to erase the
  // outline in that case; the texture knockout plus the actual outline now
  // produce two dark strokes for every white numeral.
  await clearGeneratedCanvases(page);
  await page.getByTestId("dice-color-foreground").fill("#ffffff");
  await page.getByTestId("dice-color-background").fill("#050608");
  await applyAppearance(page);
  await rollToLanding(page);
  const sameColour = await faceTextureReport(page, "#ffffff", "#050608");
  expect(sameColour.fills).toBeGreaterThan(0);
  expect(
    sameColour.outlineStrokes,
    "the automatic outline is retained when it matches the die body",
  ).toBeGreaterThanOrEqual(sameColour.fills * 2);
  expect(sameColour.minOutlineWidth).toBeGreaterThanOrEqual(8);
  await dismissDice(page);
});

test("the numeral colour reaches the rendered die", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);
  await page.getByTestId("dice-surface").selectOption("default");
  await page.getByTestId("dice-texture").selectOption("none");
  await page.getByTestId("dice-material").selectOption("none");
  // A dark body so the only strongly-coloured pixels on the stage are numerals.
  await page.getByTestId("dice-color-background").fill("#202020");
  await page.getByTestId("dice-color-foreground").fill("#00ff00");
  await applyAppearance(page);

  await rollToLanding(page);
  const png = await page.getByTestId("dice-stage").screenshot();
  const green = await page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const data = context
      .getImageData(0, 0, canvas.width, canvas.height)
      .data;
    let pixels = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let at = 0; at < data.length; at += 4) {
      const red = data[at]!;
      const green = data[at + 1]!;
      const blue = data[at + 2]!;
      if (green > red + 40 && green > blue + 40) {
        pixels += 1;
        r += red;
        g += green;
        b += blue;
      }
    }
    return {
      pixels,
      r: Math.round(r / Math.max(1, pixels)),
      g: Math.round(g / Math.max(1, pixels)),
      b: Math.round(b / Math.max(1, pixels)),
    };
  }, png.toString("base64"));
  expect(green.pixels, "the numerals are on the rendered die").toBeGreaterThan(20);
  expect(green.g).toBeGreaterThan(green.r + 40);
  expect(green.g).toBeGreaterThan(green.b + 40);
  await dismissDice(page);
});

test("a surface change does not materially recolour the same die", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);
  await page.getByTestId("dice-texture").selectOption("none");
  await page.getByTestId("dice-material").selectOption("none");
  // A uniformly red die: the surface's light must not tint it.
  await page.getByTestId("dice-color-foreground").fill("#ff0000");
  await page.getByTestId("dice-color-background").fill("#ff0000");
  await applyAppearance(page);

  const measure = async (surface: string) => {
    await page.getByTestId("dice-surface").selectOption(surface);
    await applyAppearance(page);
    await rollToLanding(page);
    const png = await page.getByTestId("dice-stage").screenshot();
    const sample = await page.evaluate(async (base64: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context
        .getImageData(0, 0, canvas.width, canvas.height)
        .data;
      let pixels = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let at = 0; at < data.length; at += 4) {
        const red = data[at]!;
        const green = data[at + 1]!;
        const blue = data[at + 2]!;
        if (red > green + 60 && red > blue + 60 && red > 60) {
          pixels += 1;
          r += red;
          g += green;
          b += blue;
        }
      }
      return {
        pixels,
        r: Math.round(r / Math.max(1, pixels)),
        g: Math.round(g / Math.max(1, pixels)),
        b: Math.round(b / Math.max(1, pixels)),
      };
    }, png.toString("base64"));
    await dismissDice(page);
    return sample;
  };

  const reds: number[] = [];
  for (const surface of [
    "green-felt",
    "mahogany",
    "stainless",
    "taverntable",
    "cyberpunk",
  ]) {
    const sample = await measure(surface);
    expect(sample.pixels, `${surface} renders the die`).toBeGreaterThan(300);
    // The red die stays red on every table: the green channel is never lifted.
    expect(sample.g, `${surface} does not recolour the die`).toBeLessThan(90);
    expect(sample.b).toBeLessThan(90);
    reds.push(sample.r);
  }
  // And the red itself is the same light on every table.
  expect(Math.max(...reds) - Math.min(...reds)).toBeLessThan(60);
});

test("a table surface carries texture, not just a mean colour", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await recordGeneratedCanvases(page);
  await page.goto("/");
  await loadSample(page, "showcase");
  await noFlourishes(page);
  await page.getByTestId("dice-texture").selectOption("none");
  await page.getByTestId("dice-material").selectOption("none");
  await page.getByTestId("dice-color-foreground").fill("#ffffff");
  await page.getByTestId("dice-color-background").fill("#202020");
  await applyAppearance(page);

  const measure = async (surface: string, tint: string) => {
    await page.getByTestId("dice-surface").selectOption(surface);
    await applyAppearance(page);
    await rollToLanding(page);
    const sample = await sampleTableTexture(page, tint);
    await dismissDice(page);
    return sample;
  };

  const flat = await measure("default", "#22262c");
  // The solid plate is one flat colour, on screen and in its map.
  expect(flat.canvasResidual, "the solid table map is flat").toBeLessThan(0.01);
  expect(
    flat.renderedResidual,
    "the solid table stays approximately uniform on screen",
  ).toBeLessThan(0.6);
  expect(flat.canvasMean).toEqual([34, 38, 44]);

  const tavern = await measure("taverntable", "#6b4528");
  const mahogany = await measure("mahogany", "#4a1e17");
  const felt = await measure("green-felt", "#245b3b");
  const steel = await measure("stainless", "#9da5ad");

  // Every textured map has spatial structure and wears its authored tint.
  for (const [name, sample, tint] of [
    ["taverntable", tavern, "#6b4528"],
    ["mahogany", mahogany, "#4a1e17"],
    ["green-felt", felt, "#245b3b"],
    ["stainless", steel, "#9da5ad"],
  ] as const) {
    expect(sample.canvasResidual, `${name} has a textured map`).toBeGreaterThan(
      0.01,
    );
    const authored = [1, 3, 5].map((at) =>
      Number.parseInt(tint.slice(at, at + 2), 16),
    );
    sample.canvasMean.forEach((channel, index) => {
      expect(
        Math.abs(channel - authored[index]!),
        `${name} wears its authored tint`,
      ).toBeLessThan(25);
    });
  }

  // Wood and brushed metal resolve at the stage's own resolution, so they are
  // measurably non-uniform there, while the solid table is not.
  expect(tavern.renderedResidual).toBeGreaterThan(flat.renderedResidual * 2);
  expect(mahogany.renderedResidual).toBeGreaterThan(flat.renderedResidual * 1.5);
  expect(steel.renderedResidual).toBeGreaterThan(flat.renderedResidual * 2);
  // Felt's grain is finer than a stage pixel, but it is present and not a
  // re-tinted flat plate.
  expect(felt.renderedResidual).toBeGreaterThan(flat.renderedResidual * 1.15);
});
