import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptDiscordWebhook, encryptDiscordWebhook, inspectDiscordWebhook, parseDiscordWebhook } from "../lib/discord-connection.ts";

const url = "https://discord.com/api/webhooks/123456789012345678/" + "A".repeat(60);
const key = randomBytes(32).toString("base64");
assert.equal(parseDiscordWebhook(url)?.id, "123456789012345678");
for (const invalid of [
  "http://discord.com/api/webhooks/123456789012345678/" + "A".repeat(60),
  "https://discord.com.evil.example/api/webhooks/123456789012345678/" + "A".repeat(60),
  url + "?wait=true",
  url + "/extra",
]) assert.equal(parseDiscordWebhook(invalid), null);

const encrypted = await encryptDiscordWebhook(url, "campaign-a", key);
assert.ok(encrypted.startsWith("v1:"));
assert.ok(!encrypted.includes("A".repeat(30)));
assert.equal(await decryptDiscordWebhook(encrypted, "campaign-a", key), url);
await assert.rejects(decryptDiscordWebhook(encrypted, "campaign-b", key));
await assert.rejects(decryptDiscordWebhook(encrypted, "campaign-a", randomBytes(32).toString("base64")));

const fakeFetch = async (input, init) => {
  assert.equal(input, url);
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  return Response.json({ id: "123456789012345678", type: 1, channel_id: "234567890123456789", guild_id: "345678901234567890" });
};
assert.deepEqual(await inspectDiscordWebhook(url, fakeFetch), { id: "123456789012345678", channelId: "234567890123456789", guildId: "345678901234567890" });
await assert.rejects(inspectDiscordWebhook(url, async () => Response.json({ id: "123456789012345678", type: 3, channel_id: null })));
await assert.rejects(inspectDiscordWebhook(url, async () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } })));
console.log("Discord URL validation, channel inspection, and campaign-bound encryption passed.");
