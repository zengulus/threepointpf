import {
  defaultCriticalRange,
  type AttackDefinition,
  type Contribution,
  type CriticalRange,
  type CriticalRangeEffect,
  type CriticalRangeEvaluation,
  type CriticalRangeOperation,
  type ExcludedContribution,
  type RollContext,
  type RollKind,
  type RollOutcomePolicy,
  type RollOutcomePolicySet,
  type TargetId,
} from "@threepointpf/rules-schema";
import { lookup, sourceContribution, sum } from "./contributions.js";
import { applicabilityOf, attackModeOf } from "./effects.js";
import type { RulesRuntime } from "./runtime.js";

/**
 * PF1e attack rolls: a natural 20 hits outright and a natural 1 misses and is
 * classified as a critical failure. A critical threat needs no second roll in
 * this campaign, so `criticalConfirmationRequired` is false and resolution
 * never produces one.
 */
export const attackOutcomePolicy: RollOutcomePolicy = {
  id: "pf1e.attack",
  kind: "attack",
  natural20: { automatic: true, classification: "natural20" },
  natural1: { automatic: true, classification: "criticalFailure" },
  criticalConfirmationRequired: false,
};

/**
 * Combat maneuvers have no critical range, but a natural 20 or natural 1 still
 * decides the opposed check.
 */
export const maneuverOutcomePolicy: RollOutcomePolicy = {
  id: "pf1e.maneuver",
  kind: "check",
  natural20: { automatic: true, classification: "natural20" },
  natural1: { automatic: true, classification: "natural1" },
  criticalConfirmationRequired: false,
};

/**
 * PF1e saving throws: a natural 20 always succeeds and a natural 1 always
 * fails, whatever the DC. The face also stays visible as a face fact, so
 * "succeeded because of the DC" and "succeeded because of the natural 20" stay
 * distinguishable. Neither is a critical outcome.
 */
export const saveOutcomePolicy: RollOutcomePolicy = {
  id: "pf1e.save",
  kind: "check",
  natural20: { automatic: true, classification: "natural20" },
  natural1: { automatic: true, classification: "natural1" },
  criticalConfirmationRequired: false,
};

/** Skill checks follow the same comparison rule as saves. */
export const skillOutcomePolicy: RollOutcomePolicy = {
  id: "pf1e.skillCheck",
  kind: "check",
  natural20: { automatic: false, classification: "natural20" },
  natural1: { automatic: false, classification: "natural1" },
  criticalConfirmationRequired: false,
};

/**
 * Rolls that are not success/failure checks, such as damage and initiative:
 * they are compared against nothing, so the raw face is the only rule-relevant
 * fact resolution adds.
 */
export const plainOutcomePolicy: RollOutcomePolicy = {
  id: "pf1e.plain",
  kind: "plain",
  natural20: { automatic: false, classification: "natural20" },
  natural1: { automatic: false, classification: "natural1" },
  criticalConfirmationRequired: false,
};

/** The default policies for this campaign; a caller may override individual families. */
export const pf1eOutcomePolicies: RollOutcomePolicySet = {
  attack: attackOutcomePolicy,
  maneuver: maneuverOutcomePolicy,
  save: saveOutcomePolicy,
  skill: skillOutcomePolicy,
  plain: plainOutcomePolicy,
};

// An explicit table rather than a lookup chain, so a new roll kind has to
// choose a policy family deliberately.
const families = {
  attack: "attack",
  damage: "plain",
  maneuver: "maneuver",
  save: "save",
  skill: "skill",
  initiative: "plain",
} as const satisfies Record<RollKind, keyof RollOutcomePolicySet>;

/** The outcome policy for a roll kind, honoring caller overrides. */
export function outcomePolicyFor(
  runtime: RulesRuntime,
  kind: RollKind,
): RollOutcomePolicy {
  const family = families[kind];
  return runtime.outcomePolicies[family];
}

/** The weapon's or profile's own threat range; 20 when nothing authors one. */
export function attackCriticalRange(
  runtime: RulesRuntime,
  definition: AttackDefinition,
): CriticalRange {
  const profile = definition.profileId
    ? lookup(runtime.attackProfileCatalog, definition.profileId)
    : undefined;
  return definition.criticalRange ?? profile?.criticalRange ?? defaultCriticalRange;
}

/**
 * The weapon's or profile's critical damage multiplier; ×2 when nothing authors
 * one. A weapon's own value wins over the profile it uses, exactly as its threat
 * range does.
 */
export function attackCriticalMultiplier(
  runtime: RulesRuntime,
  definition: AttackDefinition,
): number {
  const profile = definition.profileId
    ? lookup(runtime.attackProfileCatalog, definition.profileId)
    : undefined;
  return definition.criticalMultiplier ?? profile?.criticalMultiplier ?? 2;
}

const clampThreatMinimum = (value: number) => Math.max(2, Math.min(20, value));

/**
 * The minimum face an expansion would leave: `widen` moves by faces, `double`
 * multiplies the weapon's own range (a 20 threat becomes 19–20, 19–20 becomes
 * 17–20, 18–20 becomes 15–20).
 */
function expandedThreatMinimum(
  baseMinimum: number,
  effect: CriticalRangeEffect,
): number {
  return (effect.operation ?? "widen") === "double"
    ? 2 * baseMinimum - 21
    : baseMinimum - effect.widenBy!;
}

/**
 * The effective threat range of one attack in one context: the weapon/profile
 * base widened by every eligible `criticalRange` effect. Contributions are
 * *threshold deltas* (a widening is negative), so the displayed evidence sums
 * to the effective range's distance from the base.
 */
interface CriticalRangeCandidate {
  source: string;
  label: string;
  operation: CriticalRangeOperation;
  /** The minimum face this expansion would leave, before clamping. */
  minimum: number;
  /** What the expansion would contribute to the threshold. */
  value: number;
}

/**
 * The effective threat range of one attack in one context. Threat-range
 * expansion is a single nonstacking family, so the most expansive eligible
 * effect applies and every other eligible one is reported as excluded with the
 * reason it lost. Effects outside their declared context are excluded too.
 */
export function evaluateCriticalRange(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  context: RollContext,
): CriticalRangeEvaluation {
  const target = `attack.${attackModeOf(definition)}` as TargetId;
  const base = attackCriticalRange(runtime, definition);
  const contributions: Contribution[] = [
    sourceContribution(
      target,
      0,
      "critical-range.base",
      `Base threat range ${base.minimumNaturalRoll}–20`,
      undefined,
      {
        note: definition.criticalRange
          ? "Authored on the weapon"
          : definition.profileId
            ? `From attack profile ${definition.profileId}`
            : "Default threat range",
      },
    ),
  ];
  const excluded: ExcludedContribution[] = [];
  const candidates: CriticalRangeCandidate[] = [];
  for (const effect of runtime.effects) {
    if (effect.kind !== "criticalRange" || effect.target !== target) continue;
    const source = effect.source?.id ?? "effect";
    const label = effect.source?.label ?? "Effect";
    const operation = effect.operation ?? "widen";
    const minimum = clampThreatMinimum(
      expandedThreatMinimum(base.minimumNaturalRoll, effect),
    );
    const value = minimum - base.minimumNaturalRoll;
    if (effect.appliesWhen) {
      const match = applicabilityOf(effect, { context });
      if (!match.applies) {
        excluded.push({
          target,
          value,
          label,
          source,
          reason: match.reason ?? "does not apply to this roll",
        });
        continue;
      }
    }
    candidates.push({ source, label, operation, minimum, value });
  }
  // Deterministic winner: the most expansive expansion, ties broken by source
  // so identical authors never depend on effect order.
  const winner = [...candidates].sort(
    (left, right) => left.minimum - right.minimum || left.source.localeCompare(right.source),
  )[0];
  for (const candidate of candidates) {
    if (candidate === winner) continue;
    excluded.push({
      target,
      value: candidate.value,
      label: candidate.label,
      source: candidate.source,
      reason: `threat-range expansions do not stack with ${winner!.label}`,
    });
  }
  if (winner)
    contributions.push(
      sourceContribution(
        target,
        winner.value,
        winner.source,
        winner.operation === "double"
          ? `${winner.label} doubles the threat range`
          : `${winner.label} widens the threat range`,
        undefined,
        {
          note:
            winner.operation === "double"
              ? `Doubles ${base.minimumNaturalRoll}–20 to ${winner.minimum}–20 within its declared context`
              : `Widened by ${base.minimumNaturalRoll - winner.minimum} within its declared context`,
        },
      ),
    );
  const effective: CriticalRange = {
    minimumNaturalRoll: Math.max(
      2,
      Math.min(20, base.minimumNaturalRoll + sum(contributions)),
    ),
  };
  return {
    target,
    base,
    effective,
    ...(winner ? { operation: winner.operation } : {}),
    contributions,
    excluded,
  };
}
