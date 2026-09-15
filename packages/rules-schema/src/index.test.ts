import { describe, expect, it } from "vitest";
import { attackDefinitionSchema, effectSchema, isTargetId } from "./index.js";

describe("runtime rules schemas", () => {
  it("accepts stable built-in and dynamic skill target ids", () => { expect(isTargetId("attack.melee")).toBe(true); expect(isTargetId("skill.knowledge-local")).toBe(true); });
  it("rejects unknown effect target ids", () => expect(() => effectSchema.parse({ kind: "modifier", target: "Strength", value: 4, bonusType: "morale" })).toThrow());
  it("keeps Set and Grant distinct from numeric modifiers", () => {
    expect(effectSchema.parse({ kind: "set", target: "speed.land", value: 40 })).toMatchObject({ kind: "set", target: "speed.land" });
    expect(effectSchema.parse({ kind: "grant", target: "casterLevel", grant: "spellcasting.slot" })).toMatchObject({ kind: "grant", target: "casterLevel" });
  });
  it("rejects free-form attack tags", () => expect(() => attackDefinitionSchema.parse({ id: "weapon", name: "Weapon", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, attackTags: ["adds-a-bonus"] })).toThrow());
});
