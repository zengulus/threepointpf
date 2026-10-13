import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openDemoSheet } from "./demo-account";

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`play reference downloads the current draft at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openDemoSheet(page);
    await page.getByLabel("Character name", { exact: true }).fill("Portable hero");
    const summary = page.getByText("Play reference", { exact: true });
    await summary.focus(); await summary.press("Enter");
    const downloadButton = page.getByRole("button", { name: "Download play reference" });
    await expect(downloadButton).toBeVisible();
    const menu = summary.locator("..").locator(".character-library-menu");
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("portable-hero.threepointpf-play.txt");
    const contents = await readFile((await download.path())!, "utf8");
    expect(contents).toContain("Portable hero | 3.PF play reference");
    expect(contents).toContain("Includes unsaved sheet edits");
    expect(contents).toContain("Fortitude save: 1d20");
    expect(contents).toContain("WEAPON ROLLS");
    await expect(page.getByText("Unsaved changes", { exact: true }).first()).toBeVisible();
    await summary.click(); await expect(downloadButton).toBeHidden();
    await summary.click(); await expect(downloadButton).toBeVisible();
    await page.screenshot({ path: `test-results/play-reference-${viewport.width}.png`, fullPage: false });
  });
}
