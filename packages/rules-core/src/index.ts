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
  type ProgressionCatalog,
  type SaveId,
  saveIds,
  type SkillConfiguration,
  type SkillId,
  type TargetId,
  targetLabels,
} from "@threepointpf/rules-schema";
import type { RollPlan } from "@threepointpf/dice";
import { evaluateAdvancement, type AdvancementEvaluation } from "./advancement.js";

/** Concrete progression content belongs to a caller-owned catalog, never rules-core. */
export interface RulesEngineOptions {
  progressionCatalog?: ProgressionCatalog;
}

const defaultSkillAbilities: Record<string, AbilityId> = {
  acrobatics: "dex", appraise: "int", bluff: "cha", climb: "str", craft: "int", diplomacy: "cha",
  "disable-device": "dex", disguise: "cha", "escape-artist": "dex", fly: "dex", "handle-animal": "cha",
  heal: "wis", intimidate: "cha", "knowledge-arcana": "int", "knowledge-dungeoneering": "int",
  "knowledge-engineering": "int", "knowledge-geography": "int", "knowledge-history": "int",
  "knowledge-local": "int", "knowledge-nature": "int", "knowledge-nobility": "int", "knowledge-planes": "int",
  "knowledge-religion": "int", linguistics: "int", perception: "wis", perform: "cha", profession: "wis",
  ride: "dex", "sense-motive": "wis", "sleight-of-hand": "dex", spellcraft: "int", stealth: "dex",
  survival: "wis", swim: "str", "use-magic-device": "cha",
};

const skillDisplayNames: Record<string, string> = {
  "disable-device": "Disable Device", "escape-artist": "Escape Artist", "handle-animal": "Handle Animal",
  "knowledge-arcana": "Knowledge (Arcana)", "knowledge-dungeoneering": "Knowledge (Dungeoneering)",
  "knowledge-engineering": "Knowledge (Engineering)", "knowledge-geography": "Knowledge (Geography)",
  "knowledge-history": "Knowledge (History)", "knowledge-local": "Knowledge (Local)", "knowledge-nature": "Knowledge (Nature)",
  "knowledge-nobility": "Knowledge (Nobility)", "knowledge-planes": "Knowledge (Planes)", "knowledge-religion": "Knowledge (Religion)",
  "sense-motive": "Sense Motive", "sleight-of-hand": "Sleight of Hand", "spellcraft": "Spellcraft", "use-magic-device": "Use Magic Device",
};

const stackableBonusTypes = new Set<BonusType>(["untyped", "dodge", "circumstance", "penalty"]);

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Pathfinder typed reduction: stackable types sum; other types keep the best positive bonus and all penalties. */
export function reduceContributions(contributions: Contribution[]): Contribution[] {
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

function sourceContribution(target: TargetId, value: number, source: string, label: string, bonusType?: BonusType, extras: Pick<Contribution, "appliesTo" | "children" | "note"> = {}): Contribution {
  return { target, value, source, label, ...(bonusType ? { bonusType } : {}), ...extras };
}

function labelForTarget(target: TargetId): string {
  if (targetLabels[target]) return targetLabels[target];
  if (target.startsWith("skill.")) return skillLabel(target.slice(6));
  return target;
}

export function skillLabel(id: string): string {
  return skillDisplayNames[id] ?? id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function featureEffects(character: CharacterInput): Effect[] {
  const effects: Effect[] = [];
  for (const feature of character.features) {
    if (!feature.enabled) continue;
    for (const effect of feature.effects) {
      if (effect.kind === "modifier" && effect.target === "ac" && (!effect.appliesTo || effect.appliesTo.length === 0)) {
        throw new Error("AC modifiers require explicit appliesTo contexts");
      }
      const source = effect.source ?? { id: `feature.${feature.id}`, label: feature.name };
      effects.push({ ...effect, source });
    }
  }
  return effects;
}

function effectContribution(effect: Extract<Effect, { kind: "modifier" }>, target: TargetId): Contribution {
  return sourceContribution(target, effect.value, effect.source?.id ?? "effect", effect.source?.label ?? "Effect", effect.bonusType, { appliesTo: "appliesTo" in effect ? effect.appliesTo : undefined });
}

function base(target: TargetId, value: number, source: string, label: string): Contribution {
  return sourceContribution(target, value, source, label);
}

export class RulesEngine {
  readonly character: CharacterInput;
  private readonly effects: Effect[];
  private readonly advancement?: AdvancementEvaluation;
  private readonly progressionCatalog?: ProgressionCatalog;
  /** `combat.bab` is a shared derived fact, not a fresh baseline per consumer. */
  private babEvaluation?: EvaluationResult;

  constructor(character: CharacterInput, options: RulesEngineOptions = {}) {
    this.character = character;
    this.effects = featureEffects(character);
    this.progressionCatalog = options.progressionCatalog;
    if (character.advancementSlots?.length) {
      if (!this.progressionCatalog) throw new Error("Advancement requires an injected progression catalog");
      this.advancement = evaluateAdvancement(character.advancementSlots, this.progressionCatalog);
    }
    const replacementTargets = new Set<TargetId>();
    for (const effect of this.effects) {
      if (effect.kind !== "replaceBase") continue;
      if (replacementTargets.has(effect.target)) throw new Error(`Ambiguous active baseline replacements for ${effect.target}`);
      replacementTargets.add(effect.target);
    }
  }

  private directModifiers(target: TargetId): Contribution[] {
    const matching: Contribution[] = [];
    for (const effect of this.effects) {
      if (effect.target !== target) continue;
      if (effect.kind === "modifier") matching.push(effectContribution(effect, target));
    }
    return matching;
  }

  private trackIncrementEvidence(target: TargetId, track: AdvancementEvaluation["tracks"][number], property: "bab" | SaveId): Contribution[] {
    return track.increments.map((increment) => {
      const definition = this.progressionCatalog?.[increment.progressionId];
      const value = property === "bab" ? increment.bab : increment.saves[property];
      const suffix = property === "bab" ? "bab" : `save.${property}`;
      return sourceContribution(
        target,
        value,
        `advancement.slot.${increment.slotId}.track.${increment.trackId}.progression.${increment.progressionId}.${suffix}`,
        `${definition?.name ?? increment.progressionId} ${property === "bab" ? "BAB" : property} at level ${increment.level}`,
        undefined,
        { note: `Character-global ${definition?.name ?? increment.progressionId} level ${increment.previousLevel} → ${increment.level}; credited to track ${increment.trackId}` },
      );
    });
  }

  private trackEvidence(target: TargetId, property: "bab" | SaveId, selected: string): Contribution[] {
    if (!this.advancement) return [];
    return this.advancement.tracks.map((track) => {
      const value = property === "bab" ? track.bab : track.saves[property];
      const sourceProperty = property === "bab" ? "bab" : `save.${property}`;
      return sourceContribution(target, value, `advancement.track.${track.id}.${sourceProperty}`, `Track ${track.id} ${property === "bab" ? "BAB" : property}`, undefined, {
        note: track.id === selected ? "Selected complete-track total" : "Complete-track candidate",
        children: this.trackIncrementEvidence(target, track, property),
      });
    });
  }

  /** First-class BAB fact. Its contribution tree is shared by every BAB consumer. */
  bab(): EvaluationResult {
    if (this.babEvaluation) return this.babEvaluation;
    const target = "combat.bab" as TargetId;
    if (!this.advancement) {
      const result = this.result(target, [this.replacement(target, this.character.baseBab ?? 0, "base-bab", "Base Attack Bonus"), ...this.directModifiers(target)]);
      this.babEvaluation = result;
      return result;
    }
    const selected = this.advancement.babTrack;
    const fallback = sourceContribution(target, selected.bab, `advancement.track.${selected.id}.bab`, `Track ${selected.id} BAB`, undefined, {
      children: this.trackEvidence(target, "bab", selected.id),
      note: "Best complete advancement-track total",
    });
    const replacement = this.effects.some((effect) => effect.kind === "replaceBase" && effect.target === target)
      ? this.replacement(target, selected.bab, `advancement.track.${selected.id}.bab`, `Track ${selected.id} BAB`)
      : fallback;
    const result = this.result(target, [replacement, ...this.directModifiers(target)]);
    this.babEvaluation = result;
    return result;
  }

  /** Copy the already-evaluated BAB fact into a consuming target exactly once. */
  private babContribution(target: TargetId): Contribution {
    const bab = this.bab();
    return sourceContribution(target, bab.value, "combat.bab", "Base Attack Bonus", undefined, {
      children: bab.contributions,
      note: "Consumed from the first-class combat.bab fact",
    });
  }

  /** Query a character-global progression level with every slot/track origin retained. */
  progressionLevel(progressionId: string): EvaluationResult {
    const definition = this.progressionCatalog?.[progressionId];
    if (!definition) throw new Error(`Unknown progression definition ${progressionId}`);
    const target = `progression.${progressionId}.level` as TargetId;
    const progression = this.advancement?.progressionLevels.find((item) => item.id === progressionId);
    if (!progression) return this.result(target, [base(target, 0, `progression.${progressionId}.level`, `${definition.name} level`)]);
    return this.result(target, progression.increments.map((increment) => sourceContribution(
      target,
      1,
      `advancement.slot.${increment.slotId}.track.${increment.trackId}.progression.${progressionId}.level.${increment.level}`,
      `${definition.name} level ${increment.level}`,
      undefined,
      { note: `Character-global level ${increment.level}, earned in slot ${increment.slotId} on track ${increment.trackId}` },
    )));
  }

  /** Metadata-only class-chart feature unlocks; no unmodelled mechanics are inferred. */
  progressionFeatures(progressionId?: string): DerivedProgressionFeature[] {
    return (this.advancement?.features ?? [])
      .filter((feature) => !progressionId || feature.progressionId === progressionId)
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
            { note: `Unlocked at character-global ${feature.progressionId} level ${feature.level}; credited to track ${feature.trackId}` },
          ),
        };
      });
  }

  private baseSaveContribution(id: SaveId, target: TargetId): Contribution {
    if (!this.advancement) return this.replacement(target, this.character.baseSaves?.[id] ?? 0, `base-save.${id}`, `Base ${id}`);
    const selected = this.advancement.saveTracks[id];
    if (this.effects.some((effect) => effect.kind === "replaceBase" && effect.target === target)) return this.replacement(target, selected.saves[id], `advancement.track.${selected.id}.save.${id}`, `Track ${selected.id} ${id}`);
    return sourceContribution(target, selected.saves[id], `advancement.track.${selected.id}.save.${id}`, `Track ${selected.id} ${id}`, undefined, { children: this.trackEvidence(target, id, selected.id), note: "Best complete advancement-track total" });
  }

  private hitDiceCountContribution(): Contribution {
    if (!this.advancement) return sourceContribution("hp", this.character.hitDiceCount ?? 0, "manual-hit-dice-count", "Hit dice count");
    return sourceContribution("hp", this.advancement.hitDiceCount, "advancement.hit-dice-count", `${this.advancement.hitDiceCount} hit dice`, undefined, {
      note: "One hit die per ordered slot; best die type per slot",
      children: this.advancement.hitDieSources.map((source) => sourceContribution("hp", source.sides, `advancement.slot.${source.slotId}.track.${source.trackId}.hit-die`, `Slot ${source.slotId}: Track ${source.trackId} d${source.sides}`, undefined, { note: "Selected best hit die for slot" })),
    });
  }

  /** A replaceBase effect replaces the intrinsic/base scalar; dependencies and modifiers still apply. */
  private replacementEffect(target: TargetId): Extract<Effect, { kind: "replaceBase" }> | undefined {
    const replacements = this.effects.filter((effect): effect is Extract<Effect, { kind: "replaceBase" }> => effect.kind === "replaceBase" && effect.target === target);
    if (replacements.length > 1) throw new Error(`Ambiguous active baseline replacements for ${target}`);
    return replacements[0];
  }

  private replacement(target: TargetId, fallback: number, source: string, label: string): Contribution {
    const replacement = this.replacementEffect(target);
    return replacement ? base(target, replacement.value, replacement.source?.id ?? "effect", replacement.source?.label ?? "Baseline replacement") : base(target, fallback, source, label);
  }

  private result(target: TargetId, contributions: Contribution[], context?: DefenseContext): EvaluationResult {
    const reduced = reduceContributions(contributions);
    return { target, value: sum(reduced), contributions: reduced, ...(context ? { context } : {}) };
  }

  abilityScore(id: AbilityId): EvaluationResult {
    const target = `ability.${id}` as TargetId;
    const contributions = [this.replacement(target, this.character.baseAbilities[id], "base-ability", `Base ${id.toUpperCase()}`), ...this.directModifiers(target)];
    const raw = this.result(target, contributions);
    if (raw.value >= 0) return raw;
    const floor = base(target, -raw.value, "rules-core.ability-floor", "Ability score minimum");
    return { ...raw, value: 0, contributions: [...raw.contributions, floor] };
  }

  abilityModifier(id: AbilityId): EvaluationResult {
    const score = this.abilityScore(id);
    const target = `ability.${id}` as TargetId;
    const modifier = abilityModifier(score.value);
    const scoreNode = sourceContribution(target, score.value, `ability.${id}.score`, `${id.toUpperCase()} score`, undefined, { children: score.contributions });
    return {
      target,
      value: modifier,
      contributions: [sourceContribution(target, modifier, `ability.${id}.modifier`, `${id.toUpperCase()} modifier`, undefined, { note: "floor((score - 10) / 2)", children: [scoreNode] })],
    };
  }

  private abilityContribution(id: AbilityId, target: TargetId): Contribution {
    const score = this.abilityScore(id);
    const modifier = abilityModifier(score.value);
    const scoreNode = sourceContribution(`ability.${id}` as TargetId, score.value, `ability.${id}.score`, `${id.toUpperCase()} score`, undefined, { children: score.contributions });
    return sourceContribution(target, modifier, `ability.${id}.modifier`, `${id.toUpperCase()} modifier`, undefined, { note: "floor((score - 10) / 2)", children: [scoreNode] });
  }

  private save(id: SaveId): EvaluationResult {
    const target = `save.${id}` as TargetId;
    const ability: AbilityId = id === "fortitude" ? "con" : id === "reflex" ? "dex" : "wis";
    const contributions = [
      this.advancement ? this.baseSaveContribution(id, target) : this.replacement(target, this.character.baseSaves?.[id] ?? 0, `base-save.${id}`, `Base ${id}`),
      this.abilityContribution(ability, target),
      ...this.directModifiers(target),
    ];
    return this.result(target, contributions);
  }

  private ac(kind: "normal" | "touch" | "flat-footed"): EvaluationResult {
    const target = "ac" as TargetId;
    const contributions: Contribution[] = [this.replacement(target, 10, "ac.base", "Base AC")];
    if (kind !== "flat-footed") contributions.push(this.abilityContribution("dex", target));
    const direct = [...this.directModifiers("ac")];
    const natural = [this.replacement("ac.natural", 0, "ac.natural.base", "Base natural armor"), ...this.directModifiers("ac.natural")];
    if (kind === "touch") {
      contributions.push(...direct.filter((item) => this.appliesToDefense(item, "touch")));
    } else if (kind === "flat-footed") {
      contributions.push(...direct.filter((item) => this.appliesToDefense(item, "flatFooted")));
      contributions.push(...natural);
    } else {
      contributions.push(...direct, ...natural);
    }
    return this.result(target, contributions, kind === "flat-footed" ? "flatFooted" : kind);
  }

  private appliesToDefense(contribution: Contribution, context: DefenseContext): boolean {
    // Missing applicability is invalid metadata, never a broad/general effect.
    return contribution.appliesTo?.includes(context) ?? false;
  }

  private initiativeResult(): EvaluationResult {
    const target = "initiative" as TargetId;
    return this.result(target, [this.replacement(target, 0, "initiative.base", "Base initiative"), this.abilityContribution("dex", target), ...this.directModifiers(target), ...this.skillLikeInitiativeEffects(target)]);
  }

  private skillLikeInitiativeEffects(target: TargetId): Contribution[] {
    return this.effects.flatMap((effect) => {
      if (effect.kind !== "modifier" || !effect.source) return [];
      if (effect.target !== "skill.all" && effect.target !== "skill.initiative") return [];
      return [effectContribution(effect, target)];
    });
  }

  private combat(target: "cmb" | "cmd"): EvaluationResult {
    const contributions: Contribution[] = [
      this.replacement(target, target === "cmd" ? 10 : 0, `${target}.base`, target === "cmd" ? "Base CMD" : "Base CMB"),
      this.babContribution(target),
      this.abilityContribution("str", target),
      ...(target === "cmd" ? [this.abilityContribution("dex", target)] : []),
      ...this.directModifiers(target),
    ];
    return this.result(target, contributions);
  }

  private skillResult(id: string): DerivedSkill {
    const config: SkillConfiguration = this.character.skills?.[id] ?? { governingAbility: defaultSkillAbilities[id] ?? "int" };
    const ranks = this.character.skillRanks[id] ?? 0;
    const target = `skill.${id}` as TargetId;
    const contributions = [
      this.replacement(target, ranks, `skill.${id}.ranks`, "Skill ranks"),
      this.abilityContribution(config.governingAbility, target),
      ...(config.classSkill && ranks > 0 ? [base(target, 3, `skill.${id}.class`, "Class skill")] : []),
      ...(config.miscellaneous ? [base(target, config.miscellaneous, `skill.${id}.misc`, "Miscellaneous skill bonus")] : []),
      ...(config.armorAndSize ? [base(target, config.armorAndSize, `skill.${id}.armor-size`, "Armor/size adjustment")] : []),
      ...this.directModifiers("skill.all"),
      ...this.directModifiers(target),
    ];
    const total = this.result(target, contributions);
    return { id: id as SkillId, label: skillLabel(id), total, ranks, governingAbility: config.governingAbility, classSkill: Boolean(config.classSkill) };
  }

  private movementResult(): EvaluationResult {
    const target = "speed.land" as TargetId;
    return this.result(target, [this.replacement(target, this.character.baseLandSpeed ?? 30, "base-speed.land", "Base land speed"), ...this.directModifiers(target)]);
  }

  private hpResult(): EvaluationResult {
    const constitution = this.abilityContribution("con", "hp");
    const hitDice = this.hitDiceCountContribution();
    return this.result("hp", [this.replacement("hp", this.character.baseHpBeforeConstitution, "base-hp-before-con", "HP before Constitution"), {
      ...constitution,
      value: constitution.value * hitDice.value,
      label: `${hitDice.value}× ${constitution.label}`,
      note: `${hitDice.value} × (${constitution.note ?? "CON modifier"})`,
      children: [...(constitution.children ?? []), hitDice],
    }]);
  }

  private attackFor(definition: AttackDefinition): DerivedAttack {
    const mode = definition.mode ?? (definition.attackTags?.includes("weapon.ranged") ? "ranged" : "melee");
    const target = `attack.${mode}` as TargetId;
    const attackReplacement = this.replacementEffect(target);
    // Pre-combat.bab saves used replaceBase(attack.*) as a replacement for the
    // whole BAB-backed attack baseline. Retain that authored meaning rather
    // than silently turning old data into an additive bonus.
    const attackBaseline = attackReplacement
      ? [sourceContribution(target, attackReplacement.value, attackReplacement.source?.id ?? "effect", attackReplacement.source?.label ?? "Baseline replacement", undefined, {
        note: "Legacy attack baseline replacement overrides combat.bab for this attack mode",
        children: [this.babContribution(target)],
      })]
      : [this.replacement(target, 0, `${target}.base`, labelForTarget(target)), this.babContribution(target)];
    const attackContributions = [
      ...attackBaseline,
      this.abilityContribution(definition.attackAbility, target),
      ...(definition.weaponBonus ? [base(target, definition.weaponBonus, `weapon.${definition.id}`, "Weapon bonus")] : []),
      ...this.directModifiers(target),
    ];
    const attack = this.result(target, attackContributions);
    const damageTarget = `damage.${mode}` as TargetId;
    const multiplier = definition.damageAbilityMultiplier ?? 1;
    const damageContributions = definition.damageAbility
      ? [this.replacement(damageTarget, 0, "damage.base", "Base damage modifier"), sourceContribution(damageTarget, Math.floor(this.abilityModifier(definition.damageAbility).value * multiplier), `ability.${definition.damageAbility}.damage`, `${definition.damageAbility.toUpperCase()} damage (${multiplier}×)`, undefined, { children: [sourceContribution(`ability.${definition.damageAbility}` as TargetId, this.abilityScore(definition.damageAbility).value, `${"ability." + definition.damageAbility}.score`, `${definition.damageAbility.toUpperCase()} score`, undefined, { children: this.abilityScore(definition.damageAbility).contributions })] }), ...this.directModifiers(damageTarget)]
      : [this.replacement(damageTarget, 0, "damage.base", "Base damage modifier"), ...this.directModifiers(damageTarget)];
    const reducedDamage = reduceContributions(damageContributions);
    const modifier = sum(reducedDamage);
    const damage: DamageEvaluation = {
      formula: `${definition.baseDamage.count}d${definition.baseDamage.sides}${modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}`,
      dice: definition.baseDamage,
      modifier,
      contributions: reducedDamage,
    };
    return { definition, attack, damage };
  }

  evaluate(target: TargetId): EvaluationResult {
    if (target.startsWith("ability.")) return this.abilityScore(target.slice(8) as AbilityId);
    if (target.startsWith("save.")) return this.save(target.slice(5) as SaveId);
    if (target === "combat.bab") return this.bab();
    if (target.startsWith("progression.") && target.endsWith(".level")) return this.progressionLevel(target.slice("progression.".length, -".level".length));
    if (target === "ac") return this.ac("normal");
    if (target === "hp") return this.hpResult();
    if (target === "initiative") return this.initiativeResult();
    if (target === "cmb" || target === "cmd") return this.combat(target);
    if (target.startsWith("skill.")) return this.skillResult(target.slice(6)).total;
    if (target === "speed.land") return this.movementResult();
    const direct = this.directModifiers(target);
    return this.result(target, [this.replacement(target, 0, `${target}.base`, labelForTarget(target)), ...direct]);
  }

  /** Grants are intentionally non-numeric in v0: they expose capabilities for future consumers. */
  grants(): GrantedCapability[] {
    return this.effects.flatMap((effect) => effect.kind === "grant" ? [{ target: effect.target, grant: effect.grant, source: effect.source ?? { id: "effect", label: "Effect" } }] : []);
  }

  derive(): DerivedCharacter {
    const abilities = {} as DerivedCharacter["abilities"];
    for (const id of abilityIds) abilities[id] = { score: this.abilityScore(id), modifier: this.abilityModifier(id) };
    const saves = {} as DerivedCharacter["saves"];
    for (const id of saveIds) saves[id] = this.save(id);
    const skillKeys = new Set(Object.keys(this.character.skillRanks));
    for (const id of Object.keys(this.character.skills ?? {})) skillKeys.add(id);
    const skills: Record<string, DerivedSkill> = {};
    for (const id of skillKeys) skills[id] = this.skillResult(id);
    const maxHp = this.hpResult();
    const advancement = this.advancement ? {
      slotCount: this.advancement.slotCount,
      trackIds: this.advancement.tracks.map((track) => track.id),
      hitDiceCount: this.advancement.hitDiceCount,
      hitDieSides: this.advancement.hitDieSides,
      skillPoints: this.advancement.skillPoints,
      progressionLevels: Object.fromEntries(this.advancement.progressionLevels.map((progression) => [progression.id, this.progressionLevel(progression.id)])),
      features: this.progressionFeatures(),
    } : undefined;
    return {
      input: this.character,
      grants: this.grants(),
      abilities,
      maxHp,
      ...(advancement ? { advancement } : {}),
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
      movement: this.movementResult(),
      attacks: this.character.attacks.map((attack) => this.attackFor(attack)),
    };
  }

  createSaveRollPlan(id: SaveId): RollPlan {
    const evaluation = this.save(id);
    return { id: `save:${this.character.id}:${id}`, characterId: this.character.id, label: `${id.charAt(0).toUpperCase()}${id.slice(1)} save`, dice: [{ sides: 20, count: 1 }], modifier: evaluation.value, metadata: { kind: "save", target: `save.${id}` } };
  }

  createAttackRollPlan(attackId: string): RollPlan {
    const attack = this.character.attacks.find((item) => item.id === attackId);
    if (!attack) throw new Error(`Unknown attack: ${attackId}`);
    const derived = this.attackFor(attack);
    return { id: `attack:${this.character.id}:${attackId}`, characterId: this.character.id, label: `${attack.name} attack`, dice: [{ sides: 20, count: 1 }], modifier: derived.attack.value, metadata: { kind: "attack", target: derived.attack.target, attackId } };
  }
}

export function evaluateCharacter(character: CharacterInput, options?: RulesEngineOptions): DerivedCharacter {
  return new RulesEngine(character, options).derive();
}

export function evaluate(target: TargetId, character: CharacterInput, options?: RulesEngineOptions): EvaluationResult {
  return new RulesEngine(character, options).evaluate(target);
}

export type { CharacterInput, TargetId, Contribution, EvaluationResult, DerivedCharacter, DerivedAttack, DamageEvaluation, ProgressionCatalog, DerivedProgressionFeature } from "@threepointpf/rules-schema";
export { evaluateAdvancement, progressionLevel } from "./advancement.js";
export type { AdvancementEvaluation, SlotHitDie, TrackAdvancementResult, ProgressionIncrement, ProgressionLevelResult, AdvancementFeatureGrant } from "./advancement.js";
