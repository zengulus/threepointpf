import { describe, expect, it } from "vitest";
import type { RollOutcomePolicy } from "@threepointpf/rules-schema";
import type { RollPlan } from "./index.js";
import { resolveRollPlan, validateFaces } from "./index.js";
import contract from "../../../tests/fixtures/roll-contract.json";

const attackPolicy: RollOutcomePolicy = {
  id: "test.attack",
  kind: "attack",
  natural20: { automatic: true, classification: "natural20" },
  natural1: { automatic: true, classification: "criticalFailure" },
  criticalConfirmationRequired: false,
};

describe("roll plans", () => {
  const plan: RollPlan = {
    id: "attack:test:greatsword",
    characterId: "test",
    label: "Greatsword attack",
    dice: [{ sides: 20, count: 1 }],
    modifier: 11,
    context: {
      kind: "attack",
      actorCharacterId: "test",
      action: { kind: "standardAttack" },
      attackId: "greatsword",
    },
    outcomePolicy: attackPolicy,
    criticalRange: { minimumNaturalRoll: 20 },
  };
  it("resolves raw faces without applying rules in the client", () =>
    expect(resolveRollPlan(plan, [17]).total).toBe(28));
  it("rejects impossible raw faces", () =>
    expect(() => validateFaces(plan, [21])).toThrow());
  it("rejects a missing physical die result", () =>
    expect(() => resolveRollPlan(plan, [])).toThrow());
  it("matches the raw-face contract fixture", () =>
    expect(resolveRollPlan(contract.plan as RollPlan, contract.faces)).toMatchObject(
      contract.expected,
    ));
});
