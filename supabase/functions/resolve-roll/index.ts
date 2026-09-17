import { resolveRollPlan } from "@threepointpf/dice";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { saveIds } from "@threepointpf/rules-schema";
import { createCharacterRollPlan, resolveRollRequestSchema, type ResolveRollRequest, type RollPlanRequest } from "../../../packages/shared/src/index.ts";
import { createClient } from "@supabase/supabase-js";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

/**
 * Rebuilds the request that produced a plan purely from the plan's own
 * metadata, so the submitted raw die faces are resolved against a server-side
 * recomputation of authored state plus context. Client modifiers are ignored.
 */
function requestForMetadata(characterId: string, plan: ResolveRollRequest["plan"]): RollPlanRequest | null {
  const metadata = plan.metadata;
  if (!metadata) return null;
  if (metadata.kind === "save") {
    const saveId = saveIds.find((id) => metadata.target === `save.${id}`);
    return saveId ? { characterId, kind: "save", saveId } : null;
  }
  if (metadata.kind === "skill" && metadata.target.startsWith("skill."))
    return {
      characterId,
      kind: "skill",
      skillId: metadata.target.slice("skill.".length),
      ...(metadata.flags ? { flags: metadata.flags } : {}),
      ...(metadata.excludeFlags ? { excludeFlags: metadata.excludeFlags } : {}),
    };
  if (metadata.kind === "maneuver")
    return {
      characterId,
      kind: "maneuver",
      ...(metadata.maneuver ? { maneuver: metadata.maneuver } : {}),
      ...(metadata.flags ? { flags: metadata.flags } : {}),
      ...(metadata.excludeFlags ? { excludeFlags: metadata.excludeFlags } : {}),
    };
  if (metadata.kind === "attack" && metadata.attackId) {
    // An attack plan records one of the two attack actions. A maneuver action
    // belongs to a maneuver plan, so this combination cannot rebuild the plan
    // that was submitted and is rejected rather than reinterpreted.
    if (metadata.action === "maneuver") return null;
    return {
      characterId,
      kind: "attack",
      attackId: metadata.attackId,
      attackIndex: metadata.attackIndex ?? 0,
      ...(metadata.action ? { action: metadata.action } : {}),
      ...(metadata.attackIds ? { attackIds: metadata.attackIds } : {}),
      ...(metadata.maneuver ? { maneuver: metadata.maneuver } : {}),
      ...(metadata.touch !== undefined ? { touch: metadata.touch } : {}),
      ...(metadata.flags ? { flags: metadata.flags } : {}),
      ...(metadata.excludeFlags ? { excludeFlags: metadata.excludeFlags } : {}),
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
    const rollRequest = requestForMetadata(character.id, body.plan);
    const serverPlan = rollRequest ? createCharacterRollPlan(character, rollRequest, rulesCatalogs) : null;
    if (!serverPlan) return json({ error: "Unsupported roll plan" }, 400);
    const resolved = resolveRollPlan(serverPlan, body.faces);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error: historyError } = await client.from("roll_history").insert({ campaign_id: character.campaignId ?? "default", character_id: character.id, roll_plan: serverPlan, faces: body.faces, resolved });
    if (historyError) throw new Error(historyError.message);
    return json({ resolved });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to resolve roll" }, 400); }
});
