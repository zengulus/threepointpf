import { formatModifier, type RollPlan } from "@threepointpf/dice";
import type { RulesEngine } from "@threepointpf/rules-core";
import { abilityIds, saveIds } from "@threepointpf/rules-schema";
import { characterFilename } from "./character-portability";

const line = (value: string) => value.replace(/\s+/g, " ").trim();

/** Render the engine's additive dice, never a separately calculated modifier. */
export function referenceRollFormula(plan: RollPlan): string {
  const dice = plan.dice.filter((die) => die.addsToTotal !== false)
    .map((die) => `${die.count}d${die.sides}`).join(" + ");
  if (!dice) return String(plan.modifier);
  return `${dice}${plan.modifier < 0 ? ` - ${Math.abs(plan.modifier)}` : plan.modifier > 0 ? ` + ${plan.modifier}` : ""}`;
}

/** Keep damage subtypes separate so manual resistance checks remain possible. */
export function referenceDamageFormula(plan: RollPlan): string {
  const terms = plan.provenance?.damageTerms;
  const typedFlat = plan.provenance?.modifier.filter((item) => item.damageType && item.value !== 0) ?? [];
  if (!terms?.some((term) => term.damageType) && typedFlat.length === 0) return referenceRollFormula(plan);
  if (!terms?.length) return `${referenceRollFormula(plan)} (aggregate; check damage types in the sheet)`;
  let formula = terms.map((term) => `${term.dice.count * term.multiplier}d${term.dice.sides} (${line(term.damageType ?? term.label)})`).join(" + ");
  const add = (value: number, label: string) => {
    if (value) formula += ` ${value < 0 ? "-" : "+"} ${Math.abs(value)} (${line(label)})`;
  };
  for (const contribution of typedFlat) add(contribution.value, contribution.damageType!);
  add(plan.modifier - typedFlat.reduce((total, item) => total + item.value, 0), "untyped");
  return formula;
}

export function playReferenceFilename(name: string): string {
  return characterFilename(name).replace(/\.threepointpf\.json$/, ".threepointpf-play.txt");
}

/** A local, deliberately read-only reference. No private notes or account IDs. */
export function exportPlayReference(engine: RulesEngine, options: { exportedAt?: Date; unsaved?: boolean } = {}): string {
  // Reuse the sheet's evaluated engine, including controller-injected effects
  // such as wound thresholds, instead of rebuilding from raw persisted input.
  const character = engine.character;
  const derived = engine.derive();
  const lines = [
    `${line(character.name)} | 3.PF play reference`,
    `Exported: ${(options.exportedAt ?? new Date()).toISOString()}`,
    options.unsaved ? "Includes unsaved sheet edits. Downloading does not save the character." : "Snapshot of the current sheet.",
    "Re-export after changing equipment, effects, health or resources. This file does not sync.",
    "Formulas include active sheet effects, but exclude target-specific modifiers and situational roll selections.",
    "Use the sheet for action availability, multi-weapon combinations, critical damage, spells and abilities.",
    "This is a manual reference, not an importable character backup or a roll result.",
    "", "DEFENSES & HEALTH",
    `HP: ${derived.currentHp}/${derived.maxHp.value}; temporary HP: ${derived.temporaryHp}; nonlethal damage: ${character.nonlethalDamage ?? 0}`,
    `AC: ${derived.ac.value}; touch: ${derived.touchAc.value}; flat-footed: ${derived.flatFootedAc.value}; CMD: ${derived.cmd.value}`,
    `Size: ${derived.size.category}`,
    `Speed (ft): ${Object.entries(derived.speeds).filter(([mode, speed]) => mode === "land" || speed.value !== 0).map(([mode, speed]) => `${mode} ${speed.value}`).join("; ")}`,
    "", "ABILITIES",
    ...abilityIds.map((id) => `${id.toUpperCase()}: ${derived.abilities[id].score.value} (${formatModifier(derived.abilities[id].modifier.value)})`),
    "", "COMMON ROLLS",
    `Initiative: ${referenceRollFormula(engine.createInitiativeRollPlan())}`,
    ...saveIds.map((id) => { const plan = engine.createSaveRollPlan(id); return `${plan.label}: ${referenceRollFormula(plan)}`; }),
    `CMB (generic): ${referenceRollFormula(engine.createManeuverRollPlan())}`,
    "", "WEAPON ROLLS",
    "Each weapon is listed alone. Do not combine these sequences into a multi-weapon full attack.",
  ];
  if (derived.attacks.length === 0) lines.push("No weapon attacks configured.");
  for (const attack of derived.attacks) {
    lines.push("", line(attack.definition.name));
    for (const action of ["standardAttack", "fullAttack"] as const) {
      const label = action === "standardAttack" ? "Standard attack" : "Full attack (this weapon only)";
      try {
        const plan = engine.createActionPlan({ action, attackIds: [attack.definition.id] });
        const steps = plan.attacks.flatMap((item) => item.steps);
        if (steps.length === 0) {
          lines.push(`  ${label}: configure the attack selection in the sheet.`);
          continue;
        }
        lines.push(`  ${label}:`);
        for (const [index, step] of steps.entries()) {
          const threat = step.roll.criticalRange?.minimumNaturalRoll;
          lines.push(`    ${index + 1}. ${referenceRollFormula(step.roll)}${step.damage ? `; damage ${referenceDamageFormula(step.damage)}` : ""}${threat ? `; threat ${threat === 20 ? "20" : `${threat}-20`}` : ""}`);
        }
      } catch (error) {
        lines.push(`  ${label}: unavailable (${line(error instanceof Error ? error.message : "check the sheet")}).`);
      }
    }
  }
  lines.push("", "SKILLS");
  for (const skill of Object.values(derived.skills).sort((a, b) => a.label.localeCompare(b.label))) {
    try {
      lines.push(`${line(skill.label)}: ${referenceRollFormula(engine.createSkillRollPlan(skill.id))}`);
    } catch (error) {
      lines.push(`${line(skill.label)}: unavailable (${line(error instanceof Error ? error.message : "check the sheet")}).`);
    }
  }
  lines.push("", "RESOURCES (manual tracking after export)");
  if (derived.resources.length === 0) lines.push("No resources configured.");
  for (const resource of derived.resources)
    lines.push(`${line(resource.name)}: ${resource.remaining === null ? "unlimited" : `${resource.remaining}/${resource.maximum} remaining`}`);
  lines.push("", "ACTIVE EFFECT REMINDERS");
  const names = [
    ...character.features.filter((feature) => feature.enabled).map((feature) => feature.name),
    ...(character.abilities ?? []).filter((ability) => ability.activation === "passive" || ability.activation === "toggleable" && ability.active).map((ability) => ability.name),
    ...(character.systems ?? []).flatMap((system) => system.entries.filter((entry) => entry.active && entry.known !== false).map((entry) => `${entry.name} (${system.name})`)),
    ...(character.activeSpellDurations ?? []).filter((duration) => duration.active && duration.effectsApplyToCaster).map((duration) => duration.spellName),
  ];
  lines.push(names.length ? [...new Set(names.map(line))].join("; ") : "No named active effects.");
  for (const grant of derived.grants) lines.push(`${line(grant.grant.replaceAll("-", " "))}: ${line(grant.source.label)}`);
  return `${lines.join("\n")}\n`;
}
