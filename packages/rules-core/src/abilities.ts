import type {
  AbilityId,
  Contribution,
  EvaluationResult,
  TargetId,
} from "@threepointpf/rules-schema";
import { abilityModifier, base, sourceContribution, sum } from "./contributions.js";
import type { RulesRuntime } from "./runtime.js";

export const abilityPenaltyFloor = 1;

/**
 * Ability scores consume ordinary additive modifiers, but a *negative modifier*
 * is a temporary ability penalty and may never take the score below 1. The
 * distinction is explicit: only contributions marked `abilityPenalty` are
 * floored, so replacement baselines (and future damage/drain or absent-ability
 * mechanisms) still reach 0 or lower and are only clamped by the structural
 * non-negative invariant.
 */
export function evaluateAbilityScore(
  runtime: RulesRuntime,
  id: AbilityId,
): EvaluationResult {
  const target = `ability.${id}` as TargetId;
  const raw = runtime.result(target, [
    runtime.replacement(
      target,
      runtime.character.baseAbilities[id],
      "base-ability",
      `Base ${id.toUpperCase()}`,
    ),
    ...runtime.directModifiers(target).applied,
  ]);
  const contributions = [...raw.contributions];
  const penalty = sum(
    contributions.filter((item) => item.abilityPenalty === true),
  );
  const withoutPenalties = raw.value - penalty;
  let value = raw.value;
  if (penalty < 0 && withoutPenalties >= abilityPenaltyFloor && value < abilityPenaltyFloor) {
    const allowedPenalty = Math.max(
      penalty,
      abilityPenaltyFloor - withoutPenalties,
    );
    contributions.push(
      sourceContribution(
        target,
        allowedPenalty - penalty,
        "rules-core.ability-penalty-floor",
        "Ability penalty limit",
        undefined,
        {
          note: `Temporary ability penalties (${penalty}) cannot reduce ${id.toUpperCase()} below ${abilityPenaltyFloor}; score before penalties is ${withoutPenalties}`,
        },
      ),
    );
    value = withoutPenalties + allowedPenalty;
  }
  if (value < 0) {
    contributions.push(
      base(
        target,
        -value,
        "rules-core.ability-floor",
        "Ability score minimum",
      ),
    );
    value = 0;
  }
  return { ...raw, value, contributions };
}

export function evaluateAbilityModifier(
  runtime: RulesRuntime,
  id: AbilityId,
): EvaluationResult {
  const score = runtime.abilityScore(id);
  const target = `ability.${id}` as TargetId;
  const modifier = abilityModifier(score.value);
  const scoreNode = sourceContribution(
    target,
    score.value,
    `ability.${id}.score`,
    `${id.toUpperCase()} score`,
    undefined,
    { children: score.contributions },
  );
  return {
    target,
    value: modifier,
    contributions: [
      sourceContribution(
        target,
        modifier,
        `ability.${id}.modifier`,
        `${id.toUpperCase()} modifier`,
        undefined,
        { note: "floor((score - 10) / 2)", children: [scoreNode] },
      ),
    ],
  };
}

/**
 * The modifier of one ability as a nested contribution for a consuming target,
 * so a nonlinear dependency keeps its full evidence chain.
 */
export function abilityContribution(
  runtime: RulesRuntime,
  id: AbilityId,
  target: TargetId,
): Contribution {
  const score = runtime.abilityScore(id);
  const modifier = abilityModifier(score.value);
  const scoreNode = sourceContribution(
    `ability.${id}` as TargetId,
    score.value,
    `ability.${id}.score`,
    `${id.toUpperCase()} score`,
    undefined,
    { children: score.contributions },
  );
  return sourceContribution(
    target,
    modifier,
    `ability.${id}.modifier`,
    `${id.toUpperCase()} modifier`,
    undefined,
    { note: "floor((score - 10) / 2)", children: [scoreNode] },
  );
}
