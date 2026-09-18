import {
  defaultSampleId,
  sampleCharacter,
  sampleCharacters,
} from "./sample-characters";

/**
 * Which sample this browser is looking at. Like the dice preferences, this is a
 * user-facing display choice with its own storage key: it is never written into
 * authored character state, and a reload comes back to the sheet the user was
 * working on.
 */

export const sampleStorageKey = "threepointpf.sheet.sample";

export interface SampleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserSampleStorage(): SampleStorage | null {
  const storage = (globalThis as { localStorage?: SampleStorage }).localStorage;
  if (!storage || typeof storage.getItem !== "function") return null;
  return storage;
}

/** The selected sample id, defaulting when unset, unreadable or unknown. */
export function loadSelectedSampleId(
  storage: SampleStorage | null = browserSampleStorage(),
): string {
  if (!storage) return defaultSampleId;
  try {
    const stored = storage.getItem(sampleStorageKey);
    return stored && sampleCharacters.some((sample) => sample.id === stored)
      ? stored
      : defaultSampleId;
  } catch {
    return defaultSampleId;
  }
}

export function saveSelectedSampleId(
  id: string,
  storage: SampleStorage | null = browserSampleStorage(),
): void {
  // An unknown sample is a programming error and is reported as one; a storage
  // that refuses the write only costs the reload, never the session.
  const canonical = sampleCharacter(id).id;
  try {
    storage?.setItem(sampleStorageKey, canonical);
  } catch {
    // A browser that refuses storage still has a working in-memory session.
  }
}
