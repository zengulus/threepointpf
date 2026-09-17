import type { RollPlan } from "@threepointpf/dice";
import {
  type ActionAttackPlan,
  type ActionPlan,
  type ActionPlanStep,
  type AttackDefinition,
  type AttackMode,
  type Contribution,
  type DamageEvaluation,
  type DerivedAttack,
  type EvaluationResult,
  type ExcludedContribution,
  type ManeuverId,
  type RollContext,
  type RollKind,
  type TargetId,
} from "@threepointpf/rules-schema";
import { base, lookup, sourceContribution } from "./contributions.js";
import { babContribution, evaluateCombatManeuver } from "./defenses.js";
import { resolveContextFlags } from "./effects.js";
import { labelForTarget } from "./labels.js";
import type { RulesRuntime } from "./runtime.js";

export function attackModeOf(definition: AttackDefinition): AttackMode {
  return (
    definition.mode ??
    (definition.attackTags?.includes("weapon.ranged") ? "ranged" : "melee")
  );
}

export interface AttackContextInput {
  kind: RollKind;
  fullAttack?: boolean;
  attackIndex?: number;
  touch?: boolean;
  maneuver?: ManeuverId;
  flags?: string[];
  /** Situational flags withheld for this roll. */
  excludeFlags?: string[];
  actorId?: string;
  targetId?: string;
}

/**
 * The contextual identity of one attack or damage roll. Enabled feature flags
 * (Combat Expertise and friends) and caller-supplied situational flags are both
 * visible to effect applicability.
 */
export function attackContext(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  input: AttackContextInput,
): RollContext {
  const attackTags = definition.attackTags ?? [];
  return {
    kind: input.kind,
    mode: attackModeOf(definition),
    attackId: definition.id,
    attackTags,
    touch: input.touch ?? attackTags.includes("weapon.touch"),
    fullAttack: input.fullAttack ?? false,
    ...(input.attackIndex !== undefined
      ? { attackIndex: input.attackIndex }
      : {}),
    ...(input.maneuver ? { maneuver: input.maneuver } : {}),
    flags: resolveContextFlags(
      runtime.enabledContextFlags(),
      input.flags,
      input.excludeFlags,
    ),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
  };
}

function profileSource(
  runtime: RulesRuntime,
  definition: AttackDefinition,
) {
  return definition.profileId
    ? lookup(runtime.attackProfileCatalog, definition.profileId)?.source
    : undefined;
}

export function evaluateAttack(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  context: RollContext,
): EvaluationResult {
  const mode = attackModeOf(definition);
  const target = `attack.${mode}` as TargetId;
  const source = profileSource(runtime, definition);
  const attackReplacement = runtime.replacementEffect(target);
  // Pre-combat.bab saves used replaceBase(attack.*) as a replacement for the
  // whole BAB-backed attack baseline. Retain that authored meaning rather than
  // silently turning old data into an additive bonus.
  const attackBaseline: Contribution[] = attackReplacement
    ? [
        sourceContribution(
          target,
          attackReplacement.value,
          attackReplacement.source?.id ?? "effect",
          attackReplacement.source?.label ?? "Baseline replacement",
          undefined,
          {
            note: "Legacy attack baseline replacement overrides combat.bab for this attack mode",
            children: [babContribution(runtime, target)],
          },
        ),
      ]
    : [
        runtime.replacement(target, 0, `${target}.base`, labelForTarget(target)),
        babContribution(runtime, target),
      ];
  const modifiers = runtime.directModifiers(target, {
    attack: definition,
    context,
    reportExclusions: true,
  });
  return runtime.result(
    target,
    [
      ...attackBaseline,
      {
        ...runtime.abilityContribution(definition.attackAbility, target),
        ...(source ? { sourceMetadata: source } : {}),
      },
      runtime.sizeAdjustment(target, -2, "Size modifier"),
      ...(definition.weaponBonus
        ? [
            sourceContribution(
              target,
              definition.weaponBonus,
              `weapon.${definition.id}`,
              "Weapon enhancement",
              "enhancement",
              { ...(definition.source ? { sourceMetadata: definition.source } : {}) },
            ),
          ]
        : []),
      ...(definition.attackBonus
        ? [
            sourceContribution(
              target,
              definition.attackBonus,
              `attack.${definition.id}.profile`,
              "Attack profile adjustment",
              undefined,
              { ...(source ? { sourceMetadata: source } : {}) },
            ),
          ]
        : []),
      ...modifiers.applied,
    ],
    { rollContext: context, excluded: modifiers.excluded },
  );
}

export function evaluateDamage(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  context: RollContext,
): DamageEvaluation {
  const mode = attackModeOf(definition);
  const damageTarget = `damage.${mode}` as TargetId;
  const modifiers = runtime.directModifiers(damageTarget, {
    attack: definition,
    context,
    reportExclusions: true,
  });
  const abilityValue = definition.damageAbility
    ? runtime.abilityModifierValue(definition.damageAbility)
    : 0;
  // A Strength penalty applies in full even to off-hand and two-handed attacks.
  const multiplier =
    abilityValue < 0 && definition.damageAbility === "str"
      ? 1
      : (definition.damageAbilityMultiplier ?? 1);
  const damageContributions: Contribution[] = definition.damageAbility
    ? [
        runtime.replacement(
          damageTarget,
          0,
          "damage.base",
          "Base damage modifier",
        ),
        sourceContribution(
          damageTarget,
          Math.floor(abilityValue * multiplier),
          `ability.${definition.damageAbility}.damage`,
          `${definition.damageAbility.toUpperCase()} damage (${multiplier}×)`,
          undefined,
          {
            children: [
              sourceContribution(
                `ability.${definition.damageAbility}` as TargetId,
                runtime.abilityScore(definition.damageAbility).value,
                `ability.${definition.damageAbility}.score`,
                `${definition.damageAbility.toUpperCase()} score`,
                undefined,
                {
                  children: runtime.abilityScore(definition.damageAbility)
                    .contributions,
                },
              ),
            ],
          },
        ),
        ...modifiers.applied,
      ]
    : [
        runtime.replacement(
          damageTarget,
          0,
          "damage.base",
          "Base damage modifier",
        ),
        ...modifiers.applied,
      ];
  if (
    definition.damageAbilityMaximum !== undefined &&
    definition.damageAbility
  ) {
    const abilityPart = damageContributions.find(
      (item) => item.source === `ability.${definition.damageAbility}.damage`,
    );
    if (abilityPart && abilityPart.value > definition.damageAbilityMaximum)
      damageContributions.push(
        base(
          damageTarget,
          definition.damageAbilityMaximum - abilityPart.value,
          `weapon.${definition.id}.strength-rating`,
          "Weapon Strength rating limit",
        ),
      );
  }
  if (definition.weaponBonus)
    damageContributions.push(
      sourceContribution(
        damageTarget,
        definition.weaponBonus,
        `weapon.${definition.id}`,
        "Weapon enhancement",
        "enhancement",
        { ...(definition.source ? { sourceMetadata: definition.source } : {}) },
      ),
    );
  const damageResult = runtime.result(damageTarget, damageContributions, {
    rollContext: context,
    excluded: modifiers.excluded,
  });
  const modifier = damageResult.value;
  return {
    formula: `${definition.baseDamage.count}d${definition.baseDamage.sides}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`,
    dice: definition.baseDamage,
    modifier,
    contributions: damageResult.contributions,
    ...(damageResult.excluded ? { excluded: damageResult.excluded } : {}),
  };
}

/**
 * Extra attacks are an action-level fact, not a per-weapon one. The count is
 * evaluated once with full-attack context and attached to the action's primary
 * attack, so Haste can never contribute one extra attack per weapon.
 */
export interface ExtraAttackEvaluation {
  result: EvaluationResult;
  excluded: ExcludedContribution[];
}

export function evaluateExtraAttacks(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  options: {
    flags?: string[];
    excludeFlags?: string[];
    touch?: boolean;
  } = {},
): ExtraAttackEvaluation {
  const mode = attackModeOf(definition);
  const target = `attacks.extra.${mode}` as TargetId;
  if (definition.extraAttackEligible === false)
    return {
      result: { target, value: 0, contributions: [] },
      excluded: [],
    };
  const context = attackContext(runtime, definition, {
    kind: "attack",
    fullAttack: true,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
  });
  const modifiers = runtime.directModifiers(target, {
    attack: definition,
    context,
    reportExclusions: true,
  });
  const evaluation = runtime.result(target, modifiers.applied, {
    rollContext: context,
    excluded: modifiers.excluded,
  });
  if (!Number.isSafeInteger(evaluation.value) || evaluation.value < 0)
    throw new Error(
      `Extra attack count must be a nonnegative integer for ${definition.id}`,
    );
  return { result: evaluation, excluded: modifiers.excluded };
}

export function iterativeCount(
  runtime: RulesRuntime,
  definition: AttackDefinition,
): number {
  return definition.iterative === false
    ? 1
    : Math.min(4, Math.max(1, Math.ceil(runtime.bab().value / 5)));
}

function attackRole(
  definition: AttackDefinition,
  index: number,
): ActionAttackPlan["role"] {
  if (index === 0) return "primary";
  return definition.attackTags?.includes("weapon.off-hand")
    ? "off-hand"
    : "secondary";
}

export interface ActionRequest {
  action: "standardAttack" | "fullAttack" | "maneuver";
  attackIds?: string[];
  flags?: string[];
  /** Situational flags withheld for this action, e.g. `combat-expertise`. */
  excludeFlags?: string[];
  touch?: boolean;
  maneuver?: ManeuverId;
  actorId?: string;
  targetId?: string;
}

function evaluateSequence(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  options: {
    withExtras: boolean;
    /** A full-attack action has BAB iteratives; a standard attack does not. */
    withIteratives: boolean;
    flags?: string[];
    excludeFlags?: string[];
    touch?: boolean;
    maneuver?: ManeuverId;
    actorId?: string;
    targetId?: string;
    extraEvaluation?: ExtraAttackEvaluation;
  },
): ActionAttackPlan {
  const mode = attackModeOf(definition);
  const target = `attack.${mode}` as TargetId;
  const steps: ActionPlanStep[] = [];
  const primaryContext = attackContext(runtime, definition, {
    kind: "attack",
    fullAttack: true,
    attackIndex: 0,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    maneuver: options.maneuver,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.targetId ? { targetId: options.targetId } : {}),
  });
  const primary = evaluateAttack(runtime, definition, primaryContext);
  steps.push({ index: 0, role: "primary", modifier: primary.value, evaluation: primary });
  let index = 1;
  if (options.withExtras) {
    const extras = options.extraEvaluation ?? evaluateExtraAttacks(runtime, definition, options);
    // Resource boundary, not a game-rule truncation: invalid huge authored
    // sequences fail explicitly before allocating or persisting them.
    if (extras.result.value + iterativeCount(runtime, definition) > 256)
      throw new Error(
        `Attack sequence exceeds the supported 256 rolls for ${definition.id}`,
      );
    for (let count = 0; count < extras.result.value; count++) {
      steps.push({
        index,
        role: "extra",
        modifier: primary.value,
        evaluation: {
          ...primary,
          contributions: [
            ...primary.contributions,
            sourceContribution(
              target,
              0,
              `attacks.extra.${mode}`,
              "Additional attack at highest bonus",
              undefined,
              { children: extras.result.contributions },
            ),
          ],
        },
      });
      index += 1;
    }
  }
  // BAB iteratives belong to every selected weapon's own sequence, but only
  // inside a full-attack action.
  const iterations = options.withIteratives
    ? iterativeCount(runtime, definition)
    : 1;
  for (let step = 1; step < iterations; step++) {
    const context = attackContext(runtime, definition, {
      kind: "attack",
      fullAttack: true,
      attackIndex: index,
      flags: options.flags,
      excludeFlags: options.excludeFlags,
      maneuver: options.maneuver,
      ...(options.touch !== undefined ? { touch: options.touch } : {}),
    });
    const evaluation = evaluateAttack(runtime, definition, context);
    const value = evaluation.value - 5 * step;
    steps.push({
      index,
      role: "iterative",
      modifier: value,
      evaluation: {
        ...evaluation,
        value,
        contributions: [
          ...evaluation.contributions,
          base(
            target,
            -5 * step,
            "combat.bab.iterative",
            `Iterative attack ${step + 1}`,
          ),
        ],
      },
    });
    index += 1;
  }
  return {
    attackId: definition.id,
    name: definition.name,
    role: "primary",
    context: primaryContext,
    steps,
  };
}

/**
 * Builds an explicit action plan. Multiple weapons stay separate members with
 * roles; their sequences are never concatenated into a fake combined full
 * attack, and action-level extras attach to the primary attack only.
 */
export function buildActionPlan(
  runtime: RulesRuntime,
  request: ActionRequest,
): ActionPlan {
  const characterId = runtime.character.id;
  const flags = request.flags;
  if (request.action === "maneuver") {
    const evaluation = evaluateCombatManeuver(runtime, "cmb", {
      maneuver: request.maneuver,
      flags,
      excludeFlags: request.excludeFlags,
    });
    return {
      id: `action:${characterId}:maneuver:${request.maneuver ?? "cmb"}`,
      characterId,
      action: "maneuver",
      label: `CMB${request.maneuver ? ` (${request.maneuver})` : ""}`,
      context: evaluation.rollContext ?? {
        kind: "maneuver",
        ...(request.maneuver ? { maneuver: request.maneuver } : {}),
        flags: [...runtime.enabledContextFlags(), ...(flags ?? [])],
      },
      attacks: [],
      evaluation,
      excluded: evaluation.excluded ?? [],
    };
  }
  const ids = request.attackIds?.length
    ? request.attackIds
    : runtime.attackDefinitions.map((definition) => definition.id);
  if (ids.length === 0) throw new Error("An attack action requires an attack");
  const definitions = ids.map((id) => {
    const definition = runtime.attackDefinitions.find((item) => item.id === id);
    if (!definition) throw new Error(`Unknown attack: ${id}`);
    return definition;
  });
  if (request.action === "standardAttack" && definitions.length > 1)
    throw new Error("A standard attack action selects exactly one attack");
  const fullAttack = request.action === "fullAttack";
  // Action-level extras are computed once, for the primary attack, before any
  // weapon's sequence is built.
  const primary = definitions[0]!;
  const extraEvaluation = fullAttack
    ? evaluateExtraAttacks(runtime, primary, {
        flags,
        excludeFlags: request.excludeFlags,
        ...(request.touch !== undefined ? { touch: request.touch } : {}),
      })
    : undefined;
  const attacks = definitions.map((definition, index) => {
    const plan = evaluateSequence(runtime, definition, {
      withExtras: fullAttack && index === 0,
      withIteratives: fullAttack,
      ...(extraEvaluation ? { extraEvaluation } : {}),
      flags,
      excludeFlags: request.excludeFlags,
      touch: request.touch,
      maneuver: request.maneuver,
      actorId: request.actorId,
      targetId: request.targetId,
    });
    return {
      ...plan,
      role: attackRole(definition, index),
      name: definition.name,
    };
  });
  return {
    id: `action:${characterId}:${request.action}:${ids.join("+")}`,
    characterId,
    action: request.action,
    label:
      request.action === "standardAttack"
        ? `${primary.name} standard attack`
        : `${ids.length > 1 ? `${ids.length} weapons · ` : ""}full attack`,
    context: attacks[0]!.context,
    attacks,
    excluded: extraEvaluation?.excluded ?? [],
  };
}

/** This weapon's default full-attack action, plus its standard attack. */
export function deriveAttack(
  runtime: RulesRuntime,
  definition: AttackDefinition,
): DerivedAttack {
  const damageContext = attackContext(runtime, definition, { kind: "damage" });
  const action = buildActionPlan(runtime, {
    action: "fullAttack",
    attackIds: [definition.id],
  });
  return {
    definition,
    attack: evaluateAttack(
      runtime,
      definition,
      attackContext(runtime, definition, { kind: "attack" }),
    ),
    damage: evaluateDamage(runtime, definition, damageContext),
    fullAttack: action.attacks[0]!.steps.map((step) => step.evaluation),
    action,
  };
}

export interface AttackRollOptions {
  action?: "standardAttack" | "fullAttack";
  attackIds?: string[];
  flags?: string[];
  /** Situational flags withheld for this roll. */
  excludeFlags?: string[];
  touch?: boolean;
  maneuver?: ManeuverId;
}

/**
 * The authoritative roll plan for one sequence member. A full attack is the
 * default so existing callers keep their meaning; `action: "standardAttack"`
 * asks for the single-attack plan instead.
 */
export function attackRollPlan(
  runtime: RulesRuntime,
  attackId: string,
  attackIndex = 0,
  options: AttackRollOptions = {},
): RollPlan {
  const definition = runtime.attackDefinitions.find(
    (item) => item.id === attackId,
  );
  if (!definition) throw new Error(`Unknown attack: ${attackId}`);
  if (!Number.isInteger(attackIndex) || attackIndex < 0)
    throw new Error(`Unknown attack sequence index ${attackIndex}`);
  const action = options.action ?? "fullAttack";
  if (action === "standardAttack") {
    if (attackIndex !== 0)
      throw new Error("A standard attack has a single sequence member");
    const context = attackContext(runtime, definition, {
      kind: "attack",
      fullAttack: false,
      flags: options.flags,
      excludeFlags: options.excludeFlags,
      maneuver: options.maneuver,
      ...(options.touch !== undefined ? { touch: options.touch } : {}),
    });
    const evaluation = evaluateAttack(runtime, definition, context);
    return {
      id: `attack:${runtime.character.id}:${attackId}:standard`,
      characterId: runtime.character.id,
      label: `${definition.name} standard attack`,
      dice: [{ sides: 20, count: 1 }],
      modifier: evaluation.value,
      metadata: {
        kind: "attack",
        target: evaluation.target,
        attackId,
        attackIndex: 0,
        action: "standardAttack",
        fullAttack: false,
        ...(options.flags ? { flags: options.flags } : {}),
        ...(options.excludeFlags ? { excludeFlags: options.excludeFlags } : {}),
        ...(options.touch !== undefined ? { touch: options.touch } : {}),
        ...(context.flags?.length ? { contextFlags: context.flags } : {}),
      },
    };
  }
  const plan = buildActionPlan(runtime, {
    action: "fullAttack",
    attackIds: options.attackIds ?? [attackId],
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    maneuver: options.maneuver,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
  });
  const attack = plan.attacks.find((item) => item.attackId === attackId);
  if (!attack)
    throw new Error(`Attack ${attackId} is not part of this action plan`);
  const step = attack.steps.find((item) => item.index === attackIndex);
  if (!step)
    throw new Error(
      `Unknown attack sequence index ${attackIndex} for ${attackId}`,
    );
  return {
    id: `attack:${runtime.character.id}:${attackId}${attackIndex ? `:${attackIndex}` : ""}`,
    characterId: runtime.character.id,
    label: `${definition.name} attack${attackIndex ? ` ${attackIndex + 1}` : ""}`,
    dice: [{ sides: 20, count: 1 }],
    modifier: step.modifier,
    metadata: {
      kind: "attack",
      target: step.evaluation.target,
      attackId,
      attackIndex,
      action: "fullAttack",
      fullAttack: true,
      stepRole: step.role,
      ...(plan.attacks.length > 1
        ? { attackIds: plan.attacks.map((item) => item.attackId) }
        : {}),
      ...(options.flags ? { flags: options.flags } : {}),
      ...(options.touch !== undefined ? { touch: options.touch } : {}),
      ...(options.maneuver ? { maneuver: options.maneuver } : {}),
    },
  };
}

export function maneuverRollPlan(
  runtime: RulesRuntime,
  maneuver?: ManeuverId,
  flags: string[] = [],
  excludeFlags: string[] = [],
): RollPlan {
  const evaluation = evaluateCombatManeuver(runtime, "cmb", {
    maneuver,
    flags,
    excludeFlags,
  });
  return {
    id: `maneuver:${runtime.character.id}:${maneuver ?? "cmb"}`,
    characterId: runtime.character.id,
    label: `CMB${maneuver ? ` ${maneuver}` : ""}`,
    dice: [{ sides: 20, count: 1 }],
    modifier: evaluation.value,
    metadata: {
      kind: "maneuver",
      target: "cmb",
      ...(maneuver ? { maneuver } : {}),
      ...(flags.length ? { flags } : {}),
      ...(excludeFlags.length ? { excludeFlags } : {}),
    },
  };
}

/** Exclusions of a contextual action, flattened for the audit trail. */
export function actionExclusions(plan: ActionPlan): ExcludedContribution[] {
  return [
    ...plan.excluded,
    ...plan.attacks.flatMap((attack) =>
      attack.steps.flatMap((step) => step.evaluation.excluded ?? []),
    ),
  ];
}
