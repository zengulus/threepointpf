import { describe, expect, it } from "vitest";
import type { CharacterInput, Contribution } from "@threepointpf/rules-schema";
import { RulesEngine, abilityModifier, evaluate, reduceContributions } from "./index.js";

const fixture: CharacterInput = {
  id: "human-martial", campaignId: "demo", name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }, baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 }, baseHp: 50, currentHp: 47, baseLandSpeed: 30,
  skillRanks: { acrobatics: 2, perception: 3 }, skills: { acrobatics: { governingAbility: "dex", classSkill: true }, perception: { governingAbility: "wis" } },
  attacks: [{ id: "greatsword", name: "Greatsword", attackAbility: "str", damageAbility: "str", damageAbilityMultiplier: 1.5, baseDamage: { count: 2, sides: 6 }, weaponBonus: 0, attackTags: ["melee", "two-handed"], mode: "melee" }],
  features: [
    { id: "weapon-focus", name: "Weapon Focus", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 1, bonusType: "untyped" }] },
    { id: "heroism", name: "Heroism", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.fortitude", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.reflex", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "initiative", value: 2, bonusType: "morale" }] },
    { id: "rage", name: "Rage", enabled: false, effects: [{ kind: "modifier", target: "ability.str", value: 4, bonusType: "morale" }, { kind: "modifier", target: "ability.con", value: 4, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "ac", value: -2, bonusType: "untyped" }] },
    { id: "power-attack", name: "Power Attack", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: -2, bonusType: "untyped" }, { kind: "modifier", target: "damage.melee", value: 6, bonusType: "untyped" }] },
  ],
};

describe("bonus reduction", () => {
  const c = (value: number, bonusType: Contribution["bonusType"]): Contribution => ({ target: "ac", value, bonusType, source: String(value), label: String(value) });
  it("stacks untyped and dodge contributions", () => expect(reduceContributions([c(2, "untyped"), c(3, "untyped"), c(1, "dodge"), c(1, "dodge")])).toHaveLength(4));
  it("keeps the best positive typed bonus and penalties", () => {
    const reduced = reduceContributions([c(2, "morale"), c(4, "morale"), c(-1, "morale")]);
    expect(reduced.map((item) => item.value)).toEqual([4, -1]);
  });
  it("does not discard same-type penalties", () => expect(reduceContributions([c(-1, "morale"), c(-2, "morale")]).reduce((n, item) => n + item.value, 0)).toBe(-3));
});

describe("character dependency graph", () => {
  it("calculates PF ability modifiers including negative values", () => { expect(abilityModifier(9)).toBe(-1); expect(abilityModifier(18)).toBe(4); });
  it("propagates Strength to attack, damage and CMB", () => {
    const engine = new RulesEngine(fixture); const derived = engine.derive();
    expect(derived.attacks[0]?.attack.value).toBe(11); // BAB 6 + STR 4 + Weapon Focus 1 + Heroism 2 - Power Attack 2
    expect(derived.attacks[0]?.damage.modifier).toBe(12); // 1.5× STR 6 + Power Attack 6
    expect(derived.cmb.value).toBe(10);
    const raging = { ...fixture, features: fixture.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature) };
    const ragingDerived = evaluateCharacterForTest(raging);
    expect(ragingDerived.abilities.str.score.value).toBe(22); expect(ragingDerived.attacks[0]?.attack.value).toBe(13); expect(ragingDerived.attacks[0]?.damage.modifier).toBe(15);
  });
  it("propagates Dexterity to AC, initiative, Reflex and Dex skills", () => {
    const before = new RulesEngine(fixture).derive();
    const changed = { ...fixture, baseAbilities: { ...fixture.baseAbilities, dex: 18 } };
    const after = new RulesEngine(changed).derive();
    expect(after.ac.value).toBe(before.ac.value + 2); expect(after.initiative.value).toBe(before.initiative.value + 2);
    expect(after.saves.reflex.value).toBe(before.saves.reflex.value + 2); expect(after.skills.acrobatics!.total.value).toBe(before.skills.acrobatics!.total.value + 2);
  });
  it("applies Heroism only to its declared targets", () => {
    const without = new RulesEngine({ ...fixture, features: fixture.features.map((feature) => feature.id === "heroism" ? { ...feature, enabled: false } : feature) }).derive();
    const withHeroism = new RulesEngine(fixture).derive();
    expect(withHeroism.saves.fortitude.value).toBe(without.saves.fortitude.value + 2); expect(withHeroism.attacks[0]?.damage.modifier).toBe(without.attacks[0]?.damage.modifier); expect(withHeroism.ac.value).toBe(without.ac.value);
  });
  it("reversibly toggles Rage across all dependents", () => {
    const engine = new RulesEngine(fixture); const before = engine.derive();
    const after = new RulesEngine({ ...fixture, features: fixture.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature) }).derive();
    expect(after.ac.value).toBe(before.ac.value - 2); expect(after.saves.will.value).toBe(before.saves.will.value); expect(after.hp.value).toBe(before.hp.value + 2);
  });
  it("uses the same evaluated modifier for roll plans", () => {
    const engine = new RulesEngine(fixture); expect(engine.createSaveRollPlan("fortitude").modifier).toBe(engine.derive().saves.fortitude.value); expect(engine.createAttackRollPlan("greatsword").modifier).toBe(engine.derive().attacks[0]!.attack.value);
  });
  it("produces provenance which sums to every displayed total", () => {
    const derived = new RulesEngine(fixture).derive();
    for (const value of [derived.ac, derived.touchAc, derived.flatFootedAc, derived.initiative, derived.cmb, derived.cmd, ...Object.values(derived.saves), ...Object.values(derived.skills).map((skill) => skill.total), ...derived.attacks.map((attack) => attack.attack)]) expect(value.contributions.reduce((n, item) => n + item.value, 0)).toBe(value.value);
    for (const attack of derived.attacks) expect(attack.damage.contributions.reduce((n, item) => n + item.value, 0)).toBe(attack.damage.modifier);
  });
  it("supports direct stable target evaluation", () => expect(evaluate("ability.str", fixture).value).toBe(18));
});

function evaluateCharacterForTest(input: CharacterInput) { return new RulesEngine(input).derive(); }
