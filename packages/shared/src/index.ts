import { parseCharacterInput, parseProgressionCatalog, type CharacterInput } from "@threepointpf/rules-schema";
import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import type { ProgressionCatalog } from "@threepointpf/rules-schema";
import { z } from "zod";

export interface CharacterRepository {
  save(character: CharacterInput): Promise<void>;
  load(id: string): Promise<CharacterInput | null>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Structural character validation intentionally lives in rules-schema, while
 * content validation belongs at a boundary that has an injected catalog.
 * Keeping that distinction here lets manual/legacy repositories remain usable
 * while preventing a configured persistence path from storing a class id that
 * cannot be derived later.
 */
function parseAuthoredCharacter(character: CharacterInput, progressionCatalog?: ProgressionCatalog): CharacterInput {
  const authored = parseCharacterInput(character);
  if (!progressionCatalog) return authored;
  for (const slot of authored.advancementSlots ?? []) {
    for (const track of slot.tracks) {
      if (!progressionCatalog[track.entry.progressionId]) {
        throw new Error(`Unknown progression definition ${track.entry.progressionId} at advancement slot ${slot.id}, track ${track.id}`);
      }
    }
  }
  return authored;
}

/** Useful for local development and for proving persistence round trips without a backend. */
export class InMemoryCharacterRepository implements CharacterRepository {
  private readonly records = new Map<string, CharacterInput>();
  private readonly progressionCatalog?: ProgressionCatalog;

  constructor(progressionCatalog?: ProgressionCatalog) {
    this.progressionCatalog = progressionCatalog ? parseProgressionCatalog(progressionCatalog) : undefined;
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = parseAuthoredCharacter(character, this.progressionCatalog);
    this.records.set(authored.id, clone(authored));
  }
  async load(id: string): Promise<CharacterInput | null> {
    const value = this.records.get(id);
    return value ? parseAuthoredCharacter(clone(value), this.progressionCatalog) : null;
  }
}

export interface SupabaseClientLike {
  from(table: string): any;
}

/** Stores authored inputs only; derived values are intentionally never persisted. */
export class SupabaseCharacterRepository implements CharacterRepository {
  private readonly progressionCatalog?: ProgressionCatalog;

  constructor(private readonly client: SupabaseClientLike, progressionCatalog?: ProgressionCatalog) {
    this.progressionCatalog = progressionCatalog ? parseProgressionCatalog(progressionCatalog) : undefined;
  }

  async save(character: CharacterInput): Promise<void> {
    // The persistence boundary accepts authored state only and rejects an
    // ambiguous mixture of manual and advancement baselines before writing.
    const authored = parseAuthoredCharacter(character, this.progressionCatalog);
    const campaignId = authored.campaignId ?? "default";
    const { error: campaignError } = await this.client.from("campaigns").upsert({ id: campaignId, name: campaignId === "default" ? "Default campaign" : campaignId });
    if (campaignError) throw campaignError;
    const { error: characterError } = await this.client.from("characters").upsert({
      id: authored.id,
      campaign_id: campaignId,
      name: authored.name,
      base_abilities: authored.baseAbilities,
      base_bab: authored.baseBab ?? null,
      base_saves: authored.baseSaves ?? null,
      base_hp_before_con: authored.baseHpBeforeConstitution,
      hit_dice_count: authored.hitDiceCount ?? null,
      advancement_slots: authored.advancementSlots ?? [],
      skill_ranks: authored.skillRanks,
      skill_configuration: authored.skills ?? {},
      damage_taken: authored.damageTaken,
      temporary_hp: authored.temporaryHp,
      base_land_speed: authored.baseLandSpeed ?? 30,
    });
    if (characterError) throw characterError;
    const { error: featureDeleteError } = await this.client.from("character_features").delete().eq("character_id", authored.id);
    if (featureDeleteError) throw featureDeleteError;
    if (authored.features.length) {
      const { error } = await this.client.from("character_features").insert(authored.features.map((feature) => ({ character_id: authored.id, id: feature.id, definition_id: feature.definitionId ?? null, name: feature.name, description: feature.description ?? null, enabled: feature.enabled, effects: feature.effects })));
      if (error) throw error;
    }
    const { error: attackDeleteError } = await this.client.from("character_attacks").delete().eq("character_id", authored.id);
    if (attackDeleteError) throw attackDeleteError;
    if (authored.attacks.length) {
      const { error } = await this.client.from("character_attacks").insert(authored.attacks.map((attack) => ({ character_id: authored.id, id: attack.id, definition: attack })));
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
    return parseAuthoredCharacter({
      id: row.id, campaignId: row.campaign_id ?? undefined, name: row.name, baseAbilities: row.base_abilities,
      baseBab: row.base_bab ?? undefined, baseSaves: row.base_saves ?? undefined, baseHpBeforeConstitution: row.base_hp_before_con, hitDiceCount: row.hit_dice_count ?? undefined, advancementSlots: Array.isArray(row.advancement_slots) && row.advancement_slots.length > 0 ? row.advancement_slots : undefined, skillRanks: row.skill_ranks, skills: row.skill_configuration,
      damageTaken: row.damage_taken, temporaryHp: row.temporary_hp, baseLandSpeed: row.base_land_speed, features: (featureRows ?? []).map((item: any) => ({ id: item.id, definitionId: item.definition_id ?? undefined, name: item.name, description: item.description ?? undefined, enabled: item.enabled, effects: item.effects })),
      attacks: (attackRows ?? []).map((item: any) => item.definition),
    }, this.progressionCatalog);
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

/**
 * Shared authority path for browser and TTS roll-plan requests. Callers pass
 * the catalog explicitly, so an advancement character is always rehydrated
 * against the same content that powers the sheet.
 */
export function createCharacterRollPlan(character: CharacterInput, request: RollPlanRequest, progressionCatalog: ProgressionCatalog): RollPlan {
  if (request.characterId !== character.id) throw new Error("Roll-plan character id does not match loaded character");
  const engine = new RulesEngine(character, { progressionCatalog });
  if (request.kind === "save" && request.saveId) return engine.createSaveRollPlan(request.saveId);
  if (request.kind === "attack" && request.attackId) return engine.createAttackRollPlan(request.attackId);
  throw new Error("A valid saveId or attackId is required");
}
