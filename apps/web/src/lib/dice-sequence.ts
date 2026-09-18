import type { ResolvedRoll, RollPresentation } from "@threepointpf/dice";
import type { RollPlan } from "@threepointpf/rules-schema";

/**
 * The result sequence a landed roll plays: which value belongs to which die and
 * which beat of the arithmetic is revealed when.
 *
 * It is pure presentation arithmetic with no DOM, no timers and no renderer in
 * it, so the choreography can be checked directly. The values themselves are
 * always the authoritative `ResolvedRoll` faces; only timing comes from here,
 * and the die-local motion is the renderer's own scene's business entirely.
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
 * The staged beats of the result sequence.
 *
 * - `pending` shows nothing: the values must not appear before the dice land.
 * - `scene` is the die-local half, which happens in the renderer's own scene:
 *   each value rises off the die it was rolled on, with the flourish emitted by
 *   that die. Nothing is in the document yet.
 * - `values` is the handoff, where the same authoritative values appear in the
 *   drawer's arithmetic and the later beats are revealed on that line.
 * - `settled` is the whole sequence at once — reduced motion, and any renderer
 *   that cannot put the values on its dice.
 */
export const sequencePhases = [
  "pending",
  "scene",
  "values",
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
 * Beat lengths, measured from the moment the values arrive in the arithmetic —
 * that is, from the handoff out of the renderer's scene. Each later term is
 * revealed after the one it depends on, so the line reads as a derivation.
 */
export const valuesBeatMs = 460;
export const revealDurationMs = 440;

export interface SequenceStep {
  phase: SequencePhase;
  delay: number;
}

/**
 * When each beat after the handoff happens. Adding the dice together is its own
 * beat only when a modifier follows it; otherwise the total is the dice sum and
 * one term says both.
 */
export function rollSequenceTimeline(options: {
  sum: boolean;
  modifier: boolean;
}): SequenceStep[] {
  const steps: SequenceStep[] = [];
  let at = valuesBeatMs;
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
