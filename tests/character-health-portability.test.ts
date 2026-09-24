import { describe, expect, it } from "vitest";
import { applyDamage, applyHealing, clearTemporaryHp, setTemporaryHp } from "@threepointpf/rules-core";
import { parseCharacterInput } from "@threepointpf/rules-schema";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { demoCharacter } from "../apps/web/src/lib/demo-character";
import { copyWithNewCharacterId, exportCharacterSnapshot, importCharacterSnapshot } from "../apps/web/src/lib/character-portability";

describe("persisted runtime health operations", () => {
  it("absorbs temporary HP before damage and allows negative HP", () => {
    const withTemp = setTemporaryHp(demoCharacter, 8);
    const damaged = applyDamage(withTemp, 12);
    expect(damaged).toMatchObject({ temporaryHp: 0, damageTaken: 9 });
    expect(damaged.baseHpBeforeConstitution - damaged.damageTaken).toBe(41);
    const overkill = applyDamage({ ...damaged, damageTaken: 60 }, 10);
    expect(overkill.damageTaken).toBe(70);
    expect(new RulesEngine(overkill, rulesCatalogs).derive().currentHp).toBeLessThan(0);
  });

  it("caps healing at full HP and clears temporary HP explicitly", () => {
    const hurt = { ...demoCharacter, damageTaken: 30, temporaryHp: 5 };
    expect(applyHealing(hurt, 10).damageTaken).toBe(20);
    expect(applyHealing(hurt, 100).damageTaken).toBe(0);
    expect(clearTemporaryHp(hurt).temporaryHp).toBe(0);
  });
});

describe("character portability", () => {
  it("round-trips canonical authored and runtime state", () => {
    const complicated = parseCharacterInput({
      ...demoCharacter,
      baseBab: undefined,
      baseSaves: undefined,
      hitDiceCount: undefined,
      baseHpBeforeConstitution: 30,
      advancementSlots: [1, 2, 3].map((level) => ({ id: `level-${level}`, tracks: [
        { id: "class", entry: { progressionId: "pf1e.paizo.fighter" } },
        { id: "monster", entry: { progressionId: "homebrew.test.ogre" } },
      ] })),
      equipment: [{ id: "ogre-boneplate", name: "Ogre boneplate", equipped: true, weight: 35, effects: [{ kind: "modifier", target: "ac", value: 5, bonusType: "armor", appliesTo: ["normal", "flatFooted"] }] }],
      resources: [{ id: "shared-resource", name: "Ogre fury", maximum: { kind: "fixed", value: 3 }, refresh: { kind: "daily" } }],
      spellcastingSources: [{ id: "wizard-track", name: "Wizard Casting", mode: "prepared", castingAbility: "int", progressionId: "pf1e.paizo.wizard", spellListId: "arcane", spellListAccess: "spellbook", bonusSlots: "none", progression: [{ level: 1, casterLevel: 1, maximumSpellLevel: 1, slots: { "1": 1 } }], spellbookSpellIds: ["local.test-spell"], preparedSpells: [{ id: "prepared-copy", spellId: "local.test-spell", spellLevel: 1, expended: true }] }],
      customSpells: { "local.test-spell": { id: "local.test-spell", name: "Local Spark", description: "A local spell.", school: "evocation", levels: [{ spellListId: "arcane", level: 1 }], castingTime: { action: "standard" }, components: [], savingThrow: { result: "none" }, source: { document: "Character content", sheet: "local spell", system: "homebrew" } } },
      resourceStates: [{ resourceId: "shared-resource", spent: 2 }, { resourceId: "spell.wizard-track.slot.1", spent: 1 }],
      abilities: [
        { id: "ogre-roar", name: "Ogre roar", activation: "passive", effects: [{ kind: "modifier", target: "skill.intimidate", value: 1, bonusType: "untyped" }] },
        { id: "ogre-fury", name: "Ogre fury", activation: "activated", effects: [], costs: [{ resourceId: "shared-resource", amount: 1, timing: "onUse" }] },
      ],
      lifecycle: {
        hpAcquisitions: [1, 2, 3].map((level) => ({ slotId: `level-${level}`, method: level === 1 ? "maximum" : "rolled", amount: 10 - level, source: { trackId: "monster", progressionId: "homebrew.test.ogre", sides: 12 } })),
        skillAllocations: [1, 2, 3].map((level) => ({ slotId: `level-${level}`, method: "manual", budget: 4, source: { trackId: "monster", progressionId: "homebrew.test.ogre", skillPoints: 4 }, ranks: { perception: 1 } })),
        choiceSelections: [{ id: "ogre-adaptation", requirement: { progressionId: "homebrew.test.ogre", featureId: "adaptation", slotId: "level-2", trackId: "monster", requirementId: "skin" }, optionIds: ["stone"], customOptions: [{ id: "custom-skin", name: "Ashen skin" }] }],
      },
      customProgressions: {
        "homebrew.test.ogre": { id: "homebrew.test.ogre", name: "Ogre progression", hitDieSides: 12, babProgression: "threeQuarters", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 4, features: [{ id: "adaptation", name: "Monster adaptation", level: 2, choices: [{ id: "skin", prompt: "Choose an adaptation", minimum: 1, maximum: 1, options: [{ id: "stone", name: "Stone hide" }], allowCustom: true }] }] },
      },
      campaignId: "gestalt-test",
      damageTaken: 17,
      temporaryHp: 4,
    });
    const imported = importCharacterSnapshot(exportCharacterSnapshot(complicated));
    expect(imported).toEqual(complicated);
    const before = new RulesEngine(complicated, rulesCatalogs).derive();
    const after = new RulesEngine(imported, rulesCatalogs).derive();
    expect(after.bab.value).toBe(before.bab.value);
    expect(after.maxHp.value).toBe(before.maxHp.value);
    expect(after.saves).toEqual(before.saves);
    const copied = copyWithNewCharacterId(imported);
    expect(copied.id).not.toBe(complicated.id);
    expect({ ...copied, id: complicated.id }).toEqual(complicated);
  });

  it("rejects malformed JSON, wrong format, future versions, and invalid characters", () => {
    expect(() => importCharacterSnapshot("{" )).toThrow("valid JSON");
    expect(() => importCharacterSnapshot(JSON.stringify({ format: "other", version: 1, character: demoCharacter }))).toThrow("not a valid");
    expect(() => importCharacterSnapshot(JSON.stringify({ format: "threepointpf-character", version: 9, character: demoCharacter }))).toThrow("Unsupported");
    expect(() => importCharacterSnapshot(JSON.stringify({ format: "threepointpf-character", version: 1, character: { id: "bad" } }))).toThrow();
    const missingCustom = { ...demoCharacter, baseBab: undefined, baseSaves: undefined, hitDiceCount: undefined, advancementSlots: [{ id: "slot-1", tracks: [{ id: "main", entry: { progressionId: "homebrew.test.missing" } }] }] };
    expect(() => importCharacterSnapshot(JSON.stringify({ format: "threepointpf-character", version: 1, character: missingCustom }))).toThrow(/progression|catalog|unknown/i);
  });
});
