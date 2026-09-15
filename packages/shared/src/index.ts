import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";
import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import { z } from "zod";

export interface CharacterRepository {
  save(character: CharacterInput): Promise<void>;
  load(id: string): Promise<CharacterInput | null>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Useful for local development and for proving persistence round trips without a backend. */
export class InMemoryCharacterRepository implements CharacterRepository {
  private readonly records = new Map<string, CharacterInput>();
  async save(character: CharacterInput): Promise<void> { this.records.set(character.id, clone(character)); }
  async load(id: string): Promise<CharacterInput | null> { const value = this.records.get(id); return value ? clone(value) : null; }
}

export interface SupabaseClientLike {
  from(table: string): any;
}

/** Stores authored inputs only; derived values are intentionally never persisted. */
export class SupabaseCharacterRepository implements CharacterRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async save(character: CharacterInput): Promise<void> {
    const campaignId = character.campaignId ?? "default";
    const { error: campaignError } = await this.client.from("campaigns").upsert({ id: campaignId, name: campaignId === "default" ? "Default campaign" : campaignId });
    if (campaignError) throw campaignError;
    const { error: characterError } = await this.client.from("characters").upsert({
      id: character.id,
      campaign_id: campaignId,
      name: character.name,
      base_abilities: character.baseAbilities,
      base_bab: character.baseBab,
      base_saves: character.baseSaves,
      base_hp_before_con: character.baseHpBeforeConstitution,
      skill_ranks: character.skillRanks,
      skill_configuration: character.skills ?? {},
      current_hp: character.currentHp,
      base_land_speed: character.baseLandSpeed ?? 30,
    });
    if (characterError) throw characterError;
    const { error: featureDeleteError } = await this.client.from("character_features").delete().eq("character_id", character.id);
    if (featureDeleteError) throw featureDeleteError;
    if (character.features.length) {
      const { error } = await this.client.from("character_features").insert(character.features.map((feature) => ({ character_id: character.id, id: feature.id, definition_id: feature.definitionId ?? null, name: feature.name, description: feature.description ?? null, enabled: feature.enabled, effects: feature.effects })));
      if (error) throw error;
    }
    const { error: attackDeleteError } = await this.client.from("character_attacks").delete().eq("character_id", character.id);
    if (attackDeleteError) throw attackDeleteError;
    if (character.attacks.length) {
      const { error } = await this.client.from("character_attacks").insert(character.attacks.map((attack) => ({ character_id: character.id, id: attack.id, definition: attack })));
      if (error) throw error;
    }
  }

  async load(id: string): Promise<CharacterInput | null> {
    const { data: row, error } = await this.client.from("characters").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const { data: featureRows, error: featureError } = await this.client.from("character_features").select("*").eq("character_id", id);
    if (featureError) throw featureError;
    const { data: attackRows, error: attackError } = await this.client.from("character_attacks").select("*").eq("character_id", id);
    if (attackError) throw attackError;
    return parseCharacterInput({
      id: row.id, campaignId: row.campaign_id ?? undefined, name: row.name, baseAbilities: row.base_abilities, baseBab: row.base_bab,
      baseSaves: row.base_saves, baseHpBeforeConstitution: row.base_hp_before_con, skillRanks: row.skill_ranks, skills: row.skill_configuration,
      currentHp: row.current_hp, baseLandSpeed: row.base_land_speed, features: (featureRows ?? []).map((item: any) => ({ id: item.id, definitionId: item.definition_id ?? undefined, name: item.name, description: item.description ?? undefined, enabled: item.enabled, effects: item.effects })),
      attacks: (attackRows ?? []).map((item: any) => item.definition),
    });
  }
}

export interface RollPlanRequest {
  characterId: string;
  kind: "save" | "attack";
  saveId?: "fortitude" | "reflex" | "will";
  attackId?: string;
}

export interface ResolveRollRequest {
  plan: RollPlan;
  faces: number[];
}

export interface ResolveRollResponse extends ResolvedRoll {}

export const rollPlanRequestSchema = z.object({
  characterId: z.string().min(1), kind: z.enum(["save", "attack"]), saveId: z.enum(["fortitude", "reflex", "will"]).optional(), attackId: z.string().min(1).optional(),
});
const rollPlanSchema = z.object({
  id: z.string().min(1), characterId: z.string().min(1), label: z.string().min(1), dice: z.array(z.object({ sides: z.number().int().positive(), count: z.number().int().positive() })).min(1), modifier: z.number(), metadata: z.object({ kind: z.enum(["save", "attack", "skill", "damage", "other"]), target: z.string().min(1), attackId: z.string().optional() }).optional(),
});
export const resolveRollRequestSchema = z.object({ plan: rollPlanSchema, faces: z.array(z.number().int()).min(1) });

export const rollPlanEndpoint = "/roll-plan";
export const resolveRollEndpoint = "/resolve-roll";
