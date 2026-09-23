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
 * - `outcomes`       outcome policies and effective critical-range derivation
 * - `experience`     XP eligibility
 * - `advancement`    ordered progression/chassis evaluation
 * - `lifecycle`      pure creation and advancement transactions
 * - `ability-resources` ability activation and independent resource state
 * - `character`      RulesEngine orchestration and the public evaluation API
 */
export { RulesEngine, evaluateCharacter, evaluate } from "./character.js";
export type { RollRequestOptions, RulesEngineOptions } from "./character.js";
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
export {
  classSkillStatus,
  evaluateInitiative,
  evaluateSkill,
  initiativeRollPlan,
} from "./skills.js";
export type { InitiativeRollOptions } from "./skills.js";
export { evaluateMovement, computeSizeResult, sizeAdjustment } from "./size.js";
export { resolveEquipment, collectEquipmentEffects } from "./equipment.js";
export {
  actionExclusions,
  actionPlanId,
  attackContext,
  attackModeOf,
  attackRollPlan,
  buildActionPlan,
  damageRollPlan,
  deriveAttack,
  evaluateAttack,
  evaluateDamage,
  evaluateExtraAttacks,
  iterativeCount,
  maneuverRollPlan,
} from "./attacks.js";
export type {
  ActionRequest,
  AttackContextInput,
  AttackRollOptions,
  DamageRollOptions,
  ExtraAttackEvaluation,
} from "./attacks.js";
export {
  attackCriticalMultiplier,
  attackCriticalRange,
  attackOutcomePolicy,
  evaluateCriticalRange,
  maneuverOutcomePolicy,
  outcomePolicyFor,
  pf1eOutcomePolicies,
  plainOutcomePolicy,
  saveOutcomePolicy,
  skillOutcomePolicy,
} from "./outcomes.js";
export { experienceResult } from "./experience.js";
export { applyDamage, applyHealing, setTemporaryHp, clearTemporaryHp } from "./health.js";
export type { RulesRuntime, EquipmentEntry, ResultOptions } from "./runtime.js";
export {
  acceptLifecycleWarning,
  beginAdvancement,
  beginCharacterCreation,
  commitAdvancement,
  commitCharacterCreation,
  LifecycleCommitError,
  previewAdvancement,
  previewCharacterCreation,
  progressionChoicesForCampaign,
  proposeAdvancement,
  proposeCharacterCreation,
  tryCommitAdvancement,
  tryCommitCharacterCreation,
  validateAdvancement,
  validateCharacterCreation,
} from "./lifecycle.js";
export {
  abilityContextFlags,
  abilityIsEffective,
  advanceAbilityResourceRound,
  advanceResourceRound,
  cloneAbilityDefinition,
  collectAbilityEffects,
  commitAbilityActivation,
  costTiming,
  createRechargeRollPlan,
  deriveResources,
  excludedCatalogAbilityDefinitions,
  excludedLegacyFeatureDefinitions,
  prepareAbilityExecution,
  refreshResource,
  refreshResources,
  resolveAbility,
  restoreResource,
  setResourceSpent,
  spendResource,
  validateAbilityActivation,
  validateAbilityReferences,
} from "./ability-resources.js";
export type {
  AbilityActivationProposal,
  AbilityActivationResult,
  AbilityExecutionPlan,
  AbilityExecutionPreparation,
  AbilityValidationIssue,
  ResourceRoundResult,
  ResourceFacts,
} from "./ability-resources.js";
export type {
  AdvancementPreview,
  AdvancementProgressionSelection,
  AdvancementProposal,
  AdvancementProposalChange,
  CharacterCreationPreview,
  CharacterCreationProposal,
  CharacterCreationProposalChange,
  FeatureChoiceRequirement,
  HpAcquisitionPreview,
  HpAcquisitionProposal,
  LifecycleChange,
  LifecycleChoiceRequirement,
  LifecycleCommitFailure,
  LifecycleCommitResult,
  LifecycleCommitSuccess,
  LifecycleIssue,
  LifecycleIssueSeverity,
  LifecycleProgressionOption,
  LifecycleValidationResult,
  ProgressionChoiceRequirement,
  SkillAllocationPreview,
  SkillRankAllocationProposal,
} from "./lifecycle.js";
export { evaluateAdvancement, progressionLevel } from "./advancement.js";
export type {
  AdvancementEvaluation,
  SlotHitDie,
  SlotSkillPointSource,
  TrackAdvancementResult,
  ProgressionIncrement,
  ProgressionLevelResult,
  AdvancementFeatureGrant,
} from "./advancement.js";

export {
  acModifierAppliesToCmd,
  actionKinds,
  campaignCharacterProfileSchema,
  cmdExcludedBonusTypes,
  criticalRangeOperations,
  d20CheckDie,
  defaultCriticalRange,
  hasPrimaryCheckDie,
  isContextualTarget,
  isFullAttackAction,
  isManeuverAction,
  isSelectorTarget,
  parseCampaignCharacterProfile,
  naturalFaceClassifications,
  rollDefenseKinds,
  rollOutcomeKinds,
  selectorTargets,
  maneuverIds,
  attackModes,
  rollKinds,
} from "@threepointpf/rules-schema";
export type {
  ActionAttackPlan,
  AbilityActivationType,
  AbilityCatalog,
  AbilityDefinition,
  AbilityInstance,
  ActionContext,
  ActionKind,
  ActionPlan,
  ActionPlanStep,
  AttackMode,
  AttackStepRole,
  AttackTag,
  CharacterInput,
  CampaignCharacterProfile,
  CampaignAdvancementTrack,
  CharacterLifecycleState,
  ChoiceOption,
  ChoiceRequirement,
  ChoiceRequirementReference,
  ChoiceSelection,
  ContextualModifiers,
  Contribution,
  CriticalRange,
  CriticalRangeEffect,
  CriticalRangeEvaluation,
  CriticalRangeOperation,
  DamageEvaluation,
  DamageCriticalBehavior,
  DamageDiceEffect,
  DamageDiceTerm,
  DerivedAttack,
  DerivedCharacter,
  DerivedProgressionFeature,
  DiceRequirement,
  EffectApplicability,
  EvaluationResult,
  ExcludedContribution,
  ManeuverId,
  NaturalFacePolicy,
  PrimaryCheckDie,
  ProgressionCatalog,
  ResourceCost,
  ResourceDefinition,
  ResourceMaximum,
  ResourceMaximumTerm,
  ResourceRefreshRule,
  ResourceState,
  DerivedResource,
  HpAcquisition,
  HpAcquisitionPolicy,
  HpAcquisitionRule,
  LifecycleOverride,
  LifecycleOverrideScope,
  RollContext,
  RollDefense,
  RollDefenseKind,
  RollKind,
  RollOutcome,
  RollOutcomeKind,
  RollOutcomePolicy,
  RollOutcomePolicySet,
  RollPlan,
  RollPlanProvenance,
  SkillAllocationPolicy,
  SkillRankAllocation,
  TargetContext,
  TargetId,
} from "@threepointpf/rules-schema";
