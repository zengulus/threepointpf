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
  | `resource.${string}.maximum`
  | `spellcasting.${string}.casterLevel`
  | `spellcasting.${string}.concentration`
  | `spellcasting.${string}.dc.${number}`
  | `spellcasting.${string}.slot.${number}`
  | `spellcasting.${string}.maximumSpellLevel`
  /** A character-global level in a named progression, such as progression.fighter.level. */
  | `progression.${string}.level`;

/** Progression levels are derived queries and cannot be authored as effects. */
export type EffectTargetId = Exclude<
  TargetId,
  `progression.${string}.level` | `resource.${string}.maximum` | "experience.level"
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
  /** Semantic spell identity for spell damage or attack plans. */
  spellId?: string;
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
  /** Named attacks only, matched against the roll's authored attack identity. */
  attackIds?: string[];
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
  /** How the effective range was reached, when an expansion applied. */
  operation?: CriticalRangeOperation;
  contributions: Contribution[];
  excluded: ExcludedContribution[];
}

/**
 * How an expansion changes a threat range. `widen` adds faces; `double`
 * multiplies the weapon's own range, which is what Improved Critical and Keen
 * do (a 19–20 longsword becomes 17–20, a 20 threat becomes 19–20).
 */
export const criticalRangeOperations = ["widen", "double"] as const;
export type CriticalRangeOperation = (typeof criticalRangeOperations)[number];

/**
 * Expands the threatening range of an eligible attack. Critical range is an
 * attack property that contextual rules may modify, so it stays derivable
 * through ordinary rules machinery instead of being baked into resolution.
 *
 * Threat-range expansion is one nonstacking family: when several expansions
 * apply to the same attack, only the most expansive one contributes and the
 * others are reported as excluded provenance rather than silently added.
 */
export interface CriticalRangeEffect {
  kind: "criticalRange";
  /** An attack-scoped target such as `attack.melee`. */
  target: ConcreteEffectTargetId;
  /** Faces to widen by: 1 turns a 20 threat range into 19–20. */
  widenBy?: number;
  /** Doubles the weapon's own range; defaults to widening by `widenBy`. */
  operation?: CriticalRangeOperation;
  appliesWhen?: EffectApplicability;
  source?: SourceReference;
}

export const damageCriticalBehaviors = ["normal", "notMultiplied"] as const;
export type DamageCriticalBehavior = (typeof damageCriticalBehaviors)[number];

/** A sourced dice term added to weapon damage without reducing it to an average. */
export interface DamageDiceEffect {
  kind: "damageDice";
  target: "damage.melee" | "damage.ranged";
  dice: DiceExpression;
  damageType?: string;
  label?: string;
  criticalBehavior: DamageCriticalBehavior;
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
  /**
   * True when the roll's primary check die showed 20 (a face fact, not a rule
   * outcome). Absent when the roll has no check die at all, as damage does not.
   */
  natural20?: boolean;
  /** True when the primary check die showed 1. Absent without a check die. */
  natural1?: boolean;
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
 * The raw die whose face carries natural-20 / natural-1 semantics. A plan
 * declares it explicitly instead of resolution discovering "a d20" by scanning
 * the dice it requires. Attacks, saves, skills, maneuvers and initiative are
 * checks and declare one; a damage roll declares none and therefore has no
 * natural-face semantics at all, even when it happens to roll a d20.
 */
export interface PrimaryCheckDie {
  /** Index into `RollPlan.dice` of the group holding the check die. */
  group: number;
  /** Which die inside that group; defaults to its first. */
  index?: number;
  /** The die's sides. Only a d20 face is a natural 20 or a natural 1. */
  sides: number;
}

/** The declaration every d20 check plan carries. */
export const d20CheckDie: PrimaryCheckDie = { group: 0, sides: 20 };

/** Whether a plan's faces carry natural-face semantics at all. */
export function hasPrimaryCheckDie(plan: RollPlan): boolean {
  return plan.primaryCheckDie !== undefined;
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
  /** Damage dice remain separate, sourced semantic terms through execution. */
  damageTerms?: DamageDiceTerm[];
  /** Authored dice filtered from this context, retained without a fake value. */
  excludedDamageTerms?: ExcludedDamageDiceTerm[];
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
  /**
   * The die whose face carries natural-face semantics, when this roll is a
   * check. Damage declares none, so a d20 damage die never becomes a "natural
   * 20" by accident.
   */
  primaryCheckDie?: PrimaryCheckDie;
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
      value.length > "progression..level".length) ||
    (value.startsWith("resource.") &&
      value.endsWith(".maximum") &&
      value.length > "resource..maximum".length) ||
    /^spellcasting\..+\.(?:casterLevel|concentration)$/.test(value) ||
    /^spellcasting\..+\.dc\.\d+$/.test(value)
    || /^spellcasting\..+\.slot\.\d+$/.test(value)
    || /^spellcasting\..+\.maximumSpellLevel$/.test(value)
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
  | CriticalRangeEffect
  | DamageDiceEffect;
export type EffectDefinition = Effect;

export const abilityActivationTypes = [
  "passive",
  "toggleable",
  "activated",
] as const;
export type AbilityActivationType = (typeof abilityActivationTypes)[number];

export const resourceCostTimings = ["onActivate", "onUse", "perRound"] as const;
export type ResourceCostTiming = (typeof resourceCostTimings)[number];

export interface ResourceCost {
  resourceId: string;
  amount: number;
  /**
   * When this cost is paid. Missing values are accepted only for persisted
   * compatibility and are normalized by rules-core before execution.
   */
  timing?: ResourceCostTiming;
  /** Optional availability gate greater than the amount actually spent. */
  minimumRemaining?: number;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description?: string;
  activation: AbilityActivationType;
  effects: Effect[];
  costs?: ResourceCost[];
  contextFlags?: string[];
  /** Catalog migration semantics shared with the legacy feature definition. */
  exclusiveGroup?: string;
  priority?: number;
  source?: ProgressionSourceMetadata;
}
export type AbilityCatalog = Record<string, AbilityDefinition>;

/** A possessed ability. Local abilities carry their editable mechanics directly. */
export interface AbilityInstance {
  id: string;
  definitionId?: string;
  name: string;
  description?: string;
  activation: AbilityActivationType;
  /** Only toggleable abilities use active; passive abilities are always effective. */
  active?: boolean;
  effects: Effect[];
  costs?: ResourceCost[];
  contextFlags?: string[];
  exclusiveGroup?: string;
  priority?: number;
  /** Optional semantic link for spell-like abilities; ability costs remain authoritative. */
  spellId?: string;
}

/** Spell levels are associated with lists, never assumed to be universal. */
export interface SpellLevelAssociation { spellListId: string; level: number }
export type CastingTime = { action: "standard" | "swift" | "immediate" | "fullRound" | "move" | "free" } | { action: "timed"; unit: "rounds" | "minutes" | "hours" | "custom"; amount: number; label?: string };
export interface SpellDefinition {
  id: string; name: string; description: string; school: string; subschool?: string; descriptors?: string[];
  levels: SpellLevelAssociation[]; castingTime: CastingTime; components: string[];
  range?: string; target?: string; area?: string; duration?: string;
  savingThrow?: { save?: SaveId; result: "negates" | "half" | "partial" | "disbelief" | "harmless" | "none" };
  spellResistance?: boolean;
  execution?: { damage?: { dice: DiceExpression; damageType: string; perCasterLevel?: boolean; casterLevelCap?: number }; attack?: "meleeTouch" | "rangedTouch" };
  source?: ProgressionSourceMetadata;
}
export type SpellCatalog = Record<string, SpellDefinition>;
export interface SpellSlotProgressionRow {
  level: number; casterLevel: number; maximumSpellLevel: number;
  slots: Record<string, number>; spellsKnown?: Record<string, number>;
}
export interface SpellcastingAdvancement {
  /** Global identity is stable across advancement tracks. */
  sourceId?: string;
  progressionId: string;
  levels: number;
  selection?: "source";
  /** References an ordinary progression feature choice when selection is required. */
  choiceFeatureId?: string;
  choiceRequirementId?: string;
}
export interface PreparedSpellAllocation { id: string; spellId: string; spellLevel: number; expended?: boolean }
export interface SpellcastingSource {
  id: string; name: string; mode: "prepared" | "spontaneous" | (string & {});
  castingAbility: AbilityId; progressionId?: string; progressionLevel?: number;
  spellListId: string; spellListAccess: "list" | "spellbook"; bonusSlots: "standard" | "none";
  progression: SpellSlotProgressionRow[];
  knownSpellIds?: string[]; spellbookSpellIds?: string[]; preparedSpells?: PreparedSpellAllocation[];
  source?: ProgressionSourceMetadata;
}

export type ResourceMaximumTerm =
  | {
      kind: "abilityModifier";
      ability: AbilityId;
      multiplier?: number;
      /** Current includes active effects; base reads the authored base score. */
      source?: "base" | "current";
    }
  | { kind: "progressionLevel"; progressionId: string; multiplier?: number }
  | { kind: "constant"; value: number; label?: string };

export type ResourceMaximum =
  | { kind: "fixed"; value: number }
  | { kind: "manual"; value: number }
  | { kind: "derived"; base?: number; terms: ResourceMaximumTerm[] };

export type ResourceRefreshRule =
  | { kind: "manual" }
  | { kind: "round" }
  | { kind: "encounter" }
  | { kind: "rest" }
  | { kind: "daily" }
  | { kind: "interval"; rounds: number }
  | { kind: "rechargeRoll"; dice: DiceExpression }
  | { kind: "unlimited" };

export interface ResourceDefinition {
  id: string;
  name: string;
  description?: string;
  maximum: ResourceMaximum;
  refresh: ResourceRefreshRule;
}

/** Mutable usage is separate from the authored definition/capacity. */
export interface ResourceState {
  resourceId: string;
  spent: number;
  /** Timed/recharge resources count down without changing their maximum. */
  roundsUntilRefresh?: number;
}

/** One explicitly selectable result of a level-granted feature. */
export interface ChoiceOption {
  id: string;
  name: string;
  description?: string;
  /** Optional mechanics use the ordinary effect pipeline when a lifecycle service materializes the selection. */
  effects?: Effect[];
}

/**
 * Content-owned prompt for a future creation/advancement UI. This intentionally
 * models only a bounded selection; it does not imply a universal feat or
 * spellcasting-choice system.
 */
export interface ChoiceRequirement {
  id: string;
  prompt: string;
  description?: string;
  minimum: number;
  maximum: number;
  options: ChoiceOption[];
  /** Lets a trusted campaign record a named option outside the supplied list. */
  allowCustom?: boolean;
}

/** Stable provenance for a choice requirement unlocked by a progression feature. */
export interface ChoiceRequirementReference {
  progressionId: string;
  featureId: string;
  slotId: string;
  trackId: string;
  requirementId: string;
}

/** An authored answer to one content-owned choice requirement. */
export interface ChoiceSelection {
  id: string;
  requirement: ChoiceRequirementReference;
  optionIds: string[];
  /** Named homebrew answers are retained alongside catalog option ids. */
  customOptions?: ChoiceOption[];
  note?: string;
}

export const hpAcquisitionMethods = [
  "maximum",
  "fixed",
  "rolled",
  "manual",
  "custom",
] as const;
export type HpAcquisitionMethod = (typeof hpAcquisitionMethods)[number];

/** Historical winning-HD evidence retained with an authored HP gain. */
export interface HpAcquisitionSource {
  trackId: string;
  progressionId: string;
  sides: number;
}

/** One level slot's authored HP-before-Constitution result. */
export interface HpAcquisition {
  slotId: string;
  method: HpAcquisitionMethod;
  amount: number;
  /** Identifies a campaign policy/custom procedure without making it engine logic. */
  policyId?: string;
  note?: string;
  /** Snapshot provenance; the current evaluator can also explain it from the slot. */
  source?: HpAcquisitionSource;
}

export const skillAllocationMethods = ["policy", "manual", "custom"] as const;
export type SkillAllocationMethod = (typeof skillAllocationMethods)[number];

/** Historical winning skill-chassis evidence retained with an allocation. */
export interface SkillAllocationSource {
  trackId: string;
  progressionId: string;
  skillPoints: number;
}

/** The rank deltas authored for one level slot, not the character's aggregate ranks. */
export interface SkillRankAllocation {
  slotId: string;
  ranks: Record<string, number>;
  method: SkillAllocationMethod;
  note?: string;
  source?: SkillAllocationSource;
  /** Calculated policy budget at the time of the committed allocation. */
  budget?: number;
}

/** A narrow, explicit target for a deliberately accepted lifecycle warning. */
export interface LifecycleOverrideScope {
  slotId?: string;
  trackId?: string;
  progressionId?: string;
  featureId?: string;
  choiceRequirementId?: string;
  skillId?: string;
}

/**
 * A real authored fact, rather than a global validation bypass. Lifecycle
 * services match its code and narrow nonempty scope only to overridable warnings.
 */
export interface LifecycleOverride {
  id: string;
  code: string;
  reason: string;
  scope: LifecycleOverrideScope;
}

/** Optional authored lifecycle provenance; temporary proposal UI state never belongs here. */
export interface CharacterLifecycleState {
  hpAcquisitions?: HpAcquisition[];
  skillAllocations?: SkillRankAllocation[];
  choiceSelections?: ChoiceSelection[];
  overrides?: LifecycleOverride[];
}

export interface CampaignAdvancementTrack {
  id: string;
  name: string;
  description?: string;
}

export interface MaximumHpAcquisitionRule {
  kind: "maximum";
}

export interface FixedHpAcquisitionRule {
  kind: "fixed";
  amount: number;
}

export interface RolledHpAcquisitionRule {
  kind: "rolled";
  minimum?: number;
  maximum?: number;
}

export interface ManualHpAcquisitionRule {
  kind: "manual";
}

export interface CustomHpAcquisitionRule {
  kind: "custom";
  id: string;
  label: string;
}

export type HpAcquisitionRule =
  | MaximumHpAcquisitionRule
  | FixedHpAcquisitionRule
  | RolledHpAcquisitionRule
  | ManualHpAcquisitionRule
  | CustomHpAcquisitionRule;

/** A campaign can use a different HP procedure for level 1 and later slots. */
export interface HpAcquisitionPolicy {
  firstLevel: HpAcquisitionRule;
  laterLevels: HpAcquisitionRule;
}

export interface CharacterLevelSkillRankCap {
  kind: "characterLevel";
  multiplier?: number;
  offset?: number;
}

export interface FixedSkillRankCap {
  kind: "fixed";
  value: number;
}

export type SkillRankCap = CharacterLevelSkillRankCap | FixedSkillRankCap;

export interface CalculatedSkillAllocationPolicy {
  kind: "calculated";
  includeIntelligenceModifier: boolean;
  minimumPerLevel?: number;
  firstLevelMultiplier?: number;
  rankCap?: SkillRankCap;
}

export interface ManualSkillAllocationPolicy {
  kind: "manual";
  rankCap?: SkillRankCap;
}

export interface CustomSkillAllocationPolicy {
  kind: "custom";
  id: string;
  label: string;
  rankCap?: SkillRankCap;
}

export type SkillAllocationPolicy =
  | CalculatedSkillAllocationPolicy
  | ManualSkillAllocationPolicy
  | CustomSkillAllocationPolicy;

/**
 * Deliberately small campaign policy used by lifecycle services. Catalogs are
 * still injected at runtime; ids/sources here constrain what that service may offer.
 */
export interface CampaignCharacterProfile {
  id: string;
  name?: string;
  startingLevel: number;
  tracks: CampaignAdvancementTrack[];
  availableProgressionIds?: string[];
  catalogSourceIds?: string[];
  allowCustomProgressions?: boolean;
  hpPolicy: HpAcquisitionPolicy;
  skillAllocationPolicy: SkillAllocationPolicy;
  allowManualOverrides?: boolean;
}

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
  /** Damage multiplier on a critical hit; the profile's value applies when omitted, default ×2. */
  criticalMultiplier?: number;
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
  /** Critical damage multiplier shared by weapons using this profile; default ×2. */
  criticalMultiplier?: number;
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
  /** Bounded choices the feature asks its owner to make at unlock time. */
  choices?: ChoiceRequirement[];
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
  /** Typed level contribution; no class-name behavior is inferred. */
  spellcastingAdvancement?: SpellcastingAdvancement[];
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
  /** Authored lifecycle provenance; never use this for in-progress UI state. */
  lifecycle?: CharacterLifecycleState;
  /** XP is optional and advisory; it never creates advancement slots. */
  experience?: { points: number; trackId: string };
  skillRanks: Record<string, number>;
  skills?: Record<string, SkillConfiguration>;
  attacks: AttackDefinition[];
  features: FeatureInstance[];
  /** First-class possessed abilities; legacy features remain supported. */
  abilities?: AbilityInstance[];
  /** Character-local resource definitions travel with the authored snapshot. */
  resources?: ResourceDefinition[];
  /** Mutable play state, conceptually separate but snapshot-persisted for compatibility. */
  resourceStates?: ResourceState[];
  /** Character-owned independent casting sources; capacities are derived from their tables. */
  spellcastingSources?: SpellcastingSource[];
  /** Custom spell definitions travel with this character and never mutate imported catalogs. */
  customSpells?: SpellCatalog;
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
    !target.startsWith("progression.") &&
    !target.startsWith("resource.") &&
    target !== "experience.level",
  "Progression levels, resource maxima, and experience levels are query-only",
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
    attackIds: z.array(z.string().min(1)).min(1).optional(),
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
/** A critical hit multiplies damage by at least 2; 3 and 4 are ordinary values. */
export const criticalMultiplierSchema = z.number().int().min(2);

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
    spellId: z.string().min(1).optional(),
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
  natural20: z.boolean().optional(),
  natural1: z.boolean().optional(),
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
      widenBy: z.number().int().min(1).max(18).optional(),
      operation: z.enum(criticalRangeOperations).optional(),
      appliesWhen: applicabilitySchema.optional(),
      source: sourceReferenceSchema.optional(),
    }),
    z.object({
      kind: z.literal("damageDice"),
      target: z.enum(["damage.melee", "damage.ranged"]),
      dice: diceExpressionSchema,
      damageType: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      criticalBehavior: z.enum(damageCriticalBehaviors),
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
    if (effect.kind === "criticalRange") {
      const operation = effect.operation ?? "widen";
      if (operation === "double" && effect.widenBy !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["widenBy"],
          message: "A doubling threat-range expansion takes no widenBy",
        });
      if (operation === "widen" && effect.widenBy === undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["widenBy"],
          message: "A widening threat-range expansion requires widenBy",
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

export const choiceOptionSchema: z.ZodType<ChoiceOption> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  effects: z.array(effectSchema).optional(),
});
export const choiceRequirementSchema: z.ZodType<ChoiceRequirement> = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    description: z.string().min(1).optional(),
    minimum: z.number().finite().int().nonnegative(),
    maximum: z.number().finite().int().nonnegative(),
    options: z.array(choiceOptionSchema),
    allowCustom: z.boolean().optional(),
  })
  .superRefine((requirement, context) => {
    if (requirement.minimum > requirement.maximum)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimum"],
        message: "Choice minimum cannot exceed maximum",
      });
    if (!requirement.allowCustom && requirement.maximum > requirement.options.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximum"],
        message: "Choice maximum cannot exceed the supplied option count without allowCustom",
      });
    const ids = new Set<string>();
    for (const [index, option] of requirement.options.entries()) {
      if (ids.has(option.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options", index, "id"],
          message: `Duplicate choice option id ${option.id}`,
        });
      ids.add(option.id);
    }
  }) as z.ZodType<ChoiceRequirement>;
export const choiceRequirementReferenceSchema: z.ZodType<ChoiceRequirementReference> =
  z.object({
    progressionId: progressionIdSchema,
    featureId: z.string().min(1),
    slotId: z.string().min(1),
    trackId: z.string().min(1),
    requirementId: z.string().min(1),
  });
export const choiceSelectionSchema: z.ZodType<ChoiceSelection> = z
  .object({
    id: z.string().min(1),
    requirement: choiceRequirementReferenceSchema,
    optionIds: z.array(z.string().min(1)),
    customOptions: z.array(choiceOptionSchema).optional(),
    note: z.string().min(1).optional(),
  })
  .superRefine((selection, context) => {
    const optionIds = new Set<string>();
    for (const [index, id] of selection.optionIds.entries()) {
      if (optionIds.has(id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionIds", index],
          message: `Duplicate selected choice option id ${id}`,
        });
      optionIds.add(id);
    }
    const customIds = new Set<string>();
    for (const [index, option] of (selection.customOptions ?? []).entries()) {
      if (customIds.has(option.id) || optionIds.has(option.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customOptions", index, "id"],
          message: `Duplicate selected custom choice option id ${option.id}`,
        });
      customIds.add(option.id);
    }
    if (selection.optionIds.length + (selection.customOptions?.length ?? 0) === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionIds"],
        message: "A choice selection requires at least one selected option",
      });
  }) as z.ZodType<ChoiceSelection>;

export const hpAcquisitionSchema: z.ZodType<HpAcquisition> = z.object({
  slotId: z.string().min(1),
  method: z.enum(hpAcquisitionMethods),
  amount: z.number().finite().nonnegative(),
  policyId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  source: z
    .object({
      trackId: z.string().min(1),
      progressionId: progressionIdSchema,
      sides: z.number().finite().int().positive(),
    })
    .optional(),
});
export const skillRankAllocationSchema: z.ZodType<SkillRankAllocation> = z.object({
  slotId: z.string().min(1),
  ranks: z.record(z.number().finite().int().nonnegative()),
  method: z.enum(skillAllocationMethods),
  note: z.string().min(1).optional(),
  source: z
    .object({
      trackId: z.string().min(1),
      progressionId: progressionIdSchema,
      skillPoints: z.number().finite().int().nonnegative(),
    })
    .optional(),
  budget: z.number().finite().int().nonnegative().optional(),
});
export const lifecycleOverrideScopeSchema: z.ZodType<LifecycleOverrideScope> =
  z
    .object({
      slotId: z.string().min(1).optional(),
      trackId: z.string().min(1).optional(),
      progressionId: progressionIdSchema.optional(),
      featureId: z.string().min(1).optional(),
      choiceRequirementId: z.string().min(1).optional(),
      skillId: skillIdSchema.optional(),
    })
    .refine(
      (scope) => Object.values(scope).some((value) => value !== undefined),
      "A lifecycle override must identify a slot, track, progression, feature, choice, or skill",
    );
export const lifecycleOverrideSchema: z.ZodType<LifecycleOverride> = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  reason: z.string().min(1),
  scope: lifecycleOverrideScopeSchema,
});
export const characterLifecycleStateSchema: z.ZodType<CharacterLifecycleState> = z
  .object({
    hpAcquisitions: z.array(hpAcquisitionSchema).optional(),
    skillAllocations: z.array(skillRankAllocationSchema).optional(),
    choiceSelections: z.array(choiceSelectionSchema).optional(),
    overrides: z.array(lifecycleOverrideSchema).optional(),
  })
  .superRefine((lifecycle, context) => {
    const ensureUnique = <T>(
      values: readonly T[] | undefined,
      field: string,
      keyOf: (value: T) => string,
      label: string,
    ) => {
      const keys = new Set<string>();
      for (const [index, value] of (values ?? []).entries()) {
        const key = keyOf(value);
        if (keys.has(key))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field, index],
            message: `Duplicate ${label} ${key}`,
          });
        keys.add(key);
      }
    };
    ensureUnique(
      lifecycle.hpAcquisitions,
      "hpAcquisitions",
      (item) => item.slotId,
      "HP acquisition slot",
    );
    ensureUnique(
      lifecycle.skillAllocations,
      "skillAllocations",
      (item) => item.slotId,
      "skill allocation slot",
    );
    ensureUnique(
      lifecycle.choiceSelections,
      "choiceSelections",
      (item) => item.id,
      "choice selection id",
    );
    ensureUnique(
      lifecycle.overrides,
      "overrides",
      (item) => item.id,
      "lifecycle override id",
    );
    const requirements = new Set<string>();
    for (const [index, selection] of (lifecycle.choiceSelections ?? []).entries()) {
      const requirement = selection.requirement;
      const key = [
        requirement.progressionId,
        requirement.featureId,
        requirement.slotId,
        requirement.trackId,
        requirement.requirementId,
      ].join("\u0000");
      if (requirements.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choiceSelections", index, "requirement"],
          message: "Duplicate choice selection for one requirement",
        });
      requirements.add(key);
    }
  }) as z.ZodType<CharacterLifecycleState>;

export const hpAcquisitionRuleSchema: z.ZodType<HpAcquisitionRule> = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("maximum") }),
    z.object({
      kind: z.literal("fixed"),
      amount: z.number().finite().nonnegative(),
    }),
    z.object({
      kind: z.literal("rolled"),
      minimum: z.number().finite().nonnegative().optional(),
      maximum: z.number().finite().nonnegative().optional(),
    }),
    z.object({ kind: z.literal("manual") }),
    z.object({
      kind: z.literal("custom"),
      id: z.string().min(1),
      label: z.string().min(1),
    }),
  ])
  .superRefine((rule, context) => {
    if (
      rule.kind === "rolled" &&
      rule.minimum !== undefined &&
      rule.maximum !== undefined &&
      rule.minimum > rule.maximum
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimum"],
        message: "Rolled HP minimum cannot exceed maximum",
      });
  }) as z.ZodType<HpAcquisitionRule>;
export const hpAcquisitionPolicySchema: z.ZodType<HpAcquisitionPolicy> = z.object({
  firstLevel: hpAcquisitionRuleSchema,
  laterLevels: hpAcquisitionRuleSchema,
});
export const skillRankCapSchema: z.ZodType<SkillRankCap> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("characterLevel"),
      multiplier: z.number().finite().positive().optional(),
      offset: z.number().finite().optional(),
    }),
    z.object({
      kind: z.literal("fixed"),
      value: z.number().finite().nonnegative(),
    }),
  ],
) as z.ZodType<SkillRankCap>;
export const skillAllocationPolicySchema: z.ZodType<SkillAllocationPolicy> =
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("calculated"),
      includeIntelligenceModifier: z.boolean(),
      minimumPerLevel: z.number().finite().int().nonnegative().optional(),
      firstLevelMultiplier: z.number().finite().int().positive().optional(),
      rankCap: skillRankCapSchema.optional(),
    }),
    z.object({
      kind: z.literal("manual"),
      rankCap: skillRankCapSchema.optional(),
    }),
    z.object({
      kind: z.literal("custom"),
      id: z.string().min(1),
      label: z.string().min(1),
      rankCap: skillRankCapSchema.optional(),
    }),
  ]) as z.ZodType<SkillAllocationPolicy>;
export const campaignAdvancementTrackSchema: z.ZodType<CampaignAdvancementTrack> =
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
  });
export const campaignCharacterProfileSchema: z.ZodType<CampaignCharacterProfile> =
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      startingLevel: z.number().finite().int().positive(),
      tracks: z.array(campaignAdvancementTrackSchema).min(1),
      availableProgressionIds: z.array(progressionIdSchema).optional(),
      catalogSourceIds: z.array(z.string().min(1)).optional(),
      allowCustomProgressions: z.boolean().optional(),
      hpPolicy: hpAcquisitionPolicySchema,
      skillAllocationPolicy: skillAllocationPolicySchema,
      allowManualOverrides: z.boolean().optional(),
    })
    .superRefine((profile, context) => {
      const checkDuplicates = (
        values: readonly string[] | undefined,
        field: "availableProgressionIds" | "catalogSourceIds",
      ) => {
        const seen = new Set<string>();
        for (const [index, value] of (values ?? []).entries()) {
          if (seen.has(value))
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [field, index],
              message: `Duplicate ${field} value ${value}`,
            });
          seen.add(value);
        }
      };
      const trackIds = new Set<string>();
      for (const [index, track] of profile.tracks.entries()) {
        if (trackIds.has(track.id))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tracks", index, "id"],
            message: `Duplicate campaign advancement track id ${track.id}`,
          });
        trackIds.add(track.id);
      }
      checkDuplicates(profile.availableProgressionIds, "availableProgressionIds");
      checkDuplicates(profile.catalogSourceIds, "catalogSourceIds");
    }) as z.ZodType<CampaignCharacterProfile>;

export function parseCharacterLifecycleState(
  value: unknown,
): CharacterLifecycleState {
  return characterLifecycleStateSchema.parse(value);
}

export function parseCampaignCharacterProfile(
  value: unknown,
): CampaignCharacterProfile {
  return campaignCharacterProfileSchema.parse(value);
}

export const featureInstanceSchema: z.ZodType<FeatureInstance> = z.object({
  id: z.string().min(1),
  definitionId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  effects: z.array(effectSchema),
  contextFlags: z.array(flagSchema).min(1).optional(),
});
export const resourceCostSchema: z.ZodType<ResourceCost> = z.object({
  resourceId: z.string().min(1),
  amount: z.number().finite().int().positive(),
  timing: z.enum(resourceCostTimings).optional(),
  minimumRemaining: z.number().finite().int().nonnegative().optional(),
});
export const abilityDefinitionSchema: z.ZodType<AbilityDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  activation: z.enum(abilityActivationTypes),
  effects: z.array(effectSchema),
  costs: z.array(resourceCostSchema).optional(),
  contextFlags: z.array(flagSchema).min(1).optional(),
  exclusiveGroup: z.string().min(1).optional(),
  priority: z.number().finite().int().optional(),
  source: z.lazy(() => progressionSourceMetadataSchema).optional(),
});
export const abilityCatalogSchema: z.ZodType<AbilityCatalog> = z.record(
  abilityDefinitionSchema,
);
export function parseAbilityCatalog(value: unknown): AbilityCatalog {
  return abilityCatalogSchema.parse(value);
}
export const abilityInstanceSchema: z.ZodType<AbilityInstance> = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  activation: z.enum(abilityActivationTypes),
  active: z.boolean().optional(),
  effects: z.array(effectSchema),
  costs: z.array(resourceCostSchema).optional(),
  contextFlags: z.array(flagSchema).min(1).optional(),
  exclusiveGroup: z.string().min(1).optional(),
  priority: z.number().finite().int().optional(),
  spellId: z.string().min(1).optional(),
});
const castingTimeSchema = z.union([
  z.object({ action: z.enum(["standard", "swift", "immediate", "fullRound", "move", "free"]) }),
  z.object({ action: z.literal("timed"), unit: z.enum(["rounds", "minutes", "hours", "custom"]), amount: z.number().finite().positive(), label: z.string().optional() }),
]);
export const spellDefinitionSchema: z.ZodType<SpellDefinition> = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string(), school: z.string().min(1),
  subschool: z.string().optional(), descriptors: z.array(z.string()).optional(),
  levels: z.array(z.object({ spellListId: z.string().min(1), level: z.number().int().nonnegative() })).min(1),
  castingTime: castingTimeSchema, components: z.array(z.string()), range: z.string().optional(), target: z.string().optional(), area: z.string().optional(), duration: z.string().optional(),
  savingThrow: z.object({ save: saveIdSchema.optional(), result: z.enum(["negates", "half", "partial", "disbelief", "harmless", "none"]) }).optional(),
  spellResistance: z.boolean().optional(),
  execution: z.object({ damage: z.object({ dice: diceExpressionSchema, damageType: z.string().min(1), perCasterLevel: z.boolean().optional(), casterLevelCap: z.number().int().positive().optional() }).optional(), attack: z.enum(["meleeTouch", "rangedTouch"]).optional() }).optional(),
  source: z.lazy(() => progressionSourceMetadataSchema).optional(),
});
export const spellCatalogSchema: z.ZodType<SpellCatalog> = z.record(spellDefinitionSchema).superRefine((catalog, context) => {
  for (const [id, spell] of Object.entries(catalog)) if (id !== spell.id) context.addIssue({ code: z.ZodIssueCode.custom, path: [id], message: "Spell catalog key must match definition id" });
});
const spellProgressionRowSchema: z.ZodType<SpellSlotProgressionRow> = z.object({
  level: z.number().int().nonnegative(), casterLevel: z.number().int().nonnegative(), maximumSpellLevel: z.number().int().nonnegative(),
  slots: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()),
  spellsKnown: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()).optional(),
});
const spellcastingAdvancementSchema: z.ZodType<SpellcastingAdvancement> = z.object({ sourceId: z.string().min(1).optional(), progressionId: z.string().min(1), levels: z.number().int().positive(), selection: z.literal("source").optional(), choiceFeatureId: z.string().min(1).optional(), choiceRequirementId: z.string().min(1).optional() }).superRefine((rule, context) => {
  if (rule.selection === "source" && (!rule.choiceFeatureId || !rule.choiceRequirementId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["choiceRequirementId"], message: "Source choices must reference a lifecycle feature and requirement" });
  if (rule.selection !== "source" && !rule.sourceId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceId"], message: "Fixed casting advancement requires a source id" });
});
const preparedSpellAllocationSchema: z.ZodType<PreparedSpellAllocation> = z.object({ id: z.string().min(1), spellId: z.string().min(1), spellLevel: z.number().int().nonnegative(), expended: z.boolean().optional() });
export const spellcastingSourceSchema: z.ZodType<SpellcastingSource> = z.object({
  id: z.string().min(1), name: z.string().min(1), mode: z.string().min(1), castingAbility: abilityIdSchema,
  progressionId: z.string().min(1).optional(), progressionLevel: z.number().int().nonnegative().optional(),
  spellListId: z.string().min(1), spellListAccess: z.enum(["list", "spellbook"]), bonusSlots: z.enum(["standard", "none"]),
  progression: z.array(spellProgressionRowSchema).min(1), knownSpellIds: z.array(z.string().min(1)).optional(), spellbookSpellIds: z.array(z.string().min(1)).optional(), preparedSpells: z.array(preparedSpellAllocationSchema).optional(), source: z.lazy(() => progressionSourceMetadataSchema).optional(),
}).superRefine((source, context) => {
  const levels = source.progression.map((row) => row.level);
  if (new Set(levels).size !== levels.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["progression"], message: "Duplicate spellcasting progression level" });
  if (source.mode === "prepared" && !source.preparedSpells) context.addIssue({ code: z.ZodIssueCode.custom, path: ["preparedSpells"], message: "Prepared sources require prepared spell allocations" });
  if (source.mode === "spontaneous" && !source.knownSpellIds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["knownSpellIds"], message: "Spontaneous sources require known spells" });
});
export const resourceMaximumSchema: z.ZodType<ResourceMaximum> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("fixed"), value: z.number().finite().int().nonnegative() }),
    z.object({ kind: z.literal("manual"), value: z.number().finite().int().nonnegative() }),
    z.object({
      kind: z.literal("derived"),
      base: z.number().finite().optional(),
      terms: z.array(z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("abilityModifier"), ability: abilityIdSchema, multiplier: z.number().finite().optional(), source: z.enum(["base", "current"]).optional() }),
        z.object({ kind: z.literal("progressionLevel"), progressionId: z.string().min(1), multiplier: z.number().finite().optional() }),
        z.object({ kind: z.literal("constant"), value: z.number().finite(), label: z.string().min(1).optional() }),
      ])),
    }),
  ],
);
export const resourceRefreshRuleSchema: z.ZodType<ResourceRefreshRule> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("manual") }),
    z.object({ kind: z.literal("round") }),
    z.object({ kind: z.literal("encounter") }),
    z.object({ kind: z.literal("rest") }),
    z.object({ kind: z.literal("daily") }),
    z.object({ kind: z.literal("interval"), rounds: z.number().int().positive() }),
    z.object({ kind: z.literal("rechargeRoll"), dice: diceExpressionSchema }),
    z.object({ kind: z.literal("unlimited") }),
  ],
);
export const resourceDefinitionSchema: z.ZodType<ResourceDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  maximum: resourceMaximumSchema,
  refresh: resourceRefreshRuleSchema,
});
export const resourceStateSchema: z.ZodType<ResourceState> = z.object({
  resourceId: z.string().min(1),
  spent: z.number().finite().int().nonnegative(),
  roundsUntilRefresh: z.number().finite().int().nonnegative().optional(),
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
  criticalMultiplier: criticalMultiplierSchema.optional(),
  source: z.lazy(() => progressionSourceMetadataSchema).optional(),
});
export const progressionFeatureDefinitionSchema: z.ZodType<ProgressionFeatureDefinition> =
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      level: z.number().finite().int().positive(),
      description: z.string().min(1).optional(),
      effects: z.array(effectSchema).optional(),
      choices: z.array(choiceRequirementSchema).optional(),
    })
    .superRefine((feature, context) => {
      const ids = new Set<string>();
      for (const [index, choice] of (feature.choices ?? []).entries()) {
        if (ids.has(choice.id))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["choices", index, "id"],
            message: `Duplicate progression feature choice id ${choice.id}`,
          });
        ids.add(choice.id);
      }
    }) as z.ZodType<ProgressionFeatureDefinition>;
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
    criticalMultiplier: criticalMultiplierSchema.optional(),
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
    spellcastingAdvancement: z.array(spellcastingAdvancementSchema).optional(),
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
    lifecycle: characterLifecycleStateSchema.optional(),
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
    abilities: z.array(abilityInstanceSchema).optional(),
    resources: z.array(resourceDefinitionSchema).optional(),
    resourceStates: z.array(resourceStateSchema).optional(),
    spellcastingSources: z.array(spellcastingSourceSchema).optional(),
    customSpells: spellCatalogSchema.optional(),
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
    for (const key of ["features", "abilities", "resources", "attacks", "equipment"] as const) {
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
    const sources = new Set((character.spellcastingSources ?? []).map((item) => item.id));
    const sourceIds = [...sources];
    if (sources.size !== (character.spellcastingSources ?? []).length)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["spellcastingSources"], message: "Duplicate spellcasting source id" });
    for (const [index, source] of (character.spellcastingSources ?? []).entries()) {
      const allocationIds = new Set<string>();
      for (const allocation of source.preparedSpells ?? []) {
        if (allocationIds.has(allocation.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["spellcastingSources", index, "preparedSpells"], message: `Duplicate prepared spell allocation ${allocation.id}` });
        allocationIds.add(allocation.id);
      }
    }
    const resourceIds = new Set((character.resources ?? []).map((item) => item.id));
    const stateIds = new Set<string>();
    for (const state of character.resourceStates ?? []) {
      const dynamicSpellSlot = /^spell\.(.+)\.slot\.(\d+)$/.exec(state.resourceId);
      if (!resourceIds.has(state.resourceId) && !(dynamicSpellSlot && sourceIds.includes(dynamicSpellSlot[1]!)))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["resourceStates"],
          message: `Resource state references missing resource ${state.resourceId}`,
        });
      if (stateIds.has(state.resourceId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["resourceStates"],
          message: `Duplicate resource state ${state.resourceId}`,
        });
      stateIds.add(state.resourceId);
    }
    for (const ability of character.abilities ?? []) {
      if (ability.activation !== "toggleable" && ability.active !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["abilities"],
          message: `Only toggleable ability ${ability.id} may persist active state`,
        });
      for (const cost of ability.costs ?? [])
        if (!resourceIds.has(cost.resourceId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["abilities"],
            message: `Ability ${ability.id} references missing resource ${cost.resourceId}`,
          });
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
    for (const ability of character.abilities ?? []) {
      const enabled = ability.activation === "passive" ||
        (ability.activation === "toggleable" && ability.active === true);
      if (!enabled) continue;
      for (const effect of ability.effects) {
        if (effect.kind !== "replaceBase") continue;
        const count = replacements.get(effect.target) ?? 0;
        replacements.set(effect.target, count + 1);
        if (count > 0)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["abilities"],
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
  /** The weapon's or profile's critical multiplier; 2 when nothing authors one. */
  criticalMultiplier: number;
  contributions: Contribution[];
  /** Base and additional dice retain source and critical semantics. */
  terms: DamageDiceTerm[];
  /** Contextual filtering provenance for damage effects. */
  excluded?: ExcludedContribution[];
  excludedDamageTerms?: ExcludedDamageDiceTerm[];
}

export interface ExcludedDamageDiceTerm {
  dice: DiceExpression;
  label: string;
  source: SourceReference;
  damageType?: string;
  reason: string;
  rollContext?: RollContext;
}

export interface DamageDiceTerm {
  kind: "dice";
  dice: DiceExpression;
  label: string;
  source: SourceReference;
  damageType?: string;
  criticalBehavior: DamageCriticalBehavior;
  /** Copies used by this particular ordinary/critical roll plan. */
  multiplier: number;
}

export interface DerivedResource {
  id: string;
  name: string;
  description?: string;
  maximum: number | null;
  spent: number;
  remaining: number | null;
  refresh: ResourceRefreshRule;
  roundsUntilRefresh?: number;
  provenance: Contribution[];
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
  /** Choice metadata survives advancement evaluation for lifecycle consumers. */
  choices?: ChoiceRequirement[];
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
  resources: DerivedResource[];
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
