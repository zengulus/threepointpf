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

function sourceContribution(target: TargetId, value: number, source: string, label: string, bonusType?: BonusType): Contribution {
  return { target, value, source, label, ...(bonusType ? { bonusType } : {}) };
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
  return sourceContribution(target, effect.value, effect.source?.id ?? "effect", effect.source?.label ?? "Effect", effect.bonusType);
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

  private directEffects(target: TargetId): Contribution[] {
    const matching: Contribution[] = [];
    const sets: Contribution[] = [];
    for (const effect of this.effects) {
      if (effect.target !== target) continue;
      if (effect.kind === "modifier") matching.push(effectContribution(effect, target));
      if (effect.kind === "set") sets.push(base(target, effect.value, effect.source?.id ?? "effect", effect.source?.label ?? "Set value"));
    }
    if (sets.length > 0) {
      // A set effect is an authored override; the most recently declared enabled set wins.
      return [...sets.slice(-1), ...matching];
    }
    return matching;
  }

  private result(target: TargetId, contributions: Contribution[]): EvaluationResult {
    const reduced = reduceContributions(contributions);
    return { target, value: sum(reduced), contributions: reduced };
  }

  abilityScore(id: AbilityId): EvaluationResult {
    const target = `ability.${id}` as TargetId;
    const contributions = this.directEffects(target);
    if (!contributions.some((item) => item.source === "base-ability")) {
      contributions.unshift(base(target, this.character.baseAbilities[id], "base-ability", `Base ${id.toUpperCase()}`));
    }
    const raw = this.result(target, contributions);
    if (raw.value >= 0) return raw;
    const floor = base(target, -raw.value, "rules-core.ability-floor", "Ability score minimum");
    return { ...raw, value: 0, contributions: [...raw.contributions, floor] };
  }

  abilityModifier(id: AbilityId): EvaluationResult {
    const score = this.abilityScore(id);
    const target = `ability.${id}` as TargetId;
    const modifier = abilityModifier(score.value);
    return {
      target,
      value: modifier,
      contributions: [base(target, modifier, `ability.${id}.modifier`, `${id.toUpperCase()} modifier`)],
    };
  }

  private abilityContribution(id: AbilityId, target: TargetId): Contribution {
    return base(target, this.abilityModifier(id).value, `ability.${id}.modifier`, `${id.toUpperCase()} modifier`);
  }

  private save(id: SaveId): EvaluationResult {
    const target = `save.${id}` as TargetId;
    const ability: AbilityId = id === "fortitude" ? "con" : id === "reflex" ? "dex" : "wis";
    const contributions = [
      base(target, this.character.baseSaves[id], `base-save.${id}`, `Base ${id}`),
      this.abilityContribution(ability, target),
      ...this.directEffects(target),
    ];
    return this.result(target, contributions);
  }

  private ac(kind: "normal" | "touch" | "flat-footed"): EvaluationResult {
    const target = "ac" as TargetId;
    const contributions: Contribution[] = [base(target, 10, "ac.base", "Base AC")];
    if (kind !== "flat-footed") contributions.push(this.abilityContribution("dex", target));
    const direct = [...this.directEffects("ac")];
    const natural = [...this.directEffects("ac.natural")];
    if (kind === "touch") {
      contributions.push(...direct.filter((item) => item.bonusType === "dodge" || item.bonusType === "deflection" || item.bonusType === "circumstance" || item.bonusType === "untyped"));
    } else if (kind === "flat-footed") {
      contributions.push(...direct.filter((item) => item.bonusType !== "dodge"));
      contributions.push(...natural);
    } else {
      contributions.push(...direct, ...natural);
    }
    return this.result(target, contributions);
  }

  private initiativeResult(): EvaluationResult {
    const target = "initiative" as TargetId;
    return this.result(target, [this.abilityContribution("dex", target), ...this.directEffects(target), ...this.skillLikeInitiativeEffects(target)]);
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
      base(target, target === "cmd" ? 10 : 0, `${target}.base`, target === "cmd" ? "Base CMD" : "Base CMB"),
      base(target, this.character.baseBab, "base-bab", "Base Attack Bonus"),
      this.abilityContribution("str", target),
      ...(target === "cmd" ? [this.abilityContribution("dex", target)] : []),
      ...this.directEffects(target),
    ];
    return this.result(target, contributions);
  }

  private skillResult(id: string): DerivedSkill {
    const config: SkillConfiguration = this.character.skills?.[id] ?? { governingAbility: defaultSkillAbilities[id] ?? "int" };
    const ranks = this.character.skillRanks[id] ?? 0;
    const target = `skill.${id}` as TargetId;
    const contributions = [
      base(target, ranks, `skill.${id}.ranks`, "Skill ranks"),
      this.abilityContribution(config.governingAbility, target),
      ...(config.classSkill && ranks > 0 ? [base(target, 3, `skill.${id}.class`, "Class skill")] : []),
      ...(config.miscellaneous ? [base(target, config.miscellaneous, `skill.${id}.misc`, "Miscellaneous skill bonus")] : []),
      ...(config.armorAndSize ? [base(target, config.armorAndSize, `skill.${id}.armor-size`, "Armor/size adjustment")] : []),
      ...this.directEffects("skill.all"),
      ...this.directEffects(target),
    ];
    const total = this.result(target, contributions);
    return { id: id as SkillId, label: skillLabel(id), total, ranks, governingAbility: config.governingAbility, classSkill: Boolean(config.classSkill) };
  }

  private movementResult(): EvaluationResult {
    const target = "speed.land" as TargetId;
    return this.result(target, [base(target, this.character.baseLandSpeed ?? 30, "base-speed.land", "Base land speed"), ...this.directEffects(target)]);
  }

  private hpResult(): EvaluationResult {
    return this.result("hp", [base("hp", this.character.baseHp, "base-hp", "Base hit points"), this.abilityContribution("con", "hp")]);
  }

  private attackFor(definition: AttackDefinition): DerivedAttack {
    const mode = definition.mode ?? (definition.attackTags?.includes("ranged") ? "ranged" : "melee");
    const target = `attack.${mode}` as TargetId;
    const attackContributions = [
      base(target, this.character.baseBab, "base-bab", "Base Attack Bonus"),
      this.abilityContribution(definition.attackAbility, target),
      ...(definition.weaponBonus ? [base(target, definition.weaponBonus, `weapon.${definition.id}`, "Weapon bonus")] : []),
      ...this.directEffects(target),
    ];
    const attack = this.result(target, attackContributions);
    const damageTarget = `damage.${mode}` as TargetId;
    const multiplier = definition.damageAbilityMultiplier ?? 1;
    const damageContributions = definition.damageAbility
      ? [base(damageTarget, Math.floor(this.abilityModifier(definition.damageAbility).value * multiplier), `ability.${definition.damageAbility}.damage`, `${definition.damageAbility.toUpperCase()} damage (${multiplier}×)`), ...this.directEffects(damageTarget)]
      : [...this.directEffects(damageTarget)];
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
    const direct = this.directEffects(target);
    return this.result(target, direct.length ? direct : [base(target, 0, `${target}.base`, labelForTarget(target))]);
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
      abilities,
      hp: this.hpResult(),
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
