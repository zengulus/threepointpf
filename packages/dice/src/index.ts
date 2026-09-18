import type {
  DiceRequirement,
  RollOutcome,
  RollOutcomeKind,
  RollOutcomePolicy,
  RollPlan,
} from "@threepointpf/rules-schema";
import {
  primaryCheckFaceOf,
  validateFaces,
  validatePrimaryCheckDie,
} from "./faces.js";

// Presentation only ever animates faces that were already resolved; preference
// persistence keeps user display settings out of authored character state.
export * from "./faces.js";
export * from "./presentation.js";
export * from "./preferences.js";

// The plan and its context are shared domain vocabulary, so they live in
// `rules-schema` and are re-exported here where consumers already import them.
export type {
  DiceRequirement,
  RollContext,
  RollOutcome,
  RollOutcomeKind,
  RollOutcomePolicy,
  RollPlan,
  RollPlanProvenance,
} from "@threepointpf/rules-schema";

export interface PhysicalRollRequest {
  planId: string;
  dice: DiceRequirement[];
}

export interface PhysicalRollResult {
  planId: string;
  faces: number[];
}

export interface ResolvedRoll {
  planId: string;
  label: string;
  faces: number[];
  modifier: number;
  total: number;
  /** The face of the plan's primary check die, when the plan declares one. */
  naturalFace?: number;
  outcome: RollOutcome;
}

export interface DiceProvider {
  roll(request: PhysicalRollRequest): Promise<PhysicalRollResult>;
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}


function attackKind(
  outcome: RollOutcome,
  policy: RollOutcomePolicy,
): RollOutcomeKind {
  if (outcome.automaticMiss)
    return policy.natural1.classification === "criticalFailure"
      ? "criticalFailure"
      : "failure";
  if (outcome.critical === true) return "criticalSuccess";
  if (outcome.hit === true)
    return policy.natural20.classification === "criticalSuccess"
      ? "criticalSuccess"
      : "success";
  if (outcome.hit === false) return "failure";
  if (outcome.natural20) return policy.natural20.classification;
  if (outcome.natural1) return policy.natural1.classification;
  return "unresolved";
}

function checkKind(
  outcome: RollOutcome,
  policy: RollOutcomePolicy,
): RollOutcomeKind {
  if (outcome.automaticFailure)
    return policy.natural1.classification === "criticalFailure"
      ? "criticalFailure"
      : "failure";
  if (outcome.automaticSuccess)
    return policy.natural20.classification === "criticalSuccess"
      ? "criticalSuccess"
      : "success";
  if (outcome.success === true) return "success";
  if (outcome.success === false) return "failure";
  if (outcome.natural20) return policy.natural20.classification;
  if (outcome.natural1) return policy.natural1.classification;
  return "unresolved";
}

/**
 * Deterministic interpretation of raw faces. Attack critical range and
 * automatic-hit semantics are separate rules: only the automatic rule makes a
 * threat hit, and a threat outside the automatic rule still has to beat the
 * known defense. When no defense is known, `hit` / `success` and therefore any
 * non-automatic `critical` stay unresolved instead of being guessed.
 *
 * This campaign uses no critical confirmation. A policy that required it would
 * keep the threat visible through `inCriticalRange` while `critical` stays
 * unresolved, because resolution never rolls a second die.
 */
export function evaluateRollOutcome(
  plan: RollPlan,
  naturalFace: number | undefined,
  total: number,
): RollOutcome {
  const policy = plan.outcomePolicy;
  // A roll with no declared check die has no natural-face semantics, so the
  // facts are absent rather than false.
  const hasCheckDie = naturalFace !== undefined;
  const natural20 = naturalFace === 20;
  const natural1 = naturalFace === 1;
  const defense = plan.context.target?.defense;
  const range = plan.criticalRange;
  const inCriticalRange =
    range && naturalFace !== undefined
      ? naturalFace >= range.minimumNaturalRoll
      : undefined;
  const outcome: RollOutcome = {
    kind: "unresolved",
    ...(hasCheckDie ? { natural20, natural1 } : {}),
    ...(defense ? { defense } : {}),
    ...(range && naturalFace !== undefined
      ? { criticalRange: range, inCriticalRange }
      : {}),
  };
  // A plain roll (damage, initiative) is compared against nothing, so it has no
  // success or failure of its own: only the raw-face facts are recorded.
  if (policy.kind === "plain") return outcome;
  if (policy.kind === "check") {
    outcome.automaticSuccess = natural20 && policy.natural20.automatic;
    outcome.automaticFailure = natural1 && policy.natural1.automatic;
    outcome.success = outcome.automaticSuccess
      ? true
      : outcome.automaticFailure
        ? false
        : defense
          ? total >= defense.value
          : undefined;
    outcome.kind = checkKind(outcome, policy);
    return outcome;
  }
  outcome.automaticHit = natural20 && policy.natural20.automatic;
  outcome.automaticMiss = natural1 && policy.natural1.automatic;
  outcome.hit = outcome.automaticHit
    ? true
    : outcome.automaticMiss
      ? false
      : defense
        ? total >= defense.value
        : undefined;
  outcome.critical = outcome.automaticMiss
    ? false
    : inCriticalRange === undefined
      ? undefined
      : !inCriticalRange
        ? false
        : outcome.hit === undefined
          ? undefined
          : outcome.hit === false
            ? false
            : policy.criticalConfirmationRequired
              ? undefined
              : true;
  outcome.kind = attackKind(outcome, policy);
  return outcome;
}

/** Resolves raw faces against a plan. Identical plan plus identical faces always produce the same result. */
export function resolveRollPlan(plan: RollPlan, faces: readonly number[]): ResolvedRoll {
  validateFaces(plan, faces);
  validatePrimaryCheckDie(plan);
  const total = faces.reduce((sum, face) => sum + face, 0) + plan.modifier;
  const naturalFace = primaryCheckFaceOf(plan, faces);
  return {
    planId: plan.id,
    label: plan.label,
    faces: [...faces],
    modifier: plan.modifier,
    total,
    ...(naturalFace !== undefined ? { naturalFace } : {}),
    outcome: evaluateRollOutcome(plan, naturalFace, total),
  };
}

/** A short human-readable outcome for displays; rules semantics stay in the outcome itself. */
export function formatRollOutcome(outcome: RollOutcome): string {
  const parts: string[] = [];
  if (outcome.natural20) parts.push("natural 20");
  else if (outcome.natural1) parts.push("natural 1");
  if (outcome.automaticHit || outcome.automaticSuccess) parts.push("automatic");
  // A natural-face classification is the face fact itself, so it is not
  // repeated as a second label ("natural 1 · natural1").
  if (outcome.kind !== "natural20" && outcome.kind !== "natural1")
    parts.push(outcome.kind);
  if (outcome.criticalRange && outcome.inCriticalRange !== undefined)
    parts.push(
      `threat ${outcome.criticalRange.minimumNaturalRoll}–20${
        outcome.inCriticalRange ? " (in range)" : " (not in range)"
      }`,
    );
  return parts.join(" · ");
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be positive");
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const maxUint = 0x1_0000_0000;
    const limit = Math.floor(maxUint / maxExclusive) * maxExclusive;
    const bytes = new Uint32Array(1);
    let sample: number;
    do { cryptoObject.getRandomValues(bytes); sample = bytes[0]!; } while (sample >= limit);
    return sample % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export class BrowserDiceProvider implements DiceProvider {
  async roll(request: PhysicalRollRequest): Promise<PhysicalRollResult> {
    const faces: number[] = [];
    for (const group of request.dice) for (let i = 0; i < group.count; i += 1) faces.push(secureRandomInt(group.sides) + 1);
    return { planId: request.planId, faces };
  }
}
