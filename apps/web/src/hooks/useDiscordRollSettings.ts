import { useCallback, useState } from "react";
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
export function useDiscordRollSettings() {
  const [settings, setSettings] = useState<DiscordRollSettings>(
    loadDiscordRollSettings,
  );
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(
    null,
  );

  const persist = useCallback((next: DiscordRollSettings) => {
    if (saveDiscordRollSettings(next)) setPersistenceNotice(null);
    else
      setPersistenceNotice(
        "Discord settings could not be saved; they will last only for this session.",
      );
  }, []);

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
