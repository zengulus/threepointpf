import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryCharacterRepository,
  LocalStorageCharacterRepository,
  SupabaseCharacterRepository,
} from "@threepointpf/shared";
import {
  repositoryFor,
  sheetMode,
} from "../apps/web/src/lib/repository";
import {
  sheetModeFor,
  sheetModeFromEnv,
  type SheetEnvironment,
} from "../apps/web/src/lib/sheet-mode";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import {
  loadSelectedSampleId,
  sampleStorageKey,
  saveSelectedSampleId,
} from "../apps/web/src/lib/sheet-session";

const credentials: SheetEnvironment = {
  supabaseUrl: "https://demo.supabase.co",
  supabaseKey: "public-anon-key",
};

const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;

afterEach(() => {
  if (originalStorage === undefined)
    delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
});

describe("demo is the default and cloud is opt-in", () => {
  it("needs both credentials to leave demo mode", () => {
    expect(sheetModeFor({})).toBe("demo");
    expect(sheetModeFor({ supabaseUrl: credentials.supabaseUrl })).toBe("demo");
    expect(sheetModeFor({ supabaseKey: credentials.supabaseKey })).toBe("demo");
    expect(sheetModeFor(credentials)).toBe("cloud");
  });

  it("lets an explicit demo flag win over configured credentials", () => {
    expect(sheetModeFor({ ...credentials, demo: true })).toBe("demo");
  });

  it("reads the flag and credentials from the build environment", () => {
    expect(sheetModeFromEnv({})).toBe("demo");
    expect(sheetModeFromEnv({ VITE_DEMO_MODE: "true" })).toBe("demo");
    expect(
      sheetModeFromEnv({
        VITE_SUPABASE_URL: credentials.supabaseUrl,
        VITE_SUPABASE_ANON_KEY: credentials.supabaseKey,
      }),
    ).toBe("cloud");
    // The published demo build sets the flag, so a stray credential in the
    // build environment cannot turn it into a database client.
    expect(
      sheetModeFromEnv({
        VITE_DEMO_MODE: "1",
        VITE_SUPABASE_URL: credentials.supabaseUrl,
        VITE_SUPABASE_ANON_KEY: credentials.supabaseKey,
      }),
    ).toBe("demo");
    // Empty strings are missing values, not credentials.
    expect(
      sheetModeFromEnv({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" }),
    ).toBe("demo");
  });

  it("reports demo mode for this build, which has no credentials", () => {
    expect(sheetMode()).toBe("demo");
  });
});

describe("the selected sample survives a reload without touching character state", () => {
  const storage = () => {
    const entries = new Map<string, string>();
    return {
      entries,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    };
  };

  it("defaults, persists and rejects an unknown sample", () => {
    const entries = storage();
    expect(loadSelectedSampleId(entries)).toBe("level-1-fighter");
    saveSelectedSampleId("showcase", entries);
    expect(entries.entries.get(sampleStorageKey)).toBe("showcase");
    expect(loadSelectedSampleId(entries)).toBe("showcase");
    // A stale or hostile value degrades to the default instead of throwing.
    entries.setItem(sampleStorageKey, "who-knows");
    expect(loadSelectedSampleId(entries)).toBe("level-1-fighter");
    expect(() => saveSelectedSampleId("who-knows", entries)).toThrow(
      /Unknown sample character/,
    );
  });

  it("works without any browser storage", () => {
    expect(loadSelectedSampleId(null)).toBe("level-1-fighter");
    expect(() => saveSelectedSampleId("showcase", null)).not.toThrow();
  });
});

describe("the demo repository needs no backend", () => {
  it("falls back to an in-memory draft when the browser has no storage", async () => {
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
    const repository = repositoryFor("demo", {});
    expect(repository).toBeInstanceOf(InMemoryCharacterRepository);
    // Saving and loading works end to end without a server or a browser.
    await repository.save(levelOneFighter);
    const loaded = await repository.load(levelOneFighter.id);
    expect(loaded?.name).toBe(levelOneFighter.name);
    expect(loaded?.advancementSlots?.[0]?.tracks[0]?.entry.progressionId).toBe(
      "pf1e.paizo.fighter",
    );
  });

  it("uses browser storage when it is available", async () => {
    const entries = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    const repository = repositoryFor("demo", credentials);
    expect(repository).toBeInstanceOf(LocalStorageCharacterRepository);
    await repository.save(levelOneFighter);
    expect([...entries.keys()]).toEqual([
      `threepointpf.character.${levelOneFighter.id}`,
    ]);
    expect(await repository.load(levelOneFighter.id)).toMatchObject({
      id: levelOneFighter.id,
    });
  });

  it("only builds a Supabase repository in cloud mode with credentials", () => {
    expect(repositoryFor("cloud", credentials)).toBeInstanceOf(
      SupabaseCharacterRepository,
    );
    // A cloud mode without credentials still has somewhere to save.
    expect(repositoryFor("cloud", {})).not.toBeInstanceOf(
      SupabaseCharacterRepository,
    );
    expect(repositoryFor("demo", credentials)).not.toBeInstanceOf(
      SupabaseCharacterRepository,
    );
  });
});
