import { describe, expect, it } from "vitest";
import { effectSchema, isTargetId } from "./index.js";

describe("runtime rules schemas", () => {
  it("accepts stable built-in and dynamic skill target ids", () => { expect(isTargetId("attack.melee")).toBe(true); expect(isTargetId("skill.knowledge-local")).toBe(true); });
  it("rejects unknown effect target ids", () => expect(() => effectSchema.parse({ kind: "modifier", target: "Strength", value: 4, bonusType: "morale" })).toThrow());
});
