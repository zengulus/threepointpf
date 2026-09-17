import type { RollPlan } from "@threepointpf/dice";
import {
  abilityIds,
  effectSchema,
  experienceCatalogSchema,
  mergeProgressionCatalogs,
  movementModes,
  normalizeAdvancementSlots,
  parseCharacterInput,
  saveIds,
  resolveProgressionId,
  type AbilityId,
  type ActionPlan,
  type AttackDefinition,
  type AttackProfileCatalog,
  type CharacterInput,
  type ContextualModifiers,
  type Contribution,
  type DefenseContext,
  type DerivedAttack,
  type DerivedCharacter,
  type DerivedProgressionFeature,
  type Effect,
  type EquipmentCatalog,
  type EvaluationResult,
  type ExcludedContribution,
  type ExperienceCatalog,
  type FeatureCatalog,
  type GrantedCapability,
  type ManeuverId,
  type MovementMode,
  type ProgressionAliasMap,
  type ProgressionCatalog,
  type RollContext,
  type RollDefense,
  type RollOutcomePolicySet,
  type SaveId,
  type SizeCategory,
  type SkillCatalog,
  type TargetContext,
  type TargetId,
} from "@threepointpf/rules-schema";
import {
  abilityModifier as scoreToModifier,
  lookup,
  reduceContributions,
  sourceContribution,
  sum,
} from "./contributions.js";
import {
  abilityContribution,
  evaluateAbilityModifier,
  evaluateAbilityScore,
} from "./abilities.js";
import {
  babContribution,
  evaluateArmorClass,
  evaluateCombatManeuver,
} from "./defenses.js";
import {
  collectEquipmentEffects,
  resolveEquipment,
} from "./equipment.js";
import {
  applyEffectOperations,
  baselineContribution,
  collectDirectModifiers,
  collectFeatureEffects,
  featureContextFlags,
  findReplacementEffect,
  resolveContextFlags,
} from "./effects.js";
import { labelForTarget } from "./labels.js";
import { experienceResult } from "./experience.js";
import {
  evaluateInitiative,
  evaluateSkill,
  initiativeRollPlan,
  type InitiativeRollOptions,
  type SkillRollOptions,
} from "./skills.js";
import {
  computeSizeResult,
  evaluateMovement,
  sizeAdjustment,
  sizeCategoryOf,
} from "./size.js";
import {
  attackRollPlan,
  buildActionPlan,
  damageRollPlan,
  deriveAttack,
  maneuverRollPlan,
  type ActionRequest,
  type AttackRollOptions,
  type DamageRollOptions,
} from "./attacks.js";
import { outcomePolicyFor, pf1eOutcomePolicies } from "./outcomes.js";
import type { EquipmentEntry, RulesRuntime } from "./runtime.js";
import {
  evaluateAdvancement,
  type AdvancementEvaluation,
  type ProgressionLevelResult,
} from "./advancement.js";

/**
 * The situational inputs a caller may supply for one roll: which flags to add or
 * withhold, and the known defense the roll is compared against. Nothing here is
 * a derived character fact.
 */
export interface RollRequestOptions {
  flags?: string[];
  /** Situational flags withheld, e.g. rolling without Combat Expertise. */
  excludeFlags?: string[];
  /** Known target defense; absent means hit/success stays unresolved. */
  defense?: RollDefense;
  target?: TargetContext;
}

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
  /**
   * Overrides how raw faces are interpreted per roll family. Only the families
   * a campaign changes need to be supplied; PF1e defaults fill the rest.
   */
  outcomePolicies?: Partial<RollOutcomePolicySet>;
}

export class RulesEngine implements RulesRuntime {
  readonly character: CharacterInput;
  readonly effects: Effect[];
  readonly equipment: EquipmentEntry[];
  readonly attackDefinitions: AttackDefinition[];
  readonly skillCatalog?: SkillCatalog;
  readonly attackProfileCatalog?: AttackProfileCatalog;
  readonly progressionCatalog?: ProgressionCatalog;
  readonly outcomePolicies: RollOutcomePolicySet;
  private readonly advancement?: AdvancementEvaluation;
  private readonly progressionAliases: ProgressionAliasMap;
  private readonly experienceCatalog?: ExperienceCatalog;
  private readonly featureFlags: string[];
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
    this.outcomePolicies = { ...pf1eOutcomePolicies, ...options.outcomePolicies };
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
      this.character = { ...character, advancementSlots: canonicalSlots };
      this.advancement = evaluateAdvancement(
        canonicalSlots,
        this.progressionCatalog,
        this.progressionAliases,
      );
    } else {
      this.character = character;
    }
    const effects = collectFeatureEffects(
      this.character,
      options.featureCatalog,
    );
    for (const feature of this.advancement?.features ?? []) {
      const definition = this.progressionCatalog?.[feature.progressionId];
      for (const effect of feature.effects ?? [])
        effects.push({
          ...effect,
          source: effect.source ?? {
            id: `advancement.slot.${feature.slotId}.track.${feature.trackId}.progression.${feature.progressionId}.feature.${feature.id}`,
            label: `${feature.name} (${definition?.name ?? feature.progressionId} ${feature.level})`,
            ...(definition?.source ? { content: definition.source } : {}),
          },
        });
    }
    this.equipment = resolveEquipment(character, options.equipmentCatalog);
    effects.push(...collectEquipmentEffects(this.equipment));
    this.effects = effects.map((effect) => effectSchema.parse(effect));
    this.featureFlags = featureContextFlags(
      this.character,
      options.featureCatalog,
    );
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
            // A weapon's own threat range wins over the profile it uses.
            ...(attack.criticalRange ?? profile.criticalRange
              ? { criticalRange: attack.criticalRange ?? profile.criticalRange }
              : {}),
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
            : effect.kind === "grant" || effect.kind === "criticalRange"
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

  // ---------------------------------------------------------------------
  // RulesRuntime: the shared numeric pipeline
  // ---------------------------------------------------------------------

  enabledContextFlags(): string[] {
    return this.featureFlags;
  }

  /** First-class BAB fact. Its contribution tree is shared by every BAB consumer. */
  bab(): EvaluationResult {
    if (this.babEvaluation) return this.babEvaluation;
    const target = "combat.bab" as TargetId;
    if (!this.advancement) {
      this.babEvaluation = this.result(target, [
        this.replacement(
          target,
          this.character.baseBab ?? 0,
          "base-bab",
          "Base Attack Bonus",
        ),
        ...this.directModifiers(target).applied,
      ]);
      return this.babEvaluation;
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
    this.babEvaluation = this.result(target, [
      replacement,
      ...this.directModifiers(target).applied,
    ]);
    return this.babEvaluation;
  }

  replacementEffect(
    target: TargetId,
  ): Extract<Effect, { kind: "replaceBase" }> | undefined {
    return findReplacementEffect(this.effects, target);
  }

  /** A replaceBase effect replaces the intrinsic/base scalar; dependencies and modifiers still apply. */
  replacement(
    target: TargetId,
    fallback: number,
    source: string,
    label: string,
  ): Contribution {
    return baselineContribution(
      this.replacementEffect(target),
      target,
      fallback,
      source,
      label,
    );
  }

  directModifiers(
    target: TargetId,
    options: Parameters<RulesRuntime["directModifiers"]>[1] = {},
  ): ContextualModifiers {
    return collectDirectModifiers(
      { effects: this.effects, bab: () => this.bab() },
      target,
      options,
    );
  }

  result(
    target: TargetId,
    contributions: Contribution[],
    options: Parameters<RulesRuntime["result"]>[2] = {},
  ): EvaluationResult {
    const reduced = reduceContributions(contributions);
    const operated =
      options.applyOperations === false
        ? reduced
        : applyEffectOperations(this.effects, target, reduced);
    const value = sum(operated);
    if (!Number.isFinite(value))
      throw new Error(`Non-finite derived value for ${target}`);
    return {
      target,
      value,
      contributions: operated,
      ...(options.context ? { context: options.context } : {}),
      ...(options.rollContext ? { rollContext: options.rollContext } : {}),
      ...(options.excluded?.length ? { excluded: options.excluded } : {}),
    };
  }

  abilityScore(id: AbilityId): EvaluationResult {
    return evaluateAbilityScore(this, id);
  }

  /** The evaluated ability modifier with its nonlinear dependency chain. */
  abilityModifier(id: AbilityId): EvaluationResult {
    return evaluateAbilityModifier(this, id);
  }

  abilityModifierValue(id: AbilityId): number {
    return scoreToModifier(this.abilityScore(id).value);
  }

  abilityContribution(id: AbilityId, target: TargetId): Contribution {
    return abilityContribution(this, id, target);
  }

  sizeResult(): EvaluationResult {
    if (!this.sizeEvaluation) this.sizeEvaluation = computeSizeResult(this);
    return this.sizeEvaluation;
  }

  sizeCategory(): SizeCategory {
    return sizeCategoryOf(this);
  }

  sizeAdjustment(
    target: TargetId,
    perCategoryStep: number,
    label: string,
  ): Contribution {
    return sizeAdjustment(this, target, perCategoryStep, label);
  }

  movementResult(mode: MovementMode = "land"): EvaluationResult {
    return evaluateMovement(this, mode);
  }

  advancementProgressionLevels(): ProgressionLevelResult[] {
    return this.advancement?.progressionLevels ?? [];
  }

  progressionDefinition(id: string) {
    return lookup(this.progressionCatalog, id);
  }

  // ---------------------------------------------------------------------
  // Progression evidence
  // ---------------------------------------------------------------------

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
        sourceContribution(
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

  // ---------------------------------------------------------------------
  // Saves and HP
  // ---------------------------------------------------------------------

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

  /** The situational identity of one save, including any known DC. */
  private saveContext(id: SaveId, options: RollRequestOptions = {}): RollContext {
    const target: TargetContext | undefined =
      options.target || options.defense
        ? {
            ...(options.target ?? {}),
            ...(options.defense ? { defense: options.defense } : {}),
          }
        : undefined;
    return {
      kind: "save",
      actorCharacterId: this.character.id,
      action: { kind: "save" },
      saveId: id,
      flags: resolveContextFlags(
        this.enabledContextFlags(),
        options.flags,
        options.excludeFlags,
      ),
      ...(options.excludeFlags?.length
        ? { excludeFlags: options.excludeFlags }
        : {}),
      ...(target ? { target } : {}),
    };
  }

  private save(
    id: SaveId,
    options: RollRequestOptions = {},
    context: RollContext = this.saveContext(id, options),
  ): EvaluationResult {
    const target = `save.${id}` as TargetId;
    const ability: AbilityId =
      id === "fortitude" ? "con" : id === "reflex" ? "dex" : "wis";
    const modifiers = this.directModifiers(target, {
      context,
      reportExclusions: true,
    });
    return this.result(
      target,
      [
        this.advancement
          ? this.baseSaveContribution(id, target)
          : this.replacement(
              target,
              this.character.baseSaves?.[id] ?? 0,
              `base-save.${id}`,
              `Base ${id}`,
            ),
        this.abilityContribution(ability, target),
        ...modifiers.applied,
      ],
      { rollContext: context, excluded: modifiers.excluded },
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
      ...this.directModifiers("hp").applied,
    ]);
  }

  // ---------------------------------------------------------------------
  // Public evaluation surface
  // ---------------------------------------------------------------------

  /**
   * Evaluates a target. Scalar sheet facts use their authored defaults;
   * contextual facts use the default context (enabled feature flags, no
   * maneuver, standard attack) so an uncontextualized query stays meaningful.
   */
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
    if (target === "cmb" || target === "cmd")
      return this.combat(target);
    if (target === "size.relative") return this.sizeResult();
    if (target.startsWith("skill.") && target !== "skill.all")
      return this.skillResult(target.slice(6)).total;
    if (target.startsWith("speed."))
      return this.movementResult(target.slice("speed.".length) as MovementMode);
    // A bare fact query names no action, so it carries no action context: an
    // effect that needs one is excluded rather than assumed to apply.
    const context: RollContext | undefined =
      target.startsWith("attack.") || target.startsWith("damage.")
        ? {
            kind: target.startsWith("attack.") ? "attack" : "damage",
            actorCharacterId: this.character.id,
            action: { kind: "other" },
          }
        : undefined;
    const direct = this.directModifiers(target, {
      context,
      reportExclusions: context !== undefined,
    });
    return this.result(
      target,
      [
        this.replacement(target, 0, `${target}.base`, labelForTarget(target)),
        ...direct.applied,
      ],
      { excluded: direct.excluded },
    );
  }

  private ac(kind: "normal" | "touch" | "flat-footed"): EvaluationResult {
    return evaluateArmorClass(this, kind);
  }

  private combat(
    target: "cmb" | "cmd",
    options: { maneuver?: ManeuverId; flags?: string[] } = {},
  ): EvaluationResult {
    return evaluateCombatManeuver(this, target, options);
  }

  private initiativeResult(): EvaluationResult {
    return evaluateInitiative(this);
  }

  private skillResult(id: string, options: SkillRollOptions = {}) {
    return evaluateSkill(this, id, options);
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
    return experienceResult(this, this.experienceCatalog);
  }

  derive(): DerivedCharacter {
    const abilities = {} as DerivedCharacter["abilities"];
    for (const id of abilityIdsForDerive)
      abilities[id] = {
        score: this.abilityScore(id),
        modifier: this.abilityModifier(id),
      };
    const saves = {} as DerivedCharacter["saves"];
    for (const id of saveIdsForDerive) saves[id] = this.save(id);
    const skillKeys = new Set(Object.keys(this.character.skillRanks));
    for (const id of Object.keys(this.character.skills ?? {}))
      skillKeys.add(id);
    for (const id of Object.keys(this.skillCatalog ?? {})) skillKeys.add(id);
    for (const progression of this.advancement?.progressionLevels ?? []) {
      for (const id of this.progressionCatalog?.[progression.id]?.classSkills ??
        [])
        skillKeys.add(id);
    }
    const skills: Record<string, DerivedSkillLike> = {};
    for (const id of skillKeys) skills[id] = this.skillResult(id);
    const maxHp = this.hpResult();
    const speeds = {} as Record<MovementMode, EvaluationResult>;
    for (const mode of movementModesForDerive)
      speeds[mode] = this.movementResult(mode);
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
      attacks: this.attackDefinitions.map((attack) =>
        deriveAttack(this, attack),
      ),
    };
  }

  // ---------------------------------------------------------------------
  // Roll plans and actions
  // ---------------------------------------------------------------------

  createSaveRollPlan(id: SaveId, options: RollRequestOptions = {}): RollPlan {
    const context = this.saveContext(id, options);
    const evaluation = this.save(id, options, context);
    return {
      id: `save:${this.character.id}:${id}`,
      characterId: this.character.id,
      label: `${id.charAt(0).toUpperCase()}${id.slice(1)} save`,
      dice: [{ sides: 20, count: 1 }],
      modifier: evaluation.value,
      context,
      outcomePolicy: this.outcomePolicies.save,
      provenance: {
        modifier: evaluation.contributions,
        excluded: evaluation.excluded ?? [],
      },
    };
  }

  /** A contextual plan for one member of one attack's sequence. */
  createAttackRollPlan(
    attackId: string,
    attackIndex = 0,
    options: AttackRollOptions = {},
  ): RollPlan {
    return attackRollPlan(this, attackId, attackIndex, options);
  }

  createManeuverRollPlan(
    maneuver?: ManeuverId,
    options: RollRequestOptions = {},
  ): RollPlan {
    return maneuverRollPlan(this, maneuver, options);
  }

  /**
   * The damage plan of one attack's sequence member. `criticalDamage` rolls the
   * damage twice, so a critical outcome resolves through the same contract as
   * an ordinary hit instead of the caller doubling anything.
   */
  createDamageRollPlan(
    attackId: string,
    options: DamageRollOptions = {},
  ): RollPlan {
    return damageRollPlan(this, attackId, options);
  }

  createInitiativeRollPlan(options: InitiativeRollOptions = {}): RollPlan {
    return initiativeRollPlan(this, options);
  }

  /**
   * The explicit action plan: an action, its selected attacks and the role of
   * every step. Browser and server both rebuild from authored state plus the
   * request context; no client computes a modifier.
   */
  createActionPlan(request: ActionRequest): ActionPlan {
    return buildActionPlan(this, request);
  }

  createManeuverAction(
    maneuver?: ManeuverId,
    flags: string[] = [],
    excludeFlags: string[] = [],
  ): ActionPlan {
    return buildActionPlan(this, {
      action: "maneuver",
      maneuver,
      flags,
      excludeFlags,
    });
  }

  createSkillRollPlan(
    id: string,
    options: RollRequestOptions = {},
  ): RollPlan {
    const skill = evaluateSkill(this, id, options);
    const context = skill.total.rollContext;
    if (!context)
      throw new Error(`Skill ${id} produced no roll context`);
    const flags = options.flags ?? [];
    return {
      id: `skill:${this.character.id}:${id}${flags.length ? `:${flags.join("+")}` : ""}`,
      characterId: this.character.id,
      label: `${skill.label} check`,
      dice: [{ sides: 20, count: 1 }],
      modifier: skill.total.value,
      context: { ...context, skillId: id },
      outcomePolicy: this.outcomePolicies.skill,
      provenance: {
        modifier: skill.total.contributions,
        excluded: skill.total.excluded ?? [],
      },
    };
  }
}

type DerivedSkillLike = DerivedCharacter["skills"][string];

const abilityIdsForDerive: readonly AbilityId[] = abilityIds;
const saveIdsForDerive: readonly SaveId[] = saveIds;
const movementModesForDerive: readonly MovementMode[] = movementModes;

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

export type { DefenseContext, Contribution, ExcludedContribution };
