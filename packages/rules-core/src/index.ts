import {
  abilityIds,
  type AbilityId,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type Contribution,
  type DerivedAttack,
  type DerivedCharacter,
  type DerivedSkill,
  type DamageEvaluation,
  type Effect,
  type EvaluationResult,
  type DefenseContext,
  type DerivedProgressionFeature,
  type GrantedCapability,
  movementModes,
  normalizeAdvancementSlots,
  resolveProgressionId,
  sizeCategories,
  mergeProgressionCatalogs,
  parseCharacterInput,
  effectSchema,
  type EquipmentCatalog,
  type EquipmentInstance,
  type FeatureCatalog,
  type AttackProfileCatalog,
  type AttackSelector,
  type ProgressionCatalog,
  type ProgressionAliasMap,
  type ProgressionSourceMetadata,
  type ExperienceCatalog,
  experienceCatalogSchema,
  type SaveId,
  saveIds,
  type SkillCatalog,
  type SkillConfiguration,
  type SkillId,
  type MovementMode,
  type SizeCategory,
  type TargetId,
  targetLabels,
} from "@threepointpf/rules-schema";
import type { RollPlan } from "@threepointpf/dice";
import {
  evaluateAdvancement,
  type AdvancementEvaluation,
} from "./advancement.js";

/** Concrete progression content belongs to a caller-owned catalog, never rules-core. */
export interface RulesEngineOptions {
  progressionCatalog?: ProgressionCatalog;
  /** Persisted legacy ids are normalized against this map before evaluation. */
  progressionAliases?: ProgressionAliasMap;
  /** Skill governing abilities and trained metadata are injected content. */
  skillCatalog?: SkillCatalog;
  featureCatalog?: FeatureCatalog;
  equipmentCatalog?: EquipmentCatalog;
  attackProfileCatalog?: AttackProfileCatalog;
  experienceCatalog?: ExperienceCatalog;
}

const defaultSkillAbilities: Record<string, AbilityId> = {
  acrobatics: "dex",
  appraise: "int",
  bluff: "cha",
  climb: "str",
  craft: "int",
  diplomacy: "cha",
  "disable-device": "dex",
  disguise: "cha",
  "escape-artist": "dex",
  fly: "dex",
  "handle-animal": "cha",
  heal: "wis",
  intimidate: "cha",
  "knowledge-arcana": "int",
  "knowledge-dungeoneering": "int",
  "knowledge-engineering": "int",
  "knowledge-geography": "int",
  "knowledge-history": "int",
  "knowledge-local": "int",
  "knowledge-nature": "int",
  "knowledge-nobility": "int",
  "knowledge-planes": "int",
  "knowledge-religion": "int",
  linguistics: "int",
  perception: "wis",
  perform: "cha",
  profession: "wis",
  ride: "dex",
  "sense-motive": "wis",
  "sleight-of-hand": "dex",
  spellcraft: "int",
  stealth: "dex",
  survival: "wis",
  swim: "str",
  "use-magic-device": "cha",
};

const skillDisplayNames: Record<string, string> = {
  "disable-device": "Disable Device",
  "escape-artist": "Escape Artist",
  "handle-animal": "Handle Animal",
  "knowledge-arcana": "Knowledge (Arcana)",
  "knowledge-dungeoneering": "Knowledge (Dungeoneering)",
  "knowledge-engineering": "Knowledge (Engineering)",
  "knowledge-geography": "Knowledge (Geography)",
  "knowledge-history": "Knowledge (History)",
  "knowledge-local": "Knowledge (Local)",
  "knowledge-nature": "Knowledge (Nature)",
  "knowledge-nobility": "Knowledge (Nobility)",
  "knowledge-planes": "Knowledge (Planes)",
  "knowledge-religion": "Knowledge (Religion)",
  "sense-motive": "Sense Motive",
  "sleight-of-hand": "Sleight of Hand",
  spellcraft: "Spellcraft",
  "use-magic-device": "Use Magic Device",
};

const stackableBonusTypes = new Set<BonusType>([
  "untyped",
  "dodge",
  "circumstance",
  "penalty",
]);

function lookup<T>(
  catalog: Record<string, T> | undefined,
  id: string,
): T | undefined {
  return catalog && Object.prototype.hasOwnProperty.call(catalog, id)
    ? catalog[id]
    : undefined;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Pathfinder typed reduction: stackable types sum; other types keep the best positive bonus and all penalties. */
export function reduceContributions(
  contributions: Contribution[],
): Contribution[] {
  const result: Contribution[] = [];
  const untyped = contributions.filter((item) => !item.bonusType);
  result.push(...untyped);
  const byType = new Map<BonusType, Contribution[]>();
  for (const contribution of contributions) {
    if (!contribution.bonusType) continue;
    const existing = byType.get(contribution.bonusType) ?? [];
    existing.push(contribution);
    byType.set(contribution.bonusType, existing);
  }
  for (const [bonusType, typed] of byType) {
    if (stackableBonusTypes.has(bonusType)) {
      result.push(...typed);
      continue;
    }
    const positives = typed.filter((item) => item.value > 0);
    const negatives = typed.filter((item) => item.value < 0);
    const zeros = typed.filter((item) => item.value === 0);
    if (positives.length > 0) {
      const best = positives.reduce((a, b) => (b.value > a.value ? b : a));
      result.push(best);
    }
    result.push(...negatives, ...zeros);
  }
  return result;
}

function sum(contributions: Contribution[]): number {
  return contributions.reduce((total, item) => total + item.value, 0);
}

function sourceContribution(
  target: TargetId,
  value: number,
  source: string,
  label: string,
  bonusType?: BonusType,
  extras: Pick<
    Contribution,
    "appliesTo" | "children" | "note" | "sourceMetadata"
  > = {},
): Contribution {
  return {
    target,
    value,
    source,
    label,
    ...(bonusType ? { bonusType } : {}),
    ...extras,
  };
}

function labelForTarget(target: TargetId): string {
  if (targetLabels[target]) return targetLabels[target];
  if (target.startsWith("skill.")) return skillLabel(target.slice(6));
  return target;
}

export function skillLabel(id: string): string {
  return (
    lookup(skillDisplayNames, id) ??
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function featureEffects(
  character: CharacterInput,
  catalog: FeatureCatalog = {},
): Effect[] {
  const effects: Effect[] = [];
  const seenDefinitions = new Set<string>();
  const groupWinners = new Map<string, string>();
  for (const feature of character.features.filter(
    (item) => item.enabled && item.definitionId && !item.effects.length,
  )) {
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
    // Older saves copied definition effects into instances. Explicit authored
    // effects remain authoritative; an empty array opts into catalog content.
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

function effectContribution(
  effect: Extract<Effect, { kind: "modifier" }>,
  target: TargetId,
): Contribution {
  return {
    ...sourceContribution(
      target,
      effect.value,
      effect.source?.id ?? "effect",
      effect.source?.label ?? "Effect",
      effect.bonusType,
      { appliesTo: "appliesTo" in effect ? effect.appliesTo : undefined },
    ),
    ...(effect.source?.content
      ? { sourceMetadata: effect.source.content }
      : {}),
  };
}

function base(
  target: TargetId,
  value: number,
  source: string,
  label: string,
): Contribution {
  return sourceContribution(target, value, source, label);
}

export class RulesEngine {
  readonly character: CharacterInput;
  private readonly effects: Effect[];
  private readonly advancement?: AdvancementEvaluation;
  private readonly progressionCatalog?: ProgressionCatalog;
  private readonly progressionAliases: ProgressionAliasMap;
  private readonly skillCatalog?: SkillCatalog;
  private readonly equipment: (EquipmentInstance & {
    source?: ProgressionSourceMetadata;
  })[];
  private readonly attackProfileCatalog?: AttackProfileCatalog;
  private readonly experienceCatalog?: ExperienceCatalog;
  private readonly attackDefinitions: AttackDefinition[];
  /** `combat.bab` is a shared derived fact, not a fresh baseline per consumer. */
  private babEvaluation?: EvaluationResult;
  private sizeEvaluation?: EvaluationResult;

  constructor(character: CharacterInput, options: RulesEngineOptions = {}) {
    character = parseCharacterInput(character);
    this.progressionCatalog =
      options.progressionCatalog || character.customProgressions
        ? mergeProgressionCatalogs(
            options.progressionCatalog,
            character.customProgressions,
          )
        : undefined;
    this.progressionAliases = options.progressionAliases ?? {};
    this.skillCatalog = options.skillCatalog;
    this.attackProfileCatalog = options.attackProfileCatalog;
    this.experienceCatalog = options.experienceCatalog
      ? experienceCatalogSchema.parse(options.experienceCatalog)
      : undefined;
    const advancementSlots = character.advancementSlots;
    if (advancementSlots?.length) {
      if (!this.progressionCatalog)
        throw new Error("Advancement requires an injected progression catalog");
      const canonicalSlots = normalizeAdvancementSlots(
        advancementSlots,
        this.progressionCatalog,
        this.progressionAliases,
      );
      this.character = {
        ...character,
        advancementSlots: canonicalSlots,
      };
      this.advancement = evaluateAdvancement(
        canonicalSlots,
        this.progressionCatalog,
        this.progressionAliases,
      );
    } else {
      this.character = character;
    }
    this.effects = featureEffects(this.character, options.featureCatalog);
    for (const feature of this.advancement?.features ?? []) {
      const definition = this.progressionCatalog?.[feature.progressionId];
      for (const effect of feature.effects ?? [])
        this.effects.push({
          ...effect,
          source: effect.source ?? {
            id: `advancement.slot.${feature.slotId}.track.${feature.trackId}.progression.${feature.progressionId}.feature.${feature.id}`,
            label: `${feature.name} (${definition?.name ?? feature.progressionId} ${feature.level})`,
            ...(definition?.source ? { content: definition.source } : {}),
          },
        });
    }
    this.equipment = (character.equipment ?? []).map((item) => {
      const definition = item.definitionId
        ? lookup(options.equipmentCatalog, item.definitionId)
        : undefined;
      if (item.definitionId && !definition)
        throw new Error(`Unknown equipment definition ${item.definitionId}`);
      return {
        ...definition,
        ...item,
        effects: [...(definition?.effects ?? []), ...(item.effects ?? [])],
      };
    });
    for (const item of this.equipment.filter((item) => item.equipped)) {
      const metadata = item.definitionId
        ? lookup(options.equipmentCatalog, item.definitionId)?.source
        : undefined;
      for (const effect of item.effects ?? [])
        this.effects.push({
          ...effect,
          source: {
            id: `equipment.${item.id}${effect.source ? `.${effect.source.id}` : ""}`,
            label: effect.source
              ? `${item.name ?? item.id}: ${effect.source.label}`
              : (item.name ?? item.id),
            ...((effect.source?.content ?? metadata)
              ? { content: effect.source?.content ?? metadata }
              : {}),
          },
        });
    }
    this.effects = this.effects.map((effect) => effectSchema.parse(effect));
    this.attackDefinitions = [
      ...character.attacks,
      ...this.equipment
        .filter((item) => item.equipped && item.attack)
        .map((item) => ({
          ...item.attack!,
          id: `equipment.${item.id}`,
          name: item.name ?? item.attack!.name,
        })),
    ].map((attack) => {
      const profile = attack.profileId
        ? lookup(options.attackProfileCatalog, attack.profileId)
        : undefined;
      if (attack.profileId && !profile)
        throw new Error(`Unknown attack profile ${attack.profileId}`);
      return profile
        ? {
            ...attack,
            attackAbility: profile.attackAbility,
            damageAbility: profile.damageAbility,
            damageAbilityMultiplier: profile.damageAbilityMultiplier,
            mode: profile.mode,
            attackTags: profile.attackTags,
            iterative: profile.iterative,
            extraAttackEligible: profile.extraAttackEligible,
            attackBonus: (attack.attackBonus ?? 0) + (profile.attackBonus ?? 0),
          }
        : attack;
    });
    if (
      new Set(this.attackDefinitions.map((attack) => attack.id)).size !==
      this.attackDefinitions.length
    )
      throw new Error("Duplicate derived attack ids");
    const replacementTargets = new Set<TargetId>();
    for (const effect of this.effects) {
      if (effect.kind !== "replaceBase") continue;
      if (replacementTargets.has(effect.target))
        throw new Error(
          `Ambiguous active baseline replacements for ${effect.target}`,
        );
      replacementTargets.add(effect.target);
    }
    const minimums = new Map<TargetId, number>();
    const maximums = new Map<TargetId, number>();
    for (const effect of this.effects) {
      if (effect.kind === "minimum")
        minimums.set(
          effect.target,
          Math.max(minimums.get(effect.target) ?? -Infinity, effect.value),
        );
      if (effect.kind === "maximum")
        maximums.set(
          effect.target,
          Math.min(maximums.get(effect.target) ?? Infinity, effect.value),
        );
      if (effect.target === "size.relative") {
        const numeric =
          effect.kind === "multiply"
            ? effect.factor
            : effect.kind === "grant"
              ? undefined
              : effect.value;
        if (numeric !== undefined && !Number.isInteger(numeric))
          throw new Error(
            "Size-relative effects must use integral category steps",
          );
      }
    }
    for (const [target, minimum] of minimums) {
      const maximum = maximums.get(target);
      if (maximum !== undefined && minimum > maximum)
        throw new Error(`Conflicting minimum/maximum effects for ${target}`);
    }
  }

  private matchesAttack(
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

  private directModifiers(
    target: TargetId,
    attack?: AttackDefinition,
    baseline?: number,
  ): Contribution[] {
    const matching: Contribution[] = [];
    for (const effect of this.effects) {
      if (effect.target !== target) continue;
      if (
        effect.kind !== "modifier" ||
        !this.matchesAttack(
          "attackSelector" in effect ? effect.attackSelector : undefined,
          attack,
        )
      )
        continue;
      const contribution = effectContribution(effect, target);
      if (effect.scaling) {
        const bab = this.bab();
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
      matching.push(contribution);
    }
    return matching;
  }

  /**
   * Numeric operations have a stable, visible order:
   * replacement/additive typed bonuses → multiplication → minimum → maximum.
   * Each operation contributes only its delta, so provenance still sums to the
   * displayed value.
   */
  private applyOperations(
    target: TargetId,
    reduced: Contribution[],
  ): Contribution[] {
    const contributions = [...reduced];
    let value = sum(contributions);
    for (const effect of this.effects) {
      if (
        effect.kind !== "multiply" ||
        !this.operationMatches(effect.target, target)
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
    const minimums = this.effects.filter(
      (effect): effect is Extract<Effect, { kind: "minimum" }> =>
        effect.kind === "minimum" &&
        this.operationMatches(effect.target, target),
    );
    const minimum = minimums.reduce<
      Extract<Effect, { kind: "minimum" }> | undefined
    >(
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
    const maximums = this.effects.filter(
      (effect): effect is Extract<Effect, { kind: "maximum" }> =>
        effect.kind === "maximum" &&
        this.operationMatches(effect.target, target),
    );
    const maximum = maximums.reduce<
      Extract<Effect, { kind: "maximum" }> | undefined
    >(
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

  private operationMatches(effectTarget: TargetId, target: TargetId): boolean {
    return (
      effectTarget === target ||
      (effectTarget === "skill.all" &&
        target.startsWith("skill.") &&
        target !== "skill.initiative")
    );
  }

  private trackIncrementEvidence(
    target: TargetId,
    track: AdvancementEvaluation["tracks"][number],
    property: "bab" | SaveId,
  ): Contribution[] {
    return track.increments.map((increment) => {
      const definition = this.progressionCatalog?.[increment.progressionId];
      const value =
        property === "bab" ? increment.bab : increment.saves[property];
      const suffix = property === "bab" ? "bab" : `save.${property}`;
      return sourceContribution(
        target,
        value,
        `advancement.slot.${increment.slotId}.track.${increment.trackId}.progression.${increment.progressionId}.${suffix}`,
        `${definition?.name ?? increment.progressionId} ${property === "bab" ? "BAB" : property} at level ${increment.level}`,
        undefined,
        {
          note: `Character-global ${definition?.name ?? increment.progressionId} level ${increment.previousLevel} → ${increment.level}; credited to track ${increment.trackId}`,
          ...(definition?.source ? { sourceMetadata: definition.source } : {}),
        },
      );
    });
  }

  private trackEvidence(
    target: TargetId,
    property: "bab" | SaveId,
    selected: string,
  ): Contribution[] {
    if (!this.advancement) return [];
    return this.advancement.tracks.map((track) => {
      const value = property === "bab" ? track.bab : track.saves[property];
      const sourceProperty = property === "bab" ? "bab" : `save.${property}`;
      return sourceContribution(
        target,
        value,
        `advancement.track.${track.id}.${sourceProperty}`,
        `Track ${track.id} ${property === "bab" ? "BAB" : property}`,
        undefined,
        {
          note:
            track.id === selected
              ? "Selected complete-track total"
              : "Complete-track candidate",
          children: this.trackIncrementEvidence(target, track, property),
        },
      );
    });
  }

  /** First-class BAB fact. Its contribution tree is shared by every BAB consumer. */
  bab(): EvaluationResult {
    if (this.babEvaluation) return this.babEvaluation;
    const target = "combat.bab" as TargetId;
    if (!this.advancement) {
      const result = this.result(target, [
        this.replacement(
          target,
          this.character.baseBab ?? 0,
          "base-bab",
          "Base Attack Bonus",
        ),
        ...this.directModifiers(target),
      ]);
      this.babEvaluation = result;
      return result;
    }
    const selected = this.advancement.babTrack;
    const fallback = sourceContribution(
      target,
      selected.bab,
      `advancement.track.${selected.id}.bab`,
      `Track ${selected.id} BAB`,
      undefined,
      {
        children: this.trackEvidence(target, "bab", selected.id),
        note: "Best complete advancement-track total",
      },
    );
    const replacement = this.effects.some(
      (effect) => effect.kind === "replaceBase" && effect.target === target,
    )
      ? this.replacement(
          target,
          selected.bab,
          `advancement.track.${selected.id}.bab`,
          `Track ${selected.id} BAB`,
        )
      : fallback;
    const result = this.result(target, [
      replacement,
      ...this.directModifiers(target),
    ]);
    this.babEvaluation = result;
    return result;
  }

  /** Copy the already-evaluated BAB fact into a consuming target exactly once. */
  private babContribution(target: TargetId): Contribution {
    const bab = this.bab();
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

  /** Query a character-global progression level with every slot/track origin retained. */
  progressionLevel(progressionId: string): EvaluationResult {
    const canonicalId =
      this.progressionCatalog &&
      resolveProgressionId(
        progressionId,
        this.progressionCatalog,
        this.progressionAliases,
      );
    const definition = canonicalId && this.progressionCatalog?.[canonicalId];
    if (!definition || !canonicalId)
      throw new Error(`Unknown progression definition ${progressionId}`);
    const target = `progression.${canonicalId}.level` as TargetId;
    const progression = this.advancement?.progressionLevels.find(
      (item) => item.id === canonicalId,
    );
    if (!progression)
      return this.result(target, [
        base(
          target,
          0,
          `progression.${canonicalId}.level`,
          `${definition.name} level`,
        ),
      ]);
    return this.result(
      target,
      progression.increments.map((increment) =>
        sourceContribution(
          target,
          1,
          `advancement.slot.${increment.slotId}.track.${increment.trackId}.progression.${canonicalId}.level.${increment.level}`,
          `${definition.name} level ${increment.level}`,
          undefined,
          {
            note: `Character-global level ${increment.level}, earned in slot ${increment.slotId} on track ${increment.trackId}`,
            ...(definition.source ? { sourceMetadata: definition.source } : {}),
          },
        ),
      ),
    );
  }

  /** Explicit class feature unlocks; mechanics are never inferred from names. */
  progressionFeatures(progressionId?: string): DerivedProgressionFeature[] {
    if (progressionId && this.progressionCatalog)
      progressionId =
        resolveProgressionId(
          progressionId,
          this.progressionCatalog,
          this.progressionAliases,
        ) ?? progressionId;
    return (this.advancement?.features ?? [])
      .filter(
        (feature) => !progressionId || feature.progressionId === progressionId,
      )
      .map((feature) => {
        const target = `progression.${feature.progressionId}.level` as TargetId;
        return {
          ...feature,
          provenance: sourceContribution(
            target,
            1,
            `advancement.slot.${feature.slotId}.track.${feature.trackId}.progression.${feature.progressionId}.feature.${feature.id}`,
            `${feature.name} (${feature.progressionId} ${feature.level})`,
            undefined,
            {
              note: `Unlocked at character-global ${feature.progressionId} level ${feature.level}; credited to track ${feature.trackId}`,
            },
          ),
        };
      });
  }

  private baseSaveContribution(id: SaveId, target: TargetId): Contribution {
    if (!this.advancement)
      return this.replacement(
        target,
        this.character.baseSaves?.[id] ?? 0,
        `base-save.${id}`,
        `Base ${id}`,
      );
    const selected = this.advancement.saveTracks[id];
    if (
      this.effects.some(
        (effect) => effect.kind === "replaceBase" && effect.target === target,
      )
    )
      return this.replacement(
        target,
        selected.saves[id],
        `advancement.track.${selected.id}.save.${id}`,
        `Track ${selected.id} ${id}`,
      );
    return sourceContribution(
      target,
      selected.saves[id],
      `advancement.track.${selected.id}.save.${id}`,
      `Track ${selected.id} ${id}`,
      undefined,
      {
        children: this.trackEvidence(target, id, selected.id),
        note: "Best complete advancement-track total",
      },
    );
  }

  private hitDiceCountContribution(): Contribution {
    if (!this.advancement)
      return sourceContribution(
        "hp",
        this.character.hitDiceCount ?? 0,
        "manual-hit-dice-count",
        "Hit dice count",
      );
    return sourceContribution(
      "hp",
      this.advancement.hitDiceCount,
      "advancement.hit-dice-count",
      `${this.advancement.hitDiceCount} hit dice`,
      undefined,
      {
        note: "One hit die per ordered slot; best die type per slot",
        children: this.advancement.hitDieSources.map((source) =>
          sourceContribution(
            "hp",
            source.sides,
            `advancement.slot.${source.slotId}.track.${source.trackId}.hit-die`,
            `Slot ${source.slotId}: Track ${source.trackId} d${source.sides}`,
            undefined,
            { note: "Selected best hit die for slot" },
          ),
        ),
      },
    );
  }

  /** A replaceBase effect replaces the intrinsic/base scalar; dependencies and modifiers still apply. */
  private replacementEffect(
    target: TargetId,
  ): Extract<Effect, { kind: "replaceBase" }> | undefined {
    const replacements = this.effects.filter(
      (effect): effect is Extract<Effect, { kind: "replaceBase" }> =>
        effect.kind === "replaceBase" &&
        this.operationMatches(effect.target, target),
    );
    if (replacements.length > 1)
      throw new Error(`Ambiguous active baseline replacements for ${target}`);
    return replacements[0];
  }

  private replacement(
    target: TargetId,
    fallback: number,
    source: string,
    label: string,
  ): Contribution {
    const replacement = this.replacementEffect(target);
    return replacement
      ? {
          ...base(
            target,
            replacement.value,
            replacement.source?.id ?? "effect",
            replacement.source?.label ?? "Baseline replacement",
          ),
          ...(replacement.source?.content
            ? { sourceMetadata: replacement.source.content }
            : {}),
        }
      : base(target, fallback, source, label);
  }

  private result(
    target: TargetId,
    contributions: Contribution[],
    context?: DefenseContext,
    applyOperations = true,
  ): EvaluationResult {
    const reduced = reduceContributions(contributions);
    const operated = applyOperations
      ? this.applyOperations(target, reduced)
      : reduced;
    const value = sum(operated);
    if (!Number.isFinite(value))
      throw new Error(`Non-finite derived value for ${target}`);
    return {
      target,
      value,
      contributions: operated,
      ...(context ? { context } : {}),
    };
  }

  abilityScore(id: AbilityId): EvaluationResult {
    const target = `ability.${id}` as TargetId;
    const contributions = [
      this.replacement(
        target,
        this.character.baseAbilities[id],
        "base-ability",
        `Base ${id.toUpperCase()}`,
      ),
      ...this.directModifiers(target),
    ];
    const raw = this.result(target, contributions);
    if (raw.value >= 0) return raw;
    const floor = base(
      target,
      -raw.value,
      "rules-core.ability-floor",
      "Ability score minimum",
    );
    return { ...raw, value: 0, contributions: [...raw.contributions, floor] };
  }

  abilityModifier(id: AbilityId): EvaluationResult {
    const score = this.abilityScore(id);
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

  private abilityContribution(id: AbilityId, target: TargetId): Contribution {
    const score = this.abilityScore(id);
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

  private save(id: SaveId): EvaluationResult {
    const target = `save.${id}` as TargetId;
    const ability: AbilityId =
      id === "fortitude" ? "con" : id === "reflex" ? "dex" : "wis";
    const contributions = [
      this.advancement
        ? this.baseSaveContribution(id, target)
        : this.replacement(
            target,
            this.character.baseSaves?.[id] ?? 0,
            `base-save.${id}`,
            `Base ${id}`,
          ),
      this.abilityContribution(ability, target),
      ...this.directModifiers(target),
    ];
    return this.result(target, contributions);
  }

  private ac(kind: "normal" | "touch" | "flat-footed"): EvaluationResult {
    const target = "ac" as TargetId;
    const contributions: Contribution[] = [
      this.replacement(target, 10, "ac.base", "Base AC"),
      this.sizeAdjustment(target, -2, "Size modifier"),
    ];
    const dexterity = this.abilityContribution("dex", target);
    if (kind !== "flat-footed" || dexterity.value < 0) {
      const caps = this.equipment.filter(
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
    }
    const direct = [...this.directModifiers("ac")];
    const naturalResult = this.result("ac.natural", [
      this.replacement(
        "ac.natural",
        0,
        "ac.natural.base",
        "Base natural armor",
      ),
      ...this.directModifiers("ac.natural"),
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
        ...direct.filter((item) => this.appliesToDefense(item, "touch")),
      );
    } else if (kind === "flat-footed") {
      contributions.push(
        ...direct.filter((item) => this.appliesToDefense(item, "flatFooted")),
      );
      contributions.push(...natural);
    } else {
      contributions.push(
        ...direct.filter((item) => this.appliesToDefense(item, "normal")),
        ...natural,
      );
    }
    return this.result(
      target,
      contributions,
      kind === "flat-footed" ? "flatFooted" : kind,
    );
  }

  private appliesToDefense(
    contribution: Contribution,
    context: DefenseContext,
  ): boolean {
    // Missing applicability is invalid metadata, never a broad/general effect.
    return contribution.appliesTo?.includes(context) ?? false;
  }

  private initiativeResult(): EvaluationResult {
    const target = "initiative" as TargetId;
    return this.result(target, [
      this.replacement(target, 0, "initiative.base", "Base initiative"),
      this.abilityContribution("dex", target),
      ...this.directModifiers(target),
      ...this.skillLikeInitiativeEffects(target),
    ]);
  }

  private skillLikeInitiativeEffects(target: TargetId): Contribution[] {
    return this.effects.flatMap((effect) => {
      if (effect.kind !== "modifier" || !effect.source) return [];
      if (effect.target !== "skill.initiative") return [];
      return [effectContribution(effect, target)];
    });
  }

  private combat(target: "cmb" | "cmd"): EvaluationResult {
    const contributions: Contribution[] = [
      this.replacement(
        target,
        target === "cmd" ? 10 : 0,
        `${target}.base`,
        target === "cmd" ? "Base CMD" : "Base CMB",
      ),
      this.babContribution(target),
      this.abilityContribution(
        target === "cmb" && sizeCategories.indexOf(this.sizeCategory()) <= 2
          ? "dex"
          : "str",
        target,
      ),
      ...(target === "cmd" ? [this.abilityContribution("dex", target)] : []),
      this.sizeAdjustment(target, 2, "Size modifier"),
      ...this.directModifiers(target),
    ];
    return this.result(target, contributions);
  }

  /** The current structural size is base category plus integral relative steps. */
  private sizeResult(): EvaluationResult {
    if (this.sizeEvaluation) return this.sizeEvaluation;
    const target = "size.relative" as TargetId;
    const raw = this.result(target, [
      this.replacement(target, 0, "size.relative.base", "Base size adjustment"),
      ...this.directModifiers(target),
    ]);
    if (!Number.isInteger(raw.value))
      throw new Error(
        "Size-relative effects must resolve to integral category steps",
      );
    const baseSize = this.character.baseSize ?? "medium";
    const baseIndex = sizeCategories.indexOf(baseSize);
    const requestedIndex = baseIndex + raw.value;
    const clampedIndex = Math.max(
      0,
      Math.min(sizeCategories.length - 1, requestedIndex),
    );
    const clampedRelative = clampedIndex - baseIndex;
    this.sizeEvaluation =
      clampedRelative === raw.value
        ? raw
        : {
            ...raw,
            value: clampedRelative,
            contributions: [
              ...raw.contributions,
              sourceContribution(
                target,
                clampedRelative - raw.value,
                "rules-core.size-clamp",
                "Size category boundary",
                undefined,
                {
                  note: `Requested ${sizeCategories[Math.max(0, Math.min(sizeCategories.length - 1, requestedIndex))]}; clamped to ${sizeCategories[clampedIndex]}`,
                },
              ),
            ],
          };
    return this.sizeEvaluation;
  }

  private sizeCategory(): SizeCategory {
    const baseIndex = sizeCategories.indexOf(
      this.character.baseSize ?? "medium",
    );
    return sizeCategories[baseIndex + this.sizeResult().value]!;
  }

  /** Size table offsets are derived from the resulting category, not authored ad hoc. */
  private sizeAdjustment(
    target: TargetId,
    perCategoryStep: number,
    label: string,
  ): Contribution {
    const size = this.sizeResult();
    const index = sizeCategories.indexOf(this.sizeCategory());
    const categoryOffset = index - sizeCategories.indexOf("medium");
    const baseSize = this.character.baseSize ?? "medium";
    const attackAc = [8, 4, 2, 1, 0, -1, -2, -4, -8][index]!;
    const value =
      target === "cmb" || target === "cmd"
        ? -attackAc
        : target === "ac" || target.startsWith("attack.")
          ? attackAc
          : categoryOffset * perCategoryStep;
    return sourceContribution(target, value, "rules-core.size", label, "size", {
      note: `${this.sizeCategory()} size; Autosheet Formula References!A${138 + index}:G${138 + index}`,
      children: [
        sourceContribution(
          "size.relative",
          sizeCategories.indexOf(baseSize) - sizeCategories.indexOf("medium"),
          "size.base",
          `Base size: ${baseSize}`,
        ),
        ...size.contributions,
      ],
    });
  }

  private classSkillStatus(
    id: string,
    target: TargetId,
  ): { classSkill: boolean; provenance: Contribution[] } {
    const config = this.character.skills?.[id];
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
    for (const progression of this.advancement?.progressionLevels ?? []) {
      const definition = this.progressionCatalog?.[progression.id];
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
                {
                  note: `Credited to track ${increment.trackId}`,
                },
              ),
            ),
          },
        ),
      );
    }
    return { classSkill: sources.length > 0, provenance: sources };
  }

  private skillResult(id: string): DerivedSkill {
    const config: SkillConfiguration = this.character.skills?.[id] ?? {};
    const metadata = lookup(this.skillCatalog, id);
    const governingAbility =
      config.governingAbility ??
      metadata?.governingAbility ??
      lookup(defaultSkillAbilities, id) ??
      "int";
    const ranks = this.character.skillRanks[id] ?? 0;
    const target = `skill.${id}` as TargetId;
    const classSkill = this.classSkillStatus(id, target);
    const contributions = [
      this.replacement(target, ranks, `skill.${id}.ranks`, "Skill ranks"),
      this.abilityContribution(governingAbility, target),
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
        ? this.equipment
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
        ? [this.sizeAdjustment(target, id === "fly" ? -2 : -4, "Size modifier")]
        : []),
      ...this.directModifiers("skill.all"),
      ...this.directModifiers(target),
    ];
    const total = this.result(target, contributions);
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

  /** Absent non-land modes remain an explicit zero baseline; effects may only change a mode when authored. */
  private movementResult(mode: MovementMode = "land"): EvaluationResult {
    const target = `speed.${mode}` as TargetId;
    const fallback =
      this.character.baseSpeeds?.[mode] ??
      (mode === "land" ? (this.character.baseLandSpeed ?? 30) : 0);
    const baseline = this.replacement(
      target,
      fallback,
      `base-speed.${mode}`,
      `Base ${mode} speed`,
    );
    const armor =
      mode === "land"
        ? this.equipment.find((item) => item.equipped && item.reduceLandSpeed)
        : undefined;
    if (armor) {
      const reduced = Math.ceil((baseline.value * 2) / 3 / 5) * 5;
      baseline.children = [
        { ...baseline },
        sourceContribution(
          target,
          reduced - baseline.value,
          `equipment.${armor.id}.speed`,
          `${armor.name ?? armor.id} armor movement`,
          undefined,
          { ...(armor.source ? { sourceMetadata: armor.source } : {}) },
        ),
      ];
      baseline.value = reduced;
      baseline.note =
        "Armor speed table: two thirds, rounded up to the next 5 feet";
    }
    const result = this.result(target, [
      baseline,
      ...this.directModifiers(target, undefined, baseline.value),
    ]);
    if (result.value >= 0) return result;
    return {
      ...result,
      value: 0,
      contributions: [
        ...result.contributions,
        base(
          target,
          -result.value,
          "rules-core.speed-floor",
          "Movement minimum 0",
        ),
      ],
    };
  }

  private hpResult(): EvaluationResult {
    const constitution = this.abilityContribution("con", "hp");
    const hitDice = this.hitDiceCountContribution();
    return this.result("hp", [
      this.replacement(
        "hp",
        this.character.baseHpBeforeConstitution,
        "base-hp-before-con",
        "HP before Constitution",
      ),
      {
        ...constitution,
        value: constitution.value * hitDice.value,
        label: `${hitDice.value}× ${constitution.label}`,
        note: `${hitDice.value} × (${constitution.note ?? "CON modifier"})`,
        children: [...(constitution.children ?? []), hitDice],
      },
      ...this.directModifiers("hp"),
    ]);
  }

  private attackFor(definition: AttackDefinition): DerivedAttack {
    const profileSource = definition.profileId
      ? lookup(this.attackProfileCatalog, definition.profileId)?.source
      : undefined;
    const mode =
      definition.mode ??
      (definition.attackTags?.includes("weapon.ranged") ? "ranged" : "melee");
    const target = `attack.${mode}` as TargetId;
    const attackReplacement = this.replacementEffect(target);
    // Pre-combat.bab saves used replaceBase(attack.*) as a replacement for the
    // whole BAB-backed attack baseline. Retain that authored meaning rather
    // than silently turning old data into an additive bonus.
    const attackBaseline = attackReplacement
      ? [
          sourceContribution(
            target,
            attackReplacement.value,
            attackReplacement.source?.id ?? "effect",
            attackReplacement.source?.label ?? "Baseline replacement",
            undefined,
            {
              note: "Legacy attack baseline replacement overrides combat.bab for this attack mode",
              children: [this.babContribution(target)],
            },
          ),
        ]
      : [
          this.replacement(target, 0, `${target}.base`, labelForTarget(target)),
          this.babContribution(target),
        ];
    const attackContributions = [
      ...attackBaseline,
      {
        ...this.abilityContribution(definition.attackAbility, target),
        ...(profileSource ? { sourceMetadata: profileSource } : {}),
      },
      this.sizeAdjustment(target, -2, "Size modifier"),
      ...(definition.weaponBonus
        ? [
            sourceContribution(
              target,
              definition.weaponBonus,
              `weapon.${definition.id}`,
              "Weapon enhancement",
              "enhancement",
              {
                ...(definition.source
                  ? { sourceMetadata: definition.source }
                  : {}),
              },
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
              { ...(profileSource ? { sourceMetadata: profileSource } : {}) },
            ),
          ]
        : []),
      ...this.directModifiers(target, definition),
    ];
    const attack = this.result(target, attackContributions);
    const damageTarget = `damage.${mode}` as TargetId;
    const abilityValue = definition.damageAbility
      ? this.abilityModifier(definition.damageAbility).value
      : 0;
    // A Strength penalty applies in full even to off-hand and two-handed attacks.
    const multiplier =
      abilityValue < 0 && definition.damageAbility === "str"
        ? 1
        : (definition.damageAbilityMultiplier ?? 1);
    const damageContributions = definition.damageAbility
      ? [
          this.replacement(
            damageTarget,
            0,
            "damage.base",
            "Base damage modifier",
          ),
          sourceContribution(
            damageTarget,
            Math.floor(
              this.abilityModifier(definition.damageAbility).value * multiplier,
            ),
            `ability.${definition.damageAbility}.damage`,
            `${definition.damageAbility.toUpperCase()} damage (${multiplier}×)`,
            undefined,
            {
              children: [
                sourceContribution(
                  `ability.${definition.damageAbility}` as TargetId,
                  this.abilityScore(definition.damageAbility).value,
                  `${"ability." + definition.damageAbility}.score`,
                  `${definition.damageAbility.toUpperCase()} score`,
                  undefined,
                  {
                    children: this.abilityScore(definition.damageAbility)
                      .contributions,
                  },
                ),
              ],
            },
          ),
          ...this.directModifiers(damageTarget, definition),
        ]
      : [
          this.replacement(
            damageTarget,
            0,
            "damage.base",
            "Base damage modifier",
          ),
          ...this.directModifiers(damageTarget, definition),
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
          {
            ...(definition.source ? { sourceMetadata: definition.source } : {}),
          },
        ),
      );
    const damageResult = this.result(damageTarget, damageContributions);
    const modifier = damageResult.value;
    const damage: DamageEvaluation = {
      formula: `${definition.baseDamage.count}d${definition.baseDamage.sides}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`,
      dice: definition.baseDamage,
      modifier,
      contributions: damageResult.contributions,
    };
    const iterativeCount =
      definition.iterative === false
        ? 1
        : Math.min(4, Math.max(1, Math.ceil(this.bab().value / 5)));
    const extraTarget = `attacks.extra.${mode}` as TargetId;
    const extra =
      definition.extraAttackEligible === false
        ? { target: extraTarget, value: 0, contributions: [] }
        : this.result(
            extraTarget,
            this.directModifiers(extraTarget, definition),
          );
    if (!Number.isSafeInteger(extra.value) || extra.value < 0)
      throw new Error(
        `Extra attack count must be a nonnegative integer for ${definition.id}`,
      );
    // Resource boundary, not a game-rule truncation: invalid huge authored
    // sequences fail explicitly before allocating or persisting them.
    if (extra.value + iterativeCount > 256)
      throw new Error(
        `Attack sequence exceeds the supported 256 rolls for ${definition.id}`,
      );
    const fullAttack = [attack];
    for (let index = 0; index < extra.value; index++)
      fullAttack.push({
        ...attack,
        contributions: [
          ...attack.contributions,
          sourceContribution(
            target,
            0,
            extraTarget,
            "Additional attack at highest bonus",
            undefined,
            { children: extra.contributions },
          ),
        ],
      });
    for (let index = 1; index < iterativeCount; index++)
      fullAttack.push({
        ...attack,
        value: attack.value - 5 * index,
        contributions: [
          ...attack.contributions,
          base(
            target,
            -5 * index,
            "combat.bab.iterative",
            `Iterative attack ${index + 1}`,
          ),
        ],
      });
    return { definition, attack, damage, fullAttack };
  }

  evaluate(target: TargetId): EvaluationResult {
    if (target === "experience.level") {
      const result = this.experienceResult();
      if (!result) throw new Error("No experience track selected");
      return result.eligibleLevel;
    }
    if (target.startsWith("ability."))
      return this.abilityScore(target.slice(8) as AbilityId);
    if (target.startsWith("save.")) return this.save(target.slice(5) as SaveId);
    if (target === "combat.bab") return this.bab();
    if (target.startsWith("progression.") && target.endsWith(".level"))
      return this.progressionLevel(
        target.slice("progression.".length, -".level".length),
      );
    if (target === "ac") return this.ac("normal");
    if (target === "hp") return this.hpResult();
    if (target === "initiative") return this.initiativeResult();
    if (target === "cmb" || target === "cmd") return this.combat(target);
    if (target === "size.relative") return this.sizeResult();
    if (target.startsWith("skill.") && target !== "skill.all")
      return this.skillResult(target.slice(6)).total;
    if (target.startsWith("speed."))
      return this.movementResult(target.slice("speed.".length) as MovementMode);
    const direct = this.directModifiers(target);
    return this.result(target, [
      this.replacement(target, 0, `${target}.base`, labelForTarget(target)),
      ...direct,
    ]);
  }

  /** Grants are intentionally non-numeric in v0: they expose capabilities for future consumers. */
  grants(): GrantedCapability[] {
    return this.effects.flatMap((effect) =>
      effect.kind === "grant"
        ? [
            {
              target: effect.target,
              grant: effect.grant,
              source: effect.source ?? { id: "effect", label: "Effect" },
            },
          ]
        : [],
    );
  }

  private experienceResult(): DerivedCharacter["experience"] {
    const experience = this.character.experience;
    if (!experience) return undefined;
    const track = lookup(this.experienceCatalog, experience.trackId);
    if (!track)
      throw new Error(`Unknown experience track ${experience.trackId}`);
    const reached = track.thresholds.filter(
      (row) => row.points <= experience.points,
    );
    const level = reached.at(-1)!;
    const next = track.thresholds[reached.length];
    return {
      ...experience,
      eligibleLevel: {
        target: "experience.level",
        value: level.level,
        contributions: reached.map((row) =>
          sourceContribution(
            "experience.level",
            1,
            `experience.${track.id}.level.${row.level}`,
            `Level ${row.level}: ${row.points} XP threshold`,
            undefined,
            {
              note: `Authored XP ${experience.points}; selected ${track.name} track. Eligibility does not advance a class automatically.`,
              ...(track.source ? { sourceMetadata: track.source } : {}),
            },
          ),
        ),
      },
      ...(next
        ? {
            nextThreshold: next.points,
            remaining: next.points - experience.points,
          }
        : {}),
    };
  }

  derive(): DerivedCharacter {
    const abilities = {} as DerivedCharacter["abilities"];
    for (const id of abilityIds)
      abilities[id] = {
        score: this.abilityScore(id),
        modifier: this.abilityModifier(id),
      };
    const saves = {} as DerivedCharacter["saves"];
    for (const id of saveIds) saves[id] = this.save(id);
    const skillKeys = new Set(Object.keys(this.character.skillRanks));
    for (const id of Object.keys(this.character.skills ?? {}))
      skillKeys.add(id);
    for (const id of Object.keys(this.skillCatalog ?? {})) skillKeys.add(id);
    for (const progression of this.advancement?.progressionLevels ?? []) {
      for (const id of this.progressionCatalog?.[progression.id]?.classSkills ??
        [])
        skillKeys.add(id);
    }
    const skills: Record<string, DerivedSkill> = {};
    for (const id of skillKeys) skills[id] = this.skillResult(id);
    const maxHp = this.hpResult();
    const speeds = {} as Record<MovementMode, EvaluationResult>;
    for (const mode of movementModes) speeds[mode] = this.movementResult(mode);
    const advancement = this.advancement
      ? {
          slotCount: this.advancement.slotCount,
          trackIds: this.advancement.tracks.map((track) => track.id),
          hitDiceCount: this.advancement.hitDiceCount,
          hitDieSides: this.advancement.hitDieSides,
          skillPoints: this.advancement.skillPoints,
          progressionLevels: Object.fromEntries(
            this.advancement.progressionLevels.map((progression) => [
              progression.id,
              this.progressionLevel(progression.id),
            ]),
          ),
          features: this.progressionFeatures(),
        }
      : undefined;
    return {
      input: this.character,
      grants: this.grants(),
      abilities,
      maxHp,
      ...(advancement ? { advancement } : {}),
      ...(this.character.experience
        ? { experience: this.experienceResult() }
        : {}),
      currentHp: maxHp.value - this.character.damageTaken,
      damageTaken: this.character.damageTaken,
      temporaryHp: this.character.temporaryHp,
      bab: this.bab(),
      saves,
      ac: this.ac("normal"),
      touchAc: this.ac("touch"),
      flatFootedAc: this.ac("flat-footed"),
      initiative: this.initiativeResult(),
      cmb: this.combat("cmb"),
      cmd: this.combat("cmd"),
      skills,
      size: { category: this.sizeCategory(), relative: this.sizeResult() },
      speeds,
      movement: speeds.land,
      attacks: this.attackDefinitions.map((attack) => this.attackFor(attack)),
    };
  }

  createSaveRollPlan(id: SaveId): RollPlan {
    const evaluation = this.save(id);
    return {
      id: `save:${this.character.id}:${id}`,
      characterId: this.character.id,
      label: `${id.charAt(0).toUpperCase()}${id.slice(1)} save`,
      dice: [{ sides: 20, count: 1 }],
      modifier: evaluation.value,
      metadata: { kind: "save", target: `save.${id}` },
    };
  }

  createAttackRollPlan(attackId: string, attackIndex = 0): RollPlan {
    const attack = this.attackDefinitions.find((item) => item.id === attackId);
    if (!attack) throw new Error(`Unknown attack: ${attackId}`);
    const derived = this.attackFor(attack);
    const evaluation = derived.fullAttack[attackIndex];
    if (!Number.isInteger(attackIndex) || !evaluation)
      throw new Error(`Unknown attack sequence index ${attackIndex}`);
    return {
      id: `attack:${this.character.id}:${attackId}${attackIndex ? `:${attackIndex}` : ""}`,
      characterId: this.character.id,
      label: `${attack.name} attack${attackIndex ? ` ${attackIndex + 1}` : ""}`,
      dice: [{ sides: 20, count: 1 }],
      modifier: evaluation.value,
      metadata: {
        kind: "attack",
        target: derived.attack.target,
        attackId,
        attackIndex,
      },
    };
  }
}

export function evaluateCharacter(
  character: CharacterInput,
  options?: RulesEngineOptions,
): DerivedCharacter {
  return new RulesEngine(character, options).derive();
}

export function evaluate(
  target: TargetId,
  character: CharacterInput,
  options?: RulesEngineOptions,
): EvaluationResult {
  return new RulesEngine(character, options).evaluate(target);
}

export type {
  CharacterInput,
  TargetId,
  Contribution,
  EvaluationResult,
  DerivedCharacter,
  DerivedAttack,
  DamageEvaluation,
  ProgressionCatalog,
  DerivedProgressionFeature,
} from "@threepointpf/rules-schema";
export { evaluateAdvancement, progressionLevel } from "./advancement.js";
export type {
  AdvancementEvaluation,
  SlotHitDie,
  TrackAdvancementResult,
  ProgressionIncrement,
  ProgressionLevelResult,
  AdvancementFeatureGrant,
} from "./advancement.js";
