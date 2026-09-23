import { expect, test } from "@playwright/test";
import { levelOneFighter } from "../../apps/web/src/lib/sample-characters";

test("@hosted hosted sheet loads, edits, saves, and reloads through the same-origin API", async ({ page }) => {
  let character = structuredClone(levelOneFighter);
  let revision = 1;
  const requested: string[] = [];
  await page.route("**/api/characters**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requested.push(`${request.method()} ${url.pathname}`);
    if (request.method() === "GET" && url.pathname === "/api/characters") {
      await route.fulfill({ json: [{ id: character.id, name: character.name }] });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ json: { character, revision } });
      return;
    }
    if (request.method() === "PUT") {
      const payload = request.postDataJSON() as { character: typeof character; revision?: number };
      expect(payload.revision).toBe(revision);
      expect(payload.character).not.toHaveProperty("bab");
      character = payload.character;
      revision++;
      await route.fulfill({ json: { character, revision } });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Character name" })).toHaveValue(levelOneFighter.name);
  await page.getByRole("textbox", { name: "Character name" }).fill("Hosted edit");
  await page.getByRole("button", { name: "Save character" }).click();
  await expect(page.getByText("Saved to your account")).toBeVisible();
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("textbox", { name: "Character name" })).toHaveValue("Hosted edit");
  expect(requested.some((entry) => entry.startsWith("PUT /api/characters/"))).toBe(true);
  expect(requested.filter((entry) => entry.startsWith("GET /api/characters/")).length).toBeGreaterThanOrEqual(2);
});
