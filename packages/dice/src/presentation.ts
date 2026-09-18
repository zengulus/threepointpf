import type { RollOutcome, RollPlan } from "@threepointpf/rules-schema";
import { formatDiceExpression, validateFaces } from "./faces.js";

/**
 * Dice presentation: how an already-resolved roll is *shown*. Nothing in this
 * module decides a game outcome.
 *
 * The authoritative raw faces are generated first and resolved by the rules
 * engine; the renderer is then handed exactly those faces and is asked to land
 * the 3D dice on them. Physics and rendering can therefore never change what
 * happened, and this module never re-derives a rule: it reads the facts the
 * resolution already put on `RollOutcome` plus the plan's own context.
 *
 * Presentation preferences are user-facing display settings. They are never
 * written into authored character state, so a table's dice skin and flourishes
 * cannot travel into a character snapshot.
 */

/** The presentations a resolved roll can ask for. */
export const rollPresentationEvents = [
  "critical-success",
  "critical-failure",
  "natural-20",
  "natural-1",
  "none",
] as const;
export type RollPresentationEvent = (typeof rollPresentationEvents)[number];

export interface RollPresentation {
  event: RollPresentationEvent;
  /** True when this roll is a combat roll (an attack or a save). */
  combat: boolean;
  /** Why this event was chosen. Derived from resolved facts, not re-derived rules. */
  reason: string;
}

/**
 * Classifies a resolved roll for presentation. It reads only facts resolution
 * already established, so the renderer never duplicates a game rule:
 *
 * - a rule-classified critical outcome takes the combat critical slots;
 * - a natural face that carried an automatic hit/success or automatic
 *   miss/failure on a combat roll (attacks and saves) takes the combat slots,
 *   because that is the dramatic beat of a save;
 * - every other natural 20 / natural 1 takes the natural-face slots;
 * - anything else has no special presentation.
 */
export function classifyRollPresentation(
  plan: RollPlan,
  outcome: RollOutcome,
): RollPresentation {
  const combat =
    plan.outcomePolicy.kind === "attack" || plan.context.kind === "save";
  if (outcome.kind === "criticalSuccess")
    return {
      event: "critical-success",
      combat,
      reason: "resolved as a critical success",
    };
  if (outcome.kind === "criticalFailure")
    return {
      event: "critical-failure",
      combat,
      reason: "resolved as a critical failure",
    };
  if (outcome.natural20 && (outcome.automaticHit || outcome.automaticSuccess))
    return {
      event: combat ? "critical-success" : "natural-20",
      combat,
      reason: combat
        ? "natural 20 decided the outcome outright"
        : "natural 20 on a non-combat check",
    };
  if (outcome.natural1 && (outcome.automaticMiss || outcome.automaticFailure))
    return {
      event: combat ? "critical-failure" : "natural-1",
      combat,
      reason: combat
        ? "natural 1 decided the outcome outright"
        : "natural 1 on a non-combat check",
    };
  if (outcome.natural20)
    return { event: "natural-20", combat, reason: "natural 20" };
  if (outcome.natural1)
    return { event: "natural-1", combat, reason: "natural 1" };
  if (outcome.critical === true)
    return {
      event: "critical-success",
      combat,
      reason: "the natural face was inside the threat range and hit",
    };
  return {
    event: "none",
    combat,
    reason: plan.primaryCheckDie
      ? "the roll produced no special natural face or critical outcome"
      : "this roll has no natural-face semantics",
  };
}

/**
 * A selectable flourish/indicator. `motion` is a stable slug the DOM exposes as
 * `data-motion`, so the stylesheet owns the actual animation and a new flourish
 * is a registry entry plus a rule.
 */
export interface DiceFlourish {
  id: string;
  label: string;
  description: string;
  motion: string;
  /** Relative acoustic cue a presenter may synthesize; never a rules fact. */
  cue: "none" | "rise" | "fall" | "accent";
}

export const diceFlourishes: DiceFlourish[] = [
  {
    id: "none",
    label: "None",
    description: "Show the result with no flourish at all.",
    motion: "none",
    cue: "none",
  },
  {
    id: "pulse",
    label: "Pulse",
    description: "A single ring of light expanding from the landing die.",
    motion: "pulse",
    cue: "accent",
  },
  {
    id: "sparks",
    label: "Sparks",
    description: "Short radial sparks from the landing die.",
    motion: "sparks",
    cue: "rise",
  },
  {
    id: "impact",
    label: "Impact",
    description: "A quick shake and a flash around the landing die.",
    motion: "impact",
    cue: "fall",
  },
  {
    id: "flare",
    label: "Flare",
    description: "A soft glow around the landing die.",
    motion: "flare",
    cue: "rise",
  },
  {
    id: "shards",
    label: "Shards",
    description: "Fragments scattering from the landing die.",
    motion: "shards",
    cue: "fall",
  },
];

export const noneDiceFlourish = diceFlourishes[0]!;

export function findDiceFlourish(id: string | undefined): DiceFlourish {
  return diceFlourishes.find((flourish) => flourish.id === id) ?? noneDiceFlourish;
}

/**
 * A dice skin is colours, a texture, a material and a table surface: the exact
 * axes the 3D renderer exposes, described as data so the settings UI and the
 * renderer adapter share one vocabulary.
 */
export interface DiceSkin {
  foreground: string;
  background: string;
  outline: string;
  edge?: string;
  /** Texture id from {@link diceTextureOptions}. */
  texture: string;
  /** Material id from {@link diceMaterialOptions}. */
  material: string;
  /** Surface id from {@link diceSurfaceOptions}. */
  surface: string;
}

export interface DiceSkinPreset extends DiceSkin {
  id: string;
  label: string;
  description: string;
}

export const diceSkinPresets: DiceSkinPreset[] = [
  {
    id: "obsidian",
    label: "Obsidian Gold",
    description: "Near-black dice with gilded numerals on an old table.",
    foreground: "#f3c877",
    background: "#15110c",
    outline: "#000000",
    edge: "#f3c877",
    texture: "none",
    material: "metal",
    surface: "taverntable",
  },
  {
    id: "arcane",
    label: "Arcane Amethyst",
    description: "Cloudy violet glass that reads well against the dark sheet.",
    foreground: "#e2d2ff",
    background: "#2a1c4d",
    outline: "#120720",
    texture: "cloudy",
    material: "glass",
    surface: "cyberpunk",
  },
  {
    id: "ember",
    label: "Ember Glass",
    description: "Warm ember numerals in dark glass on steel.",
    foreground: "#ffd9a3",
    background: "#451a10",
    outline: "#1a0906",
    texture: "fire",
    material: "glass",
    surface: "stainless",
  },
  {
    id: "verdant",
    label: "Verdant Felt",
    description: "Classic green table dice for a plain table look.",
    foreground: "#c8f7d0",
    background: "#14321f",
    outline: "#04120a",
    texture: "none",
    material: "plastic",
    surface: "green-felt",
  },
  {
    id: "ivory",
    label: "Ivory Marble",
    description: "Light marble dice with dark numerals.",
    foreground: "#2b2b34",
    background: "#f2eee3",
    outline: "#b6ab92",
    texture: "marble",
    material: "glass",
    surface: "blue-felt",
  },
  {
    id: "bone",
    label: "Ashen Bone",
    description: "Speckled bone-white dice on mahogany.",
    foreground: "#efe8d6",
    background: "#39352d",
    outline: "#14120e",
    texture: "speckles",
    material: "wood",
    surface: "mahogany",
  },
  {
    id: "glitter",
    label: "Glitterstorm",
    description: "Sparkling dice for tables that like a little chaos.",
    foreground: "#ffe9f7",
    background: "#5a2b62",
    outline: "#220a29",
    texture: "glitter",
    material: "plastic",
    surface: "red-felt",
  },
];

export const defaultDiceSkinPreset = diceSkinPresets[0]!;

export interface DiceSkinOption {
  id: string;
  label: string;
}

/** Dice colours are authored as six-digit hex so the renderer gets one form. */
export const diceColorPattern = /^#[0-9a-f]{6}$/i;

export function isValidDiceColor(value: unknown): value is string {
  return typeof value === "string" && diceColorPattern.test(value.trim());
}

/** Texture ids the 3D renderer ships; `none` keeps a flat colour. */
export const diceTextureOptions: DiceSkinOption[] = [
  { id: "none", label: "None (flat colour)" },
  { id: "cloudy", label: "Clouds (transparent)" },
  { id: "cloudy_2", label: "Clouds" },
  { id: "fire", label: "Fire" },
  { id: "marble", label: "Marble" },
  { id: "water", label: "Water" },
  { id: "ice", label: "Ice" },
  { id: "paper", label: "Paper" },
  { id: "speckles", label: "Speckles" },
  { id: "glitter", label: "Glitter" },
  { id: "stars", label: "Stars" },
  { id: "stainedglass", label: "Stained glass" },
  { id: "wood", label: "Wood grain" },
  { id: "metal", label: "Brushed metal" },
  { id: "skulls", label: "Skulls" },
  { id: "dragon", label: "Dragon scale" },
  { id: "astral", label: "Astral sea" },
];

export const diceMaterialOptions: DiceSkinOption[] = [
  { id: "plastic", label: "Plastic" },
  { id: "metal", label: "Metal" },
  { id: "wood", label: "Wood" },
  { id: "glass", label: "Glass" },
  { id: "none", label: "Matte (no sheen)" },
];

/** Table surfaces, which also select the impact sounds the renderer emits. */
export const diceSurfaceOptions: DiceSkinOption[] = [
  { id: "taverntable", label: "Old tavern table" },
  { id: "mahogany", label: "Mahogany" },
  { id: "green-felt", label: "Green felt" },
  { id: "blue-felt", label: "Blue felt" },
  { id: "red-felt", label: "Red felt" },
  { id: "stainless", label: "Stainless steel" },
  { id: "cyberpunk", label: "Neo-future city" },
  { id: "cagetown", label: "Cage town" },
  { id: "default", label: "Solid colour" },
];

export interface DicePresentationSettings {
  /** A preset id, or `custom` to use `customSkin`. */
  skinId: string;
  customSkin: DiceSkin;
  /** Flourish per presentation slot. */
  flourishes: {
    ordinary: string;
    criticalSuccess: string;
    criticalFailure: string;
    natural20: string;
    natural1: string;
  };
  /** Play the renderer's dice and surface sounds. */
  sound: boolean;
  /** 0–100: throw strength, flourish amplitude and sound level together. */
  intensity: number;
  /** Skip the animated throw and flourishes, showing the result directly. */
  reducedMotion: boolean;
}

export const customDiceSkinId = "custom";

export const defaultDicePresentationSettings: DicePresentationSettings = {
  skinId: defaultDiceSkinPreset.id,
  customSkin: {
    foreground: defaultDiceSkinPreset.foreground,
    background: defaultDiceSkinPreset.background,
    outline: defaultDiceSkinPreset.outline,
    edge: defaultDiceSkinPreset.edge,
    texture: defaultDiceSkinPreset.texture,
    material: defaultDiceSkinPreset.material,
    surface: defaultDiceSkinPreset.surface,
  },
  flourishes: {
    ordinary: "none",
    criticalSuccess: "sparks",
    criticalFailure: "impact",
    natural20: "pulse",
    natural1: "flare",
  },
  sound: true,
  intensity: 60,
  reducedMotion: false,
};

/** The resolved skin a renderer should apply. */
export function activeDiceSkin(settings: DicePresentationSettings): DiceSkin {
  if (settings.skinId === customDiceSkinId) return settings.customSkin;
  const preset =
    diceSkinPresets.find((entry) => entry.id === settings.skinId) ??
    defaultDiceSkinPreset;
  return {
    foreground: preset.foreground,
    background: preset.background,
    outline: preset.outline,
    edge: preset.edge,
    texture: preset.texture,
    material: preset.material,
    surface: preset.surface,
  };
}

/** The flourish a resolved roll's presentation should play. */
export function flourishFor(
  settings: DicePresentationSettings,
  event: RollPresentationEvent,
): DiceFlourish {
  if (event === "critical-success")
    return findDiceFlourish(settings.flourishes.criticalSuccess);
  if (event === "critical-failure")
    return findDiceFlourish(settings.flourishes.criticalFailure);
  if (event === "natural-20")
    return findDiceFlourish(settings.flourishes.natural20);
  if (event === "natural-1")
    return findDiceFlourish(settings.flourishes.natural1);
  return findDiceFlourish(settings.flourishes.ordinary);
}

/** Whether the OS asks authors to reduce motion, when that is observable. */
export function systemPrefersReducedMotion(): boolean {
  const query = (
    globalThis as {
      matchMedia?: (query: string) => { matches: boolean };
    }
  ).matchMedia;
  if (typeof query !== "function") return false;
  try {
    return query("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Whether a roll can be landed physically. The renderer takes a whole roll as
 * one notation string with a single predetermined face list, and it applies
 * those faces by die across every group in order — so several groups are simply
 * one throw (`1d20+2d6@17,4,3`), and only a plan that needs no dice at all has
 * nothing to land on.
 */
export function physicalFacesSupported(plan: RollPlan): boolean {
  return plan.dice.some((group) => group.count > 0);
}

/**
 * The notation the renderer rolls, carrying the authoritative faces. The faces
 * are generated before this is called and are the same ones that were resolved,
 * flattened in group order — the order the renderer applies them in.
 *
 * The renderer reads one face list for the whole roll and assigns it by die
 * across the groups, so several groups stay a single throw. It does merge
 * repeated die types into one group (`1d6+1d8+1d6` lands as `2d6 + 1d8`); the
 * flattened sequence, which is what resolution used and what the handoff check
 * compares, is preserved either way, so only the shape drawn for each face can
 * differ when a plan interleaves the same die type.
 */
export function diceNotationFor(
  plan: RollPlan,
  faces: readonly number[],
): string {
  validateFaces(plan, faces);
  if (!physicalFacesSupported(plan))
    throw new Error(
      `Roll plan ${plan.id} needs no dice, so there is nothing for physical dice to land on`,
    );
  return `${plan.dice.map(formatDiceExpression).join("+")}@${faces.join(",")}`;
}

/**
 * How a presentation actually finished: `rendered` means the 3D dice landed on
 * the authoritative faces, `fallback` means the renderer was unavailable and the
 * result is shown without it, and `skipped` means the settings asked for no
 * animation. The authoritative result is displayed in all three cases.
 */
export type DicePresentationMode = "rendered" | "fallback" | "skipped";

export interface DicePresentationRequest {
  plan: RollPlan;
  /** The authoritative faces, already resolved against the plan. */
  faces: number[];
  event: RollPresentationEvent;
  flourish: DiceFlourish;
  skin: DiceSkin;
  settings: DicePresentationSettings;
}

/**
 * Where a landed die sits on screen, normalized within the stage element
 * (`0`–`1`, origin top-left). This is the only thing a renderer may contribute
 * to the result display, and it is a position only: the value shown against a
 * die is always the authoritative `ResolvedRoll` face, never the renderer's own
 * idea of what it rolled.
 */
export interface DicePresentationAnchor {
  /** Flattened face index in the plan's dice order, the order resolution used. */
  faceIndex: number;
  x: number;
  y: number;
}

export interface DicePresentationReport {
  mode: DicePresentationMode;
  /** The notation handed to the renderer, when it rendered. */
  notation?: string;
  reason?: string;
  /**
   * Whether the renderer's own reported faces matched the authoritative faces
   * it was asked to land on. A mismatch never changes the result; it is surfaced
   * so a renderer bug cannot quietly become a game fact.
   */
  handoff?: "matched" | "mismatch" | "unreported";
  /**
   * The landed die positions, so a rolled value can rise from the die it was
   * actually rolled on. Absent when the renderer could not report a position,
   * in which case the result is shown without anchoring to physical dice.
   */
  anchors?: DicePresentationAnchor[];
}

/** The boundary a browser renderer implements. It only ever animates faces. */
export interface DicePresenter {
  present(request: DicePresentationRequest): Promise<DicePresentationReport>;
  /** Applies new settings; the next presentation uses them. */
  configure(settings: DicePresentationSettings): void;
  dispose(): void;
}

/** Used when no renderer is configured, so callers need no null checks. */
export class NullDicePresenter implements DicePresenter {
  async present(): Promise<DicePresentationReport> {
    return { mode: "skipped", reason: "no dice renderer is configured" };
  }
  configure(): void {}
  dispose(): void {}
}
