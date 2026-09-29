import { useCallback, useEffect, useState } from "react";
import {
  clearDiscordRollSettings,
  defaultDiscordRollSettings,
  loadDiscordRollSettings,
  saveDiscordRollSettings,
  validateDiscordRollSettings,
  type DiscordRollSettings,
} from "../lib/discord-roll-publishing";

export type DiscordRollSettingsPatch = Partial<DiscordRollSettings>;

/**
 * Application presentation/integration settings. They deliberately have no
 * route through CharacterInput or the character repository.
 */
export function useDiscordRollSettings(enabled = true) {
  const [settings, setSettings] = useState<DiscordRollSettings>(
    () => enabled ? loadDiscordRollSettings() : { ...defaultDiscordRollSettings },
  );
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) clearDiscordRollSettings();
  }, [enabled]);

  const persist = useCallback((next: DiscordRollSettings) => {
    if (!enabled) return;
    if (saveDiscordRollSettings(next)) setPersistenceNotice(null);
    else
      setPersistenceNotice(
        "Discord settings could not be saved; they will last only for this session.",
      );
  }, [enabled]);

  const updateSettings = useCallback(
    (patch: DiscordRollSettingsPatch) => {
      setSettings((current) => {
        const next = validateDiscordRollSettings({ ...current, ...patch });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearWebhook = useCallback(() => {
    const next = { ...defaultDiscordRollSettings, displayName: settings.displayName };
    clearDiscordRollSettings();
    persist(next);
    setSettings(next);
  }, [persist, settings.displayName]);

  return {
    settings,
    updateSettings,
    clearWebhook,
    persistenceNotice,
  } as const;
}

export type DiscordRollSettingsController = ReturnType<
  typeof useDiscordRollSettings
>;
