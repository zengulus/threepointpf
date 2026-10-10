// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { deriveResources } from "@threepointpf/rules-core";
import { QuickResourceControls, AbilityResourceEditor } from "../apps/web/src/components/ability-resource-editor";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import type { CharacterSheet } from "../apps/web/src/hooks/useCharacterSheet";
afterEach(cleanup);
function pending() {
  let resolve!: (value: { total: number } | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ total: number } | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(full = false) {
  const roll = pending();
  const character = { ...structuredClone(levelOneFighter), resources: [{ id: "breath", name: "Breath", maximum: { kind: "fixed" as const, value: 2 }, refresh: { kind: "rechargeRoll" as const, dice: { count: 1, sides: 6 } } }], resourceStates: [{ resourceId: "breath", spent: 1 }] };
  const update = vi.fn(); const fail = vi.fn(); const rollPlan = vi.fn(() => roll.promise);
  const sheet = { character, update, fail, rollPlan, mode: "browser", engine: { actionRestrictions: () => [] }, derived: { resources: deriveResources(character, { abilityModifier: () => 0, progressionLevel: () => 1 }) } } as unknown as CharacterSheet;
  const node = (value: CharacterSheet) => full ? <AbilityResourceEditor sheet={value} /> : <QuickResourceControls sheet={value} resourceId="breath" />;
  const view = render(node(sheet));
  const spend = () => fireEvent.click(screen.getByRole("button", { name: full ? "Spend Breath" : "Spend one Breath" }));
  return { ...view, sheet, update, fail, rollPlan, roll, spend, replace: (value: CharacterSheet) => view.rerender(node(value)) };
}
async function settle(roll: ReturnType<typeof pending>, total = 4) { await act(async () => { roll.resolve({ total }); await roll.promise; }); }
it.each([false, true])("prevents repeated recharge spends and competing restore actions, full=%s", async (full) => {
  const h = setup(full); h.spend(); h.spend();
  expect(h.rollPlan).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: full ? "Restore Breath" : "Restore one Breath" }) as HTMLButtonElement).disabled).toBe(true);
  if (full) expect((screen.getByRole("button", { name: "Refresh Breath" }) as HTMLButtonElement).disabled).toBe(true);
  await settle(h.roll);
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.update.mock.calls[0]![0].resourceStates).toEqual([{ resourceId: "breath", spent: 2, roundsUntilRefresh: 4 }]);
});
it.each([false, true])("preserves newer edits when recharge completes, full=%s", async (full) => {
  const h = setup(full); h.spend(); h.replace({ ...h.sheet, character: { ...h.sheet.character, damageTaken: 5 } });
  await settle(h.roll); expect(h.update).not.toHaveBeenCalled();
  expect(h.fail).toHaveBeenCalledWith(expect.stringContaining("changed"));
});
it.each([false, true])("ignores recharge after unmount, full=%s", async (full) => {
  const h = setup(full); h.spend(); h.unmount(); await settle(h.roll);
  expect(h.update).not.toHaveBeenCalled(); expect(h.fail).not.toHaveBeenCalled();
});
it.each([false, true])("ignores recharge after character switch, full=%s", async (full) => {
  const h = setup(full); h.spend(); h.replace({ ...h.sheet, character: { ...h.sheet.character, id: "other" } }); await settle(h.roll);
  expect(h.update).not.toHaveBeenCalled(); expect(h.fail).not.toHaveBeenCalled();
});
it("shows a roll error and unlocks for retry", async () => {
  const h = setup(); h.spend();
  await act(async () => { h.roll.reject(new Error("Dice disconnected")); await h.roll.promise.catch(() => undefined); });
  expect(h.fail).toHaveBeenCalledWith("Dice disconnected");
  expect((screen.getByRole("button", { name: "Spend one Breath" }) as HTMLButtonElement).disabled).toBe(false);
});
it("suppresses a stale error after switching characters", async () => {
  const h = setup(); h.spend(); h.replace({ ...h.sheet, character: { ...h.sheet.character, id: "other" } });
  await act(async () => { h.roll.reject(new Error("Old failure")); await h.roll.promise.catch(() => undefined); });
  expect(h.fail).not.toHaveBeenCalled();
});
it("keeps a replacement character's pending roll locked when an older roll finishes", async () => {
  const h = setup(); h.spend(); const next = pending(); const rollPlan = vi.fn(() => next.promise);
  h.replace({ ...h.sheet, character: { ...h.sheet.character, id: "other" }, rollPlan } as unknown as CharacterSheet); h.spend();
  await settle(h.roll);
  expect((screen.getByRole("button", { name: "Spend one Breath" }) as HTMLButtonElement).disabled).toBe(true);
  await settle(next); expect(h.update).toHaveBeenCalledTimes(1); expect(h.update.mock.calls[0]![0].id).toBe("other");
});
it("unlocks a cancelled recharge without spending", async () => {
  const h = setup(); h.spend(); await act(async () => { h.roll.resolve(null); await h.roll.promise; });
  expect(h.update).not.toHaveBeenCalled(); expect(h.fail).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Spend one Breath" }) as HTMLButtonElement).disabled).toBe(false);
});
it.each([false, true])("keeps hosted recharge atomic and prevents duplicate requests, full=%s", async (full) => {
  const h = setup(full); const spendRechargeResource = vi.fn(() => h.roll.promise);
  h.replace({ ...h.sheet, mode: "hosted", spendRechargeResource } as unknown as CharacterSheet); h.spend(); h.spend();
  expect(spendRechargeResource).toHaveBeenCalledTimes(1); expect(spendRechargeResource).toHaveBeenCalledWith("breath");
  await settle(h.roll); expect(h.rollPlan).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
});
it("retains recovery access for an unconfirmed hosted spend at zero remaining", async () => {
  const h = setup(true); const spendRechargeResource = vi.fn().mockResolvedValue(undefined);
  sessionStorage.setItem("threepointpf.pending-resource-spend.v1.unscoped", JSON.stringify({ version: 1, clientRequestId: "12345678-1234-4234-8234-123456789012", characterId: h.sheet.character.id, expectedRevision: 1, resourceId: "breath" }));
  try {
    h.replace({ ...h.sheet, mode: "hosted", spendRechargeResource, derived: { ...h.sheet.derived, resources: h.sheet.derived.resources.map(resource => ({ ...resource, remaining: 0 })) } } as unknown as CharacterSheet);
    const button = screen.getByRole("button", { name: "Recover previous Breath spend" }); expect((button as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(button); }); expect(spendRechargeResource).toHaveBeenCalledTimes(1);
  } finally { sessionStorage.clear(); }
});
