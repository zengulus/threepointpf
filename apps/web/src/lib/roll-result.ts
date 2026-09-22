import {
  formatModifier,
  formatRollOutcome,
  type ResolvedRoll,
} from "@threepointpf/dice";
import type { RollDefense, RollPlan } from "@threepointpf/rules-schema";

/** A compact, player-facing label for the target carried by a roll plan. */
export function formatRollDefense(defense: RollDefense): string {
  const label =
    defense.kind === "ac" ? "AC" : defense.kind === "cmd" ? "CMD" : "DC";
  return `${label} ${defense.value}`;
}

/**
 * The semantic part of a completed roll. This is deliberately based only on
 * the resolved outcome; neither the sheet nor a publisher reimplements any
 * game calculation to describe it.
 */
export function formatResolvedOutcome(
  plan: RollPlan,
  resolved: ResolvedRoll,
): string {
  const outcome = resolved.outcome;
  if (plan.context.kind === "attack") {
    if (outcome.critical === true) return "Critical hit";
    if (outcome.hit === true) return "Hit";
    if (outcome.hit === false) return "Miss";
  }
  if (plan.context.kind === "save" || plan.context.kind === "skill" || plan.context.kind === "maneuver") {
    if (outcome.success === true) return "Success";
    if (outcome.success === false) return "Failure";
  }
  if (plan.context.kind === "damage") return "Damage rolled";
  if (plan.context.kind === "initiative") return "Initiative rolled";
  return formatRollOutcome(outcome);
}

/** A complete local result sentence, shared by the status notice and tests. */
export function formatRollResultNotice(
  characterName: string,
  plan: RollPlan,
  resolved: ResolvedRoll,
): string {
  const face =
    resolved.naturalFace === undefined
      ? `dice ${resolved.faces.join(", ")}`
      : `natural ${resolved.naturalFace}`;
  const target = resolved.outcome.defense
    ? ` vs ${formatRollDefense(resolved.outcome.defense)}`
    : "";
  const outcome =
    plan.outcomePolicy.kind === "plain"
      ? ""
      : ` · ${formatResolvedOutcome(plan, resolved)}`;
  return `${characterName} · ${plan.label}: ${face} · modifier ${formatModifier(
    resolved.modifier,
  )} · total ${resolved.total}${target}${outcome}`;
}

