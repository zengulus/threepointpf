import { createClient } from "@supabase/supabase-js";
import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";

export async function loadCharacter(characterId: string, accessToken: string): Promise<CharacterInput> {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data: row, error } = await client.from("characters").select("*").eq("id", characterId).single();
  if (error || !row) throw new Error(error?.message ?? "Character not found");
  const [{ data: features, error: featureError }, { data: attacks, error: attackError }] = await Promise.all([
    client.from("character_features").select("*").eq("character_id", characterId),
    client.from("character_attacks").select("*").eq("character_id", characterId),
  ]);
  if (featureError || attackError) throw new Error(featureError?.message ?? attackError?.message ?? "Could not load character parts");
  return parseCharacterInput({ id: row.id, campaignId: row.campaign_id, name: row.name, baseAbilities: row.base_abilities, baseBab: row.base_bab ?? undefined, baseSaves: row.base_saves ?? undefined, baseHpBeforeConstitution: row.base_hp_before_con, hitDiceCount: row.hit_dice_count ?? undefined, advancementSlots: Array.isArray(row.advancement_slots) && row.advancement_slots.length > 0 ? row.advancement_slots : undefined, skillRanks: row.skill_ranks, skills: row.skill_configuration, damageTaken: row.damage_taken, temporaryHp: row.temporary_hp, baseLandSpeed: row.base_land_speed, features: (features ?? []).map((feature) => ({ id: feature.id, definitionId: feature.definition_id ?? undefined, name: feature.name, description: feature.description ?? undefined, enabled: feature.enabled, effects: feature.effects })), attacks: (attacks ?? []).map((attack) => attack.definition) });
}
