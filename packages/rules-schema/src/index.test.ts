import { describe, expect, it } from "vitest";
import { advancementSlotsSchema, attackDefinitionSchema, characterInputSchema, effectSchema, isTargetId, progressionCatalogSchema } from "./index.js";

describe("runtime rules schemas", () => {
  it("accepts stable built-in and dynamic skill/progression target ids", () => { expect(isTargetId("attack.melee")).toBe(true); expect(isTargetId("combat.bab")).toBe(true); expect(isTargetId("skill.knowledge-local")).toBe(true); expect(isTargetId("progression.fighter.level")).toBe(true); });
  it("rejects unknown effect target ids", () => expect(() => effectSchema.parse({ kind: "modifier", target: "Strength", value: 4, bonusType: "morale" })).toThrow());
  it("keeps progression-level facts query-only", () => expect(() => effectSchema.parse({ kind: "modifier", target: "progression.fighter.level", value: 1, bonusType: "untyped" })).toThrow(/query-only/));
  it("keeps baseline replacement and Grant distinct from numeric modifiers", () => {
    expect(effectSchema.parse({ kind: "replaceBase", target: "speed.land", value: 40 })).toMatchObject({ kind: "replaceBase", target: "speed.land" });
    expect(effectSchema.parse({ kind: "grant", target: "casterLevel", grant: "spellcasting.slot" })).toMatchObject({ kind: "grant", target: "casterLevel" });
  });
  it("requires explicit applicability for generic AC modifiers", () => {
    expect(() => effectSchema.parse({ kind: "modifier", target: "ac", value: 1, bonusType: "dodge" })).toThrow();
    expect(effectSchema.parse({ kind: "modifier", target: "ac", value: 1, bonusType: "dodge", appliesTo: ["normal", "touch"] })).toMatchObject({ target: "ac", appliesTo: ["normal", "touch"] });
  });
  it("rejects competing active baseline replacements", () => {
    expect(() => characterInputSchema.parse({
      id: "ambiguous", name: "Ambiguous", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseBab: 0,
      baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 8, hitDiceCount: 1, skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0,
      features: [{ id: "a", name: "A", enabled: true, effects: [{ kind: "replaceBase", target: "ac", value: 10 }] }, { id: "b", name: "B", enabled: true, effects: [{ kind: "replaceBase", target: "ac", value: 12 }] }],
    })).toThrow(/Ambiguous active baseline replacements/);
  });
  it("allows advancement mode to replace manual BAB, save, and hit-die baselines", () => {
    expect(characterInputSchema.parse({
      id: "fighter", name: "Fighter", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseHpBeforeConstitution: 10,
      skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0,
      advancementSlots: [{ id: "level-1", tracks: [{ id: "main", entry: { progressionId: "fighter" } }] }], features: [],
    }).advancementSlots).toHaveLength(1);
  });
  it("rejects ambiguous manual baselines and malformed N-track topology in advancement mode", () => {
    const shared = { id: "advanced", name: "Advanced", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseHpBeforeConstitution: 10, skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0, features: [] };
    expect(() => characterInputSchema.parse({ ...shared, baseBab: 1, advancementSlots: [{ id: "level-1", tracks: [{ id: "first", entry: { progressionId: "fighter" } }] }] })).toThrow(/baseBab must be omitted/);
    expect(() => advancementSlotsSchema.parse([
      { id: "level-1", tracks: [{ id: "first", entry: { progressionId: "fighter" } }, { id: "second", entry: { progressionId: "wizard" } }] },
      { id: "level-1", tracks: [{ id: "second", entry: { progressionId: "wizard" } }, { id: "first", entry: { progressionId: "fighter" } }] },
    ])).toThrow(/Duplicate advancement slot id|same ordered track ids/);
  });
  it("validates catalog keys and optional chart rows before rules evaluation", () => {
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "not-fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" } } })).toThrow(/Catalog key/);
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, chart: [{ level: 1, bab: 1, saves: { fortitude: 2, reflex: 0, will: 0 } }, { level: 1, bab: 1, saves: { fortitude: 2, reflex: 0, will: 0 } }] } })).toThrow(/Duplicate chart level/);
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2.5 } })).toThrow();
  });
  it("rejects free-form attack tags", () => expect(() => attackDefinitionSchema.parse({ id: "weapon", name: "Weapon", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, attackTags: ["adds-a-bonus"] })).toThrow());
});
