import { describe, expect, it } from "vitest";
import type { CharacterInput } from "@threepointpf/rules-schema";
import { InMemoryCharacterRepository } from "./index.js";
import { RulesEngine } from "@threepointpf/rules-core";

const character: CharacterInput = {
  id: "persisted", campaignId: "campaign", name: "Persisted", baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, baseBab: 1,
  baseSaves: { fortitude: 0, reflex: 0, will: 0 }, baseHpBeforeConstitution: 8, currentHp: 8, skillRanks: {}, attacks: [], features: [],
};

it("persist → reload → evaluate keeps authored state and derived state identical", async () => {
  const repository = new InMemoryCharacterRepository(); await repository.save(character); const loaded = await repository.load(character.id);
  expect(loaded).toEqual(character); expect(new RulesEngine(loaded!).derive()).toEqual(new RulesEngine(character).derive());
});
