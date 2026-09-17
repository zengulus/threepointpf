import { resolveRollPlan } from "@threepointpf/dice";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { RollContext } from "@threepointpf/rules-schema";
import { createCharacterRollPlan, resolveRollRequestSchema, type ResolveRollRequest, type RollPlanRequest } from "../../../packages/shared/src/index.ts";
import { createClient } from "@supabase/supabase-js";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

/** The two attack-roll actions; a maneuver action is never an attack roll. */
function isAttackAction(kind: RollContext["action"]["kind"]): kind is "standardAttack" | "fullAttack" {
  return kind === "standardAttack" || kind === "fullAttack";
}

/**
 * Rebuilds the request that produced a plan purely from the plan's own declared
 * context, so the submitted raw die faces are resolved against a server-side
 * recomputation of authored state plus that context. The submitted modifier and
 * provenance are ignored: a client cannot influence the outcome's arithmetic.
 *
 * A context that this endpoint cannot rebuild (an attack roll belonging to a
 * maneuver action, or a roll with no identity of its own) returns null rather
 * than being guessed at.
 */
function requestForContext(characterId: string, context: RollContext): RollPlanRequest | null {
  const target = context.target;
  const shared = {
    ...(context.flags?.length ? { flags: context.flags } : {}),
    ...(context.excludeFlags?.length ? { excludeFlags: context.excludeFlags } : {}),
    ...(target?.defense ? { defense: target.defense } : {}),
    ...(target && (target.characterId || target.name)
      ? {
          target: {
            ...(target.characterId ? { characterId: target.characterId } : {}),
            ...(target.name ? { name: target.name } : {}),
          },
        }
      : {}),
  };
  if (context.kind === "save")
    return context.saveId
      ? { characterId, kind: "save", saveId: context.saveId, ...shared }
      : null;
  if (context.kind === "skill")
    return context.skillId
      ? { characterId, kind: "skill", skillId: context.skillId, ...shared }
      : null;
  if (context.kind === "maneuver")
    return {
      characterId,
      kind: "maneuver",
      ...(context.maneuver ? { maneuver: context.maneuver } : {}),
      ...shared,
    };
  if (context.kind === "initiative") {
    // Initiative is compared against nothing; any defense a submitted plan
    // carries is rejected by the request schema rather than ignored.
    return { characterId, kind: "initiative", ...shared };
  }
  if (context.kind === "damage") {
    if (!context.attackId || !isAttackAction(context.action.kind)) return null;
    return {
      characterId,
      kind: "damage",
      attackId: context.attackId,
      attackIndex: context.action.sequenceIndex ?? 0,
      action: context.action.kind,
      ...(context.action.attackIds ? { attackIds: context.action.attackIds } : {}),
      ...(context.touch !== undefined ? { touch: context.touch } : {}),
      ...(context.criticalDamage ? { criticalDamage: true } : {}),
      ...shared,
    };
  }
  if (context.kind === "attack") {
    if (!context.attackId || !isAttackAction(context.action.kind)) return null;
    return {
      characterId,
      kind: "attack",
      attackId: context.attackId,
      attackIndex: context.action.sequenceIndex ?? 0,
      action: context.action.kind,
      ...(context.action.attackIds ? { attackIds: context.action.attackIds } : {}),
      ...(context.touch !== undefined ? { touch: context.touch } : {}),
      ...(context.maneuver ? { maneuver: context.maneuver } : {}),
      ...shared,
    };
  }
  return null;
}

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const body = resolveRollRequestSchema.parse(await request.json()) as ResolveRollRequest;
    const character = await loadCharacter(body.plan.characterId, token, rulesCatalogs);
    const rollRequest = requestForContext(character.id, body.plan.context);
    const serverPlan = rollRequest ? createCharacterRollPlan(character, rollRequest, rulesCatalogs) : null;
    if (!serverPlan) return json({ error: "Unsupported roll plan" }, 400);
    const resolved = resolveRollPlan(serverPlan, body.faces);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error: historyError } = await client.from("roll_history").insert({ campaign_id: character.campaignId ?? "default", character_id: character.id, roll_plan: serverPlan, faces: body.faces, resolved });
    if (historyError) throw new Error(historyError.message);
    return json({ resolved });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to resolve roll" }, 400); }
});
