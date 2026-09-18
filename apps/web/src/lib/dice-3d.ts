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
  /**
   * Releases everything `initialize()` acquired: the renderer's listeners, its
   * WebGL context and its canvas. Presenter teardown prefers this over `clear`.
   */
  dispose?(): void;
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
 *
 * The remaining fields exist only so disposal can reach the resources upstream
 * never releases; none of them is read for a game fact.
 */
interface RendererInstance {
  initialize(): Promise<void>;
  roll(notation: string): Promise<unknown>;
  clear?(): void;
  clearDice?(): void;
  renderer?: {
    domElement?: {
      parentNode?: { removeChild?(node: unknown): void } | null;
      remove?(): void;
    } | null;
    dispose?(): void;
    forceContextLoss?(): void;
  } | null;
}

/** A `window`-like target the renderer subscribes to. */
export interface ResizeListenerTarget {
  addEventListener(type: string, listener: unknown, options?: unknown): void;
  removeEventListener(type: string, listener: unknown, options?: unknown): void;
}

type ResizeListener = (event: unknown) => void;

/**
 * Records the `resize` listeners the renderer registers while `run()` executes.
 *
 * Upstream's renderer subscribes to `window` resize and never unsubscribes. The
 * callback closes over the renderer, its stage element and its physics world, so
 * leaving it attached keeps a whole discarded renderer alive — on every skin
 * change and every teardown. The registration is the only handle on it, so it is
 * captured here; the listener still reaches the renderer exactly as before, and
 * the captured list is filled even when `run()` throws.
 */
export async function captureResizeListeners<T>(
  target: ResizeListenerTarget,
  sink: ResizeListener[],
  run: () => Promise<T>,
): Promise<T> {
  const previous = target.addEventListener;
  // Bound only for the forwarded call: `window.addEventListener` rejects an
  // unbound invocation, but what is restored afterwards must be exactly what was
  // there before, not a bound wrapper.
  const forward = previous.bind(target);
  target.addEventListener = (type: string, listener: unknown, options?: unknown) => {
    if (type === "resize" && typeof listener === "function")
      sink.push(listener as ResizeListener);
    forward(type, listener, options);
  };
  try {
    return await run();
  } finally {
    target.addEventListener = previous;
  }
}

/** Detaches listeners captured by {@link captureResizeListeners}. */
export function removeResizeListeners(
  target: ResizeListenerTarget,
  listeners: readonly ResizeListener[],
): void {
  for (const listener of listeners) {
    try {
      target.removeEventListener("resize", listener);
    } catch {
      // A target that is already gone has nothing left to unsubscribe from.
    }
  }
}

/**
 * Releases a renderer instance's own resources. `clearDice()` stops the
 * animation loop and drops the physics bodies, and it has to run while the
 * renderer still exists; after that the canvas is detached and the WebGL
 * context released, because dropping the canvas alone leaves the GL context —
 * and its GPU allocations — alive until the browser garbage-collects it. Every
 * step is best-effort: a partially initialized renderer must still tear down.
 */
export function disposeRendererInstance(instance: RendererInstance): void {
  try {
    if (typeof instance.clearDice === "function") instance.clearDice();
    else instance.clear?.();
  } catch {
    // The table is already going away.
  }
  const renderer = instance.renderer;
  if (!renderer) return;
  try {
    const canvas = renderer.domElement;
    if (canvas?.parentNode?.removeChild) canvas.parentNode.removeChild(canvas);
    else canvas?.remove?.();
  } catch {
    // Detaching is cosmetic once the stage itself is being cleared.
  }
  try {
    renderer.forceContextLoss?.();
  } catch {
    // A context that is already lost needs no further notice.
  }
  try {
    renderer.dispose?.();
  } catch {
    // Nothing left to release.
  }
}

/** Loads the renderer only when a throw is actually requested. */
async function loadDiceBoxModule() {
  const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
  return DiceBox as new (selector: string, options: DiceBoxOptions) => unknown;
}

export type DiceBoxModuleLoader = typeof loadDiceBoxModule;

export interface DiceBoxRendererOptions {
  /** Injectable so tests never load three.js, cannon-es or WebGL. */
  loadModule?: DiceBoxModuleLoader;
  /** The target the renderer subscribes to; `window` in a browser. */
  resizeTarget?: ResizeListenerTarget;
}

/**
 * The renderer factory, with the resource handling upstream omits.
 *
 * `initialize` captures the resize listeners the renderer adds; `dispose`
 * unsubscribes them, detaches the canvas and releases the WebGL context, so
 * rebuilding on a skin change (or tearing down the presenter) leaves nothing
 * behind. `clear` stays cheap and only empties the table between throws.
 */
export function createDiceBoxRenderer(
  options: DiceBoxRendererOptions = {},
): DiceBoxFactory {
  const loadModule = options.loadModule ?? loadDiceBoxModule;
  const resizeTarget =
    options.resizeTarget ?? (globalThis as unknown as ResizeListenerTarget);

  return (init) => {
    let box: RendererInstance | null = null;
    let resizeListeners: ResizeListener[] = [];
    return {
      async initialize() {
        const DiceBox = await loadModule();
        const instance = new DiceBox(init.selector, init.options) as unknown as RendererInstance;
        const captured: ResizeListener[] = [];
        try {
          await captureResizeListeners(resizeTarget, captured, () =>
            instance.initialize(),
          );
        } catch (failure) {
          // A half-initialized renderer has already taken a context and maybe a
          // listener; neither should outlive the failure.
          removeResizeListeners(resizeTarget, captured);
          disposeRendererInstance(instance);
          throw failure;
        }
        resizeListeners = captured;
        box = instance;
      },
      async roll(notation: string) {
        if (!box) throw new Error("Dice renderer was not initialized");
        return box.roll(notation);
      },
      clear() {
        if (!box) return;
        try {
          if (typeof box.clearDice === "function") box.clearDice();
          else box.clear?.();
        } catch {
          // Clearing the table is cosmetic; the next throw removes stale dice itself.
        }
      },
      dispose() {
        const instance = box;
        box = null;
        removeResizeListeners(resizeTarget, resizeListeners);
        resizeListeners = [];
        if (instance) disposeRendererInstance(instance);
      },
    };
  };
}

export const defaultDiceBoxFactory = createDiceBoxRenderer();

/**
 * Reads the values a renderer reports for the dice it rolled, when it reports
 * them. Upstream resolves a throw with `{ sets: [{ rolls: [{ value, ... }] }],
 * modifier, total }`: each die's final result is spread into the group's
 * `rolls` array. A response that does not have that shape is reported as
 * unreported rather than guessed at, so a renderer upgrade can never be
 * mistaken for agreement about the faces.
 */
export function renderedFaceValues(results: unknown): number[] | null {
  if (!results || typeof results !== "object") return null;
  const sets = (results as { sets?: unknown }).sets;
  if (!Array.isArray(sets)) return null;
  const values: number[] = [];
  for (const set of sets) {
    const rolls = (set as { rolls?: unknown }).rolls;
    if (!Array.isArray(rolls)) return null;
    for (const roll of rolls) {
      const value = (roll as { value?: unknown }).value;
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

/** A promise with its resolver exposed, for racing a throw against teardown. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

  /** Set while a throw is in flight, so teardown can settle it. */
  let abandon: (() => void) | null = null;
  /** The stage element the current handle drew into. */
  let appliedStage: HTMLElement | null = null;

  const disposeHandle = () => {
    const previous = handle;
    const inFlight = abandon;
    handle = null;
    appliedKey = null;
    appliedStage = null;
    abandon = null;
    // A throw whose renderer is going away has to be let go of. This is not just
    // tidiness: the presenter queues throws, so a promise that never settles
    // would wedge every later throw for the rest of the session.
    inFlight?.();
    if (previous) {
      try {
        // `dispose` is the real teardown; `clear` is the fallback for a handle
        // that has nothing to release.
        if (typeof previous.dispose === "function") previous.dispose();
        else previous.clear?.();
      } catch {
        // A renderer that is already gone needs no teardown.
      }
    }
    clearStage();
  };

  const ensure = async (
    skin: DiceSkin,
    requestSettings: DicePresentationSettings,
  ): Promise<DiceBoxHandle> => {
    const key = diceSkinKey(skin, requestSettings);
    // The renderer resolves its container once, when it is constructed, and
    // appends its own canvas to it. A remounted stage — the overlay is dismissed
    // and opened again — is therefore a different container, and reusing the
    // cached renderer would animate a detached element that is no longer on
    // screen: a rendered report with no visible dice.
    const stage = options.stage?.() ?? null;
    if (handle && appliedKey === key && appliedStage === stage) return handle;
    disposeHandle();
    const created = factory({
      selector,
      options: diceBoxOptions(skin, requestSettings),
    });
    try {
      await created.initialize();
    } catch (failure) {
      try {
        if (typeof created.dispose === "function") created.dispose();
        else created.clear?.();
      } catch {
        // Best effort: the failed renderer may not have a teardown at all.
      }
      clearStage();
      throw failure;
    }
    handle = created;
    appliedKey = key;
    appliedStage = stage;
    return created;
  };

  /**
   * Presentations are queued, never concurrent. The renderer owns one stage,
   * one physics world and one animation loop, so starting a throw while another
   * is still landing would interrupt it mid-flight and could leave it reporting
   * the wrong faces. Each caller still gets its own report.
   */
  let queue: Promise<unknown> = Promise.resolve();

  const render = async (
    request: DicePresentationRequest,
  ): Promise<DicePresentationReport> => {
    if (settings.reducedMotion)
      return {
        mode: "skipped",
        reason: "reduced motion is enabled, so the throw is not animated",
      };
    if (!physicalFacesSupported(request.plan))
      return {
        mode: "fallback",
        reason: "this roll needs no dice, so there is nothing for physical dice to land on",
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
      // The renderer settles its own roll promise from inside its animation
      // loop, and tearing that loop down is exactly what disposal does — so a
      // throw stopped mid-flight would otherwise never report at all. Racing it
      // against teardown keeps the queue moving.
      const stopped = deferred<"abandoned">();
      abandon = () => stopped.resolve("abandoned");
      try {
        const outcome = await Promise.race([box.roll(notation), stopped.promise]);
        if (outcome === "abandoned")
          return {
            mode: "skipped",
            reason: "the throw was stopped before the dice landed",
          };
        return {
          mode: "rendered",
          notation,
          handoff: handoffOf(request.faces, outcome),
        };
      } finally {
        abandon = null;
      }
    } catch (failure) {
      disposeHandle();
      return {
        mode: "fallback",
        reason: failure instanceof Error ? failure.message : String(failure),
      };
    }
  };

  return {
    configure(next: DicePresentationSettings) {
      settings = next;
    },
    present(request: DicePresentationRequest): Promise<DicePresentationReport> {
      const next = queue.then(
        () => render(request),
        () => render(request),
      );
      // The chain has to survive a failed presentation, or every later throw
      // would inherit the rejection instead of running.
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    dispose: disposeHandle,
  };
}
