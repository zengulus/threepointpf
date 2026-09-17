import type { RollPlan } from "@threepointpf/dice";
import {
  type ActionAttackPlan,
  type ActionKind,
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
  type RollDefense,
  type RollKind,
  type TargetContext,
  type TargetId,
} from "@threepointpf/rules-schema";
import { base, lookup, sourceContribution } from "./contributions.js";
import { babContribution, evaluateCombatManeuver } from "./defenses.js";
import { attackModeOf, resolveContextFlags } from "./effects.js";
import { labelForTarget } from "./labels.js";
import { evaluateCriticalRange } from "./outcomes.js";
import type { RulesRuntime } from "./runtime.js";

export { attackModeOf };

export interface AttackContextInput {
  kind: RollKind;
  /** Which action this roll belongs to. */
  actionKind: ActionKind;
  /** Identity of the action instance; equals its `ActionPlan` id. */
  actionId?: string;
  /** Position of this roll within its own weapon's sequence. */
  sequenceIndex?: number;
  /** Weapons the action selects, in order. */
  attackIds?: string[];
  touch?: boolean;
  maneuver?: ManeuverId;
  /** This roll is the critical consequence of the attack it follows. */
  criticalDamage?: boolean;
  flags?: string[];
  /** Situational flags withheld for this roll. */
  excludeFlags?: string[];
  /** Known defense the roll is compared against. */
  defense?: RollDefense;
  target?: TargetContext;
}

function targetContextOf(input: AttackContextInput): TargetContext | undefined {
  if (!input.target && !input.defense) return undefined;
  return {
    ...(input.target ?? {}),
    ...(input.defense ? { defense: input.defense } : {}),
  };
}

/**
 * The contextual identity of one attack or damage roll. Enabled feature flags
 * (Combat Expertise and friends) and caller-supplied situational flags are both
 * visible to effect applicability; the action kind and position describe what
 * the actor is doing rather than what the character is.
 */
export function attackContext(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  input: AttackContextInput,
): RollContext {
  const attackTags = definition.attackTags ?? [];
  const target = targetContextOf(input);
  return {
    kind: input.kind,
    actorCharacterId: runtime.character.id,
    action: {
      kind: input.actionKind,
      ...(input.actionId ? { sequenceId: input.actionId } : {}),
      ...(input.sequenceIndex !== undefined
        ? { sequenceIndex: input.sequenceIndex }
        : {}),
      ...(input.attackIds ? { attackIds: input.attackIds } : {}),
    },
    attackId: definition.id,
    attackTags,
    mode: attackModeOf(definition),
    touch: input.touch ?? attackTags.includes("weapon.touch"),
    ...(input.maneuver ? { maneuver: input.maneuver } : {}),
    ...(input.criticalDamage ? { criticalDamage: true } : {}),
    flags: resolveContextFlags(
      runtime.enabledContextFlags(),
      input.flags,
      input.excludeFlags,
    ),
    ...(input.excludeFlags?.length ? { excludeFlags: input.excludeFlags } : {}),
    ...(target ? { target } : {}),
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

export interface DamageRollOptions {
  /** The action this damage roll belongs to; standalone plans default to a full attack. */
  action?: ActionKind;
  actionId?: string;
  /** The sequence member whose damage this is. */
  attackIndex?: number;
  attackIds?: string[];
  touch?: boolean;
  flags?: string[];
  excludeFlags?: string[];
  /** Roll the damage twice and add it together, for a critical hit. */
  criticalDamage?: boolean;
}

function attackDefinitionFor(
  runtime: RulesRuntime,
  attackId: string,
): AttackDefinition {
  const definition = runtime.attackDefinitions.find(
    (item) => item.id === attackId,
  );
  if (!definition) throw new Error(`Unknown attack: ${attackId}`);
  return definition;
}

/**
 * One step's damage roll. The dice are the weapon's own base dice, the modifier
 * is the contextual damage evaluation, and a critical hit rolls the same damage
 * a second time instead of a caller inventing extra dice.
 */
function damagePlanFrom(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  context: RollContext,
  criticalDamage = false,
): RollPlan {
  const evaluation = evaluateDamage(runtime, definition, context);
  const target = `damage.${attackModeOf(definition)}` as TargetId;
  const step = context.action.sequenceIndex ?? 0;
  const standard = context.action.kind === "standardAttack";
  const suffix = standard ? ":standard" : step ? `:${step}` : "";
  return {
    id: `damage:${runtime.character.id}:${definition.id}${suffix}${criticalDamage ? ":critical" : ""}`,
    characterId: runtime.character.id,
    label: `${definition.name} damage${standard || step === 0 ? "" : ` ${step + 1}`}${criticalDamage ? " (critical)" : ""}`,
    dice: [
      {
        sides: definition.baseDamage.sides,
        count: definition.baseDamage.count * (criticalDamage ? 2 : 1),
      },
    ],
    modifier: evaluation.modifier * (criticalDamage ? 2 : 1),
    context,
    outcomePolicy: runtime.outcomePolicies.plain,
    provenance: {
      // A critical hit rolls the damage again, so the contributions gain one
      // more copy of the modifier and still sum to the plan's modifier.
      modifier: criticalDamage
        ? [
            ...evaluation.contributions,
            sourceContribution(
              target,
              evaluation.modifier,
              "damage.critical",
              "Critical hit",
              undefined,
              { note: "The damage is rolled a second time and added" },
            ),
          ]
        : evaluation.contributions,
      excluded: evaluation.excluded ?? [],
    },
  };
}

/**
 * The authoritative damage plan of one sequence member. A standalone plan is
 * identical to the same step's damage inside its action, so an action's roll
 * list can be resolved member by member.
 */
export function damageRollPlan(
  runtime: RulesRuntime,
  attackId: string,
  options: DamageRollOptions = {},
): RollPlan {
  const action = options.action ?? "fullAttack";
  const attackIds = options.attackIds ?? [attackId];
  const attackIndex = options.attackIndex ?? 0;
  if (!Number.isInteger(attackIndex) || attackIndex < 0)
    throw new Error(`Unknown attack sequence index ${attackIndex}`);
  if (action === "standardAttack" && attackIndex !== 0)
    throw new Error("A standard attack has a single sequence member");
  // The same action is built to validate the member, exactly as an attack plan
  // validates its own sequence index, so a damage plan can never name a step
  // the action does not have.
  const plan = buildActionPlan(runtime, {
    action,
    attackIds,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
  });
  const attack = plan.attacks.find((item) => item.attackId === attackId);
  if (!attack)
    throw new Error(`Attack ${attackId} is not part of this action plan`);
  if (!attack.steps.some((step) => step.index === attackIndex))
    throw new Error(
      `Unknown damage sequence index ${attackIndex} for ${attackId}`,
    );
  const definition = attackDefinitionFor(runtime, attackId);
  const context = attackContext(runtime, definition, {
    kind: "damage",
    actionKind: action,
    actionId: actionPlanId(runtime.character.id, action, attackIds),
    sequenceIndex: attackIndex,
    attackIds,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
    ...(options.criticalDamage ? { criticalDamage: true } : {}),
  });
  return damagePlanFrom(
    runtime,
    definition,
    context,
    options.criticalDamage ?? false,
  );
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
    actionId?: string;
    attackIds?: string[];
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
    actionKind: "fullAttack",
    ...(options.actionId ? { actionId: options.actionId } : {}),
    ...(options.attackIds ? { attackIds: options.attackIds } : {}),
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
  action: ActionKind;
  attackIds?: string[];
  flags?: string[];
  /** Situational flags withheld for this action, e.g. `combat-expertise`. */
  excludeFlags?: string[];
  touch?: boolean;
  maneuver?: ManeuverId;
  /** Known defense the action's rolls are compared against. */
  defense?: RollDefense;
  target?: TargetContext;
}

/** The stable identity of an action instance; every roll of it names this id. */
export function actionPlanId(
  characterId: string,
  action: ActionKind,
  attackIds: readonly string[],
): string {
  if (action === "maneuver") return `action:${characterId}:maneuver`;
  return `action:${characterId}:${action}:${attackIds.join("+")}`;
}

function attackRollId(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  action: ActionKind,
  index: number,
): string {
  const characterId = runtime.character.id;
  if (action === "standardAttack")
    return `attack:${characterId}:${definition.id}:standard`;
  return `attack:${characterId}:${definition.id}${index ? `:${index}` : ""}`;
}

function attackRollLabel(
  definition: AttackDefinition,
  action: ActionKind,
  index: number,
): string {
  if (action === "standardAttack") return `${definition.name} standard attack`;
  return `${definition.name} attack${index ? ` ${index + 1}` : ""}`;
}

/**
 * One resolvable roll of an attack's sequence. The plan carries the context it
 * was evaluated in, the policy that interprets raw faces, and the effective
 * threat range with its provenance.
 */
function attackRollFor(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  evaluation: EvaluationResult,
  options: {
    action: ActionKind;
    index: number;
    defense?: RollDefense;
    target?: TargetContext;
  },
): RollPlan {
  const context = evaluation.rollContext;
  if (!context)
    throw new Error(
      `Attack evaluation for ${definition.id} produced no roll context`,
    );
  const criticalRange = evaluateCriticalRange(runtime, definition, context);
  return {
    id: attackRollId(runtime, definition, options.action, options.index),
    characterId: runtime.character.id,
    label: attackRollLabel(definition, options.action, options.index),
    dice: [{ sides: 20, count: 1 }],
    modifier: evaluation.value,
    context,
    outcomePolicy: runtime.outcomePolicies.attack,
    criticalRange: criticalRange.effective,
    provenance: {
      modifier: evaluation.contributions,
      excluded: evaluation.excluded ?? [],
      criticalRange,
    },
  };
}

function evaluateSequence(
  runtime: RulesRuntime,
  definition: AttackDefinition,
  options: {
    action: ActionKind;
    actionId: string;
    attackIds: string[];
    withExtras: boolean;
    /** A full-attack action has BAB iteratives; a standard attack does not. */
    withIteratives: boolean;
    flags?: string[];
    excludeFlags?: string[];
    touch?: boolean;
    maneuver?: ManeuverId;
    defense?: RollDefense;
    target?: TargetContext;
    extraEvaluation?: ExtraAttackEvaluation;
  },
): ActionAttackPlan {
  const mode = attackModeOf(definition);
  const target = `attack.${mode}` as TargetId;
  const steps: ActionPlanStep[] = [];
  const contextInput = {
    actionKind: options.action,
    actionId: options.actionId,
    attackIds: options.attackIds,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    maneuver: options.maneuver,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
    ...(options.defense ? { defense: options.defense } : {}),
    ...(options.target ? { target: options.target } : {}),
  } as const;
  // A damage roll is never compared against a defense, so its context carries
  // neither the defense nor the target the attack roll was made against.
  const damageContextFields = {
    actionKind: options.action,
    actionId: options.actionId,
    attackIds: options.attackIds,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
  } as const;
  const damageFor = (sequenceIndex: number) =>
    damagePlanFrom(
      runtime,
      definition,
      attackContext(runtime, definition, {
        kind: "damage",
        sequenceIndex,
        ...damageContextFields,
      }),
    );
  const primaryContext = attackContext(runtime, definition, {
    kind: "attack",
    sequenceIndex: 0,
    ...contextInput,
  });
  const primary = evaluateAttack(runtime, definition, primaryContext);
  steps.push({
    index: 0,
    role: "primary",
    modifier: primary.value,
    evaluation: primary,
    roll: attackRollFor(runtime, definition, primary, {
      action: options.action,
      index: 0,
    }),
    damage: damageFor(0),
  });
  let index = 1;
  if (options.withExtras) {
    const extras =
      options.extraEvaluation ??
      evaluateExtraAttacks(runtime, definition, {
        flags: options.flags,
        excludeFlags: options.excludeFlags,
        touch: options.touch,
        actionId: options.actionId,
        attackIds: options.attackIds,
      });
    // Resource boundary, not a game-rule truncation: invalid huge authored
    // sequences fail explicitly before allocating or persisting them.
    if (extras.result.value + iterativeCount(runtime, definition) > 256)
      throw new Error(
        `Attack sequence exceeds the supported 256 rolls for ${definition.id}`,
      );
    for (let count = 0; count < extras.result.value; count++) {
      const evaluation: EvaluationResult = {
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
      };
      steps.push({
        index,
        role: "extra",
        modifier: primary.value,
        evaluation,
        roll: attackRollFor(runtime, definition, evaluation, {
          action: options.action,
          index,
        }),
        damage: damageFor(index),
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
      sequenceIndex: index,
      ...contextInput,
    });
    const evaluation = evaluateAttack(runtime, definition, context);
    const value = evaluation.value - 5 * step;
    const iterative: EvaluationResult = {
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
    };
    steps.push({
      index,
      role: "iterative",
      modifier: value,
      evaluation: iterative,
      roll: attackRollFor(runtime, definition, iterative, {
        action: options.action,
        index,
      }),
      damage: damageFor(index),
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

function maneuverActionPlan(
  runtime: RulesRuntime,
  request: ActionRequest,
): ActionPlan {
  const characterId = runtime.character.id;
  const evaluation = evaluateCombatManeuver(runtime, "cmb", {
    maneuver: request.maneuver,
    flags: request.flags,
    excludeFlags: request.excludeFlags,
    ...(request.defense ? { defense: request.defense } : {}),
    ...(request.target ? { target: request.target } : {}),
  });
  const context = evaluation.rollContext;
  if (!context) throw new Error("Maneuver evaluation produced no roll context");
  const roll: RollPlan = {
    id: `maneuver:${characterId}:${request.maneuver ?? "cmb"}`,
    characterId,
    label: `CMB${request.maneuver ? ` ${request.maneuver}` : ""}`,
    dice: [{ sides: 20, count: 1 }],
    modifier: evaluation.value,
    context,
    outcomePolicy: runtime.outcomePolicies.maneuver,
    provenance: {
      modifier: evaluation.contributions,
      excluded: evaluation.excluded ?? [],
    },
  };
  return {
    id: actionPlanId(characterId, "maneuver", []),
    characterId,
    action: "maneuver",
    label: `CMB${request.maneuver ? ` (${request.maneuver})` : ""}`,
    context,
    attacks: [],
    evaluation,
    excluded: evaluation.excluded ?? [],
    rolls: [roll],
  };
}

/**
 * Builds an explicit action plan. Multiple weapons stay separate members with
 * roles; their sequences are never concatenated into a fake combined full
 * attack, and action-level extras attach to the primary attack only. Every step
 * carries its own resolvable roll.
 */
export function buildActionPlan(
  runtime: RulesRuntime,
  request: ActionRequest,
): ActionPlan {
  const characterId = runtime.character.id;
  if (request.action === "maneuver") return maneuverActionPlan(runtime, request);
  const flags = request.flags;
  // An omitted selection means "every authored weapon"; an explicit empty
  // selection is a contradiction, not a synonym for it.
  if (request.attackIds !== undefined && request.attackIds.length === 0)
    throw new Error("An attack action requires an attack");
  const ids =
    request.attackIds ?? runtime.attackDefinitions.map((definition) => definition.id);
  if (ids.length === 0) throw new Error("An attack action requires an attack");
  if (new Set(ids).size !== ids.length)
    throw new Error("A weapon may be selected once per action");
  const definitions = ids.map((id) => {
    const definition = runtime.attackDefinitions.find((item) => item.id === id);
    if (!definition) throw new Error(`Unknown attack: ${id}`);
    return definition;
  });
  if (request.action === "standardAttack" && definitions.length > 1)
    throw new Error("A standard attack action selects exactly one attack");
  const fullAttack = request.action === "fullAttack";
  const actionId = actionPlanId(characterId, request.action, ids);
  // Action-level extras are computed once, for the primary attack, before any
  // weapon's sequence is built.
  const primary = definitions[0]!;
  const extraEvaluation = fullAttack
    ? evaluateExtraAttacks(runtime, primary, {
        flags,
        excludeFlags: request.excludeFlags,
        actionId,
        attackIds: ids,
        ...(request.touch !== undefined ? { touch: request.touch } : {}),
      })
    : undefined;
  const attacks = definitions.map((definition, index) => {
    const plan = evaluateSequence(runtime, definition, {
      action: request.action,
      actionId,
      attackIds: ids,
      withExtras: fullAttack && index === 0,
      withIteratives: fullAttack,
      ...(extraEvaluation ? { extraEvaluation } : {}),
      flags,
      excludeFlags: request.excludeFlags,
      ...(request.touch !== undefined ? { touch: request.touch } : {}),
      ...(request.maneuver ? { maneuver: request.maneuver } : {}),
      ...(request.defense ? { defense: request.defense } : {}),
      ...(request.target ? { target: request.target } : {}),
    });
    return {
      ...plan,
      role: attackRole(definition, index),
      name: definition.name,
    };
  });
  return {
    id: actionId,
    characterId,
    action: request.action,
    label:
      request.action === "standardAttack"
        ? `${primary.name} standard attack`
        : `${ids.length > 1 ? `${ids.length} weapons · ` : ""}full attack`,
    context: attacks[0]!.context,
    attacks,
    excluded: extraEvaluation?.excluded ?? [],
    rolls: attacks.flatMap((attack) =>
      attack.steps.flatMap((step) =>
        step.damage ? [step.roll, step.damage] : [step.roll],
      ),
    ),
  };
}

/**
 * This weapon's default full-attack action, plus its standard attack. The
 * uncontextualized `attack` value is the standard-attack roll, so a sheet query
 * stays meaningful without a full-attack action.
 */
export function deriveAttack(
  runtime: RulesRuntime,
  definition: AttackDefinition,
): DerivedAttack {
  const damageContext = attackContext(runtime, definition, {
    kind: "damage",
    actionKind: "standardAttack",
  });
  const action = buildActionPlan(runtime, {
    action: "fullAttack",
    attackIds: [definition.id],
  });
  return {
    definition,
    attack: evaluateAttack(
      runtime,
      definition,
      attackContext(runtime, definition, {
        kind: "attack",
        actionKind: "standardAttack",
      }),
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
  /** Known defense the roll is compared against; absent means hit stays unresolved. */
  defense?: RollDefense;
  target?: TargetContext;
}

/**
 * The authoritative roll plan for one sequence member. A full attack is the
 * default so existing callers keep their meaning; `action: "standardAttack"`
 * asks for the single-attack plan instead. Both paths build the same action
 * plan, so a standalone plan is always identical to the same roll inside one.
 */
export function attackRollPlan(
  runtime: RulesRuntime,
  attackId: string,
  attackIndex = 0,
  options: AttackRollOptions = {},
): RollPlan {
  const action = options.action ?? "fullAttack";
  const attackIds = options.attackIds ?? [attackId];
  if (!Number.isInteger(attackIndex) || attackIndex < 0)
    throw new Error(`Unknown attack sequence index ${attackIndex}`);
  if (action === "standardAttack" && attackIndex !== 0)
    throw new Error("A standard attack has a single sequence member");
  const plan = buildActionPlan(runtime, {
    action,
    attackIds,
    flags: options.flags,
    excludeFlags: options.excludeFlags,
    maneuver: options.maneuver,
    ...(options.touch !== undefined ? { touch: options.touch } : {}),
    ...(options.defense ? { defense: options.defense } : {}),
    ...(options.target ? { target: options.target } : {}),
  });
  const attack = plan.attacks.find((item) => item.attackId === attackId);
  if (!attack)
    throw new Error(`Attack ${attackId} is not part of this action plan`);
  const step = attack.steps.find((item) => item.index === attackIndex);
  if (!step)
    throw new Error(
      `Unknown attack sequence index ${attackIndex} for ${attackId}`,
    );
  return step.roll;
}

export function maneuverRollPlan(
  runtime: RulesRuntime,
  maneuver?: ManeuverId,
  options: {
    flags?: string[];
    excludeFlags?: string[];
    defense?: RollDefense;
    target?: TargetContext;
  } = {},
): RollPlan {
  return maneuverActionPlan(runtime, {
    action: "maneuver",
    maneuver,
    ...options,
  }).rolls[0]!;
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

export type { AttackMode };
