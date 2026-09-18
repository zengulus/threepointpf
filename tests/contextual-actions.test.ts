import { describe, expect, it } from "vitest";
import {
  RulesEngine,
  abilityPenaltyFloor,
  acModifierAppliesToCmd,
  attackContext,
  evaluateAttack,
  evaluateCombatManeuver,
  evaluateDamage,
  evaluateSkill,
  isSelectorTarget,
} from "@threepointpf/rules-core";
import {
  equipmentCatalog,
  featureCatalog,
  rulesCatalogs,
} from "@threepointpf/rules-data";
import {
  effectSchema,
  parseCharacterInput,
  type AttackDefinition,
  type CharacterInput,
  type Effect,
  type FeatureInstance,
} from "@threepointpf/rules-schema";
import {
  createCharacterActionPlan,
  createCharacterRollPlan,
  InMemoryCharacterRepository,
} from "@threepointpf/shared";
import { resolveRollPlan } from "@threepointpf/dice";

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "homebrew",
    name: "Homebrew Hero",
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

const feature = (
  id: string,
  effects: Effect[],
  extra: Partial<FeatureInstance> = {},
): FeatureInstance => ({ id, name: id, enabled: true, effects, ...extra });
const toggle = (slug: string): FeatureInstance => ({
  id: slug,
  definitionId: `pf1e.paizo.${slug}`,
  name: featureCatalog[`pf1e.paizo.${slug}`]!.name,
  enabled: true,
  effects: [],
});
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

describe("CMD derives applicable AC modifiers semantically", () => {
  it("raises CMD from a homebrew deflection AC effect with no duplicated CMD effect", () => {
    const character = homebrew({
      features: [
        feature(
          "custom-deflection",
          [
            {
              kind: "modifier",
              target: "ac",
              value: 2,
              bonusType: "deflection",
              appliesTo: ["normal", "touch", "flatFooted"],
              source: { id: "homebrew.deflection", label: "Homebrew ring" },
            },
          ],
        ),
      ],
    });
    const rules = engine(character);
    const derived = rules.derive();
    expect(derived.ac.value).toBe(14); // 10 + DEX 2 + deflection 2
    expect(derived.cmd.value).toBe(25); // 23 + deflection 2, with no cmd effect authored
    expect(rules.effects.filter((effect) => effect.target === "cmd")).toHaveLength(
      0,
    );
    const contribution = derived.cmd.contributions.find(
      (item) => item.source === "homebrew.deflection",
    );
    expect(contribution?.value).toBe(2);
    expect(contribution?.note).toContain("applies to CMD semantically");
  });

  it("consumes only AC modifiers that apply in the normal context", () => {
    const flatFootedOnly = homebrew({
      features: [
        feature("situational", [
          {
            kind: "modifier",
            target: "ac",
            value: 4,
            bonusType: "circumstance",
            appliesTo: ["flatFooted"],
            source: { id: "homebrew.flat-only", label: "Flat-footed only" },
          },
        ]),
      ],
    });
    const derived = engine(flatFootedOnly).derive();
    expect(derived.flatFootedAc.value).toBe(14);
    expect(derived.cmd.value).toBe(23);
    expect(
      derived.cmd.contributions.some(
        (item) => item.source === "homebrew.flat-only",
      ),
    ).toBe(false);
  });

  it("excludes armor, shield, natural armor and size AC bonuses but keeps every AC penalty", () => {
    const character = homebrew({
      features: [
        feature("defenses", [
          {
            kind: "modifier",
            target: "ac",
            value: 4,
            bonusType: "armor",
            appliesTo: ["normal", "flatFooted"],
            source: { id: "homebrew.armor-bonus", label: "Armor" },
          },
          {
            kind: "modifier",
            target: "ac",
            value: 2,
            bonusType: "shield",
            appliesTo: ["normal", "flatFooted"],
            source: { id: "homebrew.shield-bonus", label: "Shield" },
          },
          {
            kind: "modifier",
            target: "ac",
            value: 3,
            bonusType: "naturalArmor",
            appliesTo: ["normal", "flatFooted"],
            source: { id: "homebrew.natural-bonus", label: "Natural armor" },
          },
          {
            kind: "modifier",
            target: "ac",
            value: 1,
            bonusType: "size",
            appliesTo: ["normal", "touch", "flatFooted"],
            source: { id: "homebrew.size-bonus", label: "Size" },
          },
          {
            kind: "modifier",
            target: "ac",
            value: -2,
            bonusType: "armor",
            appliesTo: ["normal", "flatFooted"],
            source: { id: "homebrew.armor-penalty", label: "Armor penalty" },
          },
        ]),
      ],
    });
    const derived = engine(character).derive();
    expect(derived.ac.value).toBe(20); // 10 + DEX 2 + 4 + 2 + 3 + 1 − 2
    expect(derived.cmd.value).toBe(21); // only the armor penalty applies
    const cmdSources = derived.cmd.contributions.map((item) => item.source);
    expect(cmdSources).toContain("homebrew.armor-penalty");
    for (const excluded of [
      "homebrew.armor-bonus",
      "homebrew.shield-bonus",
      "homebrew.natural-bonus",
      "homebrew.size-bonus",
    ])
      expect(cmdSources).not.toContain(excluded);
    const reasons = (derived.cmd.excluded ?? []).map(
      (item) => `${item.source}: ${item.reason}`,
    );
    expect(reasons).toContain("homebrew.armor-bonus: armor bonuses do not add to CMD");
    expect(reasons).toContain("homebrew.size-bonus: size bonuses do not add to CMD");
    expect(acModifierAppliesToCmd(2, "armor")).toBe(false);
    expect(acModifierAppliesToCmd(-2, "armor")).toBe(true);
  });

  it("no longer duplicates CMD effects in curated content while AC still raises CMD", () => {
    for (const id of [
      "pf1e.paizo.ring-of-protection-1",
    ])
      expect(
        equipmentCatalog[id]!.effects.some((effect) => effect.target === "cmd"),
      ).toBe(false);
    for (const id of ["pf1e.paizo.haste", "pf1e.paizo.combat-expertise"])
      expect(
        featureCatalog[id]!.effects.some((effect) => effect.target === "cmd"),
      ).toBe(false);
    const character = homebrew({
      equipment: [
        {
          id: "ring",
          definitionId: "pf1e.paizo.ring-of-protection-1",
          equipped: true,
        },
      ],
      features: [toggle("haste")],
    });
    const derived = engine(character).derive();
    expect(derived.ac.value).toBe(14); // 10 + DEX 2 + deflection 1 + dodge 1
    expect(derived.cmd.value).toBe(25); // both AC effects reach CMD
  });
});

describe("temporary ability penalties floor at 1 without clamping every mechanism", () => {
  it("floors a homebrew penalty at 1 and records the limit in provenance", () => {
    const character = homebrew({
      baseAbilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      features: [
        feature("weakening", [
          {
            kind: "modifier",
            target: "ability.str",
            value: -10,
            bonusType: "penalty",
            source: { id: "homebrew.weakening", label: "Weakening curse" },
          },
        ]),
      ],
    });
    const score = engine(character).derive().abilities.str.score;
    expect(score.value).toBe(abilityPenaltyFloor);
    expect(score.contributions.find((item) => item.abilityPenalty)?.value).toBe(
      -10,
    );
    const floor = score.contributions.find(
      (item) => item.source === "rules-core.ability-penalty-floor",
    );
    expect(floor?.value).toBe(3);
    expect(floor?.note).toContain("cannot reduce STR below 1");
    expect(engine(character).derive().abilities.str.modifier.value).toBe(-5);
  });

  it("leaves a replacement baseline free to reach 0 for future damage/drain semantics", () => {
    const character = homebrew({
      baseAbilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      features: [
        feature("drain", [
          {
            kind: "replaceBase",
            target: "ability.str",
            value: 0,
            source: { id: "homebrew.drain", label: "Strength drain baseline" },
          },
        ]),
      ],
    });
    const score = engine(character).derive().abilities.str.score;
    expect(score.value).toBe(0);
    expect(
      score.contributions.some(
        (item) => item.source === "rules-core.ability-penalty-floor",
      ),
    ).toBe(false);
  });

  it("does not clamp penalties that stay above 1", () => {
    const character = homebrew({
      baseAbilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      features: [
        feature("wearying", [
          { kind: "modifier", target: "ability.str", value: -3, bonusType: "penalty" },
        ]),
      ],
    });
    expect(engine(character).derive().abilities.str.score.value).toBe(5);
  });

  it("applies the floor to curated conditions on a low score", () => {
    const weak = homebrew({
      baseAbilities: { str: 2, dex: 4, con: 12, int: 10, wis: 10, cha: 10 },
      features: [toggle("fatigued")],
    });
    const score = engine(weak).derive().abilities.str.score;
    expect(score.value).toBe(1);
    expect(
      score.contributions.some(
        (item) => item.source === "rules-core.ability-penalty-floor",
      ),
    ).toBe(true);
    const lessWeak = homebrew({
      ...weak,
      baseAbilities: { ...weak.baseAbilities, str: 4 },
    });
    expect(engine(lessWeak).derive().abilities.str.score.value).toBe(2);
  });
});

describe("selectors are not concrete fact targets", () => {
  it("rejects baseline, bound and capability operations on a selector target", () => {
    for (const effect of [
      { kind: "replaceBase", target: "skill.all", value: 5 },
      { kind: "multiply", target: "skill.all", factor: 2 },
      { kind: "minimum", target: "skill.all", value: 5 },
      { kind: "maximum", target: "skill.all", value: 5 },
      { kind: "grant", target: "skill.all", grant: "some-capability" },
    ])
      expect(() => effectSchema.parse(effect)).toThrow(/concrete target/);
    expect(
      effectSchema.parse({
        kind: "modifier",
        target: "skill.all",
        value: 1,
        bonusType: "morale",
      }),
    ).toMatchObject({ target: "skill.all" });
    expect(isSelectorTarget("skill.all")).toBe(true);
    expect(isSelectorTarget("skill.climb")).toBe(false);
  });

  it("rejects persisted data that replaced a selector baseline instead of applying it to every skill", () => {
    expect(() =>
      parseCharacterInput(
        homebrew({
          features: [
            feature("legacy", [
              { kind: "replaceBase", target: "skill.all", value: 5 } as Effect,
            ]),
          ],
        }),
      ),
    ).toThrow(/concrete target/);
  });

  it("still applies selector modifiers to every concrete skill and never to initiative", () => {
    const character = homebrew({
      skillRanks: { climb: 1, perception: 1 },
      features: [
        feature("all-skills", [
          {
            kind: "modifier",
            target: "skill.all",
            value: 2,
            bonusType: "morale",
            source: { id: "homebrew.all-skills", label: "All skills +2" },
          },
        ]),
      ],
    });
    const derived = engine(character).derive();
    expect(derived.skills.climb!.total.value).toBe(6); // ranks 1 + STR 3 + morale 2
    expect(derived.skills.perception!.total.value).toBe(3); // ranks 1 + WIS 0 + morale 2
    expect(derived.initiative.value).toBe(2); // DEX only, never the skill selector
  });
});

describe("contextual rolls: attack eligibility, touch and full attacks", () => {
  it("excludes Deadly Aim from touch attacks with visible provenance", () => {
    const bow = melee("bow", {
      attackAbility: "dex",
      attackTags: ["weapon.ranged"],
      mode: "ranged",
    });
    const ray = melee("ray", {
      attackAbility: "dex",
      damageAbility: undefined,
      baseDamage: { count: 1, sides: 6 },
      attackTags: ["weapon.ranged", "weapon.touch"],
      mode: "ranged",
    });
    const character = homebrew({
      attacks: [bow, ray],
      features: [toggle("deadly-aim")],
    });
    const rules = engine(character);
    const derived = rules.derive();
    const [bowAttack, rayAttack] = derived.attacks;
    // BAB 8 + DEX 2; Deadly Aim scales 1 + floor(8 / 4) = 3.
    expect(bowAttack!.attack.value).toBe(7);
    expect(bowAttack!.damage.modifier).toBe(9); // STR 3 + 6
    expect(rayAttack!.attack.value).toBe(10); // touch attack keeps its full bonus
    expect(rayAttack!.damage.modifier).toBe(0);
    expect(
      (rayAttack!.attack.excluded ?? []).map((item) => item.reason),
    ).toContain("does not apply to touch attacks");
    expect(
      (bowAttack!.attack.excluded ?? []).some((item) =>
        item.reason.includes("touch"),
      ),
    ).toBe(false);
    expect(rayAttack!.attack.rollContext?.touch).toBe(true);
  });

  it("applies Power Attack damage by weapon handedness and explains every excluded variant", () => {
    const character = homebrew({
      attacks: [
        melee("greatsword", {
          damageAbilityMultiplier: 1.5,
          attackTags: ["weapon.melee", "weapon.two-handed"],
        }),
        melee("longsword"),
        melee("dagger", {
          damageAbilityMultiplier: 0.5,
          attackTags: ["weapon.melee", "weapon.off-hand"],
        }),
      ],
      features: [toggle("power-attack")],
    });
    const derived = engine(character).derive();
    const [greatsword, longsword, dagger] = derived.attacks;
    // BAB 8: BAB steps 1 + floor(8 / 4) = 3.
    expect(greatsword!.damage.modifier).toBe(13); // 1.5 × STR 3 + 3 × 3
    expect(longsword!.damage.modifier).toBe(9); // STR 3 + 2 × 3
    expect(dagger!.damage.modifier).toBe(4); // 0.5 × STR 3 + 1 × 3
    expect(greatsword!.attack.value).toBe(8); // BAB 8 + STR 3 − Power Attack 3
    // The damaged weapon keeps its own variant and explains the others.
    const oneHanded = evaluateDamage(
      engine(character),
      longsword!.definition,
      attackContext(engine(character), longsword!.definition, {
        kind: "damage",
      }),
    );
    expect(oneHanded.modifier).toBe(9);
    expect((oneHanded.excluded ?? []).map((item) => item.reason)).toContain(
      "requires tags weapon.two-handed",
    );
    expect(oneHanded.contributions.map((item) => item.value)).toContain(6);
    const twoHanded = evaluateDamage(
      engine(character),
      greatsword!.definition,
      attackContext(engine(character), greatsword!.definition, {
        kind: "damage",
      }),
    );
    expect(
      (twoHanded.excluded ?? []).map((item) => item.reason).join(" | "),
    ).toContain("excluded for tags weapon.two-handed, weapon.off-hand");
    expect(
      (derived.attacks[0]!.attack.excluded ?? []).map((item) => item.reason),
    ).not.toContain("not a melee attack");
  });

  it("keeps the two-handed Strength multiplier off flat damage and off a Strength penalty", () => {
    // A greatsword deals 2d6 + 1½ × Strength modifier. Each case here separates
    // that rule from the tempting "multiply the damage roll" reading: an
    // enhancement bonus must stay flat, and a Strength penalty is added in full.
    const greatsword = (str: number, weaponBonus: number) =>
      engine(
        homebrew({
          baseAbilities: { str, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          baseBab: 1,
          attacks: [
            melee("greatsword", {
              baseDamage: { count: 2, sides: 6 },
              damageAbilityMultiplier: 1.5,
              weaponBonus,
              attackTags: ["weapon.melee", "weapon.two-handed"],
            }),
          ],
        }),
      ).createDamageRollPlan("greatsword");

    // Strength 17 (+3): floor(1½ × 3) = 4, and a +1 enhancement stays +1 —
    // scaling the whole roll instead would give 6.
    expect(greatsword(17, 0).modifier).toBe(4);
    expect(greatsword(17, 1).modifier).toBe(5);
    // An odd modifier rounds down: Strength 13 (+1) → floor(1½ × 1) = 1.
    expect(greatsword(13, 0).modifier).toBe(1);
    // Strength 8 (−1) applies in full; multiplying it would make it −2.
    expect(greatsword(8, 0).modifier).toBe(-1);
    expect(greatsword(8, 1).modifier).toBe(0);
    expect(
      greatsword(17, 0).provenance.modifier?.map((item) => item.label),
    ).toContain("STR damage (1.5×)");
    expect(greatsword(8, 0).provenance.modifier?.map((item) => item.label)).toContain(
      "STR damage (1×)",
    );
  });

  it("grants one shared Haste extra attack to a multi-weapon full attack", () => {
    const character = homebrew({
      attacks: [
        melee("primary"),
        melee("off-hand", { attackTags: ["weapon.melee", "weapon.off-hand"] }),
      ],
      features: [toggle("haste")],
    });
    const rules = engine(character);
    const plan = rules.createActionPlan({
      action: "fullAttack",
      attackIds: ["primary", "off-hand"],
    });
    expect(plan.attacks.map((attack) => attack.role)).toEqual([
      "primary",
      "off-hand",
    ]);
    const steps = plan.attacks.map((attack) =>
      attack.steps.map((step) => step.role),
    );
    // BAB 8 → one iterative; the extra attack belongs to the action, not to
    // every weapon.
    expect(steps[0]).toEqual(["primary", "extra", "iterative"]);
    expect(steps[1]).toEqual(["primary", "iterative"]);
    expect(
      plan.attacks.flatMap((attack) =>
        attack.steps.filter((step) => step.role === "extra"),
      ),
    ).toHaveLength(1);
    // A standard attack is a different action and never inherits full-attack extras.
    const standard = rules.createActionPlan({
      action: "standardAttack",
      attackIds: ["primary"],
    });
    expect(standard.attacks[0]!.steps).toHaveLength(1);
    expect(standard.attacks[0]!.steps[0]!.role).toBe("primary");
  });

  it("applies Rapid Shot only inside an eligible ranged full attack", () => {
    const character = homebrew({
      attacks: [
        melee("bow", {
          attackAbility: "dex",
          attackTags: ["weapon.ranged"],
          mode: "ranged",
        }),
      ],
      features: [toggle("rapid-shot")],
    });
    const rules = engine(character);
    const full = rules.derive().attacks[0]!;
    expect(full.attack.value).toBe(10); // standard attack keeps +10
    expect(full.fullAttack.map((step) => step.value)).toEqual([8, 8, 3]);
    const standard = rules.createAttackRollPlan("bow", 0, {
      action: "standardAttack",
    });
    expect(standard.modifier).toBe(10);
    const touchStandard = rules.createAttackRollPlan("bow", 0, {
      action: "standardAttack",
      touch: true,
    });
    expect(touchStandard.modifier).toBe(10);
    expect(touchStandard.context.touch).toBe(true);
    expect(touchStandard.context.action.kind).toBe("standardAttack");
  });

  it("gates the Combat Expertise tradeoff on its situational flag", () => {
    const character = homebrew({
      attacks: [melee("longsword")],
      features: [toggle("combat-expertise")],
    });
    const rules = engine(character);
    const derived = rules.derive();
    expect(derived.ac.value).toBe(15); // 10 + DEX 2 + dodge 3
    expect(derived.touchAc.value).toBe(15);
    expect(derived.flatFootedAc.value).toBe(10);
    expect(derived.cmd.value).toBe(26); // dodge AC reaches CMD semantically
    expect(derived.cmb.value).toBe(8); // 11 − 3
    expect(derived.attacks[0]!.attack.value).toBe(8); // 11 − 3
    const definition = rules.attackDefinitions[0]!;
    const withheld = evaluateAttack(
      rules,
      definition,
      attackContext(rules, definition, {
        kind: "attack",
        excludeFlags: ["combat-expertise"],
      }),
    );
    expect(withheld.value).toBe(11);
    expect((withheld.excluded ?? []).map((item) => item.reason)).toContain(
      "requires flags combat-expertise",
    );
    expect(
      rules.createAttackRollPlan("longsword", 0, {
        action: "standardAttack",
        excludeFlags: ["combat-expertise"],
      }).modifier,
    ).toBe(11);
  });

  it("applies maneuver-conditional CMB modifiers only in their maneuver context", () => {
    const character = homebrew({
      features: [
        feature("improved-trip", [
          {
            kind: "modifier",
            target: "cmb",
            value: 2,
            bonusType: "untyped",
            appliesWhen: { maneuvers: ["trip"] },
            source: { id: "homebrew.improved-trip", label: "Improved Trip" },
          },
        ]),
      ],
    });
    const rules = engine(character);
    expect(rules.createManeuverRollPlan("trip").modifier).toBe(13);
    expect(rules.createManeuverRollPlan("disarm").modifier).toBe(11);
    expect(rules.createManeuverRollPlan().modifier).toBe(11);
    expect(rules.derive().cmb.value).toBe(11);
    const disarm = evaluateCombatManeuver(rules, "cmb", { maneuver: "disarm" });
    expect((disarm.excluded ?? []).map((item) => item.reason)).toContain(
      "maneuvers trip only",
    );
    const action = rules.createActionPlan({ action: "maneuver", maneuver: "trip" });
    expect(action.context.maneuver).toBe("trip");
    expect(action.evaluation?.value).toBe(13);
    expect(action.attacks).toHaveLength(0);
  });

  it("keeps natural secondary attacks to one step and refuses Haste extras for them", () => {
    const secondary = melee("bite", {
      attackTags: undefined,
      mode: undefined,
      profileId: "pf1e.autosheet.natural-secondary",
      baseDamage: { count: 1, sides: 6 },
    });
    const primary = melee("claw", {
      attackTags: undefined,
      mode: undefined,
      profileId: "pf1e.autosheet.natural-primary",
      baseDamage: { count: 1, sides: 4 },
    });
    const character = homebrew({
      attacks: [secondary, primary],
      features: [toggle("haste")],
    });
    const derived = engine(character).derive();
    const [bite, claw] = derived.attacks;
    expect(bite!.fullAttack).toHaveLength(1);
    expect(bite!.action.attacks[0]!.steps.map((step) => step.role)).toEqual([
      "primary",
    ]);
    expect(claw!.action.attacks[0]!.steps.map((step) => step.role)).toEqual([
      "primary",
      "extra",
    ]);
  });

  it("keeps condition penalties contextual instead of universal", () => {
    const character = homebrew({
      skillRanks: { perception: 1 },
      features: [toggle("dazzled")],
    });
    const rules = engine(character);
    const plain = rules.createSkillRollPlan("perception");
    expect(plain.modifier).toBe(1); // ranks 1 + WIS 0
    const sightBased = rules.createSkillRollPlan("perception", {
      flags: ["sight-based"],
    });
    expect(sightBased.modifier).toBe(0);
    expect(sightBased.context.flags).toContain("sight-based");
    expect(sightBased.context.action.kind).toBe("skillCheck");
    const evaluated = evaluateSkill(rules, "perception");
    expect((evaluated.total.excluded ?? []).map((item) => item.reason)).toContain(
      "requires flags sight-based",
    );
  });
});

describe("contextual plan persistence and browser/TTS parity", () => {
  it("rebuilds the identical contextual plan after a repository round trip", async () => {
    const character = homebrew({
      attacks: [
        melee("primary"),
        melee("off-hand", { attackTags: ["weapon.melee", "weapon.off-hand"] }),
      ],
      features: [toggle("power-attack"), toggle("haste"), toggle("combat-expertise")],
    });
    const repository = new InMemoryCharacterRepository(rulesCatalogs);
    await repository.save(character);
    const loaded = (await repository.load(character.id))!;
    const request = {
      characterId: character.id,
      kind: "attack" as const,
      attackId: "primary",
      attackIndex: 1,
      action: "fullAttack" as const,
      attackIds: ["primary", "off-hand"],
    };
    const browser = engine(character);
    const server = createCharacterRollPlan(loaded, request, rulesCatalogs);
    expect(server).toEqual(
      browser.createAttackRollPlan("primary", 1, {
        attackIds: ["primary", "off-hand"],
      }),
    );
    expect(resolveRollPlan(server, [17]).total).toBe(17 + server.modifier);
    const action = createCharacterActionPlan(
      loaded,
      { characterId: character.id, action: "fullAttack", attackIds: ["primary", "off-hand"] },
      rulesCatalogs,
    );
    expect(action.attacks.map((attack) => attack.steps.map((step) => step.role))).toEqual(
      browser
        .createActionPlan({
          action: "fullAttack",
          attackIds: ["primary", "off-hand"],
        })
        .attacks.map((attack) => attack.steps.map((step) => step.role)),
    );
    const withheld = createCharacterRollPlan(
      loaded,
      {
        characterId: character.id,
        kind: "attack",
        attackId: "primary",
        attackIndex: 0,
        action: "standardAttack",
        excludeFlags: ["combat-expertise"],
      },
      rulesCatalogs,
    );
    expect(withheld.modifier).toBe(
      browser.createAttackRollPlan("primary", 0, {
        action: "standardAttack",
        excludeFlags: ["combat-expertise"],
      }).modifier,
    );
  });
});
