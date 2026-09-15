import { describe, expect, it } from "vitest";
import type { AdvancementSlot, CharacterInput, Contribution, Effect } from "@threepointpf/rules-schema";
import { RulesEngine, abilityModifier, evaluate, reduceContributions } from "./index.js";

const fixture: CharacterInput = {
  id: "human-martial", campaignId: "demo", name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }, baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 }, baseHpBeforeConstitution: 50, hitDiceCount: 1, damageTaken: 5, temporaryHp: 0, baseLandSpeed: 30,
  skillRanks: { acrobatics: 2, perception: 3 }, skills: { acrobatics: { governingAbility: "dex", classSkill: true }, perception: { governingAbility: "wis" } },
  attacks: [{ id: "greatsword", name: "Greatsword", attackAbility: "str", damageAbility: "str", damageAbilityMultiplier: 1.5, baseDamage: { count: 2, sides: 6 }, weaponBonus: 0, attackTags: ["weapon.melee", "weapon.two-handed"], mode: "melee" }],
  features: [
    { id: "weapon-focus", name: "Weapon Focus", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 1, bonusType: "untyped" }] },
    { id: "heroism", name: "Heroism", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.fortitude", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.reflex", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "initiative", value: 2, bonusType: "morale" }] },
    { id: "rage", name: "Rage", enabled: false, effects: [{ kind: "modifier", target: "ability.str", value: 4, bonusType: "morale" }, { kind: "modifier", target: "ability.con", value: 4, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "ac", value: -2, bonusType: "untyped", appliesTo: ["normal", "touch", "flatFooted"] }] },
    { id: "power-attack", name: "Power Attack", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: -2, bonusType: "untyped" }, { kind: "modifier", target: "damage.melee", value: 6, bonusType: "untyped" }] },
  ],
};

function advancementSlots(trackEntries: Record<string, string[]>): AdvancementSlot[] {
  const slotCount = Math.max(...Object.values(trackEntries).map((entries) => entries.length));
  return Array.from({ length: slotCount }, (_, slotIndex) => ({
    id: `level-${slotIndex + 1}`,
    tracks: Object.entries(trackEntries).map(([id, entries]) => ({ id, entry: { progressionId: entries[slotIndex] ?? entries[entries.length - 1]! } })),
  }));
}

function advancementCharacter(trackEntries: Record<string, string[]>): CharacterInput {
  return {
    ...fixture,
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    baseHpBeforeConstitution: 30,
    baseAbilities: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    advancementSlots: advancementSlots(trackEntries),
    features: [],
    skillRanks: {},
    skills: undefined,
  };
}

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
  it("applies the Constitution modifier once per explicit hit die", () => {
    const threeHitDice = { ...fixture, hitDiceCount: 3 };
    const before = new RulesEngine(threeHitDice).derive();
    const changed = { ...threeHitDice, baseAbilities: { ...threeHitDice.baseAbilities, con: 18 } };
    const after = new RulesEngine(changed).derive();
    expect(before.maxHp.value).toBe(56);
    expect(after.maxHp.value).toBe(62);
    expect(after.maxHp.value - before.maxHp.value).toBe(6);
    expect(after.maxHp.contributions.find((item) => item.source === "ability.con.modifier")?.label).toBe("3× CON modifier");
  });
  it("derives current HP from damage taken when Constitution changes max HP", () => {
    const character = { ...fixture, temporaryHp: 7 };
    const before = new RulesEngine(character).derive();
    const raging = { ...character, features: character.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature) };
    const after = new RulesEngine(raging).derive();
    expect(before.currentHp).toBe(47);
    expect(before.temporaryHp).toBe(7);
    expect(after.currentHp).toBe(49);
    expect(after.damageTaken).toBe(5);
    expect(after.temporaryHp).toBe(7);
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
    const replacementFeature = { id: "manual-strength", name: "Manual strength baseline", enabled: true, effects: [{ kind: "replaceBase", target: "ability.str", value: 18, source: { id: "manual-strength", label: "Manual strength baseline" } }] } satisfies CharacterInput["features"][number];
    const raging = { ...fixture, baseAbilities: { ...fixture.baseAbilities, str: 10 }, features: [...fixture.features.map((feature) => feature.id === "rage" ? { ...feature, enabled: true } : feature), replacementFeature] };
    const derived = new RulesEngine(raging).derive();
    expect(derived.abilities.str.score.value).toBe(22); // Set 18 + Rage 4, not authored 10 + Set 18 + Rage 4.
    expect(derived.attacks[0]?.attack.value).toBe(13);
    expect(derived.abilities.str.score.contributions.map((item) => item.source)).toContain("manual-strength");
    expect(derived.abilities.str.score.contributions.map((item) => item.source)).not.toContain("base-ability");
  });
  it("rejects competing active baseline replacements instead of using feature order", () => {
    const replacementEffects: Effect[] = [
      { kind: "replaceBase", target: "save.fortitude", value: 10, source: { id: "save-baseline", label: "Save baseline" } },
      { kind: "replaceBase", target: "hp", value: 40, source: { id: "hp-baseline", label: "HP baseline" } },
      { kind: "replaceBase", target: "speed.land", value: 40, source: { id: "speed-baseline", label: "Speed baseline" } },
      { kind: "replaceBase", target: "speed.land", value: 35, source: { id: "later-speed-baseline", label: "Later speed baseline" } },
    ];
    const character = { ...fixture, features: [{ id: "baselines", name: "Authored baselines", enabled: true, effects: replacementEffects }] };
    expect(() => new RulesEngine(character).derive()).toThrow("Ambiguous active baseline replacements for speed.land");
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
        { kind: "replaceBase", target: "ac.natural", value: 4, source: { id: "natural", label: "Natural armor baseline" } },
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

describe("declarative advancement", () => {
  it("derives an ordinary Fighter track and exposes its baseline provenance", () => {
    const derived = new RulesEngine(advancementCharacter({ martial: ["fighter", "fighter", "fighter"] })).derive();
    expect(derived.advancement).toMatchObject({ slotCount: 3, trackIds: ["martial"], hitDiceCount: 3, hitDieSides: [10, 10, 10], skillPoints: 6 });
    expect(derived.attacks[0]?.attack.value).toBe(3);
    expect(derived.saves.fortitude.value).toBe(5); // good Fort +3, CON +2
    expect(derived.saves.reflex.value).toBe(3); // poor Reflex +1, DEX +2
    expect(derived.maxHp.value).toBe(36); // manual HP baseline 30 + CON +2 × 3 HD
    const bab = derived.attacks[0]?.attack.contributions.find((item) => item.source === "advancement.track.martial.bab");
    expect(bab?.value).toBe(3);
    expect(bab?.note).toContain("complete advancement-track");
  });

  it("supports multiclass progression on one track", () => {
    const derived = new RulesEngine(advancementCharacter({ main: ["fighter", "fighter", "rogue"] })).derive();
    expect(derived.attacks[0]?.attack.value).toBe(2); // Fighter +2; Rogue level 1 adds 0 BAB.
    expect(derived.saves.fortitude.value).toBe(5); // Fighter good Fort +3 plus CON +2.
    expect(derived.saves.reflex.value).toBe(4); // Rogue level 1 good Reflex +2 plus DEX +2.
    expect(derived.advancement?.hitDieSides).toEqual([10, 10, 8]);
  });

  it("uses explicit gestalt aggregation rules across two tracks", () => {
    const derived = new RulesEngine(advancementCharacter({ martial: ["fighter", "fighter", "fighter"], arcane: ["wizard", "wizard", "wizard"] })).derive();
    expect(derived.attacks[0]?.attack.value).toBe(3); // Best complete BAB track: Fighter 3, not a per-slot sum.
    expect(derived.saves.fortitude.value).toBe(5); // Fighter good Fort +3 + CON 2.
    expect(derived.saves.will.value).toBe(3); // Wizard good Will +3 + WIS 0.
    expect(derived.advancement).toMatchObject({ slotCount: 3, trackIds: ["martial", "arcane"], hitDiceCount: 3, hitDieSides: [10, 10, 10] });
    expect(derived.maxHp.value).toBe(36); // One best HD per slot, not six HD.
  });

  it("does not maximize BAB independently per slot", () => {
    const staggeredGestaltFixture = advancementCharacter({ first: ["fighter", "wizard", "wizard", "wizard"], second: ["wizard", "fighter", "fighter", "fighter"] });
    const derived = new RulesEngine(staggeredGestaltFixture).derive();
    expect(derived.attacks[0]?.attack.value).toBe(3); // Track totals are 2 and 3; per-slot maximization would incorrectly produce 4.
    const bab = derived.attacks[0]?.attack.contributions.find((item) => item.source.includes(".bab"));
    expect(bab?.source).toBe("advancement.track.second.bab");
    expect(bab?.children?.map((item) => item.value)).toEqual([2, 3]);
  });

  it("supports an arbitrary three-track representation without a gestalt special case", () => {
    const derived = new RulesEngine(advancementCharacter({ martial: ["fighter", "fighter"], arcane: ["wizard", "wizard"], scout: ["rogue", "rogue"] })).derive();
    expect(derived.advancement?.trackIds).toEqual(["martial", "arcane", "scout"]);
    expect(derived.attacks[0]?.attack.value).toBe(2);
    expect(derived.advancement?.hitDieSides).toEqual([10, 10]);
  });

  it("keeps feature effects and roll plans on the same advancement-derived baseline", () => {
    const character = advancementCharacter({ martial: ["fighter", "fighter"] });
    character.features = [{ id: "focus", name: "Focus", enabled: true, effects: [
      { kind: "modifier", target: "attack.melee", value: 1, bonusType: "untyped" },
      { kind: "modifier", target: "save.fortitude", value: 2, bonusType: "morale" },
    ] }];
    const engine = new RulesEngine(character);
    const derived = engine.derive();
    expect(derived.attacks[0]?.attack.value).toBe(3); // BAB 2 + STR 0 + feature 1
    expect(derived.saves.fortitude.value).toBe(7); // Fighter good Fort 3 + CON 2 + feature 2
    expect(engine.createAttackRollPlan("greatsword").modifier).toBe(derived.attacks[0]?.attack.value);
    expect(engine.createSaveRollPlan("fortitude").modifier).toBe(derived.saves.fortitude.value);
  });
});

function evaluateCharacterForTest(input: CharacterInput) { return new RulesEngine(input).derive(); }
