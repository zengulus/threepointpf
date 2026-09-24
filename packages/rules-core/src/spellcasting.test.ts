import { describe, expect, it } from "vitest";
import type { CharacterInput, SpellCatalog, SpellcastingSource } from "@threepointpf/rules-schema";
import { castSpell, concentrationRollPlan, deriveSpellcastingSource, prepareSpells, refreshSpellcasting, RulesEngine } from "./index.js";

const spells: SpellCatalog = {
  "sample.burst": { id: "sample.burst", name: "Burst", description: "Scaling fire.", school: "evocation", levels: [{ spellListId: "arcane", level: 3 }], castingTime: { action: "standard" }, components: [], savingThrow: { save: "reflex", result: "half" }, execution: { damage: { dice: { count: 1, sides: 6 }, damageType: "fire", perCasterLevel: true, casterLevelCap: 10 } } },
  "sample.light": { id: "sample.light", name: "Light", description: "A small light.", school: "evocation", levels: [{ spellListId: "divine", level: 0 }], castingTime: { action: "standard" }, components: [], savingThrow: { result: "none" } },
  "sample.high": { id: "sample.high", name: "High Spell", description: "Too advanced.", school: "evocation", levels: [{ spellListId: "arcane", level: 4 }], castingTime: { action: "standard" }, components: [], savingThrow: { result: "none" } },
};

function source(changes: Partial<SpellcastingSource> = {}): SpellcastingSource {
  return { id: "arcane-source", name: "Arcane Casting", mode: "spontaneous", castingAbility: "int", spellListId: "arcane", spellListAccess: "list", bonusSlots: "none", progression: [
    { level: 0, casterLevel: 0, maximumSpellLevel: 0, slots: { "0": 0 } },
    { level: 5, casterLevel: 5, maximumSpellLevel: 3, slots: { "0": 4, "1": 4, "2": 3, "3": 2 }, spellsKnown: { "3": 2 } },
  ], knownSpellIds: ["sample.burst"], ...changes };
}
function character(changes: Partial<CharacterInput> = {}): CharacterInput {
  return { id: "caster", name: "Caster", baseAbilities: { str: 10, dex: 10, con: 10, int: 20, wis: 14, cha: 16 }, baseBab: 3, baseSaves: { fortitude: 1, reflex: 1, will: 3 }, baseHpBeforeConstitution: 10, hitDiceCount: 5, skillRanks: {}, attacks: [], features: [], damageTaken: 0, temporaryHp: 0, spellcastingSources: [source()], ...changes };
}

describe("spellcasting sources", () => {
  it("derives independent caster level, concentration, DC and level-indexed slot resources", () => {
    const engine = new RulesEngine(character());
    const casting = deriveSpellcastingSource(engine, source(), spells);
    expect(casting).toMatchObject({ casterLevel: { value: 5 }, concentration: { value: 10 } });
    expect(casting.saveDc(3)).toMatchObject({ value: 18 });
    expect(casting.saveDc(3).contributions.map((item) => item.label)).toEqual(["Base DC", "Spell level", "INT modifier"]);
    expect(casting.spellsKnown).toEqual([{ level: 3, capacity: 2 }]);
    expect(engine.derive().resources.find((resource) => resource.id === "spell.arcane-source.slot.3")).toMatchObject({ maximum: 2, remaining: 2 });
    expect(concentrationRollPlan(engine, "arcane-source", 15)).toMatchObject({ modifier: 10, primaryCheckDie: { group: 0, sides: 20 }, context: { action: { kind: "skillCheck" }, target: { defense: { kind: "dc", value: 15 } } } });
  });

  it("casts spontaneously atomically, scales damage to the caster-level cap and preserves expenditure", () => {
    const input = character({ resourceStates: [{ resourceId: "spell.arcane-source.slot.3", spent: 1 }] });
    const cast = castSpell(new RulesEngine(input), { sourceId: "arcane-source", spellId: "sample.burst" }, spells);
    expect(cast.accepted).toBe(true);
    if (!cast.accepted) return;
    expect(cast.execution.rollPlans[0]).toMatchObject({ dice: [{ count: 5, sides: 6 }], context: { spellId: "sample.burst" } });
    expect(cast.character.resourceStates).toContainEqual({ resourceId: "spell.arcane-source.slot.3", spent: 2 });
    const failed = castSpell(new RulesEngine(cast.character), { sourceId: "arcane-source", spellId: "sample.burst" }, spells);
    expect(failed).toMatchObject({ accepted: false, issues: [{ code: "no-slot" }] });
    expect(failed.character.resourceStates).toEqual(cast.character.resourceStates);
    expect(refreshSpellcasting(cast.character, "arcane-source").resourceStates).toContainEqual({ resourceId: "spell.arcane-source.slot.3", spent: 0, roundsUntilRefresh: undefined });
    expect(castSpell(new RulesEngine(input), { sourceId: "arcane-source", spellId: "not-a-spell" }, spells)).toMatchObject({ accepted: false, character: input, issues: [{ code: "unknown-spell" }] });
    const leveled = { ...cast.character, spellcastingSources: cast.character.spellcastingSources?.map((item) => item.id === "arcane-source" ? { ...item, progression: [...item.progression, { level: 6, casterLevel: 6, maximumSpellLevel: 3, slots: { "0": 4, "1": 4, "2": 3, "3": 4 } }], progressionLevel: 6 } : item) };
    expect(deriveSpellcastingSource(new RulesEngine(leveled), leveled.spellcastingSources![0]!, spells).slots.find((slot) => slot.level === 3)).toMatchObject({ capacity: 4, spent: 2, remaining: 2 });
  });

  it("keeps prepared copies independent and rejects an exhausted allocation", () => {
    const prepared = source({ mode: "prepared", knownSpellIds: undefined, spellbookSpellIds: ["sample.burst"], preparedSpells: [{ id: "copy-a", spellId: "sample.burst", spellLevel: 3 }, { id: "copy-b", spellId: "sample.burst", spellLevel: 3 }] });
    let input = character({ spellcastingSources: [prepared] });
    const first = castSpell(new RulesEngine(input), { sourceId: prepared.id, spellId: "sample.burst", preparedAllocationId: "copy-a" }, spells);
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    input = first.character;
    expect(input.spellcastingSources?.[0]?.preparedSpells).toMatchObject([{ id: "copy-a", expended: true }, { id: "copy-b" }]);
    expect(castSpell(new RulesEngine(input), { sourceId: prepared.id, spellId: "sample.burst", preparedAllocationId: "copy-a" }, spells)).toMatchObject({ accepted: false, issues: [{ code: "not-prepared" }] });
    expect(castSpell(new RulesEngine(input), { sourceId: prepared.id, spellId: "sample.burst", preparedAllocationId: "copy-b" }, spells).accepted).toBe(true);
    expect(prepareSpells(input, prepared.id, prepared.preparedSpells)).toMatchObject({ spellcastingSources: [{ preparedSpells: [{ expended: false }, { expended: false }] }] });
  });

  it("keeps multiple sources independent and uses their own spell list levels", () => {
    const divine = source({ id: "divine-source", name: "Divine", mode: "spontaneous", castingAbility: "wis", spellListId: "divine", progressionLevel: 2, knownSpellIds: ["sample.light"], progression: [{ level: 0, casterLevel: 0, maximumSpellLevel: 0, slots: {} }, { level: 2, casterLevel: 2, maximumSpellLevel: 1, slots: { "0": 3, "1": 2 } }] });
    const engine = new RulesEngine(character({ spellcastingSources: [source(), divine] }));
    expect(deriveSpellcastingSource(engine, source(), spells).casterLevel.value).toBe(5);
    expect(deriveSpellcastingSource(engine, divine, spells).casterLevel.value).toBe(2);
    expect(deriveSpellcastingSource(engine, divine, spells).saveDc(0).value).toBe(12);
    const rejected = castSpell(engine, { sourceId: "arcane-source", spellId: "sample.light" }, spells);
    expect(rejected).toMatchObject({ accepted: false });
    if (!rejected.accepted) expect(rejected.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["not-known", "wrong-list"]));
    const tooAdvanced = source({ knownSpellIds: ["sample.high"] });
    expect(castSpell(new RulesEngine(character({ spellcastingSources: [tooAdvanced] })), { sourceId: tooAdvanced.id, spellId: "sample.high" }, spells)).toMatchObject({ accepted: false, issues: expect.arrayContaining([expect.objectContaining({ code: "level-unavailable" })]) });
  });

  it("adds data-authored casting advancement globally across character tracks", () => {
    const progressionCatalog = {
      "pf1e.test.caster": { id: "pf1e.test.caster", name: "Custom Caster", hitDieSides: 8, babProgression: "half" as const, saveProgressions: { fortitude: "poor" as const, reflex: "poor" as const, will: "good" as const }, spellcastingAdvancement: [{ sourceId: "arcane-source", progressionId: "arcane-table", levels: 1 }] },
    };
    const slots = [1, 2].map((level) => ({ id: `level-${level}`, tracks: [{ id: "track-a", entry: { progressionId: "pf1e.test.caster" } }] }));
    const input = character({ baseBab: undefined, baseSaves: undefined, hitDiceCount: undefined, advancementSlots: slots, spellcastingSources: [source({ progressionId: "pf1e.test.caster", progressionLevel: undefined })] });
    const engine = new RulesEngine(input, { progressionCatalog });
    expect(deriveSpellcastingSource(engine, input.spellcastingSources![0]!, spells).progressionLevel).toBe(2);
  });

  it("uses a persisted lifecycle choice to advance one of two eligible sources", () => {
    const progressionCatalog = {
      "pf1e.test.arcane": { id: "pf1e.test.arcane", name: "Arcane Class", hitDieSides: 6, babProgression: "half" as const, saveProgressions: { fortitude: "poor" as const, reflex: "poor" as const, will: "good" as const }, spellcastingAdvancement: [{ sourceId: "arcane-source", progressionId: "arcane-table", levels: 1 }] },
      "pf1e.test.divine": { id: "pf1e.test.divine", name: "Divine Class", hitDieSides: 8, babProgression: "threeQuarters" as const, saveProgressions: { fortitude: "good" as const, reflex: "poor" as const, will: "good" as const }, spellcastingAdvancement: [{ sourceId: "divine-source", progressionId: "divine-table", levels: 1 }] },
      "pf1e.test.prestige": { id: "pf1e.test.prestige", name: "Dual Tradition", hitDieSides: 6, babProgression: "half" as const, saveProgressions: { fortitude: "poor" as const, reflex: "poor" as const, will: "good" as const }, features: [{ id: "casting", name: "Advance a tradition", level: 1, choices: [{ id: "advance", prompt: "Choose a casting source", minimum: 1, maximum: 1, options: [{ id: "arcane-source", name: "Arcane Casting" }, { id: "divine-source", name: "Divine Casting" }] }] }], spellcastingAdvancement: [{ progressionId: "selected-table", levels: 1, selection: "source" as const, choiceFeatureId: "casting", choiceRequirementId: "advance" }] },
      "pf1e.test.filler": { id: "pf1e.test.filler", name: "Filler", hitDieSides: 8, babProgression: "full" as const, saveProgressions: { fortitude: "good" as const, reflex: "poor" as const, will: "poor" as const } },
    };
    const advancementSlots = [
      { id: "level-1", tracks: [{ id: "arcane-track", entry: { progressionId: "pf1e.test.arcane" } }, { id: "divine-track", entry: { progressionId: "pf1e.test.divine" } }] },
      { id: "level-2", tracks: [{ id: "arcane-track", entry: { progressionId: "pf1e.test.prestige" } }, { id: "divine-track", entry: { progressionId: "pf1e.test.filler" } }] },
    ];
    const input = character({ baseBab: undefined, baseSaves: undefined, hitDiceCount: undefined, advancementSlots, spellcastingSources: [source(), source({ id: "divine-source", name: "Divine", castingAbility: "wis", spellListId: "divine", progression: source().progression.map((row) => ({ ...row, casterLevel: row.casterLevel, maximumSpellLevel: row.maximumSpellLevel })) })], lifecycle: { choiceSelections: [{ id: "prestige-source-choice", requirement: { progressionId: "pf1e.test.prestige", featureId: "casting", slotId: "level-2", trackId: "arcane-track", requirementId: "advance" }, optionIds: ["divine-source"] }] } });
    const engine = new RulesEngine(input, { progressionCatalog });
    expect(engine.spellcastingLevel("arcane-source")).toBe(1);
    expect(engine.spellcastingLevel("divine-source")).toBe(2);
  });

  it("applies source-scoped typed DC modifiers and caps scaling above caster level ten", () => {
    const enhanced = source({ progressionLevel: 12, progression: [{ level: 12, casterLevel: 12, maximumSpellLevel: 3, slots: { "3": 1 } }] });
    const input = character({ spellcastingSources: [enhanced], features: [{ id: "focus", name: "Focused spells", enabled: true, effects: [{ kind: "modifier", target: "spellcasting.arcane-source.dc.3", value: 2, bonusType: "untyped" }] }] });
    const engine = new RulesEngine(input);
    expect(deriveSpellcastingSource(engine, enhanced, spells).saveDc(3)).toMatchObject({ value: 20 });
    const cast = castSpell(engine, { sourceId: enhanced.id, spellId: "sample.burst" }, spells);
    expect(cast.accepted && cast.execution.rollPlans[0]?.dice).toEqual([{ count: 10, sides: 6 }]);
    const slotBonus = new RulesEngine(character({ features: [{ id: "bonus-slot", name: "Bonus Slot", enabled: true, effects: [{ kind: "modifier", target: "spellcasting.arcane-source.slot.3", value: 1, bonusType: "untyped" }] }] }));
    expect(slotBonus.derive().resources.find((resource) => resource.id === "spell.arcane-source.slot.3")).toMatchObject({ maximum: 3, remaining: 3 });
  });
});
