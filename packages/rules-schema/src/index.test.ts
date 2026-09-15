import { describe, expect, it } from "vitest";
import { attackDefinitionSchema, characterInputSchema, effectSchema, isTargetId } from "./index.js";

describe("runtime rules schemas", () => {
  it("accepts stable built-in and dynamic skill target ids", () => { expect(isTargetId("attack.melee")).toBe(true); expect(isTargetId("skill.knowledge-local")).toBe(true); });
  it("rejects unknown effect target ids", () => expect(() => effectSchema.parse({ kind: "modifier", target: "Strength", value: 4, bonusType: "morale" })).toThrow());
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
  it("rejects free-form attack tags", () => expect(() => attackDefinitionSchema.parse({ id: "weapon", name: "Weapon", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, attackTags: ["adds-a-bonus"] })).toThrow());
});
