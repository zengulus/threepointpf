import type { CharacterInput, ProgressionDefinition } from "@threepointpf/rules-schema";
const choice = (id: string, prompt: string) => ({ id, prompt, minimum: 1, maximum: 1, allowCustom: true, options: [{ id: "fire", name: "Fire" }, { id: "ice", name: "Ice" }] });
const first: ProgressionDefinition = {
  id: "homebrew.test.first", name: "First path", hitDieSides: 8, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 4,
  features: [
    { id: "history", name: "Historical adaptation", level: 1, choices: [choice("choose", "Historical element")] },
    { id: "adaptation", name: "First adaptation", level: 2, choices: [choice("choose", "First element"), choice("second", "Second element")] },
    { id: "specialization", name: "Specialization", level: 2, choices: [choice("choose", "Specialization element")] },
  ],
};
const second: ProgressionDefinition = { ...first, id: "homebrew.test.second", name: "Second path", features: [{ id: "adaptation", name: "Second adaptation", level: 2, choices: [choice("choose", "Other track element")] }] };
export const choiceIsolationCharacter: CharacterInput = {
  id: "choice-isolation-fixture", name: "Choice Isolation Hero", baseAbilities: { str: 14, dex: 12, con: 12, int: 12, wis: 10, cha: 10 }, baseHpBeforeConstitution: 8, baseLandSpeed: 30, baseSize: "medium",
  advancementSlots: [{ id: "level-1", tracks: [{ id: "track-a", entry: { progressionId: first.id } }, { id: "track-b", entry: { progressionId: second.id } }] }],
  lifecycle: { choiceSelections: [{ id: "legacy-history-1-track-a", requirement: { progressionId: first.id, featureId: "history", slotId: "level-1", trackId: "track-a", requirementId: "choose" }, optionIds: ["ice"], note: "Existing player choice" }] },
  customProgressions: { [first.id]: first, [second.id]: second }, skillRanks: {}, skills: {}, attacks: [], equipment: [], features: [], damageTaken: 0, temporaryHp: 0,
};
