import { describe, expect, it } from "vitest";
import type {
  CampaignCharacterProfile,
  CharacterInput,
  ProgressionCatalog,
} from "@threepointpf/rules-schema";
import {
  RulesEngine,
  acceptLifecycleWarning,
  beginAdvancement,
  beginCharacterCreation,
  commitAdvancement,
  commitCharacterCreation,
  previewAdvancement,
  previewCharacterCreation,
  proposeAdvancement,
  proposeCharacterCreation,
  progressionChoicesForCampaign,
  validateAdvancement,
  validateCharacterCreation,
} from "./index.js";

const catalog: ProgressionCatalog = {
  "pf1e.table.fighter": {
    id: "pf1e.table.fighter",
    name: "Fighter",
    hitDieSides: 10,
    babProgression: "full",
    saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
    skillPointsPerLevel: 2,
  },
  "pf1e.table.wizard": {
    id: "pf1e.table.wizard",
    name: "Wizard",
    hitDieSides: 6,
    babProgression: "half",
    saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" },
    skillPointsPerLevel: 2,
  },
  "pf1e.table.rogue": {
    id: "pf1e.table.rogue",
    name: "Rogue",
    hitDieSides: 8,
    babProgression: "threeQuarters",
    saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" },
    skillPointsPerLevel: 8,
  },
};

const troll = {
  "homebrew.table.troll": {
    id: "homebrew.table.troll",
    name: "Troll",
    hitDieSides: 12,
    babProgression: "threeQuarters" as const,
    saveProgressions: {
      fortitude: "good" as const,
      reflex: "poor" as const,
      will: "poor" as const,
    },
    skillPointsPerLevel: 4,
    features: [
      {
        id: "regeneration",
        name: "Regeneration",
        level: 1,
        description: "Regeneration is a monster progression feature.",
      },
      {
        id: "adaptation",
        name: "Troll adaptation",
        level: 2,
        choices: [
          {
            id: "adaptation-choice",
            prompt: "Choose an adaptation",
            minimum: 1,
            maximum: 1,
            options: [
              {
                id: "cold-resistant",
                name: "Cold-resistant hide",
                effects: [
                  {
                    kind: "modifier" as const,
                    target: "save.fortitude" as const,
                    value: 1,
                    bonusType: "racial" as const,
                  },
                ],
              },
              {
                id: "swift-hide",
                name: "Swift hide",
                effects: [
                  {
                    kind: "modifier" as const,
                    target: "save.reflex" as const,
                    value: 1,
                    bonusType: "racial" as const,
                  },
                ],
              },
            ],
            allowCustom: true,
          },
        ],
      },
    ],
  },
} satisfies ProgressionCatalog;

const rules = { progressionCatalog: catalog };

function profile(
  tracks: CampaignCharacterProfile["tracks"],
  overrides: Partial<CampaignCharacterProfile> = {},
): CampaignCharacterProfile {
  return {
    id: "campaign.lifecycle",
    startingLevel: 1,
    tracks,
    hpPolicy: {
      firstLevel: { kind: "maximum" },
      laterLevels: { kind: "manual" },
    },
    skillAllocationPolicy: {
      kind: "calculated",
      includeIntelligenceModifier: true,
      minimumPerLevel: 1,
    },
    allowManualOverrides: true,
    ...overrides,
  };
}

function baseCharacterFields(
  extra: Partial<CharacterInput> = {},
): Partial<CharacterInput> {
  return {
    id: "lifecycle-hero",
    name: "Lifecycle Hero",
    baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...extra,
  };
}

function createLevelOne(
  campaign: CampaignCharacterProfile,
  selections: Array<{ trackId: string; progressionId: string }>,
  character: Partial<CharacterInput> = {},
) {
  return proposeCharacterCreation(
    beginCharacterCreation(campaign, rules),
    {
      character: baseCharacterFields(character),
      progressionSelections: selections.map((selection) => ({
        ...selection,
        level: 1,
      })),
      skillAllocations: [{ level: 1, ranks: {} }],
    },
  );
}

describe("character lifecycle domain", () => {
  it("fails closed when a campaign allow-list references unknown content", () => {
    const campaign = profile([{ id: "main", name: "Main track" }], {
      availableProgressionIds: ["pf1e.table.typo"],
    });
    expect(progressionChoicesForCampaign(campaign, rules)).toEqual([]);

    const proposal = createLevelOne(campaign, [
      { trackId: "main", progressionId: "pf1e.table.fighter" },
    ]);
    expect(validateCharacterCreation(proposal)).toMatchObject({
      valid: false,
      canCommit: false,
    });
    expect(validateCharacterCreation(proposal).errors.map((issue) => issue.code)).toContain(
      "campaign-profile-references-unknown-progression",
    );
  });

  it("creates an ordinary single-track CharacterInput from an empty proposal", () => {
    const campaign = profile([{ id: "main", name: "Main track" }]);
    const proposal = createLevelOne(campaign, [
      { trackId: "main", progressionId: "pf1e.table.fighter" },
    ]);

    expect(validateCharacterCreation(proposal)).toMatchObject({
      valid: true,
      canCommit: true,
    });
    const preview = previewCharacterCreation(proposal);
    expect(preview.after?.advancement?.slotCount).toBe(1);
    expect(preview.hp[0]).toMatchObject({ amount: 10, winningHitDie: { sides: 10 } });
    expect(preview.skills[0]).toMatchObject({ available: 2, allocated: 0, remaining: 2 });

    const character = commitCharacterCreation(proposal);
    expect(character.advancementSlots).toEqual([
      {
        id: "level-1",
        tracks: [{ id: "main", entry: { progressionId: "pf1e.table.fighter" } }],
      },
    ]);
    expect(character.baseHpBeforeConstitution).toBe(10);
    expect(character.lifecycle?.hpAcquisitions?.[0]).toMatchObject({
      slotId: "level-1",
      method: "maximum",
      amount: 10,
      source: { trackId: "main", progressionId: "pf1e.table.fighter", sides: 10 },
    });
    expect(character.lifecycle?.skillAllocations?.[0]).toMatchObject({
      slotId: "level-1",
      source: { trackId: "main", progressionId: "pf1e.table.fighter", skillPoints: 2 },
      budget: 2,
    });
    expect(new RulesEngine(character, rules).derive().bab.value).toBe(1);
  });

  it("creates a gestalt character through the same slots and preserves best-track semantics", () => {
    const campaign = profile([
      { id: "martial", name: "Martial" },
      { id: "skill", name: "Skill" },
    ]);
    const proposal = createLevelOne(campaign, [
      { trackId: "martial", progressionId: "pf1e.table.fighter" },
      { trackId: "skill", progressionId: "pf1e.table.rogue" },
    ]);
    const character = commitCharacterCreation(proposal);
    const derived = new RulesEngine(character, rules).derive();

    expect(character.advancementSlots?.[0]?.tracks).toHaveLength(2);
    expect(derived.bab.value).toBe(1);
    expect(derived.saves.fortitude.value).toBe(2);
    expect(derived.saves.reflex.value).toBe(2);
    expect(derived.advancement).toMatchObject({ hitDieSides: [10], skillPoints: 8 });
    expect(previewCharacterCreation(proposal).skills[0]).toMatchObject({
      winningChassis: { trackId: "skill", progressionId: "pf1e.table.rogue" },
      available: 8,
    });
  });

  it("levels up gestalt immutably and credits a cross-track continuation globally", () => {
    const campaign = profile([
      { id: "first", name: "First" },
      { id: "second", name: "Second" },
    ]);
    const original = commitCharacterCreation(
      createLevelOne(campaign, [
        { trackId: "first", progressionId: "pf1e.table.fighter" },
        { trackId: "second", progressionId: "pf1e.table.wizard" },
      ]),
    );
    const proposed = proposeAdvancement(beginAdvancement(original, campaign, rules), {
      progressionChoices: {
        first: "pf1e.table.wizard",
        second: "pf1e.table.fighter",
      },
      hpAcquisition: { amount: 7 },
      skillAllocation: { ranks: { climb: 1 } },
    });

    expect(original.advancementSlots).toHaveLength(1);
    const preview = previewAdvancement(proposed);
    expect(preview.before?.advancement?.slotCount).toBe(1);
    expect(preview.after?.advancement?.slotCount).toBe(2);
    expect(preview.changes.some((change) => change.kind === "progression" && change.label.includes("Fighter 1 → 2"))).toBe(true);
    expect(preview.hp).toMatchObject({ amount: 7, winningHitDie: { sides: 10, trackId: "second" } });

    const advanced = commitAdvancement(proposed);
    expect(original.advancementSlots).toHaveLength(1);
    expect(advanced.advancementSlots).toHaveLength(2);
    const derived = new RulesEngine(advanced, rules).derive();
    expect(derived.advancement?.progressionLevels["pf1e.table.fighter"]?.value).toBe(2);
    expect(derived.advancement?.progressionLevels["pf1e.table.wizard"]?.value).toBe(2);
  });

  it("uses custom monster progressions and feature choices without a separate rules path", () => {
    const campaign = profile([
      { id: "class", name: "Class" },
      { id: "monster", name: "Monster" },
    ]);
    const creation = createLevelOne(
      campaign,
      [
        { trackId: "class", progressionId: "pf1e.table.fighter" },
        { trackId: "monster", progressionId: "homebrew.table.troll" },
      ],
      { customProgressions: troll },
    );
    // The ordinary injected catalog and character-owned custom catalog are
    // composed by the same evaluator.
    const character = commitCharacterCreation(creation);
    const advancedWithoutChoice = proposeAdvancement(
      beginAdvancement(character, campaign, rules),
      {
        progressionChoices: {
          class: "pf1e.table.fighter",
          monster: "homebrew.table.troll",
        },
        hpAcquisition: { amount: 8 },
        skillAllocation: { ranks: {} },
      },
    );
    const missing = validateAdvancement(advancedWithoutChoice);
    expect(missing.errors.map((issue) => issue.code)).toContain("feature-choice-required");
    const missingPreview = previewAdvancement(advancedWithoutChoice);
    expect(missingPreview.hp).toMatchObject({
      amount: 8,
      winningHitDie: { sides: 12, trackId: "monster", progressionId: "homebrew.table.troll" },
    });
    const featureRequirement = missingPreview.requirements.find(
      (requirement) => requirement.kind === "feature",
    );
    if (!featureRequirement || featureRequirement.kind !== "feature")
      throw new Error("Expected Troll adaptation choice requirement");
    const completed = proposeAdvancement(advancedWithoutChoice, {
      choiceSelections: [
        {
          id: "troll-adaptation-level-2",
          requirement: featureRequirement.reference,
          optionIds: ["cold-resistant"],
        },
      ],
    });
    const advanced = commitAdvancement(completed);
    expect(advanced.features.some((feature) => feature.name === "Cold-resistant hide")).toBe(true);
    const derived = new RulesEngine(advanced, rules).derive();
    expect(derived.saves.fortitude.value).toBe(4);
    expect(derived.advancement?.features.find((feature) => feature.id === "adaptation")?.choices?.[0]?.prompt).toBe("Choose an adaptation");

    const revised = commitAdvancement(
      proposeAdvancement(beginAdvancement(advanced, campaign, rules), {
        progressionChoices: {
          class: "pf1e.table.fighter",
          monster: "homebrew.table.troll",
        },
        hpAcquisition: { amount: 8 },
        skillAllocation: { ranks: {} },
        choiceSelections: [
          {
            id: "troll-adaptation-level-2",
            requirement: featureRequirement.reference,
            optionIds: ["swift-hide"],
          },
        ],
      }),
    );
    expect(revised.features.some((feature) => feature.name === "Cold-resistant hide")).toBe(false);
    expect(revised.features.some((feature) => feature.name === "Swift hide")).toBe(true);
    const revisedDerived = new RulesEngine(revised, rules).derive();
    expect(revisedDerived.saves.reflex.value).toBe(2);
    expect(revisedDerived.saves.fortitude.value).toBe(3);
  });

  it("does not hard-code gestalt: three tracks choose one HD and one skill chassis per slot", () => {
    const campaign = profile([
      { id: "martial", name: "Martial" },
      { id: "arcane", name: "Arcane" },
      { id: "skill", name: "Skill" },
    ]);
    const proposal = createLevelOne(campaign, [
      { trackId: "martial", progressionId: "pf1e.table.fighter" },
      { trackId: "arcane", progressionId: "pf1e.table.wizard" },
      { trackId: "skill", progressionId: "pf1e.table.rogue" },
    ]);
    const preview = previewCharacterCreation(proposal);
    expect(preview.hp[0]?.winningHitDie).toMatchObject({ sides: 10, trackId: "martial" });
    expect(preview.skills[0]?.winningChassis).toMatchObject({ skillPoints: 8, trackId: "skill" });
    expect(commitCharacterCreation(proposal).advancementSlots?.[0]?.tracks).toHaveLength(3);
  });

  it("records an automatic fixed later-level HP policy while manual policies remain available", () => {
    const campaign = profile(
      [{ id: "main", name: "Main" }],
      {
        hpPolicy: {
          firstLevel: { kind: "maximum" },
          laterLevels: { kind: "fixed", amount: 6 },
        },
      },
    );
    const original = commitCharacterCreation(
      createLevelOne(campaign, [
        { trackId: "main", progressionId: "pf1e.table.fighter" },
      ]),
    );
    const proposed = proposeAdvancement(beginAdvancement(original, campaign, rules), {
      progressionChoices: { main: "pf1e.table.fighter" },
      skillAllocation: { ranks: {} },
    });
    expect(previewAdvancement(proposed).hp).toMatchObject({ amount: 6, acquisition: { method: "fixed" } });
    expect(commitAdvancement(proposed).lifecycle?.hpAcquisitions?.[1]).toMatchObject({
      method: "fixed",
      amount: 6,
    });
  });

  it("returns structured skill policy warnings that require a scoped override, without weakening errors", () => {
    const campaign = profile([{ id: "main", name: "Main" }]);
    const excessive = createLevelOne(campaign, [
      { trackId: "main", progressionId: "pf1e.table.rogue" },
    ]);
    const withTooManyRanks = proposeCharacterCreation(excessive, {
      skillAllocations: [{ level: 1, ranks: { stealth: 9 } }],
    });
    const validation = validateCharacterCreation(withTooManyRanks);
    expect(validation.errors).toEqual([]);
    expect(validation.canCommit).toBe(false);
    const warning = validation.warnings.find(
      (issue) => issue.code === "skill-allocation-exceeds-budget",
    );
    if (!warning) throw new Error("Expected skill budget warning");
    const accepted = proposeCharacterCreation(withTooManyRanks, {
      overrides: [
        acceptLifecycleWarning("allow-extra-stealth", warning, "Campaign training montage"),
      ],
    });
    expect(validateCharacterCreation(accepted)).toMatchObject({ canCommit: true });
    expect(commitCharacterCreation(accepted).lifecycle?.overrides?.[0]).toMatchObject({
      code: "skill-allocation-exceeds-budget",
      reason: "Campaign training montage",
    });

    const structurallyBroken = proposeCharacterCreation(accepted, {
      progressionSelections: [
        { level: 1, trackId: "main", progressionId: "homebrew.table.missing" },
      ],
    });
    expect(validateCharacterCreation(structurallyBroken).canCommit).toBe(false);
    expect(() => commitCharacterCreation(structurallyBroken)).toThrow(/Cannot commit/);
  });
});
