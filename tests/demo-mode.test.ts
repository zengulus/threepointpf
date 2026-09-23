import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCharacterRepository, LocalStorageCharacterRepository } from "@threepointpf/shared";
import { repositoryFor, sheetMode } from "../apps/web/src/lib/repository";
import { sheetModeFor, sheetModeFromEnv } from "../apps/web/src/lib/sheet-mode";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";

const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;
afterEach(() => {
  vi.restoreAllMocks();
  if (originalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
});

describe("explicit browser and hosted modes", () => {
  it("defaults to browser mode and only enables hosted mode explicitly", () => {
    expect(sheetModeFor({})).toBe("browser");
    expect(sheetModeFromEnv({})).toBe("browser");
    expect(sheetModeFromEnv({ SOME_UNRELATED_URL: "https://example.test" })).toBe("browser");
    expect(sheetModeFromEnv({ VITE_APP_MODE: "hosted" })).toBe("hosted");
    expect(sheetMode()).toBe("browser");
  });

  it("browser mode uses storage or in-memory fallback and never fetches", async () => {
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
    const repository = repositoryFor("browser");
    expect(repository).toBeInstanceOf(InMemoryCharacterRepository);
    await repository.save(levelOneFighter);
    expect((await repository.load(levelOneFighter.id))?.name).toBe(levelOneFighter.name);
    const entries = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      length: 0,
    };
    expect(repositoryFor("browser")).toBeInstanceOf(LocalStorageCharacterRepository);
  });

  it("hosted mode has an HTTP repository boundary", () => {
    expect(repositoryFor("hosted")).toHaveProperty("load");
  });
});
