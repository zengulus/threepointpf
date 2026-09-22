import { describe, expect, it } from "vitest";
import {
  advancementSlotsSchema,
  abilityInstanceSchema,
  attackDefinitionSchema,
  campaignCharacterProfileSchema,
  characterInputSchema,
  characterLifecycleStateSchema,
  effectSchema,
  isTargetId,
  parseCampaignCharacterProfile,
  parseCharacterLifecycleState,
  progressionCatalogSchema,
  resourceDefinitionSchema,
} from "./index.js";

describe("runtime rules schemas", () => {
  it("accepts stable built-in and dynamic skill/progression/resource target ids", () => { expect(isTargetId("attack.melee")).toBe(true); expect(isTargetId("combat.bab")).toBe(true); expect(isTargetId("skill.knowledge-local")).toBe(true); expect(isTargetId("progression.fighter.level")).toBe(true); expect(isTargetId("resource.ki.maximum")).toBe(true); });
  it("rejects unknown effect target ids", () => expect(() => effectSchema.parse({ kind: "modifier", target: "Strength", value: 4, bonusType: "morale" })).toThrow());
  it("keeps progression-level facts query-only", () => expect(() => effectSchema.parse({ kind: "modifier", target: "progression.fighter.level", value: 1, bonusType: "untyped" })).toThrow(/query-only/));
  it("keeps resource capacity facts query-only", () => expect(() => effectSchema.parse({ kind: "modifier", target: "resource.ki.maximum", value: 1, bonusType: "untyped" })).toThrow(/query-only/));
  it("keeps baseline replacement and Grant distinct from numeric modifiers", () => {
    expect(effectSchema.parse({ kind: "replaceBase", target: "speed.land", value: 40 })).toMatchObject({ kind: "replaceBase", target: "speed.land" });
    expect(effectSchema.parse({ kind: "grant", target: "casterLevel", grant: "spellcasting.slot" })).toMatchObject({ kind: "grant", target: "casterLevel" });
  });
  it("requires explicit applicability for generic AC modifiers", () => {
    expect(() => effectSchema.parse({ kind: "modifier", target: "ac", value: 1, bonusType: "dodge" })).toThrow();
    expect(effectSchema.parse({ kind: "modifier", target: "ac", value: 1, bonusType: "dodge", appliesTo: ["normal", "touch"] })).toMatchObject({ target: "ac", appliesTo: ["normal", "touch"] });
  });
  it("rejects competing active baseline replacements", () => {
    expect(() => characterInputSchema.parse({
      id: "ambiguous", name: "Ambiguous", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseBab: 0,
      baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 8, hitDiceCount: 1, skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0,
      features: [{ id: "a", name: "A", enabled: true, effects: [{ kind: "replaceBase", target: "ac", value: 10 }] }, { id: "b", name: "B", enabled: true, effects: [{ kind: "replaceBase", target: "ac", value: 12 }] }],
    })).toThrow(/Ambiguous active baseline replacements/);
  });
  it("allows advancement mode to replace manual BAB, save, and hit-die baselines", () => {
    expect(characterInputSchema.parse({
      id: "fighter", name: "Fighter", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseHpBeforeConstitution: 10,
      skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0,
      advancementSlots: [{ id: "level-1", tracks: [{ id: "main", entry: { progressionId: "fighter" } }] }], features: [],
    }).advancementSlots).toHaveLength(1);
  });
  it("rejects ambiguous manual baselines and malformed N-track topology in advancement mode", () => {
    const shared = { id: "advanced", name: "Advanced", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseHpBeforeConstitution: 10, skillRanks: {}, attacks: [], damageTaken: 0, temporaryHp: 0, features: [] };
    expect(() => characterInputSchema.parse({ ...shared, baseBab: 1, advancementSlots: [{ id: "level-1", tracks: [{ id: "first", entry: { progressionId: "fighter" } }] }] })).toThrow(/baseBab must be omitted/);
    expect(() => advancementSlotsSchema.parse([
      { id: "level-1", tracks: [{ id: "first", entry: { progressionId: "fighter" } }, { id: "second", entry: { progressionId: "wizard" } }] },
      { id: "level-1", tracks: [{ id: "second", entry: { progressionId: "wizard" } }, { id: "first", entry: { progressionId: "fighter" } }] },
    ])).toThrow(/Duplicate advancement slot id|same ordered track ids/);
  });
  it("validates catalog keys and optional chart rows before rules evaluation", () => {
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "not-fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" } } })).toThrow(/Catalog key/);
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, chart: [{ level: 1, bab: 1, saves: { fortitude: 2, reflex: 0, will: 0 } }, { level: 1, bab: 1, saves: { fortitude: 2, reflex: 0, will: 0 } }] } })).toThrow(/Duplicate chart level/);
    expect(() => progressionCatalogSchema.parse({ fighter: { id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2.5 } })).toThrow();
  });
  it("rejects free-form attack tags", () => expect(() => attackDefinitionSchema.parse({ id: "weapon", name: "Weapon", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, attackTags: ["adds-a-bonus"] })).toThrow());

  it("accepts optional authored lifecycle provenance without changing ordinary character inputs", () => {
    const lifecycle = parseCharacterLifecycleState({
      hpAcquisitions: [
        {
          slotId: "level-1",
          method: "maximum",
          amount: 12,
          policyId: "hp.first-level",
        },
      ],
      skillAllocations: [
        {
          slotId: "level-1",
          method: "policy",
          ranks: { climb: 2, perception: 1 },
        },
      ],
      choiceSelections: [
        {
          id: "troll-adaptation",
          requirement: {
            progressionId: "homebrew.example.troll",
            featureId: "adaptation",
            slotId: "level-1",
            trackId: "monster",
            requirementId: "choose-adaptation",
          },
          optionIds: ["cold-resistance"],
        },
      ],
      overrides: [
        {
          id: "skill-cap-override",
          code: "skill.rank-cap",
          reason: "Campaign training montage.",
          scope: { slotId: "level-1", skillId: "climb" },
        },
      ],
    });
    const parsed = characterInputSchema.parse({
      id: "lifecycle", name: "Lifecycle", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseBab: 0,
      baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 12, hitDiceCount: 1, skillRanks: { climb: 2, perception: 1 }, attacks: [], damageTaken: 0, temporaryHp: 0, features: [], lifecycle,
    });
    expect(parsed.lifecycle).toEqual(lifecycle);
  });

  it("rejects malformed or duplicate lifecycle allocation, selection, and override records", () => {
    expect(() => characterLifecycleStateSchema.parse({
      hpAcquisitions: [
        { slotId: "level-1", method: "rolled", amount: 7 },
        { slotId: "level-1", method: "rolled", amount: 8 },
      ],
    })).toThrow(/Duplicate HP acquisition slot/);
    expect(() => characterLifecycleStateSchema.parse({
      choiceSelections: [{
        id: "empty", requirement: { progressionId: "homebrew.example.troll", featureId: "adaptation", slotId: "level-1", trackId: "monster", requirementId: "choose" }, optionIds: [],
      }],
    })).toThrow(/requires at least one selected option/);
    expect(() => characterLifecycleStateSchema.parse({
      overrides: [
        { id: "same", code: "warning", reason: "One", scope: { slotId: "level-1" } },
        { id: "same", code: "warning", reason: "Two", scope: { slotId: "level-1" } },
      ],
    })).toThrow(/Duplicate lifecycle override id/);
    expect(() => characterLifecycleStateSchema.parse({
      overrides: [{ id: "global", code: "warning", reason: "Too broad", scope: {} }],
    })).toThrow(/override must identify/);
  });

  it("exposes bounded progression-feature choices with semantic options", () => {
    const troll = {
      id: "homebrew.example.troll",
      name: "Troll",
      hitDieSides: 12,
      babProgression: "full",
      saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
      features: [{
        id: "adaptation",
        name: "Adaptation",
        level: 3,
        choices: [{
          id: "choose-adaptation",
          prompt: "Choose an adaptation",
          minimum: 1,
          maximum: 1,
          options: [{
            id: "cold-resistance",
            name: "Cold resistance",
            effects: [{ kind: "modifier", target: "save.fortitude", value: 1, bonusType: "racial" }],
          }],
        }],
      }],
    };
    expect(progressionCatalogSchema.parse({ [troll.id]: troll })[troll.id]?.features?.[0]?.choices?.[0]?.options[0]?.name).toBe("Cold resistance");
    expect(() => progressionCatalogSchema.parse({
      [troll.id]: {
        ...troll,
        features: [{
          ...troll.features[0],
          choices: [
            { id: "duplicate", prompt: "One", minimum: 0, maximum: 0, options: [] },
            { id: "duplicate", prompt: "Two", minimum: 0, maximum: 0, options: [] },
          ],
        }],
      },
    })).toThrow(/Duplicate progression feature choice id/);
  });

  it("models campaign track topology plus explicit HP and skill policies", () => {
    const profile = parseCampaignCharacterProfile({
      id: "gestalt-homebrew",
      name: "Gestalt homebrew",
      startingLevel: 1,
      tracks: [
        { id: "class", name: "Class track" },
        { id: "monster", name: "Monster track" },
      ],
      availableProgressionIds: ["pf1e.paizo.fighter", "homebrew.example.troll"],
      catalogSourceIds: ["pf1e", "campaign-homebrew"],
      allowCustomProgressions: true,
      hpPolicy: {
        firstLevel: { kind: "maximum" },
        laterLevels: { kind: "rolled", minimum: 1, maximum: 12 },
      },
      skillAllocationPolicy: {
        kind: "calculated",
        includeIntelligenceModifier: true,
        minimumPerLevel: 1,
        firstLevelMultiplier: 1,
        rankCap: { kind: "characterLevel", multiplier: 1 },
      },
      allowManualOverrides: true,
    });
    expect(profile.tracks.map((track) => track.id)).toEqual(["class", "monster"]);
    expect(() => campaignCharacterProfileSchema.parse({
      ...profile,
      tracks: [{ id: "same", name: "One" }, { id: "same", name: "Two" }],
    })).toThrow(/Duplicate campaign advancement track id/);
    expect(() => campaignCharacterProfileSchema.parse({
      ...profile,
      hpPolicy: { firstLevel: { kind: "rolled", minimum: 10, maximum: 1 }, laterLevels: { kind: "manual" } },
    })).toThrow(/Rolled HP minimum cannot exceed maximum/);
  });

  it("validates abilities, resource references, refresh rules, and damage dice", () => {
    expect(effectSchema.parse({
      kind: "damageDice",
      target: "damage.melee",
      dice: { count: 3, sides: 6 },
      damageType: "precision",
      criticalBehavior: "notMultiplied",
    })).toMatchObject({ kind: "damageDice", dice: { count: 3, sides: 6 } });
    expect(() => effectSchema.parse({
      kind: "damageDice", target: "attack.melee", dice: { count: 0, sides: 6 }, criticalBehavior: "normal",
    })).toThrow();
    expect(() => abilityInstanceSchema.parse({
      id: "bad-cost", name: "Bad cost", activation: "activated", effects: [], costs: [{ resourceId: "ki", amount: -1 }],
    })).toThrow();
    expect(() => resourceDefinitionSchema.parse({
      id: "breath", name: "Breath", maximum: { kind: "fixed", value: 1 }, refresh: { kind: "interval", rounds: 0 },
    })).toThrow();
    expect(() => characterInputSchema.parse({
      id: "missing-resource", name: "Missing", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      baseBab: 0, baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 1, hitDiceCount: 1,
      skillRanks: {}, attacks: [], features: [], damageTaken: 0, temporaryHp: 0,
      abilities: [{ id: "dash", name: "Dash", activation: "activated", effects: [], costs: [{ resourceId: "ki", amount: 1 }] }],
    })).toThrow(/references missing resource ki/);
  });
});
