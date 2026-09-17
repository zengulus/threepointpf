import { createClient } from "@supabase/supabase-js";
import type { RulesEngineOptions } from "@threepointpf/rules-core";
import { normalizeAuthoredCharacter } from "../../../packages/shared/src/index.ts";
import type { CharacterInput } from "@threepointpf/rules-schema";

/**
 * Reads either the modern atomic snapshot or the legacy normalized rows and
 * runs the same catalog-aware canonicalization boundary used by repositories.
 */
export async function loadCharacter(
  characterId: string,
  accessToken: string,
  rules?: RulesEngineOptions,
): Promise<CharacterInput> {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data: row, error } = await client.from("characters").select("*").eq("id", characterId).single();
  if (error || !row) throw new Error(error?.message ?? "Character not found");
  // New saves keep every authored field in one row-level snapshot.  It is
  // deliberately read before the legacy child tables so a partially failed
  // pre-snapshot write can never override a complete modern save.
  if (row.authored_state != null) {
    if (typeof row.authored_state !== "object" || Array.isArray(row.authored_state)) throw new Error("Invalid authored_state snapshot; refusing stale legacy fallback");
    return normalizeAuthoredCharacter({
      ...row.authored_state,
      // Row identity comes from the authenticated database query, not JSON.
      id: row.id,
      campaignId: row.campaign_id ?? undefined,
    } as CharacterInput, rules);
  }
  const [{ data: features, error: featureError }, { data: attacks, error: attackError }] = await Promise.all([
    client.from("character_features").select("*").eq("character_id", characterId),
    client.from("character_attacks").select("*").eq("character_id", characterId),
  ]);
  if (featureError || attackError) throw new Error(featureError?.message ?? attackError?.message ?? "Could not load character parts");
  return normalizeAuthoredCharacter({ id: row.id, campaignId: row.campaign_id, name: row.name, baseAbilities: row.base_abilities, baseBab: row.base_bab ?? undefined, baseSaves: row.base_saves ?? undefined, baseHpBeforeConstitution: row.base_hp_before_con, hitDiceCount: row.hit_dice_count ?? undefined, advancementSlots: Array.isArray(row.advancement_slots) && row.advancement_slots.length > 0 ? row.advancement_slots : undefined, skillRanks: row.skill_ranks, skills: row.skill_configuration, damageTaken: row.damage_taken, temporaryHp: row.temporary_hp, baseLandSpeed: row.base_land_speed, features: (features ?? []).map((feature) => ({ id: feature.id, definitionId: feature.definition_id ?? undefined, name: feature.name, description: feature.description ?? undefined, enabled: feature.enabled, effects: feature.effects })), attacks: (attacks ?? []).map((attack) => attack.definition) } as CharacterInput, rules);
}
