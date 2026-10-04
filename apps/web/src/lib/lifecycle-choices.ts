import type { ChoiceRequirementReference, ChoiceSelection } from "@threepointpf/rules-schema";

/** Content-owned IDs can repeat across classes, features, slots, and tracks. */
export function lifecycleChoiceKey(reference: ChoiceRequirementReference): string {
  return JSON.stringify([
    reference.progressionId, reference.featureId, reference.slotId,
    reference.trackId, reference.requirementId,
  ]);
}

/** Replace only the answer to this exact requirement, preserving all others. */
export function updateLifecycleChoice(
  selections: readonly ChoiceSelection[],
  reference: ChoiceRequirementReference,
  optionIds: string[],
  customAnswer: string,
): ChoiceSelection[] {
  const key = lifecycleChoiceKey(reference);
  const existing = selections.find((selection) => lifecycleChoiceKey(selection.requirement) === key);
  const others = selections.filter((selection) => lifecycleChoiceKey(selection.requirement) !== key);
  const answer = customAnswer.trim();
  if (!optionIds.length && !answer) return others;
  return [...others, {
    id: existing?.id ?? `choice-${encodeURIComponent(key)}`,
    requirement: reference,
    optionIds: [...optionIds],
    ...(answer ? { customOptions: [{ id: `custom-${reference.requirementId}`, name: answer }] } : {}),
  }];
}
