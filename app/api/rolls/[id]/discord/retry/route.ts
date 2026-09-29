import { env } from "cloudflare:workers";
import { getDb } from "../../../../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired } from "../../../../../../lib/accounts";
import { mayReadCharacter } from "../../../../../../lib/character-access";
import { processDiscordDelivery, reconcileExpiredDelivery } from "../../../../../../lib/discord-delivery";
import { loadRollEvent, storedRollResponse } from "../../../../../../lib/roll-events";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const body = await readObject(request, 1_000);
  if (!body || Object.keys(body).some((key) => key !== "confirmPossibleDuplicate") || (body.confirmPossibleDuplicate !== undefined && body.confirmPossibleDuplicate !== true))
    return error("validation", "Invalid retry request.", 400);
  const { id } = await context.params;
  const db = getDb();
  let row = await loadRollEvent(db, id);
  if (!row || !await mayReadCharacter(actor, row.characterId)) return error("not-found", "Roll not found.", 404);
  await reconcileExpiredDelivery(db, id);
  row = await loadRollEvent(db, id);
  if (!row) return error("server", "The recorded roll could not be loaded.", 500);
  if (row.state === "sent" || row.state === "sending") return json(storedRollResponse(row));
  if (row.state === "delivery_unknown") {
    if (body.confirmPossibleDuplicate !== true) return error("delivery-unknown", "Discord may already have this roll. Check the channel, then confirm a possible duplicate before resending.", 409);
    const claim = await db.prepare(`UPDATE discord_deliveries SET state = 'pending', next_attempt_at_ms = ?,
      safe_error_code = NULL, updated_at = ? WHERE roll_id = ? AND state = 'delivery_unknown' AND attempts < 5`)
      .bind(Date.now(), new Date().toISOString(), id).run();
    if (!claim.meta.changes) return error("conflict", "This delivery changed while retrying. Refresh its status.", 409);
  } else if (row.state === "retryable_failed") {
    if (row.nextAttemptAtMs && row.nextAttemptAtMs > Date.now())
      return error("rate-limited", "Discord is rate limiting this channel. Wait before retrying.", 429);
  } else if (row.state !== "pending") {
    return error("conflict", "This roll cannot be resent to the current channel.", 409);
  }
  await processDiscordDelivery(db, id, env.DISCORD_WEBHOOK_ENCRYPTION_KEY);
  const current = await loadRollEvent(db, id);
  return current ? json(storedRollResponse(current)) : error("server", "The recorded roll could not be loaded.", 500);
}
