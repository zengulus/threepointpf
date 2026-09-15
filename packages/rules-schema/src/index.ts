import { z } from "zod";

export const abilityIds = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityId = (typeof abilityIds)[number];
export type AbilityScores = Record<AbilityId, number>;

export const saveIds = ["fortitude", "reflex", "will"] as const;
export type SaveId = (typeof saveIds)[number];

export const skillIds = [
  "acrobatics", "appraise", "bluff", "climb", "craft", "diplomacy",
  "disable-device", "disguise", "escape-artist", "fly", "handle-animal",
  "heal", "intimidate", "knowledge-arcana", "knowledge-dungeoneering",
  "knowledge-engineering", "knowledge-geography", "knowledge-history",
  "knowledge-local", "knowledge-nature", "knowledge-nobility", "knowledge-planes",
  "knowledge-religion", "linguistics", "perception", "perform", "profession",
  "ride", "sense-motive", "sleight-of-hand", "spellcraft", "stealth", "survival",
  "swim", "use-magic-device",
] as const;
export type SkillId = (typeof skillIds)[number] | (string & {});

export const abilityIdSchema = z.enum(abilityIds);
export const saveIdSchema = z.enum(saveIds);
export const skillIdSchema = z.string().min(1);

export const bonusTypes = [
  "untyped", "dodge", "circumstance", "armor", "shield", "naturalArmor",
  "enhancement", "deflection", "resistance", "competence", "insight", "luck",
  "morale", "sacred", "profane", "size", "racial", "alchemical", "penalty",
] as const;
export type BonusType = (typeof bonusTypes)[number];

export type TargetId =
  | `ability.${AbilityId}`
  | `save.${SaveId}`
  | "ac"
  | "ac.natural"
  | "hp"
  | "initiative"
  | "cmb"
  | "cmd"
  | "attack.melee"
  | "damage.melee"
  | "attack.ranged"
  | "damage.ranged"
  | "casterLevel"
  | "size.relative"
  | "speed.land"
  | "speed.fly"
  | "speed.swim"
  | "speed.climb"
  | "speed.burrow"
  | "skill.all"
  | `skill.${string}`;

export type DefenseContext = "normal" | "touch" | "flatFooted";

export type AttackTag =
  | "weapon.melee"
  | "weapon.ranged"
  | "weapon.two-handed"
  | "weapon.off-hand"
  | "natural.attack";

export const targetRegistry = {
  abilities: abilityIds.map((id) => `ability.${id}`),
  saves: saveIds.map((id) => `save.${id}`),
  derived: ["ac", "ac.natural", "hp", "initiative", "cmb", "cmd", "casterLevel", "size.relative"],
  combat: ["attack.melee", "damage.melee", "attack.ranged", "damage.ranged"],
  movement: ["speed.land", "speed.fly", "speed.swim", "speed.climb", "speed.burrow"],
  skills: ["skill.all"],
} as const;
const staticTargetIds = new Set<string>(Object.values(targetRegistry).flat());
export function isTargetId(value: string): value is TargetId {
  return staticTargetIds.has(value) || value.startsWith("skill.") && value.length > 6;
}

export interface SourceReference {
  id: string;
  label: string;
}

export interface AcModifierEffect {
  kind: "modifier";
  target: "ac";
  value: number;
  bonusType: BonusType;
  /** AC applicability is explicit and independent of bonus type. */
  appliesTo: DefenseContext[];
  source?: SourceReference;
}

export interface NonAcModifierEffect {
  kind: "modifier";
  target: Exclude<TargetId, "ac">;
  value: number;
  bonusType: BonusType;
  source?: SourceReference;
}

export type ModifierEffect = AcModifierEffect | NonAcModifierEffect;

export interface ReplaceBaseEffect {
  kind: "replaceBase";
  target: TargetId;
  value: number;
  source?: SourceReference;
}

export interface GrantEffect {
  kind: "grant";
  target: TargetId;
  grant: string;
  source?: SourceReference;
}

export type Effect = ModifierEffect | GrantEffect | ReplaceBaseEffect;
export type EffectDefinition = Effect;

export interface FeatureDefinition {
  id: string;
  name: string;
  description?: string;
  effects: EffectDefinition[];
}

export interface FeatureInstance {
  id: string;
  definitionId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  effects: EffectDefinition[];
}

export interface SkillConfiguration {
  governingAbility: AbilityId;
  classSkill?: boolean;
  miscellaneous?: number;
  armorAndSize?: number;
}

export interface DiceExpression {
  count: number;
  sides: number;
}

export interface AttackDefinition {
  id: string;
  name: string;
  attackAbility: AbilityId;
  damageAbility?: AbilityId;
  damageAbilityMultiplier?: number;
  baseDamage: DiceExpression;
  weaponBonus?: number;
  /** Classification only; tags do not carry numeric rules semantics. */
  attackTags?: AttackTag[];
  mode?: "melee" | "ranged";
}

export const babProgressions = ["full", "threeQuarters", "half", "quarter"] as const;
export type BabProgression = (typeof babProgressions)[number];
export const saveProgressions = ["good", "poor"] as const;
export type SaveProgression = (typeof saveProgressions)[number];

/** A deliberately small class-like progression definition; it is not a class corpus. */
export interface ProgressionDefinition {
  id: string;
  name: string;
  hitDieSides: number;
  babProgression: BabProgression;
  saveProgressions: Record<SaveId, SaveProgression>;
  skillPointsPerLevel?: number;
}

/** One progression choice occupying one level on one advancement track. */
export interface AdvancementEntry {
  progressionId: string;
}

/** A named lane through the ordered slots (one lane for normal, two for gestalt, etc.). */
export interface AdvancementTrack {
  id: string;
  entry: AdvancementEntry;
}

/** Array order is character level order; each slot may contain any number of tracks. */
export interface AdvancementSlot {
  id: string;
  tracks: AdvancementTrack[];
}

export interface CharacterInput {
  id: string;
  campaignId?: string;
  name: string;
  baseAbilities: AbilityScores;
  /** Manual/legacy baseline. Omit in advancement mode. */
  baseBab?: number;
  /** Manual/legacy baseline. Omit in advancement mode. */
  baseSaves?: Record<SaveId, number>;
  /** Hit points from hit dice/other authored sources before the Constitution modifier is applied. */
  baseHpBeforeConstitution: number;
  /** Manual/legacy baseline. Advancement mode derives one HD per slot. */
  hitDiceCount?: number;
  /** Ordered advancement is present for structural progression mode. */
  advancementSlots?: AdvancementSlot[];
  skillRanks: Record<string, number>;
  skills?: Record<string, SkillConfiguration>;
  attacks: AttackDefinition[];
  features: FeatureInstance[];
  /** Mutable damage state; current HP is derived from max HP minus this value. */
  damageTaken: number;
  /** Temporary HP is tracked separately and does not increase max HP. */
  temporaryHp: number;
  baseLandSpeed?: number;
}

export const diceExpressionSchema = z.object({ count: z.number().int().positive(), sides: z.number().int().positive() });
export const sourceReferenceSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const targetIdSchema = z.string().min(1).refine(isTargetId, "Unknown target id") as z.ZodType<TargetId>;
const defenseContextSchema = z.enum(["normal", "touch", "flatFooted"]);
const acModifierSchema = z.object({ kind: z.literal("modifier"), target: z.literal("ac"), value: z.number(), bonusType: z.enum(bonusTypes), appliesTo: z.array(defenseContextSchema).min(1), source: sourceReferenceSchema.optional() });
const nonAcModifierSchema = z.object({ kind: z.literal("modifier"), target: targetIdSchema.refine((target) => target !== "ac", "AC modifiers require appliesTo"), value: z.number(), bonusType: z.enum(bonusTypes), source: sourceReferenceSchema.optional() });
export const effectSchema: z.ZodType<Effect> = z.union([
  acModifierSchema,
  nonAcModifierSchema,
  z.object({ kind: z.literal("replaceBase"), target: targetIdSchema, value: z.number(), source: sourceReferenceSchema.optional() }),
  z.object({ kind: z.literal("grant"), target: targetIdSchema, grant: z.string().min(1), source: sourceReferenceSchema.optional() }),
]) as z.ZodType<Effect>;
export const featureInstanceSchema: z.ZodType<FeatureInstance> = z.object({
  id: z.string().min(1), definitionId: z.string().optional(), name: z.string().min(1), description: z.string().optional(),
  enabled: z.boolean(), effects: z.array(effectSchema),
});
export const attackDefinitionSchema: z.ZodType<AttackDefinition> = z.object({
  id: z.string().min(1), name: z.string().min(1), attackAbility: abilityIdSchema,
  damageAbility: abilityIdSchema.optional(), damageAbilityMultiplier: z.number().optional(), baseDamage: diceExpressionSchema,
  weaponBonus: z.number().optional(), attackTags: z.array(z.enum(["weapon.melee", "weapon.ranged", "weapon.two-handed", "weapon.off-hand", "natural.attack"])).optional(), mode: z.enum(["melee", "ranged"]).optional(),
});
export const progressionDefinitionSchema: z.ZodType<ProgressionDefinition> = z.object({
  id: z.string().min(1), name: z.string().min(1), hitDieSides: z.number().int().positive(),
  babProgression: z.enum(babProgressions),
  saveProgressions: z.object({ fortitude: z.enum(saveProgressions), reflex: z.enum(saveProgressions), will: z.enum(saveProgressions) }),
  skillPointsPerLevel: z.number().nonnegative().optional(),
});
export const advancementEntrySchema: z.ZodType<AdvancementEntry> = z.object({ progressionId: z.string().min(1) });
export const advancementTrackSchema: z.ZodType<AdvancementTrack> = z.object({ id: z.string().min(1), entry: advancementEntrySchema });
export const advancementSlotSchema: z.ZodType<AdvancementSlot> = z.object({ id: z.string().min(1), tracks: z.array(advancementTrackSchema).min(1) }).superRefine((slot, context) => {
  const ids = new Set<string>();
  for (const track of slot.tracks) {
    if (ids.has(track.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: `Duplicate advancement track id ${track.id} in slot ${slot.id}` });
    ids.add(track.id);
  }
});
export const advancementSlotsSchema = z.array(advancementSlotSchema).min(1);
export const characterInputSchema: z.ZodType<CharacterInput> = z.object({
  id: z.string().min(1), campaignId: z.string().optional(), name: z.string().min(1),
  baseAbilities: z.object({ str: z.number(), dex: z.number(), con: z.number(), int: z.number(), wis: z.number(), cha: z.number() }), baseBab: z.number().optional(),
  baseSaves: z.object({ fortitude: z.number(), reflex: z.number(), will: z.number() }).optional(), baseHpBeforeConstitution: z.number(), hitDiceCount: z.number().int().positive().optional(), advancementSlots: advancementSlotsSchema.optional(),
  skillRanks: z.record(z.number()), skills: z.record(z.object({ governingAbility: abilityIdSchema, classSkill: z.boolean().optional(), miscellaneous: z.number().optional(), armorAndSize: z.number().optional() })).optional(),
  attacks: z.array(attackDefinitionSchema), features: z.array(featureInstanceSchema), damageTaken: z.number().int().nonnegative(), temporaryHp: z.number().int().nonnegative(), baseLandSpeed: z.number().optional(),
}).superRefine((character, context) => {
  const advancementMode = Boolean(character.advancementSlots?.length);
  if (!advancementMode && character.baseBab === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseBab"], message: "baseBab is required in manual mode" });
  if (!advancementMode && character.baseSaves === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseSaves"], message: "baseSaves is required in manual mode" });
  if (!advancementMode && character.hitDiceCount === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["hitDiceCount"], message: "hitDiceCount is required in manual mode" });
  const replacements = new Map<string, number>();
  for (const feature of character.features) {
    if (!feature.enabled) continue;
    for (const effect of feature.effects) {
      if (effect.kind !== "replaceBase") continue;
      const count = replacements.get(effect.target) ?? 0;
      replacements.set(effect.target, count + 1);
      if (count > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: `Ambiguous active baseline replacements for ${effect.target}` });
    }
  }
});

export function parseCharacterInput(value: unknown): CharacterInput {
  return characterInputSchema.parse(value);
}

export interface Contribution {
  target: TargetId;
  value: number;
  label: string;
  source: string;
  bonusType?: BonusType;
  appliesTo?: DefenseContext[];
  /** Nested evidence for a derived contribution, such as STR modifier ← STR score ← Rage. */
  children?: Contribution[];
  note?: string;
}

export interface EvaluationResult {
  target: TargetId;
  value: number;
  contributions: Contribution[];
  context?: DefenseContext;
}

export interface DamageEvaluation {
  formula: string;
  dice: DiceExpression;
  modifier: number;
  contributions: Contribution[];
}

export interface DerivedSkill {
  id: SkillId;
  label: string;
  total: EvaluationResult;
  ranks: number;
  governingAbility: AbilityId;
  classSkill: boolean;
}

export interface AdvancementSummary {
  slotCount: number;
  trackIds: string[];
  hitDiceCount: number;
  /** Best available die type per ordered slot; HP-from-HD remains a later layer. */
  hitDieSides: number[];
  skillPoints: number;
}

export interface DerivedAttack {
  definition: AttackDefinition;
  attack: EvaluationResult;
  damage: DamageEvaluation;
}

export interface DerivedCharacter {
  input: CharacterInput;
  grants: GrantedCapability[];
  abilities: Record<AbilityId, { score: EvaluationResult; modifier: EvaluationResult }>;
  maxHp: EvaluationResult;
  advancement?: AdvancementSummary;
  /** Derived from max HP and authored damage; it intentionally changes when max HP changes. */
  currentHp: number;
  damageTaken: number;
  temporaryHp: number;
  saves: Record<SaveId, EvaluationResult>;
  ac: EvaluationResult;
  touchAc: EvaluationResult;
  flatFootedAc: EvaluationResult;
  initiative: EvaluationResult;
  cmb: EvaluationResult;
  cmd: EvaluationResult;
  skills: Record<string, DerivedSkill>;
  movement: EvaluationResult;
  attacks: DerivedAttack[];
}

export interface GrantedCapability {
  target: TargetId;
  grant: string;
  source: SourceReference;
}

export const targetLabels: Record<string, string> = {
  "ability.str": "Strength", "ability.dex": "Dexterity", "ability.con": "Constitution", "ability.int": "Intelligence", "ability.wis": "Wisdom", "ability.cha": "Charisma",
  "save.fortitude": "Fortitude", "save.reflex": "Reflex", "save.will": "Will", ac: "Armor Class", "ac.natural": "Natural Armor", hp: "Hit points", initiative: "Initiative",
  cmb: "CMB", cmd: "CMD", "attack.melee": "Melee attack", "damage.melee": "Melee damage", "attack.ranged": "Ranged attack", "damage.ranged": "Ranged damage",
  casterLevel: "Caster level", "size.relative": "Relative size", "speed.land": "Land speed", "speed.fly": "Fly speed", "speed.swim": "Swim speed", "speed.climb": "Climb speed", "speed.burrow": "Burrow speed", "skill.all": "All skills",
};
