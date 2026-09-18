import type { ResolvedRoll, RollPresentation } from "@threepointpf/dice";
import type { RollPlan } from "@threepointpf/rules-schema";

/**
 * The result sequence a landed roll plays: which value belongs to which die,
 * which beat of the arithmetic is revealed when, and where a value has to be
 * drawn to sit over the die it was rolled on.
 *
 * It is pure presentation arithmetic with no DOM, no timers and no renderer in
 * it, so the choreography can be checked directly. The values themselves are
 * always the authoritative `ResolvedRoll` faces; only positions and timing come
 * from anywhere else.
 */

/** One resolved roll, frozen for presentation. */
export interface SequenceStage {
  id: number;
  plan: RollPlan;
  resolved: ResolvedRoll;
  presentation: RollPresentation;
}

/** The global face index of the declared primary check die, or -1. */
export function naturalFaceIndex(plan: RollPlan): number {
  const die = plan.primaryCheckDie;
  if (!die) return -1;
  let offset = 0;
  for (let index = 0; index < die.group; index += 1)
    offset += plan.dice[index]?.count ?? 0;
  return offset + (die.index ?? 0);
}

/** One authoritative face, and the die it was rolled on. */
export interface FaceToken {
  /** Flattened face index in the plan's dice order — the order resolution used. */
  index: number;
  value: number;
  sides: number;
  /** True for the plan's declared check die, when it has one. */
  natural: boolean;
}

/**
 * The authoritative faces, in the flattened order resolution used them. The
 * values come from the resolution, never from the renderer: only the position a
 * value is drawn at may come from physics.
 */
export function faceTokens(stage: SequenceStage): FaceToken[] {
  const { plan, resolved } = stage;
  const natural = naturalFaceIndex(plan);
  const tokens: FaceToken[] = [];
  for (const group of plan.dice) {
    for (let within = 0; within < group.count; within += 1) {
      const index = tokens.length;
      tokens.push({
        index,
        value: resolved.faces[index] ?? 0,
        sides: group.sides,
        natural: index === natural,
      });
    }
  }
  return tokens;
}

/** The dice added together — the number a modifier is applied to. */
export function diceSum(tokens: readonly FaceToken[]): number {
  return tokens.reduce((total, token) => total + token.value, 0);
}

/**
 * The staged beats of the result sequence. `pending` shows nothing: the values
 * must not appear before the dice have landed. `settled` is the same sequence
 * with no movement — what reduced motion, and a renderer that cannot report die
 * positions, shows directly.
 */
export const sequencePhases = [
  "pending",
  "die",
  "rise",
  "combine",
  "sum",
  "modifier",
  "total",
  "outcome",
  "settled",
] as const;
export type SequencePhase = (typeof sequencePhases)[number];

/**
 * Whether the beat `at` has already happened. Every revealed beat stays
 * revealed, so the arithmetic reads as a growing derivation rather than a
 * flashing one.
 */
export function revealedAt(phase: SequencePhase, at: SequencePhase): boolean {
  if (phase === "settled") return true;
  return sequencePhases.indexOf(phase) >= sequencePhases.indexOf(at);
}

/**
 * Beat lengths, measured from the moment the dice settled. The values rise
 * first, then gather into the arithmetic, and each later term is revealed after
 * the one it depends on.
 */
export const riseDurationMs = 640;
export const combineDurationMs = 700;
export const revealDurationMs = 440;

export interface SequenceStep {
  phase: SequencePhase;
  delay: number;
}

/**
 * When each beat after the rise happens. Adding the dice together is its own
 * beat only when a modifier follows it; otherwise the total is the dice sum and
 * one term says both.
 */
export function rollSequenceTimeline(options: {
  sum: boolean;
  modifier: boolean;
}): SequenceStep[] {
  const steps: SequenceStep[] = [];
  let at = riseDurationMs;
  steps.push({ phase: "combine", delay: at });
  at += combineDurationMs;
  if (options.sum) {
    steps.push({ phase: "sum", delay: at });
    at += revealDurationMs;
  }
  if (options.modifier) {
    steps.push({ phase: "modifier", delay: at });
    at += revealDurationMs;
  }
  steps.push({ phase: "total", delay: at });
  at += revealDurationMs;
  steps.push({ phase: "outcome", delay: at });
  return steps;
}

/** A pixel translation that puts a value chip over the die it came from. */
export interface DieOffset {
  x: number;
  y: number;
}

/** The rectangle shape of a stage or a chip, as the DOM reports it. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a value chip has to be translated to sit over its die. The anchor is
 * normalized within the stage element, so it is turned back into a pixel point
 * before the chip's own (already laid out) rectangle is subtracted: the offset
 * moves the chip, the layout keeps the arithmetic in line.
 */
export function dieAnchorOffset(
  anchor: { x: number; y: number },
  chip: RectLike,
  stage: RectLike,
): DieOffset {
  return {
    x: stage.left + anchor.x * stage.width - (chip.left + chip.width / 2),
    y: stage.top + anchor.y * stage.height - (chip.top + chip.height / 2),
  };
}
