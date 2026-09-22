import { describe, expect, it } from "vitest";
import {
  defaultThemePreference,
  loadThemePreference,
  saveThemePreference,
  themePreferenceStorageKey,
  validateThemePreference,
  type ThemePreferenceStorage,
} from "../apps/web/src/lib/theme-preferences";

function memoryStorage(): ThemePreferenceStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}

describe("theme preferences", () => {
  it("accepts only supported browser-local themes", () => {
    expect(validateThemePreference("dark")).toBe("dark");
    expect(validateThemePreference("parchment")).toBe("parchment");
    expect(validateThemePreference("system")).toBe(defaultThemePreference);
    expect(validateThemePreference(null)).toBe(defaultThemePreference);
  });

  it("round-trips independently of authored character storage", () => {
    const storage = memoryStorage();
    expect(loadThemePreference(storage)).toBe(defaultThemePreference);
    expect(saveThemePreference("dark", storage)).toBe(true);
    expect(storage.entries.get(themePreferenceStorageKey)).toBe("dark");
    expect(loadThemePreference(storage)).toBe("dark");
    expect(saveThemePreference("dark", null)).toBe(false);
  });
});
