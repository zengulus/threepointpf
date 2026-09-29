import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { currentAccount, error, json, sameOrigin, sessionRequired } from "../../../../lib/accounts";
import { isSiteAdmin } from "../../../../lib/character-access";
import { processDiscordDelivery } from "../../../../lib/discord-delivery";

/** Bounded active-use recovery. Sites has no configured durable queue runner. */
export async function POST(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const db = getDb();
  const next = await db.prepare(`SELECT d.roll_id AS rollId FROM discord_deliveries d
    JOIN roll_events r ON r.id = d.roll_id
    WHERE d.state IN ('pending', 'retryable_failed')
      AND (d.next_attempt_at_ms IS NULL OR d.next_attempt_at_ms <= ?)
      AND (d.attempts < 5)
      AND (? = 1 OR EXISTS (SELECT 1 FROM campaign_members m
        WHERE m.campaign_id = r.campaign_id AND m.account_id = ? AND m.role = ?
        AND (? = 'dm' OR EXISTS (SELECT 1 FROM character_access a
          WHERE a.character_id = r.character_id AND a.account_id = ?))))
    ORDER BY d.next_attempt_at_ms, r.created_at_ms LIMIT 1`)
    .bind(Date.now(), isSiteAdmin(actor) ? 1 : 0, actor.id, actor.role, actor.activeRole, actor.id).first<{ rollId: string }>();
  if (!next) return json({ processed: 0 });
  const state = await processDiscordDelivery(db, next.rollId, env.DISCORD_WEBHOOK_ENCRYPTION_KEY);
  return json({ processed: 1, rollId: next.rollId, state });
}
