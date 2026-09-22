import { expect, test, type Page } from "@playwright/test";

const webhook = [
  "https://discord.com/api/webhooks",
  "123456789012345678",
  "test-token-not-for-rendering",
].join("/");
const secret = "test-token-not-for-rendering";

async function selectTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function loadShowcase(page: Page) {
  await selectTab(page, "Summary");
  await page.getByTestId("sample-character").selectOption("showcase");
}

async function dismissDice(page: Page) {
  if ((await page.getByTestId("dice-overlay").count()) > 0)
    await page.getByTestId("dice-overlay-close").click();
}

test("Discord settings are masked, local-only, testable, and best-effort for rolls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: Record<string, unknown>[] = [];
  let reply: "success" | "rejected" = "success";
  await page.route("**/api/webhooks/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    await route.fulfill({
      status: reply === "success" ? 204 : 404,
      headers,
    });
  });

  await page.goto("/");
  await selectTab(page, "Settings");
  const enabled = page.getByTestId("discord-enabled");
  await expect(enabled).toBeDisabled();

  const url = page.getByLabel("Discord webhook URL");
  await url.fill("not a webhook");
  await page.getByRole("button", { name: "Save webhook" }).click();
  await expect(page.locator(".discord-settings-panel [role=status]")).toContainText(
    "valid Discord webhook URL",
  );
  expect(requests).toHaveLength(0);

  await url.fill(webhook);
  await page.getByRole("button", { name: "Save webhook" }).click();
  await expect(page.getByTestId("discord-webhook-masked")).toBeVisible();
  await expect(page.getByTestId("discord-webhook-masked")).not.toContainText(secret);
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(enabled).not.toBeDisabled();
  await page.getByLabel("Discord display name").fill("Table Rolls");

  // A test message works while ordinary publishing remains disabled.
  await page.getByTestId("discord-test-connection").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual(
    expect.objectContaining({
      content: expect.stringContaining("3.PF test message"),
      username: "Table Rolls",
      allowed_mentions: { parse: [] },
      tts: false,
    }),
  );
  await expect(page.locator(".discord-settings-panel [role=status]")).toContainText(
    "Test message sent",
  );

  // A normal local roll does not publish while the checkbox is off.
  await loadShowcase(page);
  await page.getByLabel("Roll initiative").click();
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await dismissDice(page);
  expect(requests).toHaveLength(1);

  await selectTab(page, "Settings");
  await enabled.check();
  await loadShowcase(page);
  await page.getByLabel("Roll initiative").click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(
    expect.objectContaining({
      content: expect.stringContaining("Nathan's Character"),
      allowed_mentions: { parse: [] },
    }),
  );
  expect(JSON.stringify(requests[1])).toContain("Initiative");
  expect(JSON.stringify(requests[1])).toMatch(/Natural d20 \d+/);
  expect(JSON.stringify(requests[1])).toContain("Modifier");
  expect(JSON.stringify(requests[1])).toContain("Total");
  expect(JSON.stringify(requests[1])).not.toContain("provenance");
  await expect(page.locator(".sheet-integration-notice")).toContainText(
    "published to Discord",
  );
  await dismissDice(page);

  // A failed publication is visible but cannot suppress the already-resolved
  // local drawer/result.
  reply = "rejected";
  await page.getByLabel("Roll initiative").click();
  await expect(page.getByTestId("dice-overlay")).toBeVisible();
  await expect(page.locator(".sheet-notice")).toContainText("Initiative");
  await expect(page.locator(".sheet-integration-notice")).toContainText(
    "local roll is still available",
  );
  await expect(page.locator("body")).not.toContainText(secret);
  await dismissDice(page);

  // The same safe feedback path covers a rejected test message.
  await selectTab(page, "Settings");
  await page.getByTestId("discord-test-connection").click();
  await expect(page.locator(".discord-settings-panel [role=status]")).toContainText(
    "Discord rejected the message (HTTP 404)",
  );
  await expect(page.locator("body")).not.toContainText(secret);

  await page.getByTestId("discord-clear-webhook").click();
  await expect(page.getByLabel("Discord webhook URL")).toHaveValue("");
  await expect(enabled).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(secret);
  const characterBlobs = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("threepointpf.character."))
      .map(([, value]) => value)
      .join(" "),
  );
  expect(characterBlobs).not.toContain(secret);
});
