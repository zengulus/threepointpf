import type {
  AbilityId,
  AttackDefinition,
  AttackProfileCatalog,
  CharacterInput,
  ContextualModifiers,
  Contribution,
  DefenseContext,
  Effect,
  EquipmentInstance,
  EvaluationResult,
  ExcludedContribution,
  MovementMode,
  ProgressionCatalog,
  ProgressionDefinition,
  ProgressionSourceMetadata,
  RollContext,
  RollOutcomePolicySet,
  SizeCategory,
  SkillCatalog,
  TargetId,
} from "@threepointpf/rules-schema";
import type { ProgressionLevelResult } from "./advancement.js";

/** An equipment instance with its catalog definition already merged in. */
export interface EquipmentEntry extends EquipmentInstance {
  source?: ProgressionSourceMetadata;
  effects?: Effect[];
}

export interface DirectModifierOptions {
  /** Weapon identity for tag/mode matching. */
  attack?: AttackDefinition;
  /** Intrinsic baseline, required by `capToBase` movement increases. */
  baseline?: number;
  /** Situational identity of the roll being evaluated. */
  context?: RollContext;
  /** Report filtered-out effects as provenance (contextual evaluations only). */
  reportExclusions?: boolean;
}

export interface ResultOptions {
  /** AC defense context (normal / touch / flatFooted). */
  context?: DefenseContext;
  /** The situational roll context this result belongs to. */
  rollContext?: RollContext;
  /** Effects that were filtered out, with reasons. */
  excluded?: ExcludedContribution[];
  /** Set false for already-operated contribution lists. */
  applyOperations?: boolean;
}

/**
 * The internal surface the domain modules need. `RulesEngine` implements it;
 * splitting the engine into modules must not duplicate the numeric pipeline, so
 * the pipeline is exposed here rather than re-implemented per module.
 */
export interface RulesRuntime {
  readonly character: CharacterInput;
  readonly effects: Effect[];
  readonly equipment: EquipmentEntry[];
  readonly attackDefinitions: AttackDefinition[];
  readonly skillCatalog?: SkillCatalog;
  readonly attackProfileCatalog?: AttackProfileCatalog;
  /** Character-global progression levels from the advancement evaluation. */
  advancementProgressionLevels(): ProgressionLevelResult[];
  progressionDefinition(id: string): ProgressionDefinition | undefined;
  /** The injected progression catalog, when advancement content is present. */
  readonly progressionCatalog?: ProgressionCatalog;
  /** Situational flags contributed by enabled features. */
  enabledContextFlags(): string[];
  /** How raw faces are interpreted, per roll family. */
  readonly outcomePolicies: RollOutcomePolicySet;
  /** The first-class BAB fact, derived once and consumed everywhere. */
  bab(): EvaluationResult;
  /** Baseline for a target, honoring an authored `replaceBase`. */
  replacement(
    target: TargetId,
    fallback: number,
    source: string,
    label: string,
  ): Contribution;
  replacementEffect(
    target: TargetId,
  ): Extract<Effect, { kind: "replaceBase" }> | undefined;
  directModifiers(
    target: TargetId,
    options?: DirectModifierOptions,
  ): ContextualModifiers;
  result(
    target: TargetId,
    contributions: Contribution[],
    options?: ResultOptions,
  ): EvaluationResult;
  abilityScore(id: AbilityId): EvaluationResult;
  abilityModifierValue(id: AbilityId): number;
  abilityContribution(id: AbilityId, target: TargetId): Contribution;
  sizeResult(): EvaluationResult;
  sizeCategory(): SizeCategory;
  sizeAdjustment(
    target: TargetId,
    perCategoryStep: number,
    label: string,
  ): Contribution;
}
