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

export const attackTagValues = [
  "weapon.melee",
  "weapon.ranged",
  "weapon.two-handed",
  "weapon.off-hand",
  "weapon.touch",
  "natural.attack",
] as const;
export type AttackTag = (typeof attackTagValues)[number];

export const attackModes = ["melee", "ranged"] as const;
export type AttackMode = (typeof attackModes)[number];

/** Standard PF1e combat maneuvers; homebrew maneuvers stay representable as strings. */
export const maneuverIds = [
  "bull-rush",
  "dirty-trick",
  "disarm",
  "drag",
  "grapple",
  "overrun",
  "reposition",
  "steal",
  "sunder",
  "trip",
] as const;
export type ManeuverId = (typeof maneuverIds)[number] | (string & {});

/** What a roll is for. Kept deliberately small: these are the evaluated actions. */
export const rollKinds = [
  "attack",
  "damage",
  "maneuver",
  "save",
  "skill",
  "initiative",
] as const;
export type RollKind = (typeof rollKinds)[number];

/**
 * Legacy tag-only attack filter. New content should prefer `appliesWhen`, which
 * also expresses touch, full-attack membership, maneuvers and situational
 * flags. Retained because persisted characters contain it.
 */
export interface AttackSelector {
  mode?: AttackMode;
  requiredTags?: AttackTag[];
  excludedTags?: AttackTag[];
}

/**
 * The kind of thing the actor is doing right now. One action may produce many
 * rolls, so this names the action rather than a single roll.
 */
export const actionKinds = [
  "standardAttack",
  "fullAttack",
  "maneuver",
  "save",
  "skillCheck",
  "other",
] as const;
export type ActionKind = (typeof actionKinds)[number];

/**
 * What the actor is doing, and where this roll sits inside it. A full attack is
 * one action whose rolls belong to selected weapons; it is never modelled as
 * each weapon independently owning every extra attack.
 */
export interface ActionContext {
  kind: ActionKind;
  /** Identity of the action instance; equal to its `ActionPlan` id. */
  sequenceId?: string;
  /** Zero-based position of this roll within its own weapon's sequence. */
  sequenceIndex?: number;
  /** Weapons the action selects, in order (weapon actions only). */
  attackIds?: string[];
}

/** What a roll is compared against, when that is part of the rolled context. */
export const rollDefenseKinds = ["ac", "cmd", "dc"] as const;
export type RollDefenseKind = (typeof rollDefenseKinds)[number];

/**
 * A known defense the roll is compared against. This is *target* state supplied
 * as context; the engine never invents it, and an absent defense means hit /
 * success stays unresolved rather than assumed.
 */
export interface RollDefense {
  kind: RollDefenseKind;
  value: number;
  /** AC context, when the defense is an Armor Class. */
  context?: DefenseContext;
}

export interface TargetContext {
  /** The character the roll is made against, when it is a persisted sheet. */
  characterId?: string;
  name?: string;
  defense?: RollDefense;
}

/**
 * Explicit situational identity of one roll: who is acting, what they are
 * doing, which specific fact is being rolled, and what it is rolled against.
 * Character facts describe the actor; this describes the actor's current
 * attempt. Effects declare when they apply to such a context instead of forcing
 * duplicate static targets.
 */
export interface RollContext {
  /** Which evaluated fact this roll produces. */
  kind: RollKind;
  /** The acting character; every roll has exactly one actor. */
  actorCharacterId: string;
  /** The action or check this roll belongs to. */
  action: ActionContext;
  /** What the roll is made against, when known. */
  target?: TargetContext;
  /** Authored attack/weapon identity the roll belongs to. */
  attackId?: string;
  /** The save being rolled, when the roll is a save. */
  saveId?: SaveId;
  /** The skill being rolled, when the roll is a skill check. */
  skillId?: string;
  /** Weapon classification tags resolved from the attack definition. */
  attackTags?: AttackTag[];
  /** Ranged or melee, for weapon rolls. */
  mode?: AttackMode;
  /** True for touch attacks (rays, touch spells, melee touch). */
  touch?: boolean;
  /** Combat maneuver being attempted, when the roll is a maneuver. */
  maneuver?: ManeuverId;
  /**
   * True when a damage roll expresses the critical consequence of the attack it
   * follows. It belongs to the roll's identity because the server rebuilds the
   * widened damage roll from the context alone; absent means ordinary damage.
   */
  criticalDamage?: boolean;
  /** The resolved situational flags this roll was evaluated with. */
  flags?: string[];
  /** Flags the caller withheld, kept so the server rebuilds the same evaluation. */
  excludeFlags?: string[];
}

/**
 * Full-attack membership is an action fact, so it is derived from the action
 * rather than duplicated as a second boolean on the roll.
 */
export function isFullAttackAction(context: RollContext): boolean {
  return context.action.kind === "fullAttack";
}

/** The action a maneuver roll belongs to. */
export function isManeuverAction(context: RollContext): boolean {
  return context.action.kind === "maneuver";
}

/**
 * When an effect applies. Every field is optional; an omitted field never
 * restricts. A field that is present must match the roll context for the
 * effect to contribute.
 */
export interface EffectApplicability {
  kinds?: RollKind[];
  modes?: AttackMode[];
  requiredTags?: AttackTag[];
  excludedTags?: AttackTag[];
  /** `true` requires a touch attack; `false` requires a non-touch attack. */
  touch?: boolean;
  /** `true` requires full-attack membership; `false` requires a standard attack. */
  fullAttack?: boolean;
  maneuvers?: ManeuverId[];
  requiredFlags?: string[];
  excludedFlags?: string[];
}

/** The lowest natural d20 face that threatens a critical hit. */
export interface CriticalRange {
  minimumNaturalRoll: number;
}

export const defaultCriticalRange: CriticalRange = { minimumNaturalRoll: 20 };

/**
 * How the effective critical range of one attack was reached: the weapon's base
 * range plus every contextual widening that applied, with the filtered ones.
 */
export interface CriticalRangeEvaluation {
  /** The attack-scoped target the range was evaluated for. */
  target: TargetId;
  base: CriticalRange;
  effective: CriticalRange;
  contributions: Contribution[];
  excluded: ExcludedContribution[];
}

/**
 * Widens the threatening range of eligible attacks. Critical range is an
 * attack property that contextual rules may modify, so it stays derivable
 * through ordinary rules machinery instead of being baked into resolution.
 */
export interface CriticalRangeEffect {
  kind: "criticalRange";
  /** An attack-scoped target such as `attack.melee`. */
  target: ConcreteEffectTargetId;
  /** Faces to widen by: 1 turns a 20 threat range into 19–20. */
  widenBy: number;
  appliesWhen?: EffectApplicability;
  source?: SourceReference;
}

/**
 * Semantic classification of a resolved roll. `natural20` / `natural1` mean the
 * raw d20 showed that face, which is not the same event as a rule-defined
 * critical outcome.
 */
export const rollOutcomeKinds = [
  "criticalSuccess",
  "criticalFailure",
  "natural20",
  "natural1",
  "success",
  "failure",
  "unresolved",
] as const;
export type RollOutcomeKind = (typeof rollOutcomeKinds)[number];

export const naturalFaceClassifications = [
  "criticalSuccess",
  "criticalFailure",
  "natural20",
  "natural1",
] as const;
export type NaturalFaceClassification =
  (typeof naturalFaceClassifications)[number];

/** What a raw d20 face means to a roll family before modifiers are compared. */
export interface NaturalFacePolicy {
  /** Applies regardless of the total: automatic hit or automatic success. */
  automatic: boolean;
  /** How that face is classified when nothing more specific applies. */
  classification: NaturalFaceClassification;
}

/**
 * The smallest explicit policy layer that answers the questions resolution
 * needs: does a natural 20 hit outright, does a natural 1 miss outright, do they
 * carry special success/failure semantics, and is a critical threat confirmed
 * with a second roll.
 */
export interface RollOutcomePolicy {
  /** Named policy the plan was authored under, such as `pf1e.attack`. */
  id: string;
  /**
   * Attacks compare against a defense and can crit; checks compare against a
   * defense; plain rolls (damage, initiative) compare against nothing and have
   * no success or failure of their own.
   */
  kind: "attack" | "check" | "plain";
  natural20: NaturalFacePolicy;
  natural1: NaturalFacePolicy;
  /**
   * Attacks: a threat is confirmed with a second roll. This campaign does not
   * use confirmation, so the default is false and the resolver never emits a
   * second roll. When a policy does require confirmation, the threat stays
   * visible through `inCriticalRange` and `critical` remains unresolved.
   */
  criticalConfirmationRequired: boolean;
}

/** The policy families a roll can be resolved under. */
export interface RollOutcomePolicySet {
  attack: RollOutcomePolicy;
  maneuver: RollOutcomePolicy;
  save: RollOutcomePolicy;
  skill: RollOutcomePolicy;
  /** Rolls with no success/failure comparison, such as damage. */
  plain: RollOutcomePolicy;
}

/**
 * Everything resolution determined, with raw-face facts kept distinct from rule
 * classifications so a caller never has to reverse-engineer which happened.
 */
export interface RollOutcome {
  kind: RollOutcomeKind;
  /** True when the raw d20 showed 20 (a face fact, not a rule outcome). */
  natural20: boolean;
  /** True when the raw d20 showed 1 (a face fact, not a rule outcome). */
  natural1: boolean;
  /** Attacks: the roll beat the defense (or an automatic rule applied). */
  hit?: boolean;
  /** Checks: the total beat the defense (or an automatic rule applied). */
  success?: boolean;
  /** Attacks: the natural face hit regardless of the total. */
  automaticHit?: boolean;
  /** Attacks: the natural face missed regardless of the total. */
  automaticMiss?: boolean;
  /** Checks: the natural face succeeded regardless of the total. */
  automaticSuccess?: boolean;
  /** Checks: the natural face failed regardless of the total. */
  automaticFailure?: boolean;
  /** Whether the raw face threatened a critical, when a range applies. */
  inCriticalRange?: boolean;
  /** Attacks: a critical outcome was classified. Absent while unresolved. */
  critical?: boolean;
  /** The effective range the membership test used. */
  criticalRange?: CriticalRange;
  /** The defense the roll was compared against, when one was supplied. */
  defense?: RollDefense;
}

/** Raw dice a plan requires: one count of same-sided dice per group. */
export interface DiceRequirement {
  sides: number;
  count: number;
}

/**
 * How the modifier and the effective threat range were reached, so a plan
 * explains itself without re-deriving the character.
 */
export interface RollPlanProvenance {
  /** Contributions that sum to the modifier. */
  modifier: Contribution[];
  /** Contextual effects that were authored but filtered out, with reasons. */
  excluded: ExcludedContribution[];
  criticalRange?: CriticalRangeEvaluation;
}

/**
 * The authoritative description of one requested roll: what it is, what action
 * it belongs to, what it is rolled against, which raw dice it needs, and how
 * those raw faces are interpreted. Plans are ephemeral; the server rebuilds one
 * from current authored state plus the requested context, and a client never
 * supplies a modifier.
 */
export interface RollPlan {
  id: string;
  characterId: string;
  label: string;
  dice: DiceRequirement[];
  modifier: number;
  /** Situational identity: actor, action, rolled fact and known defense. */
  context: RollContext;
  /** How raw faces become a semantic outcome for this roll family. */
  outcomePolicy: RollOutcomePolicy;
  /** The effective threat range, for rolls that can crit. */
  criticalRange?: CriticalRange;
  provenance?: RollPlanProvenance;
}

/**
 * Effect targets that stand for a whole family of concrete facts. Selectors
 * accept additive modifiers only: replacing or bounding "every skill" has no
 * single baseline to replace.
 */
export const selectorTargets = ["skill.all"] as const;
export type SelectorTargetId = (typeof selectorTargets)[number];
export type ConcreteEffectTargetId = Exclude<
  EffectTargetId,
  SelectorTargetId
>;
export function isSelectorTarget(target: string): target is SelectorTargetId {
  return (selectorTargets as readonly string[]).includes(target);
}

/**
 * Targets that can be evaluated against a `RollContext`. Situational effect
 * applicability is only meaningful for these; scalar sheet facts such as AC or
 * HP are evaluated once without a roll context.
 */
export function isContextualTarget(target: string): boolean {
  return (
    target === "cmb" ||
    target === "cmd" ||
    target === "initiative" ||
    target.startsWith("save.") ||
    target.startsWith("skill.") ||
    /^(attack|damage|attacks\.extra)\.(melee|ranged)$/.test(target)
  );
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

/** Bonus types that never add to CMD; their penalties still apply. */
export const cmdExcludedBonusTypes: BonusType[] = [
  "armor",
  "shield",
  "naturalArmor",
  /** Size is already a first-class CMD term; re-reading it would double count. */
  "size",
];

/**
 * A semantic AC-derived contributor for a defense other than AC. CMD consumes
 * every AC modifier that applies in the normal context except armor, shield,
 * natural armor and size bonuses; all AC penalties apply regardless of
 * category. This is why a `+2 deflection AC` effect raises CMD without a
 * second hand-authored CMD effect.
 */
export function acModifierAppliesToCmd(
  value: number,
  bonusType: BonusType,
): boolean {
  return value < 0 || !cmdExcludedBonusTypes.includes(bonusType);
}

export interface NonAcModifierEffect {
  kind: "modifier";
  target: Exclude<EffectTargetId, "ac">;
  value: number;
  bonusType: BonusType;
  source?: SourceReference;
  scaling?: BabStepScaling;
  /** Legacy tag/mode filter; new content should use `appliesWhen`. */
  attackSelector?: AttackSelector;
  /** Contextual applicability, evaluated against a `RollContext`. */
  appliesWhen?: EffectApplicability;
  /** Movement increase limited to the intrinsic speed (Haste). */
  capToBase?: boolean;
}

export type ModifierEffect = AcModifierEffect | NonAcModifierEffect;

export interface ReplaceBaseEffect {
  kind: "replaceBase";
  target: ConcreteEffectTargetId;
  value: number;
  source?: SourceReference;
}

/** Applied after baseline replacement and typed additive modifiers. */
export interface MultiplyEffect {
  kind: "multiply";
  target: ConcreteEffectTargetId;
  factor: number;
  source?: SourceReference;
}

/** Applied after multiplication. Multiple minimums use the greatest value. */
export interface MinimumEffect {
  kind: "minimum";
  target: ConcreteEffectTargetId;
  value: number;
  source?: SourceReference;
}

/** Applied after minimums. Multiple maximums use the least value. */
export interface MaximumEffect {
  kind: "maximum";
  target: ConcreteEffectTargetId;
  value: number;
  source?: SourceReference;
}

export interface GrantEffect {
  kind: "grant";
  target: ConcreteEffectTargetId;
  grant: string;
  source?: SourceReference;
}

export type Effect =
  | ModifierEffect
  | GrantEffect
  | ReplaceBaseEffect
  | MultiplyEffect
  | MinimumEffect
  | MaximumEffect
  | CriticalRangeEffect;
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
  /**
   * Situational flags this enabled feature contributes to every roll context,
   * such as `combat-expertise`. Effects may then require the flag.
   */
  contextFlags?: string[];
}

export type FeatureCatalog = Record<string, FeatureDefinition>;

export interface FeatureInstance {
  id: string;
  definitionId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  effects: EffectDefinition[];
  /** Authored situational flags contributed while this instance is enabled. */
  contextFlags?: string[];
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
  /** This weapon's threat range; the profile's range applies when omitted. */
  criticalRange?: CriticalRange;
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
  /** Threat range shared by weapons using this profile; defaults to 20. */
  criticalRange?: CriticalRange;
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
const attackTagSchema = z.enum(attackTagValues);
const attackModeSchema = z.enum(attackModes);
const attackSelectorSchema = z.object({
  mode: attackModeSchema.optional(),
  requiredTags: z.array(attackTagSchema).optional(),
  excludedTags: z.array(attackTagSchema).optional(),
});
/** Homebrew maneuvers remain representable, but must be stable slugs. */
const maneuverIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "Maneuvers use lowercase slugs such as trip");
const flagSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/, "Situational flags use lowercase slugs");
const applicabilitySchema = z
  .object({
    kinds: z.array(z.enum(rollKinds)).min(1).optional(),
    modes: z.array(attackModeSchema).min(1).optional(),
    requiredTags: z.array(attackTagSchema).optional(),
    excludedTags: z.array(attackTagSchema).optional(),
    touch: z.boolean().optional(),
    fullAttack: z.boolean().optional(),
    maneuvers: z.array(maneuverIdSchema).min(1).optional(),
    requiredFlags: z.array(flagSchema).min(1).optional(),
    excludedFlags: z.array(flagSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const restricts = Object.values(value).some(
      (entry) => entry !== undefined,
    );
    if (!restricts)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An applicability rule must restrict something; omit appliesWhen instead of using {}",
      });
  }) as z.ZodType<EffectApplicability>;
const scalingSchema = z.object({
  kind: z.literal("babStep"),
  every: z.number().finite().int().positive(),
  base: z.number().finite().int(),
});
/**
 * A threat range is a natural-face threshold: 20 crits on a natural 20, 19 on
 * 19 or 20, and so on. It belongs to the weapon/profile, never to the d20.
 */
export const criticalRangeSchema: z.ZodType<CriticalRange> = z
  .object({ minimumNaturalRoll: z.number().int().min(2).max(20) })
  .strict();
/** Critical range is an attack property, so only attack-scoped targets qualify. */
const attackScopedTargetSchema = effectTargetIdSchema.refine(
  (target) => /^attack\.(melee|ranged)$/.test(target),
  "Critical range is an attack property; target `attack.melee` or `attack.ranged`",
);
export const rollDefenseSchema: z.ZodType<RollDefense> = z
  .object({
    kind: z.enum(rollDefenseKinds),
    value: z.number().finite(),
    context: defenseContextSchema.optional(),
  })
  .strict();
export const actionContextSchema: z.ZodType<ActionContext> = z
  .object({
    kind: z.enum(actionKinds),
    sequenceId: z.string().min(1).optional(),
    sequenceIndex: z.number().int().nonnegative().optional(),
    attackIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export const targetContextSchema: z.ZodType<TargetContext> = z
  .object({
    characterId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    defense: rollDefenseSchema.optional(),
  })
  .strict();
export const rollContextSchema: z.ZodType<RollContext> = z
  .object({
    kind: z.enum(rollKinds),
    actorCharacterId: z.string().min(1),
    action: actionContextSchema,
    target: targetContextSchema.optional(),
    attackId: z.string().min(1).optional(),
    saveId: z.enum(saveIds).optional(),
    skillId: z.string().min(1).optional(),
    attackTags: z.array(attackTagSchema).optional(),
    mode: attackModeSchema.optional(),
    touch: z.boolean().optional(),
    maneuver: maneuverIdSchema.optional(),
    criticalDamage: z.boolean().optional(),
    flags: z.array(flagSchema).optional(),
    excludeFlags: z.array(flagSchema).optional(),
  })
  .strict();
const naturalFacePolicySchema: z.ZodType<NaturalFacePolicy> = z.object({
  automatic: z.boolean(),
  classification: z.enum(naturalFaceClassifications),
});
export const rollOutcomePolicySchema: z.ZodType<RollOutcomePolicy> = z.object({
  id: z.string().min(1),
  kind: z.enum(["attack", "check", "plain"]),
  natural20: naturalFacePolicySchema,
  natural1: naturalFacePolicySchema,
  criticalConfirmationRequired: z.boolean(),
});
export const rollOutcomeSchema: z.ZodType<RollOutcome> = z.object({
  kind: z.enum(rollOutcomeKinds),
  natural20: z.boolean(),
  natural1: z.boolean(),
  hit: z.boolean().optional(),
  success: z.boolean().optional(),
  automaticHit: z.boolean().optional(),
  automaticMiss: z.boolean().optional(),
  automaticSuccess: z.boolean().optional(),
  automaticFailure: z.boolean().optional(),
  inCriticalRange: z.boolean().optional(),
  critical: z.boolean().optional(),
  criticalRange: criticalRangeSchema.optional(),
  defense: rollDefenseSchema.optional(),
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
  appliesWhen: applicabilitySchema.optional(),
  capToBase: z.boolean().optional(),
});
/**
 * Selector targets (`skill.all`) accept additive modifiers only. Operations
 * that need one concrete baseline or bound must name a concrete target; the
 * schema rejects the nonsensical combination instead of silently applying it
 * to every member of the family.
 */
const concreteOperationTargetSchema = effectTargetIdSchema.refine(
  (target) => !isSelectorTarget(target),
  "This operation needs a concrete target; a selector such as `skill.all` only accepts modifiers",
) as z.ZodType<ConcreteEffectTargetId>;
export const effectSchema: z.ZodType<Effect> = z
  .union([
    acModifierSchema,
    nonAcModifierSchema,
    z.object({
      kind: z.literal("replaceBase"),
      target: concreteOperationTargetSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("multiply"),
      target: concreteOperationTargetSchema,
      factor: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("minimum"),
      target: concreteOperationTargetSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("maximum"),
      target: concreteOperationTargetSchema,
      value: z.number().finite(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("grant"),
      target: concreteOperationTargetSchema,
      grant: z.string().min(1),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("criticalRange"),
      target: attackScopedTargetSchema,
      widenBy: z.number().int().min(1).max(18),
      appliesWhen: applicabilitySchema.optional(),
      source: sourceReferenceSchema.optional(),
    }),
  ])
  .superRefine((effect, context) => {
    if (
      effect.target === "size.relative" &&
      effect.kind !== "grant" &&
      effect.kind !== "criticalRange"
    ) {
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
      if (
        "appliesWhen" in effect &&
        effect.appliesWhen &&
        !isContextualTarget(effect.target)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "appliesWhen is only supported on roll-scoped targets such as attacks, damage, extra attacks, CMB, CMD, saves, skills or initiative",
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
  contextFlags: z.array(flagSchema).min(1).optional(),
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
  criticalRange: criticalRangeSchema.optional(),
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
  contextFlags: z.array(flagSchema).min(1).optional(),
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
    criticalRange: criticalRangeSchema.optional(),
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
  /**
   * Marks a negative modifier contribution to an ability score. Temporary
   * ability penalties floor the score at 1; other mechanisms (replacement
   * baselines, future damage/drain) are not marked and are not floored here.
   */
  abilityPenalty?: boolean;
}

/**
 * Why an otherwise-authored effect was filtered out of a contextual
 * evaluation. Exclusions are provenance, not omissions: the audit trail shows
 * both what contributed and what did not, and why.
 */
export interface ExcludedContribution {
  target: TargetId;
  value: number;
  label: string;
  source: string;
  bonusType?: BonusType;
  /** Human-readable reason, e.g. `requires full-attack membership`. */
  reason: string;
  /** The context actually evaluated, when one existed. */
  rollContext?: RollContext;
}

/** The result of context filtering a set of candidate contributions. */
export interface ContextualModifiers {
  applied: Contribution[];
  excluded: ExcludedContribution[];
}

export interface EvaluationResult {
  target: TargetId;
  value: number;
  contributions: Contribution[];
  context?: DefenseContext;
  /** Present when the evaluation was made for a specific roll context. */
  rollContext?: RollContext;
  /** Contextual filtering provenance: effects that were authored but did not apply. */
  excluded?: ExcludedContribution[];
}

export interface DamageEvaluation {
  formula: string;
  dice: DiceExpression;
  modifier: number;
  contributions: Contribution[];
  /** Contextual filtering provenance for damage effects. */
  excluded?: ExcludedContribution[];
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
  /** This weapon's default full-attack action, with explicit step roles. */
  action: ActionPlan;
}

/** How a single attack in an action's sequence was reached. */
export type AttackStepRole = "primary" | "iterative" | "extra";

/** One explicit member of an attack's sequence, never a concatenated blob. */
export interface ActionPlanStep {
  /** Zero-based position within this attack's own sequence. */
  index: number;
  role: AttackStepRole;
  modifier: number;
  /** The contextual evaluation behind `modifier`, including exclusions. */
  evaluation: EvaluationResult;
  /** This step's resolvable roll, with its own context, policy and threat range. */
  roll: RollPlan;
  /**
   * The damage this step deals, when it deals any. It is a roll of the same
   * action and step, so an action's roll list is complete without the caller
   * inventing dice or modifiers.
   */
  damage?: RollPlan;
}

/** One weapon's contribution to an action. */
export interface ActionAttackPlan {
  attackId: string;
  name: string;
  role: "primary" | "off-hand" | "secondary";
  context: RollContext;
  steps: ActionPlanStep[];
}

/**
 * An explicit combat action and its selected attacks. Multiple weapons are
 * modelled as explicit members with roles; they are never silently
 * concatenated into one fake combined full attack. Action-level extras (Haste)
 * are computed once and attached to the primary attack only.
 */
export interface ActionPlan {
  id: string;
  characterId: string;
  action: ActionKind;
  label: string;
  context: RollContext;
  attacks: ActionAttackPlan[];
  /** The single contextual evaluation behind a maneuver action. */
  evaluation?: EvaluationResult;
  /** Effects filtered out at the action level, with reasons. */
  excluded: ExcludedContribution[];
  /**
   * Every roll this action produces, in action order: each step's attack roll
   * followed by that step's damage roll, flattened for callers that resolve an
   * action's rolls in sequence rather than by weapon.
   */
  rolls: RollPlan[];
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
