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
  type ResourceDefinition,
  type ResourceRefreshRule,
  type ResourceState,
  type TargetId,
} from "@threepointpf/rules-schema";
import { sourceContribution } from "./contributions.js";

export interface ResourceFacts {
  abilityModifier(id: "str" | "dex" | "con" | "int" | "wis" | "cha"): number;
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
}

export type AbilityActivationResult =
  | { accepted: true; character: CharacterInput; ability: AbilityInstance; spent: ResourceState[] }
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
  };
}

export function abilityIsEffective(ability: AbilityInstance): boolean {
  return ability.activation === "passive" ||
    (ability.activation === "toggleable" && ability.active === true);
}

/** Ability mechanics feed the ordinary effect pipeline with ability provenance. */
export function collectAbilityEffects(
  character: CharacterInput,
  catalog: AbilityCatalog = {},
): Effect[] {
  return (character.abilities ?? []).flatMap((instance) => {
    const ability = resolveAbility(instance, catalog);
    if (!abilityIsEffective(ability)) return [];
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
  return [...new Set((character.abilities ?? []).flatMap((instance) => {
    const ability = resolveAbility(instance, catalog);
    return abilityIsEffective(ability) ? (ability.contextFlags ?? []) : [];
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
      ? facts.abilityModifier(term.ability)
      : term.kind === "progressionLevel"
        ? facts.progressionLevel(term.progressionId)
        : term.value;
    const label = term.kind === "abilityModifier"
      ? `${term.ability.toUpperCase()} modifier${multiplier === 1 ? "" : ` ×${multiplier}`}`
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
  if (resource.maximum !== null && spent > resource.maximum)
    throw new Error(`${resource.name} cannot spend more than its maximum ${resource.maximum}`);
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
  let next = setResourceSpent(character, resourceId, current.spent + amount, facts);
  const definition = character.resources!.find((item) => item.id === resourceId)!;
  let state = stateFor(next, resourceId);
  if (definition.refresh.kind === "interval")
    state = { ...state, roundsUntilRefresh: definition.refresh.rounds };
  if (definition.refresh.kind === "rechargeRoll") {
    if (!rollRecharge) throw new Error(`${definition.name} requires a recharge roll`);
    const rounds = rollRecharge(definition.refresh.dice, definition.id);
    if (!Number.isInteger(rounds) || rounds < definition.refresh.dice.count || rounds > definition.refresh.dice.count * definition.refresh.dice.sides)
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

export function validateAbilityActivation(
  proposal: AbilityActivationProposal,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): AbilityValidationIssue[] {
  const instance = proposal.character.abilities?.find((item) => item.id === proposal.abilityId);
  if (!instance) return [{ code: "unknown-ability", message: `Unknown ability ${proposal.abilityId}`, abilityId: proposal.abilityId }];
  const ability = resolveAbility(instance, catalog);
  if (ability.activation === "passive")
    return [{ code: "passive-ability", message: `${ability.name} is passive and cannot be activated`, abilityId: ability.id }];
  if (ability.activation === "toggleable" && ability.active) return [];
  const resources = new Map(deriveResources(proposal.character, facts).map((item) => [item.id, item]));
  return (ability.costs ?? []).flatMap((cost) => {
    const resource = resources.get(cost.resourceId);
    if (!resource) return [{ code: "missing-resource", message: `${ability.name} references missing resource ${cost.resourceId}`, abilityId: ability.id, resourceId: cost.resourceId }];
    const required = Math.max(cost.amount, cost.minimumRemaining ?? 0);
    if (resource.remaining !== null && resource.remaining < required)
      return [{ code: "insufficient-resource", message: `${resource.name} needs ${required} remaining but has ${resource.remaining}`, abilityId: ability.id, resourceId: resource.id }];
    if (resource.refresh.kind === "rechargeRoll" && !proposal.rollRecharge)
      return [{ code: "recharge-roll-required", message: `${resource.name} requires a recharge roll`, abilityId: ability.id, resourceId: resource.id }];
    return [];
  });
}

export function commitAbilityActivation(
  proposal: AbilityActivationProposal,
  facts: ResourceFacts,
  catalog: AbilityCatalog = {},
): AbilityActivationResult {
  const issues = validateAbilityActivation(proposal, facts, catalog);
  if (issues.length) return { accepted: false, character: proposal.character, issues };
  const original = proposal.character.abilities!.find((item) => item.id === proposal.abilityId)!;
  const ability = resolveAbility(original, catalog);
  if (ability.activation === "toggleable" && ability.active) {
    const character = parseCharacterInput({
      ...proposal.character,
      abilities: proposal.character.abilities!.map((item) => item.id === original.id ? { ...item, active: false } : item),
    });
    return { accepted: true, character, ability: { ...ability, active: false }, spent: [] };
  }
  let character = proposal.character;
  const spent: ResourceState[] = [];
  for (const cost of ability.costs ?? []) {
    const definition = character.resources!.find((item) => item.id === cost.resourceId)!;
    if (definition.refresh.kind !== "unlimited") {
      try {
        character = spendResource(character, cost.resourceId, cost.amount, facts, proposal.rollRecharge);
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
  return { accepted: true, character, ability: { ...ability, ...(ability.activation === "toggleable" ? { active: true } : {}) }, spent };
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
  };
}
