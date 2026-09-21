import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type {
  AttackDefinition,
  CharacterInput,
  RollPlan,
} from "@threepointpf/rules-schema";
import { classifyRollPresentation, resolveRollPlan } from "@threepointpf/dice";
import {
  diceSum,
  faceTokens,
  landedFaceHoldMs,
  revealedAt,
  rollSequenceTimeline,
  sequencePhases,
  valuesBeatMs,
  type SequenceStage,
} from "../apps/web/src/lib/dice-sequence";

/**
 * The result sequence is presentation arithmetic: which face belongs to which
 * die and which beat of the derivation is revealed when. None of it is a game
 * fact, and none of it reads a value from the renderer — the faces always come
 * from the resolution. The die-local phase is not here at all: it is the
 * renderer's own scene, and this module only owns the handoff that follows it.
 */

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "sequence",
    name: "Sequence Test",
    baseAbilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 2,
    skillRanks: {},
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...overrides,
  };
}

const blade: AttackDefinition = {
  id: "blade",
  name: "Blade",
  attackAbility: "str",
  damageAbility: "str",
  baseDamage: { count: 2, sides: 6 },
  attackTags: ["weapon.melee"],
};

const engine = () => new RulesEngine(homebrew({ attacks: [blade] }), rulesCatalogs);

/** A frozen roll, the way the hook hands one to the overlay. */
function stageFor(plan: RollPlan, faces: number[]): SequenceStage {
  const resolved = resolveRollPlan(plan, faces);
  return {
    id: 1,
    plan,
    resolved,
    presentation: classifyRollPresentation(plan, resolved.outcome),
  };
}

describe("the values shown are the resolved faces, per die", () => {
  it("flattens the plan's dice in declaration order", () => {
    const plan = engine().createAttackRollPlan("blade", 0);
    const multi: RollPlan = {
      ...plan,
      dice: [
        { count: 1, sides: 20 },
        { count: 2, sides: 6 },
      ],
      primaryCheckDie: { group: 0, index: 0, sides: 20 },
    };
    const tokens = faceTokens(stageFor(multi, [17, 4, 3]));
    expect(tokens.map((token) => token.value)).toEqual([17, 4, 3]);
    expect(tokens.map((token) => token.sides)).toEqual([20, 6, 6]);
    expect(tokens.map((token) => token.index)).toEqual([0, 1, 2]);
    // Only the declared check die carries natural-face semantics.
    expect(tokens.map((token) => token.natural)).toEqual([true, false, false]);
  });

  it("gives a plain damage roll no natural face even on a d20", () => {
    const damage = engine().createDamageRollPlan("blade");
    const tokens = faceTokens(stageFor(damage, [4, 3]));
    expect(tokens.map((token) => token.value)).toEqual([4, 3]);
    expect(tokens.some((token) => token.natural)).toBe(false);
    expect(diceSum(tokens)).toBe(7);
  });

  it("declares the check die anywhere in the plan, not just first", () => {
    const plan = engine().createAttackRollPlan("blade", 0);
    const checkSecond: RollPlan = {
      ...plan,
      dice: [
        { count: 2, sides: 6 },
        { count: 1, sides: 20 },
      ],
      primaryCheckDie: { group: 1, index: 0, sides: 20 },
    };
    const tokens = faceTokens(stageFor(checkSecond, [4, 3, 20]));
    expect(tokens.map((token) => token.natural)).toEqual([false, false, true]);
  });
});

describe("the beats of the sequence", () => {
  it("reveals nothing before the dice land, and everything when settled", () => {
    expect(revealedAt("pending", "values")).toBe(false);
    expect(revealedAt("pending", "total")).toBe(false);
    // Landed faces get a reading beat before a value plaque leaves the die.
    expect(revealedAt("landed", "values")).toBe(false);
    expect(revealedAt("landed", "outcome")).toBe(false);
    // While the values are on their dice nothing is in the document at all.
    expect(revealedAt("scene", "values")).toBe(false);
    expect(revealedAt("scene", "outcome")).toBe(false);
    // The handoff shows the values; the arithmetic follows from there.
    expect(revealedAt("values", "values")).toBe(true);
    expect(revealedAt("values", "sum")).toBe(false);
    expect(revealedAt("values", "total")).toBe(false);
    expect(revealedAt("settled", "outcome")).toBe(true);
    expect(revealedAt("settled", "values")).toBe(true);
  });

  it("holds landed faces before the die-local handoff and arithmetic", () => {
    expect(landedFaceHoldMs).toBeGreaterThan(0);
    expect(sequencePhases.indexOf("landed")).toBeLessThan(
      sequencePhases.indexOf("scene"),
    );
    // The order is the choreography: readable face, on-die value, then drawer.
    expect(sequencePhases.indexOf("scene")).toBeLessThan(
      sequencePhases.indexOf("values"),
    );
    for (const beat of ["sum", "modifier", "total", "outcome"] as const)
      expect(sequencePhases.indexOf("values")).toBeLessThan(
        sequencePhases.indexOf(beat),
      );
    expect(sequencePhases.indexOf("total")).toBeLessThan(
      sequencePhases.indexOf("outcome"),
    );
  });

  it("keeps every revealed beat revealed", () => {
    for (const phase of sequencePhases) {
      const index = sequencePhases.indexOf(phase);
      for (const at of sequencePhases) {
        if (sequencePhases.indexOf(at) <= index && phase !== "settled")
          expect(revealedAt(phase, at)).toBe(true);
      }
    }
  });

  it("schedules the sum only when a modifier follows it", () => {
    expect(rollSequenceTimeline({ sum: true, modifier: true }).map((step) => step.phase)).toEqual([
      "sum",
      "modifier",
      "total",
      "outcome",
    ]);
    expect(rollSequenceTimeline({ sum: false, modifier: true }).map((step) => step.phase)).toEqual([
      "modifier",
      "total",
      "outcome",
    ]);
    expect(rollSequenceTimeline({ sum: false, modifier: false }).map((step) => step.phase)).toEqual([
      "total",
      "outcome",
    ]);
  });

  it("runs the beats in order, after the handoff, never overlapping", () => {
    const steps = rollSequenceTimeline({ sum: true, modifier: true });
    expect(steps[0]!.delay).toBe(valuesBeatMs);
    expect(steps[0]!.delay).toBeGreaterThan(0);
    const delays = steps.map((step) => step.delay);
    expect([...delays].sort((left, right) => left - right)).toEqual(delays);
    for (const step of steps)
      expect(sequencePhases.indexOf(step.phase)).toBeGreaterThan(
        sequencePhases.indexOf("values"),
      );
    // The sum has to be readable before the modifier is applied to it.
    expect(steps[1]!.delay).toBeGreaterThanOrEqual(valuesBeatMs);
  });

  it("always ends on the semantic outcome", () => {
    for (const sum of [true, false])
      for (const modifier of [true, false]) {
        const steps = rollSequenceTimeline({ sum, modifier });
        expect(steps.at(-1)!.phase).toBe("outcome");
        expect(steps.map((step) => step.phase)).toContain("total");
      }
  });
});
