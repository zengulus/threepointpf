/** Browser presentation preference; it is never part of authored character data. */
export const themePreferenceStorageKey = "threepointpf.ui.theme";

export const themePreferences = ["parchment", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export const defaultThemePreference: ThemePreference = "parchment";

export interface ThemePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserThemeStorage(): ThemePreferenceStorage | null {
  try {
    const storage = (globalThis as { localStorage?: ThemePreferenceStorage })
      .localStorage;
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

export function validateThemePreference(value: unknown): ThemePreference {
  return themePreferences.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : defaultThemePreference;
}

export function loadThemePreference(
  storage: ThemePreferenceStorage | null = browserThemeStorage(),
): ThemePreference {
  if (!storage) return defaultThemePreference;
  try {
    return validateThemePreference(storage.getItem(themePreferenceStorageKey));
  } catch {
    return defaultThemePreference;
  }
}

/** Returns false when browser storage is unavailable without affecting the UI. */
export function saveThemePreference(
  theme: ThemePreference,
  storage: ThemePreferenceStorage | null = browserThemeStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(themePreferenceStorageKey, validateThemePreference(theme));
    return true;
  } catch {
    return false;
  }
}
