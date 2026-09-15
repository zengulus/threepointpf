import { describe, expect, it } from "vitest";
import { resolveRollPlan, validateFaces } from "./index.js";

describe("roll plans", () => {
  const plan = { id: "attack:test:greatsword", characterId: "test", label: "Greatsword attack", dice: [{ sides: 20, count: 1 }], modifier: 11 };
  it("resolves raw faces without applying rules in the client", () => expect(resolveRollPlan(plan, [17]).total).toBe(28));
  it("rejects impossible raw faces", () => expect(() => validateFaces(plan, [21])).toThrow());
  it("rejects a missing physical die result", () => expect(() => resolveRollPlan(plan, [])).toThrow());
});
