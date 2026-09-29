import type { RollPlan } from "@threepointpf/dice";
import { d20CheckDie, type CharacterInput, type EvaluationResult, type FeatureActionRestriction, type RollOutcomePolicy, type SpellCatalog, type SpellcastingSource, type TargetId } from "@threepointpf/rules-schema";
import { sourceContribution, sum } from "./contributions.js";
import { babContribution } from "./defenses.js";
import type { RulesRuntime } from "./runtime.js";

export interface DerivedSpellcastingSource {
  source: SpellcastingSource;
  progressionLevel: number;
  maximumSpellLevel: number;
  maximumSpellLevelResult: EvaluationResult;
  minimumCastingAbilityMet: boolean;
  casterLevel: EvaluationResult;
  concentration: EvaluationResult;
  slots: Array<{ level: number; capacity: number; spent: number; remaining: number; unlimited: boolean; provenance: EvaluationResult }>;
  spellsKnown: Array<{ level: number; capacity: number }>;
  spellLevel(spellId: string, catalog: SpellCatalog): number | undefined;
  saveDc(spellLevel: number): EvaluationResult;
}

export function slotResourceId(sourceId: string, spellLevel: number): string {
  return `spell.${sourceId}.slot.${spellLevel}`;
}

/** Convert explicit round/minute/hour spell durations to combat rounds. */
export function spellDurationInRounds(duration: string | undefined, casterLevel: number): number | undefined {
  const text = duration?.replace(/\([^)]*\)/g, " ").trim().toLowerCase();
  if (!text || /\binstantaneous\b/.test(text) || /\bpermanent\b/.test(text)) return undefined;
  const match = text.match(/^(?:up to\s+)?(\d+(?:\.\d+)?)\s*(rounds?|minutes?|hours?)\s*(?:(?:per|\/)\s*(?:caster\s+)?level)?\b/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.startsWith("round") ? 1 : match[2]!.startsWith("minute") ? 10 : 600;
  const perLevel = /(?:per|\/)\s*(?:caster\s+)?level\b/.test(match[0]);
  const rounds = amount * unit * (perLevel ? Math.max(1, casterLevel) : 1);
  return Number.isFinite(rounds) && rounds > 0 ? Math.ceil(rounds) : undefined;
}

function stateSpent(character: CharacterInput, resourceId: string): number {
  return character.resourceStates?.find((state) => state.resourceId === resourceId)?.spent ?? 0;
}

function slotRow(source: SpellcastingSource, level: number) {
  const effective = source.progressionLevel ?? (source.progressionId ? undefined : 0);
  const requestedLevel = effective ?? level;
  return source.progression.filter((row) => row.level <= requestedLevel).sort((a, b) => b.level - a.level)[0];
}

function evaluation(runtime: RulesRuntime, target: TargetId, contributions: EvaluationResult["contributions"]): EvaluationResult {
  return runtime.result(target, contributions);
}

export function deriveSpellcastingSource(runtime: RulesRuntime, source: SpellcastingSource, catalog: SpellCatalog = {}): DerivedSpellcastingSource {
  const baseProgressionLevel = source.progressionId
    ? runtime.spellcastingLevel(source.id, source.progressionId, source.progressionLevel)
    : source.progressionLevel ?? Math.max(...source.progression.map((item) => item.level));
  const progressionLevel = Math.min(20, baseProgressionLevel + (source.progressionLevelAdjustment ?? 0));
  const row = slotRow({ ...source, progressionLevel }, progressionLevel);
  const casterTarget = `spellcasting.${source.id}.casterLevel` as TargetId;
  const advancementEvidence = runtime.spellcastingContributions(source.id);
  const casterBaseline = {
    ...runtime.replacement(casterTarget, row?.casterLevel ?? 0, `spellcasting.${source.id}.progression`, `${source.name} progression`),
    ...(advancementEvidence.length ? { children: advancementEvidence.map((item) => sourceContribution(casterTarget, item.levels, `advancement.slot.${item.slotId}.track.${item.trackId}.spellcasting.${item.progressionId}`, `${item.progressionId} advances ${source.name} by ${item.levels}`)) } : {}),
    note: `Progression row ${row?.level ?? 0}: caster level ${row?.casterLevel ?? 0}`,
  };
  const casterParts = [
    casterBaseline,
    ...(source.casterLevelAdjustment ? [sourceContribution(casterTarget, source.casterLevelAdjustment, `spellcasting.${source.id}.casterLevelAdjustment`, "Workbook caster level adjustment")] : []),
    ...runtime.directModifiers(casterTarget).applied,
    ...runtime.directModifiers("casterLevel").applied,
  ];
  const casterLevel = evaluation(runtime, casterTarget, casterParts);
  const concentrationTarget = `spellcasting.${source.id}.concentration` as TargetId;
  const concentrationBase = {
    ...runtime.replacement(concentrationTarget, casterLevel.value + runtime.abilityModifierValue(source.castingAbility), `spellcasting.${source.id}.concentration.base`, "Caster level + casting ability"),
    children: [sourceContribution(concentrationTarget, casterLevel.value, `spellcasting.${source.id}.casterLevel`, "Caster level"), sourceContribution(concentrationTarget, runtime.abilityModifierValue(source.castingAbility), `spellcasting.${source.id}.ability`, `${source.castingAbility.toUpperCase()} modifier`)],
  };
  const concentrationParts = [concentrationBase, ...runtime.directModifiers(concentrationTarget).applied];
  const concentration = evaluation(runtime, concentrationTarget, concentrationParts);
  const maximumSpellLevelTarget = `spellcasting.${source.id}.maximumSpellLevel` as TargetId;
  const maximumSpellLevelParts = [runtime.replacement(maximumSpellLevelTarget, row?.maximumSpellLevel ?? 0, `spellcasting.${source.id}.progression.${row?.level ?? 0}.maximumSpellLevel`, "Maximum spell level"), ...runtime.directModifiers(maximumSpellLevelTarget).applied];
  const progressionMaximumSpellLevel = evaluation(runtime, maximumSpellLevelTarget, maximumSpellLevelParts);
  const castingAbilityScore = runtime.abilityScore(source.castingAbility).value;
  const minimumCastingAbilityMet = source.bonusSlots !== "standard" || castingAbilityScore >= 10;
  const abilityMaximumSpellLevel = Math.max(0, Math.floor(castingAbilityScore - 10));
  const maximumSpellLevel = Math.max(0, Math.floor(source.bonusSlots === "standard"
    ? Math.min(progressionMaximumSpellLevel.value, abilityMaximumSpellLevel)
    : progressionMaximumSpellLevel.value));
  const maximumSpellLevelResult = maximumSpellLevel === progressionMaximumSpellLevel.value
    ? progressionMaximumSpellLevel
    : {
        ...progressionMaximumSpellLevel,
        value: maximumSpellLevel,
        contributions: [...progressionMaximumSpellLevel.contributions, sourceContribution(maximumSpellLevelTarget, maximumSpellLevel - progressionMaximumSpellLevel.value, `spellcasting.${source.id}.castingAbility.limit`, `Maximum spell level limited by ${source.castingAbility.toUpperCase()} score`)],
      };
  const levels = [...new Set([...Object.keys(row?.slots ?? {}).map(Number), ...Object.keys(row?.spellsKnown ?? {}).map(Number), ...(row?.unlimitedSpellLevels ?? [])])].sort((a, b) => a - b);
  const slots = levels.map((level) => {
    const target = `spellcasting.${source.id}.slot.${level}` as TargetId;
    const levelEligible = minimumCastingAbilityMet && (source.bonusSlots !== "standard" || level <= maximumSpellLevel);
    const baseCapacity = levelEligible ? row?.slots[String(level)] ?? 0 : 0;
    const spent = stateSpent(runtime.character, slotResourceId(source.id, level));
    const unlimited = levelEligible && (row?.unlimitedSpellLevels?.includes(level) ?? false);
    if (unlimited) {
      const capacityEvaluation = evaluation(runtime, target, [runtime.replacement(target, 0, `spellcasting.${source.id}.progression.${row?.level ?? 0}.slot.${level}`, `Level ${level} unlimited spells`)]);
      return { level, capacity: 0, spent: 0, remaining: 0, unlimited: true, provenance: capacityEvaluation };
    }
    const capacityEvaluation = evaluation(runtime, target, [runtime.replacement(target, baseCapacity, `spellcasting.${source.id}.progression.${row?.level ?? 0}.slot.${level}`, `Level ${level} base slots`), ...(levelEligible ? runtime.directModifiers(target).applied : [])]);
    const bonusSlots = source.bonusSlots === "standard" && level > 0 && level <= maximumSpellLevel
      ? Math.max(0, Math.floor((runtime.abilityScore(source.castingAbility).value - 10 - level) / 4) + 1)
      : 0;
    const bonusContribution = bonusSlots ? sourceContribution(target, bonusSlots, `spellcasting.${source.id}.bonusSlots.${source.castingAbility}.${level}`, `${source.castingAbility.toUpperCase()} bonus level ${level} slots`) : undefined;
    const completeEvaluation = bonusContribution ? evaluation(runtime, target, [...capacityEvaluation.contributions, bonusContribution]) : capacityEvaluation;
    const capacity = Math.max(0, Math.floor(completeEvaluation.value));
    return { level, capacity, spent, remaining: Math.max(0, capacity - spent), unlimited: false, provenance: capacity === completeEvaluation.value ? completeEvaluation : evaluation(runtime, target, [...completeEvaluation.contributions, sourceContribution(target, capacity - completeEvaluation.value, `spellcasting.${source.id}.slot.floor`, "Non-negative whole slot capacity")]) };
  });
  const spellsKnown = Object.entries(row?.spellsKnown ?? {}).map(([level, capacity]) => {
    const spellLevel = Number(level);
    const eligible = minimumCastingAbilityMet && (source.bonusSlots !== "standard" || spellLevel <= maximumSpellLevel);
    return { level: spellLevel, capacity: eligible ? Number(capacity) : 0 };
  }).sort((a, b) => a.level - b.level);
  return {
    source, progressionLevel, maximumSpellLevel: maximumSpellLevelResult.value, maximumSpellLevelResult, minimumCastingAbilityMet, casterLevel, concentration, slots, spellsKnown,
    spellLevel(spellId, spells) { return spells[spellId]?.levels.find((entry) => entry.spellListId === source.spellListId)?.level; },
    saveDc(spellLevel) {
      const target = `spellcasting.${source.id}.dc.${spellLevel}` as TargetId;
      return evaluation(runtime, target, [runtime.replacement(target, 10, "spellcasting.dc.base", "Base DC"), sourceContribution(target, spellLevel, "spellcasting.dc.spell-level", "Spell level"), sourceContribution(target, runtime.abilityModifierValue(source.castingAbility), `spellcasting.${source.id}.ability`, `${source.castingAbility.toUpperCase()} modifier`), ...runtime.directModifiers(target).applied]);
    },
  };
}

export function concentrationRollPlan(runtime: RulesRuntime, sourceId: string, dc?: number): RollPlan {
  const source = runtime.character.spellcastingSources?.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Unknown spellcasting source ${sourceId}`);
  const concentration = deriveSpellcastingSource(runtime, source).concentration;
  return {
    id: `spellcasting:${runtime.character.id}:${source.id}:concentration`, characterId: runtime.character.id,
    label: `${source.name} concentration`, dice: [{ sides: 20, count: 1 }], modifier: concentration.value,
    context: { kind: "skill", actorCharacterId: runtime.character.id, action: { kind: "skillCheck" }, flags: runtime.enabledContextFlags(), ...(dc === undefined ? {} : { target: { defense: { kind: "dc", value: dc } } }) },
    outcomePolicy: runtime.outcomePolicies.skill, primaryCheckDie: d20CheckDie,
    provenance: { modifier: concentration.contributions, excluded: [] },
  };
}

export interface SpellCastRequest { sourceId: string; spellId: string; preparedAllocationId?: string; targetTouchAc?: number; targetName?: string; targetCharacterId?: string; targetMissChance?: number; fleeing?: boolean }
export interface SpellValidationIssue { code: string; message: string }
export type SpellCastResult = { accepted: true; character: CharacterInput; spell: SpellCatalog[string]; execution: { sourceId: string; spellLevel: number; casterLevel: number; saveDc: number; arcaneSpellFailureChance: number; arcaneSpellFailurePlan?: RollPlan; rollPlans: RollPlan[]; saveSuccessRollPlans: RollPlan[]; saveSuccessText?: string } } | { accepted: false; character: CharacterInput; issues: SpellValidationIssue[] };

export function resolveTurnAction(state: NonNullable<CharacterInput["turnActions"]> = {}, cost?: "standard" | "move" | "swift" | "immediate" | "fullRound" | "free", restrictions: FeatureActionRestriction[] = [], fleeing = false) {
  if (restrictions.includes("noActions")) return { error: "This condition prevents taking actions this turn." } as const;
  if (restrictions.includes("fleeOnly") && !fleeing) return { error: "Panicked allows spells and special abilities only when used to flee." } as const;
  if (restrictions.includes("moveOnly") && cost !== "move") return { error: "This condition allows only a move action this turn." } as const;
  if (!cost || cost === "free") return { state } as const;
  const standardSpent = state.standardSpent ?? false;
  const moveSpent = state.moveSpent ?? false;
  const swiftSpent = state.swiftSpent ?? false;
  const fullRoundSpent = state.fullRoundSpent ?? false;
  const oneStandardOrMove = restrictions.includes("oneStandardOrMove");
  if (oneStandardOrMove && cost === "fullRound") return { error: "This condition prevents full-round actions." } as const;
  if (oneStandardOrMove && (cost === "standard" || cost === "move") && state.staggeredActionSpent) return { error: "This condition allows only one standard or move action per turn." } as const;
  if (cost === "standard" && (standardSpent || fullRoundSpent)) return { error: "The standard action is already spent this turn." } as const;
  if (cost === "move" && (moveSpent || fullRoundSpent)) return { error: "The move action is already spent this turn." } as const;
  if ((cost === "swift" || cost === "immediate") && swiftSpent) return { error: "The swift or immediate action is already spent this turn." } as const;
  if (cost === "fullRound" && (standardSpent || moveSpent || fullRoundSpent)) return { error: "A standard or move action has already been spent, so a full-round action is unavailable." } as const;
  return { state: { ...state, ...(cost === "standard" ? { standardSpent: true } : {}), ...(cost === "move" ? { moveSpent: true } : {}), ...(["swift", "immediate"].includes(cost) ? { swiftSpent: true } : {}), ...(cost === "fullRound" ? { fullRoundSpent: true } : {}), ...(oneStandardOrMove && (cost === "standard" || cost === "move") ? { staggeredActionSpent: true } : {}) } } as const;
}

/** Build the concentration check for an activated spell-like ability. */
export function spellLikeConcentrationRollPlan(runtime: RulesRuntime, abilityId: string, dc?: number): RollPlan {
  const ability = runtime.character.abilities?.find((item) => item.id === abilityId);
  if (!ability?.spellLike || !ability.spellId) throw new Error(`Unknown spell-like ability ${abilityId}`);
  const casterLevel = ability.spellLikeCasterLevel ?? runtime.character.hitDiceCount ?? runtime.character.advancementSlots?.length ?? 1;
  const sourceId = `spell-like.${ability.id}`;
  const spellLevel = ability.spellLikeSpellLevel ?? 0;
  const source: SpellcastingSource = {
    id: sourceId, name: ability.name, mode: "spontaneous", castingAbility: ability.spellLikeCastingAbility ?? "cha",
    spellListId: sourceId, spellListAccess: "list", bonusSlots: "none", knownSpellIds: [ability.spellId],
    progression: [{ level: casterLevel, casterLevel, maximumSpellLevel: spellLevel, slots: { [String(spellLevel)]: 0 }, unlimitedSpellLevels: [spellLevel] }],
  };
  const temporaryRuntime = Object.create(runtime) as RulesRuntime;
  Object.defineProperty(temporaryRuntime, "character", { value: { ...runtime.character, spellcastingSources: [...(runtime.character.spellcastingSources ?? []), source] }, enumerable: true });
  return concentrationRollPlan(temporaryRuntime, sourceId, dc);
}

function plainPolicy(): RollOutcomePolicy {
  return { id: "spell.damage", kind: "plain", natural20: { automatic: false, classification: "natural20" }, natural1: { automatic: false, classification: "natural1" }, criticalConfirmationRequired: false };
}

/** Validates completely before producing updated state; a rejected cast is atomic. */
export function castSpell(runtime: RulesRuntime, request: SpellCastRequest, spells: SpellCatalog = {}): SpellCastResult {
  const character = runtime.character;
  const source = character.spellcastingSources?.find((item) => item.id === request.sourceId);
  const spell = spells[request.spellId] ?? character.customSpells?.[request.spellId];
  const issues: SpellValidationIssue[] = [];
  const actionCost = spell?.castingTime.action === "timed" ? undefined : spell?.castingTime.action;
  const restrictions = runtime.actionRestrictions();
  const panicked = character.features.some((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.panicked");
  if (request.fleeing && !panicked) issues.push({ code: "invalid-fleeing-use", message: "Mark a cast as a fleeing use only while Panicked is active." });
  if (restrictions.includes("noPhysicalActions") && (spell?.components.length ?? 0) > 0) issues.push({ code: "action-restricted", message: "This condition prevents spells with components; only purely mental spells are allowed." });
  if (restrictions.includes("moveOnly")) issues.push({ code: "action-restricted", message: "This condition prevents casting spells." });
  const action = resolveTurnAction(character.turnActions, actionCost, restrictions.filter((item) => item !== "moveOnly" && item !== "noPhysicalActions"), Boolean(request.fleeing && panicked));
  if ("error" in action && action.error) issues.push({ code: "action-unavailable", message: action.error });
  if (request.targetMissChance !== undefined && (!Number.isInteger(request.targetMissChance) || request.targetMissChance < 1 || request.targetMissChance > 100))
    issues.push({ code: "invalid-miss-chance", message: "Target miss chance must be a whole percent from 1 to 100" });
  if (!source) issues.push({ code: "unknown-source", message: `Unknown spellcasting source ${request.sourceId}` });
  if (!spell) issues.push({ code: "unknown-spell", message: `Unknown spell ${request.spellId}` });
  if (!source || !spell) return { accepted: false, character, issues };
  const derived = deriveSpellcastingSource(runtime, source, spells);
  if (!derived.minimumCastingAbilityMet) issues.push({ code: "casting-ability-too-low", message: `${source.name} requires a casting ability score of at least 10` });
  const spellLevel = derived.spellLevel(spell.id, { ...spells, ...(character.customSpells ?? {}) });
  if (spellLevel === undefined) issues.push({ code: "wrong-list", message: `${spell.name} is not on ${source.spellListId}` });
  if (source.mode === "spontaneous" && !source.knownSpellIds?.includes(spell.id)) issues.push({ code: "not-known", message: `${spell.name} is not known by ${source.name}` });
  if (source.mode === "spontaneous" && spellLevel !== undefined) {
    const knownCapacity = slotRow({ ...source, progressionLevel: derived.progressionLevel }, derived.progressionLevel)?.spellsKnown?.[String(spellLevel)];
    const knownAtLevel = source.knownSpellIds?.filter((knownId) => derived.spellLevel(knownId, { ...spells, ...(character.customSpells ?? {}) }) === spellLevel).length ?? 0;
    if (knownCapacity !== undefined && knownAtLevel > knownCapacity) issues.push({ code: "known-capacity", message: `${source.name} exceeds its progression allowance of ${knownCapacity} level ${spellLevel} spells known` });
  }
  if (source.mode === "prepared") {
    const allocation = source.preparedSpells?.find((item) => item.id === request.preparedAllocationId && item.spellId === spell.id && !item.expended);
    if (!allocation) issues.push({ code: "not-prepared", message: `${spell.name} has no available prepared allocation` });
    if (source.spellListAccess === "spellbook" && !source.spellbookSpellIds?.includes(spell.id)) issues.push({ code: "not-in-spellbook", message: `${spell.name} is not in ${source.name}'s spellbook` });
    if (allocation && spell.levels.find((entry) => entry.spellListId === source.spellListId)?.level !== allocation.spellLevel) issues.push({ code: "preparation-level-mismatch", message: `${spell.name} was prepared at the wrong spell level` });
  }
  if (spellLevel !== undefined && spellLevel > derived.maximumSpellLevel) issues.push({ code: "level-unavailable", message: `${source.name} cannot cast level ${spellLevel} spells` });
  const resourceId = slotResourceId(source.id, spellLevel ?? 0);
  const slot = derived.slots.find((item) => item.level === spellLevel);
  if (spellLevel !== undefined && (!slot || (!slot.unlimited && slot.remaining <= 0))) issues.push({ code: "no-slot", message: `No level ${spellLevel} slot remains for ${source.name}` });
  if (issues.length || spellLevel === undefined) return { accepted: false, character, issues };
  const dc = derived.saveDc(spellLevel);
  const somatic = spell.components.some((component) => component.trim().toLocaleLowerCase("en-US").split(/[^a-z]+/).some((token) => token === "somatic" || token === "s"));
  const arcane = source.spellListId.trim().toLocaleLowerCase("en-US") === "arcane";
  const progressionKey = source.progressionId?.toLocaleLowerCase("en-US") ?? "";
  const inferredExemption = progressionKey.includes(".bard.") || progressionKey.endsWith(".bard")
    ? "lightArmorAndShields"
    : progressionKey.includes(".magus.") || progressionKey.endsWith(".magus")
      ? derived.progressionLevel >= 13 ? "heavyArmor" : derived.progressionLevel >= 7 ? "mediumArmor" : "lightArmor"
      : "none";
  const exemption = source.arcaneSpellFailureExemption ?? inferredExemption;
  const eligibleFailureItems = runtime.equipment.filter((item) => {
    if (!item.equipped || !item.arcaneSpellFailureChance || item.arcaneSpellFailureChance <= 0) return false;
    if (exemption === "all") return false;
    if (item.kind === "shield") return exemption !== "lightArmorAndShields" && exemption !== "mediumArmorAndShields";
    if (item.kind !== "armor") return true;
    if (exemption === "heavyArmor") return false;
    const category = item.armorWeightCategory;
    if (category === undefined) return true;
    if ((exemption === "lightArmor" || exemption === "lightArmorAndShields") && category <= 1) return false;
    if ((exemption === "mediumArmor" || exemption === "mediumArmorAndShields") && category <= 2) return false;
    return true;
  });
  const arcaneSpellFailureChance = arcane && somatic
    ? Math.min(1, eligibleFailureItems.reduce((total, item) => total + (item.arcaneSpellFailureChance ?? 0), 0))
    : 0;
  const arcaneSpellFailurePercent = Math.round(arcaneSpellFailureChance * 100);
  const arcaneSpellFailurePlan: RollPlan | undefined = arcaneSpellFailurePercent > 0 ? {
    id: `spell:${character.id}:${source.id}:${spell.id}:arcane-spell-failure`,
    characterId: character.id,
    label: `${spell.name} arcane spell failure (${arcaneSpellFailurePercent}%)`,
    dice: [{ sides: 100, count: 1 }],
    modifier: 0,
    context: { kind: "skill", actorCharacterId: character.id, action: { kind: "skillCheck" }, spellId: spell.id },
    outcomePolicy: plainPolicy(),
    primaryCheckDie: { group: 0, sides: 100 },
    provenance: { modifier: [], excluded: [] },
  } : undefined;
  const rollPlans: RollPlan[] = [];
  const damage = spell.execution?.damage;
  const spellAttack = spell.execution?.attack;
  if (spellAttack) {
    const mode: "melee" | "ranged" = spellAttack === "meleeTouch" ? "melee" : "ranged";
    const target = `attack.${mode}` as TargetId;
    const context = { kind: "attack" as const, actorCharacterId: character.id, action: { kind: "standardAttack" as const }, spellId: spell.id, mode, touch: true, flags: runtime.enabledContextFlags(), ...(request.targetTouchAc === undefined ? {} : { target: { ...(request.targetCharacterId ? { characterId: request.targetCharacterId } : {}), ...(request.targetName ? { name: request.targetName } : {}), defense: { kind: "ac" as const, value: request.targetTouchAc, context: "touch" as const, ...(request.targetMissChance ? { missChance: request.targetMissChance } : {}) } } }) };
    const modifiers = runtime.directModifiers(target, { context, reportExclusions: true });
    const attack = runtime.result(target, [
      runtime.replacement(target, 0, `${target}.base`, `${mode} touch attack`),
      babContribution(runtime, target),
      runtime.abilityContribution(mode === "melee" ? "str" : "dex", target),
      runtime.sizeAdjustment(target, -2, "Size modifier"),
      ...modifiers.applied,
    ], { rollContext: context, excluded: modifiers.excluded });
    rollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:attack`, characterId: character.id, label: `${spell.name} ${mode} touch attack${request.targetTouchAc !== undefined && request.targetMissChance ? ` · ${request.targetMissChance}% miss chance` : ""}`, dice: [{ sides: 20, count: 1 }, ...(request.targetTouchAc !== undefined && request.targetMissChance ? [{ sides: 100, count: 1, addsToTotal: false, purpose: "missChance" as const }] : [])], modifier: attack.value, context, outcomePolicy: runtime.outcomePolicies.attack, primaryCheckDie: d20CheckDie, provenance: { modifier: attack.contributions, excluded: attack.excluded ?? [] } });
  }
  if (damage) {
    const count = damage.perCasterLevel ? Math.min(derived.casterLevel.value, damage.casterLevelCap ?? Infinity) * damage.dice.count : damage.dice.count;
    rollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:damage`, characterId: character.id, label: `${spell.name} (${damage.damageType})`, dice: [{ sides: damage.dice.sides, count: Math.max(1, count) }], modifier: 0, context: { kind: "damage", actorCharacterId: character.id, action: { kind: "other" }, spellId: spell.id, ...(request.targetCharacterId || request.targetName ? { target: { ...(request.targetCharacterId ? { characterId: request.targetCharacterId } : {}), ...(request.targetName ? { name: request.targetName } : {}) } } : {}) }, outcomePolicy: plainPolicy(), provenance: { modifier: [], excluded: [], damageTerms: [{ kind: "dice", dice: { count: Math.max(1, count), sides: damage.dice.sides }, label: spell.name, damageType: damage.damageType, criticalBehavior: "notMultiplied", multiplier: 1, source: { id: `spell.${spell.id}`, label: spell.name } }] } });
  }
  const resourceStates = [...(character.resourceStates ?? [])];
  if (!slot?.unlimited) {
    const old = resourceStates.find((item) => item.resourceId === resourceId);
    if (old) old.spent += 1;
    else resourceStates.push({ resourceId, spent: 1 });
  }
  const healing = spell.execution?.healing;
  if (healing) {
    const count = healing.perCasterLevel ? Math.min(derived.casterLevel.value, healing.casterLevelCap ?? Infinity) * healing.dice.count : healing.dice.count;
    const casterLevelBonus = healing.bonusPerCasterLevel ? Math.min(derived.casterLevel.value, healing.casterLevelBonusCap ?? Infinity) : 0;
    const modifier = (healing.flatBonus ?? 0) + casterLevelBonus;
    rollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:healing`, characterId: character.id, label: `${spell.name} healing`, dice: [{ sides: healing.dice.sides, count: Math.max(1, count) }], modifier, context: { kind: "healing", actorCharacterId: character.id, action: { kind: "other" }, spellId: spell.id }, outcomePolicy: plainPolicy(), provenance: { modifier: [ ...(healing.flatBonus ? [sourceContribution("hp", healing.flatBonus, `spell.${spell.id}.healing.flatBonus`, `${spell.name} healing bonus`)] : []), ...(casterLevelBonus ? [sourceContribution("hp", casterLevelBonus, `spell.${spell.id}.healing.casterLevel`, `Caster level healing bonus (maximum ${healing.casterLevelBonusCap ?? "uncapped"})`)] : []) ], excluded: [] } });
  }
  const saveSuccessRollPlans: RollPlan[] = [];
  const saveSuccess = spell.savingThrow?.successfulEffect;
  const saveTarget = request.targetCharacterId || request.targetName ? { ...(request.targetCharacterId ? { characterId: request.targetCharacterId } : {}), ...(request.targetName ? { name: request.targetName } : {}) } : undefined;
  const savedDamage = saveSuccess?.damage;
  if (savedDamage) {
    const count = savedDamage.perCasterLevel ? Math.min(derived.casterLevel.value, savedDamage.casterLevelCap ?? Infinity) * savedDamage.dice.count : savedDamage.dice.count;
    const resolvedDice = { sides: savedDamage.dice.sides, count: Math.max(1, count) };
    saveSuccessRollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:saved-damage`, characterId: character.id, label: `${spell.name} successful-save effect (${savedDamage.damageType})`, dice: [resolvedDice], modifier: 0, context: { kind: "damage", actorCharacterId: character.id, action: { kind: "other" }, spellId: spell.id, ...(saveTarget ? { target: saveTarget } : {}) }, outcomePolicy: plainPolicy(), provenance: { modifier: [], excluded: [], damageTerms: [{ kind: "dice", dice: resolvedDice, label: spell.name, damageType: savedDamage.damageType, criticalBehavior: "notMultiplied", multiplier: 1, source: { id: `spell.${spell.id}.saved-effect`, label: spell.name } }] } });
  }
  const savedHealing = saveSuccess?.healing;
  if (savedHealing) {
    const count = savedHealing.perCasterLevel ? Math.min(derived.casterLevel.value, savedHealing.casterLevelCap ?? Infinity) * savedHealing.dice.count : savedHealing.dice.count;
    const bonus = (savedHealing.flatBonus ?? 0) + (savedHealing.bonusPerCasterLevel ? Math.min(derived.casterLevel.value, savedHealing.casterLevelBonusCap ?? Infinity) : 0);
    const resolvedDice = { sides: savedHealing.dice.sides, count: Math.max(1, count) };
    saveSuccessRollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:saved-healing`, characterId: character.id, label: `${spell.name} successful-save healing`, dice: [resolvedDice], modifier: bonus, context: { kind: "healing", actorCharacterId: character.id, action: { kind: "other" }, spellId: spell.id, ...(saveTarget ? { target: saveTarget } : {}) }, outcomePolicy: plainPolicy(), provenance: { modifier: [ ...(savedHealing.flatBonus ? [sourceContribution("hp", savedHealing.flatBonus, `spell.${spell.id}.savedHealing.flatBonus`, `${spell.name} saved-effect healing bonus`)] : []), ...(savedHealing.bonusPerCasterLevel && bonus !== (savedHealing.flatBonus ?? 0) ? [sourceContribution("hp", bonus - (savedHealing.flatBonus ?? 0), `spell.${spell.id}.savedHealing.casterLevel`, `Caster-level saved-effect healing bonus (maximum ${savedHealing.casterLevelBonusCap ?? "uncapped"})`)] : []) ], excluded: [] } });
  }
  const spellcastingSources = (character.spellcastingSources ?? []).map((item) => item.id !== source.id || source.mode !== "prepared" ? item : {
    ...item, preparedSpells: item.preparedSpells?.map((allocation) => allocation.id === request.preparedAllocationId ? { ...allocation, expended: true } : allocation),
  });
  return { accepted: true, character: { ...character, resourceStates, spellcastingSources, ...(action.state !== character.turnActions ? { turnActions: action.state } : {}) }, spell, execution: { sourceId: source.id, spellLevel, casterLevel: derived.casterLevel.value, saveDc: dc.value, arcaneSpellFailureChance, ...(arcaneSpellFailurePlan ? { arcaneSpellFailurePlan } : {}), rollPlans, saveSuccessRollPlans, ...(saveSuccess?.text ? { saveSuccessText: saveSuccess.text } : {}) } };
}

/** Executes a character-authored spell-like ability without spending a spell slot. */
export function castSpellLike(
  runtime: RulesRuntime,
  abilityId: string,
  request: Omit<SpellCastRequest, "sourceId" | "spellId" | "preparedAllocationId">,
  spells: SpellCatalog = {},
): SpellCastResult {
  const ability = runtime.character.abilities?.find((item) => item.id === abilityId);
  if (!ability || !ability.spellLike || !ability.spellId || ability.activation !== "activated") {
    return { accepted: false, character: runtime.character, issues: [{ code: "invalid-spell-like-ability", message: "Choose an activated spell-like ability with a linked spell." }] };
  }
  if (ability.usesPerDay !== undefined && (ability.usesSpent ?? 0) >= ability.usesPerDay) {
    return { accepted: false, character: runtime.character, issues: [{ code: "daily-uses-exhausted", message: `${ability.name} has no daily uses remaining.` }] };
  }
  const spell = spells[ability.spellId] ?? runtime.character.customSpells?.[ability.spellId];
  if (!spell) return { accepted: false, character: runtime.character, issues: [{ code: "unknown-spell", message: `Unknown linked spell ${ability.spellId}.` }] };
  const originalLevel = spell.levels[0]?.level ?? 0;
  const spellLevel = ability.spellLikeSpellLevel ?? originalLevel;
  const spellListId = `spell-like.${ability.id}`;
  const casterLevel = ability.spellLikeCasterLevel ?? runtime.character.hitDiceCount ?? runtime.character.advancementSlots?.length ?? 1;
  const sourceId = `spell-like.${ability.id}`;
  const source: SpellcastingSource = {
    id: sourceId, name: ability.name, mode: "spontaneous", castingAbility: ability.spellLikeCastingAbility ?? "cha",
    spellListId, spellListAccess: "list", bonusSlots: "none", knownSpellIds: [spell.id],
    progression: [{ level: casterLevel, casterLevel, maximumSpellLevel: spellLevel, slots: { [String(spellLevel)]: 0 }, unlimitedSpellLevels: [spellLevel], spellsKnown: { [String(spellLevel)]: 1 } }],
  };
  const temporaryCharacter: CharacterInput = { ...runtime.character, spellcastingSources: [...(runtime.character.spellcastingSources ?? []), source] };
  const temporaryRuntime = Object.create(runtime) as RulesRuntime;
  Object.defineProperty(temporaryRuntime, "character", { value: temporaryCharacter, enumerable: true });
  const linkedSpell = { ...spell, levels: [{ spellListId, level: spellLevel }] };
  const result = castSpell(temporaryRuntime, { ...request, sourceId, spellId: spell.id }, { ...spells, [spell.id]: linkedSpell });
  if (!result.accepted) return { ...result, character: runtime.character };
  const spellcastingSources = (result.character.spellcastingSources ?? []).filter((item) => item.id !== sourceId);
  return { ...result, character: { ...result.character, spellcastingSources } };
}

export function prepareSpells(character: CharacterInput, sourceId: string, allocations: SpellcastingSource["preparedSpells"], effectiveLevel?: number, slotCapacities?: Record<string, number>): CharacterInput {
  const sources = character.spellcastingSources ?? [];
  const source = sources.find((item) => item.id === sourceId);
  if (!source || source.mode !== "prepared") throw new Error(`Unknown prepared spellcasting source ${sourceId}`);
  const level = effectiveLevel ?? source.progressionLevel ?? Math.max(...source.progression.map((row) => row.level));
  const row = source.progression.filter((item) => item.level <= level).sort((a, b) => b.level - a.level)[0];
  const counts = new Map<number, number>();
  for (const allocation of allocations ?? []) counts.set(allocation.spellLevel, (counts.get(allocation.spellLevel) ?? 0) + 1);
  for (const [spellLevel, count] of counts) {
    if (row?.unlimitedSpellLevels?.includes(spellLevel)) continue;
    const capacity = slotCapacities?.[String(spellLevel)] ?? row?.slots[String(spellLevel)] ?? 0;
    if (count > capacity) throw new Error(`Cannot prepare ${count} level ${spellLevel} spells; ${source.name} has ${capacity} slots at that level`);
  }
  return { ...character, spellcastingSources: sources.map((item) => item.id === sourceId ? { ...item, preparedSpells: (allocations ?? []).map((spell) => ({ ...spell, expended: false })) } : item) };
}

/** Explicit daily refresh; level changes themselves never clear spent slots. */
export function refreshSpellcasting(character: CharacterInput, sourceId: string): CharacterInput {
  if (!character.spellcastingSources?.some((source) => source.id === sourceId)) throw new Error(`Unknown spellcasting source ${sourceId}`);
  const prefix = `spell.${sourceId}.slot.`;
  const resourceStates = (character.resourceStates ?? []).map((state) => state.resourceId.startsWith(prefix) ? { ...state, spent: 0, roundsUntilRefresh: undefined } : state);
  const spellcastingSources = character.spellcastingSources.map((source) => source.id !== sourceId || source.mode !== "prepared" ? source : { ...source, preparedSpells: source.preparedSpells?.map((allocation) => ({ ...allocation, expended: false })) });
  return { ...character, resourceStates, spellcastingSources };
}

export function spellDcValue(dc: EvaluationResult): number { return dc.value; }
