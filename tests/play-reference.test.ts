import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { abilityIds, parseCharacterInput, saveIds, type CharacterInput } from "@threepointpf/rules-schema";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import { demoCharacter } from "../apps/web/src/lib/demo-character";
import { exportPlayReference as exportEngineReference, playReferenceFilename, referenceRollFormula, referenceDamageFormula } from "../apps/web/src/lib/play-reference";

function exportPlayReference(character: CharacterInput, options: Parameters<typeof exportEngineReference>[1] = {}) {
  return exportEngineReference(new RulesEngine(character, rulesCatalogs), options);
}

const exportedAt = new Date("2026-10-13T05:00:00Z");
describe("manual play reference", () => {
  it("retains controller-prepared penalties from the actual sheet engine", () => {
    const base = new RulesEngine(levelOneFighter, rulesCatalogs);
    const prepared = new RulesEngine({ ...levelOneFighter, features: [...levelOneFighter.features, {
      id: "autosheet-unchained-wounds", name: "Unchained Wound System", enabled: true, effects: [
        { kind: "modifier", target: "save.fortitude", value: -2, bonusType: "penalty" },
        { kind: "modifier", target: "ac", value: -2, bonusType: "penalty", appliesTo: ["normal", "touch", "flatFooted"] },
      ],
    }] }, rulesCatalogs);
    const text = exportEngineReference(prepared, { exportedAt });
    expect(prepared.derive().ac.value).toBe(base.derive().ac.value - 2);
    expect(text).toContain(`AC: ${prepared.derive().ac.value};`);
    expect(text).toContain(`Fortitude save: ${referenceRollFormula(prepared.createSaveRollPlan("fortitude"))}`);
    expect(text).toContain("Unchained Wound System");
  });

  it("keeps typed damage dice and flat bonuses separate without counting flat bonuses twice", () => {
    const engine = new RulesEngine({ ...demoCharacter, features: [...demoCharacter.features, {
      id: "flaming", name: "Flaming", enabled: true, effects: [
        { kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 6 }, damageType: "fire" },
        { kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 4 }, damageType: "fire" },
        { kind: "modifier", target: "damage.melee", value: 2, bonusType: "untyped", damageType: "fire" },
      ],
    }] }, rulesCatalogs);
    const plan = engine.createDamageRollPlan("greatsword", { action: "standardAttack" });
    const formula = referenceDamageFormula(plan);
    expect(formula).toContain("2d6 (Greatsword) + 1d6 (fire) + 1d4 (fire) + 2 (fire)");
    expect(formula).toContain(`+ ${plan.modifier - 2} (untyped)`);
    expect(formula.match(/2 \(fire\)/g)).toHaveLength(1);
    expect(exportEngineReference(engine, { exportedAt })).toContain(`damage ${formula}`);
  });
  it("uses the current engine values without changing or exporting private authored state", () => {
    const character = parseCharacterInput({ ...structuredClone(demoCharacter), name: "My current hero", damageTaken: 17, temporaryHp: 4,
      record: { story: { notes: "PRIVATE NOTES DO NOT EXPORT" }, savingThrowNotes: "PRIVATE REMINDER" },
      resources: [{ id: "fury", name: "Fury", maximum: { kind: "fixed", value: 4 }, refresh: { kind: "daily" } }],
      resourceStates: [{ resourceId: "fury", spent: 2 }],
    });
    const before = JSON.stringify(character), engine = new RulesEngine(character, rulesCatalogs), derived = engine.derive();
    const text = exportPlayReference(character, { exportedAt, unsaved: true });
    expect(text).toContain("My current hero | 3.PF play reference");
    expect(text).toContain(exportedAt.toISOString());
    expect(text).toContain("Includes unsaved sheet edits");
    expect(text).toContain(`HP: ${derived.currentHp}/${derived.maxHp.value}; temporary HP: 4`);
    expect(text).toContain(`AC: ${derived.ac.value}; touch: ${derived.touchAc.value}`);
    expect(text).toContain(`Initiative: ${referenceRollFormula(engine.createInitiativeRollPlan())}`);
    for (const id of saveIds) expect(text).toContain(`${engine.createSaveRollPlan(id).label}: ${referenceRollFormula(engine.createSaveRollPlan(id))}`);
    for (const id of abilityIds) expect(text).toContain(`${id.toUpperCase()}: ${derived.abilities[id].score.value}`);
    expect(text).toContain("Fury: 2/4 remaining");
    expect(text).toContain("Heroism"); expect(text).not.toContain("Rage");
    expect(text).not.toContain("PRIVATE"); expect(text).not.toContain(character.campaignId);
    expect(text).not.toContain(character.id); expect(JSON.stringify(character)).toBe(before);
  });

  it("preserves full-attack step order and each engine-provided damage formula", () => {
    const engine = new RulesEngine(demoCharacter, rulesCatalogs);
    const text = exportPlayReference(demoCharacter, { exportedAt });
    const steps = engine.createActionPlan({ action: "fullAttack", attackIds: ["greatsword"] }).attacks[0]!.steps;
    expect(steps.length).toBeGreaterThan(1);
    let prior = text.indexOf("Full attack (this weapon only):");
    for (const [index, step] of steps.entries()) {
      const expected = `${index + 1}. ${referenceRollFormula(step.roll)}; damage ${referenceRollFormula(step.damage!)}`;
      const position = text.indexOf(expected, prior); expect(position).toBeGreaterThan(prior); prior = position;
    }
    expect(text).toContain("Do not combine these sequences");
    expect(text).toContain("critical damage, spells and abilities");
    expect(text).toContain("file does not sync");
  });

  it("marks trained-only skills unavailable without inventing a roll", () => {
    const character = parseCharacterInput({ ...levelOneFighter, skills: { ...levelOneFighter.skills, "secret-lore": { governingAbility: "int", trainedOnly: true } } });
    const text = exportPlayReference(character, { exportedAt });
    const skillLine = text.split("\n").find((value) => /secret.lore/i.test(value))!;
    expect(skillLine).toContain("unavailable"); expect(skillLine).toContain("1 rank"); expect(skillLine).not.toContain("1d20");
  });

  it("reports ineligible standard attacks while retaining the valid full attack", () => {
    const character = parseCharacterInput({ ...demoCharacter, attacks: [{ ...demoCharacter.attacks[0]!, fullAttackOnly: true }] });
    const text = exportPlayReference(character, { exportedAt });
    expect(text).toContain("Standard attack: unavailable (Greatsword can only be used in a full attack)");
    expect(text).toContain("Full attack (this weapon only):\n    1. 1d20");
  });

  it("handles no weapons, zero and negative modifiers, and non-total dice", () => {
    const text = exportPlayReference({ ...levelOneFighter, attacks: [], equipment: [] }, { exportedAt });
    expect(text).toContain("No weapon attacks configured."); expect(text).toContain("Snapshot of the current sheet.");
    const plan = new RulesEngine(levelOneFighter, rulesCatalogs).createInitiativeRollPlan();
    expect(referenceRollFormula({ ...plan, modifier: -3 })).toBe("1d20 - 3");
    expect(referenceRollFormula({ ...plan, modifier: 0 })).toBe("1d20");
    expect(referenceRollFormula({ ...plan, dice: [], modifier: 2 })).toBe("2");
    expect(referenceRollFormula({ ...plan, dice: [{ count: 2, sides: 6 }, { count: 1, sides: 4 }, { count: 1, sides: 100, addsToTotal: false }], modifier: 5 })).toBe("2d6 + 1d4 + 5");
  });

  it("sanitizes names and filenames and rejects invalid input rather than exporting stale values", () => {
    expect(exportPlayReference({ ...levelOneFighter, name: "Hero\nSecond line" }, { exportedAt }).split("\n")[0]).toBe("Hero Second line | 3.PF play reference");
    expect(playReferenceFilename("Éowyn / mage")).toBe("e-owyn-mage.threepointpf-play.txt");
    expect(playReferenceFilename(" / ")).toBe("character.threepointpf-play.txt");
    expect(() => exportPlayReference({ ...levelOneFighter, baseAbilities: { ...levelOneFighter.baseAbilities, str: NaN } })).toThrow();
  });
});
