import {
  isSelectorTarget,
  type AttackDefinition,
  type AttackSelector,
  type CharacterInput,
  type ContextualModifiers,
  type Contribution,
  type Effect,
  type EffectApplicability,
  type EvaluationResult,
  type ExcludedContribution,
  type FeatureCatalog,
  type RollContext,
  type TargetId,
} from "@threepointpf/rules-schema";
import { lookup, sourceContribution, sum } from "./contributions.js";
import { labelForTarget } from "./labels.js";

export type ModifierEffect = Extract<Effect, { kind: "modifier" }>;
export type ReplaceBaseEffect = Extract<Effect, { kind: "replaceBase" }>;

/**
 * Feature-instance effects. Older saves copied definition effects into
 * instances; explicit authored effects remain authoritative and an empty array
 * opts into catalog content.
 */
export function collectFeatureEffects(
  character: CharacterInput,
  catalog: FeatureCatalog = {},
): Effect[] {
  const effects: Effect[] = [];
  const seenDefinitions = new Set<string>();
  const groupWinners = new Map<string, string>();
  const activeDefinitions = character.features.filter(
    (item) => item.enabled && item.definitionId && !item.effects.length,
  );
  for (const feature of activeDefinitions) {
    const definition = lookup(catalog, feature.definitionId!);
    if (!definition?.exclusiveGroup) continue;
    const current = groupWinners.get(definition.exclusiveGroup);
    if (
      !current ||
      (lookup(catalog, current)?.priority ?? 0) < (definition.priority ?? 0)
    )
      groupWinners.set(definition.exclusiveGroup, definition.id);
  }
  for (const feature of character.features) {
    const definition = feature.definitionId
      ? lookup(catalog, feature.definitionId)
      : undefined;
    if (feature.definitionId && !definition && !feature.effects.length)
      throw new Error(`Unknown feature definition ${feature.definitionId}`);
    if (!feature.enabled) continue;
    if (definition && !feature.effects.length) {
      if (seenDefinitions.has(definition.id)) continue;
      if (
        definition.exclusiveGroup &&
        groupWinners.get(definition.exclusiveGroup) !== definition.id
      )
        continue;
      seenDefinitions.add(definition.id);
    }
    for (const effect of feature.effects.length
      ? feature.effects
      : (definition?.effects ?? [])) {
      if (
        effect.kind === "modifier" &&
        effect.target === "ac" &&
        (!effect.appliesTo || effect.appliesTo.length === 0)
      ) {
        throw new Error("AC modifiers require explicit appliesTo contexts");
      }
      const source = effect.source ?? {
        id: `feature.${feature.id}`,
        label: feature.name,
        ...(definition?.source ? { content: definition.source } : {}),
      };
      effects.push({ ...effect, source });
    }
  }
  return effects;
}

/**
 * Situational flags contributed by enabled features. Effects may require these
 * flags, which keeps a conditional tradeoff explicit instead of implicit in a
 * target name.
 */
export function featureContextFlags(
  character: CharacterInput,
  catalog: FeatureCatalog = {},
): string[] {
  const flags = new Set<string>();
  for (const feature of character.features) {
    if (!feature.enabled) continue;
    const definition = feature.definitionId
      ? lookup(catalog, feature.definitionId)
      : undefined;
    for (const flag of feature.contextFlags ?? definition?.contextFlags ?? [])
      flags.add(flag);
  }
  return [...flags].sort();
}

/**
 * The situational flags of a roll: enabled feature flags plus caller-supplied
 * flags, minus any the caller explicitly withholds. Withholding is how a user
 * rolls "without Combat Expertise" while the feature stays enabled.
 */
export function resolveContextFlags(
  enabledFlags: string[],
  flags: string[] = [],
  excludeFlags: string[] = [],
): string[] {
  const merged = [...enabledFlags, ...flags];
  const result = excludeFlags.length
    ? merged.filter((flag) => !excludeFlags.includes(flag))
    : merged;
  return [...new Set(result)].sort();
}

/** Legacy tag/mode selector. New content should use `appliesWhen`. */
export function matchesAttackSelector(
  selector: AttackSelector | undefined,
  attack?: AttackDefinition,
): boolean {
  if (!selector) return true;
  if (!attack) return false;
  const mode =
    attack.mode ??
    (attack.attackTags?.includes("weapon.ranged") ? "ranged" : "melee");
  return (
    (!selector.mode || selector.mode === mode) &&
    (selector.requiredTags ?? []).every((tag) =>
      attack.attackTags?.includes(tag),
    ) &&
    (selector.excludedTags ?? []).every(
      (tag) => !attack.attackTags?.includes(tag),
    )
  );
}

function describeApplicability(applicability: EffectApplicability): string {
  const parts: string[] = [];
  if (applicability.kinds)
    parts.push(`${applicability.kinds.join("/")} rolls`);
  if (applicability.modes) parts.push(`${applicability.modes.join("/")}`);
  if (applicability.touch !== undefined)
    parts.push(applicability.touch ? "touch attacks" : "non-touch attacks");
  if (applicability.fullAttack !== undefined)
    parts.push(
      applicability.fullAttack ? "full-attack membership" : "a standard attack",
    );
  if (applicability.maneuvers)
    parts.push(`maneuvers ${applicability.maneuvers.join(", ")}`);
  if (applicability.requiredTags)
    parts.push(`tags ${applicability.requiredTags.join(", ")}`);
  if (applicability.excludedTags)
    parts.push(`without tags ${applicability.excludedTags.join(", ")}`);
  if (applicability.requiredFlags)
    parts.push(`flags ${applicability.requiredFlags.join(", ")}`);
  if (applicability.excludedFlags)
    parts.push(`without flags ${applicability.excludedFlags.join(", ")}`);
  return parts.join("; ");
}

/**
 * Contextual applicability. A rule with no context cannot be satisfied: the
 * effect is excluded and the exclusion is preserved as provenance rather than
 * being silently dropped.
 */
export function applicabilityOf(
  effect: ModifierEffect,
  options: { attack?: AttackDefinition; context?: RollContext } = {},
): { applies: boolean; reason?: string } {
  const selector = "attackSelector" in effect ? effect.attackSelector : undefined;
  if (selector && !matchesAttackSelector(selector, options.attack))
    return { applies: false, reason: "attack type does not match its selector" };
  const applicability =
    "appliesWhen" in effect ? effect.appliesWhen : undefined;
  if (!applicability) return { applies: true };
  const context = options.context;
  if (!context)
    return {
      applies: false,
      reason: `requires a roll context (${describeApplicability(applicability)})`,
    };
  if (applicability.kinds && !applicability.kinds.includes(context.kind))
    return {
      applies: false,
      reason: `${context.kind} roll is not one of ${applicability.kinds.join("/")}`,
    };
  const tags = context.attackTags ?? options.attack?.attackTags ?? [];
  const mode =
    context.mode ??
    options.attack?.mode ??
    (tags.includes("weapon.ranged") ? "ranged" : undefined);
  if (applicability.modes && (!mode || !applicability.modes.includes(mode)))
    return {
      applies: false,
      reason: `not a ${applicability.modes.join("/")} attack`,
    };
  if (
    applicability.requiredTags &&
    !applicability.requiredTags.every((tag) => tags.includes(tag))
  )
    return {
      applies: false,
      reason: `requires tags ${applicability.requiredTags.join(", ")}`,
    };
  if (
    applicability.excludedTags &&
    applicability.excludedTags.some((tag) => tags.includes(tag))
  )
    return {
      applies: false,
      reason: `excluded for tags ${applicability.excludedTags.join(", ")}`,
    };
  if (
    applicability.touch !== undefined &&
    (context.touch ?? tags.includes("weapon.touch")) !== applicability.touch
  )
    return {
      applies: false,
      reason: applicability.touch
        ? "touch attacks only"
        : "does not apply to touch attacks",
    };
  if (
    applicability.fullAttack !== undefined &&
    (context.fullAttack ?? false) !== applicability.fullAttack
  )
    return {
      applies: false,
      reason: applicability.fullAttack
        ? "full-attack actions only"
        : "standard attacks only",
    };
  if (
    applicability.maneuvers &&
    (!context.maneuver || !applicability.maneuvers.includes(context.maneuver))
  )
    return {
      applies: false,
      reason: `maneuvers ${applicability.maneuvers.join(", ")} only`,
    };
  const flags = context.flags ?? [];
  if (
    applicability.requiredFlags &&
    !applicability.requiredFlags.every((flag) => flags.includes(flag))
  )
    return {
      applies: false,
      reason: `requires flags ${applicability.requiredFlags.join(", ")}`,
    };
  if (
    applicability.excludedFlags &&
    applicability.excludedFlags.some((flag) => flags.includes(flag))
  )
    return {
      applies: false,
      reason: `excluded for flags ${applicability.excludedFlags.join(", ")}`,
    };
  return { applies: true };
}

/**
 * A negative modifier on an ability score is a temporary ability penalty and is
 * marked as such so it can be floored at 1 without clamping scores produced by
 * other mechanisms (replacement baselines and future damage/drain).
 */
export function isAbilityPenalty(
  effect: ModifierEffect,
  target: TargetId,
): boolean {
  return effect.value < 0 && target.startsWith("ability.");
}

export function effectContribution(
  effect: ModifierEffect,
  target: TargetId,
): Contribution {
  return {
    ...sourceContribution(
      target,
      effect.value,
      effect.source?.id ?? "effect",
      effect.source?.label ?? "Effect",
      effect.bonusType,
      {
        appliesTo: "appliesTo" in effect ? effect.appliesTo : undefined,
        ...(isAbilityPenalty(effect, target) ? { abilityPenalty: true } : {}),
      },
    ),
    ...(effect.source?.content
      ? { sourceMetadata: effect.source.content }
      : {}),
  };
}

export function exclusionOf(
  effect: ModifierEffect,
  target: TargetId,
  reason: string,
  context?: RollContext,
): ExcludedContribution {
  return {
    target,
    value: effect.value,
    label: effect.source?.label ?? "Effect",
    source: effect.source?.id ?? "effect",
    ...(effect.bonusType ? { bonusType: effect.bonusType } : {}),
    reason,
    ...(context ? { rollContext: context } : {}),
  };
}

/**
 * Selector targets name a family of concrete facts, so they are only reachable
 * through additive modifiers. `operationMatches` therefore compares concrete
 * targets exactly; selectors are handled by `directModifiers` instead.
 */
export function operationMatches(
  effectTarget: TargetId,
  target: TargetId,
): boolean {
  return effectTarget === target;
}

export function findReplacementEffect(
  effects: Effect[],
  target: TargetId,
): ReplaceBaseEffect | undefined {
  if (isSelectorTarget(target))
    throw new Error(
      `Cannot replace the baseline of selector target ${target}; name a concrete target`,
    );
  const replacements = effects.filter(
    (effect): effect is ReplaceBaseEffect =>
      effect.kind === "replaceBase" && operationMatches(effect.target, target),
  );
  if (replacements.length > 1)
    throw new Error(`Ambiguous active baseline replacements for ${target}`);
  return replacements[0];
}

/** Every active `replaceBase` target, for the up-front ambiguity audit. */
export function activeReplacementTargets(effects: Effect[]): Set<TargetId> {
  const targets = new Set<TargetId>();
  for (const effect of effects)
    if (effect.kind === "replaceBase") targets.add(effect.target);
  return targets;
}

/**
 * Numeric operations have a stable, visible order:
 * replacement/additive typed bonuses → multiplication → minimum → maximum.
 * Each operation contributes only its delta, so provenance still sums to the
 * displayed value.
 */
export function applyEffectOperations(
  effects: Effect[],
  target: TargetId,
  reduced: Contribution[],
): Contribution[] {
  const contributions = [...reduced];
  let value = sum(contributions);
  for (const effect of effects) {
    if (
      effect.kind !== "multiply" ||
      !operationMatches(effect.target, target)
    )
      continue;
    const next = value * effect.factor;
    contributions.push(
      sourceContribution(
        target,
        next - value,
        effect.source?.id ?? "effect",
        effect.source?.label ?? `Multiply by ${effect.factor}`,
        undefined,
        {
          note: `${value} × ${effect.factor} = ${next}; multiplier ×${effect.factor} after additive modifiers`,
          ...(effect.source?.content
            ? { sourceMetadata: effect.source.content }
            : {}),
        },
      ),
    );
    value = next;
  }
  const minimums = effects.filter(
    (effect): effect is Extract<Effect, { kind: "minimum" }> =>
      effect.kind === "minimum" && operationMatches(effect.target, target),
  );
  const minimum = minimums.reduce<Extract<Effect, { kind: "minimum" }> | undefined>(
    (best, effect) => (!best || effect.value > best.value ? effect : best),
    undefined,
  );
  if (minimum && value < minimum.value) {
    contributions.push(
      sourceContribution(
        target,
        minimum.value - value,
        minimum.source?.id ?? "effect",
        minimum.source?.label ?? `Minimum ${minimum.value}`,
        undefined,
        {
          note: `Minimum ${minimum.value}; strongest active lower bound`,
          ...(minimum.source?.content
            ? { sourceMetadata: minimum.source.content }
            : {}),
        },
      ),
    );
    value = minimum.value;
  }
  const maximums = effects.filter(
    (effect): effect is Extract<Effect, { kind: "maximum" }> =>
      effect.kind === "maximum" && operationMatches(effect.target, target),
  );
  const maximum = maximums.reduce<Extract<Effect, { kind: "maximum" }> | undefined>(
    (best, effect) => (!best || effect.value < best.value ? effect : best),
    undefined,
  );
  if (minimum && maximum && minimum.value > maximum.value)
    throw new Error(`Conflicting minimum/maximum effects for ${target}`);
  if (maximum && value > maximum.value) {
    contributions.push(
      sourceContribution(
        target,
        maximum.value - value,
        maximum.source?.id ?? "effect",
        maximum.source?.label ?? `Maximum ${maximum.value}`,
        undefined,
        {
          note: `Maximum ${maximum.value}; strongest active upper bound`,
          ...(maximum.source?.content
            ? { sourceMetadata: maximum.source.content }
            : {}),
        },
      ),
    );
  }
  return contributions;
}

export interface DirectModifierOptions {
  attack?: AttackDefinition;
  baseline?: number;
  context?: RollContext;
  /** Contextual evaluations report every filtered effect; plain ones do not. */
  reportExclusions?: boolean;
}

export interface DirectModifierInput {
  effects: Effect[];
  /** Lazily evaluated so BAB can depend on its own additive modifiers. */
  bab(): EvaluationResult;
}

/**
 * One modifier effect as a contribution for a target, including BAB scaling and
 * the movement cap. Shared by direct modifiers and semantic AC→CMD derivation.
 */
export function buildContribution(
  input: DirectModifierInput,
  effect: ModifierEffect,
  target: TargetId,
  baseline?: number,
): Contribution {
  const contribution = effectContribution(effect, target);
  if (effect.scaling) {
    const bab = input.bab();
    const steps =
      effect.scaling.base + Math.floor(bab.value / effect.scaling.every);
    contribution.value *= steps;
    contribution.note = `${effect.value} × (${effect.scaling.base} + floor(BAB / ${effect.scaling.every}))`;
    contribution.children = [
      sourceContribution(
        "combat.bab",
        bab.value,
        "combat.bab",
        "Base Attack Bonus",
        undefined,
        { children: bab.contributions },
      ),
    ];
  }
  if ("capToBase" in effect && effect.capToBase) {
    if (baseline === undefined)
      throw new Error(`Movement baseline required for ${target}`);
    contribution.value = Math.min(contribution.value, baseline);
    contribution.note = `Increase limited to intrinsic speed ${baseline}; min(${effect.value}, ${baseline})`;
  }
  return contribution;
}

/**
 * Additive modifiers for one target, filtered by contextual applicability.
 * Scaling and movement caps stay explicit here so provenance explains them.
 */
export function collectDirectModifiers(
  input: DirectModifierInput,
  target: TargetId,
  options: DirectModifierOptions = {},
): ContextualModifiers {
  const applied: Contribution[] = [];
  const excluded: ExcludedContribution[] = [];
  for (const effect of input.effects) {
    if (effect.target !== target) continue;
    if (effect.kind !== "modifier") continue;
    const applicability = applicabilityOf(effect, {
      attack: options.attack,
      context: options.context,
    });
    if (!applicability.applies) {
      if (options.reportExclusions)
        excluded.push(
          exclusionOf(
            effect,
            target,
            applicability.reason ?? "does not apply",
            options.context,
          ),
        );
      continue;
    }
    applied.push(buildContribution(input, effect, target, options.baseline));
  }
  return { applied, excluded };
}

/** A resolved intrinsic baseline: replacement when authored, else the fallback. */
export function baselineContribution(
  replacement: ReplaceBaseEffect | undefined,
  target: TargetId,
  fallback: number,
  source: string,
  label: string,
): Contribution {
  if (!replacement)
    return sourceContribution(target, fallback, source, label);
  return {
    ...sourceContribution(
      target,
      replacement.value,
      replacement.source?.id ?? "effect",
      replacement.source?.label ?? "Baseline replacement",
    ),
    ...(replacement.source?.content
      ? { sourceMetadata: replacement.source.content }
      : {}),
  };
}

export function labelForEffectTarget(target: TargetId): string {
  return labelForTarget(target);
}
