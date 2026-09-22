import { describe, expect, it } from "vitest";
import type {
  AbilityDefinition,
  CharacterInput,
  ResourceDefinition,
} from "@threepointpf/rules-schema";
import {
  RulesEngine,
  advanceResourceRound,
  cloneAbilityDefinition,
  commitAbilityActivation,
  deriveResources,
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
});
