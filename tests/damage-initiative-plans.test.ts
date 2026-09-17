import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type {
  AttackDefinition,
  CharacterInput,
  Effect,
  FeatureInstance,
} from "@threepointpf/rules-schema";
import {
  createCharacterActionPlan,
  createCharacterRollPlan,
  rollPlanRequestSchema,
} from "@threepointpf/shared";
import { resolveRollPlan } from "@threepointpf/dice";

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "plans",
    name: "Plan Test",
    baseAbilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 2,
    skillRanks: {},
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...overrides,
  };
}

const engine = (input: CharacterInput) => new RulesEngine(input, rulesCatalogs);

const melee = (
  id: string,
  overrides: Partial<AttackDefinition> = {},
): AttackDefinition => ({
  id,
  name: id,
  attackAbility: "str",
  damageAbility: "str",
  baseDamage: { count: 1, sides: 8 },
  attackTags: ["weapon.melee"],
  mode: "melee",
  ...overrides,
});

const feature = (id: string, effects: Effect[]): FeatureInstance => ({
  id,
  name: id,
  enabled: true,
  effects,
});

const sumOf = (contributions: { value: number }[]) =>
  contributions.reduce((total, item) => total + item.value, 0);

describe("damage roll plans", () => {
  it("completes an action's roll list with every step's own damage", () => {
    const character = homebrew({
      attacks: [
        melee("primary", { baseDamage: { count: 2, sides: 6 } }),
        melee("off-hand", {
          attackTags: ["weapon.melee", "weapon.off-hand"],
          baseDamage: { count: 1, sides: 4 },
        }),
      ],
    });
    const plan = engine(character).createActionPlan({
      action: "fullAttack",
      attackIds: ["primary", "off-hand"],
    });
    // Each step's attack roll is followed by the damage roll that step deals.
    expect(plan.rolls.map((roll) => roll.context.kind)).toEqual(
      plan.attacks.flatMap((attack) =>
        attack.steps.flatMap(() => ["attack", "damage"]),
      ),
    );
    expect(new Set(plan.rolls.map((roll) => roll.id)).size).toBe(
      plan.rolls.length,
    );
    for (const attack of plan.attacks)
      for (const step of attack.steps) {
        expect(step.damage).toBeDefined();
        expect(step.damage!.context).toMatchObject({
          kind: "damage",
          actorCharacterId: character.id,
          attackId: attack.attackId,
          action: {
            kind: "fullAttack",
            sequenceId: plan.id,
            sequenceIndex: step.index,
          },
        });
        // Damage is compared against nothing, so it carries no defense.
        expect(step.damage!.context.target).toBeUndefined();
        expect(step.damage!.outcomePolicy.kind).toBe("plain");
      }
    // A maneuver action produces its check and no invented weapon damage.
    const maneuver = engine(character).createActionPlan({
      action: "maneuver",
      maneuver: "trip",
    });
    expect(maneuver.rolls.map((roll) => roll.context.kind)).toEqual(["maneuver"]);
  });

  it("derives dice and modifier from authored state and matches a standalone plan", () => {
    const character = homebrew({
      attacks: [melee("sword", { baseDamage: { count: 2, sides: 6 } })],
    });
    const rules = engine(character);
    const standalone = rules.createDamageRollPlan("sword", {
      action: "standardAttack",
    });
    const insideAction = rules.createActionPlan({
      action: "standardAttack",
      attackIds: ["sword"],
    }).attacks[0]!.steps[0]!.damage!;
    expect(standalone).toEqual(insideAction);
    expect(standalone.dice).toEqual([{ sides: 6, count: 2 }]);
    expect(standalone.modifier).toBe(3); // STR 16
    expect(sumOf(standalone.provenance!.modifier)).toBe(standalone.modifier);
    expect(standalone.modifier).toBe(rules.derive().attacks[0]!.damage.modifier);
    expect(standalone.id).toContain(":sword:standard");
  });

  it("rolls the damage twice on a critical hit instead of the caller doubling it", () => {
    const character = homebrew({
      attacks: [melee("sword", { baseDamage: { count: 2, sides: 6 } })],
    });
    const rules = engine(character);
    const ordinary = rules.createDamageRollPlan("sword", {
      action: "standardAttack",
    });
    const critical = rules.createDamageRollPlan("sword", {
      action: "standardAttack",
      criticalDamage: true,
    });
    expect(ordinary.context.criticalDamage).toBeUndefined();
    expect(critical.context.criticalDamage).toBe(true);
    expect(critical.id).not.toBe(ordinary.id);
    expect(critical.dice).toEqual([{ sides: 6, count: 4 }]);
    expect(critical.modifier).toBe(ordinary.modifier * 2);
    // The provenance still explains the modifier it reports.
    expect(sumOf(critical.provenance!.modifier)).toBe(critical.modifier);
    const resolved = resolveRollPlan(critical, [6, 6, 1, 1]);
    expect(resolved.total).toBe(14 + critical.modifier);
    expect(resolved.outcome.kind).toBe("unresolved");
  });

  it("keeps contextual damage filtering and its reasons", () => {
    const character = homebrew({
      attacks: [
        melee("greatsword", {
          baseDamage: { count: 2, sides: 6 },
          attackTags: ["weapon.melee", "weapon.two-handed"],
        }),
        melee("longsword"),
      ],
      features: [
        feature("two-handed-focus", [
          {
            kind: "modifier",
            target: "damage.melee",
            value: 3,
            bonusType: "untyped",
            appliesWhen: {
              modes: ["melee"],
              requiredTags: ["weapon.two-handed"],
            },
            source: { id: "homebrew.two-handed-focus", label: "Two-handed focus" },
          },
        ]),
      ],
    });
    const rules = engine(character);
    const twoHanded = rules.createDamageRollPlan("greatsword", {
      action: "standardAttack",
    });
    const oneHanded = rules.createDamageRollPlan("longsword", {
      action: "standardAttack",
    });
    expect(
      twoHanded.provenance!.modifier.some(
        (item) =>
          item.source === "homebrew.two-handed-focus" && item.value === 3,
      ),
    ).toBe(true);
    expect(
      oneHanded.provenance!.excluded?.find(
        (item) => item.source === "homebrew.two-handed-focus",
      ),
    ).toMatchObject({
      target: "damage.melee",
      reason: "requires tags weapon.two-handed",
    });
    // The damage context names the weapon it belongs to, so applicability can
    // decide without duplicate static targets.
    expect(oneHanded.context).toMatchObject({
      kind: "damage",
      attackId: "longsword",
      mode: "melee",
      attackTags: ["weapon.melee"],
    });
  });

  it("rejects a step the action does not have", () => {
    const character = homebrew({ attacks: [melee("sword")] });
    const rules = engine(character);
    expect(() => rules.createDamageRollPlan("missing")).toThrow(
      /Unknown attack: missing/,
    );
    expect(() => rules.createDamageRollPlan("sword", { attackIndex: 9 })).toThrow(
      /Unknown damage sequence index 9/,
    );
    expect(() =>
      rules.createDamageRollPlan("sword", {
        action: "standardAttack",
        attackIndex: 1,
      }),
    ).toThrow(/single sequence member/);
  });

  it("refuses invalid faces and resolves deterministically", () => {
    const character = homebrew({
      attacks: [melee("sword", { baseDamage: { count: 2, sides: 6 } })],
    });
    const plan = engine(character).createDamageRollPlan("sword", {
      action: "standardAttack",
    });
    expect(() => resolveRollPlan(plan, [7, 3])).toThrow(/Invalid d6 face/);
    expect(() => resolveRollPlan(plan, [4])).toThrow(/requires 2 face/);
    expect(resolveRollPlan(plan, [4, 3])).toEqual(resolveRollPlan(plan, [4, 3]));
  });
});

describe("initiative roll plans", () => {
  it("plans initiative as a d20 with the derived modifier and no comparison", () => {
    const character = homebrew({
      features: [
        feature("alert", [
          {
            kind: "modifier",
            target: "initiative",
            value: 4,
            bonusType: "untyped",
            source: { id: "homebrew.alert", label: "Alert" },
          },
        ]),
      ],
    });
    const rules = engine(character);
    const plan = rules.createInitiativeRollPlan();
    expect(plan.dice).toEqual([{ sides: 20, count: 1 }]);
    expect(plan.modifier).toBe(rules.derive().initiative.value);
    expect(plan.context).toMatchObject({
      kind: "initiative",
      actorCharacterId: character.id,
      action: { kind: "other" },
    });
    expect(plan.context.target).toBeUndefined();
    expect(plan.outcomePolicy.kind).toBe("plain");
    expect(
      plan.provenance!.modifier.some(
        (item) => item.source === "homebrew.alert" && item.value === 4,
      ),
    ).toBe(true);
    expect(sumOf(plan.provenance!.modifier)).toBe(plan.modifier);
    // A plain roll keeps the raw-face facts and adds no success or failure.
    const resolved = resolveRollPlan(plan, [12]);
    expect(resolved.total).toBe(12 + plan.modifier);
    expect(resolved.outcome.kind).toBe("unresolved");
    expect(resolved.outcome).not.toHaveProperty("success");
    expect(resolveRollPlan(plan, [20]).outcome.natural20).toBe(true);
    expect(resolveRollPlan(plan, [20]).outcome.kind).toBe("unresolved");
  });

  it("carries contextual flags and reports the ones that withheld an effect", () => {
    const character = homebrew({
      features: [
        feature("opportunist", [
          {
            kind: "modifier",
            target: "initiative",
            value: 5,
            bonusType: "circumstance",
            appliesWhen: {
              kinds: ["initiative"],
              requiredFlags: ["ready-for-danger"],
            },
            source: { id: "homebrew.opportunist", label: "Opportunist" },
          },
        ]),
      ],
    });
    const rules = engine(character);
    const base = rules.createInitiativeRollPlan();
    expect(base.context.flags).toEqual([]);
    expect(
      base.provenance!.excluded?.find(
        (item) => item.source === "homebrew.opportunist",
      )?.reason,
    ).toContain("requires flags");
    const flagged = rules.createInitiativeRollPlan({
      flags: ["ready-for-danger"],
    });
    expect(flagged.modifier).toBe(base.modifier + 5);
    expect(flagged.context.flags).toEqual(["ready-for-danger"]);
  });
});

describe("damage and initiative request contracts", () => {
  it("accepts both kinds and rejects contradictory contexts", () => {
    const { id } = homebrew();
    const parse = (request: unknown) =>
      rollPlanRequestSchema.safeParse(request).success;
    expect(parse({ characterId: id, kind: "initiative" })).toBe(true);
    expect(
      parse({
        characterId: id,
        kind: "initiative",
        defense: { kind: "dc", value: 10 },
      }),
    ).toBe(false);
    expect(parse({ characterId: id, kind: "initiative", attackId: "sword" })).toBe(
      false,
    );
    expect(parse({ characterId: id, kind: "damage", attackId: "sword" })).toBe(
      true,
    );
    expect(parse({ characterId: id, kind: "damage" })).toBe(false);
    expect(
      parse({
        characterId: id,
        kind: "damage",
        attackId: "sword",
        defense: { kind: "ac", value: 12 },
      }),
    ).toBe(false);
    expect(
      parse({
        characterId: id,
        kind: "damage",
        attackId: "sword",
        target: { name: "Goblin" },
      }),
    ).toBe(false);
    expect(
      parse({ characterId: id, kind: "initiative", target: { name: "Self" } }),
    ).toBe(false);
    expect(
      parse({
        characterId: id,
        kind: "save",
        saveId: "will",
        criticalDamage: true,
      }),
    ).toBe(false);
  });

  it("rebuilds the same plans through the shared boundary", () => {
    const character = homebrew({
      attacks: [melee("sword", { baseDamage: { count: 2, sides: 6 } })],
    });
    const rules = engine(character);
    const initiative = createCharacterRollPlan(
      character,
      { characterId: character.id, kind: "initiative" },
      rulesCatalogs,
    );
    expect(initiative).toEqual(rules.createInitiativeRollPlan());
    const damage = createCharacterRollPlan(
      character,
      {
        characterId: character.id,
        kind: "damage",
        attackId: "sword",
        action: "standardAttack",
      },
      rulesCatalogs,
    );
    expect(damage).toEqual(
      rules.createDamageRollPlan("sword", { action: "standardAttack" }),
    );
    const critical = createCharacterRollPlan(
      character,
      {
        characterId: character.id,
        kind: "damage",
        attackId: "sword",
        action: "standardAttack",
        criticalDamage: true,
      },
      rulesCatalogs,
    );
    expect(critical.dice).toEqual([{ sides: 6, count: 4 }]);
    expect(critical.modifier).toBe(damage.modifier * 2);
    expect(critical.context.criticalDamage).toBe(true);
    // The action's own roll list carries the same damage plan a standalone
    // request returns, so both paths resolve identically.
    const action = createCharacterActionPlan(
      character,
      {
        characterId: character.id,
        action: "standardAttack",
        attackIds: ["sword"],
      },
      rulesCatalogs,
    );
    expect(action.attacks[0]!.steps[0]!.damage).toEqual(damage);
    expect(action.rolls.map((roll) => roll.context.kind)).toEqual([
      "attack",
      "damage",
    ]);
  });
});
