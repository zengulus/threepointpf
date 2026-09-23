import { describe, expect, it } from "vitest";
import { InMemoryCharacterRepository } from "@threepointpf/shared";
import type { CharacterInput } from "@threepointpf/rules-schema";

describe("ability and resource persistence", () => {
  it("round-trips authored definitions separately from mutable usage", async () => {
    const character: CharacterInput = {
      id: "resource-roundtrip",
      name: "Resource Roundtrip",
      baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10 },
      baseBab: 1,
      baseSaves: { fortitude: 0, reflex: 0, will: 2 },
      baseHpBeforeConstitution: 8,
      hitDiceCount: 1,
      skillRanks: {},
      attacks: [],
      features: [],
      resources: [{
        id: "ki",
        name: "Ki Pool",
        maximum: { kind: "derived", base: 1, terms: [{ kind: "abilityModifier", ability: "wis", source: "base" }] },
        refresh: { kind: "daily" },
      }],
      resourceStates: [{ resourceId: "ki", spent: 2 }],
      abilities: [{
        id: "ki-strike",
        name: "Ki Strike",
        activation: "activated",
        effects: [{ kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 6 }, damageType: "force", criticalBehavior: "normal" }],
        costs: [{ resourceId: "ki", amount: 1, timing: "onUse" }],
      }],
      damageTaken: 0,
      temporaryHp: 0,
    };
    const repository = new InMemoryCharacterRepository();
    await repository.save(character);
    const loaded = await repository.load(character.id);
    expect(loaded).toEqual(character);
    expect(loaded?.abilities?.[0]?.costs?.[0]?.resourceId).toBe("ki");
    expect(loaded?.abilities?.[0]?.costs?.[0]?.timing).toBe("onUse");
    expect(loaded?.resources?.[0]?.maximum).toMatchObject({ terms: [{ source: "base" }] });
    expect(loaded?.resourceStates?.[0]?.spent).toBe(2);
  });

  it("keeps legacy characters valid without adding synthetic collections", async () => {
    const legacy: CharacterInput = {
      id: "legacy-no-abilities",
      name: "Legacy",
      baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      baseBab: 0,
      baseSaves: { fortitude: 0, reflex: 0, will: 0 },
      baseHpBeforeConstitution: 4,
      hitDiceCount: 1,
      skillRanks: {},
      attacks: [],
      features: [],
      damageTaken: 0,
      temporaryHp: 0,
    };
    const repository = new InMemoryCharacterRepository();
    await repository.save(legacy);
    expect(await repository.load(legacy.id)).toEqual(legacy);
  });
});
