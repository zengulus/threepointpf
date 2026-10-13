// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { resolveRollPlan } from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { HostedRollResponse } from "@threepointpf/shared";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import { RecordedRollHistory } from "../apps/web/src/components/recorded-roll-history";
import { useRecordedRollHistory } from "../apps/web/src/hooks/useRecordedRollHistory";

const plan = new RulesEngine(levelOneFighter, rulesCatalogs).createSaveRollPlan("will");
const resolved = resolveRollPlan(plan, [12]);
function roll(id: number, characterId = "hero", state: HostedRollResponse["delivery"]["state"] = "sent"): HostedRollResponse {
  return { version: 1, rollId: `roll-${String(id).padStart(3, "0")}`, clientRequestId: `request-${id}`, characterId, characterName: characterId,
    characterRevision: 1, createdAt: new Date(Date.UTC(2026, 9, 12, 0, 0, id)).toISOString(), plan: { ...plan, label: `Save ${id}` }, result: resolved, delivery: { state } };
}
const page = (high: number, low: number, nextCursor: string | null = null, characterId = "hero") => ({ rolls: Array.from({ length: high - low + 1 }, (_, index) => roll(high - index, characterId)), nextCursor });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function pending() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const retryDelivery = vi.fn(async () => {});
let remember: (value: HostedRollResponse) => void;
function History({ id = "hero", mode = "hosted" }: { id?: string; mode?: "hosted" | "browser" }) {
  const history = useRecordedRollHistory(mode, id);
  React.useEffect(() => { remember = history.rememberRoll; });
  return <RecordedRollHistory history={history} retryDelivery={retryDelivery} />;
}
async function settle(read: ReturnType<typeof pending>, body: unknown, status = 200) {
  await act(async () => { read.resolve(json(body, status)); await read.promise; });
}
async function open(read: typeof fetch = vi.fn(async () => json(page(25, 6, "roll-006")))) {
  vi.stubGlobal("fetch", read);
  const view = render(<History />);
  await act(async () => {});
  fireEvent.click(screen.getByText(/Recorded rolls \(/));
  return { ...view, read };
}
const rows = () => within(screen.getByRole("list", { name: "Recorded rolls" })).queryAllByRole("listitem");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); retryDelivery.mockClear(); });

it("loads older recorded results in order and marks the last page", async () => {
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(page(5, 1)));
  await open(read);
  expect(rows()).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" }));
  await act(async () => {});
  expect(read.mock.calls[1][0]).toBe("/api/rolls?characterId=hero&before=roll-006");
  expect(rows()).toHaveLength(25);
  expect(rows()[0].textContent).toContain("Save 25"); expect(rows()[24].textContent).toContain("Save 1");
  expect(screen.getByText("All recorded rolls loaded.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Load older rolls" })).toBeNull();
});

it("deduplicates repeated older-page clicks and retains results after a failed page", async () => {
  const older = pending();
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockReturnValueOnce(older.promise).mockResolvedValueOnce(json(page(5, 1)));
  await open(read);
  const button = screen.getByRole("button", { name: "Load older rolls" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(read).toHaveBeenCalledTimes(2); expect((button as HTMLButtonElement).disabled).toBe(true);
  await settle(older, {}, 500);
  expect(rows()).toHaveLength(20); expect(screen.getByRole("status").textContent).toContain("could not be loaded");
  fireEvent.click(button); await act(async () => {});
  expect(read.mock.calls[2][0]).toBe(read.mock.calls[1][0]); expect(rows()).toHaveLength(25);
});

it("shows loading separately from empty and offers a retry after initial failure", async () => {
  const initial = pending();
  const read = vi.fn().mockReturnValueOnce(initial.promise).mockResolvedValueOnce(json({ rolls: [], nextCursor: null }));
  await open(read);
  expect(screen.getByRole("status").textContent).toBe("Loading recorded rolls…");
  expect(screen.queryByText("No recorded rolls yet.")).toBeNull();
  await settle(initial, {}, 503);
  fireEvent.click(screen.getByRole("button", { name: "Retry history" })); await act(async () => {});
  expect(screen.getByText("No recorded rolls yet.")).toBeTruthy(); expect(screen.queryByRole("status")).toBeNull();
});

it("keeps expanded history through periodic refresh and updates delivery state without duplicates", async () => {
  let refresh!: () => void;
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback) => { refresh = callback as () => void; return 1 as unknown as ReturnType<typeof setInterval>; });
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(page(5, 1))).mockResolvedValueOnce(json({ ...page(26, 7, "roll-007"), rolls: [roll(26, "hero", "retryable_failed"), ...page(25, 7).rolls] }));
  await open(read); fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  await act(async () => refresh());
  expect(rows()).toHaveLength(26); expect(rows()[25].textContent).toContain("Save 1");
  fireEvent.click(screen.getByRole("button", { name: "Retry sending" }));
  expect(retryDelivery).toHaveBeenCalledWith(expect.objectContaining({ rollId: "roll-026" }));
});

it("retains a locally recorded result and newer delivery update when an older read completes", async () => {
  const initial = pending(); await open(vi.fn(() => initial.promise));
  act(() => { remember(roll(26)); remember(roll(25, "hero", "sent")); });
  await settle(initial, { ...page(25, 6, "roll-006"), rolls: [roll(25, "hero", "pending"), ...page(24, 6).rolls] });
  expect(rows()).toHaveLength(21);
  expect(rows()[0].textContent).toContain("Save 26");
  expect(rows()[1].textContent).toContain("Sent to Discord.");
});

it("leaves intermediate rolls reachable after more than a page arrives between refreshes", async () => {
  const read = vi.fn().mockResolvedValueOnce(json(page(20, 1))).mockResolvedValueOnce(json(page(45, 26, "roll-026"))).mockResolvedValueOnce(json(page(25, 6, "roll-006")));
  await open(read); fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  expect(read.mock.calls[2][0]).toContain("before=roll-026"); expect(rows()).toHaveLength(45);
  expect(rows()[44].textContent).toContain("Save 1");
});

it.each([200, 500])("ignores an old page after switching character, including HTTP %s", async (status) => {
  const older = pending(); const beta = pending();
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockReturnValueOnce(older.promise).mockReturnValueOnce(beta.promise);
  const view = await open(read);
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" }));
  const oldRemember = remember;
  view.rerender(<History id="beta" />);
  expect(rows()).toHaveLength(0);
  await settle(older, page(5, 1), status);
  expect(screen.getByRole("status").textContent).toBe("Loading recorded rolls…");
  act(() => oldRemember(roll(27)));
  expect(rows()).toHaveLength(0);
  await settle(beta, page(10, 10, null, "beta"));
  expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain("Save 10");
});

it("clears inaccessible history when a refresh reports revoked access", async () => {
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json({}, 403));
  await open(read); fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  expect(rows()).toHaveLength(0); expect(screen.getByRole("button", { name: "Retry history" })).toBeTruthy();
});

it("does not fetch in browser mode or after unmount", async () => {
  const read = vi.fn(); vi.stubGlobal("fetch", read);
  const view = render(<History mode="browser" />); await act(async () => {}); expect(read).not.toHaveBeenCalled(); view.unmount();
  const request = pending(); read.mockReturnValue(request.promise);
  const hosted = render(<History />); hosted.unmount();
  await settle(request, page(20, 1)); expect(read).toHaveBeenCalledTimes(1);
});


it.each([false, true])("does not mistake a locally remembered new roll for overlap with loaded pages, duringRead=%s", async (duringRead) => {
  const refresh = pending();
  const read = vi.fn().mockResolvedValueOnce(json(page(20, 1))).mockReturnValueOnce(refresh.promise).mockResolvedValueOnce(json(page(25, 6, "roll-006")));
  await open(read);
  if (!duringRead) act(() => remember(roll(45)));
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  if (duringRead) act(() => remember(roll(45)));
  await settle(refresh, page(45, 26, "roll-026"));
  expect(screen.queryByText("All recorded rolls loaded.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  expect(read.mock.calls[2][0]).toContain("before=roll-026"); expect(rows()).toHaveLength(45);
});


it("refreshes an older retried delivery through its terminal status without sending again", async () => {
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(page(5, 1)))
    .mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(roll(1, "hero", "sent")));
  await open(read); fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  act(() => remember(roll(1, "hero", "pending")));
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  expect(read.mock.calls[3][0]).toBe("/api/rolls/roll-001");
  expect(read.mock.calls[3][1]).toMatchObject({ credentials: "same-origin", signal: expect.any(AbortSignal) });
  expect(rows()[24].textContent).toContain("Sent to Discord."); expect(retryDelivery).not.toHaveBeenCalled();
});

it("ignores an old remembered result after access denial, including after a later authorized refresh", async () => {
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json(page(25, 6, "roll-006")));
  await open(read); const oldRemember = remember;
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  act(() => oldRemember(roll(30))); expect(rows()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Retry history" })); await act(async () => {});
  act(() => oldRemember(roll(30))); expect(rows()).toHaveLength(20);
  act(() => remember(roll(31))); expect(rows()).toHaveLength(21);
});

it("bounds older delivery refreshes and reaches the remaining records next time", async () => {
  const read = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("before=roll-026")) return json(page(25, 6, "roll-006"));
    if (url.includes("before=roll-006")) return json(page(5, 1));
    if (url.startsWith("/api/rolls/")) return json(roll(Number(url.split("-").pop())));
    return json(page(45, 26, "roll-026"));
  });
  await open(read);
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  act(() => { for (let id = 1; id <= 25; id += 1) remember(roll(id, "hero", "pending")); });
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  expect(read.mock.calls.filter(([url]) => String(url).startsWith("/api/rolls/"))).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  expect(read.mock.calls.filter(([url]) => String(url).startsWith("/api/rolls/"))).toHaveLength(25);
  expect(rows().every((row) => row.textContent?.includes("Sent to Discord."))).toBe(true);
});

it("ignores an older delivery response after the selected character changes", async () => {
  const status = pending();
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(page(5, 1)))
    .mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockReturnValueOnce(status.promise).mockResolvedValueOnce(json(page(9, 9, null, "beta")));
  const view = await open(read); fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  act(() => remember(roll(1, "hero", "pending")));
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  view.rerender(<History id="beta" />); await act(async () => {});
  await settle(status, roll(1));
  expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain("Save 9");
});

it("does not restore rows when one delivery refresh is denied and another completes later", async () => {
  const status = pending();
  const read = vi.fn().mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json(page(5, 1)))
    .mockResolvedValueOnce(json(page(25, 6, "roll-006"))).mockResolvedValueOnce(json({}, 403)).mockReturnValueOnce(status.promise);
  await open(read); fireEvent.click(screen.getByRole("button", { name: "Load older rolls" })); await act(async () => {});
  act(() => { remember(roll(2, "hero", "pending")); remember(roll(1, "hero", "pending")); });
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await act(async () => {});
  expect(rows()).toHaveLength(0); await settle(status, roll(1)); expect(rows()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Retry history" })).toBeTruthy();
});
