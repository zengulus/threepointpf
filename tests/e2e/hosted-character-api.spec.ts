import { expect, test } from "@playwright/test";
import { levelOneFighter } from "../../apps/web/src/lib/sample-characters";

test("@hosted hosted sheet loads, edits, saves, and reloads through the same-origin API", async ({ page }) => {
  let character = structuredClone(levelOneFighter);
  let revision = 1;
  const requested: string[] = [];
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({ json: { account: { id: "test-dm", username: "testdm", name: "Test DM", role: "dm", activeRole: "dm" } } });
  });
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

test("@hosted a roll-backed ability cannot spend its resource before server support exists", async ({ page }) => {
  const character = {
    ...structuredClone(levelOneFighter),
    resources: [{ id: "breath", name: "Breath Weapon", maximum: { kind: "fixed" as const, value: 1 }, refresh: { kind: "rechargeRoll" as const, dice: { count: 1, sides: 4 } } }],
    abilities: [{ id: "breath", name: "Breath Weapon", activation: "activated" as const, usesPerDay: 1, usesSpent: 0, effects: [], costs: [{ resourceId: "breath", amount: 1 }] }],
  };
  let writes = 0;
  let rollPosts = 0;
  await page.route("**/api/auth", (route) => route.fulfill({ json: { account: { id: "test-dm", username: "testdm", name: "Test DM", role: "dm", activeRole: "dm" } } }));
  await page.route("**/api/characters**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/characters")
      return route.fulfill({ json: [{ id: character.id, name: character.name }] });
    if (request.method() === "GET") return route.fulfill({ json: { character, revision: 1 } });
    writes += 1;
    return route.fulfill({ json: { character, revision: 2 } });
  });
  await page.route("**/api/rolls**", (route) => {
    if (route.request().method() === "POST") rollPosts += 1;
    return route.fulfill({ json: { rolls: [] } });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Features" }).click();
  await page.getByRole("button", { name: "Use ability Breath Weapon" }).click();
  await expect(page.getByText("This ability needs an atomic server action before it can be used in hosted play. No use or resource was spent.")).toBeVisible();
  await page.waitForTimeout(900); // Exceed the hosted autosave debounce.
  expect(writes).toBe(0);
  expect(rollPosts).toBe(0);
  expect(character.abilities[0]?.usesSpent).toBe(0);
});
