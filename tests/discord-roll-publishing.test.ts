import { describe, expect, it, vi } from "vitest";
import { resolveRollPlan } from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput } from "@threepointpf/rules-schema";
import {
  defaultDiscordRollSettings,
  discordPayloadForRoll,
  discordRollSettingsStorageKey,
  formatDiscordRollMessage,
  loadDiscordRollSettings,
  maskDiscordWebhookUrl,
  postDiscordWebhook,
  saveDiscordRollSettings,
  validateDiscordRollSettings,
  validateDiscordWebhookUrl,
  type DiscordSettingsStorage,
} from "../apps/web/src/lib/discord-roll-publishing";

// Deliberately synthetic endpoint built from test-only fragments, never a
// usable credential or sample-data value.
const webhook = [
  "https://discord.com/api/webhooks",
  "123456789012345678",
  "token-that-must-not-render",
].join("/");

function character(): CharacterInput {
  return {
    id: "discord-test",
    name: "Discord Hero",
    baseAbilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 8 },
    baseBab: 3,
    baseSaves: { fortitude: 3, reflex: 1, will: 0 },
    baseHpBeforeConstitution: 16,
    hitDiceCount: 1,
    skillRanks: {},
    attacks: [
      {
        id: "sword",
        name: "Sword",
        attackAbility: "str",
        damageAbility: "str",
        baseDamage: { count: 1, sides: 8 },
        attackTags: ["weapon.melee"],
        mode: "melee",
      },
    ],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
  };
}

function memoryStorage(): DiscordSettingsStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

describe("Discord roll publishing settings", () => {
  it("accepts only Discord HTTPS webhook endpoints and masks saved tokens", () => {
    expect(validateDiscordWebhookUrl(webhook)).toMatchObject({ valid: true });
    for (const invalid of [
      "not a url",
      "http://discord.com/api/webhooks/1/token",
      "https://example.com/api/webhooks/1/token",
      "https://discord.com/api/webhooks/1",
    ])
      expect(validateDiscordWebhookUrl(invalid)).toMatchObject({ valid: false });

    const masked = maskDiscordWebhookUrl(webhook);
    expect(masked).toContain("discord.com/api/webhooks/123456");
    expect(masked).not.toContain("token-that-must-not-render");
  });

  it("persists only valid local settings and fails closed for corrupt credentials", () => {
    const storage = memoryStorage();
    const settings = {
      enabled: true,
      webhookUrl: webhook,
      displayName: "Table Rolls",
    };
    expect(saveDiscordRollSettings(settings, storage)).toBe(true);
    expect(loadDiscordRollSettings(storage)).toEqual(settings);
    expect(storage.entries.get(discordRollSettingsStorageKey)).toContain("token-that-must-not-render");

    expect(
      validateDiscordRollSettings({
        enabled: true,
        webhookUrl: "https://example.test/secret",
        displayName: 4,
      }),
    ).toEqual(defaultDiscordRollSettings);
  });
});

describe("Discord roll payloads", () => {
  it("uses resolved facts without serializing a plan or allowing mentions", () => {
    const engine = new RulesEngine(character(), rulesCatalogs);
    const plan = engine.createAttackRollPlan("sword", 0, {
      defense: { kind: "ac", value: 14 },
    });
    const resolved = resolveRollPlan(plan, [20]);
    const settings = { enabled: true, webhookUrl: webhook, displayName: "Table Rolls" };
    const payload = discordPayloadForRoll(settings, "Discord Hero", plan, resolved);

    expect(payload).toEqual(
      expect.objectContaining({
        username: "Table Rolls",
        allowed_mentions: { parse: [] },
        tts: false,
      }),
    );
    expect(payload.content).toContain("Discord Hero");
    expect(payload.content).toContain("Natural d20 20");
    expect(payload.content).toContain("Modifier +6");
    expect(payload.content).toContain("Total 26");
    expect(payload.content).toContain("vs AC 14");
    expect(payload.content).toContain("Critical hit");
    expect(payload.content).not.toContain("provenance");
    expect(payload.content).not.toContain(plan.id);
    expect(formatDiscordRollMessage("Discord Hero", plan, resolved)).toBe(
      payload.content,
    );
  });

  it("posts compact JSON and exposes credential-safe failure messages", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      postDiscordWebhook(
        webhook,
        { content: "hello", allowed_mentions: { parse: [] }, tts: false },
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      webhook,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    const rejected = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      postDiscordWebhook(
        webhook,
        { content: "hello", allowed_mentions: { parse: [] }, tts: false },
        rejected as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Discord rejected the message (HTTP 404).");

    const offline = vi.fn(async () => {
      throw new Error(webhook);
    });
    await expect(
      postDiscordWebhook(
        webhook,
        { content: "hello", allowed_mentions: { parse: [] }, tts: false },
        offline as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Could not reach Discord. Check the webhook and connection.");
  });
});
