// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CharacterInput } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../apps/web/src/hooks/useCharacterSheet";
import { CharacterDefenseInputs, CharacterIdentityPanel, CharacterNotesPanel } from "../apps/web/src/components/character-record";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";

afterEach(cleanup);
const field = (label: string) => screen.getByLabelText(label, { exact: true }) as HTMLTextAreaElement;
function type(label: string, text: string) {
  for (const character of text) {
    const input = field(label);
    fireEvent.change(input, { target: { value: input.value + character } });
  }
}
function open() {
  const save = vi.fn();
  function Harness() {
    const [character, setCharacter] = useState<CharacterInput>(() => ({ ...structuredClone(levelOneFighter), record: {}, defenses: {} }));
    const [visible, setVisible] = useState(true);
    const update = (patch: Partial<CharacterInput>) => {
      setCharacter((current) => ({ ...current, ...patch }));
      return true;
    };
    const sheet = { character, update } as unknown as CharacterSheet;
    return <>
      {visible && <><CharacterIdentityPanel sheet={sheet} /><CharacterDefenseInputs sheet={sheet} /><CharacterNotesPanel character={character} update={update} /></>}
      <button onClick={() => save(character)}>Save test snapshot</button>
      <button onClick={() => setVisible((current) => !current)}>Toggle panel</button>
      <button onClick={() => setCharacter((current) => ({ ...current, id: "different-character" }))}>Switch character</button>
      <button onClick={() => update({ record: { languages: ["Goblin"] } })}>Replace languages</button>
    </>;
  }
  render(<Harness />);
  const snapshot = () => { fireEvent.click(screen.getByRole("button", { name: "Save test snapshot" })); return save.mock.calls.at(-1)![0] as CharacterInput; };
  return { snapshot };
}

it.each([
  ["languages", "Languages"], ["traits", "Traits"], ["drawbacks", "Drawbacks"],
  ["racialFeatures", "Racial features"], ["classFeatures", "Class features"], ["feats", "Feats"],
] as const)("allows Enter and spaces while typing %s, with canonical snapshot data", (key, title) => {
  const { snapshot } = open();
  const label = `${title} (one per line)`;
  type(label, "First item\n");
  expect(field(label).value).toBe("First item\n");
  type(label, "Second item\n\n");
  expect(field(label).value).toBe("First item\nSecond item\n\n");
  expect(snapshot().record?.[key]).toEqual(["First item", "Second item"]);
  fireEvent.blur(field(label));
  expect(field(label).value).toBe("First item\nSecond item");
});

it("preserves immunity list typing and removes empty lines from saved data", () => {
  const { snapshot } = open(); const label = "Energy immunities (one per line)";
  type(label, "fire\ncold\n");
  expect(field(label).value).toBe("fire\ncold\n");
  expect(snapshot().defenses?.energyImmunities).toEqual(["fire", "cold"]);
  fireEvent.change(field(label), { target: { value: "\n  \n" } });
  expect(snapshot().defenses?.energyImmunities).toEqual([]);
  fireEvent.blur(field(label)); expect(field(label).value).toBe("");
});

it("keeps live canonical changes across panel dismissal and re-entry", () => {
  const { snapshot } = open(); const label = "Languages (one per line)";
  fireEvent.change(field(label), { target: { value: "  Common  \r\n\r\n  Sign language \r\n" } });
  expect(snapshot().record?.languages).toEqual(["Common", "Sign language"]);
  fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
  expect(field(label).value).toBe("Common\nSign language");
});

it("does not carry a raw list draft to a different character or overwrite replacement data", () => {
  open(); const label = "Languages (one per line)";
  type(label, "Common\n");
  fireEvent.click(screen.getByRole("button", { name: "Switch character" }));
  expect(field(label).value).toBe("Common");
  type(label, "\nElven\n");
  fireEvent.click(screen.getByRole("button", { name: "Replace languages" }));
  expect(field(label).value).toBe("Goblin");
  fireEvent.blur(field(label));
  expect(field(label).value).toBe("Goblin");
});

it("leaves freeform notes and their whitespace unchanged", () => {
  const { snapshot } = open(); const label = "Story and miscellaneous notes";
  type(label, "First line\n\nSecond line \n");
  fireEvent.blur(field(label));
  expect(field(label).value).toBe("First line\n\nSecond line \n");
  expect(snapshot().record?.story?.background).toBe("First line\n\nSecond line \n");
});
