import {
  activeDiceSkin,
  customDiceSkinId,
  defaultDicePresentationSettings,
  diceFlourishes,
  diceMaterialOptions,
  diceSkinPresets,
  diceSurfaceOptions,
  diceTextureOptions,
  isValidDiceColor,
  type DicePresentationSettings,
  type DiceSkin,
} from "./presentation.js";

/**
 * Persistence for dice presentation preferences. They live under their own
 * storage key and are never part of authored character state, so a table's
 * skins, flourishes and sound choices do not travel with a character snapshot
 * or through the server contract.
 */

export const dicePreferencesKey = "threepointpf.dice.presentation";

/**
 * Stored presentation preferences predate ordinary-roll flourishes. Versioned
 * saves let us repair that former silent default once without overriding a
 * player's later, explicit choice of None.
 */
export const dicePreferencesVersion = 2;

/** The structural slice of `Storage` this module needs; tests inject their own. */
export interface DicePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Browser localStorage when it exists; absent in Node and in hardened contexts. */
export function browserDiceStorage(): DicePreferencesStorage | null {
  const storage = (globalThis as { localStorage?: DicePreferencesStorage })
    .localStorage;
  if (!storage || typeof storage.getItem !== "function") return null;
  return storage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function color(value: unknown, fallback: string): string {
  return isValidDiceColor(value) ? value.trim().toLowerCase() : fallback;
}

function oneOf(value: unknown, ids: string[], fallback: string): string {
  return typeof value === "string" && ids.includes(value) ? value : fallback;
}

function cloneSkin(skin: DiceSkin): DiceSkin {
  return { ...skin, ...(skin.edge ? { edge: skin.edge } : {}) };
}

function validateSkin(value: unknown, fallback: DiceSkin): DiceSkin {
  if (!isRecord(value)) return cloneSkin(fallback);
  const texture = oneOf(
    value.texture,
    diceTextureOptions.map((option) => option.id),
    fallback.texture,
  );
  const material = oneOf(
    value.material,
    diceMaterialOptions.map((option) => option.id),
    fallback.material,
  );
  const surface = oneOf(
    value.surface,
    diceSurfaceOptions.map((option) => option.id),
    fallback.surface,
  );
  const edge = color(value.edge, "");
  return {
    foreground: color(value.foreground, fallback.foreground),
    background: color(value.background, fallback.background),
    ...(edge || fallback.edge ? { edge: edge || fallback.edge! } : {}),
    texture,
    material,
    surface,
  };
}

/**
 * Coerces stored or edited settings into a valid value field by field. A
 * corrupt or partially-written blob degrades to defaults instead of failing a
 * save, and an out-of-range intensity is clamped rather than rejected.
 */
export function validateDicePresentationSettings(
  value: unknown,
): DicePresentationSettings {
  const defaults = defaultDicePresentationSettings;
  if (!isRecord(value)) return structuredCloneSettings(defaults);
  const skinId = oneOf(
    value.skinId,
    [...diceSkinPresets.map((preset) => preset.id), customDiceSkinId],
    defaults.skinId,
  );
  const flourishIds = diceFlourishes.map((flourish) => flourish.id);
  const storedFlourishes = isRecord(value.flourishes) ? value.flourishes : {};
  const intensity =
    typeof value.intensity === "number" && Number.isFinite(value.intensity)
      ? Math.min(100, Math.max(0, Math.round(value.intensity)))
      : defaults.intensity;
  return {
    skinId,
    customSkin: validateSkin(
      value.customSkin,
      validateSkin(activeDiceSkin(defaults), defaults.customSkin),
    ),
    flourishes: {
      ordinary: oneOf(
        storedFlourishes.ordinary,
        flourishIds,
        defaults.flourishes.ordinary,
      ),
      criticalSuccess: oneOf(
        storedFlourishes.criticalSuccess,
        flourishIds,
        defaults.flourishes.criticalSuccess,
      ),
      criticalFailure: oneOf(
        storedFlourishes.criticalFailure,
        flourishIds,
        defaults.flourishes.criticalFailure,
      ),
      natural20: oneOf(
        storedFlourishes.natural20,
        flourishIds,
        defaults.flourishes.natural20,
      ),
      natural1: oneOf(
        storedFlourishes.natural1,
        flourishIds,
        defaults.flourishes.natural1,
      ),
    },
    sound:
      typeof value.sound === "boolean" ? value.sound : defaults.sound,
    intensity,
    reducedMotion:
      typeof value.reducedMotion === "boolean"
        ? value.reducedMotion
        : defaults.reducedMotion,
  };
}

function structuredCloneSettings(
  settings: DicePresentationSettings,
): DicePresentationSettings {
  return {
    ...settings,
    customSkin: cloneSkin(settings.customSkin),
    flourishes: { ...settings.flourishes },
  };
}

/** A nested patch, as typed by a settings form. */
export interface DicePresentationSettingsPatch {
  skinId?: string;
  customSkin?: Partial<DiceSkin>;
  flourishes?: Partial<DicePresentationSettings["flourishes"]>;
  sound?: boolean;
  intensity?: number;
  reducedMotion?: boolean;
}

/** Applies a partial edit and re-validates, so a form can never write junk. */
export function updateDicePresentationSettings(
  current: DicePresentationSettings,
  patch: DicePresentationSettingsPatch,
): DicePresentationSettings {
  return validateDicePresentationSettings({
    ...current,
    ...patch,
    customSkin: { ...current.customSkin, ...(patch.customSkin ?? {}) },
    flourishes: { ...current.flourishes, ...(patch.flourishes ?? {}) },
  });
}

export function loadDicePreferences(
  storage: DicePreferencesStorage | null = browserDiceStorage(),
): DicePresentationSettings {
  if (!storage) return structuredCloneSettings(defaultDicePresentationSettings);
  let raw: string | null;
  try {
    raw = storage.getItem(dicePreferencesKey);
  } catch {
    return structuredCloneSettings(defaultDicePresentationSettings);
  }
  if (!raw) return structuredCloneSettings(defaultDicePresentationSettings);
  try {
    const parsed: unknown = JSON.parse(raw);
    const settings = validateDicePresentationSettings(parsed);
    // Before version 2, ordinary rolls silently used None. Treat that legacy
    // value as the old default so existing tables regain the visible cue. A
    // version-2 save is an intentional current preference and is left alone.
    if (
      isRecord(parsed) &&
      parsed.version !== dicePreferencesVersion &&
      isRecord(parsed.flourishes) &&
      parsed.flourishes.ordinary === "none"
    ) {
      return {
        ...settings,
        flourishes: {
          ...settings.flourishes,
          ordinary: defaultDicePresentationSettings.flourishes.ordinary,
        },
      };
    }
    return settings;
  } catch {
    return structuredCloneSettings(defaultDicePresentationSettings);
  }
}

/**
 * Whether a user has ever saved dice preferences, so a first run can follow the
 * operating system's motion preference without overriding a deliberate choice.
 */
export function hasStoredDicePreferences(
  storage: DicePreferencesStorage | null = browserDiceStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(dicePreferencesKey) !== null;
  } catch {
    return false;
  }
}

/** Returns false when storage refuses the write, so the UI can stay honest. */
export function saveDicePreferences(
  settings: DicePresentationSettings,
  storage: DicePreferencesStorage | null = browserDiceStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      dicePreferencesKey,
      JSON.stringify({
        version: dicePreferencesVersion,
        ...validateDicePresentationSettings(settings),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDicePreferences(
  storage: DicePreferencesStorage | null = browserDiceStorage(),
): void {
  try {
    storage?.removeItem?.(dicePreferencesKey);
  } catch {
    // A storage that refuses writes also refuses deletes; defaults still apply.
  }
}
