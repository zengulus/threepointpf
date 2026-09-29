import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import type { HostedRollDeliveryState, HostedRollResponse } from "@threepointpf/shared";

export const ROLL_RULES_VERSION = "3pf-roll-v1";
const UINT32_RANGE = 0x1_0000_0000;

/** Rejection sampling avoids modulo bias; a missing cryptographic source fails closed. */
export function secureDieFace(sides: number, fill: (words: Uint32Array) => Uint32Array = (words) => crypto.getRandomValues(words)): number {
  if (!Number.isInteger(sides) || sides < 2 || sides > 10_000 || !globalThis.crypto?.getRandomValues)
    throw new Error("A secure dice source is unavailable.");
  const limit = Math.floor(UINT32_RANGE / sides) * sides;
  const words = new Uint32Array(1);
  let sample: number;
  do { sample = fill(words)[0]!; } while (sample >= limit);
  return (sample % sides) + 1;
}

export function secureRollFaces(plan: RollPlan, die: (sides: number) => number = secureDieFace): number[] {
  const count = plan.dice.reduce((sum, group) => sum + group.count, 0);
  if (plan.dice.length > 32 || count < 1 || count > 200 || plan.dice.some((group) => !Number.isInteger(group.count) || group.count < 1 || !Number.isInteger(group.sides) || group.sides < 2 || group.sides > 10_000))
    throw new Error("This roll has too many dice or unsupported sides.");
  const faces: number[] = [];
  for (const group of plan.dice) for (let index = 0; index < group.count; index++) faces.push(die(group.sides));
  return faces;
}

export interface RollEventRow {
  id: string;
  actorId: string;
  clientRequestId: string;
  requestHash: string;
  characterId: string;
  characterName: string;
  characterRevision: number;
  planJson: string;
  resultJson: string;
  createdAt: string;
  state: HostedRollDeliveryState;
  messageId: string | null;
  nextAttemptAtMs: number | null;
  safeErrorCode: string | null;
}

export function storedRollResponse(row: RollEventRow): HostedRollResponse {
  return {
    version: 1,
    rollId: row.id,
    clientRequestId: row.clientRequestId,
    characterId: row.characterId,
    characterName: row.characterName,
    characterRevision: row.characterRevision,
    createdAt: row.createdAt,
    plan: JSON.parse(row.planJson) as RollPlan,
    result: JSON.parse(row.resultJson) as ResolvedRoll,
    delivery: {
      state: row.state,
      ...(row.messageId ? { messageId: row.messageId } : {}),
      ...(row.nextAttemptAtMs ? { nextAttemptAtMs: row.nextAttemptAtMs } : {}),
      ...(row.safeErrorCode ? { safeErrorCode: row.safeErrorCode } : {}),
    },
  };
}

export async function loadRollEvent(db: D1Database, rollId: string): Promise<RollEventRow | null> {
  return await db.prepare(`SELECT r.id, r.actor_id AS actorId, r.client_request_id AS clientRequestId,
    r.request_hash AS requestHash, r.character_id AS characterId, r.character_name AS characterName,
    r.character_revision AS characterRevision, r.plan_json AS planJson, r.result_json AS resultJson,
    r.created_at AS createdAt, d.state, d.message_id AS messageId,
    d.next_attempt_at_ms AS nextAttemptAtMs, d.safe_error_code AS safeErrorCode
    FROM roll_events r JOIN discord_deliveries d ON d.roll_id = r.id WHERE r.id = ?`)
    .bind(rollId).first<RollEventRow>() ?? null;
}
