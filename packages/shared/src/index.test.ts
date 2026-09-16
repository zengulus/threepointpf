import { describe, expect, it } from "vitest";
import type { CharacterInput, ProgressionCatalog } from "@threepointpf/rules-schema";
import { createCharacterRollPlan, InMemoryCharacterRepository, SupabaseCharacterRepository } from "./index.js";
import { RulesEngine } from "@threepointpf/rules-core";
import { resolveRollPlan } from "@threepointpf/dice";

const catalog: ProgressionCatalog = {
  fighter: { id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2 },
  wizard: { id: "wizard", name: "Wizard", hitDieSides: 6, babProgression: "half", saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" }, skillPointsPerLevel: 2 },
  rogue: { id: "rogue", name: "Rogue", hitDieSides: 8, babProgression: "threeQuarters", saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" }, skillPointsPerLevel: 8 },
};

const character: CharacterInput = {
  id: "persisted", campaignId: "campaign", name: "Persisted", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseBab: 1,
  baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 8, hitDiceCount: 1, damageTaken: 0, temporaryHp: 0, skillRanks: {}, attacks: [], features: [],
};

it("persist → reload → evaluate keeps authored state and derived state identical", async () => {
  const repository = new InMemoryCharacterRepository(); await repository.save(character); const loaded = await repository.load(character.id);
  expect(loaded).toEqual(character); expect(new RulesEngine(loaded!).derive()).toEqual(new RulesEngine(character).derive());
});

it("persists and reloads ordered N-track advancement slots without manual baselines", async () => {
  const advanced: CharacterInput = {
    ...character,
    id: "advanced",
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    advancementSlots: [
      { id: "level-1", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }, { id: "scout", entry: { progressionId: "rogue" } }] },
      { id: "level-2", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }, { id: "scout", entry: { progressionId: "rogue" } }] },
    ],
  };
  const repository = new InMemoryCharacterRepository(catalog); await repository.save(advanced); const loaded = await repository.load(advanced.id);
  expect(loaded).toEqual(advanced);
  expect(new RulesEngine(loaded!, { progressionCatalog: catalog }).derive().advancement).toMatchObject({ slotCount: 2, trackIds: ["martial", "arcane", "scout"], hitDiceCount: 2 });
});

class FakeSupabase {
  readonly rows: { characters: any; features: any[]; attacks: any[] } = { characters: null, features: [], attacks: [] };

  from(table: string): any {
    if (table === "campaigns") return { upsert: async () => ({ error: null }) };
    if (table === "characters") return {
      upsert: async (row: any) => { this.rows.characters = structuredClone(row); return { error: null }; },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: this.rows.characters, error: null }) }) }),
    };
    if (table === "character_features") return {
      delete: () => ({ eq: async () => { this.rows.features = []; return { error: null }; } }),
      insert: async (rows: any[]) => { this.rows.features = structuredClone(rows); return { error: null }; },
      select: () => ({ eq: async () => ({ data: structuredClone(this.rows.features), error: null }) }),
    };
    if (table === "character_attacks") return {
      delete: () => ({ eq: async () => { this.rows.attacks = []; return { error: null }; } }),
      insert: async (rows: any[]) => { this.rows.attacks = structuredClone(rows); return { error: null }; },
      select: () => ({ eq: async () => ({ data: structuredClone(this.rows.attacks), error: null }) }),
    };
    throw new Error(`Unexpected table ${table}`);
  }
}

it("writes only canonical authored advancement state through the Supabase repository", async () => {
  const advanced: CharacterInput = {
    ...character,
    id: "supabase-advanced",
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    advancementSlots: [
      { id: "level-1", tracks: [{ id: "one", entry: { progressionId: "fighter" } }, { id: "two", entry: { progressionId: "wizard" } }] },
      { id: "level-2", tracks: [{ id: "one", entry: { progressionId: "fighter" } }, { id: "two", entry: { progressionId: "wizard" } }] },
    ],
  };
  const client = new FakeSupabase();
  const repository = new SupabaseCharacterRepository(client, catalog);
  await repository.save(advanced);
  expect(client.rows.characters).toMatchObject({ id: advanced.id, base_bab: null, base_saves: null, hit_dice_count: null, advancement_slots: advanced.advancementSlots });
  expect(client.rows.characters).not.toHaveProperty("bab");
  expect(await repository.load(advanced.id)).toEqual({ ...advanced, baseLandSpeed: 30, skills: {} });
});

it("rejects unknown advancement progression ids before either repository writes", async () => {
  const invalid: CharacterInput = {
    ...character,
    id: "unknown-progression",
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    advancementSlots: [{ id: "level-1", tracks: [{ id: "track-1", entry: { progressionId: "not-in-catalog" } }] }],
  };
  const memory = new InMemoryCharacterRepository(catalog);
  await expect(memory.save(invalid)).rejects.toThrow("Unknown progression definition not-in-catalog");
  expect(await memory.load(invalid.id)).toBeNull();

  const client = new FakeSupabase();
  await expect(new SupabaseCharacterRepository(client, catalog).save(invalid)).rejects.toThrow("Unknown progression definition not-in-catalog");
  expect(client.rows.characters).toBeNull();
});

it("builds the advancement-derived roll plan used by the TTS raw-face contract", () => {
  const advanced: CharacterInput = {
    ...character,
    id: "tts-advanced",
    baseBab: undefined,
    baseSaves: undefined,
    hitDiceCount: undefined,
    baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    advancementSlots: [
      { id: "level-1", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }] },
      { id: "level-2", tracks: [{ id: "martial", entry: { progressionId: "fighter" } }, { id: "arcane", entry: { progressionId: "wizard" } }] },
    ],
    attacks: [{ id: "sword", name: "Sword", attackAbility: "str", baseDamage: { count: 1, sides: 8 }, mode: "melee" }],
    features: [{ id: "bab-boost", name: "BAB boost", enabled: true, effects: [{ kind: "modifier", target: "combat.bab", value: 1, bonusType: "untyped" }] }],
  };
  const plan = createCharacterRollPlan(advanced, { characterId: advanced.id, kind: "attack", attackId: "sword" }, catalog);
  expect(plan.modifier).toBe(new RulesEngine(advanced, { progressionCatalog: catalog }).derive().attacks[0]?.attack.value);
  expect(resolveRollPlan(plan, [17])).toMatchObject({ modifier: plan.modifier, total: 20 });
});
