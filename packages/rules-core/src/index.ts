/**
 * `@threepointpf/rules-core`
 *
 * The evaluator is split along domain boundaries; this module is the public
 * entry point and keeps the original API stable.
 *
 * - `contributions`  typed reduction and the contribution vocabulary
 * - `labels`         display names for targets/skills
 * - `effects`        effect collection, contextual applicability, operations
 * - `abilities`      ability scores/modifiers, including the penalty floor
 * - `defenses`       AC contexts and semantic CMB/CMD derivation
 * - `skills`         class-skill status, skill totals, initiative
 * - `size`           size categories and movement modes
 * - `equipment`      equipment resolution and equipped-effect collection
 * - `attacks`        contextual attack/damage evaluation and action plans
 * - `experience`     XP eligibility
 * - `advancement`    ordered progression/chassis evaluation
 * - `character`      RulesEngine orchestration and the public evaluation API
 */
export { RulesEngine, evaluateCharacter, evaluate } from "./character.js";
export type { RulesEngineOptions } from "./character.js";
export {
  abilityModifier,
  reduceContributions,
  sourceContribution,
} from "./contributions.js";
export { skillLabel, labelForTarget } from "./labels.js";
export {
  applicabilityOf,
  collectDirectModifiers,
  collectFeatureEffects,
  matchesAttackSelector,
  featureContextFlags,
} from "./effects.js";
export type {
  DirectModifierInput,
  DirectModifierOptions,
  ModifierEffect,
  ReplaceBaseEffect,
} from "./effects.js";
export { abilityPenaltyFloor } from "./abilities.js";
export {
  acModifiersForCmd,
  evaluateArmorClass,
  evaluateCombatManeuver,
} from "./defenses.js";
export { evaluateInitiative, evaluateSkill, classSkillStatus } from "./skills.js";
export { evaluateMovement, computeSizeResult, sizeAdjustment } from "./size.js";
export { resolveEquipment, collectEquipmentEffects } from "./equipment.js";
export {
  attackContext,
  attackRollPlan,
  buildActionPlan,
  deriveAttack,
  evaluateAttack,
  evaluateDamage,
  evaluateExtraAttacks,
  maneuverRollPlan,
  actionExclusions,
} from "./attacks.js";
export type { ActionRequest, AttackRollOptions } from "./attacks.js";
export { experienceResult } from "./experience.js";
export type { RulesRuntime, EquipmentEntry, ResultOptions } from "./runtime.js";
export { evaluateAdvancement, progressionLevel } from "./advancement.js";
export type {
  AdvancementEvaluation,
  SlotHitDie,
  TrackAdvancementResult,
  ProgressionIncrement,
  ProgressionLevelResult,
  AdvancementFeatureGrant,
} from "./advancement.js";

export {
  acModifierAppliesToCmd,
  cmdExcludedBonusTypes,
  isContextualTarget,
  isSelectorTarget,
  selectorTargets,
  maneuverIds,
  attackModes,
  rollKinds,
} from "@threepointpf/rules-schema";
export type {
  ActionAttackPlan,
  ActionPlan,
  ActionPlanStep,
  AttackMode,
  AttackStepRole,
  AttackTag,
  CharacterInput,
  ContextualModifiers,
  Contribution,
  DamageEvaluation,
  DerivedAttack,
  DerivedCharacter,
  DerivedProgressionFeature,
  EffectApplicability,
  EvaluationResult,
  ExcludedContribution,
  ManeuverId,
  ProgressionCatalog,
  RollContext,
  RollKind,
  TargetId,
} from "@threepointpf/rules-schema";
