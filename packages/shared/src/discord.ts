import { formatModifier, formatRollOutcome, type ResolvedRoll, type RollPlan } from "@threepointpf/dice";

function safeLabel(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit)
    .replace(/([\\*_~`|>\[\]()<>])/g, "\\$1").replace(/@/g, "@\u200b");
}

function outcomeLabel(plan: RollPlan, resolved: ResolvedRoll): string {
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
  return formatRollOutcome(outcome);
}

/** The same bounded, mention-safe roll content is used by demo and hosted delivery. */
export function formatDiscordRollMessage(
  characterName: string,
  plan: RollPlan,
  resolved: ResolvedRoll,
  reference?: string,
): string {
  const defense = resolved.outcome.defense;
  const comparedWith = defense
    ? ` vs ${defense.kind === "ac" ? "AC" : defense.kind === "cmd" ? "CMD" : "DC"} ${defense.value}`
    : "";
  const positive = resolved.outcome.success === true || resolved.outcome.hit === true;
  const negative = resolved.outcome.success === false || resolved.outcome.hit === false;
  const marker = positive ? "🟢" : negative ? "🔴" : "🎲";
  const outcome = plan.outcomePolicy.kind !== "plain" ? outcomeLabel(plan, resolved) : "";
  const total = `${plan.context.kind === "damage" ? "Damage" : "Total"} ${resolved.total}${comparedWith}${outcome ? ` · ${outcome}` : ""}`;
  const shownFaces = resolved.faces.slice(0, 24).join(", ");
  const omittedFaces = resolved.faces.length > 24 ? `, +${resolved.faces.length - 24} more` : "";
  const dice = resolved.naturalFace === undefined
    ? `Dice ${shownFaces}${omittedFaces}`
    : `Natural d20 ${resolved.naturalFace}${resolved.faces.length > 1 ? ` · Dice ${shownFaces}${omittedFaces}` : ""}`;
  const details = `${dice} · Modifier ${formatModifier(resolved.modifier)}${plan.context.criticalDamage ? " · Critical damage" : ""}`;
  const lines = [
    `**${safeLabel(plan.label, 180)}**`,
    `${marker} **${total}**`,
    details,
    `${safeLabel(characterName || "Unnamed character", 120)}${reference ? ` · Ref ${safeLabel(reference, 64)}` : ""}`,
  ];
  return lines.join("\n").slice(0, 2_000);
}

export function discordRollPayload(characterName: string, plan: RollPlan, resolved: ResolvedRoll, reference?: string) {
  return { content: formatDiscordRollMessage(characterName, plan, resolved, reference), allowed_mentions: { parse: [] as [] }, tts: false as const };
}
