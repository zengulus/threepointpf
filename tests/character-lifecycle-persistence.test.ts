import { describe, expect, it } from "vitest";
import type { CampaignCharacterProfile, ProgressionCatalog } from "@threepointpf/rules-schema";
import {
  beginCharacterCreation,
  commitCharacterCreation,
  proposeCharacterCreation,
} from "@threepointpf/rules-core";
import { InMemoryCharacterRepository } from "@threepointpf/shared";

const catalog: ProgressionCatalog = {
  "homebrew.table.stoneborn": {
    id: "homebrew.table.stoneborn",
    name: "Stoneborn",
    hitDieSides: 12,
    babProgression: "full",
    saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
    skillPointsPerLevel: 4,
  },
};

const profile: CampaignCharacterProfile = {
  id: "campaign.persistence",
  startingLevel: 1,
  tracks: [{ id: "main", name: "Main" }],
  hpPolicy: {
    firstLevel: { kind: "maximum" },
    laterLevels: { kind: "manual" },
  },
  skillAllocationPolicy: {
    kind: "calculated",
    includeIntelligenceModifier: true,
  },
};

describe("lifecycle persistence boundary", () => {
  it("commits a normal CharacterInput that the existing repository saves and reloads", async () => {
    const proposal = proposeCharacterCreation(
      beginCharacterCreation(profile, { progressionCatalog: catalog }),
      {
        character: {
          id: "stoneborn-hero",
          name: "Stoneborn Hero",
          baseAbilities: { str: 12, dex: 10, con: 14, int: 12, wis: 10, cha: 8 },
          attacks: [],
          features: [],
          damageTaken: 0,
          temporaryHp: 0,
        },
        progressionSelections: [
          {
            level: 1,
            trackId: "main",
            progressionId: "homebrew.table.stoneborn",
          },
        ],
        skillAllocations: [{ level: 1, ranks: { climb: 1 } }],
      },
    );
    const authored = commitCharacterCreation(proposal);
    const repository = new InMemoryCharacterRepository({ progressionCatalog: catalog });

    await repository.save(authored);
    const loaded = await repository.load(authored.id);

    expect(loaded).toEqual(authored);
    expect(loaded?.lifecycle?.hpAcquisitions?.[0]).toMatchObject({
      amount: 12,
      source: { progressionId: "homebrew.table.stoneborn", sides: 12 },
    });
  });
});
