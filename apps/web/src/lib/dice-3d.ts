import {
  diceNotationFor,
  physicalFacesSupported,
  type DiceFlourish,
  type DicePresentationReport,
  type DicePresentationRequest,
  type DicePresentationSettings,
  type DicePresenter,
  type DiceSkin,
} from "@threepointpf/dice";

/**
 * The browser 3D dice renderer, behind the `DicePresenter` boundary.
 *
 * The order is deliberate and is the whole point of this file: the
 * authoritative faces are generated and resolved by the rules engine *first*,
 * and only then is the renderer asked to land the dice on exactly those faces
 * (`NdS@f1,f2,...`). Nothing read back from the renderer is ever used as a game
 * fact — the values it reports are only compared against the faces it was given,
 * so a physics or rendering bug can never change what happened.
 *
 * The renderer is loaded on demand, so importing this module costs nothing and
 * a test can substitute the boundary entirely.
 */

/**
 * Where the dice assets (`textures/`, `sounds/`) are served from. It follows
 * the bundle's base path, so the published demo works from a project subpath
 * (`/threepointpf/`) as well as from the root.
 */
export const diceAssetPath = `${(
  (import.meta.env?.BASE_URL as string | undefined) ?? "/"
).replace(/\/+$/, "")}/dice/`;

/** Stable id the overlay gives its stage element; the renderer needs a selector. */
export const diceStageSelector = "#dice-stage";

export interface DiceBoxOptions {
  assetPath: string;
  framerate: number;
  sounds: boolean;
  volume: number;
  shadows: boolean;
  theme_surface: string;
  sound_dieMaterial: string;
  theme_customColorset: {
    name: string;
    foreground: string;
    background: string;
    outline: string;
    edge?: string;
    texture: string;
    material: string;
  };
  theme_colorset: string;
  theme_texture: string;
  theme_material: string;
  gravity_multiplier: number;
  light_intensity: number;
  strength: number;
  iterationLimit: number;
}

/** The subset of the renderer this app uses. */
export interface DiceBoxHandle {
  initialize(): Promise<void>;
  roll(notation: string): Promise<unknown>;
  clear?(): void;
}

export interface DiceBoxInit {
  /** Selector the renderer resolves itself; it calls `document.querySelector`. */
  selector: string;
  options: DiceBoxOptions;
}

export type DiceBoxFactory = (init: DiceBoxInit) => DiceBoxHandle;

/** Stable identity of a skin plus the settings that change how dice are built. */
export function diceSkinKey(
  skin: DiceSkin,
  settings: DicePresentationSettings,
): string {
  return [
    skin.foreground,
    skin.background,
    skin.outline,
    skin.edge ?? "",
    skin.texture,
    skin.material,
    skin.surface,
    settings.sound ? "sound" : "silent",
    String(settings.intensity),
  ].join("|");
}

/**
 * The renderer's own configuration for a skin and the presentation settings.
 * Intensity scales the throw and the sound level together so one slider is
 * enough, and reduced motion never reaches here at all.
 */
export function diceBoxOptions(
  skin: DiceSkin,
  settings: DicePresentationSettings,
): DiceBoxOptions {
  // Intensity drives how energetic the throw is; the gravity and iteration
  // ceiling keep a high-intensity throw from tumbling for many seconds, which
  // matters because the result card is already on screen while it settles.
  const strength = 0.5 + settings.intensity / 100;
  return {
    assetPath: diceAssetPath,
    framerate: 1 / 60,
    sounds: settings.sound,
    volume: settings.intensity,
    shadows: true,
    theme_surface: skin.surface,
    sound_dieMaterial: skin.material,
    theme_customColorset: {
      name: `threepointpf-${diceSkinKey(skin, settings).replace(/[^a-z0-9]+/gi, "-")}`,
      foreground: skin.foreground,
      background: skin.background,
      outline: skin.outline,
      ...(skin.edge ? { edge: skin.edge } : {}),
      texture: skin.texture,
      material: skin.material,
    },
    theme_colorset: "white",
    theme_texture: skin.texture,
    theme_material: skin.material,
    gravity_multiplier: 480,
    light_intensity: 0.7,
    strength,
    iterationLimit: 700,
  };
}

/**
 * The renderer's own teardown API differs from its documentation: 0.0.12 has
 * `clearDice()` but no `clear()`, so both are accepted and a missing teardown is
 * never allowed to fail a throw.
 */
interface RendererInstance {
  initialize(): Promise<void>;
  roll(notation: string): Promise<unknown>;
  clear?(): void;
  clearDice?(): void;
}

/** Loads the renderer only when a throw is actually requested. */
export const defaultDiceBoxFactory: DiceBoxFactory = (init) => {
  let box: RendererInstance | null = null;
  return {
    async initialize() {
      const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
      const instance = new DiceBox(init.selector, init.options) as unknown as RendererInstance;
      await instance.initialize();
      box = instance;
    },
    async roll(notation: string) {
      if (!box) throw new Error("Dice renderer was not initialized");
      return box.roll(notation);
    },
    clear() {
      if (!box) return;
      try {
        if (typeof box.clear === "function") box.clear();
        else if (typeof box.clearDice === "function") box.clearDice();
      } catch {
        // Clearing the table is cosmetic; the next throw removes stale dice itself.
      }
    },
  };
};

/** Reads the values a renderer reports for the dice it rolled, when it reports them. */
export function renderedFaceValues(results: unknown): number[] | null {
  if (!results || typeof results !== "object") return null;
  const sets = (results as { sets?: unknown }).sets;
  if (!Array.isArray(sets)) return null;
  const values: number[] = [];
  for (const set of sets) {
    const dice = (set as { dice?: unknown }).dice;
    if (!Array.isArray(dice)) return null;
    for (const die of dice) {
      const value = (die as { value?: unknown }).value;
      if (typeof value !== "number") return null;
      values.push(value);
    }
  }
  return values;
}

function handoffOf(
  faces: readonly number[],
  results: unknown,
): "matched" | "mismatch" | "unreported" {
  const rendered = renderedFaceValues(results);
  if (!rendered) return "unreported";
  if (rendered.length !== faces.length) return "mismatch";
  return rendered.every((value, index) => value === faces[index])
    ? "matched"
    : "mismatch";
}

type AudioContextLike = {
  createOscillator(): {
    frequency: { value: number };
    connect(node: unknown): void;
    start(when?: number): void;
    stop(when?: number): void;
    type: string;
  };
  createGain(): {
    gain: {
      value: number;
      setValueAtTime(value: number, when: number): void;
      exponentialRampToValueAtTime(value: number, when: number): void;
    };
    connect(node: unknown): void;
  };
  destination: unknown;
  currentTime: number;
  state?: string;
  resume?(): Promise<void>;
};

/**
 * A short synthesized cue for a flourish. It is deliberately asset-free: the
 * flourish sounds are presentation only, and the renderer already owns the dice
 * and surface sounds. Absent Web Audio, this is a no-op.
 */
export function playFlourishCue(
  flourish: DiceFlourish,
  settings: DicePresentationSettings,
): boolean {
  if (!settings.sound || flourish.cue === "none" || settings.intensity <= 0)
    return false;
  const context = (globalThis as { AudioContext?: new () => AudioContextLike })
    .AudioContext;
  if (typeof context !== "function") return false;
  try {
    const audio = new context();
    void audio.resume?.();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const rise = flourish.cue === "rise";
    const now = audio.currentTime;
    const peak = (settings.intensity / 100) * 0.12;
    oscillator.type = rise ? "triangle" : "sine";
    oscillator.frequency.value = rise ? 420 : 260;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (rise ? 0.5 : 0.35));
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.55);
    return true;
  } catch {
    return false;
  }
}

export interface DiceBoxPresenterOptions {
  settings: DicePresentationSettings;
  /** Overridable so tests never load the renderer. */
  factory?: DiceBoxFactory;
  selector?: string;
  /** The stage element, for cleanup between throws and skin changes. */
  stage?: () => HTMLElement | null;
  /** Overridable so tests never touch Web Audio. */
  playCue?: (flourish: DiceFlourish, settings: DicePresentationSettings) => void;
}

/**
 * Wraps the renderer in the presenter contract. A skin (or intensity/sound)
 * change rebuilds the renderer, because the renderer's theme is fixed once it
 * is initialized; the previous canvas is removed with it.
 */
export function createDiceBoxPresenter(
  options: DiceBoxPresenterOptions,
): DicePresenter {
  const factory = options.factory ?? defaultDiceBoxFactory;
  const selector = options.selector ?? diceStageSelector;
  let settings = options.settings;
  let handle: DiceBoxHandle | null = null;
  let appliedKey: string | null = null;

  const clearStage = () => {
    const stage = options.stage?.();
    // The renderer appends its own canvas to the stage; leaving it behind would
    // stack a new one on every skin change.
    if (stage) stage.innerHTML = "";
  };

  const disposeHandle = () => {
    if (handle) {
      try {
        handle.clear?.();
      } catch {
        // A renderer that is already gone needs no teardown.
      }
    }
    handle = null;
    appliedKey = null;
    clearStage();
  };

  const ensure = async (
    skin: DiceSkin,
    requestSettings: DicePresentationSettings,
  ): Promise<DiceBoxHandle> => {
    const key = diceSkinKey(skin, requestSettings);
    if (handle && appliedKey === key) return handle;
    disposeHandle();
    const created = factory({
      selector,
      options: diceBoxOptions(skin, requestSettings),
    });
    try {
      await created.initialize();
    } catch (failure) {
      try {
        created.clear?.();
      } catch {
        // Best effort: the failed renderer may not have a teardown at all.
      }
      clearStage();
      throw failure;
    }
    handle = created;
    appliedKey = key;
    return created;
  };

  return {
    configure(next: DicePresentationSettings) {
      settings = next;
    },
    async present(
      request: DicePresentationRequest,
    ): Promise<DicePresentationReport> {
      if (settings.reducedMotion)
        return {
          mode: "skipped",
          reason: "reduced motion is enabled, so the throw is not animated",
        };
      if (!physicalFacesSupported(request.plan))
        return {
          mode: "fallback",
          reason: `this roll needs ${request.plan.dice.length} dice groups, which physical dice cannot force in one throw`,
        };
      let notation: string;
      try {
        notation = diceNotationFor(request.plan, request.faces);
      } catch (failure) {
        return {
          mode: "fallback",
          reason: failure instanceof Error ? failure.message : String(failure),
        };
      }
      if (options.playCue) options.playCue(request.flourish, settings);
      else playFlourishCue(request.flourish, settings);
      try {
        const box = await ensure(request.skin, settings);
        // Remove the previous throw so each roll starts from a clear table. A
        // renderer that cannot clear still gets to roll.
        try {
          box.clear?.();
        } catch {
          // Only the stale dice are lost, never the throw.
        }
        const results = await box.roll(notation);
        return {
          mode: "rendered",
          notation,
          handoff: handoffOf(request.faces, results),
        };
      } catch (failure) {
        disposeHandle();
        return {
          mode: "fallback",
          reason: failure instanceof Error ? failure.message : String(failure),
        };
      }
    },
    dispose: disposeHandle,
  };
}
