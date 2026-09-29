import { env } from "cloudflare:workers";
import { getDb } from "../../../../../../db";
import { currentAccount, error, json, sameOrigin, sessionRequired } from "../../../../../../lib/accounts";
import { decryptDiscordWebhook } from "../../../../../../lib/discord-connection";
import { mayManageCampaign } from "../../../../../../lib/character-access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can test Discord.", 403);
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const db = getDb();
  const row = await db.prepare("SELECT encrypted_url AS encryptedUrl, enabled FROM campaign_discord_connections WHERE campaign_id = ?").bind(id).first<{ encryptedUrl: string; enabled: number }>();
  if (!row?.enabled) return error("not-found", "No Discord channel is connected for this campaign.", 404);
  const secret = env.DISCORD_WEBHOOK_ENCRYPTION_KEY;
  if (!secret) return error("server", "Discord setup is unavailable. Ask the site owner to configure it.", 503);
  let webhook: string;
  try { webhook = await decryptDiscordWebhook(row.encryptedUrl, id, secret); }
  catch { return error("server", "Discord connection could not be read. Reconnect the channel.", 503); }
  const now = Math.floor(Date.now() / 1000);
  const claim = await db.prepare("UPDATE campaign_discord_connections SET last_test_at = ? WHERE campaign_id = ? AND enabled = 1 AND (last_test_at IS NULL OR last_test_at <= ?)").bind(now, id, now - 60).run();
  if (!claim.meta.changes) return error("rate-limited", "Wait one minute before sending another test message.", 429);
  const destination = new URL(webhook);
  destination.searchParams.set("wait", "true");
  let response: Response;
  try {
    response = await fetch(destination, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "3.PF test message. Campaign roll publishing is connected.", allowed_mentions: { parse: [] }, tts: false }),
    });
  } catch { return error("delivery-unknown", "Discord delivery could not be confirmed. Check the channel before sending another test.", 502); }
  if (!response.ok) return error("discord-rejected", `Discord rejected the test message (HTTP ${response.status}).`, 502);
  const body = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string") return error("delivery-unknown", "Discord delivery could not be confirmed. Check the channel before sending another test.", 502);
  return json({ sent: true });
}
