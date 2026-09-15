import { describe, expect, it } from "vitest";
import type { CharacterInput, Contribution, Effect } from "@threepointpf/rules-schema";
import { RulesEngine, abilityModifier, evaluate, reduceContributions } from "./index.js";

const fixture: CharacterInput = {
  id: "human-martial", campaignId: "demo", name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }, baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 }, baseHpBeforeConstitution: 50, currentHp: 47, baseLandSpeed: 30,
  skillRanks: { acrobatics: 2, perception: 3 }, skills: { acrobatics: { governingAbility: "dex", classSkill: true }, perception: { governingAbility: "wis" } },
  attacks: [{ id: "greatsword", name: "Greatsword", attackAbility: "str", damageAbility: "str", damageAbilityMultiplier: 1.5, baseDamage: { count: 2, sides: 6 }, weaponBonus: 0, attackTags: ["weapon.melee", "weapon.two-handed"], mode: "melee" }],
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
    expect(after.cmd.value).toBe(before.cmd.value + 2);
  });
  it("propagates Constitution changes to Fortitude and maximum HP", () => {
    const before = new RulesEngine(fixture).derive();
    const changed = { ...fixture, baseAbilities: { ...fixture.baseAbilities, con: 18 } };
    const after = new RulesEngine(changed).derive();
    expect(after.saves.fortitude.value).toBe(before.saves.fortitude.value + 2);
    expect(after.maxHp.value).toBe(before.maxHp.value + 2);
  });
  it("applies Heroism only to its declared targets", () => {
    const without = new RulesEngine({ ...fixture, features: fixture.features.map((feature) => feature.id === "heroism" ? { ...feature, enabled: false } : feature) }).derive();
    const withHeroism = new RulesEngine(fixture).derive();
    expect(withHeroism.saves.fortitude.value).toBe(without.saves.fortitude.value + 2); expect(withHeroism.attacks[0]?.damage.modifier).toBe(without.attacks[0]?.damage.modifier); expect(withHeroism.ac.value).toBe(without.ac.value);
  });
  it("reversibly toggles Rage across all dependents", () => {
    const engine = new RulesEngine(fixture); const before = engine.derive();
    const after = new RulesEngine({ ...fixture, features: fixture.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature) }).derive();
    expect(after.ac.value).toBe(before.ac.value - 2); expect(after.saves.will.value).toBe(before.saves.will.value); expect(after.maxHp.value).toBe(before.maxHp.value + 2);
  });
  it("replaces an intrinsic baseline with Set without double counting the authored base", () => {
    const setFeature = { id: "manual-strength", name: "Manual strength baseline", enabled: true, effects: [{ kind: "set", target: "ability.str", value: 18, source: { id: "manual-strength", label: "Manual strength baseline" } }] } satisfies CharacterInput["features"][number];
    const raging = { ...fixture, baseAbilities: { ...fixture.baseAbilities, str: 10 }, features: [...fixture.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature), setFeature] };
    const derived = new RulesEngine(raging).derive();
    expect(derived.abilities.str.score.value).toBe(22); // Set 18 + Rage 4, not authored 10 + Set 18 + Rage 4.
    expect(derived.attacks[0]?.attack.value).toBe(13);
    expect(derived.abilities.str.score.contributions.map((item) => item.source)).toContain("manual-strength");
    expect(derived.abilities.str.score.contributions.map((item) => item.source)).not.toContain("base-ability");
  });
  it("uses the last enabled Set for save, HP and speed baselines while preserving dependencies", () => {
    const setEffects: Effect[] = [
      { kind: "set", target: "save.fortitude", value: 10, source: { id: "save-baseline", label: "Save baseline" } },
      { kind: "set", target: "hp", value: 40, source: { id: "hp-baseline", label: "HP baseline" } },
      { kind: "set", target: "speed.land", value: 40, source: { id: "speed-baseline", label: "Speed baseline" } },
      { kind: "set", target: "speed.land", value: 35, source: { id: "later-speed-baseline", label: "Later speed baseline" } },
    ];
    const character = { ...fixture, features: [{ id: "baselines", name: "Authored baselines", enabled: true, effects: setEffects }] };
    const derived = new RulesEngine(character).derive();
    expect(derived.saves.fortitude.value).toBe(12); // Set 10 + CON modifier 2.
    expect(derived.maxHp.value).toBe(42); // Set 40 + CON modifier 2.
    expect(derived.movement.value).toBe(35); // The later Set wins; the original 30 and earlier 40 do not sum.
  });
  it("keeps active grants as future capabilities and omits disabled grants", () => {
    const character: CharacterInput = {
      ...fixture,
      features: [
        { id: "spellcasting", name: "Spellcasting", enabled: true, effects: [{ kind: "grant", target: "casterLevel", grant: "spellcasting.slot", source: { id: "spellcasting", label: "Spellcasting" } }] },
        { id: "disabled-capability", name: "Disabled capability", enabled: false, effects: [{ kind: "grant", target: "casterLevel", grant: "disabled.slot" }] },
      ],
    };
    expect(new RulesEngine(character).grants()).toEqual([{ target: "casterLevel", grant: "spellcasting.slot", source: { id: "spellcasting", label: "Spellcasting" } }]);
    expect(new RulesEngine(character).derive().grants).toHaveLength(1);
  });
  it("uses explicit AC applicability instead of inferring applicability from bonus type", () => {
    const character: CharacterInput = {
      ...fixture,
      baseAbilities: { ...fixture.baseAbilities, dex: 14 },
      features: [{ id: "defenses", name: "Defenses", enabled: true, effects: [
        { kind: "modifier", target: "ac", value: 5, bonusType: "armor", appliesTo: ["normal", "flatFooted"], source: { id: "armor", label: "Armor" } },
        { kind: "set", target: "ac.natural", value: 4, source: { id: "natural", label: "Natural armor baseline" } },
        { kind: "modifier", target: "ac", value: 2, bonusType: "deflection", appliesTo: ["normal", "touch", "flatFooted"], source: { id: "deflection", label: "Deflection" } },
        { kind: "modifier", target: "ac", value: 1, bonusType: "dodge", appliesTo: ["normal", "touch"], source: { id: "dodge", label: "Dodge" } },
        { kind: "modifier", target: "ac", value: 4, bonusType: "untyped", appliesTo: ["normal"], source: { id: "normal-only", label: "Normal-only untyped effect" } },
      ] }],
    };
    const derived = new RulesEngine(character).derive();
    expect(derived.ac.value).toBe(28); // 10 + DEX 2 + armor 5 + natural 4 + deflection 2 + dodge 1 + normal-only 4.
    expect(derived.touchAc.value).toBe(15); // 10 + DEX 2 + deflection 2 + dodge 1.
    expect(derived.flatFootedAc.value).toBe(21); // 10 + armor 5 + natural 4 + deflection 2; normal-only is excluded.
    expect(derived.touchAc.contributions.map((item) => item.source)).not.toContain("armor");
    expect(derived.touchAc.contributions.map((item) => item.source)).not.toContain("natural");
    expect(derived.touchAc.contributions.map((item) => item.source)).not.toContain("normal-only");
    expect(derived.flatFootedAc.contributions.map((item) => item.source)).not.toContain("dodge");
  });
  it("keeps Strength in skill dependencies instead of copying a stale modifier", () => {
    const character: CharacterInput = { ...fixture, skillRanks: { ...fixture.skillRanks, climb: 2 }, skills: { ...fixture.skills, climb: { governingAbility: "str", classSkill: true } } };
    const before = new RulesEngine(character).derive();
    const changed = { ...character, baseAbilities: { ...character.baseAbilities, str: 22 } };
    const after = new RulesEngine(changed).derive();
    expect(after.skills.climb!.total.value).toBe(before.skills.climb!.total.value + 2);
  });
  it("uses the same evaluated modifier for roll plans", () => {
    const engine = new RulesEngine(fixture); expect(engine.createSaveRollPlan("fortitude").modifier).toBe(engine.derive().saves.fortitude.value); expect(engine.createAttackRollPlan("greatsword").modifier).toBe(engine.derive().attacks[0]!.attack.value);
  });
  it("produces provenance which sums to every displayed total", () => {
    const derived = new RulesEngine(fixture).derive();
    for (const value of [derived.ac, derived.touchAc, derived.flatFootedAc, derived.initiative, derived.cmb, derived.cmd, ...Object.values(derived.saves), ...Object.values(derived.skills).map((skill) => skill.total), ...derived.attacks.map((attack) => attack.attack)]) expect(value.contributions.reduce((n, item) => n + item.value, 0)).toBe(value.value);
    for (const attack of derived.attacks) expect(attack.damage.contributions.reduce((n, item) => n + item.value, 0)).toBe(attack.damage.modifier);
  });
  it("preserves dependency provenance for nonlinear ability modifiers", () => {
    const attack = new RulesEngine(fixture).derive().attacks[0]!;
    const strength = attack.attack.contributions.find((item) => item.source === "ability.str.modifier");
    expect(strength?.note).toContain("floor");
    expect(strength?.children?.[0]?.source).toBe("ability.str.score");
    expect(strength?.children?.[0]?.children?.some((item) => item.source === "base-ability")).toBe(true);
  });
  it("supports direct stable target evaluation", () => expect(evaluate("ability.str", fixture).value).toBe(18));
});

function evaluateCharacterForTest(input: CharacterInput) { return new RulesEngine(input).derive(); }
