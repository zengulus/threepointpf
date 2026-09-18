/**
 * `@3d-dice/dice-box-threejs` ships no type declarations. Only the surface this
 * app uses is declared, and the adapter in `lib/dice-3d.ts` narrows it further
 * to its own `DiceBoxHandle`, so the untyped library never leaks into the app.
 */
declare module "@3d-dice/dice-box-threejs" {
  export interface DiceBoxConstructorOptions {
    assetPath?: string;
    framerate?: number;
    sounds?: boolean;
    volume?: number;
    color_spotlight?: number;
    shadows?: boolean;
    theme_surface?: string;
    sound_dieMaterial?: string;
    theme_customColorset?: Record<string, unknown> | null;
    theme_colorset?: string;
    theme_texture?: string;
    theme_material?: string;
    gravity_multiplier?: number;
    light_intensity?: number;
    baseScale?: number;
    strength?: number;
    iterationLimit?: number;
    onRollComplete?: (results: unknown) => void;
  }
  export default class DiceBox {
    constructor(selector: string, options?: DiceBoxConstructorOptions);
    initialize(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    clear(): void;
    updateConfig(options?: DiceBoxConstructorOptions): Promise<void>;
  }
}
