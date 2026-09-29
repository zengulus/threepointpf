import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired } from "../../../../../lib/accounts";
import { encryptDiscordWebhook, inspectDiscordWebhook } from "../../../../../lib/discord-connection";
import { mayManageCampaign, mayViewCampaign } from "../../../../../lib/character-access";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!await mayViewCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const row = await getDb().prepare("SELECT channel_id AS channelId, guild_id AS guildId, version, enabled, updated_at AS updatedAt FROM campaign_discord_connections WHERE campaign_id = ?").bind(id).first();
  return json({ connection: row ?? null });
}

export async function PUT(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can connect Discord.", 403);
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (!id || id.length > 128) return error("validation", "Choose a campaign.", 400);
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const body = await readObject(request, 1500);
  if (!body) return error("validation", "Enter a Discord webhook URL.", 400);
  const secret = env.DISCORD_WEBHOOK_ENCRYPTION_KEY;
  if (!secret) return error("server", "Discord setup is unavailable. Ask the site owner to configure it.", 503);
  let details: Awaited<ReturnType<typeof inspectDiscordWebhook>>;
  let encrypted: string;
  try {
    details = await inspectDiscordWebhook(body.webhookUrl);
    encrypted = await encryptDiscordWebhook(body.webhookUrl as string, id, secret);
  } catch (cause) {
    return error("validation", cause instanceof Error ? cause.message : "Could not verify this Discord webhook.", 400);
  }
  const db = getDb();
  const found = await db.prepare("SELECT 1 FROM campaigns WHERE id = ?").bind(id).first();
  if (!found) return error("not-found", "Campaign not found.", 404);
  const now = new Date().toISOString();
  const connectionId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO campaign_discord_connections (campaign_id, connection_id, encrypted_url, webhook_id, channel_id, guild_id, version, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?) ON CONFLICT(campaign_id) DO UPDATE SET connection_id = excluded.connection_id, encrypted_url = excluded.encrypted_url, webhook_id = excluded.webhook_id, channel_id = excluded.channel_id, guild_id = excluded.guild_id, version = campaign_discord_connections.version + 1, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(id, connectionId, encrypted, details.id, details.channelId, details.guildId, actor.id, now),
    db.prepare(`UPDATE discord_deliveries SET state = 'cancelled', next_attempt_at_ms = NULL,
      safe_error_code = 'connection_changed', updated_at = ?
      WHERE campaign_id = ? AND state IN ('pending', 'retryable_failed')`)
      .bind(now, id),
  ]);
  const row = await db.prepare("SELECT channel_id AS channelId, guild_id AS guildId, version, enabled, updated_at AS updatedAt FROM campaign_discord_connections WHERE campaign_id = ?").bind(id).first();
  return json({ connection: row });
}

export async function DELETE(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can disconnect Discord.", 403);
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const now = new Date().toISOString();
  await getDb().batch([
    getDb().prepare(`UPDATE discord_deliveries SET state = 'cancelled', next_attempt_at_ms = NULL,
      safe_error_code = 'connection_changed', updated_at = ?
      WHERE campaign_id = ? AND state IN ('pending', 'retryable_failed')`).bind(now, id),
    getDb().prepare("DELETE FROM campaign_discord_connections WHERE campaign_id = ?").bind(id),
  ]);
  return json({ connection: null });
}
