import { describe, expect, it } from "vitest";
import type {
  AbilityDefinition,
  CharacterInput,
  ResourceDefinition,
} from "@threepointpf/rules-schema";
import {
  RulesEngine,
  advanceAbilityResourceRound,
  advanceResourceRound,
  cloneAbilityDefinition,
  commitAbilityActivation,
  deriveResources,
  prepareAbilityExecution,
  refreshResources,
  restoreResource,
  spendResource,
  type ResourceFacts,
} from "./index.js";

const facts: ResourceFacts = {
  abilityModifier: (id) => id === "wis" ? 3 : 0,
  progressionLevel: (id) => id === "monk" ? 2 : 0,
};

function character(changes: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "ability-test",
    name: "Ability Tester",
    baseAbilities: { str: 16, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
    baseBab: 4,
    baseSaves: { fortitude: 1, reflex: 1, will: 1 },
    baseHpBeforeConstitution: 20,
    hitDiceCount: 4,
    skillRanks: {},
    attacks: [{
      id: "greatsword",
      name: "Greatsword",
      attackAbility: "str",
      damageAbility: "str",
      damageAbilityMultiplier: 1.5,
      baseDamage: { count: 2, sides: 6 },
      mode: "melee",
      attackTags: ["weapon.melee", "weapon.two-handed"],
      criticalMultiplier: 2,
    }],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...changes,
  };
}

describe("abilities, resources, and composed damage", () => {
  it("prepares and commits a transient activated execution without making it active", () => {
    const input = character({
      resources: [{ id: "infernal", name: "Infernal Charge", maximum: { kind: "fixed", value: 1 }, refresh: { kind: "daily" } }],
      abilities: [{
        id: "flame-burst", name: "Flame Burst", activation: "activated", effects: [
          { kind: "damageDice", target: "damage.ranged", dice: { count: 3, sides: 6 }, damageType: "fire", criticalBehavior: "normal" },
        ], costs: [{ resourceId: "infernal", amount: 1, timing: "onUse" }],
      }],
    });
    const prepared = prepareAbilityExecution({ character: input, abilityId: "flame-burst" }, facts);
    expect(prepared.accepted && prepared.execution).toMatchObject({
      abilityId: "flame-burst",
      effects: [{ kind: "damageDice", dice: { count: 3, sides: 6 }, source: { id: "ability.flame-burst" } }],
      rollPlans: [{ dice: [{ count: 3, sides: 6 }] }],
    });
    const used = commitAbilityActivation({ character: input, abilityId: "flame-burst" }, facts);
    expect(used.accepted).toBe(true);
    if (!used.accepted) return;
    expect(used.character.abilities?.[0]?.active).toBeUndefined();
    expect(deriveResources(used.character, facts)[0]).toMatchObject({ spent: 1, remaining: 0 });
    const failed = commitAbilityActivation({ character: used.character, abilityId: "flame-burst" }, facts);
    expect(failed).toMatchObject({ accepted: false, character: used.character });
    expect(deriveResources(failed.character, facts)[0]?.spent).toBe(1);
  });

  it("separates activation cost from per-round upkeep and deactivates atomically", () => {
    let current = character({
      resources: [{ id: "charge", name: "Charge", maximum: { kind: "fixed", value: 6 }, refresh: { kind: "manual" } }],
      abilities: [{ id: "demon", name: "Demon Form", activation: "toggleable", active: false, effects: [], costs: [
        { resourceId: "charge", amount: 2, timing: "onActivate" },
        { resourceId: "charge", amount: 1, timing: "perRound" },
      ] }],
    });
    const enabled = commitAbilityActivation({ character: current, abilityId: "demon" }, facts);
    expect(enabled.accepted).toBe(true);
    if (!enabled.accepted) return;
    current = enabled.character;
    expect(deriveResources(current, facts)[0]?.spent).toBe(2);
    expect(new RulesEngine(current).derive().resources[0]?.spent).toBe(2);
    let round = advanceAbilityResourceRound(current, facts);
    expect(deriveResources(round.character, facts)[0]?.spent).toBe(3);
    const disabled = commitAbilityActivation({ character: round.character, abilityId: "demon" }, facts);
    expect(disabled.accepted).toBe(true);
    if (!disabled.accepted) return;
    round = advanceAbilityResourceRound(disabled.character, facts);
    expect(deriveResources(round.character, facts)[0]?.spent).toBe(3);
    const reenabled = commitAbilityActivation({ character: round.character, abilityId: "demon" }, facts);
    expect(reenabled.accepted).toBe(true);
    if (!reenabled.accepted) return;
    expect(deriveResources(reenabled.character, facts)[0]?.spent).toBe(5);
    round = advanceAbilityResourceRound(reenabled.character, facts);
    expect(deriveResources(round.character, facts)[0]?.spent).toBe(6);
    round = advanceAbilityResourceRound(round.character, facts);
    expect(round.deactivatedAbilityIds).toEqual(["demon"]);
    expect(round.issues[0]?.code).toBe("insufficient-upkeep");
    expect(deriveResources(round.character, facts)[0]?.spent).toBe(6);
    expect(round.character.abilities?.[0]?.active).toBe(false);
  });

  it("applies every effect of an active multi-effect toggle with ability provenance", () => {
    const titan = {
      id: "titan-stance",
      name: "Titan Stance",
      activation: "toggleable" as const,
      active: false,
      effects: [
        { kind: "modifier" as const, target: "attack.melee" as const, value: -2, bonusType: "untyped" as const },
        { kind: "modifier" as const, target: "cmb" as const, value: 4, bonusType: "untyped" as const },
        { kind: "damageDice" as const, target: "damage.melee" as const, dice: { count: 2, sides: 6 }, criticalBehavior: "normal" as const, appliesWhen: { modes: ["melee" as const] } },
      ],
    };
    const inactive = character({ abilities: [titan] });
    expect(new RulesEngine(inactive).derive().attacks[0]!.attack.value).toBe(7);
    expect(new RulesEngine(inactive).createDamageRollPlan("greatsword").dice).toEqual([{ count: 2, sides: 6 }]);

    const activated = commitAbilityActivation({ character: inactive, abilityId: titan.id }, facts);
    expect(activated.accepted).toBe(true);
    if (!activated.accepted) return;
    const engine = new RulesEngine(activated.character);
    expect(engine.derive().attacks[0]!.attack.value).toBe(5);
    expect(engine.derive().cmb.value).toBe(11);
    const damage = engine.createDamageRollPlan("greatsword");
    expect(damage.dice).toEqual([{ count: 2, sides: 6 }, { count: 2, sides: 6 }]);
    expect(damage.provenance?.damageTerms?.[1]).toMatchObject({
      source: { id: "ability.titan-stance", label: "Titan Stance" },
      criticalBehavior: "normal",
    });

    const disabled = commitAbilityActivation({ character: activated.character, abilityId: titan.id }, facts);
    expect(disabled.accepted && new RulesEngine(disabled.character).derive().cmb.value).toBe(7);
  });

  it("keeps flaming and precision dice as separate terms with explicit critical behavior", () => {
    const input = character({ abilities: [{
      id: "damage-riders",
      name: "Damage Riders",
      activation: "passive",
      effects: [
        { kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 6 }, damageType: "fire", criticalBehavior: "normal" },
        { kind: "damageDice", target: "damage.melee", dice: { count: 3, sides: 6 }, damageType: "precision", criticalBehavior: "notMultiplied" },
      ],
    }] });
    const engine = new RulesEngine(input);
    const ordinary = engine.createDamageRollPlan("greatsword");
    const critical = engine.createDamageRollPlan("greatsword", { criticalDamage: true });
    expect(ordinary.dice).toEqual([{ count: 2, sides: 6 }, { count: 1, sides: 6 }, { count: 3, sides: 6 }]);
    expect(critical.dice).toEqual([{ count: 4, sides: 6 }, { count: 2, sides: 6 }, { count: 3, sides: 6 }]);
    expect(critical.provenance?.damageTerms?.map((term) => [term.damageType, term.multiplier])).toEqual([
      [undefined, 2], ["fire", 2], ["precision", 1],
    ]);
  });

  it("honors explicitly authored armor-style and dodge-style AC contexts", () => {
    const input = character({ abilities: [{
      id: "ac-effects", name: "AC effects", activation: "passive", effects: [
        { kind: "modifier", target: "ac", value: 4, bonusType: "armor", appliesTo: ["normal", "flatFooted"] },
        { kind: "modifier", target: "ac", value: 2, bonusType: "dodge", appliesTo: ["normal", "touch"] },
      ],
    }] });
    const derived = new RulesEngine(input).derive();
    expect([derived.ac.value, derived.touchAc.value, derived.flatFootedAc.value]).toEqual([16, 12, 14]);
  });

  it("shares one derived resource transactionally across abilities and refreshes it", () => {
    const ki: ResourceDefinition = {
      id: "ki",
      name: "Ki Pool",
      maximum: { kind: "derived", terms: [
        { kind: "progressionLevel", progressionId: "monk" },
        { kind: "abilityModifier", ability: "wis" },
      ] },
      refresh: { kind: "daily" },
    };
    let current = character({
      resources: [ki, { id: "focus", name: "Focus", maximum: { kind: "fixed", value: 0 }, refresh: { kind: "encounter" } }],
      abilities: ["Ki Strike", "Ki Dash"].map((name, index) => ({
        id: `ki-${index}`,
        name,
        activation: "activated" as const,
        effects: [],
        costs: index
          ? [{ resourceId: "ki", amount: 1 }, { resourceId: "focus", amount: 1 }]
          : [{ resourceId: "ki", amount: 1 }],
      })),
    });
    expect(deriveResources(current, facts)[0]).toMatchObject({ maximum: 5, spent: 0, remaining: 5 });
    const strike = commitAbilityActivation({ character: current, abilityId: "ki-0" }, facts);
    expect(strike.accepted).toBe(true);
    if (!strike.accepted) return;
    current = strike.character;
    expect(deriveResources(current, facts)[0]?.spent).toBe(1);
    const failed = commitAbilityActivation({ character: current, abilityId: "ki-1" }, facts);
    expect(failed).toMatchObject({ accepted: false, character: current });
    expect(deriveResources(failed.character, facts)[0]?.spent).toBe(1);
    current = refreshResources(current, "daily");
    expect(deriveResources(current, facts)[0]?.remaining).toBe(5);
  });

  it("charges a toggle once per activation and supports deterministic recharge rounds", () => {
    let current = character({
      resources: [
        { id: "infernal", name: "Infernal Charges", maximum: { kind: "fixed", value: 4 }, refresh: { kind: "manual" } },
        { id: "breath", name: "Breath Weapon", maximum: { kind: "fixed", value: 1 }, refresh: { kind: "rechargeRoll", dice: { count: 1, sides: 4 } } },
      ],
      abilities: [
        { id: "demon-form", name: "Demon Form", activation: "toggleable", active: false, effects: [{ kind: "modifier", target: "ability.str", value: 4, bonusType: "untyped" }], costs: [{ resourceId: "infernal", amount: 2 }] },
        { id: "breath", name: "Breath Weapon", activation: "activated", effects: [], costs: [{ resourceId: "breath", amount: 1 }] },
      ],
    });
    const enabled = commitAbilityActivation({ character: current, abilityId: "demon-form" }, facts);
    expect(enabled.accepted).toBe(true);
    if (!enabled.accepted) return;
    current = enabled.character;
    expect(current.resourceStates?.find((item) => item.resourceId === "infernal")?.spent).toBe(2);
    expect(new RulesEngine(current).derive().abilities.str.score.value).toBe(20);
    expect(new RulesEngine(current).derive().resources[0]?.spent).toBe(2); // deriving does not charge again

    const breath = commitAbilityActivation({ character: current, abilityId: "breath", rollRecharge: () => 3 }, facts);
    expect(breath.accepted).toBe(true);
    if (!breath.accepted) return;
    current = breath.character;
    expect(current.resourceStates?.find((item) => item.resourceId === "breath")).toMatchObject({ spent: 1, roundsUntilRefresh: 3 });
    current = advanceResourceRound(advanceResourceRound(current));
    expect(current.resourceStates?.find((item) => item.resourceId === "breath")?.roundsUntilRefresh).toBe(1);
    current = advanceResourceRound(current);
    expect(current.resourceStates?.find((item) => item.resourceId === "breath")).toEqual({ resourceId: "breath", spent: 0 });
  });

  it("supports manual spend/restore and clones catalog definitions without mutation", () => {
    const resource = { id: "favor", name: "GM Favor", maximum: { kind: "manual" as const, value: 3 }, refresh: { kind: "manual" as const } };
    let current = character({ resources: [resource] });
    current = spendResource(current, "favor", 2, facts);
    current = restoreResource(current, "favor", 1, facts);
    expect(current.resourceStates).toEqual([{ resourceId: "favor", spent: 1 }]);

    const catalog: AbilityDefinition = {
      id: "catalog.focus",
      name: "Focus",
      activation: "toggleable",
      effects: [{ kind: "modifier", target: "initiative", value: 1, bonusType: "insight" }],
    };
    const clone = cloneAbilityDefinition(catalog, "local.focus");
    clone.effects.push({ kind: "modifier", target: "save.will", value: 2, bonusType: "insight" });
    expect(catalog.effects).toHaveLength(1);
    expect(clone.definitionId).toBeUndefined();
  });

  it("refreshes per-round and fixed-interval resources without a combat engine", () => {
    let current = character({ resources: [
      { id: "reaction", name: "Reaction", maximum: { kind: "fixed", value: 1 }, refresh: { kind: "round" } },
      { id: "pulse", name: "Pulse", maximum: { kind: "fixed", value: 2 }, refresh: { kind: "interval", rounds: 2 } },
    ] });
    current = spendResource(current, "reaction", 1, facts);
    current = spendResource(current, "pulse", 1, facts);
    expect(current.resourceStates?.find((item) => item.resourceId === "pulse")).toMatchObject({ spent: 1, roundsUntilRefresh: 2 });
    current = advanceResourceRound(current);
    expect(current.resourceStates?.find((item) => item.resourceId === "reaction")?.spent).toBe(0);
    expect(current.resourceStates?.find((item) => item.resourceId === "pulse")?.roundsUntilRefresh).toBe(1);
    current = advanceResourceRound(current);
    expect(current.resourceStates?.find((item) => item.resourceId === "pulse")).toEqual({ resourceId: "pulse", spent: 0 });
  });

  it("creates deterministic recharge plans and accepts only resolved plan totals", () => {
    const input = character({
      resources: [{ id: "breath", name: "Breath", maximum: { kind: "fixed", value: 1 }, refresh: { kind: "rechargeRoll", dice: { count: 1, sides: 4 } } }],
      abilities: [{ id: "breath-use", name: "Breath Weapon", activation: "activated", effects: [], costs: [{ resourceId: "breath", amount: 1, timing: "onUse" }] }],
    });
    const prepared = prepareAbilityExecution({ character: input, abilityId: "breath-use" }, facts);
    expect(prepared.accepted && prepared.execution.rollPlans[0]).toMatchObject({
      id: "resource:ability-test:breath:recharge",
      dice: [{ count: 1, sides: 4 }],
      outcomePolicy: { kind: "plain" },
    });
    expect(commitAbilityActivation({ character: input, abilityId: "breath-use" }, facts).accepted).toBe(false);
    const used = commitAbilityActivation({ character: input, abilityId: "breath-use", rechargeRollResults: { breath: 3 } }, facts);
    expect(used.accepted && used.character.resourceStates?.[0]).toMatchObject({ spent: 1, roundsUntilRefresh: 3 });
  });

  it("retains excluded conditional damage dice as nonnumeric provenance", () => {
    const input = character({ abilities: [{
      id: "sneak", name: "Sneak Attack", activation: "passive", effects: [{
        kind: "damageDice", target: "damage.melee", dice: { count: 3, sides: 6 }, damageType: "precision", criticalBehavior: "notMultiplied",
        appliesWhen: { requiredFlags: ["sneak-attack-eligible"] },
      }],
    }] });
    const excluded = new RulesEngine(input).createDamageRollPlan("greatsword");
    expect(excluded.dice).toEqual([{ count: 2, sides: 6 }]);
    expect(excluded.provenance?.excludedDamageTerms?.[0]).toMatchObject({
      dice: { count: 3, sides: 6 },
      source: { id: "ability.sneak" },
      reason: "requires flags sneak-attack-eligible",
    });
    const applied = new RulesEngine(input).createDamageRollPlan("greatsword", { flags: ["sneak-attack-eligible"] });
    expect(applied.dice).toEqual([{ count: 2, sides: 6 }, { count: 3, sides: 6 }]);
    expect(applied.provenance?.excludedDamageTerms).toBeUndefined();
  });

  it("distinguishes base and current ability modifiers while preserving overspent history", () => {
    const input = character({
      resources: [{ id: "rage", name: "Rage", maximum: { kind: "derived", terms: [
        { kind: "abilityModifier", ability: "con", source: "base" },
      ] }, refresh: { kind: "daily" } }],
      resourceStates: [{ resourceId: "rage", spent: 3 }],
      abilities: [{ id: "con-boost", name: "Con boost", activation: "toggleable", active: true, effects: [
        { kind: "modifier", target: "ability.con", value: 4, bonusType: "untyped" },
      ] }],
    });
    const engine = new RulesEngine(input);
    const sourceFacts: ResourceFacts = {
      abilityModifier: (id, source = "current") => source === "base"
        ? Math.floor((input.baseAbilities[id] - 10) / 2)
        : engine.derive().abilities[id].modifier.value,
      progressionLevel: () => 0,
    };
    expect(deriveResources(input, sourceFacts)[0]).toMatchObject({ maximum: 0, spent: 3, remaining: 0 });
    const currentMaximum = { ...input.resources![0]!, maximum: { kind: "derived" as const, terms: [{ kind: "abilityModifier" as const, ability: "con" as const, source: "current" as const }] } };
    expect(deriveResources({ ...input, resources: [currentMaximum] }, sourceFacts)[0]).toMatchObject({ maximum: 2, spent: 3, remaining: 0 });
  });

  it("deduplicates catalog semantics across legacy features and honors exclusive priority", () => {
    const low: AbilityDefinition = { id: "condition.low", name: "Low", activation: "toggleable", effects: [{ kind: "modifier", target: "initiative", value: -1, bonusType: "penalty" }], exclusiveGroup: "condition", priority: 1 };
    const high: AbilityDefinition = { id: "condition.high", name: "High", activation: "toggleable", effects: [{ kind: "modifier", target: "initiative", value: -3, bonusType: "penalty" }], exclusiveGroup: "condition", priority: 2 };
    const catalog = { [low.id]: low, [high.id]: high };
    const featureCatalog = Object.fromEntries([low, high].map((item) => [item.id, { id: item.id, name: item.name, effects: item.effects, exclusiveGroup: item.exclusiveGroup, priority: item.priority }]));
    const duplicated = character({
      features: [{ id: "legacy-low", definitionId: low.id, name: low.name, enabled: true, effects: low.effects }],
      abilities: [{ id: "ability-low", definitionId: low.id, name: low.name, activation: "toggleable", active: true, effects: [] }],
    });
    expect(new RulesEngine(duplicated, { featureCatalog, abilityCatalog: catalog }).derive().initiative.value).toBe(-1);
    const input = character({
      features: [{ id: "legacy-low", definitionId: low.id, name: low.name, enabled: true, effects: low.effects }],
      abilities: [
        { id: "ability-low", definitionId: low.id, name: low.name, activation: "toggleable", active: true, effects: [] },
        { id: "ability-high", definitionId: high.id, name: high.name, activation: "toggleable", active: true, effects: [] },
      ],
    });
    const initiative = new RulesEngine(input, { featureCatalog, abilityCatalog: catalog }).derive().initiative;
    expect(initiative.value).toBe(-3);
    expect(initiative.contributions.filter((item) => item.label === "High")).toHaveLength(1);
  });
});
