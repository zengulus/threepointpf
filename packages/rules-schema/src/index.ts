import { z } from "zod";

export const abilityIds = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityId = (typeof abilityIds)[number];
export type AbilityScores = Record<AbilityId, number>;

export const saveIds = ["fortitude", "reflex", "will"] as const;
export type SaveId = (typeof saveIds)[number];

export const skillIds = [
  "acrobatics",
  "appraise",
  "bluff",
  "climb",
  "craft",
  "diplomacy",
  "disable-device",
  "disguise",
  "escape-artist",
  "fly",
  "handle-animal",
  "heal",
  "intimidate",
  "knowledge-arcana",
  "knowledge-dungeoneering",
  "knowledge-engineering",
  "knowledge-geography",
  "knowledge-history",
  "knowledge-local",
  "knowledge-nature",
  "knowledge-nobility",
  "knowledge-planes",
  "knowledge-religion",
  "linguistics",
  "perception",
  "perform",
  "profession",
  "ride",
  "sense-motive",
  "sleight-of-hand",
  "spellcraft",
  "stealth",
  "survival",
  "swim",
  "use-magic-device",
] as const;
export type SkillId = (typeof skillIds)[number] | (string & {});

export const abilityIdSchema = z.enum(abilityIds);
export const saveIdSchema = z.enum(saveIds);
export const skillIdSchema = z.string().min(1);

/** Every persisted class/progression id is source-qualified. */
export const progressionIdPattern =
  /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){2,}$/;
export const progressionIdSchema = z
  .string()
  .regex(
    progressionIdPattern,
    "Progression ids must be stable, source-qualified ids such as pf1e.paizo.fighter",
  );

export const movementModes = [
  "land",
  "fly",
  "swim",
  "climb",
  "burrow",
] as const;
export type MovementMode = (typeof movementModes)[number];

export const sizeCategories = [
  "fine",
  "diminutive",
  "tiny",
  "small",
  "medium",
  "large",
  "huge",
  "gargantuan",
  "colossal",
] as const;
export type SizeCategory = (typeof sizeCategories)[number];

export const bonusTypes = [
  "untyped",
  "dodge",
  "circumstance",
  "armor",
  "shield",
  "naturalArmor",
  "enhancement",
  "deflection",
  "resistance",
  "competence",
  "insight",
  "luck",
  "morale",
  "sacred",
  "profane",
  "size",
  "racial",
  "alchemical",
  "penalty",
] as const;
export type BonusType = (typeof bonusTypes)[number];

export type TargetId =
  | `ability.${AbilityId}`
  | `save.${SaveId}`
  | "combat.bab"
  | "experience.level"
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
  | "attacks.extra.melee"
  | "attacks.extra.ranged"
  | "casterLevel"
  | "size.relative"
  | "speed.land"
  | "speed.fly"
  | "speed.swim"
  | "speed.climb"
  | "speed.burrow"
  | "skill.all"
  | `skill.${string}`
  /** A character-global level in a named progression, such as progression.fighter.level. */
  | `progression.${string}.level`;

/** Progression levels are derived queries and cannot be authored as effects. */
export type EffectTargetId = Exclude<
  TargetId,
  `progression.${string}.level` | "experience.level"
>;

export type DefenseContext = "normal" | "touch" | "flatFooted";

export type AttackTag =
  | "weapon.melee"
  | "weapon.ranged"
  | "weapon.two-handed"
  | "weapon.off-hand"
  | "natural.attack";

export interface AttackSelector {
  mode?: "melee" | "ranged";
  requiredTags?: AttackTag[];
  excludedTags?: AttackTag[];
}

/** A deliberately narrow scalar for BAB-stepped combat options. */
export interface BabStepScaling {
  kind: "babStep";
  every: number;
  base: number;
}

export const targetRegistry = {
  abilities: abilityIds.map((id) => `ability.${id}`),
  saves: saveIds.map((id) => `save.${id}`),
  derived: [
    "ac",
    "ac.natural",
    "hp",
    "initiative",
    "cmb",
    "cmd",
    "casterLevel",
    "size.relative",
  ],
  combatFacts: ["combat.bab"],
  experience: ["experience.level"],
  combat: [
    "attack.melee",
    "damage.melee",
    "attack.ranged",
    "damage.ranged",
    "attacks.extra.melee",
    "attacks.extra.ranged",
  ],
  movement: [
    "speed.land",
    "speed.fly",
    "speed.swim",
    "speed.climb",
    "speed.burrow",
  ],
  skills: ["skill.all"],
} as const;
const staticTargetIds = new Set<string>(Object.values(targetRegistry).flat());
export function isTargetId(value: string): value is TargetId {
  return (
    staticTargetIds.has(value) ||
    (value.startsWith("skill.") && value.length > 6) ||
    (value.startsWith("progression.") &&
      value.endsWith(".level") &&
      value.length > "progression..level".length)
  );
}

export interface SourceReference {
  id: string;
  label: string;
  content?: ProgressionSourceMetadata;
}

export interface AcModifierEffect {
  kind: "modifier";
  target: "ac";
  value: number;
  bonusType: BonusType;
  /** AC applicability is explicit and independent of bonus type. */
  appliesTo: DefenseContext[];
  source?: SourceReference;
  scaling?: BabStepScaling;
}

export interface NonAcModifierEffect {
  kind: "modifier";
  target: Exclude<EffectTargetId, "ac">;
  value: number;
  bonusType: BonusType;
  source?: SourceReference;
  scaling?: BabStepScaling;
  attackSelector?: AttackSelector;
  /** Movement increase limited to the intrinsic speed (Haste). */
  capToBase?: boolean;
}

export type ModifierEffect = AcModifierEffect | NonAcModifierEffect;

export interface ReplaceBaseEffect {
  kind: "replaceBase";
  target: EffectTargetId;
  value: number;
  source?: SourceReference;
}

/** Applied after baseline replacement and typed additive modifiers. */
export interface MultiplyEffect {
  kind: "multiply";
  target: EffectTargetId;
  factor: number;
  source?: SourceReference;
}

/** Applied after multiplication. Multiple minimums use the greatest value. */
export interface MinimumEffect {
  kind: "minimum";
  target: EffectTargetId;
  value: number;
  source?: SourceReference;
}

/** Applied after minimums. Multiple maximums use the least value. */
export interface MaximumEffect {
  kind: "maximum";
  target: EffectTargetId;
  value: number;
  source?: SourceReference;
}

export interface GrantEffect {
  kind: "grant";
  target: EffectTargetId;
  grant: string;
  source?: SourceReference;
}

export type Effect =
  | ModifierEffect
  | GrantEffect
  | ReplaceBaseEffect
  | MultiplyEffect
  | MinimumEffect
  | MaximumEffect;
export type EffectDefinition = Effect;

export interface FeatureDefinition {
  id: string;
  name: string;
  description?: string;
  effects: EffectDefinition[];
  source?: ProgressionSourceMetadata;
  /** Only the highest-priority active definition in a group applies. */
  exclusiveGroup?: string;
  priority?: number;
}

export type FeatureCatalog = Record<string, FeatureDefinition>;

export interface FeatureInstance {
  id: string;
  definitionId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  effects: EffectDefinition[];
}

export interface SkillConfiguration {
  /** An authored ability overrides catalog metadata. */
  governingAbility?: AbilityId;
  /** Legacy manual override; retained for persisted characters. */
  classSkill?: boolean;
  /** Explicit manual class-skill override, preferred for new authored data. */
  classSkillOverride?: boolean;
  miscellaneous?: number;
  armorAndSize?: number;
}

/** Imported skill semantics are content, not hard-coded class logic. */
export interface SkillDefinition {
  id: SkillId;
  name: string;
  governingAbility: AbilityId;
  trainedOnly?: boolean;
  armorCheckPenalty?: boolean;
  source?: ProgressionSourceMetadata;
}

export type SkillCatalog = Record<string, SkillDefinition>;

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
  /** Selectors can match tags; the tags themselves do not imply arithmetic. */
  attackTags?: AttackTag[];
  mode?: "melee" | "ranged";
  profileId?: string;
  attackBonus?: number;
  damageAbilityMaximum?: number;
  /** Natural attacks normally do not gain BAB iteratives. */
  iterative?: boolean;
  extraAttackEligible?: boolean;
  source?: ProgressionSourceMetadata;
}

export interface AttackProfileDefinition {
  id: string;
  name: string;
  description?: string;
  attackAbility: AbilityId;
  damageAbility?: AbilityId;
  damageAbilityMultiplier?: number;
  mode: "melee" | "ranged";
  attackTags: AttackTag[];
  attackBonus?: number;
  iterative?: boolean;
  extraAttackEligible?: boolean;
  source?: ProgressionSourceMetadata;
}
export type AttackProfileCatalog = Record<string, AttackProfileDefinition>;

export interface EquipmentDefinition {
  id: string;
  name: string;
  description?: string;
  kind: "armor" | "shield" | "weapon" | "wondrous" | "other";
  effects: Effect[];
  attack?: AttackDefinition;
  maxDexterity?: number;
  armorCheckPenalty?: number;
  reduceLandSpeed?: boolean;
  /** Retained source metadata; spellcasting failure is not evaluated yet. */
  arcaneSpellFailureChance?: number;
  weight?: number;
  source?: ProgressionSourceMetadata;
}
export type EquipmentCatalog = Record<string, EquipmentDefinition>;
export interface EquipmentInstance {
  id: string;
  definitionId?: string;
  name?: string;
  equipped: boolean;
  effects?: Effect[];
  attack?: AttackDefinition;
  maxDexterity?: number;
  armorCheckPenalty?: number;
  reduceLandSpeed?: boolean;
  weight?: number;
  quantity?: number;
}

export const babProgressions = [
  "full",
  "threeQuarters",
  "half",
  "quarter",
] as const;
export type BabProgression = (typeof babProgressions)[number];
export const saveProgressions = [
  "good",
  "poor",
  "prestigeGood",
  "prestigePoor",
] as const;
export type SaveProgression = (typeof saveProgressions)[number];

/** A named feature granted by a progression at a global progression level.
 *
 * Mechanics are applied only when explicitly authored as effects. Names and
 * descriptions never infer feat, spellcasting, or other feature mechanics.
 */
export interface ProgressionFeatureDefinition {
  id: string;
  name: string;
  level: number;
  description?: string;
  effects?: Effect[];
}

/** A source reference for imported progression content. */
export interface ProgressionSourceMetadata {
  document: string;
  sheet: string;
  system?: string;
  publisher?: string;
  category?: string;
  row?: number;
  range?: string;
}

/** Optional explicit cumulative values from a source class chart. */
export interface ProgressionChartLevel {
  level: number;
  bab: number;
  saves: Record<SaveId, number>;
}

/**
 * Content consumed by the progression evaluator. The evaluator owns level
 * ordering and aggregation; class/catalog packages own the facts below.
 */
export interface ProgressionDefinition {
  id: string;
  name: string;
  hitDieSides: number;
  babProgression: BabProgression;
  saveProgressions: Record<SaveId, SaveProgression>;
  skillPointsPerLevel?: number;
  classSkills?: string[];
  classSkillsSource?: ProgressionSourceMetadata;
  features?: ProgressionFeatureDefinition[];
  /** When present, the evaluator uses these cumulative values instead of the generic chassis formula. */
  chart?: ProgressionChartLevel[];
  /** Historical ids that are normalized to this source-qualified id on load. */
  aliases?: string[];
  source?: ProgressionSourceMetadata;
}

/** A data-owned catalog injected into the pure rules evaluator. */
export type ProgressionCatalog = Record<string, ProgressionDefinition>;

/** Compatibility aliases are separate from the canonical content catalog. */
export type ProgressionAliasMap = Record<string, string>;

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
  /** Character-owned classes, including explicit charts, travel with the save. */
  customProgressions?: ProgressionCatalog;
  /** XP is optional and advisory; it never creates advancement slots. */
  experience?: { points: number; trackId: string };
  skillRanks: Record<string, number>;
  skills?: Record<string, SkillConfiguration>;
  attacks: AttackDefinition[];
  features: FeatureInstance[];
  equipment?: EquipmentInstance[];
  /** Mutable damage state; current HP is derived from max HP minus this value. */
  damageTaken: number;
  /** Temporary HP is tracked separately and does not increase max HP. */
  temporaryHp: number;
  /** Legacy shorthand for baseSpeeds.land. */
  baseLandSpeed?: number;
  /** Base movement modes before data-authored effects are applied. */
  baseSpeeds?: Partial<Record<MovementMode, number>>;
  /** Structural size baseline; relative size effects adjust it in ordered steps. */
  baseSize?: SizeCategory;
}

export const diceExpressionSchema = z.object({
  count: z.number().finite().int().positive(),
  sides: z.number().finite().int().positive(),
});
export const sourceReferenceSchema: z.ZodType<SourceReference> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  content: z.lazy(() => progressionSourceMetadataSchema).optional(),
});
export const targetIdSchema = z
  .string()
  .min(1)
  .refine(isTargetId, "Unknown target id") as z.ZodType<TargetId>;
/** Progression levels are inspectable derived facts, never authorable effect targets. */
const effectTargetIdSchema = targetIdSchema.refine(
  (target) =>
    !target.startsWith("progression.") && target !== "experience.level",
  "Progression level targets and experience levels are query-only",
) as z.ZodType<EffectTargetId>;
const defenseContextSchema = z.enum(["normal", "touch", "flatFooted"]);
const attackTagSchema = z.enum([
  "weapon.melee",
  "weapon.ranged",
  "weapon.two-handed",
  "weapon.off-hand",
  "natural.attack",
]);
const attackSelectorSchema = z.object({
  mode: z.enum(["melee", "ranged"]).optional(),
  requiredTags: z.array(attackTagSchema).optional(),
  excludedTags: z.array(attackTagSchema).optional(),
});
const scalingSchema = z.object({
  kind: z.literal("babStep"),
  every: z.number().finite().int().positive(),
  base: z.number().finite().int(),
});
const acModifierSchema = z.object({
  kind: z.literal("modifier"),
  target: z.literal("ac"),
  value: z.number().finite(),
  bonusType: z.enum(bonusTypes),
  appliesTo: z.array(defenseContextSchema).min(1),
  source: sourceReferenceSchema.optional(),
  scaling: scalingSchema.optional(),
});
const nonAcModifierSchema = z.object({
  kind: z.literal("modifier"),
  target: effectTargetIdSchema.refine(
    (target) => target !== "ac",
    "AC modifiers require appliesTo",
  ),
  value: z.number().finite(),
  bonusType: z.enum(bonusTypes),
  source: sourceReferenceSchema.optional(),
  scaling: scalingSchema.optional(),
  attackSelector: attackSelectorSchema.optional(),
  capToBase: z.boolean().optional(),
});
export const effectSchema: z.ZodType<Effect> = z
  .union([
    acModifierSchema,
    nonAcModifierSchema,
    z.object({
      kind: z.literal("replaceBase"),
      target: effectTargetIdSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("multiply"),
      target: effectTargetIdSchema,
      factor: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("minimum"),
      target: effectTargetIdSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("maximum"),
      target: effectTargetIdSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("grant"),
      target: effectTargetIdSchema,
      grant: z.string().min(1),
      source: sourceReferenceSchema.optional(),
    }),
  ])
  .superRefine((effect, context) => {
    if (effect.target === "size.relative" && effect.kind !== "grant") {
      const value = effect.kind === "multiply" ? effect.factor : effect.value;
      if (!Number.isInteger(value))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Size-relative effects require integer category steps",
        });
    }
    if (effect.kind === "modifier") {
      if (
        effect.scaling &&
        ![
          "ac",
          "cmb",
          "cmd",
          "attack.melee",
          "attack.ranged",
          "damage.melee",
          "damage.ranged",
        ].includes(effect.target)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "BAB scaling is only supported on combat consumers, never BAB or its dependencies",
        });
      if (
        "attackSelector" in effect &&
        effect.attackSelector &&
        !/^(attack|damage|attacks\.extra)\.(melee|ranged)$/.test(effect.target)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attack selectors require an attack or damage target",
        });
      if (
        "capToBase" in effect &&
        effect.capToBase &&
        (!effect.target.startsWith("speed.") || effect.value < 0)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "capToBase is only supported for nonnegative movement increases",
        });
    }
  }) as z.ZodType<Effect>;
export const featureInstanceSchema: z.ZodType<FeatureInstance> = z.object({
  id: z.string().min(1),
  definitionId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  effects: z.array(effectSchema),
});
export const attackDefinitionSchema: z.ZodType<AttackDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  attackAbility: abilityIdSchema,
  damageAbility: abilityIdSchema.optional(),
  damageAbilityMultiplier: z.number().finite().optional(),
  baseDamage: diceExpressionSchema,
  weaponBonus: z.number().finite().optional(),
  attackTags: z.array(attackTagSchema).optional(),
  mode: z.enum(["melee", "ranged"]).optional(),
  profileId: z.string().min(1).optional(),
  attackBonus: z.number().finite().optional(),
  damageAbilityMaximum: z.number().finite().optional(),
  iterative: z.boolean().optional(),
  extraAttackEligible: z.boolean().optional(),
  source: z.lazy(() => progressionSourceMetadataSchema).optional(),
});
export const progressionFeatureDefinitionSchema: z.ZodType<ProgressionFeatureDefinition> =
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    level: z.number().finite().int().positive(),
    description: z.string().min(1).optional(),
    effects: z.array(effectSchema).optional(),
  });
export const progressionSourceMetadataSchema: z.ZodType<ProgressionSourceMetadata> =
  z.object({
    document: z.string().min(1),
    sheet: z.string().min(1),
    system: z.string().min(1).optional(),
    publisher: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    row: z.number().finite().int().positive().optional(),
    range: z.string().min(1).optional(),
  });
export const progressionChartLevelSchema: z.ZodType<ProgressionChartLevel> =
  z.object({
    level: z.number().finite().int().positive(),
    bab: z.number().finite().int().nonnegative(),
    saves: z.object({
      fortitude: z.number().finite().int().nonnegative(),
      reflex: z.number().finite().int().nonnegative(),
      will: z.number().finite().int().nonnegative(),
    }),
  });
export const featureDefinitionSchema: z.ZodType<FeatureDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  effects: z.array(effectSchema),
  source: progressionSourceMetadataSchema.optional(),
  exclusiveGroup: z.string().min(1).optional(),
  priority: z.number().finite().int().optional(),
});
export const attackProfileDefinitionSchema: z.ZodType<AttackProfileDefinition> =
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    attackAbility: abilityIdSchema,
    damageAbility: abilityIdSchema.optional(),
    damageAbilityMultiplier: z.number().finite().optional(),
    mode: z.enum(["melee", "ranged"]),
    attackTags: z.array(attackTagSchema),
    attackBonus: z.number().finite().optional(),
    iterative: z.boolean().optional(),
    extraAttackEligible: z.boolean().optional(),
    source: progressionSourceMetadataSchema.optional(),
  });
export const equipmentDefinitionSchema: z.ZodType<EquipmentDefinition> =
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["armor", "shield", "weapon", "wondrous", "other"]),
    effects: z.array(effectSchema),
    attack: attackDefinitionSchema.optional(),
    maxDexterity: z.number().finite().nonnegative().optional(),
    armorCheckPenalty: z.number().finite().nonpositive().optional(),
    reduceLandSpeed: z.boolean().optional(),
    arcaneSpellFailureChance: z.number().finite().min(0).max(1).optional(),
    weight: z.number().finite().nonnegative().optional(),
    source: progressionSourceMetadataSchema.optional(),
  });
export const equipmentInstanceSchema: z.ZodType<EquipmentInstance> = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  equipped: z.boolean(),
  effects: z.array(effectSchema).optional(),
  attack: attackDefinitionSchema.optional(),
  maxDexterity: z.number().finite().nonnegative().optional(),
  armorCheckPenalty: z.number().finite().nonpositive().optional(),
  reduceLandSpeed: z.boolean().optional(),
  weight: z.number().finite().nonnegative().optional(),
  quantity: z.number().finite().int().positive().optional(),
});
function catalogSchema<T extends { id: string }>(
  schema: z.ZodType<T>,
): z.ZodType<Record<string, T>> {
  return z.record(schema).superRefine((catalog, context) => {
    for (const [id, definition] of Object.entries(catalog))
      if (definition.id !== id)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [id],
          message: "Catalog key must match definition id",
        });
  });
}
export const featureCatalogSchema = catalogSchema(featureDefinitionSchema);
export const equipmentCatalogSchema = catalogSchema(equipmentDefinitionSchema);
export const attackProfileCatalogSchema = catalogSchema(
  attackProfileDefinitionSchema,
);

export interface ExperienceTrackDefinition {
  id: string;
  name: string;
  thresholds: { level: number; points: number }[];
  source?: ProgressionSourceMetadata;
}
export type ExperienceCatalog = Record<string, ExperienceTrackDefinition>;
export const experienceTrackDefinitionSchema: z.ZodType<ExperienceTrackDefinition> =
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      thresholds: z
        .array(
          z.object({
            level: z.number().int().positive().safe(),
            points: z.number().int().nonnegative().safe(),
          }),
        )
        .min(1),
      source: progressionSourceMetadataSchema.optional(),
    })
    .superRefine((track, context) => {
      track.thresholds.forEach((threshold, index) => {
        if (
          threshold.level !== index + 1 ||
          (index === 0
            ? threshold.points !== 0
            : threshold.points <= track.thresholds[index - 1]!.points)
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["thresholds", index],
            message:
              "XP levels must be contiguous from level 1 at zero XP, with strictly increasing thresholds",
          });
      });
    });
export const experienceCatalogSchema = catalogSchema(
  experienceTrackDefinitionSchema,
);
export const skillDefinitionSchema: z.ZodType<SkillDefinition> = z.object({
  id: skillIdSchema,
  name: z.string().min(1),
  governingAbility: abilityIdSchema,
  trainedOnly: z.boolean().optional(),
  armorCheckPenalty: z.boolean().optional(),
  source: progressionSourceMetadataSchema.optional(),
});
export const skillCatalogSchema: z.ZodType<SkillCatalog> = z
  .record(skillDefinitionSchema)
  .superRefine((catalog, context) => {
    for (const [id, definition] of Object.entries(catalog)) {
      if (definition.id !== id)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [id, "id"],
          message: `Catalog key ${id} must match skill id ${definition.id}`,
        });
    }
  }) as z.ZodType<SkillCatalog>;
export const progressionDefinitionSchema: z.ZodType<ProgressionDefinition> = z
  .object({
    id: progressionIdSchema,
    name: z.string().min(1),
    hitDieSides: z.number().finite().int().positive(),
    babProgression: z.enum(babProgressions),
    saveProgressions: z.object({
      fortitude: z.enum(saveProgressions),
      reflex: z.enum(saveProgressions),
      will: z.enum(saveProgressions),
    }),
    skillPointsPerLevel: z.number().finite().int().nonnegative().optional(),
    classSkillsSource: progressionSourceMetadataSchema.optional(),
    classSkills: z.array(skillIdSchema).optional(),
    features: z.array(progressionFeatureDefinitionSchema).optional(),
    chart: z.array(progressionChartLevelSchema).min(1).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    source: progressionSourceMetadataSchema.optional(),
  })
  .superRefine((definition, context) => {
    const chartLevels = new Set<number>();
    for (const [index, level] of (definition.chart ?? []).entries()) {
      if (chartLevels.has(level.level))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["chart", index, "level"],
          message: `Duplicate chart level ${level.level}`,
        });
      chartLevels.add(level.level);
    }
    const orderedChart = [...(definition.chart ?? [])].sort(
      (a, b) => a.level - b.level,
    );
    for (const [index, level] of orderedChart.entries()) {
      if (level.level !== index + 1)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["chart"],
          message: "Chart levels must be contiguous starting at 1",
        });
      const previous = orderedChart[index - 1];
      if (
        previous &&
        (level.bab < previous.bab ||
          saveIds.some(
            (saveId) => level.saves[saveId] < previous.saves[saveId],
          ))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["chart", index],
          message: "Cumulative chart values cannot decrease",
        });
      }
    }
    const featureIds = new Set<string>();
    for (const [index, feature] of (definition.features ?? []).entries()) {
      if (featureIds.has(feature.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", index, "id"],
          message: `Duplicate progression feature id ${feature.id}`,
        });
      featureIds.add(feature.id);
    }
    const aliases = new Set<string>();
    for (const [index, alias] of (definition.aliases ?? []).entries()) {
      if (alias === definition.id)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", index],
          message: "A progression alias cannot equal its canonical id",
        });
      if (aliases.has(alias))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", index],
          message: `Duplicate progression alias ${alias}`,
        });
      aliases.add(alias);
    }
  }) as z.ZodType<ProgressionDefinition>;
export const progressionCatalogSchema: z.ZodType<ProgressionCatalog> = z
  .record(progressionDefinitionSchema)
  .superRefine((catalog, context) => {
    const aliases = new Set<string>();
    for (const [id, definition] of Object.entries(catalog)) {
      if (definition.id !== id)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [id, "id"],
          message: `Catalog key ${id} must match progression id ${definition.id}`,
        });
      for (const alias of definition.aliases ?? []) {
        if (aliases.has(alias) || Object.hasOwn(catalog, alias))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [id, "aliases"],
            message: `Ambiguous progression alias ${alias}`,
          });
        aliases.add(alias);
      }
    }
  }) as z.ZodType<ProgressionCatalog>;

export function parseProgressionCatalog(value: unknown): ProgressionCatalog {
  return progressionCatalogSchema.parse(value);
}
export function parseSkillCatalog(value: unknown): SkillCatalog {
  return skillCatalogSchema.parse(value);
}
export const progressionAliasMapSchema: z.ZodType<ProgressionAliasMap> =
  z.record(progressionIdSchema);

/** Resolves a legacy alias or canonical id only when it is present in this catalog. */
export function resolveProgressionId(
  id: string,
  catalog: ProgressionCatalog,
  aliases: ProgressionAliasMap = {},
): string | undefined {
  if (Object.hasOwn(catalog, id)) return id;
  const declaredAlias =
    aliases[id] ??
    Object.values(catalog).find((definition) =>
      definition.aliases?.includes(id),
    )?.id;
  return declaredAlias && Object.hasOwn(catalog, declaredAlias)
    ? declaredAlias
    : undefined;
}

export function mergeProgressionCatalogs(
  catalog: ProgressionCatalog = {},
  custom: ProgressionCatalog = {},
): ProgressionCatalog {
  for (const id of Object.keys(custom))
    if (Object.hasOwn(catalog, id))
      throw new Error(
        `Custom progression ${id} conflicts with an imported progression; use a distinct namespace`,
      );
  return parseProgressionCatalog({ ...catalog, ...custom });
}

/** Canonicalizes persisted advancement data and rejects aliases that collide within a slot. */
export function normalizeAdvancementSlots(
  slots: AdvancementSlot[],
  catalog: ProgressionCatalog,
  aliases: ProgressionAliasMap = {},
): AdvancementSlot[] {
  for (const [alias, id] of Object.entries(aliases)) {
    if (!Object.hasOwn(catalog, id))
      throw new Error(`Unknown progression alias destination ${id}`);
    const local = Object.values(catalog).find((definition) =>
      definition.aliases?.includes(alias),
    );
    if (
      (Object.hasOwn(catalog, alias) && alias !== id) ||
      (local && local.id !== id)
    )
      throw new Error(`Ambiguous progression alias ${alias}`);
  }
  return slots.map((slot) => {
    const progressionIds = new Set<string>();
    return {
      ...slot,
      tracks: slot.tracks.map((track) => {
        const progressionId = resolveProgressionId(
          track.entry.progressionId,
          catalog,
          aliases,
        );
        if (!progressionId)
          throw new Error(
            `Unknown progression definition ${track.entry.progressionId} at advancement slot ${slot.id}, track ${track.id}`,
          );
        if (progressionIds.has(progressionId))
          throw new Error(
            `Duplicate progression ${progressionId} in advancement slot ${slot.id}`,
          );
        progressionIds.add(progressionId);
        return { ...track, entry: { ...track.entry, progressionId } };
      }),
    };
  });
}
export const advancementEntrySchema: z.ZodType<AdvancementEntry> = z.object({
  progressionId: z.string().min(1),
});
export const advancementTrackSchema: z.ZodType<AdvancementTrack> = z.object({
  id: z.string().min(1),
  entry: advancementEntrySchema,
});
export const advancementSlotSchema: z.ZodType<AdvancementSlot> = z
  .object({
    id: z.string().min(1),
    tracks: z.array(advancementTrackSchema).min(1),
  })
  .superRefine((slot, context) => {
    const ids = new Set<string>();
    const progressionIds = new Set<string>();
    for (const [index, track] of slot.tracks.entries()) {
      if (ids.has(track.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tracks"],
          message: `Duplicate advancement track id ${track.id} in slot ${slot.id}`,
        });
      ids.add(track.id);
      if (progressionIds.has(track.entry.progressionId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tracks", index, "entry", "progressionId"],
          message: `Duplicate progression ${track.entry.progressionId} in advancement slot ${slot.id}`,
        });
      progressionIds.add(track.entry.progressionId);
    }
  });
export const advancementSlotsSchema = z
  .array(advancementSlotSchema)
  .min(1)
  .superRefine((slots, context) => {
    const slotIds = new Set<string>();
    const expectedTrackIds = slots[0]?.tracks.map((track) => track.id) ?? [];
    for (const [slotIndex, slot] of slots.entries()) {
      if (slotIds.has(slot.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [slotIndex, "id"],
          message: `Duplicate advancement slot id ${slot.id}`,
        });
      slotIds.add(slot.id);
      const actualTrackIds = slot.tracks.map((track) => track.id);
      if (
        actualTrackIds.length !== expectedTrackIds.length ||
        actualTrackIds.some(
          (trackId, index) => trackId !== expectedTrackIds[index],
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [slotIndex, "tracks"],
          message: "Each advancement slot must use the same ordered track ids",
        });
      }
    }
  });
export const characterInputSchema: z.ZodType<CharacterInput> = z
  .object({
    id: z.string().min(1),
    campaignId: z.string().optional(),
    name: z.string().min(1),
    customProgressions: progressionCatalogSchema.optional(),
    experience: z
      .object({
        points: z.number().int().nonnegative().safe(),
        trackId: z.string().min(1),
      })
      .optional(),
    equipment: z.array(equipmentInstanceSchema).optional(),
    baseAbilities: z.object({
      str: z.number().finite(),
      dex: z.number().finite(),
      con: z.number().finite(),
      int: z.number().finite(),
      wis: z.number().finite(),
      cha: z.number().finite(),
    }),
    baseBab: z.number().finite().optional(),
    baseSaves: z
      .object({
        fortitude: z.number().finite(),
        reflex: z.number().finite(),
        will: z.number().finite(),
      })
      .optional(),
    baseHpBeforeConstitution: z.number().finite(),
    hitDiceCount: z.number().finite().int().positive().optional(),
    advancementSlots: advancementSlotsSchema.optional(),
    skillRanks: z.record(z.number().finite().nonnegative()),
    skills: z
      .record(
        z.object({
          governingAbility: abilityIdSchema.optional(),
          classSkill: z.boolean().optional(),
          classSkillOverride: z.boolean().optional(),
          miscellaneous: z.number().finite().optional(),
          armorAndSize: z.number().finite().optional(),
        }),
      )
      .optional(),
    attacks: z.array(attackDefinitionSchema),
    features: z.array(featureInstanceSchema),
    damageTaken: z.number().finite().int().nonnegative(),
    temporaryHp: z.number().finite().int().nonnegative(),
    baseLandSpeed: z.number().finite().optional(),
    baseSpeeds: z
      .object({
        land: z.number().finite().nonnegative().optional(),
        fly: z.number().finite().nonnegative().optional(),
        swim: z.number().finite().nonnegative().optional(),
        climb: z.number().finite().nonnegative().optional(),
        burrow: z.number().finite().nonnegative().optional(),
      })
      .optional(),
    baseSize: z.enum(sizeCategories).optional(),
  })
  .superRefine((character, context) => {
    if (
      character.baseLandSpeed !== undefined &&
      character.baseSpeeds?.land !== undefined &&
      character.baseLandSpeed !== character.baseSpeeds.land
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseSpeeds", "land"],
        message: "baseLandSpeed and baseSpeeds.land disagree",
      });
    for (const key of ["features", "attacks", "equipment"] as const) {
      const ids = new Set<string>();
      for (const item of character[key] ?? []) {
        if (ids.has(item.id))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `Duplicate ${key} id ${item.id}`,
          });
        ids.add(item.id);
      }
    }
    const advancementMode = Boolean(character.advancementSlots?.length);
    if (!advancementMode && character.baseBab === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseBab"],
        message: "baseBab is required in manual mode",
      });
    if (!advancementMode && character.baseSaves === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseSaves"],
        message: "baseSaves is required in manual mode",
      });
    if (!advancementMode && character.hitDiceCount === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hitDiceCount"],
        message: "hitDiceCount is required in manual mode",
      });
    if (advancementMode && character.baseBab !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseBab"],
        message: "baseBab must be omitted in advancement mode",
      });
    if (advancementMode && character.baseSaves !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseSaves"],
        message: "baseSaves must be omitted in advancement mode",
      });
    if (advancementMode && character.hitDiceCount !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hitDiceCount"],
        message: "hitDiceCount must be omitted in advancement mode",
      });
    const replacements = new Map<string, number>();
    for (const feature of character.features) {
      if (!feature.enabled) continue;
      for (const effect of feature.effects) {
        if (effect.kind !== "replaceBase") continue;
        const count = replacements.get(effect.target) ?? 0;
        replacements.set(effect.target, count + 1);
        if (count > 0)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["features"],
            message: `Ambiguous active baseline replacements for ${effect.target}`,
          });
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
  sourceMetadata?: ProgressionSourceMetadata;
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
  /** Every active progression that makes this a class skill, before manual override. */
  classSkillProvenance: Contribution[];
}

export interface DerivedSize {
  category: SizeCategory;
  /** Integer category-step change from the authored base size. */
  relative: EvaluationResult;
}

export interface AdvancementSummary {
  slotCount: number;
  trackIds: string[];
  hitDiceCount: number;
  /** Best available die type per ordered slot; HP-from-HD remains a later layer. */
  hitDieSides: number[];
  skillPoints: number;
  /** Character-global levels, with slot/track provenance for every earned level. */
  progressionLevels: Record<string, EvaluationResult>;
  /** Metadata-only class-chart features unlocked by those progression levels. */
  features: DerivedProgressionFeature[];
}

export interface DerivedProgressionFeature {
  id: string;
  name: string;
  progressionId: string;
  level: number;
  slotId: string;
  trackId: string;
  description?: string;
  provenance: Contribution;
}

export interface DerivedAttack {
  definition: AttackDefinition;
  attack: EvaluationResult;
  damage: DamageEvaluation;
  /** One weapon's full attack sequence, including BAB iteratives and explicit extra attacks. */
  fullAttack: EvaluationResult[];
}

export interface DerivedCharacter {
  input: CharacterInput;
  grants: GrantedCapability[];
  abilities: Record<
    AbilityId,
    { score: EvaluationResult; modifier: EvaluationResult }
  >;
  maxHp: EvaluationResult;
  advancement?: AdvancementSummary;
  experience?: {
    points: number;
    trackId: string;
    eligibleLevel: EvaluationResult;
    /** Undefined at the end of the selected explicit chart. */
    nextThreshold?: number;
    remaining?: number;
  };
  /** Derived from max HP and authored damage; it intentionally changes when max HP changes. */
  currentHp: number;
  damageTaken: number;
  temporaryHp: number;
  /** First-class BAB fact; attacks, CMB, and CMD consume this exact evaluation. */
  bab: EvaluationResult;
  saves: Record<SaveId, EvaluationResult>;
  ac: EvaluationResult;
  touchAc: EvaluationResult;
  flatFootedAc: EvaluationResult;
  initiative: EvaluationResult;
  cmb: EvaluationResult;
  cmd: EvaluationResult;
  skills: Record<string, DerivedSkill>;
  size: DerivedSize;
  /** All movement modes are evaluated through the same ordered effect pipeline. */
  speeds: Record<MovementMode, EvaluationResult>;
  /** Compatibility view of speeds.land. */
  movement: EvaluationResult;
  attacks: DerivedAttack[];
}

export interface GrantedCapability {
  target: TargetId;
  grant: string;
  source: SourceReference;
}

export const targetLabels: Record<string, string> = {
  "ability.str": "Strength",
  "ability.dex": "Dexterity",
  "ability.con": "Constitution",
  "ability.int": "Intelligence",
  "ability.wis": "Wisdom",
  "ability.cha": "Charisma",
  "save.fortitude": "Fortitude",
  "save.reflex": "Reflex",
  "save.will": "Will",
  ac: "Armor Class",
  "ac.natural": "Natural Armor",
  hp: "Hit points",
  initiative: "Initiative",
  "combat.bab": "Base Attack Bonus",
  cmb: "CMB",
  cmd: "CMD",
  "attack.melee": "Melee attack",
  "damage.melee": "Melee damage",
  "attack.ranged": "Ranged attack",
  "damage.ranged": "Ranged damage",
  casterLevel: "Caster level",
  "size.relative": "Relative size",
  "speed.land": "Land speed",
  "speed.fly": "Fly speed",
  "speed.swim": "Swim speed",
  "speed.climb": "Climb speed",
  "speed.burrow": "Burrow speed",
  "skill.all": "All skills",
};
