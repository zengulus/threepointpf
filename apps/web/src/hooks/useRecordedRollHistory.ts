import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HostedRollResponse } from "@threepointpf/shared";

type HistoryPage = { rolls: HostedRollResponse[]; nextCursor?: string | null };
type HistoryState = {
  characterId: string;
  session: symbol;
  accessDenied: boolean;
  rolls: HostedRollResponse[];
  serverIds: Set<string>;
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
};
const emptyHistory = (characterId: string): HistoryState => ({ characterId, session: Symbol(), accessDenied: false, rolls: [], serverIds: new Set(), nextCursor: null, loaded: false, loading: false, error: null });

function mergeRolls(previous: HostedRollResponse[], incoming: HostedRollResponse[]) {
  const byId = new Map(previous.map((roll) => [roll.rollId, roll]));
  for (const roll of incoming) byId.set(roll.rollId, roll);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.rollId.localeCompare(a.rollId));
}

/** Character-scoped, durable history. Refreshes never discard expanded pages. */
export function useRecordedRollHistory(mode: "browser" | "hosted", characterId: string) {
  const [state, setState] = useState<HistoryState>(() => emptyHistory(characterId));
  const latest = useRef(state);
  const identity = `${mode}:${characterId}`;
  const activeIdentity = useRef(identity);
  useLayoutEffect(() => { activeIdentity.current = identity; }, [identity]);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const statusOffset = useRef(0);

  const commit = useCallback((next: HistoryState) => { latest.current = next; setState(next); }, []);
  const requestPage = useCallback(async (before: string | null = null) => {
    if (mode !== "hosted" || !characterId || !mounted.current || activeIdentity.current !== identity || inFlight.current) return;
    inFlight.current = true;
    const version = generation.current;
    const isCurrent = () => mounted.current && generation.current === version && activeIdentity.current === identity;
    const atRequest = new Map(latest.current.rolls.map((roll) => [roll.rollId, roll]));
    commit({ ...latest.current, loading: true, error: null });
    try {
      const query = new URLSearchParams({ characterId, ...(before ? { before } : {}) });
      const response = await fetch(`/api/rolls?${query}`, { credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
      if (!isCurrent()) return;
      if (!response.ok) {
        // Access can change while this screen is open. Do not retain records
        // after the server says the character is no longer accessible.
        if ([401, 403, 404].includes(response.status)) commit({ ...emptyHistory(characterId), accessDenied: true, loading: true });
        throw new Error("Recorded rolls could not be loaded. Try again.");
      }
      const page = await response.json() as HistoryPage;
      if (!isCurrent()) return;
      const previous = latest.current;
      const currentById = new Map(previous.rolls.map((roll) => [roll.rollId, roll]));
      const incoming = page.rolls.filter((roll) => roll.characterId === characterId).map((roll) => {
        const current = currentById.get(roll.rollId);
        // A just-recorded result or delivery update wins over an older read.
        return current && current !== atRequest.get(roll.rollId) ? current : roll;
      });
      const overlaps = incoming.some((roll) => previous.serverIds.has(roll.rollId));
      // If an entire page arrived between refreshes, resume at its boundary
      // so the intervening results remain reachable rather than being skipped.
      const cursor = before || !previous.loaded || (!overlaps && page.nextCursor)
        ? page.nextCursor ?? null : previous.nextCursor;
      const merged = mergeRolls(previous.rolls, incoming);
      commit({ ...previous, accessDenied: false, rolls: merged, serverIds: new Set([...previous.serverIds, ...incoming.map((roll) => roll.rollId)]), nextCursor: cursor, loaded: true, loading: true, error: null });
      if (!before) {
        // The latest page cannot report delivery changes on expanded older
        // results. Recheck a bounded, rotating batch without resending anything.
        const pageIds = new Set(incoming.map((roll) => roll.rollId));
        const pending = merged.filter((roll) => !pageIds.has(roll.rollId) && ["pending", "sending", "retryable_failed"].includes(roll.delivery.state));
        const start = pending.length ? statusOffset.current % pending.length : 0;
        const batch = [...pending.slice(start), ...pending.slice(0, start)].slice(0, 20);
        statusOffset.current = start + batch.length;
        const session = latest.current.session;
        await Promise.all(batch.map(async (roll) => {
          try {
            const status = await fetch(`/api/rolls/${encodeURIComponent(roll.rollId)}`, { credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
            if (!isCurrent() || latest.current.session !== session) return;
            if ([401, 403, 404].includes(status.status)) {
              commit({ ...emptyHistory(characterId), accessDenied: true, loading: true, error: "Recorded rolls could not be loaded. Try again." });
              return;
            }
            if (!status.ok) return;
            const updated = await status.json() as HostedRollResponse;
            if (!isCurrent() || latest.current.session !== session || updated.characterId !== characterId || updated.rollId !== roll.rollId) return;
            // Do not overwrite a newer explicit retry or just-recorded result.
            if (latest.current.rolls.find((item) => item.rollId === roll.rollId) !== roll) return;
            commit({ ...latest.current, rolls: mergeRolls(latest.current.rolls, [updated]) });
          } catch { /* Retry older delivery status on the next refresh. */ }
        }));
      }
    } catch {
      if (isCurrent()) commit({ ...latest.current, loading: false, error: "Recorded rolls could not be loaded. Try again." });
    } finally {
      if (isCurrent()) { inFlight.current = false; commit({ ...latest.current, loading: false }); }
    }
  }, [characterId, commit, identity, mode]);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    inFlight.current = false;
    statusOffset.current = 0;
    latest.current = emptyHistory(characterId);
    void requestPage();
    const timer = mode === "hosted" ? globalThis.setInterval(() => { void requestPage(); }, 15_000) : null;
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (timer !== null) globalThis.clearInterval(timer);
    };
  }, [characterId, commit, mode, requestPage]);

  const rememberRoll = useCallback((roll: HostedRollResponse) => {
    if (!mounted.current || mode !== "hosted" || activeIdentity.current !== identity || roll.characterId !== characterId || latest.current.accessDenied || latest.current.session !== state.session) return;
    commit({ ...latest.current, rolls: mergeRolls(latest.current.rolls, [roll]) });
  }, [characterId, commit, identity, mode, state.session]);
  const current = state.characterId === characterId && mode === "hosted" ? state : emptyHistory(characterId);
  return {
    rollHistory: current.rolls,
    rollHistoryLoading: current.loading,
    rollHistoryError: current.error,
    rollHistoryLoaded: current.loaded,
    hasOlderRolls: Boolean(current.nextCursor),
    loadOlderRolls: () => latest.current.nextCursor ? requestPage(latest.current.nextCursor) : Promise.resolve(),
    refreshRollHistory: () => requestPage(),
    rememberRoll,
  };
}
