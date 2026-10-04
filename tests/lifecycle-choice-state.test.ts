import { describe, expect, it } from "vitest";
import type { ChoiceRequirementReference } from "@threepointpf/rules-schema";
import { lifecycleChoiceKey, updateLifecycleChoice } from "../apps/web/src/lib/lifecycle-choices";

const base: ChoiceRequirementReference = { progressionId: "homebrew.test", featureId: "adaptation", slotId: "level-2", trackId: "track-a", requirementId: "choose" };

describe("lifecycle choice identity", () => {
  it("keeps repeated content IDs independent across every provenance field", () => {
    const references = [base, ...Object.keys(base).map((field) => ({ ...base, [field]: `${base[field as keyof typeof base]}-other` }))];
    const selections = references.reduce((current, reference, index) => updateLifecycleChoice(current, reference, [`option-${index}`], `Answer ${index}`), [] as ReturnType<typeof updateLifecycleChoice>);
    expect(new Set(selections.map((selection) => selection.id)).size).toBe(references.length);
    expect(new Set(references.map(lifecycleChoiceKey)).size).toBe(references.length);
    expect(selections.map((selection) => selection.optionIds)).toEqual(references.map((_, index) => [`option-${index}`]));
    expect(selections.map((selection) => selection.customOptions?.[0]?.name)).toEqual(references.map((_, index) => `Answer ${index}`));
  });

  it("updates, clears, and reselects one requirement without losing another answer", () => {
    const other = { ...base, featureId: "other-feature" };
    const initial = updateLifecycleChoice(updateLifecycleChoice([], base, ["first"], ""), other, [], " Homebrew answer ");
    const original = structuredClone(initial);
    const updated = updateLifecycleChoice(initial, base, ["replacement"], "Named option");
    expect(updated.find((selection) => lifecycleChoiceKey(selection.requirement) === lifecycleChoiceKey(base))?.id).toBe(initial[0]?.id);
    const cleared = updateLifecycleChoice(updated, base, [], "  ");
    expect(cleared).toEqual([initial[1]]);
    expect(updateLifecycleChoice(cleared, base, ["again"], "")).toHaveLength(2);
    expect(initial).toEqual(original);
  });

  it("preserves an existing selection ID and does not alias delimiter-containing IDs", () => {
    const first = { ...base, featureId: "one:two", requirementId: "three" };
    const second = { ...base, featureId: "one", requirementId: "two:three" };
    expect(lifecycleChoiceKey(first)).not.toBe(lifecycleChoiceKey(second));
    expect(updateLifecycleChoice([{ id: "legacy-selection", requirement: base, optionIds: ["old"] }], base, ["new"], "")[0]?.id).toBe("legacy-selection");
  });
});
