import type { RollPlan } from "@threepointpf/dice";
import { d20CheckDie, type CharacterInput, type EvaluationResult, type RollOutcomePolicy, type SpellCatalog, type SpellcastingSource, type TargetId } from "@threepointpf/rules-schema";
import { sourceContribution, sum } from "./contributions.js";
import type { RulesRuntime } from "./runtime.js";

export interface DerivedSpellcastingSource {
  source: SpellcastingSource;
  progressionLevel: number;
  maximumSpellLevel: number;
  maximumSpellLevelResult: EvaluationResult;
  casterLevel: EvaluationResult;
  concentration: EvaluationResult;
  slots: Array<{ level: number; capacity: number; spent: number; remaining: number; provenance: EvaluationResult }>;
  spellsKnown: Array<{ level: number; capacity: number }>;
  spellLevel(spellId: string, catalog: SpellCatalog): number | undefined;
  saveDc(spellLevel: number): EvaluationResult;
}

export function slotResourceId(sourceId: string, spellLevel: number): string {
  return `spell.${sourceId}.slot.${spellLevel}`;
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
  const progressionLevel = source.progressionId
    ? runtime.spellcastingLevel(source.id, source.progressionId, source.progressionLevel)
    : source.progressionLevel ?? Math.max(...source.progression.map((item) => item.level));
  const row = slotRow({ ...source, progressionLevel }, progressionLevel);
  const casterTarget = `spellcasting.${source.id}.casterLevel` as TargetId;
  const advancementEvidence = runtime.spellcastingContributions(source.id);
  const casterBaseline = {
    ...runtime.replacement(casterTarget, row?.casterLevel ?? 0, `spellcasting.${source.id}.progression`, `${source.name} progression`),
    ...(advancementEvidence.length ? { children: advancementEvidence.map((item) => sourceContribution(casterTarget, item.levels, `advancement.slot.${item.slotId}.track.${item.trackId}.spellcasting.${item.progressionId}`, `${item.progressionId} advances ${source.name} by ${item.levels}`)) } : {}),
    note: `Progression row ${row?.level ?? 0}: caster level ${row?.casterLevel ?? 0}`,
  };
  const casterParts = [casterBaseline, ...runtime.directModifiers(casterTarget).applied];
  const casterLevel = evaluation(runtime, casterTarget, casterParts);
  const concentrationTarget = `spellcasting.${source.id}.concentration` as TargetId;
  const concentrationBase = {
    ...runtime.replacement(concentrationTarget, casterLevel.value + runtime.abilityModifierValue(source.castingAbility), `spellcasting.${source.id}.concentration.base`, "Caster level + casting ability"),
    children: [sourceContribution(concentrationTarget, casterLevel.value, `spellcasting.${source.id}.casterLevel`, "Caster level"), sourceContribution(concentrationTarget, runtime.abilityModifierValue(source.castingAbility), `spellcasting.${source.id}.ability`, `${source.castingAbility.toUpperCase()} modifier`)],
  };
  const concentrationParts = [concentrationBase, ...runtime.directModifiers(concentrationTarget).applied];
  const concentration = evaluation(runtime, concentrationTarget, concentrationParts);
  const maximumSpellLevelTarget = `spellcasting.${source.id}.maximumSpellLevel` as TargetId;
  const maximumSpellLevelResult = evaluation(runtime, maximumSpellLevelTarget, [runtime.replacement(maximumSpellLevelTarget, row?.maximumSpellLevel ?? 0, `spellcasting.${source.id}.progression.${row?.level ?? 0}.maximumSpellLevel`, "Maximum spell level"), ...runtime.directModifiers(maximumSpellLevelTarget).applied]);
  const levels = [...new Set([...Object.keys(row?.slots ?? {}).map(Number), ...Object.keys(row?.spellsKnown ?? {}).map(Number)])].sort((a, b) => a - b);
  const slots = levels.map((level) => {
    const target = `spellcasting.${source.id}.slot.${level}` as TargetId;
    const baseCapacity = row?.slots[String(level)] ?? 0;
    const spent = stateSpent(runtime.character, slotResourceId(source.id, level));
    const capacityEvaluation = evaluation(runtime, target, [runtime.replacement(target, baseCapacity, `spellcasting.${source.id}.progression.${row?.level ?? 0}.slot.${level}`, `Level ${level} base slots`), ...runtime.directModifiers(target).applied]);
    const capacity = Math.max(0, Math.floor(capacityEvaluation.value));
    return { level, capacity, spent, remaining: Math.max(0, capacity - spent), provenance: capacity === capacityEvaluation.value ? capacityEvaluation : evaluation(runtime, target, [...capacityEvaluation.contributions, sourceContribution(target, capacity - capacityEvaluation.value, `spellcasting.${source.id}.slot.floor`, "Non-negative whole slot capacity")]) };
  });
  const spellsKnown = Object.entries(row?.spellsKnown ?? {}).map(([level, capacity]) => ({ level: Number(level), capacity: Number(capacity) })).sort((a, b) => a.level - b.level);
  return {
    source, progressionLevel, maximumSpellLevel: maximumSpellLevelResult.value, maximumSpellLevelResult, casterLevel, concentration, slots, spellsKnown,
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

export interface SpellCastRequest { sourceId: string; spellId: string; preparedAllocationId?: string }
export interface SpellValidationIssue { code: string; message: string }
export type SpellCastResult = { accepted: true; character: CharacterInput; spell: SpellCatalog[string]; execution: { sourceId: string; spellLevel: number; casterLevel: number; saveDc: number; rollPlans: RollPlan[] } } | { accepted: false; character: CharacterInput; issues: SpellValidationIssue[] };

function plainPolicy(): RollOutcomePolicy {
  return { id: "spell.damage", kind: "plain", natural20: { automatic: false, classification: "natural20" }, natural1: { automatic: false, classification: "natural1" }, criticalConfirmationRequired: false };
}

/** Validates completely before producing updated state; a rejected cast is atomic. */
export function castSpell(runtime: RulesRuntime, request: SpellCastRequest, spells: SpellCatalog = {}): SpellCastResult {
  const character = runtime.character;
  const source = character.spellcastingSources?.find((item) => item.id === request.sourceId);
  const spell = spells[request.spellId] ?? character.customSpells?.[request.spellId];
  const issues: SpellValidationIssue[] = [];
  if (!source) issues.push({ code: "unknown-source", message: `Unknown spellcasting source ${request.sourceId}` });
  if (!spell) issues.push({ code: "unknown-spell", message: `Unknown spell ${request.spellId}` });
  if (!source || !spell) return { accepted: false, character, issues };
  const derived = deriveSpellcastingSource(runtime, source, spells);
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
  if (spellLevel !== undefined && (!slot || slot.remaining <= 0)) issues.push({ code: "no-slot", message: `No level ${spellLevel} slot remains for ${source.name}` });
  if (issues.length || spellLevel === undefined) return { accepted: false, character, issues };
  const dc = derived.saveDc(spellLevel);
  const rollPlans: RollPlan[] = [];
  const damage = spell.execution?.damage;
  if (damage) {
    const count = damage.perCasterLevel ? Math.min(derived.casterLevel.value, damage.casterLevelCap ?? Infinity) * damage.dice.count : damage.dice.count;
    rollPlans.push({ id: `spell:${character.id}:${source.id}:${spell.id}:damage`, characterId: character.id, label: `${spell.name} (${damage.damageType})`, dice: [{ sides: damage.dice.sides, count: Math.max(1, count) }], modifier: 0, context: { kind: "damage", actorCharacterId: character.id, action: { kind: "other" }, spellId: spell.id }, outcomePolicy: plainPolicy(), provenance: { modifier: [], excluded: [], damageTerms: [{ kind: "dice", dice: { count: Math.max(1, count), sides: damage.dice.sides }, label: spell.name, damageType: damage.damageType, criticalBehavior: "notMultiplied", multiplier: 1, source: { id: `spell.${spell.id}`, label: spell.name } }] } });
  }
  const resourceStates = [...(character.resourceStates ?? [])];
  const old = resourceStates.find((item) => item.resourceId === resourceId);
  if (old) old.spent += 1;
  else resourceStates.push({ resourceId, spent: 1 });
  const spellcastingSources = (character.spellcastingSources ?? []).map((item) => item.id !== source.id || source.mode !== "prepared" ? item : {
    ...item, preparedSpells: item.preparedSpells?.map((allocation) => allocation.id === request.preparedAllocationId ? { ...allocation, expended: true } : allocation),
  });
  return { accepted: true, character: { ...character, resourceStates, spellcastingSources }, spell, execution: { sourceId: source.id, spellLevel, casterLevel: derived.casterLevel.value, saveDc: dc.value, rollPlans } };
}

export function prepareSpells(character: CharacterInput, sourceId: string, allocations: SpellcastingSource["preparedSpells"], effectiveLevel?: number): CharacterInput {
  const sources = character.spellcastingSources ?? [];
  const source = sources.find((item) => item.id === sourceId);
  if (!source || source.mode !== "prepared") throw new Error(`Unknown prepared spellcasting source ${sourceId}`);
  const level = effectiveLevel ?? source.progressionLevel ?? Math.max(...source.progression.map((row) => row.level));
  const row = source.progression.filter((item) => item.level <= level).sort((a, b) => b.level - a.level)[0];
  const counts = new Map<number, number>();
  for (const allocation of allocations ?? []) counts.set(allocation.spellLevel, (counts.get(allocation.spellLevel) ?? 0) + 1);
  for (const [spellLevel, count] of counts) {
    const capacity = row?.slots[String(spellLevel)] ?? 0;
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
