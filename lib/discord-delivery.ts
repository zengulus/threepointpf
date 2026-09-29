import { discordRollPayload, type HostedRollDeliveryState } from "@threepointpf/shared";
import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import { decryptDiscordWebhook } from "./discord-connection";

const LEASE_MS = 25_000;
const MAX_ATTEMPTS = 5;

type SendRow = {
  rollId: string;
  campaignId: string;
  characterName: string;
  planJson: string;
  resultJson: string;
  encryptedUrl: string;
};

type SendOutcome = { state: HostedRollDeliveryState; messageId?: string; nextAttemptAtMs?: number; safeErrorCode?: string };

export function retryDelayMs(response: Response, body: unknown): number {
  const payload = body && typeof body === "object" ? body as { retry_after?: unknown } : {};
  const header = Number(response.headers.get("Retry-After"));
  const seconds = Number.isFinite(header) && header > 0 ? header : Number(payload.retry_after);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3_600_000, Math.max(1_000, Math.ceil(seconds * 1_000))) : 30_000;
}

/** A claimed send with no recorded response might already be in Discord. */
export async function reconcileExpiredDelivery(db: D1Database, rollId?: string): Promise<void> {
  const now = Date.now();
  const statement = rollId
    ? db.prepare("UPDATE discord_deliveries SET state = 'delivery_unknown', safe_error_code = 'send_unconfirmed', lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE roll_id = ? AND state = 'sending' AND lease_expires_at_ms <= ?").bind(new Date(now).toISOString(), rollId, now)
    : db.prepare("UPDATE discord_deliveries SET state = 'delivery_unknown', safe_error_code = 'send_unconfirmed', lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE state = 'sending' AND lease_expires_at_ms <= ?").bind(new Date(now).toISOString(), now);
  await statement.run();
}

async function finish(db: D1Database, rollId: string, leaseToken: string, outcome: SendOutcome): Promise<void> {
  await db.prepare(`UPDATE discord_deliveries SET state = ?, message_id = ?, next_attempt_at_ms = ?,
    safe_error_code = ?, lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
    WHERE roll_id = ? AND state = 'sending' AND lease_token = ?`)
    .bind(outcome.state, outcome.messageId ?? null, outcome.nextAttemptAtMs ?? null,
      outcome.safeErrorCode ?? null, new Date().toISOString(), rollId, leaseToken).run();
}

/** At most one concurrent caller claims the row; no retry ever recomputes the roll. */
export async function processDiscordDelivery(
  db: D1Database,
  rollId: string,
  encryptionKey: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<HostedRollDeliveryState> {
  await reconcileExpiredDelivery(db, rollId);
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  if (!encryptionKey) {
    await db.prepare(`UPDATE discord_deliveries SET state = 'retryable_failed',
      safe_error_code = 'encryption_unavailable', next_attempt_at_ms = ?, updated_at = ?
      WHERE roll_id = ? AND state IN ('pending', 'retryable_failed')`)
      .bind(now + 300_000, nowText, rollId).run();
    return "retryable_failed";
  }
  const leaseToken = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE discord_deliveries SET state = 'sending', attempts = attempts + 1,
    lease_token = ?, lease_expires_at_ms = ?, safe_error_code = NULL, updated_at = ?
    WHERE roll_id = ? AND state IN ('pending', 'retryable_failed') AND attempts < ?
      AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?)
      AND EXISTS (SELECT 1 FROM campaign_discord_connections c
        WHERE c.campaign_id = discord_deliveries.campaign_id AND c.enabled = 1
          AND c.connection_id = discord_deliveries.connection_id
          AND c.version = discord_deliveries.connection_version)`)
    .bind(leaseToken, now + LEASE_MS, nowText, rollId, MAX_ATTEMPTS, now).run();
  if (!claim.meta.changes) {
    await db.prepare(`UPDATE discord_deliveries SET state = 'cancelled', safe_error_code = 'connection_changed',
      next_attempt_at_ms = NULL, updated_at = ? WHERE roll_id = ? AND state IN ('pending', 'retryable_failed')
      AND NOT EXISTS (SELECT 1 FROM campaign_discord_connections c
        WHERE c.campaign_id = discord_deliveries.campaign_id AND c.enabled = 1
          AND c.connection_id = discord_deliveries.connection_id
          AND c.version = discord_deliveries.connection_version)`)
      .bind(nowText, rollId).run();
    await db.prepare(`UPDATE discord_deliveries SET state = 'permanent_failed', safe_error_code = 'attempt_limit',
      next_attempt_at_ms = NULL, updated_at = ? WHERE roll_id = ? AND state = 'retryable_failed' AND attempts >= ?`)
      .bind(nowText, rollId, MAX_ATTEMPTS).run();
    const row = await db.prepare("SELECT state FROM discord_deliveries WHERE roll_id = ?").bind(rollId).first<{ state: HostedRollDeliveryState }>();
    return row?.state ?? "cancelled";
  }

  const row = await db.prepare(`SELECT r.id AS rollId, r.campaign_id AS campaignId,
    r.character_name AS characterName, r.plan_json AS planJson, r.result_json AS resultJson,
    c.encrypted_url AS encryptedUrl FROM discord_deliveries d
    JOIN roll_events r ON r.id = d.roll_id
    JOIN campaign_discord_connections c ON c.campaign_id = d.campaign_id
      AND c.connection_id = d.connection_id AND c.version = d.connection_version AND c.enabled = 1
    WHERE d.roll_id = ? AND d.state = 'sending' AND d.lease_token = ?`)
    .bind(rollId, leaseToken).first<SendRow>();
  if (!row) {
    await finish(db, rollId, leaseToken, { state: "cancelled", safeErrorCode: "connection_changed" });
    return "cancelled";
  }
  let webhook: string;
  try { webhook = await decryptDiscordWebhook(row.encryptedUrl, row.campaignId, encryptionKey); }
  catch {
    await finish(db, rollId, leaseToken, { state: "permanent_failed", safeErrorCode: "connection_unreadable" });
    return "permanent_failed";
  }
  const destination = new URL(webhook);
  destination.searchParams.set("wait", "true");
  const reference = rollId.slice(0, 12);
  const payload = discordRollPayload(row.characterName, JSON.parse(row.planJson) as RollPlan, JSON.parse(row.resultJson) as ResolvedRoll, reference);
  let response: Response;
  try {
    response = await fetcher(destination, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    await finish(db, rollId, leaseToken, { state: "delivery_unknown", safeErrorCode: "send_unconfirmed" });
    return "delivery_unknown";
  }
  if (response.ok) {
    const message = await response.json().catch(() => null) as { id?: unknown } | null;
    if (typeof message?.id === "string" && /^\d{15,22}$/.test(message.id)) {
      await finish(db, rollId, leaseToken, { state: "sent", messageId: message.id });
      return "sent";
    }
    await finish(db, rollId, leaseToken, { state: "delivery_unknown", safeErrorCode: "send_unconfirmed" });
    return "delivery_unknown";
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => null);
    await finish(db, rollId, leaseToken, { state: "retryable_failed", safeErrorCode: "discord_rate_limited", nextAttemptAtMs: Date.now() + retryDelayMs(response, body) });
    return "retryable_failed";
  }
  if (response.status >= 500) {
    await finish(db, rollId, leaseToken, { state: "delivery_unknown", safeErrorCode: "send_unconfirmed" });
    return "delivery_unknown";
  }
  await finish(db, rollId, leaseToken, { state: "permanent_failed", safeErrorCode: response.status === 404 ? "webhook_missing" : "discord_rejected" });
  return "permanent_failed";
}
