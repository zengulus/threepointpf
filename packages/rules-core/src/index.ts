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
  type GrantedCapability,
  type SaveId,
  saveIds,
  type SkillConfiguration,
  type SkillId,
  type TargetId,
  targetLabels,
} from "@threepointpf/rules-schema";
import type { RollPlan } from "@threepointpf/dice";

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
      const source = effect.source ?? { id: `feature.${feature.id}`, label: feature.name };
      effects.push({ ...effect, source });
    }
  }
  return effects;
}

function effectContribution(effect: Extract<Effect, { kind: "modifier" }>, target: TargetId): Contribution {
  return sourceContribution(target, effect.value, effect.source?.id ?? "effect", effect.source?.label ?? "Effect", effect.bonusType, { appliesTo: effect.appliesTo });
}

function base(target: TargetId, value: number, source: string, label: string): Contribution {
  return sourceContribution(target, value, source, label);
}

export class RulesEngine {
  readonly character: CharacterInput;
  private readonly effects: Effect[];

  constructor(character: CharacterInput) {
    this.character = character;
    this.effects = featureEffects(character);
  }

  private directModifiers(target: TargetId): Contribution[] {
    const matching: Contribution[] = [];
    for (const effect of this.effects) {
      if (effect.target !== target) continue;
      if (effect.kind === "modifier") matching.push(effectContribution(effect, target));
    }
    return matching;
  }

  /** A set replaces the intrinsic/base scalar for its target; dependencies and modifiers still apply. */
  private replacement(target: TargetId, fallback: number, source: string, label: string): Contribution {
    const set = [...this.effects].reverse().find((effect): effect is Extract<Effect, { kind: "set" }> => effect.kind === "set" && effect.target === target);
    return set ? base(target, set.value, set.source?.id ?? "effect", set.source?.label ?? "Set value") : base(target, fallback, source, label);
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
      this.replacement(target, this.character.baseSaves[id], `base-save.${id}`, `Base ${id}`),
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
    // Omitted applicability means a general AC effect. It is never inferred from bonusType.
    return contribution.appliesTo === undefined || contribution.appliesTo.includes(context);
  }

  private initiativeResult(): EvaluationResult {
    const target = "initiative" as TargetId;
    return this.result(target, [this.replacement(target, 0, "initiative.base", "Base initiative"), this.abilityContribution("dex", target), ...this.directModifiers(target), ...this.skillLikeInitiativeEffects(target)]);
  }

  private skillLikeInitiativeEffects(target: TargetId): Contribution[] {
    return this.effects.flatMap((effect) => {
      if (effect.kind !== "modifier" || !effect.source) return [];
      if (effect.target !== "skill.all" && effect.target !== "skill.initiative") return [];
      return [effectContribution({ ...effect, target }, target)];
    });
  }

  private combat(target: "cmb" | "cmd"): EvaluationResult {
    const contributions: Contribution[] = [
      this.replacement(target, target === "cmd" ? 10 : 0, `${target}.base`, target === "cmd" ? "Base CMD" : "Base CMB"),
      base(target, this.character.baseBab, "base-bab", "Base Attack Bonus"),
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
    return this.result("hp", [this.replacement("hp", this.character.baseHpBeforeConstitution, "base-hp-before-con", "HP before Constitution"), this.abilityContribution("con", "hp")]);
  }

  private attackFor(definition: AttackDefinition): DerivedAttack {
    const mode = definition.mode ?? (definition.attackTags?.includes("weapon.ranged") ? "ranged" : "melee");
    const target = `attack.${mode}` as TargetId;
    const attackContributions = [
      this.replacement(target, this.character.baseBab, "base-bab", "Base Attack Bonus"),
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
    return {
      input: this.character,
      grants: this.grants(),
      abilities,
      maxHp: this.hpResult(),
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

export function evaluateCharacter(character: CharacterInput): DerivedCharacter {
  return new RulesEngine(character).derive();
}

export function evaluate(target: TargetId, character: CharacterInput): EvaluationResult {
  return new RulesEngine(character).evaluate(target);
}

export type { CharacterInput, TargetId, Contribution, EvaluationResult, DerivedCharacter, DerivedAttack, DamageEvaluation } from "@threepointpf/rules-schema";
