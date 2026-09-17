import { describe, expect, it } from "vitest";
import { RulesEngine, evaluateAdvancement } from "@threepointpf/rules-core";
import {
  rulesCatalogs,
  progressionCatalog,
  featureCatalog,
  attackProfileCatalog,
  experienceCatalog,
} from "@threepointpf/rules-data";
import {
  createCharacterRollPlan,
  InMemoryCharacterRepository,
} from "@threepointpf/shared";
import { resolveRollPlan } from "@threepointpf/dice";
import {
  advancementSlotsSchema,
  effectSchema,
  mergeProgressionCatalogs,
  progressionCatalogSchema,
  experienceTrackDefinitionSchema,
  sizeCategories,
  type CharacterInput,
  type Effect,
  type FeatureInstance,
  type ProgressionCatalog,
} from "@threepointpf/rules-schema";

function character(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "pipeline",
    name: "Pipeline",
    baseAbilities: { str: 18, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 3,
    skillRanks: {},
    attacks: [],
    features: [],
    damageTaken: 4,
    temporaryHp: 2,
    ...overrides,
  };
}
const toggle = (slug: string): FeatureInstance => ({
  id: slug,
  definitionId: `pf1e.paizo.${slug}`,
  name: featureCatalog[`pf1e.paizo.${slug}`]!.name,
  enabled: true,
  effects: [],
});
const custom = (effects: Effect[]): FeatureInstance => ({
  id: "custom",
  name: "Custom",
  enabled: true,
  effects,
});
const engine = (input: CharacterInput) => new RulesEngine(input, rulesCatalogs);
const advanced = (
  rows: string[][],
  overrides: Partial<CharacterInput> = {},
): CharacterInput =>
  character({
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    advancementSlots: rows.map((row, index) => ({
      id: `level-${index + 1}`,
      tracks: row.map((id, track) => ({
        id: `track-${track + 1}`,
        entry: { progressionId: id },
      })),
    })),
    ...overrides,
  });

describe("catalog advancement and arbitrary classes", () => {
  it("imports every ordinary ability-based attack cell with explicit off-hand and single-attack semantics", () => {
    expect(Object.keys(attackProfileCatalog)).toHaveLength(60);
    expect(
      attackProfileCatalog["pf1e.autosheet.off-hand-melee-wis-wis-0-5"],
    ).toMatchObject({
      attackAbility: "wis",
      damageAbility: "wis",
      damageAbilityMultiplier: 0.5,
      iterative: false,
      extraAttackEligible: false,
      source: { range: "F55" },
    });
    expect(
      attackProfileCatalog["pf1e.autosheet.single-ranged-dex-dex-1"],
    ).toMatchObject({
      mode: "ranged",
      iterative: false,
      extraAttackEligible: false,
      source: { range: "X57" },
    });
  });

  it("checks every XP threshold boundary without adding levels or inventing epic thresholds", () => {
    for (const track of Object.values(experienceCatalog)) {
      for (const threshold of track.thresholds) {
        const input = advanced([["fighter"]], {
          experience: { trackId: track.id, points: threshold.points },
        });
        const result = engine(input).derive();
        expect(result.experience!.eligibleLevel.value).toBe(threshold.level);
        expect(result.advancement!.slotCount).toBe(1);
        if (threshold.points > 0)
          expect(
            engine({
              ...input,
              experience: { trackId: track.id, points: threshold.points - 1 },
            }).evaluate("experience.level").value,
          ).toBe(threshold.level - 1);
      }
    }
    expect(
      engine(
        character({
          experience: {
            trackId: "pf1e.autosheet.experience-fast",
            points: 99999999,
          },
        }),
      ).derive().experience!.nextThreshold,
    ).toBeUndefined();
    expect(() =>
      experienceTrackDefinitionSchema.parse({
        id: "bad",
        name: "Bad",
        thresholds: [
          { level: 1, points: 0 },
          { level: 2, points: 0 },
        ],
      }),
    ).toThrow(/strictly increasing/);
    expect(() =>
      engine(
        character({ experience: { trackId: "toString", points: 0 } }),
      ).derive(),
    ).toThrow(/Unknown experience/);
    expect(() =>
      effectSchema.parse({
        kind: "modifier",
        target: "experience.level",
        value: 1,
        bonusType: "untyped",
      }),
    ).toThrow(/query-only/);
  });

  it("persists optional XP and data-backed age without stacking age categories", async () => {
    const age = (name: string): FeatureInstance => ({
      id: name,
      definitionId: `pf1e.autosheet.age-${name}`,
      name,
      enabled: true,
      effects: [],
    });
    const input = advanced([["fighter"]], {
      experience: { trackId: "pf1e.autosheet.experience-medium", points: 2500 },
      features: [age("old"), age("venerable")],
    });
    const repository = new InMemoryCharacterRepository(rulesCatalogs);
    await repository.save(input);
    const saved = (await repository.load(input.id))!;
    expect(saved.experience).toEqual(input.experience);
    const result = engine(saved).derive();
    expect(result.experience!.eligibleLevel.value).toBe(2);
    expect(result.experience!.remaining).toBe(2500);
    expect(result.abilities.str.score.value).toBe(12);
    expect(result.abilities.int.score.value).toBe(13);
    expect(
      result.abilities.str.score.contributions.at(-1)!.sourceMetadata?.range,
    ).toBe("F28:F34");
  });
  it("rejects raw duplicates, resolved aliases, unknown IDs, and prototype keys at every boundary", () => {
    const slots = advanced([["fighter", "fighter"]]).advancementSlots!;
    expect(() => advancementSlotsSchema.parse(slots)).toThrow(
      /Duplicate progression/,
    );
    expect(() => evaluateAdvancement(slots, progressionCatalog)).toThrow(
      /Duplicate progression/,
    );
    expect(() => engine(advanced([["fighter", "pf1e.paizo.fighter"]]))).toThrow(
      /Duplicate progression/,
    );
    expect(() => engine(advanced([["toString"]]))).toThrow(
      /Unknown progression/,
    );
  });

  it("preserves character-global levels, one class-skill bonus and all providers when classes move across tracks", () => {
    const value = engine(
      advanced(
        [
          ["fighter", "rogue", "wizard"],
          ["wizard", "fighter", "rogue"],
        ],
        { skillRanks: { climb: 1, spellcraft: 1, perception: 0 } },
      ),
    ).derive();
    expect(
      Object.values(value.advancement!.progressionLevels).map(
        (level) => level.value,
      ),
    ).toEqual([2, 2, 2]);
    expect(value.skills.climb!.classSkill).toBe(true);
    expect(value.skills.climb!.total.value).toBe(8); // 1 rank + STR 4 + 3 once
    expect(value.skills.climb!.classSkillProvenance).toHaveLength(2);
    expect(
      value.skills.climb!.total.contributions.filter(
        (item) => item.source === "skill.climb.class",
      ),
    ).toHaveLength(1);
    expect(value.skills.spellcraft!.total.value).toBe(4);
    expect(
      value.skills.perception!.total.contributions.find(
        (item) => item.source === "skill.perception.class",
      )?.value,
    ).toBe(0);
    expect(value.skills.climb!.classSkillProvenance[0]!.note).toContain(
      "Class Skills!",
    );
  });

  it("supports rank-zero and explicit false/true overrides without hiding imported skill metadata", () => {
    const value = engine(
      advanced([["wizard"]], {
        skillRanks: { spellcraft: 1, climb: 1 },
        skills: {
          spellcraft: { classSkillOverride: false },
          climb: { classSkillOverride: true, governingAbility: "int" },
        },
      }),
    ).derive();
    expect(value.skills.spellcraft!.total.value).toBe(1);
    expect(value.skills.climb!.total.value).toBe(4);
    expect(value.skills.climb!.classSkillProvenance[0]!.source).toContain(
      "override",
    );
    expect(Object.keys(value.skills).length).toBeGreaterThanOrEqual(35);
  });

  it("supports twelve distinct tracks without multiplying hit dice or combining track maxima per slot", () => {
    const ids = Object.keys(progressionCatalog)
      .filter((id) => !progressionCatalog[id]!.chart)
      .slice(0, 12);
    const value = engine(advanced([ids, [...ids.slice(1), ids[0]!]])).derive();
    expect(value.advancement!.trackIds).toHaveLength(12);
    expect(value.advancement!.hitDiceCount).toBe(2);
    expect(
      Object.values(value.advancement!.progressionLevels).every(
        (level) => level.value === 2,
      ),
    ).toBe(true);
    expect(value.bab.value).toBeLessThanOrEqual(2);
  });

  it("allows character-owned explicit class charts while rejecting imported ID collisions and invalid charts", () => {
    const id = "homebrew.local.star-knight";
    const customProgressions: ProgressionCatalog = {
      [id]: {
        id,
        name: "Star Knight",
        hitDieSides: 12,
        babProgression: "half",
        saveProgressions: { fortitude: "poor", reflex: "poor", will: "poor" },
        classSkills: ["fly"],
        features: [{ id: "starlight", name: "Starlight", level: 2 }],
        chart: [
          { level: 1, bab: 1, saves: { fortitude: 1, reflex: 0, will: 2 } },
          { level: 2, bab: 3, saves: { fortitude: 2, reflex: 1, will: 3 } },
        ],
      },
    };
    const value = engine(
      advanced([[id], [id]], { customProgressions, skillRanks: { fly: 1 } }),
    ).derive();
    expect(value.bab.value).toBe(3);
    expect(value.advancement!.features[0]!.name).toBe("Starlight");
    expect(value.skills.fly!.classSkill).toBe(true);
    expect(() =>
      engine(advanced([[id], [id], [id]], { customProgressions })),
    ).toThrow(/no chart row/);
    expect(() =>
      mergeProgressionCatalogs(progressionCatalog, {
        "pf1e.paizo.fighter": progressionCatalog["pf1e.paizo.fighter"]!,
      }),
    ).toThrow(/conflicts/);
    expect(() =>
      progressionCatalogSchema.parse({
        [id]: {
          ...customProgressions[id],
          chart: [
            { level: 2, bab: 3, saves: { fortitude: 2, reflex: 1, will: 3 } },
          ],
        },
      }),
    ).toThrow(/contiguous/);
  });

  it("unlocks explicit custom class effects once at global level and removes them when advancement is undone", () => {
    const id = "homebrew.local.champion";
    const customProgressions: ProgressionCatalog = {
      [id]: {
        id,
        name: "Champion",
        hitDieSides: 10,
        babProgression: "full",
        saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
        features: [
          {
            id: "might",
            name: "Might",
            level: 2,
            effects: [
              {
                kind: "modifier",
                target: "ability.str",
                value: 2,
                bonusType: "enhancement",
              },
            ],
          },
        ],
      },
    };
    const rows = [
      [id, "wizard"],
      ["wizard", id],
    ];
    const unlocked = engine(advanced(rows, { customProgressions })).derive();
    expect(unlocked.abilities.str.score.value).toBe(20);
    expect(
      unlocked.abilities.str.score.contributions.find((item) =>
        item.label.startsWith("Might"),
      )?.source,
    ).toContain("slot.level-2.track.track-2");
    expect(
      engine(advanced(rows.slice(0, 1), { customProgressions })).derive()
        .abilities.str.score.value,
    ).toBe(18);
  });
});

describe("workbook numeric operations and size", () => {
  it("applies Haste caps before Entangled multipliers on all existing movement modes and never invents absent modes", () => {
    const input = character({
      baseSpeeds: { land: 20, fly: 60, swim: 10 },
      features: [toggle("haste"), toggle("entangled")],
    });
    const first = engine(input).derive();
    const reversed = engine({
      ...input,
      features: [...input.features].reverse(),
    }).derive();
    expect(
      Object.fromEntries(
        Object.entries(first.speeds).map(([id, value]) => [id, value.value]),
      ),
    ).toEqual({ land: 20, fly: 45, swim: 10, climb: 0, burrow: 0 });
    expect(first.speeds).toEqual(reversed.speeds);
    expect(first.speeds.fly.contributions.map((item) => item.value)).toEqual([
      60, 30, -45,
    ]);
    expect(first.speeds.fly.contributions[2]!.note).toContain("×0.5");
  });

  it("uses baseline replacement, typed reduction, multiplication, strongest lower bound then upper bound", () => {
    const value = engine(
      character({
        features: [
          custom([
            { kind: "replaceBase", target: "speed.land", value: 40 },
            {
              kind: "modifier",
              target: "speed.land",
              value: 10,
              bonusType: "enhancement",
            },
            {
              kind: "modifier",
              target: "speed.land",
              value: 20,
              bonusType: "enhancement",
            },
            { kind: "multiply", target: "speed.land", factor: 0.5 },
            { kind: "minimum", target: "speed.land", value: 35 },
            { kind: "maximum", target: "speed.land", value: 40 },
          ]),
        ],
      }),
    ).derive();
    expect(value.movement.value).toBe(35);
    expect(
      value.movement.contributions.reduce(
        (total, item) => total + item.value,
        0,
      ),
    ).toBe(35);
    expect(() =>
      engine(
        character({
          features: [
            custom([
              { kind: "minimum", target: "speed.land", value: 50 },
              { kind: "maximum", target: "speed.land", value: 40 },
            ]),
          ],
        }),
      ),
    ).toThrow(/Conflicting/);
    expect(() =>
      effectSchema.parse({
        kind: "modifier",
        target: "combat.bab",
        value: 1,
        bonusType: "untyped",
        scaling: { kind: "babStep", every: 4, base: 1 },
      }),
    ).toThrow(/BAB scaling/);
  });

  it.each(sizeCategories.map((size, index) => [size, index] as const))(
    "uses the real nonlinear SizeTable for %s",
    (baseSize, index) => {
      const result = engine(
        character({
          baseSize,
          attacks: [
            {
              id: "sword",
              name: "Sword",
              attackAbility: "str",
              baseDamage: { count: 1, sides: 8 },
            },
          ],
          skillRanks: { fly: 1, stealth: 1 },
        }),
      ).derive();
      const size = [8, 4, 2, 1, 0, -1, -2, -4, -8][index]!;
      expect(result.ac.value).toBe(12 + size);
      expect(result.touchAc.value).toBe(12 + size);
      expect(result.flatFootedAc.value).toBe(10 + size);
      expect(result.attacks[0]!.attack.value).toBe(12 + size);
      expect(result.cmb.value).toBe((index <= 2 ? 10 : 12) - size);
      expect(result.cmd.value).toBe(24 - size);
      expect(result.skills.fly!.total.value).toBe(3 - (index - 4) * 2);
      expect(result.skills.stealth!.total.value).toBe(3 - (index - 4) * 4);
    },
  );

  it("clamps relative size while retaining source evidence and rejects fractional size steps", () => {
    const value = engine(
      character({
        baseSize: "colossal",
        features: [
          custom([
            {
              kind: "modifier",
              target: "size.relative",
              value: 2,
              bonusType: "untyped",
            },
          ]),
        ],
      }),
    ).derive();
    expect(value.size.category).toBe("colossal");
    expect(value.size.relative.value).toBe(0);
    expect(value.size.relative.contributions.map((item) => item.value)).toEqual(
      [0, 2, -2],
    );
    expect(() =>
      effectSchema.parse({
        kind: "modifier",
        target: "size.relative",
        value: 0.5,
        bonusType: "untyped",
      }),
    ).toThrow(/integer/);
  });
});

describe("equipment, toggles, and attack profiles", () => {
  it("rejects inherited catalog keys instead of treating prototype properties as content", () => {
    expect(() =>
      engine(
        character({
          features: [
            {
              id: "bad",
              name: "Bad",
              definitionId: "toString",
              enabled: true,
              effects: [],
            },
          ],
        }),
      ),
    ).toThrow(/Unknown feature/);
    expect(() =>
      engine(
        character({
          equipment: [
            { id: "bad", definitionId: "constructor", equipped: true },
          ],
        }),
      ),
    ).toThrow(/Unknown equipment/);
    expect(() =>
      engine(
        character({
          attacks: [
            {
              id: "bad",
              name: "Bad",
              attackAbility: "str",
              profileId: "toString",
              baseDamage: { count: 1, sides: 6 },
            },
          ],
        }),
      ),
    ).toThrow(/Unknown attack profile/);
  });

  it("applies imported zero-Dex caps and explicit armor supplements through ordinary effects", () => {
    const input = character({
      equipment: [
        {
          id: "plate",
          definitionId: "pf1e.autosheet.agile-half-plate",
          equipped: true,
        },
        {
          id: "shield",
          definitionId: "pf1e.autosheet.tower-shield",
          equipped: true,
        },
      ],
      skillRanks: { climb: 1 },
      attacks: [
        {
          id: "sword",
          name: "Sword",
          attackAbility: "str",
          baseDamage: { count: 1, sides: 8 },
        },
      ],
    });
    const value = engine(input).derive();
    expect([
      value.ac.value,
      value.touchAc.value,
      value.flatFootedAc.value,
    ]).toEqual([22, 10, 22]);
    expect(value.attacks[0]!.attack.value).toBe(10); // BAB8 + STR4 - tower2
    expect(value.cmb.value).toBe(10);
    expect(value.skills.climb!.total.value).toBe(-9); // 1+4−7−10+3
    expect(
      value.ac.contributions.find(
        (item) => item.source === "equipment.plate.max-dexterity",
      )?.sourceMetadata?.row,
    ).toBe(192);
    const unarmored = engine({
      ...input,
      equipment: input.equipment!.map((item) => ({ ...item, equipped: false })),
    }).derive();
    expect(unarmored.attacks[0]!.attack.value).toBe(12);
  });

  it("does not double-stack weapon enhancement with an enhancement effect", () => {
    const value = engine(
      character({
        attacks: [
          {
            id: "sword",
            name: "Sword",
            attackAbility: "str",
            damageAbility: "str",
            weaponBonus: 2,
            baseDamage: { count: 1, sides: 8 },
          },
        ],
        features: [
          custom([
            {
              kind: "modifier",
              target: "attack.melee",
              value: 3,
              bonusType: "enhancement",
            },
            {
              kind: "modifier",
              target: "damage.melee",
              value: 3,
              bonusType: "enhancement",
            },
          ]),
        ],
      }),
    ).derive();
    expect(value.attacks[0]!.attack.value).toBe(15);
    expect(value.attacks[0]!.damage.modifier).toBe(7);
  });

  it("rejects numeric overflow and excessive attack sequences before persistence or rolling", async () => {
    const overflow = character({
      baseSpeeds: { fly: 1e308 },
      features: [
        custom([{ kind: "multiply", target: "speed.fly", factor: 1e308 }]),
      ],
    });
    expect(() => engine(overflow).derive()).toThrow(/Non-finite/);
    await expect(
      new InMemoryCharacterRepository(rulesCatalogs).save(overflow),
    ).rejects.toThrow(/Non-finite/);
    const sequence = character({
      attacks: [
        {
          id: "sword",
          name: "Sword",
          attackAbility: "str",
          baseDamage: { count: 1, sides: 8 },
        },
      ],
      features: [
        custom([
          {
            kind: "modifier",
            target: "attacks.extra.melee",
            value: 1e9,
            bonusType: "untyped",
          },
        ]),
      ],
    });
    expect(() => engine(sequence).derive()).toThrow(/256 rolls/);
  });
  it("rehydrates equipment and composed conditions into identical browser/TTS full-attack plans", async () => {
    const input = character({
      baseSize: "large",
      equipment: [
        {
          id: "magic-sword",
          definitionId: "pf1e.paizo.greatsword",
          equipped: true,
        },
      ],
      features: [toggle("power-attack"), toggle("haste"), toggle("entangled")],
    });
    const repository = new InMemoryCharacterRepository(rulesCatalogs);
    await repository.save(input);
    const loaded = await repository.load(input.id);
    const browser = engine(input);
    for (
      let index = 0;
      index < browser.derive().attacks[0]!.fullAttack.length;
      index++
    ) {
      const plan = createCharacterRollPlan(
        loaded!,
        {
          characterId: input.id,
          kind: "attack",
          attackId: "equipment.magic-sword",
          attackIndex: index,
        },
        rulesCatalogs,
      );
      expect(plan).toEqual(
        browser.createAttackRollPlan("equipment.magic-sword", index),
      );
      expect(resolveRollPlan(plan, [11]).total).toBe(11 + plan.modifier);
    }
  });
  it("equipped armor/shields respect defense contexts, Dexterity limits, check penalties and movement", () => {
    const equipment = [
      "full-plate",
      "heavy-steel-shield",
      "ring-of-protection-1",
      "amulet-of-natural-armor-1",
    ].map((id) => ({
      id,
      definitionId: `pf1e.${id === "full-plate" ? "autosheet" : "paizo"}.${id}`,
      equipped: true,
    }));
    const value = engine(
      character({ equipment, skillRanks: { stealth: 1 } }),
    ).derive();
    expect([
      value.ac.value,
      value.touchAc.value,
      value.flatFootedAc.value,
    ]).toEqual([24, 12, 23]);
    expect(value.skills.stealth!.total.value).toBe(-5);
    expect(value.movement.value).toBe(20);
    expect(
      value.ac.contributions.some(
        (item) => item.source === "equipment.full-plate",
      ),
    ).toBe(true);
    const unequipped = engine(
      character({
        equipment: equipment.map((item) => ({ ...item, equipped: false })),
      }),
    ).derive();
    expect(unequipped.ac.value).toBe(12);
    expect(unequipped.movement.value).toBe(30);
  });

  it("uses BAB once with Power Attack profile ratios, weapon enhancement and indexed full-attack plans", () => {
    const input = character({
      equipment: [
        {
          id: "sword",
          definitionId: "pf1e.paizo.greatsword",
          equipped: true,
          attack: {
            id: "sword",
            name: "Magic sword",
            attackAbility: "str",
            profileId: "pf1e.autosheet.two-handed",
            baseDamage: { count: 2, sides: 6 },
            weaponBonus: 1,
          },
        },
      ],
      features: [
        toggle("power-attack"),
        toggle("haste"),
        custom([
          {
            kind: "modifier",
            target: "combat.bab",
            value: 1,
            bonusType: "untyped",
          },
        ]),
      ],
    });
    const rules = engine(input);
    const result = rules.derive();
    const sword = result.attacks[0]!;
    expect(result.bab.value).toBe(9);
    expect(sword.attack.value).toBe(12); // BAB 9 + STR 4 + enhancement 1 − PA 3 + Haste 1
    expect(
      sword.attack.contributions.filter((item) => item.source === "combat.bab"),
    ).toHaveLength(1);
    expect(sword.damage.modifier).toBe(16); // STR 6 + PA 9 + enhancement 1
    expect(sword.fullAttack.map((item) => item.value)).toEqual([12, 12, 7]);
    expect(rules.createAttackRollPlan("equipment.sword", 2).modifier).toBe(7);
    expect(
      rules.createAttackRollPlan("equipment.sword", 2).context.action
        .sequenceIndex,
    ).toBe(2);
    expect(() => rules.createAttackRollPlan("equipment.sword", 3)).toThrow(
      /index/,
    );
  });

  it("makes standard, two-handed, off-hand, ranged, finesse, thrown and natural profiles ordinary attack data", () => {
    const attacks = Object.values(attackProfileCatalog).map((profile) => ({
      id: profile.id,
      name: profile.name,
      attackAbility: "str" as const,
      baseDamage: { count: 1, sides: 6 },
      profileId: profile.id,
    }));
    const value = engine(
      character({ attacks, features: [toggle("power-attack")] }),
    ).derive();
    const byId = Object.fromEntries(
      value.attacks.map((attack) => [
        attack.definition.profileId!.split(".").at(-1),
        attack,
      ]),
    );
    expect(byId["standard-melee"]!.damage.modifier).toBe(10);
    expect(byId["two-handed"]!.damage.modifier).toBe(15);
    expect(byId["off-hand"]!.damage.modifier).toBe(5);
    expect(byId.ranged!.damage.modifier).toBe(0);
    expect(byId.finesse!.attack.value).toBe(7);
    expect(byId.thrown!.damage.modifier).toBe(4);
    expect(byId["natural-secondary"]!.attack.value).toBe(4);
    expect(byId["natural-secondary"]!.fullAttack).toHaveLength(1);
  });

  it("composes typed Heroism and Sickened without treating all skills as initiative", () => {
    const value = engine(
      character({
        skillRanks: { climb: 1 },
        features: [toggle("heroism"), toggle("sickened")],
      }),
    ).derive();
    expect(value.skills.climb!.total.value).toBe(5);
    expect(value.initiative.value).toBe(0); // Sickened applies; Heroism is not an ability-check bonus
    expect(value.saves.fortitude.value).toBe(4);
    expect(value.maxHp.value).toBe(33);
    expect(value.currentHp).toBe(29);
  });

  it("applies repeated catalog definitions once and lets stronger fatigue/fear conditions replace weaker ones", () => {
    const value = engine(
      character({
        features: [
          toggle("haste"),
          { ...toggle("haste"), id: "second-haste" },
          toggle("fatigued"),
          toggle("exhausted"),
          toggle("shaken"),
          toggle("frightened"),
        ],
      }),
    ).derive();
    expect(value.abilities.str.score.value).toBe(12);
    expect(value.abilities.dex.score.value).toBe(8);
    expect(value.movement.value).toBe(30); // Haste then exhausted, once each
    expect(value.saves.will.value).toBe(-1); // one fear penalty
    expect(value.initiative.value).toBe(-3); // DEX −1 and one fear ability-check penalty
  });

  it("keeps sight/hearing-only condition penalties contextual rather than penalizing every Perception check", () => {
    const value = engine(
      character({
        features: [toggle("dazzled"), toggle("deafened")],
        skillRanks: { perception: 1 },
      }),
    ).derive();
    expect(value.skills.perception!.total.value).toBe(1);
    expect(value.initiative.value).toBe(-2);
    expect(value.grants.map((grant) => grant.grant)).toContain(
      "minus-1-sight-based-perception",
    );
    expect(value.grants.map((grant) => grant.grant)).toContain(
      "minus-4-opposed-perception",
    );
  });
});
