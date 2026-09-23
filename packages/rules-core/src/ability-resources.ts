import {
  parseCharacterInput,
  type AbilityCatalog,
  type AbilityDefinition,
  type AbilityInstance,
  type CharacterInput,
  type Contribution,
  type DerivedResource,
  type DiceExpression,
  type Effect,
  type RollPlan,
  type ResourceCost,
  type ResourceCostTiming,
  type ResourceDefinition,
  type ResourceRefreshRule,
  type ResourceState,
  type TargetId,
} from "@threepointpf/rules-schema";
import { sourceContribution } from "./contributions.js";
import { plainOutcomePolicy } from "./outcomes.js";

export interface ResourceFacts {
  abilityModifier(
    id: "str" | "dex" | "con" | "int" | "wis" | "cha",
    source?: "base" | "current",
  ): number;
  progressionLevel(id: string): number;
}

export interface AbilityValidationIssue {
  code: string;
  message: string;
  abilityId?: string;
  resourceId?: string;
}

export interface AbilityActivationProposal {
  character: CharacterInput;
  abilityId: string;
  /** Required only when a recharge-roll resource begins recharging. */
  rollRecharge?: (dice: DiceExpression, resourceId: string) => number;
  /** Deterministically resolved totals keyed by recharge resource id. */
  rechargeRollResults?: Record<string, number>;
}

export interface AbilityExecutionPlan {
  abilityId: string;
  ability: AbilityInstance;
  /** Transient sourced effects for this use; these never enter active state. */
  effects: Effect[];
  grants: Extract<Effect, { kind: "grant" }>[];
  rollPlans: RollPlan[];
  costs: ResourceCost[];
}

export type AbilityActivationResult =
  | { accepted: true; character: CharacterInput; ability: AbilityInstance; execution: AbilityExecutionPlan; spent: ResourceState[] }
  | { accepted: false; character: CharacterInput; issues: AbilityValidationIssue[] };

function definitionFor(
  ability: AbilityInstance,
  catalog: AbilityCatalog = {},
): AbilityDefinition | undefined {
  return ability.definitionId ? catalog[ability.definitionId] : undefined;
}

export function resolveAbility(
  ability: AbilityInstance,
  catalog: AbilityCatalog = {},
): AbilityInstance {
  const definition = definitionFor(ability, catalog);
  if (ability.definitionId && !definition && ability.effects.length === 0)
    throw new Error(`Unknown ability definition ${ability.definitionId}`);
  if (!definition) return ability;
  return {
    ...ability,
    name: ability.name || definition.name,
    description: ability.description ?? definition.description,
    activation: ability.activation ?? definition.activation,
    effects: ability.effects.length ? ability.effects : definition.effects,
    costs: ability.costs ?? definition.costs,
    contextFlags: ability.contextFlags ?? definition.contextFlags,
    exclusiveGroup: ability.exclusiveGroup ?? definition.exclusiveGroup,
    priority: ability.priority ?? definition.priority,
  };
}

/** Compatibility default for old saves; all newly-authored costs store timing. */
export function costTiming(
  cost: ResourceCost,
  activation: AbilityInstance["activation"],
): ResourceCostTiming {
  return cost.timing ?? (activation === "activated" ? "onUse" : "onActivate");
}

export function abilityIsEffective(ability: AbilityInstance): boolean {
  return ability.activation === "passive" ||
    (ability.activation === "toggleable" && ability.active === true);
}

/**
 * Catalog definitions are one semantic identity across the legacy feature and
 * ability representations. The highest-priority effective member of an
 * exclusive group wins; an enabled legacy instance owns a duplicated identity
 * during migration so the same definition is never applied twice.
 */
export function excludedCatalogAbilityDefinitions(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): Set<string> {
  const enabledLegacy = new Set(character.features
    .filter((item) => item.enabled && item.definitionId && catalog[item.definitionId])
    .map((item) => item.definitionId!));
  const candidates = new Map<string, { id: string; priority: number }>();
  for (const id of enabledLegacy) {
    const definition = catalog[id];
    if (definition?.exclusiveGroup) {
      const current = candidates.get(definition.exclusiveGroup);
      if (!current || current.priority < (definition.priority ?? 0))
        candidates.set(definition.exclusiveGroup, { id, priority: definition.priority ?? 0 });
    }
  }
  for (const instance of character.abilities ?? []) {
    const ability = resolveAbility(instance, catalog);
    if (!abilityIsEffective(ability) || !instance.definitionId || !ability.exclusiveGroup) continue;
    const current = candidates.get(ability.exclusiveGroup);
    if (!current || current.priority < (ability.priority ?? 0))
      candidates.set(ability.exclusiveGroup, { id: instance.definitionId, priority: ability.priority ?? 0 });
  }
  const excluded = new Set<string>();
  for (const instance of character.abilities ?? []) {
    if (!instance.definitionId) continue;
    const ability = resolveAbility(instance, catalog);
    if (enabledLegacy.has(instance.definitionId)) excluded.add(instance.definitionId);
    if (ability.exclusiveGroup && candidates.get(ability.exclusiveGroup)?.id !== instance.definitionId)
      excluded.add(instance.definitionId);
  }
  return excluded;
}

export function excludedLegacyFeatureDefinitions(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): Set<string> {
  const winners = new Map<string, { id: string; priority: number }>();
  const candidates: Array<{ id: string; group: string; priority: number }> = [];
  for (const feature of character.features) {
    const definition = feature.enabled && feature.definitionId
      ? catalog[feature.definitionId]
      : undefined;
    if (definition?.exclusiveGroup)
      candidates.push({ id: definition.id, group: definition.exclusiveGroup, priority: definition.priority ?? 0 });
  }
  for (const instance of character.abilities ?? []) {
    const ability = resolveAbility(instance, catalog);
    if (abilityIsEffective(ability) && instance.definitionId && ability.exclusiveGroup)
      candidates.push({ id: instance.definitionId, group: ability.exclusiveGroup, priority: ability.priority ?? 0 });
  }
  for (const item of candidates) {
    const current = winners.get(item.group);
    if (!current || current.priority < item.priority) winners.set(item.group, { id: item.id, priority: item.priority });
  }
  return new Set(candidates.filter((item) => winners.get(item.group)?.id !== item.id).map((item) => item.id));
}

/** Ability mechanics feed the ordinary effect pipeline with ability provenance. */
export function collectAbilityEffects(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): Effect[] {
  const excluded = excludedCatalogAbilityDefinitions(character, catalog);
  const seenDefinitions = new Set<string>();
  return (character.abilities ?? []).flatMap((instance) => {
    const ability = resolveAbility(instance, catalog);
    if (!abilityIsEffective(ability) || (instance.definitionId && excluded.has(instance.definitionId))) return [];
    if (instance.definitionId) {
      if (seenDefinitions.has(instance.definitionId)) return [];
      seenDefinitions.add(instance.definitionId);
    }
    return ability.effects.map((effect) => ({
      ...effect,
      source: effect.source ?? {
        id: `ability.${ability.id}`,
        label: ability.name,
        ...(definitionFor(instance, catalog)?.source
          ? { content: definitionFor(instance, catalog)!.source }
          : {}),
      },
    }));
  });
}

export function abilityContextFlags(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): string[] {
  const excluded = excludedCatalogAbilityDefinitions(character, catalog);
  return [...new Set((character.abilities ?? []).flatMap((instance) => {
    const ability = resolveAbility(instance, catalog);
    return abilityIsEffective(ability) && !(instance.definitionId && excluded.has(instance.definitionId))
      ? (ability.contextFlags ?? [])
      : [];
  }))].sort();
}

export function validateAbilityReferences(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): AbilityValidationIssue[] {
  const resources = new Set((character.resources ?? []).map((item) => item.id));
  return (character.abilities ?? []).flatMap((instance) => {
    let ability: AbilityInstance;
    try {
      ability = resolveAbility(instance, catalog);
    } catch (error) {
      return [{
        code: "unknown-ability-definition",
        message: error instanceof Error ? error.message : "Unknown ability definition",
        abilityId: instance.id,
      }];
    }
    return (ability.costs ?? []).flatMap((cost) => resources.has(cost.resourceId) ? [] : [{
      code: "missing-resource",
      message: `${ability.name} references missing resource ${cost.resourceId}`,
      abilityId: ability.id,
      resourceId: cost.resourceId,
    }]);
  });
}

function stateFor(character: CharacterInput, resourceId: string): ResourceState {
  return character.resourceStates?.find((state) => state.resourceId === resourceId) ?? {
    resourceId,
    spent: 0,
  };
}

function maximumOf(
  definition: ResourceDefinition,
  facts: ResourceFacts,
): { maximum: number | null; provenance: Contribution[] } {
  const target = `resource.${definition.id}.maximum` as TargetId;
  if (definition.refresh.kind === "unlimited") return { maximum: null, provenance: [] };
  if (definition.maximum.kind !== "derived") {
    return {
      maximum: definition.maximum.value,
      provenance: [sourceContribution(target, definition.maximum.value, `resource.${definition.id}`, `${definition.name} ${definition.maximum.kind} maximum`)],
    };
  }
  const contributions: Contribution[] = [];
  if (definition.maximum.base)
    contributions.push(sourceContribution(target, definition.maximum.base, `resource.${definition.id}.base`, `${definition.name} base`));
  for (const [index, term] of definition.maximum.terms.entries()) {
    const multiplier = "multiplier" in term ? (term.multiplier ?? 1) : 1;
    const raw = term.kind === "abilityModifier"
      ? facts.abilityModifier(term.ability, term.source ?? "current")
      : term.kind === "progressionLevel"
        ? facts.progressionLevel(term.progressionId)
        : term.value;
    const label = term.kind === "abilityModifier"
      ? `${(term.source ?? "current") === "base" ? "base " : "current "}${term.ability.toUpperCase()} modifier${multiplier === 1 ? "" : ` ×${multiplier}`}`
      : term.kind === "progressionLevel"
        ? `${term.progressionId} level${multiplier === 1 ? "" : ` ×${multiplier}`}`
        : (term.label ?? "Constant");
    contributions.push(sourceContribution(target, raw * multiplier, `resource.${definition.id}.term.${index}`, label));
  }
  return {
    maximum: Math.max(0, Math.floor(contributions.reduce((total, item) => total + item.value, 0))),
    provenance: contributions,
  };
}

export function deriveResources(
  character: CharacterInput,
  facts: ResourceFacts,
): DerivedResource[] {
  return (character.resources ?? []).map((definition) => {
    const state = stateFor(character, definition.id);
    const evaluated = maximumOf(definition, facts);
    return {
      id: definition.id,
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      maximum: evaluated.maximum,
      spent: state.spent,
      remaining: evaluated.maximum === null ? null : Math.max(0, evaluated.maximum - state.spent),
      refresh: definition.refresh,
      ...(state.roundsUntilRefresh !== undefined ? { roundsUntilRefresh: state.roundsUntilRefresh } : {}),
      provenance: evaluated.provenance,
    };
  });
}

function replaceState(character: CharacterInput, next: ResourceState): CharacterInput {
  const states = (character.resourceStates ?? []).filter((item) => item.resourceId !== next.resourceId);
  return parseCharacterInput({ ...character, resourceStates: [...states, next] });
}

export function setResourceSpent(
  character: CharacterInput,
  resourceId: string,
  spent: number,
  facts: ResourceFacts,
): CharacterInput {
  if (!Number.isInteger(spent) || spent < 0) throw new Error("Resource spent must be a nonnegative integer");
  const resource = deriveResources(character, facts).find((item) => item.id === resourceId);
  if (!resource) throw new Error(`Unknown resource ${resourceId}`);
  if (resource.maximum === null) return parseCharacterInput(character);
  // Spent is historical usage. A later maximum decrease may leave it above the
  // current maximum; remaining bottoms at zero without rewriting that history.
  return replaceState(character, { ...stateFor(character, resourceId), spent });
}

export function spendResource(
  character: CharacterInput,
  resourceId: string,
  amount: number,
  facts: ResourceFacts,
  rollRecharge?: (dice: DiceExpression, resourceId: string) => number,
): CharacterInput {
  const current = stateFor(character, resourceId);
  const resource = deriveResources(character, facts).find((item) => item.id === resourceId);
  if (!resource) throw new Error(`Unknown resource ${resourceId}`);
  if (resource.remaining !== null && resource.remaining < amount)
    throw new Error(`${resource.name} needs ${amount} remaining but has ${resource.remaining}`);
  let next = setResourceSpent(character, resourceId, current.spent + amount, facts);
  const definition = character.resources!.find((item) => item.id === resourceId)!;
  let state = stateFor(next, resourceId);
  if (definition.refresh.kind === "interval")
    state = { ...state, roundsUntilRefresh: definition.refresh.rounds };
  if (definition.refresh.kind === "rechargeRoll") {
    if (!rollRecharge) throw new Error(`${definition.name} requires a recharge roll`);
    const rounds = rollRecharge(definition.refresh.dice, definition.id);
    if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < definition.refresh.dice.count || rounds > definition.refresh.dice.count * definition.refresh.dice.sides)
      throw new Error(`Recharge roll for ${definition.name} is out of range`);
    state = { ...state, roundsUntilRefresh: rounds };
  }
  next = replaceState(next, state);
  return next;
}

export function restoreResource(character: CharacterInput, resourceId: string, amount: number, facts: ResourceFacts): CharacterInput {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Resource restore must be a nonnegative integer");
  const current = stateFor(character, resourceId);
  return setResourceSpent(character, resourceId, Math.max(0, current.spent - amount), facts);
}

export function refreshResource(character: CharacterInput, resourceId: string): CharacterInput {
  if (!(character.resources ?? []).some((item) => item.id === resourceId))
    throw new Error(`Unknown resource ${resourceId}`);
  return replaceState(character, { resourceId, spent: 0 });
}

export function refreshResources(character: CharacterInput, kind: ResourceRefreshRule["kind"]): CharacterInput {
  return (character.resources ?? [])
    .filter((item) => item.refresh.kind === kind)
    .reduce((current, item) => refreshResource(current, item.id), character);
}

/** Advances only resource timers; it is deliberately not a combat initiative engine. */
export function advanceResourceRound(character: CharacterInput): CharacterInput {
  let next = refreshResources(character, "round");
  for (const definition of next.resources ?? []) {
    if (definition.refresh.kind !== "interval" && definition.refresh.kind !== "rechargeRoll") continue;
    const state = stateFor(next, definition.id);
    if (state.roundsUntilRefresh === undefined) continue;
    const remaining = state.roundsUntilRefresh - 1;
    next = remaining <= 0
      ? refreshResource(next, definition.id)
      : replaceState(next, { ...state, roundsUntilRefresh: remaining });
  }
  return next;
}

export interface ResourceRoundResult {
  character: CharacterInput;
  spent: ResourceState[];
  deactivatedAbilityIds: string[];
  issues: AbilityValidationIssue[];
}

/** Advances timers and charges each active toggle's upkeep exactly once. */
export function advanceAbilityResourceRound(
  character: CharacterInput,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): ResourceRoundResult {
  let next = advanceResourceRound(character);
  const spent: ResourceState[] = [];
  const deactivatedAbilityIds: string[] = [];
  const issues: AbilityValidationIssue[] = [];
  for (const instance of next.abilities ?? []) {
    const ability = resolveAbility(instance, catalog);
    if (ability.activation !== "toggleable" || !ability.active) continue;
    const upkeep = (ability.costs ?? []).filter((cost) => costTiming(cost, ability.activation) === "perRound");
    const resources = new Map(deriveResources(next, facts).map((item) => [item.id, item]));
    const upkeepTotals = new Map<string, { amount: number; minimum: number }>();
    for (const cost of upkeep) {
      const current = upkeepTotals.get(cost.resourceId) ?? { amount: 0, minimum: 0 };
      upkeepTotals.set(cost.resourceId, { amount: current.amount + cost.amount, minimum: Math.max(current.minimum, cost.minimumRemaining ?? 0) });
    }
    const failure = [...upkeepTotals].flatMap(([resourceId, total]): AbilityValidationIssue[] => {
      const resource = resources.get(resourceId);
      if (!resource) return [{ code: "missing-resource", message: `${ability.name} references missing resource ${resourceId}`, abilityId: ability.id, resourceId }];
      if (resource.refresh.kind === "rechargeRoll")
        return [{ code: "recharge-roll-required", message: `${ability.name} upkeep requires an explicit recharge roll`, abilityId: ability.id, resourceId }];
      const required = Math.max(total.amount, total.minimum);
      return resource.remaining !== null && resource.remaining < required
        ? [{ code: "insufficient-upkeep", message: `${ability.name} cannot pay ${required} ${resource.name} upkeep`, abilityId: ability.id, resourceId: resource.id }]
        : [];
    });
    if (failure.length) {
      issues.push(...failure);
      deactivatedAbilityIds.push(instance.id);
      next = parseCharacterInput({
        ...next,
        abilities: next.abilities!.map((item) => item.id === instance.id ? { ...item, active: false } : item),
      });
      continue;
    }
    // Validation above makes this multi-resource mutation atomic for an ability.
    for (const cost of upkeep) {
      const definition = next.resources!.find((item) => item.id === cost.resourceId)!;
      if (definition.refresh.kind !== "unlimited") next = spendResource(next, cost.resourceId, cost.amount, facts);
      spent.push(stateFor(next, cost.resourceId));
    }
  }
  return { character: next, spent, deactivatedAbilityIds, issues };
}

export function createRechargeRollPlan(
  character: CharacterInput,
  resource: ResourceDefinition,
): RollPlan {
  if (resource.refresh.kind !== "rechargeRoll")
    throw new Error(`${resource.name} does not use a recharge roll`);
  return {
    id: `resource:${character.id}:${resource.id}:recharge`,
    characterId: character.id,
    label: `${resource.name} recharge`,
    dice: [{ count: resource.refresh.dice.count, sides: resource.refresh.dice.sides }],
    modifier: 0,
    context: { kind: "damage", actorCharacterId: character.id, action: { kind: "other" } },
    outcomePolicy: plainOutcomePolicy,
    provenance: {
      modifier: [],
      excluded: [],
    },
  };
}

function sourcedExecutionEffects(ability: AbilityInstance): Effect[] {
  return ability.effects.map((effect) => ({
    ...effect,
    source: effect.source ?? { id: `ability.${ability.id}`, label: ability.name },
  }));
}

function damageEffectRollPlan(
  character: CharacterInput,
  ability: AbilityInstance,
  effect: Extract<Effect, { kind: "damageDice" }>,
  index: number,
): RollPlan {
  return {
    id: `ability:${character.id}:${ability.id}:damage:${index}`,
    characterId: character.id,
    label: effect.label ?? `${ability.name} damage`,
    dice: [{ count: effect.dice.count, sides: effect.dice.sides }],
    modifier: 0,
    context: { kind: "damage", actorCharacterId: character.id, action: { kind: "other" } },
    outcomePolicy: plainOutcomePolicy,
    provenance: {
      modifier: [],
      excluded: [],
      damageTerms: [{
        kind: "dice",
        dice: effect.dice,
        label: effect.label ?? effect.damageType ?? ability.name,
        source: effect.source ?? { id: `ability.${ability.id}`, label: ability.name },
        ...(effect.damageType ? { damageType: effect.damageType } : {}),
        criticalBehavior: effect.criticalBehavior,
        multiplier: 1,
      }],
    },
  };
}

export type AbilityExecutionPreparation =
  | { accepted: true; execution: AbilityExecutionPlan }
  | { accepted: false; issues: AbilityValidationIssue[] };

export function prepareAbilityExecution(
  proposal: AbilityActivationProposal,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): AbilityExecutionPreparation {
  const instance = proposal.character.abilities?.find((item) => item.id === proposal.abilityId);
  if (!instance) return { accepted: false, issues: [{ code: "unknown-ability", message: `Unknown ability ${proposal.abilityId}`, abilityId: proposal.abilityId }] };
  let ability: AbilityInstance;
  try {
    ability = resolveAbility(instance, catalog);
  } catch (error) {
    return { accepted: false, issues: [{ code: "execution-preparation-failed", message: error instanceof Error ? error.message : "Ability execution preparation failed", abilityId: instance.id }] };
  }
  if (ability.activation === "passive")
    return { accepted: false, issues: [{ code: "passive-ability", message: `${ability.name} is passive and cannot be activated`, abilityId: ability.id }] };
  const invalidTiming = (ability.costs ?? []).find((cost) => {
    const timing = costTiming(cost, ability.activation);
    return ability.activation === "activated"
      ? timing !== "onUse"
      : timing === "onUse";
  });
  if (invalidTiming)
    return { accepted: false, issues: [{ code: "invalid-cost-timing", message: `${ability.name} cannot pay ${costTiming(invalidTiming, ability.activation)} costs through its ${ability.activation} lifecycle`, abilityId: ability.id, resourceId: invalidTiming.resourceId }] };
  const turningOff = ability.activation === "toggleable" && ability.active;
  const dueTiming: ResourceCostTiming = ability.activation === "activated" ? "onUse" : "onActivate";
  const dueCosts = turningOff ? [] : (ability.costs ?? []).filter((cost) => costTiming(cost, ability.activation) === dueTiming);
  const upkeep = turningOff ? [] : (ability.costs ?? []).filter((cost) => costTiming(cost, ability.activation) === "perRound");
  const resources = new Map(deriveResources(proposal.character, facts).map((item) => [item.id, item]));
  const totals = new Map<string, { due: number; upkeep: number; minimum: number }>();
  for (const cost of [...dueCosts, ...upkeep]) {
    const current = totals.get(cost.resourceId) ?? { due: 0, upkeep: 0, minimum: 0 };
    // Upkeep is validated for sustainability, but is not included in today's spend.
    totals.set(cost.resourceId, {
      due: current.due + (dueCosts.includes(cost) ? cost.amount : 0),
      upkeep: current.upkeep + (upkeep.includes(cost) ? cost.amount : 0),
      minimum: Math.max(current.minimum, cost.minimumRemaining ?? 0),
    });
  }
  const issues: AbilityValidationIssue[] = [];
  for (const [resourceId, required] of totals) {
    const resource = resources.get(resourceId);
    if (!resource) {
      issues.push({ code: "missing-resource", message: `${ability.name} references missing resource ${resourceId}`, abilityId: ability.id, resourceId });
      continue;
    }
    const needed = Math.max(required.due + required.upkeep, required.minimum);
    if (resource.remaining !== null && resource.remaining < needed)
      issues.push({ code: "insufficient-resource", message: `${resource.name} needs ${needed} remaining but has ${resource.remaining}`, abilityId: ability.id, resourceId });
  }
  if (issues.length) return { accepted: false, issues };
  const effects = turningOff ? [] : sourcedExecutionEffects(ability);
  const rollPlans = turningOff ? [] : [
    ...dueCosts.flatMap((cost) => {
      const resource = proposal.character.resources?.find((item) => item.id === cost.resourceId);
      return resource?.refresh.kind === "rechargeRoll" ? [createRechargeRollPlan(proposal.character, resource)] : [];
    }),
    ...effects.flatMap((effect, index) => effect.kind === "damageDice" ? [damageEffectRollPlan(proposal.character, ability, effect, index)] : []),
  ];
  return {
    accepted: true,
    execution: {
      abilityId: ability.id,
      ability,
      effects,
      grants: effects.filter((effect): effect is Extract<Effect, { kind: "grant" }> => effect.kind === "grant"),
      rollPlans,
      costs: ability.costs ?? [],
    },
  };
}

export function validateAbilityActivation(
  proposal: AbilityActivationProposal,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): AbilityValidationIssue[] {
  const prepared = prepareAbilityExecution(proposal, facts, catalog);
  return prepared.accepted ? [] : prepared.issues;
}

export function commitAbilityActivation(
  proposal: AbilityActivationProposal,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): AbilityActivationResult {
  const prepared = prepareAbilityExecution(proposal, facts, catalog);
  if (!prepared.accepted) return { accepted: false, character: proposal.character, issues: prepared.issues };
  const original = proposal.character.abilities!.find((item) => item.id === proposal.abilityId)!;
  const ability = resolveAbility(original, catalog);
  if (ability.activation === "toggleable" && ability.active) {
    const character = parseCharacterInput({
      ...proposal.character,
      abilities: proposal.character.abilities!.map((item) => item.id === original.id ? { ...item, active: false } : item),
    });
    return { accepted: true, character, ability: { ...ability, active: false }, execution: prepared.execution, spent: [] };
  }
  const dueTiming: ResourceCostTiming = ability.activation === "activated" ? "onUse" : "onActivate";
  const dueCosts = (ability.costs ?? []).filter((cost) => costTiming(cost, ability.activation) === dueTiming);
  const rechargeResults: Record<string, number> = { ...(proposal.rechargeRollResults ?? {}) };
  for (const cost of dueCosts) {
    const definition = proposal.character.resources!.find((item) => item.id === cost.resourceId)!;
    if (definition.refresh.kind !== "rechargeRoll") continue;
    if (rechargeResults[cost.resourceId] === undefined && proposal.rollRecharge)
      rechargeResults[cost.resourceId] = proposal.rollRecharge(definition.refresh.dice, cost.resourceId);
    const rounds = rechargeResults[cost.resourceId];
    if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < definition.refresh.dice.count || rounds > definition.refresh.dice.count * definition.refresh.dice.sides)
      return { accepted: false, character: proposal.character, issues: [{ code: "recharge-roll-required", message: `${definition.name} requires a valid resolved recharge roll`, abilityId: ability.id, resourceId: definition.id }] };
  }
  let character = proposal.character;
  const spent: ResourceState[] = [];
  for (const cost of dueCosts) {
    const definition = character.resources!.find((item) => item.id === cost.resourceId)!;
    if (definition.refresh.kind !== "unlimited") {
      try {
        character = spendResource(character, cost.resourceId, cost.amount, facts, (_dice, resourceId) => rechargeResults[resourceId]!);
      } catch (error) {
        return {
          accepted: false,
          character: proposal.character,
          issues: [{
            code: "invalid-resource-spend",
            message: error instanceof Error ? error.message : "Resource spend failed",
            abilityId: ability.id,
            resourceId: definition.id,
          }],
        };
      }
    }
    let state = stateFor(character, cost.resourceId);
    character = replaceState(character, state);
    spent.push(state);
  }
  if (ability.activation === "toggleable")
    character = parseCharacterInput({
      ...character,
      abilities: character.abilities!.map((item) => item.id === original.id ? { ...item, active: true } : item),
    });
  return { accepted: true, character, ability: { ...ability, ...(ability.activation === "toggleable" ? { active: true } : {}) }, execution: prepared.execution, spent };
}

export function cloneAbilityDefinition(definition: AbilityDefinition, id: string): AbilityInstance {
  return {
    id,
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    activation: definition.activation,
    ...(definition.activation === "toggleable" ? { active: false } : {}),
    effects: structuredClone(definition.effects),
    ...(definition.costs ? { costs: structuredClone(definition.costs) } : {}),
    ...(definition.contextFlags ? { contextFlags: [...definition.contextFlags] } : {}),
    ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
    ...(definition.priority !== undefined ? { priority: definition.priority } : {}),
  };
}
