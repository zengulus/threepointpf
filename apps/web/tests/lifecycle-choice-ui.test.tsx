// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LifecycleWizard } from "../src/components/lifecycle-wizard";
import type { CharacterSheet } from "../src/hooks/useCharacterSheet";
import { choiceIsolationCharacter } from "../../../tests/fixtures/lifecycle-choice-character";

afterEach(cleanup);
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const value = (label: string) => (screen.getByLabelText(label, { exact: true }) as HTMLInputElement).value;
function open(commit = vi.fn().mockResolvedValue(true)) {
  const onClose = vi.fn();
  render(<LifecycleWizard mode="level-up" sheet={{ character: structuredClone(choiceIsolationCharacter), commitLifecycleCharacter: commit } as unknown as CharacterSheet} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "2. Progression" }));
  choose("HP gained", "5");
  fireEvent.click(screen.getByRole("button", { name: "3. Choices" }));
  return { commit, onClose };
}
it("isolates feature/track answers and commits distinct selections after revisiting", async () => {
  const { commit, onClose } = open();
  choose("First element", "fire"); choose("Second element", "ice"); choose("Specialization element", "ice");
  choose("Custom answer for Other track element", "Storm");
  expect(value("First element")).toBe("fire");
  expect(value("Custom answer for First element")).toBe("");
  choose("First element", "");
  expect(value("Specialization element")).toBe("ice");
  choose("First element", "fire");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(value("Second element")).toBe("ice"); expect(value("Custom answer for Other track element")).toBe("Storm");
  fireEvent.click(screen.getByRole("button", { name: "4. Review" }));
  choose("Reason for custom-choice-requires-table-confirmation", "Approved for this test table");
  fireEvent.click(screen.getByRole("button", { name: "Accept this warning" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm level up" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  const saved = commit.mock.calls[0]![0];
  expect(commit).toHaveBeenCalledTimes(1);
  expect(saved.lifecycle.choiceSelections).toHaveLength(5);
  expect(saved.lifecycle.choiceSelections.map((selection: { optionIds: string[] }) => selection.optionIds)).toEqual([["ice"], ["ice"], ["ice"], [], ["fire"]]);
  expect(saved.lifecycle.choiceSelections.find((selection: { customOptions?: { name: string }[] }) => selection.customOptions?.length)?.customOptions).toEqual([{ id: "custom-choose", name: "Storm" }]);
  expect(saved.lifecycle.choiceSelections[0]).toEqual(choiceIsolationCharacter.lifecycle!.choiceSelections![0]);
  expect(new Set(saved.lifecycle.choiceSelections.map((selection: { id: string }) => selection.id)).size).toBe(5);
});
it("canceling partial answers never commits and reopening starts clean", () => {
  const { commit, onClose } = open(); choose("Custom answer for First element", "Abandoned");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
  cleanup(); open(); expect(value("Custom answer for First element")).toBe(""); expect(value("Other track element")).toBe("");
});
