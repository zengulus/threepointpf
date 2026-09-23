import { describe, expect, it } from "vitest";
import type { CharacterInput, ProgressionCatalog } from "@threepointpf/rules-schema";
import { RulesEngine, type RulesEngineOptions } from "@threepointpf/rules-core";
import { resolveRollPlan } from "@threepointpf/dice";
import {
  createCharacterRollPlan,
  InMemoryCharacterRepository,
  LocalStorageCharacterRepository,
  normalizeAuthoredCharacter,
  rollPlanRequestSchema,
  type StorageLike,
} from "./index.js";

const catalog: ProgressionCatalog = {
  "pf1e.paizo.fighter": {
    id: "pf1e.paizo.fighter", aliases: ["fighter"], name: "Fighter", hitDieSides: 10, babProgression: "full",
    saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2,
  },
  "pf1e.paizo.wizard": {
    id: "pf1e.paizo.wizard", aliases: ["wizard"], name: "Wizard", hitDieSides: 6, babProgression: "half",
    saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" }, skillPointsPerLevel: 2,
  },
  "pf1e.paizo.rogue": {
    id: "pf1e.paizo.rogue", aliases: ["rogue"], name: "Rogue", hitDieSides: 8, babProgression: "threeQuarters",
    saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" }, skillPointsPerLevel: 8,
  },
};

const rules: RulesEngineOptions = {
  progressionCatalog: catalog,
  skillCatalog: {
    acrobatics: { id: "acrobatics", name: "Acrobatics", governingAbility: "dex" },
  },
};

const character: CharacterInput = {
  id: "persisted", campaignId: "campaign", name: "Persisted",
  baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  baseBab: 1, baseSaves: { fortitude: 0, reflex: 0, will: 0 },
  baseHpBeforeConstitution: 8, hitDiceCount: 1, damageTaken: 0, temporaryHp: 0,
  baseSize: "medium", baseSpeeds: { land: 30, swim: 15 }, baseLandSpeed: 30,
  skillRanks: { acrobatics: 1 }, attacks: [], features: [],
  equipment: [{ id: "custom-buckler", name: "Custom buckler", equipped: true, effects: [{ kind: "modifier", target: "ac", value: 1, bonusType: "shield", appliesTo: ["normal", "flatFooted"] }] }],
};

function advancedCharacter(id = "advanced"): CharacterInput {
  return {
    ...character,
    id,
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    advancementSlots: [
      { id: "level-1", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }, { id: "scout", entry: { progressionId: "rogue" } }] },
      { id: "level-2", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }, { id: "scout", entry: { progressionId: "rogue" } }] },
    ],
  };
}

function canonicalSlots(character: CharacterInput) {
  return normalizeAuthoredCharacter(character, rules).advancementSlots;
}

describe("authored-state repositories", () => {
  it("persists, reloads, and evaluates manual authored state without derived fields", async () => {
    const repository = new InMemoryCharacterRepository(rules);
    await repository.save(character);
    const loaded = await repository.load(character.id);
    expect(loaded).toEqual(character);
    expect(new RulesEngine(loaded!, rules).derive()).toEqual(new RulesEngine(character, rules).derive());
  });

  it("canonicalizes legacy aliases in N-track advancement before storing", async () => {
    const advanced = advancedCharacter();
    const repository = new InMemoryCharacterRepository(rules);
    await repository.save(advanced);
    const loaded = await repository.load(advanced.id);
    expect(loaded?.advancementSlots).toEqual(canonicalSlots(advanced));
    expect(new RulesEngine(loaded!, rules).derive().advancement).toMatchObject({
      slotCount: 2,
      trackIds: ["martial", "arcane", "scout"],
      hitDiceCount: 2,
    });
  });

  it("keeps custom progression, equipment, size, and all movement modes across reload", async () => {
    const customId = "homebrew.example.warder";
    const custom: CharacterInput = {
      ...character,
      id: "custom-persistence",
      baseBab: undefined,
      baseSaves: undefined,
      hitDiceCount: undefined,
      customProgressions: {
        [customId]: {
          id: customId,
          aliases: ["warder"],
          name: "Warder",
          hitDieSides: 12,
          babProgression: "full",
          saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
          skillPointsPerLevel: 4,
          classSkills: ["acrobatics"],
        },
      },
      advancementSlots: [{ id: "level-1", tracks: [{ id: "main", entry: { progressionId: "warder" } }] }],
      baseSize: "large",
      baseSpeeds: { land: 40, fly: 60, swim: 20, climb: 20, burrow: 10 },
      baseLandSpeed: undefined,
      equipment: [{ id: "custom-weapon", name: "Custom weapon", equipped: true, attack: { id: "custom-weapon-attack", name: "Custom weapon", attackAbility: "str", baseDamage: { count: 1, sides: 10 }, mode: "melee" } }],
    };
    const repository = new InMemoryCharacterRepository(rules);
    await repository.save(custom);
    const loaded = await repository.load(custom.id);
    expect(loaded).toMatchObject({
      customProgressions: { [customId]: { id: customId } },
      baseSize: "large",
      baseSpeeds: { land: 40, fly: 60, swim: 20, climb: 20, burrow: 10 },
      equipment: [{ id: "custom-weapon", equipped: true }],
      advancementSlots: [{ tracks: [{ entry: { progressionId: customId } }] }],
    });
    const browser = new RulesEngine(loaded!, rules).createAttackRollPlan("equipment.custom-weapon");
    expect(createCharacterRollPlan(loaded!, { characterId: loaded!.id, kind: "attack", attackId: "equipment.custom-weapon" }, rules)).toEqual(browser);
  });

  it("rejects unknown and imported-colliding custom progression ids before a write", async () => {
    const unknown = {
      ...advancedCharacter("unknown-progression"),
      advancementSlots: [{ id: "level-1", tracks: [{ id: "one", entry: { progressionId: "not-in-catalog" } }] }],
    };
    await expect(new InMemoryCharacterRepository(rules).save(unknown)).rejects.toThrow("Unknown progression definition not-in-catalog");

    const colliding: CharacterInput = {
      ...advancedCharacter("colliding-custom"),
      customProgressions: { "pf1e.paizo.fighter": catalog["pf1e.paizo.fighter"]! },
    };
    await expect(new InMemoryCharacterRepository(rules).save(colliding)).rejects.toThrow("Custom progression pf1e.paizo.fighter conflicts");
  });
});

class MemoryStorage implements StorageLike {
  private readonly records = new Map<string, string>();
  getItem(key: string): string | null { return this.records.get(key) ?? null; }
  setItem(key: string, value: string): void { this.records.set(key, value); }
}

it("reloads a local browser draft through a fresh LocalStorage repository", async () => {
  const storage = new MemoryStorage();
  await new LocalStorageCharacterRepository(rules, storage).save(advancedCharacter("local-reload"));
  const loaded = await new LocalStorageCharacterRepository(storage, rules).load("local-reload");
  expect(loaded?.advancementSlots).toEqual(canonicalSlots(advancedCharacter("local-reload")));
});

it("rebuilds a custom advancement attack plan with full rules options for TTS parity", () => {
  const advanced: CharacterInput = {
    ...advancedCharacter("tts-advanced"),
    attacks: [{ id: "sword", name: "Sword", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, mode: "melee" }],
    features: [{ id: "bab-boost", name: "BAB boost", enabled: true, effects: [{ kind: "modifier", target: "combat.bab", value: 1, bonusType: "untyped" }] }],
  };
  const plan = createCharacterRollPlan(advanced, { characterId: advanced.id, kind: "attack", attackId: "sword" }, catalog, rules);
  const canonical = normalizeAuthoredCharacter(advanced, rules);
  expect(plan.modifier).toBe(new RulesEngine(canonical, rules).derive().attacks[0]?.attack.value);
  expect(resolveRollPlan(plan, [17])).toMatchObject({ modifier: plan.modifier, total: 20 });
});

it("validates and preserves a non-first full-attack index through the shared TTS plan boundary", () => {
  const iterative: CharacterInput = {
    ...character,
    id: "tts-full-attack",
    baseBab: 6,
    attacks: [{ id: "sword", name: "Sword", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, mode: "melee" }],
  };
  const request = rollPlanRequestSchema.parse({ characterId: iterative.id, kind: "attack", attackId: "sword", attackIndex: 1 });
  const plan = createCharacterRollPlan(iterative, request, rules);
  expect(plan.context).toMatchObject({
    kind: "attack",
    actorCharacterId: iterative.id,
    attackId: "sword",
    action: { kind: "fullAttack", sequenceIndex: 1 },
  });
  expect(plan.criticalRange).toEqual({ minimumNaturalRoll: 20 });
  expect(plan.modifier).toBe(new RulesEngine(iterative, rules).derive().attacks[0]?.fullAttack[1]?.value);
  expect(() => rollPlanRequestSchema.parse({ characterId: iterative.id, kind: "attack", attackId: "sword", attackIndex: -1 })).toThrow();
  expect(() => rollPlanRequestSchema.parse({ characterId: iterative.id, kind: "save", saveId: "fortitude", attackIndex: 0 })).toThrow();
});
