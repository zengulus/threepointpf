// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { deriveResources } from "@threepointpf/rules-core";
import { AbilityResourceEditor } from "../apps/web/src/components/ability-resource-editor";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import type { CharacterSheet } from "../apps/web/src/hooks/useCharacterSheet";
import type { ResourceRefreshRule } from "@threepointpf/rules-schema";
afterEach(cleanup);
function setup(refresh: ResourceRefreshRule = { kind: "rechargeRoll", dice: { count: 2, sides: 6 } }) {
  const character = { ...structuredClone(levelOneFighter), resources: [{ id: "breath", name: "Breath", maximum: { kind: "fixed" as const, value: 2 }, refresh }], resourceStates: [{ resourceId: "breath", spent: 1 }] };
  const update = vi.fn().mockReturnValue(true), fail = vi.fn();
  const sheet = { character, update, fail, mode: "browser", engine: { actionRestrictions: () => [] }, derived: { resources: deriveResources(character, { abilityModifier: () => 0, progressionLevel: () => 1 }) } } as unknown as CharacterSheet;
  render(<AbilityResourceEditor sheet={sheet} />);
  const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
  const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
  click("Edit resource Breath");
  return { update, fail, click, change };
}
it("preserves all recharge dice when changing only a resource name", () => {
  const h = setup(); h.change("Resource name", "Dragon breath"); h.click("Save resource");
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.update.mock.calls[0]![0].resources[0]).toMatchObject({ name: "Dragon breath", refresh: { kind: "rechargeRoll", dice: { count: 2, sides: 6 } } });
});
it("edits both count and sides explicitly", () => {
  const h = setup(); h.change("Resource recharge dice count", "3"); h.change("Resource recharge die sides", "8"); h.click("Save resource");
  expect(h.update.mock.calls[0]![0].resources[0].refresh.dice).toEqual({ count: 3, sides: 8 });
});
it.each(["Resource recharge dice count", "Resource recharge die sides"])("rejects empty, fractional and nonpositive %s without saving", (label) => {
  const h = setup();
  for (const value of ["", "0", "-1", "1.5"]) { h.change(label, value); h.click("Save resource"); }
  expect(h.update).not.toHaveBeenCalled(); expect(h.fail).toHaveBeenCalledTimes(4);
});
it("cancel and repeated editing restore the original recharge values", () => {
  const h = setup();
  for (let i = 0; i < 3; i++) { h.change("Resource recharge dice count", "9"); h.click("Cancel edit"); h.click("Edit resource Breath"); }
  h.click("Save resource"); expect(h.update.mock.calls[0]![0].resources[0].refresh.dice.count).toBe(2);
});
it("new resources default to one die after cancelling a multi-die edit", () => {
  const h = setup(); h.click("Cancel edit"); h.change("Resource name", "New breath"); h.change("Resource refresh rule", "rechargeRoll"); h.change("Resource recharge die sides", "6"); h.click("+ Add resource");
  expect(h.update.mock.calls[0]![0].resources[1].refresh.dice).toEqual({ count: 1, sides: 6 });
});
it.each([{ kind: "interval" as const, rounds: 5 }, { kind: "daily" as const }])("preserves other refresh rules: %j", (refresh) => {
  const h = setup(refresh); h.click("Save resource"); expect(h.update.mock.calls[0]![0].resources[0].refresh).toEqual(refresh);
});
