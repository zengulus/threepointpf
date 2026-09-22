import { useCallback, useEffect, useState } from "react";
import {
  loadThemePreference,
  saveThemePreference,
  validateThemePreference,
  type ThemePreference,
} from "../lib/theme-preferences";

/** Application-wide colour preference, intentionally separate from a sheet. */
export function useThemePreference() {
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  const updateTheme = useCallback((value: string) => {
    const next = validateThemePreference(value);
    setTheme(next);
    if (saveThemePreference(next)) setPersistenceNotice(null);
    else
      setPersistenceNotice(
        "Theme preference could not be saved; it will last only for this session.",
      );
  }, []);

  return { theme, updateTheme, persistenceNotice } as const;
}

export type ThemePreferenceController = ReturnType<typeof useThemePreference>;
