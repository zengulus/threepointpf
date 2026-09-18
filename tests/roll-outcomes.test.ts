import { describe, expect, it } from "vitest";
import {
  RulesEngine,
  isFullAttackAction,
  pf1eOutcomePolicies,
  type RollOutcomePolicy,
} from "@threepointpf/rules-core";
import { featureCatalog, rulesCatalogs } from "@threepointpf/rules-data";
import {
  effectSchema,
  parseCharacterInput,
  type AttackDefinition,
  type CharacterInput,
  type Effect,
  type FeatureInstance,
} from "@threepointpf/rules-schema";
import {
  actionPlanRequestSchema,
  createCharacterActionPlan,
  createCharacterRollPlan,
  resolveRollRequestSchema,
  rollPlanRequestSchema,
} from "@threepointpf/shared";
import {
  evaluateRollOutcome,
  formatRollOutcome,
  resolveRollPlan,
  type RollPlan,
} from "@threepointpf/dice";

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "outcomes",
    name: "Outcome Test",
    baseAbilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 2,
    skillRanks: {},
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...overrides,
  };
}

const engine = (input: CharacterInput) => new RulesEngine(input, rulesCatalogs);

const melee = (
  id: string,
  overrides: Partial<AttackDefinition> = {},
): AttackDefinition => ({
  id,
  name: id,
  attackAbility: "str",
  damageAbility: "str",
  baseDamage: { count: 1, sides: 8 },
  attackTags: ["weapon.melee"],
  mode: "melee",
  ...overrides,
});

const ranged = (
  id: string,
  overrides: Partial<AttackDefinition> = {},
): AttackDefinition =>
  melee(id, {
    attackAbility: "dex",
    attackTags: ["weapon.ranged"],
    mode: "ranged",
    ...overrides,
  });

const toggle = (slug: string): FeatureInstance => ({
  id: slug,
  definitionId: `pf1e.paizo.${slug}`,
  name: featureCatalog[`pf1e.paizo.${slug}`]!.name,
  enabled: true,
  effects: [],
});

const ac = (value: number, context = "normal") => ({
  defense: { kind: "ac" as const, value, context: context as "normal" | "touch" | "flatFooted" },
});

// BAB 8 + STR 3 = +11 for every melee weapon in these fixtures.
const MELEE_MODIFIER = 11;

describe("attack critical range", () => {
  it("crits on a natural 20 by default and on 19–20 or 18–20 when authored", () => {
    const character = homebrew({
      attacks: [
        melee("plain"),
        melee("nineteen", { criticalRange: { minimumNaturalRoll: 19 } }),
        melee("eighteen", { criticalRange: { minimumNaturalRoll: 18 } }),
      ],
    });
    const rules = engine(character);
    const plan = (attackId: string) =>
      rules.createAttackRollPlan(attackId, 0, {
        action: "standardAttack",
        defense: { kind: "ac", value: 1 },
      });
    // A defense of 1 means every face below hits, so only the range differs.
    expect(plan("plain").criticalRange).toEqual({ minimumNaturalRoll: 20 });
    expect(resolveRollPlan(plan("plain"), [19]).outcome.critical).toBe(false);
    expect(resolveRollPlan(plan("plain"), [20]).outcome.critical).toBe(true);
    expect(resolveRollPlan(plan("nineteen"), [19]).outcome.critical).toBe(true);
    expect(resolveRollPlan(plan("nineteen"), [18]).outcome.critical).toBe(false);
    expect(resolveRollPlan(plan("eighteen"), [18]).outcome.kind).toBe(
      "criticalSuccess",
    );
    expect(resolveRollPlan(plan("eighteen"), [17]).outcome.critical).toBe(false);
  });

  it("reads the range from authored data instead of the weapon's name", () => {
    const character = homebrew({
      attacks: [
        melee("longsword"),
        melee("longsword-of-legend", {
          criticalRange: { minimumNaturalRoll: 15 },
        }),
      ],
    });
    const rules = engine(character);
    expect(rules.attackDefinitions[0]!.criticalRange).toBeUndefined();
    expect(
      resolveRollPlan(
        rules.createAttackRollPlan("longsword", 0, {
          action: "standardAttack",
          defense: { kind: "ac", value: 1 },
        }),
        [16],
      ).outcome.critical,
    ).toBe(false);
    expect(
      resolveRollPlan(
        rules.createAttackRollPlan("longsword-of-legend", 0, {
          action: "standardAttack",
          defense: { kind: "ac", value: 1 },
        }),
        [16],
      ).outcome.critical,
    ).toBe(true);
  });

  it("takes the weapon's own range over its profile's", () => {
    const character = homebrew({
      attacks: [
        // `pf1e.autosheet.standard-melee` authors no range, so the weapon's own
        // 19–20 range is the only one in play.
        melee("rapier", {
          profileId: "pf1e.autosheet.standard-melee",
          criticalRange: { minimumNaturalRoll: 19 },
        }),
      ],
    });
    expect(engine(character).attackDefinitions[0]!.criticalRange).toEqual({
      minimumNaturalRoll: 19,
    });
  });

  it("derives an effective range from contextual widening and reports the ones that did not apply", () => {
    const widen: Effect = {
      kind: "criticalRange",
      target: "attack.melee",
      widenBy: 1,
      appliesWhen: { touch: false },
      source: { id: "homebrew.improved-critical", label: "Improved Critical" },
    };
    const character = homebrew({
      attacks: [
        melee("longsword"),
        melee("ghost-touch", { attackTags: ["weapon.melee", "weapon.touch"] }),
        ranged("bow"),
      ],
      features: [
        {
          id: "improved-critical",
          name: "Improved Critical",
          enabled: true,
          effects: [widen],
        },
      ],
    });
    const rules = engine(character);
    const meleePlan = rules.createAttackRollPlan("longsword", 0, {
      action: "standardAttack",
    });
    expect(meleePlan.criticalRange).toEqual({ minimumNaturalRoll: 19 });
    const range = meleePlan.provenance?.criticalRange;
    expect(range?.base).toEqual({ minimumNaturalRoll: 20 });
    expect(range?.effective).toEqual({ minimumNaturalRoll: 19 });
    expect(
      range?.contributions.map((item) => [item.source, item.value]),
    ).toEqual([
      ["critical-range.base", 0],
      ["homebrew.improved-critical", -1],
    ]);
    // A touch attack is outside the widening's context, and the exclusion is
    // machine-readable rather than prose.
    const touchPlan = rules.createAttackRollPlan("ghost-touch", 0, {
      action: "standardAttack",
    });
    expect(touchPlan.criticalRange).toEqual({ minimumNaturalRoll: 20 });
    const exclusion = touchPlan.provenance?.criticalRange?.excluded[0];
    expect(exclusion).toMatchObject({
      target: "attack.melee",
      source: "homebrew.improved-critical",
      value: -1,
      reason: "does not apply to touch attacks",
    });
    expect(resolveRollPlan(touchPlan, [19]).outcome.inCriticalRange).toBe(false);
    // An effect authored against melee attacks is not part of a ranged attack's
    // provenance at all.
    expect(
      rules.createAttackRollPlan("bow", 0, { action: "standardAttack" })
        .provenance?.criticalRange?.excluded,
    ).toEqual([]);
  });

  it("never narrows below 2 or widens past 20", () => {
    const character = homebrew({
      attacks: [
        melee("over-widened", {
          criticalRange: { minimumNaturalRoll: 2 },
          iterative: false,
        }),
      ],
      features: [
        {
          id: "wideners",
          name: "Many wideners",
          enabled: true,
          effects: [
            {
              kind: "criticalRange",
              target: "attack.melee",
              widenBy: 18,
              source: { id: "homebrew.wide-a", label: "Wide A" },
            },
            {
              kind: "criticalRange",
              target: "attack.melee",
              widenBy: 18,
              source: { id: "homebrew.wide-b", label: "Wide B" },
            },
          ],
        },
      ],
    });
    const plan = engine(character).createAttackRollPlan("over-widened", 0, {
      action: "standardAttack",
    });
    expect(plan.criticalRange).toEqual({ minimumNaturalRoll: 2 });
  });

  it("keeps a widened range a threat, not an automatic hit", () => {
    const character = homebrew({
      attacks: [
        melee("keen-sword", { criticalRange: { minimumNaturalRoll: 15 } }),
      ],
    });
    const plan = engine(character).createAttackRollPlan("keen-sword", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: MELEE_MODIFIER + 16 },
    });
    const resolved = resolveRollPlan(plan, [15]);
    expect(resolved.outcome.inCriticalRange).toBe(true);
    expect(resolved.outcome.hit).toBe(false);
    expect(resolved.outcome.critical).toBe(false);
    expect(resolved.outcome.kind).toBe("failure");
  });
});

describe("natural-face semantics for attacks", () => {
  const rules = engine(homebrew({ attacks: [melee("sword")] }));
  const plan = (defense?: number) =>
    rules.createAttackRollPlan("sword", 0, {
      action: "standardAttack",
      ...(defense !== undefined ? { defense: { kind: "ac" as const, value: defense } } : {}),
    });

  it("makes a natural 20 hit and crit regardless of the total", () => {
    const resolved = resolveRollPlan(plan(60), [20]);
    expect(resolved.total).toBe(31);
    expect(resolved.outcome.automaticHit).toBe(true);
    expect(resolved.outcome.hit).toBe(true);
    expect(resolved.outcome.critical).toBe(true);
    expect(resolved.outcome.kind).toBe("criticalSuccess");
  });

  it("makes a natural 1 miss and classifies it as a critical failure", () => {
    const resolved = resolveRollPlan(plan(1), [1]);
    expect(resolved.total).toBe(12);
    expect(resolved.outcome.natural1).toBe(true);
    expect(resolved.outcome.automaticMiss).toBe(true);
    expect(resolved.outcome.hit).toBe(false);
    expect(resolved.outcome.critical).toBe(false);
    expect(resolved.outcome.kind).toBe("criticalFailure");
  });

  it("keeps automatic-hit range and critical range distinct", () => {
    // A weapon that threatens only on a natural 20 still hits on 19 normally.
    const resolved = resolveRollPlan(plan(MELEE_MODIFIER + 19), [19]);
    expect(resolved.outcome.hit).toBe(true);
    expect(resolved.outcome.automaticHit).toBe(false);
    expect(resolved.outcome.inCriticalRange).toBe(false);
    expect(resolved.outcome.kind).toBe("success");
  });

  it("does not turn an in-range face into an automatic hit", () => {
    const character = homebrew({
      attacks: [melee("rapier", { criticalRange: { minimumNaturalRoll: 18 } })],
    });
    const rapier = engine(character).createAttackRollPlan("rapier", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: 60 },
    });
    const resolved = resolveRollPlan(rapier, [19]);
    expect(resolved.outcome.inCriticalRange).toBe(true);
    expect(resolved.outcome.automaticHit).toBe(false);
    expect(resolved.outcome.hit).toBe(false);
    expect(resolved.outcome.kind).toBe("failure");
  });

  it("leaves hit and critical unresolved when no defense is known", () => {
    const threatening = engine(
      homebrew({
        attacks: [melee("big-threat", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
    ).createAttackRollPlan("big-threat", 0, { action: "standardAttack" });
    const resolved = resolveRollPlan(threatening, [19]);
    expect(resolved.outcome.inCriticalRange).toBe(true);
    expect(resolved.outcome.hit).toBeUndefined();
    expect(resolved.outcome.critical).toBeUndefined();
    expect(resolved.outcome.kind).toBe("unresolved");
    expect(resolved.outcome.defense).toBeUndefined();
    // The natural face is still visible.
    expect(resolved.naturalFace).toBe(19);
  });

  it("reports the natural face separately from the semantic outcome", () => {
    const hit = resolveRollPlan(plan(1), [20]);
    expect(hit.naturalFace).toBe(20);
    expect(hit.outcome.natural20).toBe(true);
    expect(hit.outcome.natural1).toBe(false);
    const miss = resolveRollPlan(plan(60), [1]);
    expect(miss.naturalFace).toBe(1);
    expect(miss.outcome.natural20).toBe(false);
    expect(miss.outcome.natural1).toBe(true);
  });
});

describe("save outcomes", () => {
  const rules = engine(homebrew({}));
  const dc = (value: number) => ({
    defense: { kind: "dc" as const, value },
  });

  it("always succeeds on a natural 20 and always fails on a natural 1", () => {
    const plan = rules.createSaveRollPlan("fortitude", dc(40));
    expect(plan.context.kind).toBe("save");
    expect(plan.context.saveId).toBe("fortitude");
    expect(plan.context.action.kind).toBe("save");
    expect(plan.primaryCheckDie).toEqual({ group: 0, sides: 20 });
    // PF1e: the face decides regardless of the DC, and the face fact stays
    // visible next to the automatic rule that produced the outcome.
    const natural20 = resolveRollPlan(plan, [20]);
    expect(natural20.naturalFace).toBe(20);
    expect(natural20.outcome).toMatchObject({
      natural20: true,
      natural1: false,
      automaticSuccess: true,
      automaticFailure: false,
      success: true,
      kind: "success",
    });
    const natural1 = resolveRollPlan(rules.createSaveRollPlan("will", dc(1)), [1]);
    expect(natural1.outcome).toMatchObject({
      natural1: true,
      automaticFailure: true,
      automaticSuccess: false,
      success: false,
      kind: "failure",
    });
    expect(plan.criticalRange).toBeUndefined();
  });

  it("compares an ordinary face with the DC using the save's own modifier", () => {
    const plan = rules.createSaveRollPlan("reflex", dc(20));
    const face = 12;
    const beats = face + plan.modifier >= 20;
    const resolved = resolveRollPlan(plan, [face]);
    expect(resolved.outcome.natural20).toBe(false);
    expect(resolved.outcome.automaticSuccess).toBe(false);
    expect(resolved.outcome.success).toBe(beats);
    expect(resolved.outcome.kind).toBe(beats ? "success" : "failure");
  });

  it("adds no verdict when no DC is known, but keeps the automatic rule", () => {
    const unknown = resolveRollPlan(rules.createSaveRollPlan("reflex"), [12]);
    expect(unknown.outcome.natural20).toBe(false);
    expect(unknown.outcome.natural1).toBe(false);
    expect(unknown.outcome.success).toBeUndefined();
    expect(unknown.outcome.kind).toBe("unresolved");
    expect(unknown.outcome.defense).toBeUndefined();
    // A natural 20 needs no DC: PF1e makes it succeed outright.
    const natural20 = resolveRollPlan(rules.createSaveRollPlan("reflex"), [20]);
    expect(natural20.outcome).toMatchObject({
      natural20: true,
      automaticSuccess: true,
      success: true,
      kind: "success",
    });
  });

  it("does not give skill checks the save's automatic faces", () => {
    const plan = rules.createSkillRollPlan("perception", {
      defense: { kind: "dc", value: 40 },
    });
    const resolved = resolveRollPlan(plan, [20]);
    expect(resolved.outcome.natural20).toBe(true);
    expect(resolved.outcome.automaticSuccess).toBe(false);
    expect(resolved.outcome.success).toBe(false);
    expect(resolved.outcome.kind).toBe("failure");
  });

  it("honors a campaign policy that assigns a critical classification to save naturals", () => {
    const automatic: RollOutcomePolicy = {
      ...pf1eOutcomePolicies.save,
      id: "campaign.save",
      natural20: { automatic: true, classification: "criticalSuccess" },
    };
    const campaign = new RulesEngine(homebrew({}), {
      ...rulesCatalogs,
      outcomePolicies: { save: automatic },
    });
    const resolved = resolveRollPlan(campaign.createSaveRollPlan("fortitude", dc(40)), [20]);
    expect(resolved.outcome.automaticSuccess).toBe(true);
    expect(resolved.outcome.success).toBe(true);
    expect(resolved.outcome.kind).toBe("criticalSuccess");
    expect(campaign.outcomePolicies.attack).toEqual(pf1eOutcomePolicies.attack);
    // The default policy still reports a plain success, not a critical one.
    expect(
      resolveRollPlan(rules.createSaveRollPlan("fortitude", dc(40)), [20]).outcome.kind,
    ).toBe("success");
  });
});

describe("maneuver outcomes", () => {
  it("uses an automatic-success check without a critical range", () => {
    const rules = engine(homebrew({}));
    const plan = rules.createManeuverRollPlan("trip", {
      defense: { kind: "cmd", value: 30 },
    });
    expect(plan.context.kind).toBe("maneuver");
    expect(plan.context.maneuver).toBe("trip");
    expect(plan.context.action.kind).toBe("maneuver");
    expect(plan.criticalRange).toBeUndefined();
    const natural20 = resolveRollPlan(plan, [20]);
    expect(natural20.outcome.automaticSuccess).toBe(true);
    expect(natural20.outcome.kind).toBe("success");
    const natural1 = resolveRollPlan(plan, [1]);
    expect(natural1.outcome.automaticFailure).toBe(true);
    expect(natural1.outcome.kind).toBe("failure");
    const ordinary = resolveRollPlan(plan, [10]);
    expect(ordinary.outcome.success).toBe(false);
    expect(ordinary.outcome.kind).toBe("failure");
  });
});

describe("skill outcomes and the context contract", () => {
  it("carries the skill identity and the check action", () => {
    const rules = engine(homebrew({ skillRanks: { perception: 4 } }));
    const plan = rules.createSkillRollPlan("perception", {
      flags: ["sight-based"],
      defense: { kind: "dc", value: 15 },
    });
    expect(plan.context).toMatchObject({
      kind: "skill",
      actorCharacterId: "outcomes",
      skillId: "perception",
      action: { kind: "skillCheck" },
      flags: ["sight-based"],
      target: { defense: { kind: "dc", value: 15 } },
    });
    expect(resolveRollPlan(plan, [11]).outcome.kind).toBe("success");
    expect(resolveRollPlan(plan, [10]).outcome.kind).toBe("failure");
  });

  it("describes an action's rolls explicitly, with one shared extra attack", () => {
    const character = homebrew({
      attacks: [
        melee("primary"),
        melee("off-hand", { attackTags: ["weapon.melee", "weapon.off-hand"] }),
      ],
      features: [toggle("haste")],
    });
    const plan = engine(character).createActionPlan({
      action: "fullAttack",
      attackIds: ["primary", "off-hand"],
    });
    // The flattened roll list is exactly the steps' own rolls: every step's
    // attack roll followed by the damage roll it deals.
    expect(
      plan.attacks
        .flatMap((attack) => attack.steps)
        .every((step) => step.damage !== undefined),
    ).toBe(true);
    expect(plan.rolls).toEqual(
      plan.attacks.flatMap((attack) =>
        attack.steps.flatMap((step) => [step.roll, step.damage!]),
      ),
    );
    expect(new Set(plan.rolls.map((roll) => roll.id)).size).toBe(plan.rolls.length);
    expect(plan.rolls.map((roll) => roll.context.action.kind)).toEqual(
      plan.rolls.map(() => "fullAttack"),
    );
    expect(plan.rolls.map((roll) => roll.context.action.sequenceId)).toEqual(
      plan.rolls.map(() => plan.id),
    );
    expect(
      plan.attacks.flatMap((attack) =>
        attack.steps.filter((step) => step.role === "extra"),
      ),
    ).toHaveLength(1);
    for (const roll of plan.rolls) {
      expect(roll.context.action.attackIds).toEqual(["primary", "off-hand"]);
      expect(isFullAttackAction(roll.context)).toBe(true);
      expect(roll.provenance?.modifier.length).toBeGreaterThan(0);
    }
    const standard = engine(character).createActionPlan({
      action: "standardAttack",
      attackIds: ["primary"],
    });
    expect(standard.rolls.map((roll) => roll.context.kind)).toEqual([
      "attack",
      "damage",
    ]);
    expect(isFullAttackAction(standard.rolls[0]!.context)).toBe(false);
    expect(standard.rolls[0]!.context.action.kind).toBe("standardAttack");
    expect(standard.rolls[1]!.context.criticalDamage).toBeUndefined();
  });

  it("keeps each attack's sequence index on its own rolls", () => {
    const character = homebrew({ attacks: [melee("sword"), melee("second")] });
    const plan = engine(character).createActionPlan({
      action: "fullAttack",
      attackIds: ["sword", "second"],
    });
    for (const attack of plan.attacks)
      expect(attack.steps.map((step) => step.roll.context.action.sequenceIndex)).toEqual(
        attack.steps.map((step) => step.index),
      );
  });
});

describe("no critical confirmation", () => {
  it("ships a policy that requires none and rejects a second die", () => {
    expect(pf1eOutcomePolicies.attack.criticalConfirmationRequired).toBe(false);
    const rules = engine(
      homebrew({
        attacks: [melee("sword", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
    );
    const plan = rules.createAttackRollPlan("sword", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: 1 },
    });
    expect(plan.dice).toEqual([{ sides: 20, count: 1 }]);
    // A confirmation roll cannot even be submitted: the plan takes one face.
    expect(() => resolveRollPlan(plan, [19, 20])).toThrow(/requires 1 face/);
    expect(resolveRollPlan(plan, [19]).outcome.critical).toBe(true);
    expect(resolveRollPlan(plan, [19]).outcome).not.toHaveProperty("confirmation");
  });

  it("leaves a threat unconfirmed when a policy does require confirmation", () => {
    const confirming: RollOutcomePolicy = {
      ...pf1eOutcomePolicies.attack,
      id: "campaign.confirming",
      criticalConfirmationRequired: true,
    };
    const rules = new RulesEngine(
      homebrew({
        attacks: [melee("sword", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
      { ...rulesCatalogs, outcomePolicies: { attack: confirming } },
    );
    const plan = rules.createAttackRollPlan("sword", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: 1 },
    });
    const resolved = resolveRollPlan(plan, [19]);
    expect(resolved.outcome.inCriticalRange).toBe(true);
    expect(resolved.outcome.critical).toBeUndefined();
    expect(resolved.outcome.hit).toBe(true);
    expect(resolved.outcome.kind).toBe("success");
  });

  it("never emits a plan with more than the dice it declares", () => {
    const plan = engine(homebrew({ attacks: [melee("sword")] })).createAttackRollPlan(
      "sword",
      0,
      { action: "standardAttack" },
    );
    expect(plan.dice.reduce((total, group) => total + group.count, 0)).toBe(1);
    expect(() => resolveRollPlan(plan, [])).toThrow();
    expect(() => resolveRollPlan(plan, [21])).toThrow();
    expect(() => resolveRollPlan(plan, [19.5])).toThrow();
  });
});

describe("deterministic and defensive resolution", () => {
  it("produces identical results for identical plan and faces", () => {
    const rules = engine(
      homebrew({
        attacks: [melee("rapier", { criticalRange: { minimumNaturalRoll: 18 } })],
        features: [toggle("power-attack"), toggle("haste")],
      }),
    );
    const plan = rules.createAttackRollPlan("rapier", 1, {
      defense: { kind: "ac", value: 18 },
    });
    const snapshot = JSON.stringify(plan);
    const first = resolveRollPlan(plan, [19]);
    const second = resolveRollPlan(plan, [19]);
    expect(first).toEqual(second);
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(first.outcome).toMatchObject({
      kind: "criticalSuccess",
      natural20: false,
      inCriticalRange: true,
      automaticHit: false,
      hit: true,
      critical: true,
    });
    expect(evaluateRollOutcome(plan, 19, first.total)).toEqual(first.outcome);
  });

  it("agrees between the engine, the shared boundary and a rebuilt plan", () => {
    const character = homebrew({
      attacks: [melee("rapier", { criticalRange: { minimumNaturalRoll: 18 } })],
      features: [toggle("power-attack"), toggle("combat-expertise")],
    });
    const request = {
      characterId: character.id,
      kind: "attack" as const,
      attackId: "rapier",
      attackIndex: 1,
      action: "fullAttack" as const,
      defense: { kind: "ac" as const, value: 17, context: "normal" as const },
    };
    const local = engine(character).createAttackRollPlan("rapier", 1, {
      defense: request.defense,
    });
    const shared = createCharacterRollPlan(character, request, rulesCatalogs);
    expect(shared).toEqual(local);
    // Rebuilding from the plan's own context yields the same plan again.
    const rebuilt = createCharacterRollPlan(
      parseCharacterInput(character),
      {
        characterId: character.id,
        kind: "attack",
        attackId: shared.context.attackId!,
        attackIndex: shared.context.action.sequenceIndex ?? 0,
        action: "fullAttack",
        defense: shared.context.target!.defense!,
      },
      rulesCatalogs,
    );
    expect(rebuilt).toEqual(shared);
    expect(resolveRollPlan(rebuilt, [19])).toEqual(resolveRollPlan(shared, [19]));
  });

  it("formats a display label without changing the semantics", () => {
    const rules = engine(homebrew({ attacks: [melee("sword")] }));
    const threat = resolveRollPlan(
      rules.createAttackRollPlan("sword", 0, {
        action: "standardAttack",
        defense: { kind: "ac", value: 1 },
      }),
      [20],
    ).outcome;
    expect(formatRollOutcome(threat)).toBe(
      "natural 20 · automatic · criticalSuccess · threat 20–20 (in range)",
    );
  });
});

describe("rejected and contradictory contexts", () => {
  it("refuses a defense that cannot apply to the roll", () => {
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "attack",
        attackId: "sword",
        defense: { kind: "dc", value: 15 },
      }),
    ).toThrow(/ac/);
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "save",
        saveId: "fortitude",
        defense: { kind: "ac", value: 15 },
      }),
    ).toThrow(/dc/);
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "maneuver",
        defense: { kind: "ac", value: 15 },
      }),
    ).toThrow(/cmd/);
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "skill",
        skillId: "climb",
        defense: { kind: "cmd", value: 15 },
      }),
    ).toThrow(/dc/);
  });

  it("refuses an Armor Class that contradicts the attack being made", () => {
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "attack",
        attackId: "ray",
        touch: true,
        defense: { kind: "ac", value: 15, context: "normal" },
      }),
    ).toThrow(/touch AC/);
    expect(
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "attack",
        attackId: "ray",
        touch: true,
        defense: { kind: "ac", value: 15, context: "touch" },
      }).defense,
    ).toEqual({ kind: "ac", value: 15, context: "touch" });
  });

  it("refuses contradictory action requests", () => {
    expect(() =>
      actionPlanRequestSchema.parse({
        characterId: "x",
        action: "standardAttack",
        attackIds: ["a", "b"],
      }),
    ).toThrow(/exactly one attack/);
    expect(() =>
      rollPlanRequestSchema.parse({
        characterId: "x",
        kind: "attack",
        attackId: "a",
        action: "standardAttack",
        attackIds: ["a", "b"],
      }),
    ).toThrow(/exactly one attack/);
    expect(() =>
      actionPlanRequestSchema.parse({
        characterId: "x",
        action: "maneuver",
        attackIds: ["a"],
      }),
    ).toThrow(/no weapons/);
    expect(() =>
      actionPlanRequestSchema.parse({
        characterId: "x",
        action: "fullAttack",
        maneuver: "trip",
      }),
    ).toThrow(/only valid for a maneuver action/);
    expect(() =>
      actionPlanRequestSchema.parse({ characterId: "x", action: "spellcasting" }),
    ).toThrow();
  });

  it("refuses structurally invalid plans at the resolve boundary", () => {
    const plan = engine(homebrew({ attacks: [melee("sword")] })).createAttackRollPlan(
      "sword",
      0,
      { action: "standardAttack" },
    );
    expect(resolveRollRequestSchema.parse({ plan, faces: [10] }).faces).toEqual([10]);
    const { context: _context, ...withoutContext } = plan as RollPlan;
    expect(() =>
      resolveRollRequestSchema.parse({ plan: withoutContext, faces: [10] }),
    ).toThrow();
    expect(() =>
      resolveRollRequestSchema.parse({
        plan: { ...plan, context: { ...plan.context, actorCharacterId: "" } },
        faces: [10],
      }),
    ).toThrow();
    expect(() =>
      resolveRollRequestSchema.parse({ plan: { ...plan, dice: [] }, faces: [10] }),
    ).toThrow();
    expect(() =>
      resolveRollRequestSchema.parse({ plan, faces: [] }),
    ).toThrow();
  });

  it("refuses engine requests the action cannot satisfy", () => {
    const rules = engine(homebrew({ attacks: [melee("sword"), melee("dagger")] }));
    expect(() =>
      rules.createActionPlan({ action: "standardAttack", attackIds: ["sword", "dagger"] }),
    ).toThrow(/exactly one attack/);
    expect(() =>
      rules.createActionPlan({ action: "fullAttack", attackIds: ["sword", "sword"] }),
    ).toThrow(/once per action/);
    expect(() =>
      rules.createActionPlan({ action: "fullAttack", attackIds: ["missing"] }),
    ).toThrow(/Unknown attack/);
    expect(() =>
      rules.createAttackRollPlan("sword", 1, { action: "standardAttack" }),
    ).toThrow(/single sequence member/);
    expect(() => rules.createActionPlan({ action: "fullAttack", attackIds: [] })).toThrow(
      /requires an attack/,
    );
  });

  it("is callable through the shared action-plan boundary with a defense", () => {
    const character = homebrew({ attacks: [melee("sword")] });
    const plan = createCharacterActionPlan(
      character,
      {
        characterId: character.id,
        action: "fullAttack",
        attackIds: ["sword"],
        defense: { kind: "ac", value: 20 },
      },
      rulesCatalogs,
    );
    const attacks = plan.rolls.filter((roll) => roll.context.kind === "attack");
    expect(attacks.map((roll) => roll.context.target?.defense)).toEqual(
      attacks.map(() => ({ kind: "ac", value: 20 })),
    );
    // A damage roll is compared against nothing, so it carries no defense at
    // all rather than a defense it never used.
    const damage = plan.rolls.filter((roll) => roll.context.kind === "damage");
    expect(damage.length).toBeGreaterThan(0);
    expect(damage.every((roll) => roll.context.target === undefined)).toBe(true);
  });

  it("carries a caller-entered DC through the shared request path", () => {
    const character = homebrew({});
    const save = createCharacterRollPlan(
      character,
      {
        characterId: character.id,
        kind: "save",
        saveId: "will",
        defense: { kind: "dc", value: 18 },
      },
      rulesCatalogs,
    );
    expect(save.context.target?.defense).toEqual({ kind: "dc", value: 18 });
    // A supplied DC decides an ordinary face; a natural 20 still wins outright.
    const middle = 10;
    expect(resolveRollPlan(save, [middle]).outcome.success).toBe(
      middle + save.modifier >= 18,
    );
    expect(resolveRollPlan(save, [20]).outcome.automaticSuccess).toBe(true);
    const skill = createCharacterRollPlan(
      character,
      {
        characterId: character.id,
        kind: "skill",
        skillId: "perception",
        defense: { kind: "dc", value: 15 },
      },
      rulesCatalogs,
    );
    expect(skill.context.target?.defense).toEqual({ kind: "dc", value: 15 });
    expect(resolveRollPlan(skill, [middle]).outcome.success).toBe(
      middle + skill.modifier >= 15,
    );
    // A skill has no automatic faces, so a natural 20 can still fail a DC.
    expect(
      resolveRollPlan(skill, [20]).outcome.success,
    ).toBe(20 + skill.modifier >= 15);
    // The same request without a DC leaves the verdict out entirely.
    const unknown = createCharacterRollPlan(
      character,
      { characterId: character.id, kind: "skill", skillId: "perception" },
      rulesCatalogs,
    );
    expect(unknown.context.target).toBeUndefined();
    expect(resolveRollPlan(unknown, [middle]).outcome.success).toBeUndefined();
  });

  it("keeps touch and non-touch attack contexts apart at the plan level", () => {
    const character = homebrew({
      attacks: [ranged("bow"), ranged("ray", { attackTags: ["weapon.ranged", "weapon.touch"] })],
      features: [toggle("deadly-aim")],
    });
    const rules = engine(character);
    const bow = rules.createAttackRollPlan("bow", 0, { action: "standardAttack" });
    const ray = rules.createAttackRollPlan("ray", 0, { action: "standardAttack" });
    expect(bow.context.touch).toBe(false);
    expect(ray.context.touch).toBe(true);
    expect(bow.context.mode).toBe("ranged");
    // The exclusion is structured data: target, source and reason.
    const exclusion = ray.provenance?.excluded.find((item) =>
      item.source.includes("deadly-aim"),
    );
    expect(exclusion).toMatchObject({
      target: "attack.ranged",
      reason: "does not apply to touch attacks",
    });
    expect(exclusion?.label).toContain("Deadly Aim");
  });
});

describe("primary check dice", () => {
  it("declares the check die on every check and no die on damage", () => {
    const character = homebrew({
      attacks: [melee("sword", { baseDamage: { count: 1, sides: 20 } })],
    });
    const rules = engine(character);
    const checkDie = { group: 0, sides: 20 };
    expect(
      rules.createAttackRollPlan("sword", 0, { action: "standardAttack" })
        .primaryCheckDie,
    ).toEqual(checkDie);
    expect(rules.createManeuverRollPlan("trip").primaryCheckDie).toEqual(
      checkDie,
    );
    expect(rules.createSaveRollPlan("will").primaryCheckDie).toEqual(checkDie);
    expect(rules.createInitiativeRollPlan().primaryCheckDie).toEqual(checkDie);
    expect(rules.createSkillRollPlan("perception").primaryCheckDie).toEqual(
      checkDie,
    );
    // Damage is not a check, so it declares no check die at all.
    expect(
      rules.createDamageRollPlan("sword", { action: "standardAttack" })
        .primaryCheckDie,
    ).toBeUndefined();
  });

  it("never reads a natural face out of a damage die, even a d20", () => {
    const character = homebrew({
      attacks: [melee("d20-damage", { baseDamage: { count: 1, sides: 20 } })],
    });
    const rules = engine(character);
    const damage = rules.createDamageRollPlan("d20-damage", {
      action: "standardAttack",
    });
    expect(damage.dice).toEqual([{ sides: 20, count: 1 }]);
    const resolved = resolveRollPlan(damage, [20]);
    expect(resolved.naturalFace).toBeUndefined();
    expect(resolved.outcome).not.toHaveProperty("natural20");
    expect(resolved.outcome).not.toHaveProperty("natural1");
    expect(resolved.outcome).not.toHaveProperty("inCriticalRange");
    expect(resolved.outcome.kind).toBe("unresolved");
    // The same dice rolled as an attack do carry natural-face semantics.
    const attack = rules.createAttackRollPlan("d20-damage", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: 1 },
    });
    expect(resolveRollPlan(attack, [20]).outcome.natural20).toBe(true);
  });

  it("does not repeat a natural-face classification in a display label", () => {
    const resolved = resolveRollPlan(
      engine(homebrew({})).createSkillRollPlan("perception"),
      [1],
    );
    expect(resolved.outcome.kind).toBe("natural1");
    expect(formatRollOutcome(resolved.outcome)).toBe("natural 1");
  });

  it("rejects a declared check die the plan's dice do not have", () => {
    const plan = engine(homebrew({ attacks: [melee("sword")] })).createAttackRollPlan(
      "sword",
      0,
      { action: "standardAttack" },
    );
    expect(() =>
      resolveRollPlan({ ...plan, primaryCheckDie: { group: 4, sides: 20 } }, [10]),
    ).toThrow(/unknown check-die group/);
    expect(() =>
      resolveRollPlan(
        { ...plan, primaryCheckDie: { group: 0, index: 3, sides: 20 } },
        [10],
      ),
    ).toThrow(/out-of-range check die/);
  });

  // The declared die must describe the dice the plan actually rolls: claiming a
  // d20 over a 2d6 group would invent natural-face semantics out of nothing.
  it("rejects a declared check die whose sides do not match its group", () => {
    const plan = engine(homebrew({ attacks: [melee("sword")] })).createAttackRollPlan(
      "sword",
      0,
      { action: "standardAttack" },
    );
    expect(() =>
      resolveRollPlan({ ...plan, primaryCheckDie: { group: 0, sides: 6 } }, [10]),
    ).toThrow(/declares a d6 check die for a d20 group/);
    const damage = engine(
      homebrew({ attacks: [melee("sword")] }),
    ).createDamageRollPlan("sword");
    expect(() =>
      resolveRollPlan({ ...damage, primaryCheckDie: { group: 0, sides: 20 } }, [4]),
    ).toThrow(/declares a d20 check die for a d\d+ group/);
  });

  it("rejects a submitted plan whose check die contradicts its dice", () => {
    const plan = engine(homebrew({ attacks: [melee("sword")] })).createAttackRollPlan(
      "sword",
      0,
      { action: "standardAttack" },
    );
    expect(() =>
      resolveRollRequestSchema.parse({
        plan: { ...plan, primaryCheckDie: { group: 0, sides: 6 } },
        faces: [10],
      }),
    ).toThrow(/declares d6 but its group rolls d20/);
    expect(() =>
      resolveRollRequestSchema.parse({
        plan: { ...plan, primaryCheckDie: { group: 3, sides: 20 } },
        faces: [10],
      }),
    ).toThrow(/must reference one of the plan's dice groups/);
    expect(() =>
      resolveRollRequestSchema.parse({
        plan: { ...plan, primaryCheckDie: { group: 0, index: 2, sides: 20 } },
        faces: [10],
      }),
    ).toThrow(/inside its group/);
    // A self-consistent declaration still travels.
    expect(
      resolveRollRequestSchema.parse({ plan, faces: [10] }).plan.id,
    ).toBe(plan.id);
  });
});

describe("threat-range expansion (Improved Critical and Keen)", () => {
  const expansion = (
    overrides: Partial<Extract<Effect, { kind: "criticalRange" }>> = {},
  ): Effect => ({
    kind: "criticalRange",
    target: "attack.melee",
    operation: "double",
    appliesWhen: { modes: ["melee"] },
    source: { id: "homebrew.improved-critical", label: "Improved Critical" },
    ...overrides,
  });

  it("doubles a weapon's own range instead of adding a flat number of faces", () => {
    const character = homebrew({
      attacks: [
        melee("longsword", { criticalRange: { minimumNaturalRoll: 19 }, iterative: false }),
        melee("plain-sword", { iterative: false }),
        melee("high-threat", { criticalRange: { minimumNaturalRoll: 18 }, iterative: false }),
      ],
      features: [
        { id: "improved-critical", name: "Improved Critical", enabled: true, effects: [expansion()] },
      ],
    });
    const rules = engine(character);
    const range = (attackId: string) =>
      rules.createAttackRollPlan(attackId, 0, { action: "standardAttack" });
    // 19–20 → 17–20, 20 → 19–20, 18–20 → 15–20.
    expect(range("longsword").criticalRange).toEqual({ minimumNaturalRoll: 17 });
    expect(range("plain-sword").criticalRange).toEqual({ minimumNaturalRoll: 19 });
    expect(range("high-threat").criticalRange).toEqual({ minimumNaturalRoll: 15 });
    const evidence = range("longsword").provenance?.criticalRange;
    expect(evidence?.operation).toBe("double");
    expect(evidence?.base).toEqual({ minimumNaturalRoll: 19 });
    expect(evidence?.effective).toEqual({ minimumNaturalRoll: 17 });
    expect(
      evidence?.contributions.map((item) => [item.source, item.value]),
    ).toEqual([
      ["critical-range.base", 0],
      ["homebrew.improved-critical", -2],
    ]);
    expect(evidence?.contributions[1]?.note).toContain("Doubles 19–20 to 17–20");
  });

  it("applies only to the weapons it names", () => {
    const character = homebrew({
      attacks: [melee("scimitar"), melee("club")],
      features: [
        {
          id: "improved-critical-scimitar",
          name: "Improved Critical (scimitar)",
          enabled: true,
          effects: [
            expansion({
              appliesWhen: { modes: ["melee"], attackIds: ["scimitar"] },
              source: {
                id: "homebrew.improved-critical-scimitar",
                label: "Improved Critical (scimitar)",
              },
            }),
          ],
        },
      ],
    });
    const rules = engine(character);
    expect(
      rules.createAttackRollPlan("scimitar", 0, { action: "standardAttack" })
        .criticalRange,
    ).toEqual({ minimumNaturalRoll: 19 });
    const club = rules.createAttackRollPlan("club", 0, {
      action: "standardAttack",
    });
    expect(club.criticalRange).toEqual({ minimumNaturalRoll: 20 });
    expect(club.provenance?.criticalRange?.excluded[0]).toMatchObject({
      source: "homebrew.improved-critical-scimitar",
      reason: "requires weapon scimitar",
    });
  });

  it("does not stack: the most expansive expansion applies and the rest say why", () => {
    const keen: Effect = expansion({
      source: { id: "homebrew.keen-weapon", label: "Keen" },
    });
    const character = homebrew({
      attacks: [
        melee("keen-longsword", { criticalRange: { minimumNaturalRoll: 19 }, iterative: false }),
        melee("short-sword", { criticalRange: { minimumNaturalRoll: 19 }, iterative: false }),
      ],
      features: [
        { id: "improved-critical", name: "Improved Critical", enabled: true, effects: [expansion()] },
        { id: "keen", name: "Keen weapon", enabled: true, effects: [keen] },
      ],
    });
    const rules = engine(character);
    const plan = rules.createAttackRollPlan("keen-longsword", 0, {
      action: "standardAttack",
    });
    // One doubling, not two: 19–20 stays 17–20 rather than becoming 15–20.
    expect(plan.criticalRange).toEqual({ minimumNaturalRoll: 17 });
    expect(plan.provenance?.criticalRange?.excluded).toEqual([
      expect.objectContaining({
        source: "homebrew.keen-weapon",
        value: -2,
        reason: "threat-range expansions do not stack with Improved Critical",
      }),
    ]);
    // Keen alone is enough to double the weapon's range.
    const keenOnly = engine(
      homebrew({
        attacks: [melee("short-sword", { criticalRange: { minimumNaturalRoll: 19 }, iterative: false })],
        features: [{ id: "keen", name: "Keen weapon", enabled: true, effects: [keen] }],
      }),
    ).createAttackRollPlan("short-sword", 0, { action: "standardAttack" });
    expect(keenOnly.criticalRange).toEqual({ minimumNaturalRoll: 17 });
  });

  it("lets a wider flat expansion beat a doubling, and keeps the threat a threat", () => {
    const character = homebrew({
      attacks: [melee("longsword", { criticalRange: { minimumNaturalRoll: 19 }, iterative: false })],
      features: [
        { id: "improved-critical", name: "Improved Critical", enabled: true, effects: [expansion()] },
        {
          id: "wide-expansion",
          name: "Wider threat",
          enabled: true,
          effects: [
            expansion({
              operation: "widen",
              widenBy: 5,
              source: { id: "homebrew.wide-expansion", label: "Wider threat" },
            }),
          ],
        },
      ],
    });
    const rules = engine(character);
    const plan = rules.createAttackRollPlan("longsword", 0, {
      action: "standardAttack",
      defense: { kind: "ac", value: MELEE_MODIFIER + 18 },
    });
    // 19–20 widened by 5 is 14–20, which is more expansive than 17–20.
    expect(plan.criticalRange).toEqual({ minimumNaturalRoll: 14 });
    expect(plan.provenance?.criticalRange?.operation).toBe("widen");
    expect(plan.provenance?.criticalRange?.excluded[0]?.source).toBe(
      "homebrew.improved-critical",
    );
    // Being in a doubled or widened range is never an automatic hit.
    const resolved = resolveRollPlan(plan, [14]);
    expect(resolved.outcome.inCriticalRange).toBe(true);
    expect(resolved.outcome.automaticHit).toBe(false);
    expect(resolved.outcome.hit).toBe(false);
    expect(resolved.outcome.critical).toBe(false);
    expect(resolved.outcome.kind).toBe("failure");
  });

  it("validates the operation/argument combination at parse time", () => {
    expect(() =>
      effectSchema.parse({ kind: "criticalRange", target: "attack.melee" }),
    ).toThrow(/requires widenBy/);
    expect(() =>
      effectSchema.parse({
        kind: "criticalRange",
        target: "attack.melee",
        operation: "double",
        widenBy: 2,
      }),
    ).toThrow(/takes no widenBy/);
    expect(
      effectSchema.parse({
        kind: "criticalRange",
        target: "attack.melee",
        operation: "double",
        appliesWhen: { attackIds: ["equipment.rapier"] },
      }),
    ).toMatchObject({ operation: "double" });
    expect(
      effectSchema.parse({
        kind: "criticalRange",
        target: "attack.melee",
        widenBy: 1,
      }),
    ).toMatchObject({ widenBy: 1 });
  });
});
