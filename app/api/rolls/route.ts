import { env, waitUntil } from "cloudflare:workers";
import { resolveRollPlan } from "@threepointpf/dice";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput } from "@threepointpf/rules-schema";
import { createCharacterRollPlan, hostedRollRequestSchema } from "@threepointpf/shared";
import { getDb } from "../../../db";
import { currentAccount, digestHex, error, json, readObject, sameOrigin, sessionRequired } from "../../../lib/accounts";
import { mayEditCharacter, mayReadCharacter } from "../../../lib/character-access";
import { processDiscordDelivery } from "../../../lib/discord-delivery";
import { loadRollEvent, ROLL_RULES_VERSION, secureRollFaces, storedRollResponse, type RollEventRow } from "../../../lib/roll-events";

const MAX_ROLLS_PER_MINUTE = 60;

/** Latest recorded results for one currently accessible character. */
export async function GET(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!characterId || characterId.length > 128) return error("validation", "Choose a character.", 400);
  if (!await mayReadCharacter(actor, characterId)) return error("not-found", "Character not found.", 404);
  const rows = await getDb().prepare(`SELECT r.id, r.actor_id AS actorId, r.client_request_id AS clientRequestId,
    r.request_hash AS requestHash, r.character_id AS characterId, r.character_name AS characterName,
    r.character_revision AS characterRevision, r.plan_json AS planJson, r.result_json AS resultJson,
    r.created_at AS createdAt, d.state, d.message_id AS messageId,
    d.next_attempt_at_ms AS nextAttemptAtMs, d.safe_error_code AS safeErrorCode
    FROM roll_events r JOIN discord_deliveries d ON d.roll_id = r.id
    WHERE r.character_id = ? ORDER BY r.created_at_ms DESC, r.id DESC LIMIT 20`)
    .bind(characterId).all<RollEventRow>();
  return json({ rolls: rows.results.map(storedRollResponse) });
}

function scheduleDelivery(db: D1Database, rollId: string, state: string) {
  if (state === "pending") waitUntil(processDiscordDelivery(db, rollId, env.DISCORD_WEBHOOK_ENCRYPTION_KEY).catch(() => undefined));
}

export async function POST(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const body = await readObject(request, 8_000);
  const parsed = hostedRollRequestSchema.safeParse(body);
  if (!parsed.success) return error("validation", "Choose a valid character action and request ID.", 400);
  const input = parsed.data;
  const db = getDb();
  const requestJson = JSON.stringify(input);
  const requestHash = await digestHex(requestJson);
  const prior = await db.prepare("SELECT id, character_id AS characterId, request_hash AS requestHash FROM roll_events WHERE actor_id = ? AND client_request_id = ?")
    .bind(actor.id, input.clientRequestId).first<{ id: string; characterId: string; requestHash: string }>();
  if (prior) {
    if (!await mayReadCharacter(actor, prior.characterId)) return error("not-found", "Roll not found.", 404);
    if (prior.requestHash !== requestHash) return error("conflict", "This request ID was already used for a different action.", 409);
    const stored = await loadRollEvent(db, prior.id);
    if (stored) scheduleDelivery(db, stored.id, stored.state);
    return stored ? json(storedRollResponse(stored)) : error("server", "The recorded roll could not be loaded.", 500);
  }
  if (!await mayEditCharacter(actor, input.characterId)) return error("not-found", "Character not found.", 404);
  const characterRow = await db.prepare("SELECT snapshot, revision, campaign_id AS campaignId, name FROM characters WHERE id = ?")
    .bind(input.characterId).first<{ snapshot: string; revision: number; campaignId: string; name: string }>();
  if (!characterRow) return error("not-found", "Character not found.", 404);
  if (characterRow.revision !== input.expectedRevision) return error("conflict", "This character changed. Reload before rolling.", 409);

  let plan;
  let result;
  try {
    const character = parseCharacterInput(JSON.parse(characterRow.snapshot));
    plan = createCharacterRollPlan(character, input.action, rulesCatalogs);
    const faces = secureRollFaces(plan);
    result = resolveRollPlan(plan, faces);
  } catch {
    return error("validation", "This action could not be rolled from the saved character.", 422);
  }
  const planJson = JSON.stringify(plan);
  const resultJson = JSON.stringify(result);
  if (planJson.length > 128_000 || resultJson.length > 16_000)
    return error("validation", "This roll is too large to record.", 422);

  const rollId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const createdAtMs = Date.now();
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO roll_events
        (id, actor_id, client_request_id, request_hash, character_id, campaign_id, character_name,
         character_revision, rules_version, request_json, plan_json, result_json, created_at, created_at_ms)
        SELECT ?, ?, ?, ?, c.id, c.campaign_id, c.name, c.revision, ?, ?, ?, ?, ?, ?
        FROM characters c JOIN accounts a ON a.id = ?
        WHERE c.id = ? AND c.revision = ?
          AND ((? = 'dm' AND a.site_admin = 1) OR EXISTS (
            SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.campaign_id
              AND m.account_id = a.id AND m.role = a.role AND
              (? = 'dm' OR EXISTS (SELECT 1 FROM character_access x WHERE
                x.character_id = c.id AND x.account_id = a.id AND x.permission IN ('owner', 'editor')))
          ))
          AND (SELECT COUNT(*) FROM roll_events recent WHERE recent.actor_id = ? AND recent.created_at_ms >= ?) < ?
        ON CONFLICT(actor_id, client_request_id) DO NOTHING`)
        .bind(rollId, actor.id, input.clientRequestId, requestHash, ROLL_RULES_VERSION, requestJson, planJson, resultJson, createdAt, createdAtMs,
          actor.id, input.characterId, input.expectedRevision, actor.activeRole, actor.activeRole,
          actor.id, createdAtMs - 60_000, MAX_ROLLS_PER_MINUTE),
      db.prepare(`INSERT INTO discord_deliveries
        (roll_id, campaign_id, connection_id, connection_version, state, attempts, next_attempt_at_ms, created_at, updated_at)
        SELECT r.id, r.campaign_id, d.connection_id, d.version,
          CASE WHEN d.enabled = 1 THEN 'pending' ELSE 'not_configured' END,
          0, CASE WHEN d.enabled = 1 THEN ? ELSE NULL END, ?, ?
        FROM roll_events r LEFT JOIN campaign_discord_connections d ON d.campaign_id = r.campaign_id AND d.enabled = 1
        WHERE r.id = ?`)
        .bind(createdAtMs, createdAt, createdAt, rollId),
    ]);
    if (!results[0]?.meta.changes) {
      const winner = await db.prepare("SELECT id, character_id AS characterId, request_hash AS requestHash FROM roll_events WHERE actor_id = ? AND client_request_id = ?")
        .bind(actor.id, input.clientRequestId).first<{ id: string; characterId: string; requestHash: string }>();
      if (winner) {
        if (!await mayReadCharacter(actor, winner.characterId)) return error("not-found", "Roll not found.", 404);
        if (winner.requestHash !== requestHash) return error("conflict", "This request ID was already used for a different action.", 409);
        const storedWinner = await loadRollEvent(db, winner.id);
        if (storedWinner) scheduleDelivery(db, storedWinner.id, storedWinner.state);
        return storedWinner ? json(storedRollResponse(storedWinner)) : error("server", "The recorded roll could not be loaded.", 500);
      }
      if (!await mayEditCharacter(actor, input.characterId)) return error("not-found", "Character not found.", 404);
      const latest = await db.prepare("SELECT revision FROM characters WHERE id = ?").bind(input.characterId).first<{ revision: number }>();
      if (!latest || latest.revision !== input.expectedRevision) return error("conflict", "This character changed. Reload before rolling.", 409);
      return error("rate-limited", "Too many rolls. Wait a minute before rolling again.", 429);
    }
  } catch {
    return error("server", "The roll could not be recorded. Try again with the same request ID.", 503);
  }
  const stored = await loadRollEvent(db, rollId);
  if (stored) scheduleDelivery(db, stored.id, stored.state);
  return stored ? json(storedRollResponse(stored), 201) : error("server", "The recorded roll could not be loaded.", 500);
}
