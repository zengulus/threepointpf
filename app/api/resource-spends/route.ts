import { env, waitUntil } from "cloudflare:workers";
import { resolveRollPlan } from "@threepointpf/dice";
import { createRechargeRollPlan, RulesEngine, spendResource, type ResourceFacts } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";
import { hostedResourceSpendRequestSchema, type HostedResourceSpendResponse } from "@threepointpf/shared";
import { getDb } from "../../../db";
import { currentAccount, digestHex, error, json, readObject, sameOrigin, sessionRequired } from "../../../lib/accounts";
import { mayEditCharacter, mayReadCharacter } from "../../../lib/character-access";
import { processDiscordDelivery } from "../../../lib/discord-delivery";
import { loadRollEvent, ROLL_RULES_VERSION, secureRollFaces, storedRollResponse } from "../../../lib/roll-events";

const MAX_ROLLS_PER_MINUTE = 60;

async function responseForRecorded(db: D1Database, rollId: string): Promise<HostedResourceSpendResponse | null> {
  const [event, row] = await Promise.all([
    loadRollEvent(db, rollId),
    db.prepare("SELECT snapshot, revision FROM characters WHERE id = (SELECT character_id FROM roll_events WHERE id = ?)")
      .bind(rollId).first<{ snapshot: string; revision: number }>(),
  ]);
  if (!event || !row) return null;
  const response: HostedResourceSpendResponse = {
    ...storedRollResponse(event),
    character: parseCharacterInput(JSON.parse(row.snapshot)),
    revision: row.revision,
  };
  if (event.state === "pending")
    waitUntil(processDiscordDelivery(db, event.id, env.DISCORD_WEBHOOK_ENCRYPTION_KEY).catch(() => undefined));
  return response;
}

/** Spend one recharge-backed resource and record its dice in the same D1 batch. */
export async function POST(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const parsed = hostedResourceSpendRequestSchema.safeParse(await readObject(request, 8_000));
  if (!parsed.success) return error("validation", "Choose a valid resource spend and request ID.", 400);
  const input = parsed.data;
  const db = getDb();
  const requestJson = JSON.stringify(input);
  const requestHash = await digestHex(requestJson);

  const recover = async () => {
    const prior = await db.prepare("SELECT id, character_id AS characterId, request_hash AS requestHash FROM roll_events WHERE actor_id = ? AND client_request_id = ?")
      .bind(actor.id, input.clientRequestId).first<{ id: string; characterId: string; requestHash: string }>();
    if (!prior) return null;
    if (!await mayReadCharacter(actor, prior.characterId)) return error("not-found", "Roll not found.", 404);
    if (prior.requestHash !== requestHash) return error("conflict", "This request ID was already used for a different action.", 409);
    const recorded = await responseForRecorded(db, prior.id);
    return recorded ? json(recorded) : error("server", "The recorded resource spend could not be loaded.", 500);
  };
  const prior = await recover();
  if (prior) return prior;
  if (!await mayEditCharacter(actor, input.characterId)) return error("not-found", "Character not found.", 404);
  const row = await db.prepare("SELECT snapshot, revision FROM characters WHERE id = ?")
    .bind(input.characterId).first<{ snapshot: string; revision: number }>();
  if (!row) return error("not-found", "Character not found.", 404);
  if (row.revision !== input.expectedRevision) return error("conflict", "This character changed. Reload before spending.", 409);

  let characterAfter: CharacterInput;
  let plan;
  let result;
  try {
    const character = parseCharacterInput(JSON.parse(row.snapshot));
    const resource = character.resources?.find((item) => item.id === input.resourceId);
    if (!resource || resource.refresh.kind !== "rechargeRoll") throw new Error("Unknown recharge resource");
    const derived = new RulesEngine(character, rulesCatalogs).derive();
    const facts: ResourceFacts = {
      abilityModifier: (id, source = "current") => source === "base"
        ? Math.floor((character.baseAbilities[id] - 10) / 2)
        : derived.abilities[id].modifier.value,
      progressionLevel: (id) => derived.advancement?.progressionLevels[id]?.value ?? 0,
    };
    plan = createRechargeRollPlan(character, resource);
    result = resolveRollPlan(plan, secureRollFaces(plan));
    characterAfter = spendResource(character, input.resourceId, 1, facts, () => result.total);
  } catch {
    return error("validation", "This resource cannot be spent from the saved character.", 422);
  }
  const snapshot = JSON.stringify(characterAfter);
  const planJson = JSON.stringify(plan);
  const resultJson = JSON.stringify(result);
  if (snapshot.length > 1_000_000 || planJson.length > 128_000 || resultJson.length > 16_000)
    return error("validation", "This resource action is too large to record.", 422);

  const rollId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const createdAtMs = Date.now();
  try {
    const results = await db.batch([
      db.prepare(`UPDATE characters SET snapshot = ?, revision = revision + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND revision = ?
          AND NOT EXISTS (SELECT 1 FROM roll_events prior WHERE prior.actor_id = ? AND prior.client_request_id = ?)
          AND (SELECT COUNT(*) FROM roll_events recent WHERE recent.actor_id = ? AND recent.created_at_ms >= ?) < ?
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = ? AND
            ((? = 'dm' AND a.site_admin = 1) OR EXISTS (
              SELECT 1 FROM campaign_members m WHERE m.campaign_id = characters.campaign_id
                AND m.account_id = a.id AND m.role = a.role AND
                (? = 'dm' OR EXISTS (SELECT 1 FROM character_access x WHERE
                  x.character_id = characters.id AND x.account_id = a.id AND x.permission IN ('owner', 'editor')))
            )))`)
        .bind(snapshot, createdAt, actor.id, input.characterId, input.expectedRevision,
          actor.id, input.clientRequestId, actor.id, createdAtMs - 60_000, MAX_ROLLS_PER_MINUTE,
          actor.id, actor.activeRole, actor.activeRole),
      db.prepare(`INSERT INTO roll_events
        (id, actor_id, client_request_id, request_hash, character_id, campaign_id, character_name,
         character_revision, rules_version, request_json, plan_json, result_json, created_at, created_at_ms)
        SELECT ?, ?, ?, ?, c.id, c.campaign_id, c.name, ?, ?, ?, ?, ?, ?, ?
        FROM characters c WHERE c.id = ? AND c.revision = ? AND changes() = 1`)
        .bind(rollId, actor.id, input.clientRequestId, requestHash, input.expectedRevision,
          ROLL_RULES_VERSION, requestJson, planJson, resultJson, createdAt, createdAtMs,
          input.characterId, input.expectedRevision + 1),
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
      const winner = await recover();
      if (winner) return winner;
      if (!await mayEditCharacter(actor, input.characterId)) return error("not-found", "Character not found.", 404);
      const latest = await db.prepare("SELECT revision FROM characters WHERE id = ?").bind(input.characterId).first<{ revision: number }>();
      if (!latest || latest.revision !== input.expectedRevision) return error("conflict", "This character changed. Reload before spending.", 409);
      return error("rate-limited", "Too many rolls. Wait a minute before rolling again.", 429);
    }
    if (!results[1]?.meta.changes || !results[2]?.meta.changes)
      return error("server", "The resource action could not be verified. Reload before spending again.", 503);
  } catch {
    const winner = await recover();
    return winner ?? error("server", "The resource action could not be recorded. Retry with the same request ID.", 503);
  }
  const recorded = await responseForRecorded(db, rollId);
  return recorded ? json(recorded, 201) : error("server", "The recorded resource spend could not be loaded.", 500);
}
