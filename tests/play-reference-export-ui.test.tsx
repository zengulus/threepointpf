// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlayReferenceExport } from "../apps/web/src/components/play-reference-export";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput } from "@threepointpf/rules-schema";

function Export({ character, isDirty }: { character: CharacterInput; isDirty: boolean }) {
  return <PlayReferenceExport engine={new RulesEngine(character, rulesCatalogs)} isDirty={isDirty} />;
}

const downloads: { name: string; connected: boolean }[] = [];
const createObjectURL = vi.fn(), revokeObjectURL = vi.fn(), fetch = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T05:00:00Z"));
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL }); vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Blob", class { constructor(readonly parts: unknown[], readonly options: unknown) {} });
  createObjectURL.mockImplementation(() => `blob:test-${createObjectURL.mock.calls.length}`);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, connected: this.isConnected }); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); downloads.length = 0; });
const click = () => fireEvent.click(screen.getByRole("button", { name: "Download play reference" }));
const downloadedText = (index = 0) => createObjectURL.mock.calls[index]![0].parts[0] as string;

it("does not export a fallback engine while the selected sheet has a calculation error", () => {
  const engine = new RulesEngine(levelOneFighter, rulesCatalogs);
  const view = render(<PlayReferenceExport engine={engine} isDirty evaluationError="Invalid selected character" />);
  expect((screen.getByRole("button", { name: "Download play reference" }) as HTMLButtonElement).disabled).toBe(true);
  click(); expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("sheet calculation error");
  view.rerender(<PlayReferenceExport engine={engine} isDirty evaluationError={null} />);
  click(); expect(createObjectURL).toHaveBeenCalledTimes(1);
});

it("downloads a local text snapshot including unsaved changes and cleans up its temporary link", () => {
  render(<Export character={levelOneFighter} isDirty />);
  fireEvent.click(screen.getByText("Play reference")); click();
  expect(downloads).toEqual([{ name: "level-1-fighter.threepointpf-play.txt", connected: true }]);
  expect(downloadedText()).toContain("Includes unsaved sheet edits");
  expect(createObjectURL.mock.calls[0]![0].options).toEqual({ type: "text/plain;charset=utf-8" });
  expect(screen.getByRole("status").textContent).toContain("Download started");
  expect(document.querySelectorAll("a[download]")).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1_000)); expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
});

it("re-exports current edits on repeated clicks and closes without another download", () => {
  const view = render(<Export character={levelOneFighter} isDirty={false} />);
  fireEvent.click(screen.getByText("Play reference")); click();
  view.rerender(<Export character={{ ...levelOneFighter, name: "Changed hero", temporaryHp: 7 }} isDirty />); click();
  expect(downloadedText(0)).toContain("Snapshot of the current sheet.");
  expect(downloadedText(1)).toContain("Changed hero | 3.PF"); expect(downloadedText(1)).toContain("temporary HP: 7");
  fireEvent.click(screen.getByText("Play reference")); fireEvent.click(screen.getByText("Play reference"));
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  view.unmount(); act(() => vi.advanceTimersByTime(1_000)); expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("clears another character's feedback and exports the selected character", () => {
  const view = render(<Export character={levelOneFighter} isDirty={false} />); click();
  view.rerender(<Export character={{ ...levelOneFighter, id: "other", name: "Other hero" }} isDirty={false} />);
  expect(screen.queryByRole("status")).toBeNull(); click(); expect(downloadedText(1)).toContain("Other hero | 3.PF");
});

it("offers a clean retry when downloads are unavailable", () => {
  createObjectURL.mockImplementationOnce(() => { throw new Error("Downloads disabled"); });
  render(<Export character={levelOneFighter} isDirty={false} />); click();
  expect(screen.getByRole("alert").textContent).toContain("could not be downloaded"); expect(downloads).toHaveLength(0);
  click(); expect(screen.queryByRole("alert")).toBeNull(); expect(downloads).toHaveLength(1);
});

it("releases object URLs and removes temporary links when a download click fails", () => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementationOnce(() => { throw new Error("Blocked"); });
  render(<Export character={levelOneFighter} isDirty={false} />); click();
  expect(screen.getByRole("alert")).toBeTruthy(); expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  act(() => vi.advanceTimersByTime(1_000)); expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
});
