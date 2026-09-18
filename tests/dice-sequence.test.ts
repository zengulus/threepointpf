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
  combineDurationMs,
  diceSum,
  dieAnchorOffset,
  faceTokens,
  revealedAt,
  riseDurationMs,
  rollSequenceTimeline,
  sequencePhases,
  type SequenceStage,
} from "../apps/web/src/lib/dice-sequence";

/**
 * The result sequence is presentation arithmetic: which face belongs to which
 * die, which beat is revealed when, and where a value has to be drawn to sit
 * over its die. None of it is a game fact, and none of it reads a value from the
 * renderer — the faces always come from the resolution.
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
    expect(revealedAt("pending", "rise")).toBe(false);
    expect(revealedAt("pending", "total")).toBe(false);
    expect(revealedAt("die", "rise")).toBe(false);
    expect(revealedAt("rise", "combine")).toBe(false);
    expect(revealedAt("settled", "outcome")).toBe(true);
    expect(revealedAt("settled", "rise")).toBe(true);
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
      "combine",
      "sum",
      "modifier",
      "total",
      "outcome",
    ]);
    expect(rollSequenceTimeline({ sum: false, modifier: true }).map((step) => step.phase)).toEqual([
      "combine",
      "modifier",
      "total",
      "outcome",
    ]);
    expect(rollSequenceTimeline({ sum: false, modifier: false }).map((step) => step.phase)).toEqual([
      "combine",
      "total",
      "outcome",
    ]);
  });

  it("runs the beats in order, after the rise, never overlapping", () => {
    const steps = rollSequenceTimeline({ sum: true, modifier: true });
    expect(steps[0]!.delay).toBe(riseDurationMs);
    expect(steps[0]!.delay).toBeGreaterThan(0);
    const delays = steps.map((step) => step.delay);
    expect([...delays].sort((left, right) => left - right)).toEqual(delays);
    for (const step of steps)
      expect(sequencePhases.indexOf(step.phase)).toBeGreaterThan(
        sequencePhases.indexOf("rise"),
      );
    // The sum has to be readable before the modifier is applied to it.
    expect(steps[1]!.delay).toBeGreaterThanOrEqual(riseDurationMs + combineDurationMs);
  });
});

describe("anchoring a value to the die it was rolled on", () => {
  it("centres a chip on the die's point on the stage", () => {
    const stage = { left: 0, top: 0, width: 400, height: 300 };
    expect(
      dieAnchorOffset({ x: 0.5, y: 0.5 }, { left: 180, top: 140, width: 40, height: 24 }, stage),
    ).toEqual({ x: 0, y: -2 });
  });

  it("accounts for a stage that is not at the origin", () => {
    const stage = { left: 40, top: 20, width: 200, height: 100 };
    expect(
      dieAnchorOffset({ x: 0.25, y: 0.75 }, { left: 0, top: 0, width: 20, height: 10 }, stage),
    ).toEqual({ x: 80, y: 90 });
  });

  it("moves the chip rather than the arithmetic", () => {
    // A chip already at the die's point needs no movement at all, so the offset
    // is what carries the value away from its layout slot.
    const stage = { left: 0, top: 0, width: 100, height: 100 };
    expect(
      dieAnchorOffset({ x: 0, y: 0 }, { left: -10, top: -5, width: 20, height: 10 }, stage),
    ).toEqual({ x: 0, y: 0 });
  });
});
