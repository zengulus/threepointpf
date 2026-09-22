import {
  mergeProgressionCatalogs,
  parseCampaignCharacterProfile,
  resolveProgressionId,
  type AdvancementSlot,
  type CampaignCharacterProfile,
  type CharacterInput,
  type ChoiceOption,
  type ChoiceRequirement,
  type ChoiceRequirementReference,
  type ChoiceSelection,
  type HpAcquisition,
  type HpAcquisitionMethod,
  type HpAcquisitionRule,
  type LifecycleOverride,
  type LifecycleOverrideScope,
  type ProgressionCatalog,
  type ProgressionDefinition,
  type SkillAllocationMethod,
  type SkillRankAllocation,
} from "@threepointpf/rules-schema";
import {
  evaluateAdvancement,
  type AdvancementEvaluation,
  type AdvancementFeatureGrant,
  type SlotHitDie,
  type SlotSkillPointSource,
} from "./advancement.js";
import {
  RulesEngine,
  type RulesEngineOptions,
} from "./character.js";
import type { DerivedCharacter } from "@threepointpf/rules-schema";

/**
 * A progression choice is deliberately addressed by character level and the
 * profile's named track. It is materialized as an ordinary AdvancementSlot,
 * so callers never need to hand-edit `advancementSlots` to use the guided API.
 */
export interface AdvancementProgressionSelection {
  level: number;
  trackId: string;
  progressionId: string;
}

/** Transient HP input. A commit records the fully resolved HpAcquisition. */
export interface HpAcquisitionProposal {
  level: number;
  amount?: number;
  method?: HpAcquisitionMethod;
  policyId?: string;
  note?: string;
}

/** Transient skill input. A commit records the per-slot rank delta. */
export interface SkillRankAllocationProposal {
  level: number;
  ranks: Record<string, number>;
  method?: SkillAllocationMethod;
  note?: string;
}

/**
 * An incomplete creation proposal is intentionally a partial CharacterInput.
 * It retains the persisted field names and is never converted from a second
 * builder format; only a successful commit fills the required authored facts.
 */
export interface CharacterCreationProposal {
  kind: "character-creation";
  profile: CampaignCharacterProfile;
  rules: RulesEngineOptions;
  character: Partial<CharacterInput>;
  progressionSelections: AdvancementProgressionSelection[];
  hpAcquisitions: HpAcquisitionProposal[];
  skillAllocations: SkillRankAllocationProposal[];
  choiceSelections: ChoiceSelection[];
  overrides: LifecycleOverride[];
}

export interface CharacterCreationProposalChange {
  /** Ordinary authored fields such as identity, abilities, features, or custom content. */
  character?: Partial<CharacterInput>;
  progressionSelections?: AdvancementProgressionSelection[];
  hpAcquisitions?: HpAcquisitionProposal[];
  skillAllocations?: SkillRankAllocationProposal[];
  choiceSelections?: ChoiceSelection[];
  overrides?: LifecycleOverride[];
}

/** One proposed new global level on an already-authored character. */
export interface AdvancementProposal {
  kind: "advancement";
  profile: CampaignCharacterProfile;
  rules: RulesEngineOptions;
  /** The untouched persisted authored state. */
  character: CharacterInput;
  level: number;
  slotId: string;
  progressionChoices: Record<string, string>;
  hpAcquisition?: HpAcquisitionProposal;
  skillAllocation?: SkillRankAllocationProposal;
  choiceSelections: ChoiceSelection[];
  overrides: LifecycleOverride[];
}

export interface AdvancementProposalChange {
  /** Keyed by profile track id, e.g. `{ martial: "pf1e.paizo.fighter" }`. */
  progressionChoices?: Record<string, string>;
  hpAcquisition?: Omit<HpAcquisitionProposal, "level">;
  skillAllocation?: Omit<SkillRankAllocationProposal, "level">;
  choiceSelections?: ChoiceSelection[];
  overrides?: LifecycleOverride[];
}

export type LifecycleIssueSeverity = "error" | "warning";

/** A machine-readable structural error or policy warning suitable for a UI. */
export interface LifecycleIssue {
  code: string;
  severity: LifecycleIssueSeverity;
  message: string;
  path?: string[];
  scope?: LifecycleOverrideScope;
  /** A warning with this flag needs a scoped, authored override before commit. */
  requiresOverride?: boolean;
  overridden?: boolean;
}

export interface LifecycleValidationResult {
  errors: LifecycleIssue[];
  warnings: LifecycleIssue[];
  /** There are no structural errors. */
  valid: boolean;
  /** There are no errors or unaccepted override-required warnings. */
  canCommit: boolean;
}

export interface LifecycleProgressionOption {
  id: string;
  name: string;
  description?: string;
  hitDieSides: number;
  skillPointsPerLevel: number;
  sourceId?: string;
}

export interface ProgressionChoiceRequirement {
  kind: "progression";
  id: string;
  level: number;
  slotId: string;
  trackId: string;
  trackName: string;
  prompt: string;
  options: LifecycleProgressionOption[];
  allowCustom: boolean;
  selectedProgressionId?: string;
}

export interface FeatureChoiceRequirement {
  kind: "feature";
  requirement: ChoiceRequirement;
  reference: ChoiceRequirementReference;
  progressionName: string;
  featureName: string;
  level: number;
  selection?: ChoiceSelection;
}

export type LifecycleChoiceRequirement =
  | ProgressionChoiceRequirement
  | FeatureChoiceRequirement;

export interface HpAcquisitionPreview {
  level: number;
  slotId: string;
  winningHitDie?: SlotHitDie;
  acquisition?: HpAcquisition;
  /** The raw amount chosen before Constitution is applied. */
  amount?: number;
  /** Derived max-HP change compared with the previous authored character. */
  maxHpDelta?: number;
}

export interface SkillAllocationPreview {
  level: number;
  slotId: string;
  winningChassis?: SlotSkillPointSource;
  available?: number;
  allocated: number;
  remaining?: number;
  ranks: Record<string, number>;
}

/** A compact semantic diff; consumers do not need to diff whole derived sheets. */
export interface LifecycleChange {
  kind:
    | "level"
    | "progression"
    | "bab"
    | "save"
    | "hitDie"
    | "feature"
    | "hp"
    | "skillBudget";
  label: string;
  before?: number;
  after?: number;
  slotId?: string;
  trackId?: string;
  progressionId?: string;
  saveId?: "fortitude" | "reflex" | "will";
}

export interface CharacterCreationPreview {
  kind: "character-creation";
  after?: DerivedCharacter;
  changes: LifecycleChange[];
  requirements: LifecycleChoiceRequirement[];
  hp: HpAcquisitionPreview[];
  skills: SkillAllocationPreview[];
  validation: LifecycleValidationResult;
}

export interface AdvancementPreview {
  kind: "advancement";
  level: number;
  slotId: string;
  before?: DerivedCharacter;
  after?: DerivedCharacter;
  changes: LifecycleChange[];
  requirements: LifecycleChoiceRequirement[];
  hp?: HpAcquisitionPreview;
  skills?: SkillAllocationPreview;
  validation: LifecycleValidationResult;
}

export interface LifecycleCommitSuccess {
  committed: true;
  character: CharacterInput;
}

export interface LifecycleCommitFailure {
  committed: false;
  validation: LifecycleValidationResult;
}

export type LifecycleCommitResult =
  | LifecycleCommitSuccess
  | LifecycleCommitFailure;

/** A throwing convenience API still carries the structured validation result. */
export class LifecycleCommitError extends Error {
  constructor(
    readonly validation: LifecycleValidationResult,
    operation: "creation" | "advancement",
  ) {
    super(
      `Cannot commit character ${operation}: ${[
        ...validation.errors,
        ...validation.warnings.filter(
          (warning) => warning.requiresOverride && !warning.overridden,
        ),
      ]
        .map((issue) => issue.message)
        .join("; ")}`,
    );
    this.name = "LifecycleCommitError";
  }
}

interface ExpectedSlot {
  level: number;
  slotId: string;
}

interface Inspection {
  character: CharacterInput;
  derived: DerivedCharacter;
  advancement: AdvancementEvaluation;
  catalog: ProgressionCatalog;
}

interface Assessment {
  candidate?: CharacterInput;
  inspection?: Inspection;
  issues: LifecycleIssue[];
  requirements: LifecycleChoiceRequirement[];
  hp: HpAcquisitionPreview[];
  skills: SkillAllocationPreview[];
}

const defaultAbilities: CharacterInput["baseAbilities"] = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
};

function cloneRules(rules: RulesEngineOptions): RulesEngineOptions {
  // Catalog values are immutable caller-owned content. The outer clone prevents
  // proposal helpers from exposing a mutable options object of their own.
  return { ...rules };
}

function upsertBy<T>(
  existing: readonly T[],
  incoming: readonly T[],
  key: (value: T) => string,
): T[] {
  const result = [...existing];
  const indexes = new Map(result.map((value, index) => [key(value), index]));
  for (const value of incoming) {
    const index = indexes.get(key(value));
    if (index === undefined) {
      indexes.set(key(value), result.length);
      result.push(value);
    } else result[index] = value;
  }
  return result;
}

function levelSlotId(level: number): string {
  return `level-${level}`;
}

function expectedCreationSlots(profile: CampaignCharacterProfile): ExpectedSlot[] {
  return Array.from({ length: profile.startingLevel }, (_, index) => ({
    level: index + 1,
    slotId: levelSlotId(index + 1),
  }));
}

function nextSlotId(character: CharacterInput, level: number): string {
  const existing = new Set(
    (character.advancementSlots ?? []).map((slot) => slot.id),
  );
  const base = levelSlotId(level);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function progressionSelectionKey(level: number, trackId: string): string {
  return `${level}\u0000${trackId}`;
}

function choiceReferenceKey(reference: ChoiceRequirementReference): string {
  return [
    reference.progressionId,
    reference.featureId,
    reference.slotId,
    reference.trackId,
    reference.requirementId,
  ].join("\u0000");
}

function sourceIds(definition: ProgressionDefinition): string[] {
  const source = definition.source;
  return source
    ? [source.document, source.sheet, source.category, source.publisher].filter(
        (value): value is string => Boolean(value),
      )
    : [];
}

function catalogFor(
  custom: ProgressionCatalog | undefined,
  rules: RulesEngineOptions,
): ProgressionCatalog {
  return mergeProgressionCatalogs(rules.progressionCatalog ?? {}, custom ?? {});
}

function tryCatalog(
  custom: ProgressionCatalog | undefined,
  rules: RulesEngineOptions,
): { catalog?: ProgressionCatalog; issue?: LifecycleIssue } {
  try {
    return { catalog: catalogFor(custom, rules) };
  } catch (error) {
    return {
      issue: structuralIssue(
        "invalid-progression-catalog",
        errorMessage(error),
        ["customProgressions"],
      ),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown lifecycle error";
}

function structuralIssue(
  code: string,
  message: string,
  path?: string[],
  scope?: LifecycleOverrideScope,
): LifecycleIssue {
  return { code, severity: "error", message, ...(path ? { path } : {}), ...(scope ? { scope } : {}) };
}

function policyIssue(
  code: string,
  message: string,
  scope?: LifecycleOverrideScope,
): LifecycleIssue {
  return {
    code,
    severity: "warning",
    message,
    requiresOverride: true,
    ...(scope ? { scope } : {}),
  };
}

function advisoryIssue(
  code: string,
  message: string,
  scope?: LifecycleOverrideScope,
): LifecycleIssue {
  return {
    code,
    severity: "warning",
    message,
    ...(scope ? { scope } : {}),
  };
}

function methodForRule(rule: HpAcquisitionRule): HpAcquisitionMethod {
  return rule.kind;
}

function hpRuleFor(
  profile: CampaignCharacterProfile,
  level: number,
): HpAcquisitionRule {
  return level === 1 ? profile.hpPolicy.firstLevel : profile.hpPolicy.laterLevels;
}

function automaticHpAmount(
  rule: HpAcquisitionRule,
  sides: number,
): number | undefined {
  if (rule.kind === "maximum") return sides;
  if (rule.kind === "fixed") return rule.amount;
  return undefined;
}

function hpAcquisitionFor(
  selection: HpAcquisitionProposal | undefined,
  expected: ExpectedSlot,
  source: SlotHitDie | undefined,
  profile: CampaignCharacterProfile,
): HpAcquisition | undefined {
  const rule = hpRuleFor(profile, expected.level);
  const automatic = source
    ? automaticHpAmount(rule, source.sides)
    : undefined;
  const amount = selection?.amount ?? automatic;
  if (amount === undefined) return undefined;
  return {
    slotId: expected.slotId,
    method: selection?.method ?? methodForRule(rule),
    amount,
    ...(selection?.policyId || rule.kind !== "custom"
      ? { policyId: selection?.policyId }
      : { policyId: rule.id }),
    ...(selection?.note ? { note: selection.note } : {}),
    ...(source
      ? {
          source: {
            trackId: source.trackId,
            progressionId: source.progressionId,
            sides: source.sides,
          },
        }
      : {}),
  };
}

function skillMethodFor(
  profile: CampaignCharacterProfile,
): SkillAllocationMethod {
  if (profile.skillAllocationPolicy.kind === "calculated") return "policy";
  if (profile.skillAllocationPolicy.kind === "manual") return "manual";
  return "custom";
}

function skillAllocationFor(
  selection: SkillRankAllocationProposal | undefined,
  expected: ExpectedSlot,
  profile: CampaignCharacterProfile,
  source?: SlotSkillPointSource,
): SkillRankAllocation {
  return {
    slotId: expected.slotId,
    ranks: selection?.ranks ?? {},
    method: selection?.method ?? skillMethodFor(profile),
    ...(selection?.note ? { note: selection.note } : {}),
    ...(source
      ? {
          source: {
            trackId: source.trackId,
            progressionId: source.progressionId,
            skillPoints: source.skillPoints,
          },
        }
      : {}),
  };
}

function addRanks(
  initial: Record<string, number>,
  allocations: readonly SkillRankAllocation[],
): Record<string, number> {
  const result = { ...initial };
  for (const allocation of allocations)
    for (const [skillId, ranks] of Object.entries(allocation.ranks))
      result[skillId] = (result[skillId] ?? 0) + ranks;
  return result;
}

function createSlots(
  profile: CampaignCharacterProfile,
  expected: readonly ExpectedSlot[],
  selections: readonly AdvancementProgressionSelection[],
  issues: LifecycleIssue[],
): AdvancementSlot[] | undefined {
  const allowedLevels = new Set(expected.map((item) => item.level));
  const allowedTracks = new Set(profile.tracks.map((track) => track.id));
  const seen = new Set<string>();
  for (const selection of selections) {
    const key = progressionSelectionKey(selection.level, selection.trackId);
    if (seen.has(key))
      issues.push(
        structuralIssue(
          "duplicate-progression-choice",
          `Level ${selection.level}, track ${selection.trackId} has more than one progression choice`,
          ["progressionSelections"],
          { trackId: selection.trackId },
        ),
      );
    seen.add(key);
    if (!allowedLevels.has(selection.level))
      issues.push(
        structuralIssue(
          "progression-choice-outside-proposal-levels",
          `Level ${selection.level} is outside this character lifecycle proposal`,
          ["progressionSelections"],
          { trackId: selection.trackId },
        ),
      );
    if (!allowedTracks.has(selection.trackId))
      issues.push(
        structuralIssue(
          "progression-choice-uses-unknown-track",
          `Track ${selection.trackId} is not part of the campaign profile`,
          ["progressionSelections"],
          { trackId: selection.trackId },
        ),
      );
  }
  const bySelection = new Map(
    selections.map((selection) => [
      progressionSelectionKey(selection.level, selection.trackId),
      selection,
    ]),
  );
  const slots: AdvancementSlot[] = [];
  for (const item of expected) {
    const tracks: AdvancementSlot["tracks"] = [];
    for (const track of profile.tracks) {
      const selection = bySelection.get(
        progressionSelectionKey(item.level, track.id),
      );
      if (!selection) {
        issues.push(
          structuralIssue(
            "progression-choice-required",
            `Level ${item.level}, track ${track.name} needs a progression choice`,
            ["progressionSelections"],
            { slotId: item.slotId, trackId: track.id },
          ),
        );
        continue;
      }
      tracks.push({
        id: track.id,
        entry: { progressionId: selection.progressionId },
      });
    }
    if (tracks.length !== profile.tracks.length) return undefined;
    slots.push({ id: item.slotId, tracks });
  }
  return slots;
}

function allocationLevelIssues(
  expected: readonly ExpectedSlot[],
  hp: readonly HpAcquisitionProposal[],
  skills: readonly SkillRankAllocationProposal[],
): LifecycleIssue[] {
  const levels = new Set(expected.map((item) => item.level));
  const issues: LifecycleIssue[] = [];
  for (const allocation of hp)
    if (!levels.has(allocation.level))
      issues.push(
        structuralIssue(
          "hp-acquisition-outside-proposal-levels",
          `HP acquisition for level ${allocation.level} is outside this proposal`,
          ["hpAcquisitions"],
        ),
      );
  for (const allocation of skills)
    if (!levels.has(allocation.level))
      issues.push(
        structuralIssue(
          "skill-allocation-outside-proposal-levels",
          `Skill allocation for level ${allocation.level} is outside this proposal`,
          ["skillAllocations"],
        ),
      );
  return issues;
}

function progressionOptions(
  profile: CampaignCharacterProfile,
  catalog: ProgressionCatalog,
  custom?: ProgressionCatalog,
  aliases: RulesEngineOptions["progressionAliases"] = {},
): LifecycleProgressionOption[] {
  const hasProgressionAllowList = profile.availableProgressionIds !== undefined;
  const allowedIds = new Set(
    (profile.availableProgressionIds ?? []).flatMap((id) => {
      const resolved = resolveProgressionId(id, catalog, aliases);
      return resolved ? [resolved] : [];
    }),
  );
  const allowedSources = new Set(profile.catalogSourceIds ?? []);
  return Object.values(catalog)
    .filter((definition) => {
      if (hasProgressionAllowList && !allowedIds.has(definition.id)) return false;
      if (
        allowedSources.size &&
        !sourceIds(definition).some((id) => allowedSources.has(id))
      )
        return false;
      if (
        profile.allowCustomProgressions === false &&
        custom &&
        Object.hasOwn(custom, definition.id)
      )
        return false;
      return true;
    })
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.source
        ? `${definition.source.document} — ${definition.source.sheet}`
        : undefined,
      hitDieSides: definition.hitDieSides,
      skillPointsPerLevel: definition.skillPointsPerLevel ?? 0,
      sourceId: definition.source?.document,
    }));
}

function progressionRequirements(
  profile: CampaignCharacterProfile,
  expected: readonly ExpectedSlot[],
  choices: readonly AdvancementProgressionSelection[],
  catalog: ProgressionCatalog | undefined,
  custom?: ProgressionCatalog,
  aliases: RulesEngineOptions["progressionAliases"] = {},
): ProgressionChoiceRequirement[] {
  const bySelection = new Map(
    choices.map((choice) => [
      progressionSelectionKey(choice.level, choice.trackId),
      choice.progressionId,
    ]),
  );
  return expected.flatMap((item) =>
    profile.tracks.map((track) => ({
      kind: "progression" as const,
      id: `advancement.slot.${item.slotId}.track.${track.id}.progression`,
      level: item.level,
      slotId: item.slotId,
      trackId: track.id,
      trackName: track.name,
      prompt: `Level ${item.level} — ${track.name}: choose a progression`,
      options: catalog
        ? progressionOptions(profile, catalog, custom, aliases)
        : [],
      allowCustom: profile.allowCustomProgressions !== false,
      ...(bySelection.get(progressionSelectionKey(item.level, track.id))
        ? {
            selectedProgressionId: bySelection.get(
              progressionSelectionKey(item.level, track.id),
            ),
          }
        : {}),
    })),
  );
}

function featureRequirements(
  evaluation: AdvancementEvaluation,
  catalog: ProgressionCatalog,
  selections: readonly ChoiceSelection[],
  slotIds?: ReadonlySet<string>,
): FeatureChoiceRequirement[] {
  const byReference = new Map(
    selections.map((selection) => [
      choiceReferenceKey(selection.requirement),
      selection,
    ]),
  );
  const requirements: FeatureChoiceRequirement[] = [];
  for (const grant of evaluation.features) {
    if (slotIds && !slotIds.has(grant.slotId)) continue;
    const definition = catalog[grant.progressionId];
    for (const requirement of grant.choices ?? []) {
      const reference: ChoiceRequirementReference = {
        progressionId: grant.progressionId,
        featureId: grant.id,
        slotId: grant.slotId,
        trackId: grant.trackId,
        requirementId: requirement.id,
      };
      requirements.push({
        kind: "feature",
        requirement,
        reference,
        progressionName: definition?.name ?? grant.progressionId,
        featureName: grant.name,
        level: grant.level,
        ...(byReference.get(choiceReferenceKey(reference))
          ? { selection: byReference.get(choiceReferenceKey(reference)) }
          : {}),
      });
    }
  }
  return requirements;
}

function generatedChoiceFeatureId(selectionId: string, optionId: string): string {
  return `lifecycle.choice.${selectionId}.${optionId}`;
}

function featureInstancesForChoices(
  character: CharacterInput,
  evaluation: AdvancementEvaluation | undefined,
  catalog: ProgressionCatalog | undefined,
): CharacterInput["features"] {
  if (!evaluation || !catalog) return character.features;
  const requirements = featureRequirements(
    evaluation,
    catalog,
    character.lifecycle?.choiceSelections ?? [],
  );
  // Choice effects are a materialized view of durable ChoiceSelection facts.
  // Rebuild that view every time so revising a prior selection cannot leave a
  // stale option's effects active beside the replacement.
  const authoredFeatures = character.features.filter(
    (feature) => feature.definitionId !== "lifecycle.choice",
  );
  const existing = new Set(authoredFeatures.map((feature) => feature.id));
  const generated: CharacterInput["features"] = [];
  for (const requirement of requirements) {
    const selection = requirement.selection;
    if (!selection) continue;
    const options = new Map<string, ChoiceOption>([
      ...requirement.requirement.options.map((option) => [option.id, option] as const),
      ...(selection.customOptions ?? []).map((option) => [option.id, option] as const),
    ]);
    for (const optionId of [
      ...selection.optionIds,
      ...(selection.customOptions ?? []).map((option) => option.id),
    ]) {
      const option = options.get(optionId);
      if (!option) continue;
      const id = generatedChoiceFeatureId(selection.id, option.id);
      if (existing.has(id)) continue;
      existing.add(id);
      generated.push({
        id,
        definitionId: "lifecycle.choice",
        name: option.name,
        ...(option.description ? { description: option.description } : {}),
        enabled: true,
        effects: option.effects ?? [],
      });
    }
  }
  return [...authoredFeatures, ...generated];
}

function evaluateSlots(
  slots: AdvancementSlot[] | undefined,
  custom: ProgressionCatalog | undefined,
  rules: RulesEngineOptions,
): { evaluation?: AdvancementEvaluation; catalog?: ProgressionCatalog } {
  if (!slots?.length) return {};
  const catalog = catalogFor(custom, rules);
  return {
    catalog,
    evaluation: evaluateAdvancement(slots, catalog, rules.progressionAliases),
  };
}

function acquisitionRecordsFor(
  expected: readonly ExpectedSlot[],
  selections: readonly HpAcquisitionProposal[],
  evaluation: AdvancementEvaluation | undefined,
  profile: CampaignCharacterProfile,
): HpAcquisition[] {
  const byLevel = new Map(selections.map((selection) => [selection.level, selection]));
  return expected.flatMap((item) => {
    const source = evaluation?.hitDieSources.find(
      (candidate) => candidate.slotId === item.slotId,
    );
    const acquisition = hpAcquisitionFor(
      byLevel.get(item.level),
      item,
      source,
      profile,
    );
    return acquisition ? [acquisition] : [];
  });
}

function skillRecordsFor(
  expected: readonly ExpectedSlot[],
  selections: readonly SkillRankAllocationProposal[],
  profile: CampaignCharacterProfile,
  evaluation?: AdvancementEvaluation,
): SkillRankAllocation[] {
  const byLevel = new Map(selections.map((selection) => [selection.level, selection]));
  return expected.map((item) =>
    skillAllocationFor(
      byLevel.get(item.level),
      item,
      profile,
      evaluation?.skillPointSources.find(
        (candidate) => candidate.slotId === item.slotId,
      ),
    ),
  );
}

function withSkillBudgets(
  allocations: readonly SkillRankAllocation[],
  expected: readonly ExpectedSlot[],
  evaluation: AdvancementEvaluation | undefined,
  profile: CampaignCharacterProfile,
  baseAbilities: CharacterInput["baseAbilities"],
): SkillRankAllocation[] {
  return allocations.map((allocation) => {
    const level = expected.find((item) => item.slotId === allocation.slotId)?.level;
    const source = evaluation?.skillPointSources.find(
      (item) => item.slotId === allocation.slotId,
    );
    const budget = level === undefined
      ? undefined
      : skillBudget(profile, baseAbilities, source, level);
    return budget === undefined ? allocation : { ...allocation, budget };
  });
}

function withoutLifecycleManagedFields(
  character: Partial<CharacterInput>,
): Partial<CharacterInput> {
  const {
    advancementSlots: _advancementSlots,
    baseBab: _baseBab,
    baseSaves: _baseSaves,
    hitDiceCount: _hitDiceCount,
    baseHpBeforeConstitution: _baseHpBeforeConstitution,
    skillRanks: _skillRanks,
    lifecycle: _lifecycle,
    ...rest
  } = character;
  return rest;
}

function creationManagedFieldIssues(
  character: Partial<CharacterInput>,
): LifecycleIssue[] {
  const issues: LifecycleIssue[] = [];
  const rejected: Array<[keyof CharacterInput, string]> = [
    [
      "advancementSlots",
      "Use progressionSelections; the lifecycle materializes ordered slots.",
    ],
    [
      "baseBab",
      "Advancement characters derive BAB from progression selections.",
    ],
    [
      "baseSaves",
      "Advancement characters derive saves from progression selections.",
    ],
    [
      "hitDiceCount",
      "Advancement characters derive hit-die count from progression selections.",
    ],
    [
      "baseHpBeforeConstitution",
      "Use hpAcquisitions so committed HP retains per-slot provenance.",
    ],
    [
      "lifecycle",
      "Use the proposal's HP, skill, choice, and override fields instead of prebuilt lifecycle state.",
    ],
  ];
  for (const [field, message] of rejected)
    if (character[field] !== undefined)
      issues.push(
        structuralIssue(
          "creation-field-is-managed-by-lifecycle",
          `${String(field)} cannot be supplied directly during lifecycle creation. ${message}`,
          [String(field)],
        ),
      );
  if (Object.keys(character.skillRanks ?? {}).length)
    issues.push(
      structuralIssue(
        "creation-field-is-managed-by-lifecycle",
        "skillRanks cannot be supplied directly during lifecycle creation. Use skillAllocations so policy validation can inspect them.",
        ["skillRanks"],
      ),
    );
  return issues;
}

/**
 * Begins from no persisted character at all. The proposal is intentionally
 * incomplete until it has identity, abilities, all required track choices and
 * policy-required allocations.
 */
export function beginCharacterCreation(
  profile: CampaignCharacterProfile,
  rules: RulesEngineOptions = {},
): CharacterCreationProposal {
  return {
    kind: "character-creation",
    profile: parseCampaignCharacterProfile(profile),
    rules: cloneRules(rules),
    character: {},
    progressionSelections: [],
    hpAcquisitions: [],
    skillAllocations: [],
    choiceSelections: [],
    overrides: [],
  };
}

/** Returns a new proposal; neither the input proposal nor any character is mutated. */
export function proposeCharacterCreation(
  proposal: CharacterCreationProposal,
  change: CharacterCreationProposalChange,
): CharacterCreationProposal {
  return {
    ...proposal,
    character: { ...proposal.character, ...(change.character ?? {}) },
    progressionSelections: upsertBy(
      proposal.progressionSelections,
      change.progressionSelections ?? [],
      (selection) => progressionSelectionKey(selection.level, selection.trackId),
    ),
    hpAcquisitions: upsertBy(
      proposal.hpAcquisitions,
      change.hpAcquisitions ?? [],
      (selection) => String(selection.level),
    ),
    skillAllocations: upsertBy(
      proposal.skillAllocations,
      change.skillAllocations ?? [],
      (selection) => String(selection.level),
    ),
    choiceSelections: upsertBy(
      proposal.choiceSelections,
      change.choiceSelections ?? [],
      (selection) => selection.id,
    ),
    overrides: upsertBy(
      proposal.overrides,
      change.overrides ?? [],
      (override) => override.id,
    ),
  };
}

/** Begins a level-up without touching the existing authored character. */
export function beginAdvancement(
  character: CharacterInput,
  profile: CampaignCharacterProfile,
  rules: RulesEngineOptions = {},
): AdvancementProposal {
  const parsedProfile = parseCampaignCharacterProfile(profile);
  const level = (character.advancementSlots?.length ?? 0) + 1;
  return {
    kind: "advancement",
    profile: parsedProfile,
    rules: cloneRules(rules),
    character,
    level,
    slotId: nextSlotId(character, level),
    progressionChoices: {},
    choiceSelections: [],
    overrides: [],
  };
}

/** Returns a new level-up proposal; the base CharacterInput remains untouched. */
export function proposeAdvancement(
  proposal: AdvancementProposal,
  change: AdvancementProposalChange,
): AdvancementProposal {
  return {
    ...proposal,
    progressionChoices: {
      ...proposal.progressionChoices,
      ...(change.progressionChoices ?? {}),
    },
    ...(change.hpAcquisition
      ? {
          hpAcquisition: {
            ...change.hpAcquisition,
            level: proposal.level,
          },
        }
      : {}),
    ...(change.skillAllocation
      ? {
          skillAllocation: {
            ...change.skillAllocation,
            level: proposal.level,
          },
        }
      : {}),
    choiceSelections: upsertBy(
      proposal.choiceSelections,
      change.choiceSelections ?? [],
      (selection) => selection.id,
    ),
    overrides: upsertBy(
      proposal.overrides,
      change.overrides ?? [],
      (override) => override.id,
    ),
  };
}

function creationCandidate(
  proposal: CharacterCreationProposal,
  issues: LifecycleIssue[],
): { candidate?: CharacterInput; expected: ExpectedSlot[] } {
  const expected = expectedCreationSlots(proposal.profile);
  issues.push(...creationManagedFieldIssues(proposal.character));
  issues.push(
    ...allocationLevelIssues(
      expected,
      proposal.hpAcquisitions,
      proposal.skillAllocations,
    ),
  );
  const slots = createSlots(
    proposal.profile,
    expected,
    proposal.progressionSelections,
    issues,
  );
  if (!slots) return { expected };

  const catalogResult = tryCatalog(
    proposal.character.customProgressions,
    proposal.rules,
  );
  if (catalogResult.issue) issues.push(catalogResult.issue);
  let evaluated: { evaluation?: AdvancementEvaluation; catalog?: ProgressionCatalog };
  try {
    evaluated = evaluateSlots(
      slots,
      proposal.character.customProgressions,
      proposal.rules,
    );
  } catch {
    // The engine assessment below reports the authoritative structural failure.
    evaluated = { catalog: catalogResult.catalog };
  }
  const acquisitions = acquisitionRecordsFor(
    expected,
    proposal.hpAcquisitions,
    evaluated.evaluation,
    proposal.profile,
  );
  const baseAbilities = proposal.character.baseAbilities ?? defaultAbilities;
  const allocations = withSkillBudgets(
    skillRecordsFor(
      expected,
      proposal.skillAllocations,
      proposal.profile,
      evaluated.evaluation,
    ),
    expected,
    evaluated.evaluation,
    proposal.profile,
    baseAbilities,
  );
  const provisional: CharacterInput = {
    ...withoutLifecycleManagedFields(proposal.character),
    id: proposal.character.id ?? "",
    name: proposal.character.name ?? "",
    baseAbilities,
    baseHpBeforeConstitution: acquisitions.reduce(
      (total, acquisition) => total + acquisition.amount,
      0,
    ),
    advancementSlots: slots,
    skillRanks: addRanks({}, allocations),
    attacks: proposal.character.attacks ?? [],
    features: proposal.character.features ?? [],
    damageTaken: proposal.character.damageTaken ?? 0,
    temporaryHp: proposal.character.temporaryHp ?? 0,
    lifecycle: {
      ...(acquisitions.length ? { hpAcquisitions: acquisitions } : {}),
      skillAllocations: allocations,
      ...(proposal.choiceSelections.length
        ? { choiceSelections: proposal.choiceSelections }
        : {}),
      ...(proposal.overrides.length ? { overrides: proposal.overrides } : {}),
    },
  };
  const features = featureInstancesForChoices(
    provisional,
    evaluated.evaluation,
    evaluated.catalog,
  );
  return {
    expected,
    candidate: features === provisional.features
      ? provisional
      : { ...provisional, features },
  };
}

function advancementCandidate(
  proposal: AdvancementProposal,
  issues: LifecycleIssue[],
): { candidate?: CharacterInput; expected: ExpectedSlot[] } {
  const expected: ExpectedSlot[] = [{
    level: proposal.level,
    slotId: proposal.slotId,
  }];
  for (const trackId of Object.keys(proposal.progressionChoices))
    if (!proposal.profile.tracks.some((track) => track.id === trackId))
      issues.push(
        structuralIssue(
          "progression-choice-uses-unknown-track",
          `Track ${trackId} is not part of the campaign profile`,
          ["progressionChoices", trackId],
          { trackId },
        ),
      );
  if (proposal.hpAcquisition && proposal.hpAcquisition.level !== proposal.level)
    issues.push(
      structuralIssue(
        "hp-acquisition-outside-proposal-levels",
        `HP acquisition for level ${proposal.hpAcquisition.level} is outside this proposal`,
        ["hpAcquisition"],
      ),
    );
  if (proposal.skillAllocation && proposal.skillAllocation.level !== proposal.level)
    issues.push(
      structuralIssue(
        "skill-allocation-outside-proposal-levels",
        `Skill allocation for level ${proposal.skillAllocation.level} is outside this proposal`,
        ["skillAllocation"],
      ),
    );
  const selections = proposal.profile.tracks.flatMap((track) => {
    const progressionId = proposal.progressionChoices[track.id];
    return progressionId
      ? [{ level: proposal.level, trackId: track.id, progressionId }]
      : [];
  });
  const next = createSlots(proposal.profile, expected, selections, issues)?.[0];
  if (!next) return { expected };

  const slots = [...(proposal.character.advancementSlots ?? []), next];
  let evaluated: { evaluation?: AdvancementEvaluation; catalog?: ProgressionCatalog };
  try {
    evaluated = evaluateSlots(
      slots,
      proposal.character.customProgressions,
      proposal.rules,
    );
  } catch {
    evaluated = tryCatalog(proposal.character.customProgressions, proposal.rules);
  }
  const hpSelection = proposal.hpAcquisition
    ? [proposal.hpAcquisition]
    : [];
  const skillSelection = proposal.skillAllocation
    ? [proposal.skillAllocation]
    : [];
  const newAcquisitions = acquisitionRecordsFor(
    expected,
    hpSelection,
    evaluated.evaluation,
    proposal.profile,
  );
  const newAllocations = withSkillBudgets(
    skillRecordsFor(
      expected,
      skillSelection,
      proposal.profile,
      evaluated.evaluation,
    ),
    expected,
    evaluated.evaluation,
    proposal.profile,
    proposal.character.baseAbilities,
  );
  const baseLifecycle = proposal.character.lifecycle ?? {};
  const acquisitions = upsertBy(
    baseLifecycle.hpAcquisitions ?? [],
    newAcquisitions,
    (item) => item.slotId,
  );
  const allocations = upsertBy(
    baseLifecycle.skillAllocations ?? [],
    newAllocations,
    (item) => item.slotId,
  );
  const choices = upsertBy(
    baseLifecycle.choiceSelections ?? [],
    proposal.choiceSelections,
    (item) => item.id,
  );
  const overrides = upsertBy(
    baseLifecycle.overrides ?? [],
    proposal.overrides,
    (item) => item.id,
  );
  const provisional: CharacterInput = {
    ...proposal.character,
    advancementSlots: slots,
    baseHpBeforeConstitution:
      proposal.character.baseHpBeforeConstitution +
      newAcquisitions.reduce((total, acquisition) => total + acquisition.amount, 0),
    skillRanks: addRanks(proposal.character.skillRanks, newAllocations),
    lifecycle: {
      ...(acquisitions.length ? { hpAcquisitions: acquisitions } : {}),
      ...(allocations.length ? { skillAllocations: allocations } : {}),
      ...(choices.length ? { choiceSelections: choices } : {}),
      ...(overrides.length ? { overrides } : {}),
    },
  };
  const features = featureInstancesForChoices(
    provisional,
    evaluated.evaluation,
    evaluated.catalog,
  );
  return {
    expected,
    candidate: features === provisional.features
      ? provisional
      : { ...provisional, features },
  };
}

function inspectCandidate(
  candidate: CharacterInput,
  rules: RulesEngineOptions,
  issues: LifecycleIssue[],
): Inspection | undefined {
  try {
    const engine = new RulesEngine(candidate, rules);
    const character = engine.character;
    const slots = character.advancementSlots;
    if (!slots?.length)
      throw new Error("Lifecycle candidates require ordered advancement slots");
    const catalog = catalogFor(character.customProgressions, rules);
    return {
      character,
      derived: engine.derive(),
      advancement: evaluateAdvancement(slots, catalog, rules.progressionAliases),
      catalog,
    };
  } catch (error) {
    issues.push(
      structuralIssue("invalid-character", errorMessage(error), ["character"]),
    );
    return undefined;
  }
}

function profileProgressionIssues(
  profile: CampaignCharacterProfile,
  slots: readonly AdvancementSlot[],
  catalog: ProgressionCatalog,
  rules: RulesEngineOptions,
  custom: ProgressionCatalog | undefined,
): LifecycleIssue[] {
  const issues: LifecycleIssue[] = [];
  const hasProgressionAllowList = profile.availableProgressionIds !== undefined;
  const allowedIds = new Set(
    (profile.availableProgressionIds ?? []).flatMap((id) => {
      const resolved = resolveProgressionId(id, catalog, rules.progressionAliases);
      return resolved ? [resolved] : [];
    }),
  );
  const allowedSources = new Set(profile.catalogSourceIds ?? []);
  for (const id of profile.availableProgressionIds ?? [])
    if (!resolveProgressionId(id, catalog, rules.progressionAliases))
      issues.push(
        structuralIssue(
          "campaign-profile-references-unknown-progression",
          `Campaign profile ${profile.id} references unknown progression ${id}`,
          ["availableProgressionIds"],
          { progressionId: id },
        ),
      );
  const knownSourceIds = new Set(
    Object.values(catalog).flatMap((definition) => sourceIds(definition)),
  );
  for (const id of profile.catalogSourceIds ?? [])
    if (!knownSourceIds.has(id))
      issues.push(
        structuralIssue(
          "campaign-profile-references-unknown-catalog-source",
          `Campaign profile ${profile.id} references unknown catalog source ${id}`,
          ["catalogSourceIds"],
        ),
      );
  for (const slot of slots) {
    for (const track of slot.tracks) {
      const resolved = resolveProgressionId(
        track.entry.progressionId,
        catalog,
        rules.progressionAliases,
      );
      if (!resolved) {
        issues.push(
          structuralIssue(
            "unknown-progression",
            `Unknown progression ${track.entry.progressionId}`,
            ["advancementSlots"],
            { slotId: slot.id, trackId: track.id },
          ),
        );
        continue;
      }
      const definition = catalog[resolved]!;
      const scope = { slotId: slot.id, trackId: track.id, progressionId: resolved };
      if (hasProgressionAllowList && !allowedIds.has(resolved))
        issues.push(
          policyIssue(
            "progression-not-listed-in-profile",
            `${definition.name} is not in this campaign profile's ordinary progression list`,
            scope,
          ),
        );
      if (
        allowedSources.size &&
        !sourceIds(definition).some((id) => allowedSources.has(id))
      )
        issues.push(
          policyIssue(
            "progression-source-not-listed-in-profile",
            `${definition.name} is not from an enabled campaign catalog source`,
            scope,
          ),
        );
      if (
        profile.allowCustomProgressions === false &&
        Boolean(custom && Object.hasOwn(custom, resolved))
      )
        issues.push(
          policyIssue(
            "custom-progression-not-ordinarily-allowed",
            `${definition.name} is character-owned custom content and needs an explicit campaign override`,
            scope,
          ),
        );
    }
  }
  return issues;
}

function hpPolicyIssues(
  profile: CampaignCharacterProfile,
  expected: readonly ExpectedSlot[],
  inspection: Inspection,
): { issues: LifecycleIssue[]; previews: HpAcquisitionPreview[] } {
  const issues: LifecycleIssue[] = [];
  const previews: HpAcquisitionPreview[] = [];
  const records = inspection.character.lifecycle?.hpAcquisitions ?? [];
  for (const item of expected) {
    const source = inspection.advancement.hitDieSources.find(
      (candidate) => candidate.slotId === item.slotId,
    );
    const record = records.find((candidate) => candidate.slotId === item.slotId);
    const preview: HpAcquisitionPreview = {
      level: item.level,
      slotId: item.slotId,
      ...(source ? { winningHitDie: source } : {}),
      ...(record ? { acquisition: record, amount: record.amount } : {}),
    };
    previews.push(preview);
    if (!record) {
      issues.push(
        structuralIssue(
          "hp-acquisition-required",
          `Level ${item.level} needs an authored HP acquisition before Constitution`,
          ["lifecycle", "hpAcquisitions"],
          { slotId: item.slotId },
        ),
      );
      continue;
    }
    const rule = hpRuleFor(profile, item.level);
    const scope = { slotId: item.slotId };
    if (record.method !== methodForRule(rule))
      issues.push(
        policyIssue(
          "hp-acquisition-method-differs-from-policy",
          `Level ${item.level} records ${record.method} HP while the campaign policy is ${rule.kind}`,
          scope,
        ),
      );
    if (rule.kind === "maximum" && source && record.amount !== source.sides)
      issues.push(
        policyIssue(
          "hp-acquisition-differs-from-maximum-policy",
          `Level ${item.level} should gain d${source.sides} under the maximum-HP policy, not ${record.amount}`,
          scope,
        ),
      );
    if (rule.kind === "fixed" && record.amount !== rule.amount)
      issues.push(
        policyIssue(
          "hp-acquisition-differs-from-fixed-policy",
          `Level ${item.level} should gain ${rule.amount} HP under the fixed policy, not ${record.amount}`,
          scope,
        ),
      );
    if (rule.kind === "rolled" && source) {
      const minimum = rule.minimum ?? 1;
      const maximum = rule.maximum ?? source.sides;
      if (record.amount < minimum || record.amount > maximum)
        issues.push(
          policyIssue(
            "rolled-hp-outside-policy-range",
            `Level ${item.level} rolled HP ${record.amount} is outside the configured ${minimum}–${maximum} range`,
            scope,
          ),
        );
    }
    if (
      rule.kind === "custom" &&
      record.policyId !== undefined &&
      record.policyId !== rule.id
    )
      issues.push(
        policyIssue(
          "custom-hp-policy-id-differs",
          `Level ${item.level} references custom HP policy ${record.policyId}, not ${rule.id}`,
          scope,
        ),
      );
  }
  return { issues, previews };
}

function intelligenceModifier(
  baseAbilities: CharacterInput["baseAbilities"],
): number {
  return Math.floor((baseAbilities.int - 10) / 2);
}

function skillBudget(
  profile: CampaignCharacterProfile,
  baseAbilities: CharacterInput["baseAbilities"],
  source: SlotSkillPointSource | undefined,
  level: number,
): number | undefined {
  const policy = profile.skillAllocationPolicy;
  if (policy.kind !== "calculated") return undefined;
  const chassis = source?.skillPoints ?? 0;
  const ability = policy.includeIntelligenceModifier
    ? intelligenceModifier(baseAbilities)
    : 0;
  const multiplier = level === 1 ? policy.firstLevelMultiplier ?? 1 : 1;
  return Math.max(
    policy.minimumPerLevel ?? 0,
    Math.max(0, chassis + ability) * multiplier,
  );
}

function rankCap(
  profile: CampaignCharacterProfile,
  characterLevel: number,
): number | undefined {
  const cap = profile.skillAllocationPolicy.rankCap;
  if (!cap) return undefined;
  if (cap.kind === "fixed") return cap.value;
  return characterLevel * (cap.multiplier ?? 1) + (cap.offset ?? 0);
}

function skillPolicyIssues(
  profile: CampaignCharacterProfile,
  expected: readonly ExpectedSlot[],
  inspection: Inspection,
): { issues: LifecycleIssue[]; previews: SkillAllocationPreview[] } {
  const issues: LifecycleIssue[] = [];
  const previews: SkillAllocationPreview[] = [];
  const records = inspection.character.lifecycle?.skillAllocations ?? [];
  const characterLevel = inspection.advancement.slotCount;
  const cap = rankCap(profile, characterLevel);
  for (const item of expected) {
    const source = inspection.advancement.skillPointSources.find(
      (candidate) => candidate.slotId === item.slotId,
    );
    const record = records.find((candidate) => candidate.slotId === item.slotId);
    if (!record) {
      issues.push(
        structuralIssue(
          "skill-allocation-required",
          `Level ${item.level} needs a skill allocation record`,
          ["lifecycle", "skillAllocations"],
          { slotId: item.slotId },
        ),
      );
      continue;
    }
    const allocated = Object.values(record.ranks).reduce(
      (total, value) => total + value,
      0,
    );
    const available = skillBudget(
      profile,
      inspection.character.baseAbilities,
      source,
      item.level,
    );
    previews.push({
      level: item.level,
      slotId: item.slotId,
      ...(source ? { winningChassis: source } : {}),
      ...(available !== undefined ? { available, remaining: available - allocated } : {}),
      allocated,
      ranks: record.ranks,
    });
    const scope = { slotId: item.slotId };
    if (record.method !== skillMethodFor(profile))
      issues.push(
        policyIssue(
          "skill-allocation-method-differs-from-policy",
          `Level ${item.level} records ${record.method} skill allocation while the campaign policy is ${profile.skillAllocationPolicy.kind}`,
          scope,
        ),
      );
    if (available !== undefined && allocated > available)
      issues.push(
        policyIssue(
          "skill-allocation-exceeds-budget",
          `Level ${item.level} allocates ${allocated} skill ranks from a budget of ${available}`,
          scope,
        ),
      );
    if (cap !== undefined)
      for (const skillId of Object.keys(record.ranks)) {
        const total = inspection.character.skillRanks[skillId] ?? 0;
        if (total > cap)
          issues.push(
            policyIssue(
              "skill-rank-exceeds-cap",
              `${skillId} has ${total} ranks, above this campaign's cap of ${cap}`,
              { slotId: item.slotId, skillId },
            ),
          );
      }
  }
  return { issues, previews };
}

function choiceIssues(
  requirements: readonly FeatureChoiceRequirement[],
  selections: readonly ChoiceSelection[],
): LifecycleIssue[] {
  const issues: LifecycleIssue[] = [];
  const byReference = new Map(
    requirements.map((requirement) => [
      choiceReferenceKey(requirement.reference),
      requirement,
    ]),
  );
  for (const selection of selections) {
    if (!byReference.has(choiceReferenceKey(selection.requirement)))
      issues.push(
        structuralIssue(
          "choice-selection-reference-is-not-unlocked",
          `Choice selection ${selection.id} does not refer to an unlocked feature requirement`,
          ["lifecycle", "choiceSelections"],
          {
            slotId: selection.requirement.slotId,
            trackId: selection.requirement.trackId,
            progressionId: selection.requirement.progressionId,
            featureId: selection.requirement.featureId,
            choiceRequirementId: selection.requirement.requirementId,
          },
        ),
      );
  }
  for (const item of requirements) {
    const selection = item.selection;
    const scope: LifecycleOverrideScope = {
      slotId: item.reference.slotId,
      trackId: item.reference.trackId,
      progressionId: item.reference.progressionId,
      featureId: item.reference.featureId,
      choiceRequirementId: item.reference.requirementId,
    };
    if (!selection) {
      if (item.requirement.minimum > 0)
        issues.push(
          structuralIssue(
            "feature-choice-required",
            `${item.featureName} requires ${item.requirement.minimum} choice${item.requirement.minimum === 1 ? "" : "s"}: ${item.requirement.prompt}`,
            ["lifecycle", "choiceSelections"],
            scope,
          ),
        );
      continue;
    }
    const selected = selection.optionIds.length + (selection.customOptions?.length ?? 0);
    if (selected < item.requirement.minimum || selected > item.requirement.maximum)
      issues.push(
        structuralIssue(
          "feature-choice-count-invalid",
          `${item.featureName} requires ${item.requirement.minimum}–${item.requirement.maximum} choices, but ${selected} were selected`,
          ["lifecycle", "choiceSelections"],
          scope,
        ),
      );
    const options = new Set(item.requirement.options.map((option) => option.id));
    for (const optionId of selection.optionIds)
      if (!options.has(optionId))
        issues.push(
          structuralIssue(
            "choice-option-is-not-defined",
            `${optionId} is not an option for ${item.requirement.prompt}`,
            ["lifecycle", "choiceSelections"],
            scope,
          ),
        );
    if ((selection.customOptions?.length ?? 0) > 0) {
      if (!item.requirement.allowCustom)
        issues.push(
          policyIssue(
            "custom-choice-not-ordinarily-allowed",
            `${item.requirement.prompt} does not ordinarily allow custom options`,
            scope,
          ),
        );
      else
        issues.push(
          policyIssue(
            "custom-choice-requires-table-confirmation",
            `${item.requirement.prompt} includes custom content that the engine cannot automatically verify`,
            scope,
          ),
        );
    }
  }
  return issues;
}

function lifecycleLedgerIssues(inspection: Inspection): LifecycleIssue[] {
  const issues: LifecycleIssue[] = [];
  const slots = inspection.character.advancementSlots ?? [];
  const slotIds = new Set(slots.map((slot) => slot.id));
  const hp = inspection.character.lifecycle?.hpAcquisitions ?? [];
  const skills = inspection.character.lifecycle?.skillAllocations ?? [];
  for (const record of hp) {
    if (!slotIds.has(record.slotId)) {
      issues.push(
        structuralIssue(
          "hp-acquisition-references-unknown-slot",
          `HP acquisition references missing slot ${record.slotId}`,
          ["lifecycle", "hpAcquisitions"],
          { slotId: record.slotId },
        ),
      );
      continue;
    }
    const current = inspection.advancement.hitDieSources.find(
      (source) => source.slotId === record.slotId,
    );
    if (!record.source)
      issues.push(
        advisoryIssue(
          "hp-acquisition-source-not-recorded",
          `HP acquisition for ${record.slotId} predates winning-HD source provenance`,
          { slotId: record.slotId },
        ),
      );
    else if (
      current &&
      (record.source.trackId !== current.trackId ||
        record.source.progressionId !== current.progressionId ||
        record.source.sides !== current.sides)
    )
      issues.push(
        advisoryIssue(
          "hp-acquisition-source-differs-from-current-content",
          `Stored HP source for ${record.slotId} differs from the progression catalog currently being evaluated`,
          { slotId: record.slotId },
        ),
      );
  }
  for (const record of skills) {
    if (!slotIds.has(record.slotId)) {
      issues.push(
        structuralIssue(
          "skill-allocation-references-unknown-slot",
          `Skill allocation references missing slot ${record.slotId}`,
          ["lifecycle", "skillAllocations"],
          { slotId: record.slotId },
        ),
      );
      continue;
    }
    const current = inspection.advancement.skillPointSources.find(
      (source) => source.slotId === record.slotId,
    );
    if (!record.source)
      issues.push(
        advisoryIssue(
          "skill-allocation-source-not-recorded",
          `Skill allocation for ${record.slotId} predates winning-chassis source provenance`,
          { slotId: record.slotId },
        ),
      );
    else if (
      current &&
      (record.source.trackId !== current.trackId ||
        record.source.progressionId !== current.progressionId ||
        record.source.skillPoints !== current.skillPoints)
    )
      issues.push(
        advisoryIssue(
          "skill-allocation-source-differs-from-current-content",
          `Stored skill chassis for ${record.slotId} differs from the progression catalog currently being evaluated`,
          { slotId: record.slotId },
        ),
      );
  }
  for (const slot of slots) {
    if (!hp.some((record) => record.slotId === slot.id))
      issues.push(
        advisoryIssue(
          "historical-hp-acquisition-not-recorded",
          `No lifecycle HP provenance is recorded for historical slot ${slot.id}`,
          { slotId: slot.id },
        ),
      );
    if (!skills.some((record) => record.slotId === slot.id))
      issues.push(
        advisoryIssue(
          "historical-skill-allocation-not-recorded",
          `No lifecycle skill allocation is recorded for historical slot ${slot.id}`,
          { slotId: slot.id },
        ),
      );
  }
  if (hp.length === slots.length) {
    const recordedHp = hp.reduce((total, record) => total + record.amount, 0);
    if (recordedHp !== inspection.character.baseHpBeforeConstitution)
      issues.push(
        advisoryIssue(
          "hp-acquisition-ledger-does-not-match-baseline",
          `Lifecycle HP acquisitions total ${recordedHp}, while baseHpBeforeConstitution is ${inspection.character.baseHpBeforeConstitution}`,
        ),
      );
  }
  if (skills.length === slots.length) {
    const recordedRanks = addRanks({}, skills);
    const skillIds = new Set([
      ...Object.keys(recordedRanks),
      ...Object.keys(inspection.character.skillRanks),
    ]);
    if (
      [...skillIds].some(
        (skillId) =>
          (recordedRanks[skillId] ?? 0) !==
          (inspection.character.skillRanks[skillId] ?? 0),
      )
    )
      issues.push(
        advisoryIssue(
          "skill-allocation-ledger-does-not-match-ranks",
          "Lifecycle skill allocations do not total the character's current authored skill ranks",
        ),
      );
  }
  return issues;
}

function scopesMatch(
  overrideScope: LifecycleOverrideScope,
  issueScope: LifecycleOverrideScope | undefined,
): boolean {
  if (!issueScope) return false;
  const entries = Object.entries(overrideScope).filter(
    ([, value]) => value !== undefined,
  );
  if (!entries.length) return false;
  return entries.every(
    ([key, value]) =>
      issueScope[key as keyof LifecycleOverrideScope] === value,
  );
}

function finalizedValidation(
  profile: CampaignCharacterProfile,
  issues: readonly LifecycleIssue[],
  overrides: readonly LifecycleOverride[],
): LifecycleValidationResult {
  const all = [...issues];
  if (profile.allowManualOverrides === false && overrides.length)
    all.push(
      structuralIssue(
        "manual-overrides-disabled",
        "This campaign profile does not allow lifecycle overrides",
        ["lifecycle", "overrides"],
      ),
    );
  const withOverrides = all.map((issue) => {
    if (issue.severity !== "warning" || !issue.requiresOverride) return issue;
    const overridden =
      profile.allowManualOverrides !== false &&
      overrides.some(
        (override) =>
          override.code === issue.code && scopesMatch(override.scope, issue.scope),
      );
    return { ...issue, overridden };
  });
  const errors = withOverrides.filter(
    (issue) => issue.severity === "error",
  );
  const warnings = withOverrides.filter(
    (issue) => issue.severity === "warning",
  );
  return {
    errors,
    warnings,
    valid: errors.length === 0,
    canCommit:
      errors.length === 0 &&
      !warnings.some(
        (warning) => warning.requiresOverride && !warning.overridden,
      ),
  };
}

/** Creates a precise authored override for a warning returned by validation. */
export function acceptLifecycleWarning(
  id: string,
  warning: LifecycleIssue,
  reason: string,
): LifecycleOverride {
  if (
    warning.severity !== "warning" ||
    !warning.requiresOverride ||
    !warning.scope
  )
    throw new Error("Only an override-required lifecycle warning can be accepted");
  return {
    id,
    code: warning.code,
    reason,
    scope: warning.scope,
  };
}

function topologyIssues(
  character: CharacterInput,
  profile: CampaignCharacterProfile,
): LifecycleIssue[] {
  const slots = character.advancementSlots;
  if (!slots?.length)
    return [
      structuralIssue(
        "advancement-transaction-requires-advancement-character",
        "Guided advancement requires an existing ordered advancement character; create or migrate one first",
        ["advancementSlots"],
      ),
    ];
  const ids = slots[0]?.tracks.map((track) => track.id) ?? [];
  const expected = profile.tracks.map((track) => track.id);
  if (
    ids.length !== expected.length ||
    ids.some((id, index) => id !== expected[index])
  )
    return [
      structuralIssue(
        "campaign-track-topology-does-not-match-character",
        `Campaign tracks (${expected.join(", ")}) do not match the character's ordered tracks (${ids.join(", ")})`,
        ["advancementSlots"],
      ),
    ];
  return [];
}

function creationAssessment(proposal: CharacterCreationProposal): Assessment {
  const issues: LifecycleIssue[] = [];
  const materialized = creationCandidate(proposal, issues);
  const catalogResult = tryCatalog(
    proposal.character.customProgressions,
    proposal.rules,
  );
  if (catalogResult.issue && !issues.some((issue) => issue.code === catalogResult.issue?.code))
    issues.push(catalogResult.issue);
  const requirements: LifecycleChoiceRequirement[] = progressionRequirements(
    proposal.profile,
    materialized.expected,
    proposal.progressionSelections,
    catalogResult.catalog,
    proposal.character.customProgressions,
    proposal.rules.progressionAliases,
  );
  if (!materialized.candidate)
    return { issues, requirements, hp: [], skills: [] };
  const inspection = inspectCandidate(materialized.candidate, proposal.rules, issues);
  if (!inspection) return { candidate: materialized.candidate, issues, requirements, hp: [], skills: [] };
  issues.push(...lifecycleLedgerIssues(inspection));
  issues.push(
    ...profileProgressionIssues(
      proposal.profile,
      inspection.character.advancementSlots ?? [],
      inspection.catalog,
      proposal.rules,
      inspection.character.customProgressions,
    ),
  );
  const hp = hpPolicyIssues(proposal.profile, materialized.expected, inspection);
  const skills = skillPolicyIssues(
    proposal.profile,
    materialized.expected,
    inspection,
  );
  issues.push(...hp.issues, ...skills.issues);
  const featureChoices = featureRequirements(
    inspection.advancement,
    inspection.catalog,
    inspection.character.lifecycle?.choiceSelections ?? [],
  );
  requirements.push(...featureChoices);
  issues.push(
    ...choiceIssues(
      featureChoices,
      inspection.character.lifecycle?.choiceSelections ?? [],
    ),
  );
  return {
    candidate: inspection.character,
    inspection,
    issues,
    requirements,
    hp: hp.previews,
    skills: skills.previews,
  };
}

function advancementAssessment(proposal: AdvancementProposal): Assessment {
  const issues = topologyIssues(proposal.character, proposal.profile);
  const before = inspectCandidate(proposal.character, proposal.rules, issues);
  const materialized = advancementCandidate(proposal, issues);
  const catalogResult = tryCatalog(
    proposal.character.customProgressions,
    proposal.rules,
  );
  if (catalogResult.issue && !issues.some((issue) => issue.code === catalogResult.issue?.code))
    issues.push(catalogResult.issue);
  const progressionSelections = proposal.profile.tracks.flatMap((track) => {
    const progressionId = proposal.progressionChoices[track.id];
    return progressionId
      ? [{ level: proposal.level, trackId: track.id, progressionId }]
      : [];
  });
  const requirements: LifecycleChoiceRequirement[] = progressionRequirements(
    proposal.profile,
    materialized.expected,
    progressionSelections,
    catalogResult.catalog,
    proposal.character.customProgressions,
    proposal.rules.progressionAliases,
  );
  if (!materialized.candidate)
    return { issues, requirements, hp: [], skills: [] };
  const inspection = inspectCandidate(materialized.candidate, proposal.rules, issues);
  if (!inspection)
    return { candidate: materialized.candidate, issues, requirements, hp: [], skills: [] };
  issues.push(...lifecycleLedgerIssues(inspection));
  issues.push(
    ...profileProgressionIssues(
      proposal.profile,
      inspection.character.advancementSlots ?? [],
      inspection.catalog,
      proposal.rules,
      inspection.character.customProgressions,
    ),
  );
  const hp = hpPolicyIssues(proposal.profile, materialized.expected, inspection);
  const skills = skillPolicyIssues(
    proposal.profile,
    materialized.expected,
    inspection,
  );
  issues.push(...hp.issues, ...skills.issues);
  // Validate all feature choices, including prior committed choices. Existing
  // authored records can therefore never be silently detached by a proposal,
  // and unresolved historical requirements remain visible in the preview.
  const allFeatureChoices = featureRequirements(
    inspection.advancement,
    inspection.catalog,
    inspection.character.lifecycle?.choiceSelections ?? [],
  );
  requirements.push(...allFeatureChoices);
  issues.push(
    ...choiceIssues(
      allFeatureChoices,
      inspection.character.lifecycle?.choiceSelections ?? [],
    ),
  );
  // `before` is intentionally evaluated above: a malformed existing character
  // is an error even if the appended slot itself would be well-formed.
  void before;
  return {
    candidate: inspection.character,
    inspection,
    issues,
    requirements,
    hp: hp.previews,
    skills: skills.previews,
  };
}

export function validateCharacterCreation(
  proposal: CharacterCreationProposal,
): LifecycleValidationResult {
  const assessment = creationAssessment(proposal);
  return finalizedValidation(proposal.profile, assessment.issues, proposal.overrides);
}

export function validateAdvancement(
  proposal: AdvancementProposal,
): LifecycleValidationResult {
  const assessment = advancementAssessment(proposal);
  const overrides = [
    ...(proposal.character.lifecycle?.overrides ?? []),
    ...proposal.overrides,
  ];
  return finalizedValidation(proposal.profile, assessment.issues, overrides);
}

function derivedBefore(
  character: CharacterInput | undefined,
  rules: RulesEngineOptions,
): DerivedCharacter | undefined {
  if (!character) return undefined;
  try {
    return new RulesEngine(character, rules).derive();
  } catch {
    return undefined;
  }
}

function semanticChanges(
  before: DerivedCharacter | undefined,
  inspection: Inspection | undefined,
  expected: readonly ExpectedSlot[],
  hp: readonly HpAcquisitionPreview[],
  skills: readonly SkillAllocationPreview[],
): LifecycleChange[] {
  if (!inspection) return [];
  const after = inspection.derived;
  const changes: LifecycleChange[] = [];
  const beforeLevel = before?.advancement?.slotCount ?? 0;
  const afterLevel = inspection.advancement.slotCount;
  if (beforeLevel !== afterLevel)
    changes.push({
      kind: "level",
      label: `Character level ${beforeLevel} → ${afterLevel}`,
      before: beforeLevel,
      after: afterLevel,
    });
  const beforeProgressions = before?.advancement?.progressionLevels ?? {};
  for (const progression of inspection.advancement.progressionLevels) {
    const previous = beforeProgressions[progression.id]?.value ?? 0;
    if (previous === progression.level)
      continue;
    changes.push({
      kind: "progression",
      label: `${progression.name} ${previous} → ${progression.level}`,
      before: previous,
      after: progression.level,
      progressionId: progression.id,
    });
  }
  const beforeBab = before?.bab.value ?? 0;
  if (beforeBab !== after.bab.value)
    changes.push({
      kind: "bab",
      label: `BAB ${beforeBab >= 0 ? "+" : ""}${beforeBab} → ${after.bab.value >= 0 ? "+" : ""}${after.bab.value}`,
      before: beforeBab,
      after: after.bab.value,
    });
  for (const saveId of ["fortitude", "reflex", "will"] as const) {
    const previous = before?.saves[saveId].value ?? 0;
    const current = after.saves[saveId].value;
    if (previous !== current)
      changes.push({
        kind: "save",
        label: `${saveId} ${previous >= 0 ? "+" : ""}${previous} → ${current >= 0 ? "+" : ""}${current}`,
        before: previous,
        after: current,
        saveId,
      });
  }
  const expectedIds = new Set(expected.map((item) => item.slotId));
  for (const source of inspection.advancement.hitDieSources)
    if (expectedIds.has(source.slotId))
      changes.push({
        kind: "hitDie",
        label: `Level ${source.slotId}: ${source.progressionId} supplies d${source.sides}`,
        slotId: source.slotId,
        trackId: source.trackId,
        progressionId: source.progressionId,
        after: source.sides,
      });
  const beforeFeatureKeys = new Set(
    (before?.advancement?.features ?? []).map(
      (feature) =>
        `${feature.slotId}\u0000${feature.trackId}\u0000${feature.progressionId}\u0000${feature.id}`,
    ),
  );
  for (const feature of inspection.advancement.features) {
    const key = `${feature.slotId}\u0000${feature.trackId}\u0000${feature.progressionId}\u0000${feature.id}`;
    if (!expectedIds.has(feature.slotId) || beforeFeatureKeys.has(key)) continue;
    changes.push({
      kind: "feature",
      label: `New feature: ${feature.name}`,
      slotId: feature.slotId,
      trackId: feature.trackId,
      progressionId: feature.progressionId,
    });
  }
  for (const preview of hp) {
    const previous = before?.maxHp.value;
    const current = after.maxHp.value;
    if (previous !== undefined) preview.maxHpDelta = current - previous;
    if (preview.amount !== undefined)
      changes.push({
        kind: "hp",
        label: `Level ${preview.level} HP before CON: +${preview.amount}`,
        before: previous,
        after: current,
        slotId: preview.slotId,
      });
  }
  for (const preview of skills)
    if (preview.available !== undefined)
      changes.push({
        kind: "skillBudget",
        label: `Level ${preview.level} skill ranks: ${preview.allocated}/${preview.available}${preview.remaining !== undefined ? ` (${preview.remaining} remaining)` : ""}`,
        before: preview.allocated,
        after: preview.available,
        slotId: preview.slotId,
        trackId: preview.winningChassis?.trackId,
        progressionId: preview.winningChassis?.progressionId,
      });
  return changes;
}

export function previewCharacterCreation(
  proposal: CharacterCreationProposal,
): CharacterCreationPreview {
  const assessment = creationAssessment(proposal);
  const validation = finalizedValidation(
    proposal.profile,
    assessment.issues,
    proposal.overrides,
  );
  const expected = expectedCreationSlots(proposal.profile);
  return {
    kind: "character-creation",
    ...(assessment.inspection ? { after: assessment.inspection.derived } : {}),
    changes: semanticChanges(
      undefined,
      assessment.inspection,
      expected,
      assessment.hp,
      assessment.skills,
    ),
    requirements: assessment.requirements,
    hp: assessment.hp,
    skills: assessment.skills,
    validation,
  };
}

export function previewAdvancement(
  proposal: AdvancementProposal,
): AdvancementPreview {
  const assessment = advancementAssessment(proposal);
  const overrides = [
    ...(proposal.character.lifecycle?.overrides ?? []),
    ...proposal.overrides,
  ];
  const validation = finalizedValidation(
    proposal.profile,
    assessment.issues,
    overrides,
  );
  const before = derivedBefore(proposal.character, proposal.rules);
  const expected: ExpectedSlot[] = [{
    level: proposal.level,
    slotId: proposal.slotId,
  }];
  return {
    kind: "advancement",
    level: proposal.level,
    slotId: proposal.slotId,
    ...(before ? { before } : {}),
    ...(assessment.inspection ? { after: assessment.inspection.derived } : {}),
    changes: semanticChanges(
      before,
      assessment.inspection,
      expected,
      assessment.hp,
      assessment.skills,
    ),
    requirements: assessment.requirements,
    ...(assessment.hp[0] ? { hp: assessment.hp[0] } : {}),
    ...(assessment.skills[0] ? { skills: assessment.skills[0] } : {}),
    validation,
  };
}

export function tryCommitCharacterCreation(
  proposal: CharacterCreationProposal,
): LifecycleCommitResult {
  const assessment = creationAssessment(proposal);
  const validation = finalizedValidation(
    proposal.profile,
    assessment.issues,
    proposal.overrides,
  );
  if (!validation.canCommit || !assessment.inspection)
    return { committed: false, validation };
  return { committed: true, character: assessment.inspection.character };
}

/** Commits directly to ordinary persisted authored state, never a builder object. */
export function commitCharacterCreation(
  proposal: CharacterCreationProposal,
): CharacterInput {
  const result = tryCommitCharacterCreation(proposal);
  if (!result.committed)
    throw new LifecycleCommitError(result.validation, "creation");
  return result.character;
}

export function tryCommitAdvancement(
  proposal: AdvancementProposal,
): LifecycleCommitResult {
  const assessment = advancementAssessment(proposal);
  const overrides = [
    ...(proposal.character.lifecycle?.overrides ?? []),
    ...proposal.overrides,
  ];
  const validation = finalizedValidation(
    proposal.profile,
    assessment.issues,
    overrides,
  );
  if (!validation.canCommit || !assessment.inspection)
    return { committed: false, validation };
  return { committed: true, character: assessment.inspection.character };
}

/** Commits directly to ordinary persisted authored state, never a builder object. */
export function commitAdvancement(
  proposal: AdvancementProposal,
): CharacterInput {
  const result = tryCommitAdvancement(proposal);
  if (!result.committed)
    throw new LifecycleCommitError(result.validation, "advancement");
  return result.character;
}

/**
 * Lists the exact catalog choices a profile would offer. This is useful for a
 * future UI or a CLI without coupling either one to catalog/object paths.
 */
export function progressionChoicesForCampaign(
  profile: CampaignCharacterProfile,
  rules: RulesEngineOptions = {},
  customProgressions?: ProgressionCatalog,
): LifecycleProgressionOption[] {
  const parsed = parseCampaignCharacterProfile(profile);
  return progressionOptions(
    parsed,
    catalogFor(customProgressions, rules),
    customProgressions,
    rules.progressionAliases,
  );
}
