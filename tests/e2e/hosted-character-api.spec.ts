import { expect, test } from "@playwright/test";
import { levelOneFighter } from "../../apps/web/src/lib/sample-characters";
import { resolveRollPlan } from "@threepointpf/dice";
import { createRechargeRollPlan } from "@threepointpf/rules-core";

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

test("@hosted a recharge spend displays the server roll and accepts its saved state", async ({ page }) => {
  const resource = { id: "breath", name: "Breath Weapon", maximum: { kind: "fixed" as const, value: 2 },
    refresh: { kind: "rechargeRoll" as const, dice: { count: 1, sides: 4 } } };
  let character = { ...structuredClone(levelOneFighter), resources: [resource], resourceStates: [] as Array<{ resourceId: string; spent: number; roundsUntilRefresh: number }> };
  const plan = createRechargeRollPlan(character, resource);
  const result = resolveRollPlan(plan, [3]);
  let revision = 1;
  let writes = 0;
  let spends = 0;
  await page.route("**/api/auth", (route) => route.fulfill({ json: { account: { id: "test-dm", username: "testdm", name: "Test DM", role: "dm", activeRole: "dm" } } }));
  await page.route("**/api/characters**", (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/characters")
      return route.fulfill({ json: [{ id: character.id, name: character.name }] });
    if (request.method() === "GET") return route.fulfill({ json: { character, revision } });
    writes += 1;
    return route.fulfill({ status: 500, json: { error: { code: "unexpected-save", message: "The action must not save twice." } } });
  });
  await page.route("**/api/rolls**", (route) => route.fulfill({ json: { rolls: [] } }));
  await page.route("**/api/resource-spends", (route) => {
    spends += 1;
    const input = route.request().postDataJSON() as { characterId: string; resourceId: string; expectedRevision: number; clientRequestId: string };
    expect(input).toMatchObject({ characterId: character.id, resourceId: resource.id, expectedRevision: 1 });
    character = { ...character, resourceStates: [{ resourceId: resource.id, spent: 1, roundsUntilRefresh: 3 }] };
    revision = 2;
    return route.fulfill({ status: 201, json: { version: 1, rollId: "recharge-roll", clientRequestId: input.clientRequestId,
      characterId: character.id, characterName: character.name, characterRevision: 1, createdAt: new Date().toISOString(),
      plan, result, delivery: { state: "not_configured" }, character, revision } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Spend one Breath Weapon" }).click();
  await expect(page.getByText("Breath Weapon recharge: 3 rounds until refresh")).toBeVisible();
  await expect(page.getByLabel("Resource counters").getByText("1/2")).toBeVisible();
  await page.waitForTimeout(900); // Ensure the accepted snapshot does not trigger autosave.
  expect(spends).toBe(1);
  expect(writes).toBe(0);
  await page.reload();
  await expect(page.getByLabel("Resource counters").getByText("1/2")).toBeVisible();
});

test("@hosted a lost recharge response can be recovered after reload even when the resource is empty", async ({ page }) => {
  const resource = { id: "breath", name: "Breath Weapon", maximum: { kind: "fixed" as const, value: 1 },
    refresh: { kind: "rechargeRoll" as const, dice: { count: 1, sides: 4 } } };
  let character = { ...structuredClone(levelOneFighter), resources: [resource], resourceStates: [] as Array<{ resourceId: string; spent: number; roundsUntilRefresh: number }> };
  const plan = createRechargeRollPlan(character, resource);
  const result = resolveRollPlan(plan, [3]);
  let revision = 1;
  let attempts = 0;
  let writes = 0;
  const requestIds: string[] = [];
  await page.route("**/api/auth", (route) => route.fulfill({ json: { account: { id: "test-dm", username: "testdm", name: "Test DM", role: "dm", activeRole: "dm" } } }));
  await page.route("**/api/characters**", (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/characters")
      return route.fulfill({ json: [{ id: character.id, name: character.name }] });
    if (request.method() === "GET") return route.fulfill({ json: { character, revision } });
    writes += 1;
    return route.fulfill({ status: 500, json: { error: { code: "unexpected-save", message: "No second save allowed." } } });
  });
  await page.route("**/api/rolls**", (route) => route.fulfill({ json: { rolls: [] } }));
  await page.route("**/api/resource-spends", (route) => {
    attempts += 1;
    const input = route.request().postDataJSON() as { clientRequestId: string; expectedRevision: number };
    requestIds.push(input.clientRequestId);
    if (attempts === 1) {
      character = { ...character, resourceStates: [{ resourceId: resource.id, spent: 1, roundsUntilRefresh: 3 }] };
      revision = 2;
    }
    if (attempts <= 2) return route.abort("failed");
    return route.fulfill({ status: 200, json: { version: 1, rollId: "recovered-spend", clientRequestId: input.clientRequestId,
      characterId: character.id, characterName: character.name, characterRevision: 1, createdAt: new Date().toISOString(),
      plan, result, delivery: { state: "not_configured" }, character, revision } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Spend one Breath Weapon" }).click();
  await expect(page.getByText(/Resource spend was not confirmed/)).toBeVisible();
  await page.reload();
  const recover = page.getByRole("button", { name: "Recover previous Breath Weapon spend" });
  await expect(recover).toBeEnabled();
  await recover.click();
  await expect(page.getByText(/Previous spend recovered/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Spend one Breath Weapon" })).toBeDisabled();
  expect(attempts).toBe(3);
  expect(new Set(requestIds).size).toBe(1);
  expect(writes).toBe(0);
});
