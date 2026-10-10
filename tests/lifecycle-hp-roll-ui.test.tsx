// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LifecycleWizard } from "../apps/web/src/components/lifecycle-wizard";
import type { CharacterSheet } from "../apps/web/src/hooks/useCharacterSheet";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";

afterEach(cleanup);
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const hp = () => (screen.getByLabelText("HP gained", { exact: true }) as HTMLInputElement).value;
function pendingRoll() {
  let resolve!: (value: { total: number; faces: number[] } | null) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ total: number; faces: number[] } | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function open(rollPlan = vi.fn().mockResolvedValue({ total: 7, faces: [7] })) {
  const commit = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  const view = render(<LifecycleWizard mode="level-up" sheet={{ character: structuredClone(levelOneFighter), commitLifecycleCharacter: commit, rollPlan } as unknown as CharacterSheet} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "2. Progression" }));
  return { ...view, commit, onClose, rollPlan };
}
const roll = () => fireEvent.click(screen.getByRole("button", { name: /Roll winning HD/ }));
const settle = async (pending: ReturnType<typeof pendingRoll>, total: number) => { await act(async () => { pending.resolve({ total, faces: [total] }); await pending.promise; }); };

it("records a successful current roll once and prevents committing while rolling", async () => {
  const pending = pendingRoll();
  const { rollPlan, commit, onClose } = open(vi.fn(() => pending.promise));
  choose("HP gained", "5");
  roll();
  fireEvent.click(screen.getByRole("button", { name: "Rolling…" }));
  expect(rollPlan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "4. Review" }));
  expect((screen.getByRole("button", { name: "Confirm level up" }) as HTMLButtonElement).disabled).toBe(true);
  await settle(pending, 7);
  fireEvent.click(screen.getByRole("button", { name: "Confirm level up" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]![0].lifecycle.hpAcquisitions.at(-1)).toMatchObject({ amount: 7, note: "Rolled d10: 7" });
});

it("keeps a newer manual HP entry when an older roll resolves", async () => {
  const pending = pendingRoll();
  const { commit } = open(vi.fn(() => pending.promise));
  roll(); choose("HP gained", "6");
  await settle(pending, 9);
  expect(hp()).toBe("6");
  expect(screen.queryByText("Rolled 9 on d10")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "4. Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm level up" }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]![0].lifecycle.hpAcquisitions.at(-1)).toMatchObject({ amount: 6 });
  expect(commit.mock.calls[0]![0].lifecycle.hpAcquisitions.at(-1).note).toBeUndefined();
});

it("ignores an old progression's roll without unlocking or overwriting its replacement", async () => {
  const first = pendingRoll(); const second = pendingRoll();
  const rollPlan = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  open(rollPlan); roll();
  choose("Class / progression progression", "pf1e.paizo.wizard");
  expect(hp()).toBe("");
  roll();
  await settle(first, 9);
  expect(hp()).toBe("");
  expect((screen.getByRole("button", { name: "Rolling…" }) as HTMLButtonElement).disabled).toBe(true);
  await settle(second, 4);
  expect(hp()).toBe("4");
  expect(screen.getByText("Rolled 4 on d6")).toBeTruthy();
});

it("clears an applied roll when progression changes, but preserves manual HP", async () => {
  open(); roll(); await waitFor(() => expect(hp()).toBe("7"));
  choose("Class / progression progression", "pf1e.paizo.wizard");
  expect(hp()).toBe("");
  choose("Class / progression progression", "pf1e.paizo.fighter");
  expect(hp()).toBe("");
  choose("HP gained", "4");
  choose("Class / progression progression", "pf1e.paizo.wizard");
  expect(hp()).toBe("4");
});

it("invalidates a pending roll across HP-method changes and back/forward navigation", async () => {
  const pending = pendingRoll(); open(vi.fn(() => pending.promise)); roll();
  choose("Hit point method", "maximum");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  choose("Hit point method", "customRoll");
  await settle(pending, 9);
  expect(hp()).toBe("");
  expect(screen.getByRole("button", { name: /Roll winning HD/ })).toBeTruthy();
});

it("cancels pending results on dismissal without changing a reopened wizard", async () => {
  const pending = pendingRoll(); const old = open(vi.fn(() => pending.promise)); roll();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(old.onClose).toHaveBeenCalledTimes(1);
  old.unmount();
  const fresh = open(); choose("HP gained", "3");
  await settle(pending, 9);
  expect(hp()).toBe("3");
  expect(old.commit).not.toHaveBeenCalled(); expect(fresh.commit).not.toHaveBeenCalled();
});

it("shows a failed roll and allows retry without losing manually entered HP", async () => {
  const pending = pendingRoll();
  const rollPlan = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ total: 4, faces: [4] });
  open(rollPlan); choose("HP gained", "5"); roll();
  await act(async () => { pending.reject(new Error("Dice connection interrupted")); await pending.promise.catch(() => undefined); });
  expect(screen.getByRole("alert").textContent).toContain("Dice connection interrupted");
  expect(hp()).toBe("5");
  roll(); await waitFor(() => expect(hp()).toBe("4"));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("handles the sheet's null failure result and ignores stale failures", async () => {
  const stale = pendingRoll();
  const rollPlan = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(null).mockResolvedValueOnce({ total: 4, faces: [4] });
  open(rollPlan); choose("HP gained", "5"); roll();
  choose("HP gained", "6");
  roll();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("HP roll did not complete"));
  expect(hp()).toBe("6");
  roll(); await waitFor(() => expect(hp()).toBe("4"));
  await act(async () => { stale.resolve(null); await stale.promise; });
  expect(hp()).toBe("4");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears an old result even if progression changes before React paints that result", async () => {
  const pending = pendingRoll(); open(vi.fn(() => pending.promise)); roll();
  await act(async () => {
    pending.resolve({ total: 9, faces: [9] });
    await pending.promise;
    choose("Class / progression progression", "pf1e.paizo.wizard");
  });
  expect(hp()).toBe("");
});
