import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { resolveRollPlan } from "@threepointpf/dice";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { createCharacterRollPlan } from "@threepointpf/shared";
import { encryptDiscordWebhook } from "../lib/discord-connection.ts";

const output = new URL("../work/discord-delivery.test-bundle.mjs", import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL("../lib/discord-delivery.ts", import.meta.url))], outfile: fileURLToPath(output),
  bundle: true, platform: "node", format: "esm", packages: "external" });
const { processDiscordDelivery, reconcileExpiredDelivery } = await import(pathToFileURL(fileURLToPath(output)).href);
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: { DB: "delivery-test" } });
try {
  const db = await mf.getD1Database("DB");
  for (const file of ["0000_true_mister_sinister", "0001_curved_spencer_smythe", "0002_wide_kree", "0003_luxuriant_frightful_four", "0004_icy_whistler"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}.sql`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const character = JSON.parse(readFileSync(new URL("./fixtures/simple-character.json", import.meta.url), "utf8"));
  const plan = createCharacterRollPlan(character, { characterId: character.id, kind: "save", saveId: "fortitude" }, rulesCatalogs);
  const result = resolveRollPlan(plan, [17]);
  const now = new Date().toISOString();
  const secret = randomBytes(32).toString("base64");
  const webhookId = "123456789012345678";
  const webhook = `https://discord.com/api/webhooks/${webhookId}/${"t".repeat(48)}`;
  const encrypted = await encryptDiscordWebhook(webhook, character.campaignId, secret);
  await db.prepare("INSERT INTO accounts (id, username, name, role, salt, password_hash, created_at) VALUES ('actor', 'actor', 'Actor', 'dm', 'salt', 'hash', ?)").bind(now).run();
  await db.prepare("INSERT INTO characters (id, name, campaign_id, snapshot, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, 'actor')")
    .bind(character.id, character.name, character.campaignId, JSON.stringify(character), now).run();
  await db.prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)").bind(character.campaignId, "Test", now).run();
  await db.prepare("INSERT INTO campaign_discord_connections (campaign_id, connection_id, encrypted_url, webhook_id, channel_id, version, enabled, updated_by, updated_at) VALUES (?, 'connection-1', ?, ?, '999999999999999999', 1, 1, 'actor', ?)")
    .bind(character.campaignId, encrypted, webhookId, now).run();
  async function addRoll(id = randomUUID()) {
    await db.prepare("INSERT INTO roll_events (id, actor_id, client_request_id, request_hash, character_id, campaign_id, character_name, character_revision, rules_version, request_json, plan_json, result_json, created_at, created_at_ms) VALUES (?, 'actor', ?, 'hash', ?, ?, ?, 1, 'test', '{}', ?, ?, ?, ?)")
      .bind(id, randomUUID(), character.id, character.campaignId, character.name, JSON.stringify(plan), JSON.stringify(result), now, Date.now()).run();
    await db.prepare("INSERT INTO discord_deliveries (roll_id, campaign_id, connection_id, connection_version, state, attempts, next_attempt_at_ms, created_at, updated_at) VALUES (?, ?, 'connection-1', 1, 'pending', 0, ?, ?, ?)")
      .bind(id, character.campaignId, Date.now(), now, now).run();
    return id;
  }
  async function state(id) { return db.prepare("SELECT state, attempts, message_id AS messageId, next_attempt_at_ms AS nextAttemptAtMs FROM discord_deliveries WHERE roll_id = ?").bind(id).first(); }

  const sentId = await addRoll();
  let sends = 0;
  const success = async (url, init) => {
    sends++;
    assert.equal(new URL(url).searchParams.get("wait"), "true");
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.tts, false);
    assert.match(payload.content, new RegExp(sentId.slice(0, 12)));
    assert.ok(!payload.content.includes("baseAbilities"));
    return Response.json({ id: "555555555555555555" });
  };
  assert.equal(await processDiscordDelivery(db, sentId, secret, success), "sent");
  assert.equal((await state(sentId)).messageId, "555555555555555555");
  assert.equal(await processDiscordDelivery(db, sentId, secret, success), "sent");
  assert.equal(sends, 1);

  const rateId = await addRoll();
  assert.equal(await processDiscordDelivery(db, rateId, secret, async () => new Response('{"retry_after":0.1}', { status: 429, headers: { "Retry-After": "0.1" } })), "retryable_failed");
  assert.ok((await state(rateId)).nextAttemptAtMs > Date.now());
  await db.prepare("UPDATE discord_deliveries SET next_attempt_at_ms = 0 WHERE roll_id = ?").bind(rateId).run();
  assert.equal(await processDiscordDelivery(db, rateId, secret, async () => Response.json({ id: "666666666666666666" })), "sent");
  assert.equal((await state(rateId)).attempts, 2);

  const unknownId = await addRoll();
  let unknownSends = 0;
  assert.equal(await processDiscordDelivery(db, unknownId, secret, async () => { unknownSends++; throw new Error("timeout"); }), "delivery_unknown");
  assert.equal(await processDiscordDelivery(db, unknownId, secret, async () => { unknownSends++; return Response.json({ id: "777777777777777777" }); }), "delivery_unknown");
  assert.equal(unknownSends, 1);

  const expiredId = await addRoll();
  await db.prepare("UPDATE discord_deliveries SET state = 'sending', lease_token = 'lost', lease_expires_at_ms = 1 WHERE roll_id = ?").bind(expiredId).run();
  await reconcileExpiredDelivery(db, expiredId);
  assert.equal((await state(expiredId)).state, "delivery_unknown");

  const concurrentId = await addRoll();
  let concurrentSends = 0;
  const delayedSuccess = async () => {
    concurrentSends++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return Response.json({ id: "888888888888888888" });
  };
  await Promise.all([processDiscordDelivery(db, concurrentId, secret, delayedSuccess), processDiscordDelivery(db, concurrentId, secret, delayedSuccess)]);
  assert.equal(concurrentSends, 1);
  assert.equal((await state(concurrentId)).state, "sent");

  const missingId = await addRoll();
  assert.equal(await processDiscordDelivery(db, missingId, secret, async () => new Response("missing", { status: 404 })), "permanent_failed");
  assert.equal((await state(missingId)).state, "permanent_failed");

  const changedId = await addRoll();
  await db.prepare("UPDATE campaign_discord_connections SET connection_id = 'connection-2', version = 2 WHERE campaign_id = ?").bind(character.campaignId).run();
  assert.equal(await processDiscordDelivery(db, changedId, secret, async () => { throw new Error("must not send"); }), "cancelled");
  assert.equal((await state(changedId)).state, "cancelled");

  console.log("Discord delivery tests passed: confirmation, no resend, 429, ambiguous timeout, expired lease, concurrent claim, 404, and connection pin.");
} finally {
  await mf.dispose();
}
