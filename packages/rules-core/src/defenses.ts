import {
  acModifierAppliesToCmd,
  sizeCategories,
  type Contribution,
  type ContextualModifiers,
  type DefenseContext,
  type EvaluationResult,
  type ExcludedContribution,
  type ManeuverId,
  type AbilityId,
  type RollContext,
  type RollDefense,
  type TargetContext,
  type TargetId,
} from "@threepointpf/rules-schema";
import { sourceContribution } from "./contributions.js";
import {
  buildContribution,
  exclusionOf,
  resolveContextFlags,
  type ModifierEffect,
} from "./effects.js";
import type { RulesRuntime } from "./runtime.js";

/** An AC modifier, which always carries explicit defense applicability. */
export type AcModifierEffect = Extract<ModifierEffect, { target: "ac" }>;

function appliesToDefense(
  contribution: Contribution,
  context: DefenseContext,
): boolean {
  // Missing applicability is invalid metadata, never a broad/general effect.
  return contribution.appliesTo?.includes(context) ?? false;
}

export function evaluateArmorClass(
  runtime: RulesRuntime,
  kind: "normal" | "touch" | "flat-footed" | "denied-dexterity",
): EvaluationResult {
  const target = "ac" as TargetId;
  const contributions: Contribution[] = [
    runtime.replacement(target, 10, "ac.base", "Base AC"),
    runtime.sizeAdjustment(target, -2, "Size modifier"),
  ];
  const dexterity = runtime.abilityContribution("dex", target);
  const helpless = runtime.nonlethalState() === "unconscious";
  const deniedDexterity = helpless || kind === "normal" && runtime.defenseRestrictions().includes("denyDexterityBonus");
  const deniedDodge = helpless || kind === "normal" && runtime.defenseRestrictions().includes("denyDodgeBonus");
  if (helpless) {
    contributions.push(sourceContribution(target, -5, "ac.dexterity.helpless", "Dexterity while helpless", undefined, {
      note: "A helpless character is treated as having Dexterity 0 (−5 modifier).",
      children: [dexterity],
      sourceMetadata: { document: "Pathfinder Core Rulebook", sheet: "Combat: Helpless Defenders", system: "PF1e", publisher: "Paizo", category: "Paizo Combat Rules" },
    }));
  } else if (((kind !== "flat-footed" && kind !== "denied-dexterity") && !deniedDexterity) || dexterity.value < 0) {
    const caps = runtime.equipment.filter(
      (item) => item.equipped && item.maxDexterity !== undefined,
    );
    const cap = caps.reduce<(typeof caps)[number] | undefined>(
      (best, item) =>
        !best || item.maxDexterity! < best.maxDexterity! ? item : best,
      undefined,
    );
    contributions.push(dexterity);
    if (cap && dexterity.value > cap.maxDexterity!)
      contributions.push(
        sourceContribution(
          target,
          cap.maxDexterity! - dexterity.value,
          `equipment.${cap.id}.max-dexterity`,
          `${cap.name ?? cap.id} maximum Dexterity`,
          undefined,
          {
            note: `Caps positive Dexterity bonus at ${cap.maxDexterity}`,
            ...(cap.source ? { sourceMetadata: cap.source } : {}),
          },
        ),
      );
  } else if (deniedDexterity && dexterity.value > 0) {
    contributions.push(sourceContribution(target, 0, "ac.dexterity.denied", "Positive Dexterity bonus denied", undefined, {
      note: "This condition removes the positive Dexterity bonus from normal AC",
      children: [dexterity],
    }));
  }
  const direct = runtime.directModifiers("ac").applied.filter((item) => !(deniedDodge && item.bonusType === "dodge" && item.value > 0));
  const unarmoredTraining = runtime.equipment.filter((item) => item.equipped && item.requiresUnarmored && !runtime.equipment.some((other) => other.equipped && other.wornArmor && !other.requiresUnarmored));
  for (const item of unarmoredTraining) {
    const bab = runtime.bab();
    const progression = item.armorBonusProgression;
    if (progression) direct.push(sourceContribution(target, Math.floor(Math.max(0, bab.value) / progression.incrementEveryBab), `equipment.${item.id}.bab-scaling`, `${item.name ?? item.id} BAB scaling`, "armor", { children: [sourceContribution("combat.bab", bab.value, "combat.bab", "Base Attack Bonus", undefined, { children: bab.contributions })], sourceMetadata: item.source }));
  }
  const naturalResult = runtime.result("ac.natural", [
    runtime.replacement(
      "ac.natural",
      0,
      "ac.natural.base",
      "Base natural armor",
    ),
    ...runtime.directModifiers("ac.natural").applied,
  ]);
  const natural = [
    sourceContribution(
      target,
      naturalResult.value,
      "ac.natural",
      "Natural armor",
      undefined,
      { children: naturalResult.contributions },
    ),
  ];
  if (kind === "touch") {
    contributions.push(
      ...direct.filter((item) => appliesToDefense(item, "touch")),
    );
  } else if (kind === "flat-footed") {
    contributions.push(
      ...direct.filter((item) =>
        appliesToDefense(item, "flatFooted") &&
        !(item.bonusType === "dodge" && item.value > 0),
      ),
      ...natural,
    );
  } else if (kind === "denied-dexterity") {
    contributions.push(
      ...direct.filter((item) =>
        (appliesToDefense(item, "normal") || appliesToDefense(item, "deniedDexterity")) &&
        !(item.bonusType === "dodge" && item.value > 0),
      ),
      ...natural,
    );
  } else {
    contributions.push(
      ...direct.filter((item) => appliesToDefense(item, "normal")),
      ...natural,
    );
  }
  return runtime.result(target, contributions, {
    context: kind === "flat-footed" ? "flatFooted" : kind === "denied-dexterity" ? "deniedDexterity" : kind,
  });
}

/**
 * Pathfinder CMD consumes AC modifiers semantically, not by duplicated
 * authorship. Every AC modifier that applies in the normal defense context
 * contributes, except armor, shield, natural armor and size *bonuses*; all AC
 * penalties contribute regardless of category. That is why a homebrew
 * `+2 deflection AC` effect raises CMD with no second `cmd` effect.
 */
export function acModifiersForCmd(runtime: RulesRuntime): ContextualModifiers {
  const applied: Contribution[] = [];
  const excluded: ExcludedContribution[] = [];
  for (const effect of runtime.effects) {
    if (effect.kind !== "modifier" || effect.target !== "ac") continue;
    const modifier = effect as AcModifierEffect;
    if (!modifier.appliesTo?.includes("normal")) continue;
    if (!acModifierAppliesToCmd(modifier.value, modifier.bonusType)) {
      excluded.push(
        exclusionOf(
          modifier,
          "cmd",
          `${modifier.bonusType} bonuses do not add to CMD`,
        ),
      );
      continue;
    }
    applied.push({
      ...buildContribution(runtime, modifier, "cmd"),
      note: `AC ${modifier.bonusType} modifier applies to CMD semantically (${modifier.appliesTo.join("/")}); only armor, shield, natural armor and size bonuses are excluded`,
    });
  }
  return { applied, excluded };
}

export interface ManeuverOptions {
  maneuver?: ManeuverId;
  abilityOverride?: AbilityId;
  babProgressionId?: string;
  flags?: string[];
  /** Situational flags withheld for this roll. */
  excludeFlags?: string[];
  /** The defender's CMD, when the caller knows it. */
  defense?: RollDefense;
  target?: TargetContext;
}

function maneuverContext(
  runtime: RulesRuntime,
  options: ManeuverOptions,
): RollContext {
  const target: TargetContext | undefined =
    options.target || options.defense
      ? {
          ...(options.target ?? {}),
          ...(options.defense ? { defense: options.defense } : {}),
        }
      : undefined;
  return {
    kind: "maneuver",
    actorCharacterId: runtime.character.id,
    action: {
      kind: "maneuver",
      sequenceId: `action:${runtime.character.id}:maneuver`,
    },
    ...(options.maneuver ? { maneuver: options.maneuver } : {}),
    ...(options.abilityOverride ? { maneuverAbilityOverride: options.abilityOverride } : {}),
    ...(options.babProgressionId ? { maneuverBabProgressionId: options.babProgressionId } : {}),
    flags: resolveContextFlags(
      runtime.enabledContextFlags(),
      options.flags,
      options.excludeFlags,
    ),
    ...(options.excludeFlags?.length
      ? { excludeFlags: options.excludeFlags }
      : {}),
    ...(target ? { target } : {}),
  };
}

export function evaluateCombatManeuver(
  runtime: RulesRuntime,
  target: "cmb" | "cmd",
  options: ManeuverOptions = {},
): EvaluationResult {
  const context = maneuverContext(runtime, options);
  const modifiers = runtime.directModifiers(target, {
    context,
    reportExclusions: true,
  });
  const acDerived = target === "cmd" ? acModifiersForCmd(runtime) : EMPTY_MODIFIERS;
  const bab = runtime.bab();
  const babProgression = options.babProgressionId ? runtime.advancementProgressionLevels().find((entry) => entry.id === options.babProgressionId) : undefined;
  const effectiveBab = babProgression ? Math.max(bab.value, babProgression.level) : bab.value;
  const babFact = babProgression
    ? sourceContribution(target, effectiveBab, `combat.bab.max.${options.babProgressionId}`, `Higher of BAB or ${babProgression.name} level`, undefined, { children: [babContribution(runtime, target), sourceContribution(target, babProgression.level, `progression.${options.babProgressionId}.level`, `${babProgression.name} level`)] })
    : babContribution(runtime, target);
  const contributions: Contribution[] = [
    runtime.replacement(
      target,
      target === "cmd" ? 10 : 0,
      `${target}.base`,
      target === "cmd" ? "Base CMD" : "Base CMB",
    ),
    babFact,
    runtime.abilityContribution(
      options.abilityOverride ?? (target === "cmb" && sizeCategories.indexOf(runtime.sizeCategory()) <= 2
        ? "dex"
        : "str"),
      target,
    ),
    ...(target === "cmd"
      ? [runtime.abilityContribution("dex", target)]
      : []),
    runtime.sizeAdjustment(target, 2, "Size modifier"),
    ...acDerived.applied,
    ...modifiers.applied,
  ];
  return runtime.result(target, contributions, {
    rollContext: context,
    excluded: [...acDerived.excluded, ...modifiers.excluded],
  });
}

const EMPTY_MODIFIERS: ContextualModifiers = { applied: [], excluded: [] };

export function babContribution(
  runtime: RulesRuntime,
  target: TargetId,
): Contribution {
  const bab = runtime.bab();
  return sourceContribution(
    target,
    bab.value,
    "combat.bab",
    "Base Attack Bonus",
    undefined,
    {
      children: bab.contributions,
      note: "Consumed from the first-class combat.bab fact",
    },
  );
}
