import type { RollPlan } from "@threepointpf/dice";
import {
  d20CheckDie,
  type Contribution,
  type DerivedSkill,
  type EvaluationResult,
  type RollContext,
  type RollDefense,
  type SkillConfiguration,
  type SkillId,
  type TargetContext,
  type TargetId,
} from "@threepointpf/rules-schema";
import { base, lookup, sourceContribution } from "./contributions.js";
import { defaultSkillAbilities, skillLabel } from "./labels.js";
import { resolveContextFlags } from "./effects.js";
import type { RulesRuntime } from "./runtime.js";

export interface ClassSkillStatus {
  classSkill: boolean;
  provenance: Contribution[];
}

export interface SkillRollOptions {
  flags?: string[];
  /** Situational flags withheld for this roll. */
  excludeFlags?: string[];
  /** The DC being attempted, when the caller knows it. */
  defense?: RollDefense;
  target?: TargetContext;
}

export function skillContext(
  runtime: RulesRuntime,
  options: SkillRollOptions = {},
): RollContext {
  const target: TargetContext | undefined =
    options.target || options.defense
      ? {
          ...(options.target ?? {}),
          ...(options.defense ? { defense: options.defense } : {}),
        }
      : undefined;
  return {
    kind: "skill",
    actorCharacterId: runtime.character.id,
    action: { kind: "skillCheck" },
    flags: resolveContextFlags(
      runtime.enabledContextFlags(),
      options.flags ?? [],
      options.excludeFlags ?? [],
    ),
    ...(options.excludeFlags?.length
      ? { excludeFlags: options.excludeFlags }
      : {}),
    ...(target ? { target } : {}),
  };
}

/** Class-skill membership with every providing progression retained. */
export function classSkillStatus(
  runtime: RulesRuntime,
  id: string,
  target: TargetId,
): ClassSkillStatus {
  const config = runtime.character.skills?.[id];
  const override = config?.classSkillOverride ?? config?.classSkill;
  if (override !== undefined) {
    return {
      classSkill: override,
      provenance: [
        sourceContribution(
          target,
          0,
          `skill.${id}.class-override`,
          "Manual class-skill override",
          undefined,
          {
            note: override
              ? "Manual override marks this skill as a class skill"
              : "Manual override suppresses catalog class-skill status",
          },
        ),
      ],
    };
  }
  const sources: Contribution[] = [];
  for (const progression of runtime.advancementProgressionLevels()) {
    const definition = runtime.progressionDefinition(progression.id);
    if (!definition?.classSkills?.includes(id)) continue;
    sources.push(
      sourceContribution(
        target,
        0,
        `progression.${definition.id}.class-skill.${id}`,
        `${definition.name} class skill`,
        undefined,
        {
          note: `Active at character-global ${definition.name} level ${progression.level}${definition.classSkillsSource ? `; ${definition.classSkillsSource.sheet}!${definition.classSkillsSource.range}` : ""}`,
          children: progression.increments.map((increment) =>
            sourceContribution(
              target,
              0,
              `advancement.slot.${increment.slotId}.track.${increment.trackId}.progression.${definition.id}.class-skill.${id}`,
              `${definition.name} level ${increment.level}`,
              undefined,
              { note: `Credited to track ${increment.trackId}` },
            ),
          ),
        },
      ),
    );
  }
  return { classSkill: sources.length > 0, provenance: sources };
}

export function evaluateSkill(
  runtime: RulesRuntime,
  id: string,
  options: SkillRollOptions = {},
): DerivedSkill {
  const character = runtime.character;
  const config: SkillConfiguration = character.skills?.[id] ?? {};
  const metadata = lookup(runtime.skillCatalog, id);
  const governingAbility =
    config.governingAbility ??
    metadata?.governingAbility ??
    lookup(defaultSkillAbilities, id) ??
    "int";
  const ranks = character.skillRanks[id] ?? 0;
  const target = `skill.${id}` as TargetId;
  const classSkill = classSkillStatus(runtime, id, target);
  const context = skillContext(runtime, options);
  const global = runtime.directModifiers("skill.all", {
    context,
    reportExclusions: true,
  });
  const specific = runtime.directModifiers(target, {
    context,
    reportExclusions: true,
  });
  const contributions = [
    runtime.replacement(target, ranks, `skill.${id}.ranks`, "Skill ranks"),
    runtime.abilityContribution(governingAbility, target),
    ...(classSkill.provenance.length
      ? [
          sourceContribution(
            target,
            classSkill.classSkill && ranks > 0 ? 3 : 0,
            `skill.${id}.class`,
            "Class skill",
            undefined,
            {
              children: classSkill.provenance,
              ...(classSkill.classSkill && ranks === 0
                ? {
                    note: "At least one rank is required for the +3 class-skill bonus",
                  }
                : {}),
            },
          ),
        ]
      : []),
    ...(config.miscellaneous
      ? [
          base(
            target,
            config.miscellaneous,
            `skill.${id}.misc`,
            "Miscellaneous skill bonus",
          ),
        ]
      : []),
    ...(config.armorAndSize
      ? [
          base(
            target,
            config.armorAndSize,
            `skill.${id}.armor-size`,
            "Armor/size adjustment",
          ),
        ]
      : []),
    ...(metadata?.armorCheckPenalty
      ? runtime.equipment
          .filter((item) => item.equipped && item.armorCheckPenalty)
          .map((item) =>
            sourceContribution(
              target,
              item.armorCheckPenalty!,
              `equipment.${item.id}.armor-check`,
              `${item.name ?? item.id} armor check penalty`,
              undefined,
              { ...(item.source ? { sourceMetadata: item.source } : {}) },
            ),
          )
      : []),
    ...(["fly", "stealth"].includes(id)
      ? [runtime.sizeAdjustment(target, id === "fly" ? -2 : -4, "Size modifier")]
      : []),
    ...global.applied,
    ...specific.applied,
  ];
  const total = runtime.result(target, contributions, {
    rollContext: context,
    excluded: [...global.excluded, ...specific.excluded],
  });
  return {
    id: id as SkillId,
    label: metadata?.name ?? skillLabel(id),
    total,
    ranks,
    governingAbility,
    classSkill: classSkill.classSkill,
    classSkillProvenance: classSkill.provenance,
  };
}

/** The situational inputs of an initiative check; it is never compared to a defense. */
export interface InitiativeRollOptions {
  flags?: string[];
  /** Situational flags withheld for this check. */
  excludeFlags?: string[];
}

export function evaluateInitiative(
  runtime: RulesRuntime,
  options: InitiativeRollOptions = {},
): EvaluationResult {
  const target = "initiative" as TargetId;
  const context: RollContext = {
    kind: "initiative",
    actorCharacterId: runtime.character.id,
    action: { kind: "other" },
    flags: resolveContextFlags(
      runtime.enabledContextFlags(),
      options.flags ?? [],
      options.excludeFlags ?? [],
    ),
    ...(options.excludeFlags?.length
      ? { excludeFlags: options.excludeFlags }
      : {}),
  };
  const modifiers = runtime.directModifiers(target, {
    context,
    reportExclusions: true,
  });
  return runtime.result(
    target,
    [
      runtime.replacement(target, 0, "initiative.base", "Base initiative"),
      runtime.abilityContribution("dex", target),
      ...modifiers.applied,
      ...skillLikeInitiativeEffects(runtime, target),
    ],
    { rollContext: context, excluded: modifiers.excluded },
  );
}

/**
 * The authoritative initiative plan. Initiative is a d20 check with no success
 * or failure of its own, so it carries the plain outcome policy and the same
 * contextual flags its evaluation used.
 */
export function initiativeRollPlan(
  runtime: RulesRuntime,
  options: InitiativeRollOptions = {},
): RollPlan {
  const evaluation = evaluateInitiative(runtime, options);
  const context = evaluation.rollContext;
  if (!context)
    throw new Error("Initiative evaluation produced no roll context");
  return {
    id: `initiative:${runtime.character.id}`,
    characterId: runtime.character.id,
    label: "Initiative",
    dice: [{ sides: 20, count: 1 }],
    modifier: evaluation.value,
    context,
    outcomePolicy: runtime.outcomePolicies.plain,
    primaryCheckDie: d20CheckDie,
    provenance: {
      modifier: evaluation.contributions,
      excluded: evaluation.excluded ?? [],
    },
  };
}

/** Effects authored against `skill.initiative` reach the initiative fact once. */
function skillLikeInitiativeEffects(
  runtime: RulesRuntime,
  target: TargetId,
): Contribution[] {
  return runtime.effects.flatMap((effect) => {
    if (effect.kind !== "modifier" || !effect.source) return [];
    if (effect.target !== "skill.initiative") return [];
    return [
      sourceContribution(
        target,
        effect.value,
        effect.source.id,
        effect.source.label,
        effect.bonusType,
        { ...(effect.source.content ? { sourceMetadata: effect.source.content } : {}) },
      ),
    ];
  });
}
