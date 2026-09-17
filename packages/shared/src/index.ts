import {
  mergeProgressionCatalogs,
  normalizeAdvancementSlots,
  parseCharacterInput,
  parseProgressionCatalog,
  type CharacterInput,
  type ProgressionCatalog,
} from "@threepointpf/rules-schema";
import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import { RulesEngine, type RulesEngineOptions } from "@threepointpf/rules-core";
import { z } from "zod";

export interface CharacterRepository {
  save(character: CharacterInput): Promise<void>;
  load(id: string): Promise<CharacterInput | null>;
}

/** A small structural subset keeps browser persistence testable without DOM globals. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Both forms are public on purpose: older callers pass just a progression
 * catalog, while the full form carries every data catalog used by RulesEngine.
 */
export type CharacterRulesInput = ProgressionCatalog | RulesEngineOptions;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRulesEngineOptions(
  value: CharacterRulesInput,
): value is RulesEngineOptions {
  // The known fields cover the current and near-term content catalogs. The
  // check deliberately does not inspect values, so an empty full options
  // object remains a valid manual-mode configuration.
  return (
    "progressionCatalog" in value ||
    "progressionAliases" in value ||
    "skillCatalog" in value ||
    "featureCatalog" in value ||
    "equipmentCatalog" in value ||
    "attackProfileCatalog" in value ||
    "experienceCatalog" in value
  );
}

function baseRulesOptions(input?: CharacterRulesInput): RulesEngineOptions {
  if (!input) return {};
  if (isRulesEngineOptions(input)) {
    return {
      ...input,
      ...(input.progressionCatalog
        ? {
            progressionCatalog: parseProgressionCatalog(
              input.progressionCatalog,
            ),
          }
        : {}),
    };
  }
  return { progressionCatalog: parseProgressionCatalog(input) };
}

function hasEntries(
  catalog: ProgressionCatalog | undefined,
): catalog is ProgressionCatalog {
  return Boolean(catalog && Object.keys(catalog).length > 0);
}

/**
 * Merges campaign/imported content with character-owned custom progressions.
 * The merge is intentionally performed at every authored boundary: custom
 * content travels with a character, while imported content remains injected.
 */
export function rulesOptionsForCharacter(
  character: CharacterInput,
  input?: CharacterRulesInput,
): RulesEngineOptions {
  const base = baseRulesOptions(input);
  const custom = character.customProgressions
    ? parseProgressionCatalog(character.customProgressions)
    : undefined;
  const imported = base.progressionCatalog;
  if (!hasEntries(imported) && !hasEntries(custom)) return base;
  const progressionCatalog = mergeProgressionCatalogs(
    imported ?? {},
    custom ?? {},
  );
  return { ...base, progressionCatalog };
}

/**
 * Validates persisted/user-authored state and returns canonical progression
 * ids. It never writes derived facts into the result.
 */
export function normalizeAuthoredCharacter(
  character: CharacterInput,
  input?: CharacterRulesInput,
): CharacterInput {
  const authored = parseCharacterInput(character);
  const rules = rulesOptionsForCharacter(authored, input);
  if (!authored.advancementSlots?.length) {
    new RulesEngine(authored, baseRulesOptions(input)).derive();
    return authored;
  }
  if (!rules.progressionCatalog) {
    throw new Error(
      "Advancement requires an injected progression catalog or customProgressions",
    );
  }
  const advancementSlots = normalizeAdvancementSlots(
    authored.advancementSlots,
    rules.progressionCatalog,
    rules.progressionAliases,
  );
  const canonical = parseCharacterInput({ ...authored, advancementSlots });
  new RulesEngine(canonical, baseRulesOptions(input)).derive();
  return canonical;
}

/** Useful for local development and deterministic persistence tests. */
export class InMemoryCharacterRepository implements CharacterRepository {
  private readonly records = new Map<string, CharacterInput>();
  private readonly rules: RulesEngineOptions;

  constructor(input?: CharacterRulesInput) {
    this.rules = baseRulesOptions(input);
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = normalizeAuthoredCharacter(character, this.rules);
    this.records.set(authored.id, clone(authored));
  }

  async load(id: string): Promise<CharacterInput | null> {
    const value = this.records.get(id);
    return value ? normalizeAuthoredCharacter(clone(value), this.rules) : null;
  }
}

function isStorageLike(value: unknown): value is StorageLike {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as StorageLike).getItem === "function" &&
    typeof (value as StorageLike).setItem === "function"
  );
}

function browserStorage(): StorageLike {
  const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!storage)
    throw new Error(
      "LocalStorageCharacterRepository requires browser localStorage or an injected StorageLike",
    );
  return storage;
}

/**
 * Browser persistence with the same validation/canonicalization boundary as
 * the server repositories. The overloads allow either legacy catalog-first or
 * storage-first construction, and tests can inject a tiny in-memory store.
 */
export class LocalStorageCharacterRepository implements CharacterRepository {
  private readonly storage: StorageLike;
  private readonly rules: RulesEngineOptions;
  private readonly prefix: string;

  constructor();
  constructor(
    input?: CharacterRulesInput,
    storage?: StorageLike,
    prefix?: string,
  );
  constructor(
    storage?: StorageLike,
    input?: CharacterRulesInput,
    prefix?: string,
  );
  constructor(
    first?: CharacterRulesInput | StorageLike,
    second?: CharacterRulesInput | StorageLike,
    prefix = "threepointpf.character.",
  ) {
    const firstIsStorage = isStorageLike(first);
    const secondIsStorage = isStorageLike(second);
    this.storage = firstIsStorage
      ? first
      : secondIsStorage
        ? second
        : browserStorage();
    const input = (firstIsStorage ? second : first) as
      | CharacterRulesInput
      | undefined;
    this.rules = baseRulesOptions(input);
    this.prefix = prefix;
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = normalizeAuthoredCharacter(character, this.rules);
    this.storage.setItem(this.key(authored.id), JSON.stringify(authored));
  }

  async load(id: string): Promise<CharacterInput | null> {
    const raw = this.storage.getItem(this.key(id));
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Stored character ${id} is not valid JSON`);
    }
    return normalizeAuthoredCharacter(parsed as CharacterInput, this.rules);
  }
}

export interface SupabaseClientLike {
  from(table: string): any;
}

function isSnapshot(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stores a canonical CharacterInput snapshot on `characters`. Legacy columns
 * remain projected for old database rows/readers, but feature/attack child
 * writes are intentionally not part of modern saves: the single snapshot is
 * the atomic authority for all authored fields.
 */
export class SupabaseCharacterRepository implements CharacterRepository {
  private readonly rules: RulesEngineOptions;

  constructor(
    private readonly client: SupabaseClientLike,
    input?: CharacterRulesInput,
  ) {
    this.rules = baseRulesOptions(input);
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = normalizeAuthoredCharacter(character, this.rules);
    const campaignId = authored.campaignId ?? "default";
    const { error: campaignError } = await this.client
      .from("campaigns")
      .upsert({
        id: campaignId,
        name: campaignId === "default" ? "Default campaign" : campaignId,
      });
    if (campaignError) throw campaignError;

    const { error: characterError } = await this.client
      .from("characters")
      .upsert({
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
        base_land_speed:
          authored.baseSpeeds?.land ?? authored.baseLandSpeed ?? 30,
        authored_state: clone(authored),
      });
    if (characterError) throw characterError;
  }

  async load(id: string): Promise<CharacterInput | null> {
    const { data: row, error } = await this.client
      .from("characters")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;

    if (row.authored_state != null) {
      if (!isSnapshot(row.authored_state))
        throw new Error(
          "Invalid authored_state snapshot; refusing stale legacy fallback",
        );
      return normalizeAuthoredCharacter(
        {
          ...row.authored_state,
          // Database identity wins over mutable JSON fields.
          id: row.id,
          campaignId: row.campaign_id ?? undefined,
        } as CharacterInput,
        this.rules,
      );
    }

    // Pre-snapshot rows retain the normalized v0 layout. Keep this fallback
    // until all existing deployments have performed a save through this code.
    const [
      { data: featureRows, error: featureError },
      { data: attackRows, error: attackError },
    ] = await Promise.all([
      this.client.from("character_features").select("*").eq("character_id", id),
      this.client.from("character_attacks").select("*").eq("character_id", id),
    ]);
    if (featureError) throw featureError;
    if (attackError) throw attackError;
    return normalizeAuthoredCharacter(
      {
        id: row.id,
        campaignId: row.campaign_id ?? undefined,
        name: row.name,
        baseAbilities: row.base_abilities,
        baseBab: row.base_bab ?? undefined,
        baseSaves: row.base_saves ?? undefined,
        baseHpBeforeConstitution: row.base_hp_before_con,
        hitDiceCount: row.hit_dice_count ?? undefined,
        advancementSlots:
          Array.isArray(row.advancement_slots) &&
          row.advancement_slots.length > 0
            ? row.advancement_slots
            : undefined,
        skillRanks: row.skill_ranks,
        skills: row.skill_configuration,
        damageTaken: row.damage_taken,
        temporaryHp: row.temporary_hp,
        baseLandSpeed: row.base_land_speed,
        features: (featureRows ?? []).map((item: any) => ({
          id: item.id,
          definitionId: item.definition_id ?? undefined,
          name: item.name,
          description: item.description ?? undefined,
          enabled: item.enabled,
          effects: item.effects,
        })),
        attacks: (attackRows ?? []).map((item: any) => item.definition),
      } as CharacterInput,
      this.rules,
    );
  }
}

export interface RollPlanRequest {
  characterId: string;
  kind: "save" | "attack";
  saveId?: "fortitude" | "reflex" | "will";
  attackId?: string;
  /** Zero-based member of an attack's authoritative full-attack sequence. */
  attackIndex?: number;
}

export interface ResolveRollRequest {
  plan: RollPlan;
  faces: number[];
}

export interface ResolveRollResponse extends ResolvedRoll {}

export const rollPlanRequestSchema = z
  .object({
    characterId: z.string().min(1),
    kind: z.enum(["save", "attack"]),
    saveId: z.enum(["fortitude", "reflex", "will"]).optional(),
    attackId: z.string().min(1).optional(),
    attackIndex: z.number().int().nonnegative().optional(),
  })
  .superRefine((request, context) => {
    if (request.kind === "save") {
      if (!request.saveId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["saveId"],
          message: "saveId is required for a save roll",
        });
      if (request.attackId !== undefined || request.attackIndex !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attackId"],
          message: "attack fields are not valid for a save roll",
        });
      return;
    }
    if (!request.attackId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attackId"],
        message: "attackId is required for an attack roll",
      });
    if (request.saveId !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["saveId"],
        message: "saveId is not valid for an attack roll",
      });
  });
const rollPlanSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  label: z.string().min(1),
  dice: z
    .array(
      z.object({
        sides: z.number().int().positive(),
        count: z.number().int().positive(),
      }),
    )
    .min(1),
  modifier: z.number(),
  metadata: z
    .object({
      kind: z.enum(["save", "attack", "skill", "damage", "other"]),
      target: z.string().min(1),
      attackId: z.string().optional(),
      attackIndex: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export const resolveRollRequestSchema = z.object({
  plan: rollPlanSchema,
  faces: z.array(z.number().int()).min(1),
});

export const rollPlanEndpoint = "/roll-plan";
export const resolveRollEndpoint = "/resolve-roll";

function mergedRollRules(
  input?: CharacterRulesInput,
  extra?: RulesEngineOptions,
): RulesEngineOptions {
  const initial = baseRulesOptions(input);
  if (!extra) return initial;
  return {
    ...initial,
    ...extra,
    // A legacy third-argument catalog remains valid when the optional fourth
    // argument supplies the other modern catalogs.
    progressionCatalog: extra.progressionCatalog ?? initial.progressionCatalog,
    progressionAliases: extra.progressionAliases ?? initial.progressionAliases,
    skillCatalog: extra.skillCatalog ?? initial.skillCatalog,
  };
}

/**
 * Shared authority path for browser and TTS. The third argument accepts the
 * original ProgressionCatalog or a full RulesEngineOptions; a fourth options
 * argument augments the legacy catalog form.
 */
export function createCharacterRollPlan(
  character: CharacterInput,
  request: RollPlanRequest,
  input?: CharacterRulesInput,
  extra?: RulesEngineOptions,
): RollPlan {
  request = rollPlanRequestSchema.parse(request);
  if (request.characterId !== character.id)
    throw new Error("Roll-plan character id does not match loaded character");
  const base = mergedRollRules(input, extra);
  const authored = normalizeAuthoredCharacter(character, base);
  const engine = new RulesEngine(authored, base);
  if (request.kind === "save" && request.saveId)
    return engine.createSaveRollPlan(request.saveId);
  if (request.kind === "attack" && request.attackId)
    return engine.createAttackRollPlan(
      request.attackId,
      request.attackIndex ?? 0,
    );
  throw new Error("A valid saveId or attackId is required");
}
