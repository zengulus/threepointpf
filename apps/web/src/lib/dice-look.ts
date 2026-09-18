import { hexToRgb } from "./dice-scene";

/**
 * The renderer's own appearance, driven by the skin the settings resolved.
 *
 * Upstream 0.0.12 leaves two of the skin's axes inert, and both are fixed here at
 * the Three.js level rather than around it:
 *
 * - `theme_surface` selects the impact *sounds* only: the scene's surface is a
 *   `ShadowMaterial` backdrop that renders nothing except the dice's shadow, so
 *   the selected table never appears. {@link createSurfaceApplier} turns that
 *   backdrop into an opaque plate wearing a generated table texture — wood grain,
 *   felt fibre, brushed metal — under a single neutral light, so the surface
 *   changes the desk without recolouring the dice or the light falling on them.
 * - every die material multiplies its baked canvas texture by the preset's own
 *   tint (`0xB5B5B5` matte, `0xDDDDDD` metal) and, for the metallic presets,
 *   scales that texture away by a `metalness` with no environment map to reflect.
 *   {@link normalizeDieMaterial} restores the authored colours.
 *
 * Nothing here decides a game fact: it only writes appearance into objects the
 * renderer already owns, and the plate and its texture are ours, so everything
 * this module allocates is ours to release.
 */

/** A three.js colour, as much of it as this module uses. */
export interface SceneColorLike {
  setRGB(red: number, green: number, blue: number): void;
}

/**
 * A three.js material, as much of it as this module uses. Every field is
 * optional so a renderer that gains new material classes is read leniently.
 */
export interface SceneMaterialLike {
  color?: SceneColorLike;
  emissive?: SceneColorLike;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  /** A glass preset's transmission; the table's is neutralised explicitly. */
  transmission?: number;
  /** Only meaningful with an environment map, which this renderer ships none of. */
  envMapIntensity?: number;
  map?: unknown;
  bumpMap?: unknown;
  normalMap?: unknown;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  side?: number;
  needsUpdate?: boolean;
  dispose?(): void;
  clone?(): unknown;
}

/** A three.js mesh, as much of it as this module uses. */
export interface SceneMeshLike {
  material?: unknown;
  receiveShadow?: boolean;
}

/** A three.js light, as much of it as this module uses. */
export interface SceneLightLike {
  color?: SceneColorLike;
  groundColor?: SceneColorLike;
  intensity?: number;
}

/** A canvas-backed texture, as much of it as this module uses. */
export interface SceneTextureLike {
  needsUpdate?: boolean;
  wrapS?: number;
  wrapT?: number;
  minFilter?: number;
  magFilter?: number;
  generateMipmaps?: boolean;
  repeat?: { x: number; y: number; set?(x: number, y: number): void };
  dispose?(): void;
}

/** The parts of the renderer's scene a surface is applied to. */
export interface DiceLookTarget {
  /** The mesh upstream uses to catch shadows; it becomes the surface plate. */
  desk?: SceneMeshLike | null;
  light?: SceneLightLike | null;
  light_amb?: SceneLightLike | null;
}

/* ------------------------------------------------------------------ *
 * Numeral legibility.
 * ------------------------------------------------------------------ */

/**
 * The automatic outline a numeral gets, from its own fill colour.
 *
 * The renderer strokes its baked numerals with this colour before filling them,
 * so a die with light numerals gets a dark outline and a die with dark numerals
 * gets an off-white one. It is derived rather than exposed: the setting that
 * matters is the fill the user chose, and a numeral that cannot be read on the
 * die it was painted on is a defect, not a preference.
 *
 * The threshold is proper sRGB relative luminance, so a saturated mid-tone is
 * judged the way the eye sees it rather than by its raw channel average.
 */
export function readableNumeralOutline(foreground: string): string {
  const [red, green, blue] = hexToRgb(foreground);
  const luminance =
    0.2126 * relativeLuminance(red) +
    0.7152 * relativeLuminance(green) +
    0.0722 * relativeLuminance(blue);
  return luminance > 0.4 ? "#050608" : "#f7f7f2";
}

/** One sRGB channel, linearised exactly as WCAG defines it. */
function relativeLuminance(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/* ------------------------------------------------------------------ *
 * Surfaces.
 * ------------------------------------------------------------------ */

/** The generated table patterns. */
export type DiceSurfaceKind =
  | "solid"
  | "wood"
  | "felt"
  | "brushed-metal"
  | "cyber-grid"
  | "stone";

/**
 * One surface: the texture the desk is painted with, and how its material
 * renders it. The desk's colour lives in the generated texture's tint, so the
 * material itself stays white and cannot multiply the map dark.
 */
export interface DiceSurfaceLook {
  kind: DiceSurfaceKind;
  tint: string;
  roughness: number;
  metalness: number;
  textureScale: number;
}

/**
 * The looks, one per `diceSurfaceOptions` id. Each is a real texture — grain,
 * fibre, brushed hairlines, a neon grid, stone speckle — rather than a colour
 * and a coloured light: the light on the dice is neutral and identical for every
 * surface, so switching the table never recolours the dice.
 */
export const diceSurfaceLooks: Record<string, DiceSurfaceLook> = {
  default: {
    kind: "solid",
    tint: "#22262c",
    roughness: 0.9,
    metalness: 0,
    textureScale: 1,
  },
  taverntable: {
    kind: "wood",
    tint: "#6b4528",
    roughness: 0.78,
    metalness: 0,
    textureScale: 3,
  },
  mahogany: {
    kind: "wood",
    tint: "#4a1e17",
    roughness: 0.7,
    metalness: 0,
    textureScale: 3,
  },
  "green-felt": {
    kind: "felt",
    tint: "#245b3b",
    roughness: 1,
    metalness: 0,
    textureScale: 10,
  },
  "blue-felt": {
    kind: "felt",
    tint: "#24466f",
    roughness: 1,
    metalness: 0,
    textureScale: 10,
  },
  "red-felt": {
    kind: "felt",
    tint: "#6a2833",
    roughness: 1,
    metalness: 0,
    textureScale: 10,
  },
  stainless: {
    kind: "brushed-metal",
    tint: "#9da5ad",
    roughness: 0.32,
    metalness: 0.7,
    textureScale: 6,
  },
  cyberpunk: {
    kind: "cyber-grid",
    tint: "#171526",
    roughness: 0.55,
    metalness: 0.15,
    textureScale: 1,
  },
  cagetown: {
    kind: "stone",
    tint: "#4c4941",
    roughness: 0.96,
    metalness: 0,
    textureScale: 5,
  },
};

export const defaultDiceSurfaceLook: DiceSurfaceLook = diceSurfaceLooks.default!;

/** The look for a surface id, falling back to the neutral plate. */
export function diceSurfaceLook(surface: string): DiceSurfaceLook {
  return diceSurfaceLooks[surface] ?? defaultDiceSurfaceLook;
}

/* ------------------------------------------------------------------ *
 * Neutral lighting.
 * ------------------------------------------------------------------ */

/**
 * The one light every surface is thrown under. It does not change with the
 * desk: a felt table, mahogany and stainless steel are the same illumination
 * with a different surface, so the user's foreground, background and edge
 * colours read the same wherever the dice land.
 */
export const neutralDiceLighting = {
  spot: { color: "#ffffff", intensity: 0.9 },
  ambient: { sky: "#ffffff", ground: "#343941", intensity: 0.45 },
} as const;

/** Applies the neutral dice light to the scene's two lights. */
export function applyNeutralDiceLighting(target: DiceLookTarget): boolean {
  let changed = false;
  const spot = target.light;
  if (spot) {
    applyColor(spot.color, neutralDiceLighting.spot.color);
    if (typeof spot.intensity === "number") {
      spot.intensity = neutralDiceLighting.spot.intensity;
      changed = true;
    }
  }
  const ambient = target.light_amb;
  if (ambient) {
    applyColor(ambient.color, neutralDiceLighting.ambient.sky);
    applyColor(ambient.groundColor, neutralDiceLighting.ambient.ground);
    if (typeof ambient.intensity === "number") {
      ambient.intensity = neutralDiceLighting.ambient.intensity;
      changed = true;
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ *
 * Generated table textures.
 * ------------------------------------------------------------------ */

/** Edge length of every generated surface canvas. */
export const surfaceTextureSize = 512;

/** Canvas factories return null when the runtime has no document. */
export type SurfaceCanvasFactory = () => HTMLCanvasElement | null;

/** The slice of a 2D context this module draws with. */
export interface SurfaceCanvas2D {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(
    controlX: number,
    controlY: number,
    x: number,
    y: number,
  ): void;
  stroke(): void;
  fill(): void;
  drawImage?(
    image: unknown,
    dx: number,
    dy: number,
    width: number,
    height: number,
  ): void;
}

function defaultSurfaceCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

/**
 * Draws the surface pattern for a look onto a fresh 512×512 canvas.
 *
 * Everything is deterministic: the same kind and tint always produce the same
 * pixels, so a test can compare two generations and the desk does not shimmer
 * when it is rebuilt. There is no unseeded randomness anywhere.
 */
export function createSurfaceCanvas(
  kind: DiceSurfaceKind,
  tint: string,
  createCanvas: SurfaceCanvasFactory = defaultSurfaceCanvas,
): HTMLCanvasElement | null {
  const canvas = createCanvas();
  if (!canvas) return null;
  canvas.width = surfaceTextureSize;
  canvas.height = surfaceTextureSize;
  const context = canvas.getContext("2d") as unknown as SurfaceCanvas2D | null;
  if (!context) return null;
  const size = surfaceTextureSize;
  const random = seededRandom(seedFor(kind, tint));
  context.globalAlpha = 1;
  context.fillStyle = tint;
  context.fillRect(0, 0, size, size);
  if (kind === "wood") drawWood(context, size, random);
  else if (kind === "felt") drawFelt(context, size, tint, random);
  else if (kind === "brushed-metal")
    drawBrushedMetal(context, size, tint, random);
  else if (kind === "cyber-grid") drawCyberGrid(context, size);
  else if (kind === "stone") drawStone(context, size, tint, random);
  return canvas;
}

/** A small, fast, deterministic PRNG; the same seed is the same sequence. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the look, so each kind and tint seeds its own pattern. */
function seedFor(kind: string, tint: string): number {
  let hash = 0x811c9dc5;
  const text = `${kind}:${tint}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Rgb = readonly [number, number, number];

function channelsOf(hex: string): Rgb {
  const [red, green, blue] = hexToRgb(hex);
  return [
    Math.round(red * 255),
    Math.round(green * 255),
    Math.round(blue * 255),
  ];
}

function mix(hex: string, target: Rgb, amount: number): Rgb {
  const base = channelsOf(hex);
  return [
    Math.round(base[0] + (target[0] - base[0]) * amount),
    Math.round(base[1] + (target[1] - base[1]) * amount),
    Math.round(base[2] + (target[2] - base[2]) * amount),
  ];
}

function rgba(channels: Rgb, alpha: number): string {
  const value = Math.max(0, Math.min(1, alpha));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${value.toFixed(4)})`;
}

const white: Rgb = [255, 255, 255];
const black: Rgb = [0, 0, 0];
const darkGrain: Rgb = [26, 14, 6];

/** An ellipse approximated with line segments, so no canvas transform is used. */
function ellipsePath(
  context: SurfaceCanvas2D,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
): void {
  const steps = 24;
  context.beginPath();
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const x = centreX + Math.cos(angle) * radiusX;
    const y = centreY + Math.sin(angle) * radiusY;
    if (step === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/**
 * Wood: about ninety wavy horizontal grain lines and eight stretched knots.
 * Tavern and mahogany share this generator; only their tint differs.
 */
function drawWood(
  context: SurfaceCanvas2D,
  size: number,
  random: () => number,
): void {
  const lines = 90;
  for (let index = 0; index < lines; index += 1) {
    const base = ((index + 0.5) / lines) * size + (random() - 0.5) * 8;
    context.strokeStyle = rgba(random() < 0.5 ? black : darkGrain, 0.035 + random() * 0.065);
    context.lineWidth = 0.5 + random() * 1.5;
    context.beginPath();
    const segments = 4;
    let x = 0;
    let y = base;
    context.moveTo(0, base);
    for (let segment = 1; segment <= segments; segment += 1) {
      const nextX = (size / segments) * segment;
      const nextY = base + (random() - 0.5) * 8;
      context.quadraticCurveTo(
        (x + nextX) / 2,
        (y + nextY) / 2 + (random() - 0.5) * 8,
        nextX,
        nextY,
      );
      x = nextX;
      y = nextY;
    }
    context.stroke();
  }
  for (let knot = 0; knot < 8; knot += 1) {
    const centreX = random() * size;
    const centreY = random() * size;
    const radiusX = 12 + random() * 22;
    const radiusY = radiusX * (0.4 + random() * 0.5);
    const rings = 3 + Math.floor(random() * 3);
    for (let ring = 0; ring < rings; ring += 1) {
      const shrink = 1 - (ring / (rings + 1)) * 0.7;
      context.strokeStyle = rgba(darkGrain, 0.02 + random() * 0.055);
      context.lineWidth = 0.75;
      ellipsePath(context, centreX, centreY, radiusX * shrink, radiusY * shrink);
      context.stroke();
    }
  }
}

/** Felt: about twelve thousand one-pixel fibres, half lighter, half darker. */
function drawFelt(
  context: SurfaceCanvas2D,
  size: number,
  tint: string,
  random: () => number,
): void {
  const lighter = mix(tint, white, 0.28);
  const darker = mix(tint, black, 0.28);
  for (let fibre = 0; fibre < 12000; fibre += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    context.fillStyle = rgba(
      random() < 0.5 ? lighter : darker,
      0.025 + random() * 0.055,
    );
    context.fillRect(x, y, 1, 1);
  }
}

/** Brushed metal: three hundred hairlines under a subtle vertical wash. */
function drawBrushedMetal(
  context: SurfaceCanvas2D,
  size: number,
  tint: string,
  random: () => number,
): void {
  const lighter = mix(tint, white, 0.35);
  const darker = mix(tint, black, 0.35);
  for (let line = 0; line < 300; line += 1) {
    const y = random() * size;
    context.strokeStyle = rgba(
      line % 2 === 0 ? lighter : darker,
      0.02 + random() * 0.05,
    );
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size, y);
    context.stroke();
  }
  const bands = 32;
  for (let band = 0; band < bands; band += 1) {
    const t = band / (bands - 1);
    const bandHeight = size / bands + 1;
    context.fillStyle = rgba(white, 0.06 * (1 - t));
    context.fillRect(0, (size / bands) * band, size, bandHeight);
    context.fillStyle = rgba(black, 0.04 * t);
    context.fillRect(0, (size / bands) * band, size, bandHeight);
  }
}

/** Cyber grid: minor and major cyan grid lines with a couple of magenta accents. */
function drawCyberGrid(context: SurfaceCanvas2D, size: number): void {
  const minor = "rgba(70, 220, 255, 0.04)";
  const major = "rgba(70, 220, 255, 0.10)";
  const accent = "rgba(255, 70, 210, 0.07)";
  for (let at = 0; at <= size; at += 16) {
    if (at % 64 === 0) continue;
    context.strokeStyle = minor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(at, 0);
    context.lineTo(at, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, at);
    context.lineTo(size, at);
    context.stroke();
  }
  for (let at = 0; at <= size; at += 64) {
    context.strokeStyle = major;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(at, 0);
    context.lineTo(at, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, at);
    context.lineTo(size, at);
    context.stroke();
  }
  for (let at = 32; at < size; at += 256) {
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(at, 0);
    context.lineTo(at, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, at);
    context.lineTo(size, at);
    context.stroke();
  }
}

/** Stone: low-contrast deterministic speckle and a few irregular cracks. */
function drawStone(
  context: SurfaceCanvas2D,
  size: number,
  tint: string,
  random: () => number,
): void {
  const lighter = mix(tint, white, 0.3);
  const darker = mix(tint, black, 0.35);
  for (let speck = 0; speck < 4000; speck += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const edge = 1 + Math.floor(random() * 2);
    context.fillStyle = rgba(
      random() < 0.5 ? lighter : darker,
      0.02 + random() * 0.03,
    );
    context.fillRect(x, y, edge, edge);
  }
  for (let crack = 0; crack < 7; crack += 1) {
    context.strokeStyle = rgba(darker, 0.06 + random() * 0.04);
    context.lineWidth = 1 + random();
    context.beginPath();
    let x = random() * size;
    let y = random() * size;
    context.moveTo(x, y);
    const segments = 4 + Math.floor(random() * 4);
    for (let segment = 0; segment < segments; segment += 1) {
      const nextX = Math.max(0, Math.min(size, x + (random() - 0.5) * 60));
      const nextY = Math.max(0, Math.min(size, y + (random() - 0.5) * 60));
      context.quadraticCurveTo(
        (x + nextX) / 2 + (random() - 0.5) * 20,
        (y + nextY) / 2 + (random() - 0.5) * 20,
        nextX,
        nextY,
      );
      x = nextX;
      y = nextY;
    }
    context.stroke();
  }
}

/** `THREE.RepeatWrapping`; stable across the renderer's three versions. */
export const repeatWrapping = 1000;
/**
 * `THREE.LinearFilter`, paired with mipmaps off. The generated patterns are
 * fine — single-pixel felt fibres, single-pixel brushed hairlines — and a
 * mipmap would average them into cloudy grey the moment the desk is minified.
 * The surface is meant to read as grain, so its level-0 texels are not blurred.
 */
export const linearFilter = 1006;
/** `THREE.NearestFilter`, for minification: a texel is not averaged away. */
export const nearestFilter = 1003;

/**
 * Sets the texture to tile, so the 512 canvas reads as a finer or coarser
 * surface without needing the pattern regenerated at another resolution.
 * Returns false when the texture cannot express a repeat, in which case the
 * caller bakes the repetition into the canvas instead.
 */
export function applyTextureRepeat(
  texture: SceneTextureLike | null,
  scale: number,
): boolean {
  if (!texture || typeof texture !== "object" || !(scale > 0)) return false;
  const repeat = texture.repeat;
  if (!repeat || typeof repeat !== "object") return false;
  if (typeof repeat.set === "function") repeat.set(scale, scale);
  else if (typeof repeat.x === "number" && typeof repeat.y === "number") {
    repeat.x = scale;
    repeat.y = scale;
  } else return false;
  texture.wrapS = repeatWrapping;
  texture.wrapT = repeatWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = nearestFilter;
  texture.magFilter = linearFilter;
  texture.needsUpdate = true;
  return true;
}

type TextureConstructor = new (canvas: unknown) => SceneTextureLike;

/**
 * The texture class the renderer itself uses, read off a die material's own map
 * so the plate's map belongs to the same three.js instance as the scene. A plain
 * object placeholder — which is all a test double has — yields nothing, so the
 * plate carries no map rather than a broken one.
 */
export function surfaceTextureConstructor(
  template: unknown,
): TextureConstructor | null {
  const map = (template as SceneMaterialLike | null | undefined)?.map;
  const candidate = (map as { constructor?: unknown } | null | undefined)
    ?.constructor;
  if (
    typeof candidate !== "function" ||
    candidate === Object ||
    candidate === Function
  )
    return null;
  return candidate as TextureConstructor;
}

/**
 * Bakes the repetition into a fresh 512 canvas, used only when the live texture
 * class cannot be told to repeat. The pattern is drawn `scale` times per axis,
 * so the surface still has its texture rather than collapsing to a flat colour.
 */
export function tileSurfaceCanvas(
  base: HTMLCanvasElement,
  scale: number,
  createCanvas: SurfaceCanvasFactory = defaultSurfaceCanvas,
): HTMLCanvasElement | null {
  if (!(scale > 1)) return base;
  const canvas = createCanvas();
  if (!canvas) return null;
  canvas.width = surfaceTextureSize;
  canvas.height = surfaceTextureSize;
  const context = canvas.getContext("2d") as unknown as SurfaceCanvas2D | null;
  if (!context || typeof context.drawImage !== "function") return null;
  const step = surfaceTextureSize / scale;
  const count = Math.ceil(scale);
  for (let row = 0; row < count; row += 1)
    for (let column = 0; column < count; column += 1)
      context.drawImage(base, column * step, row * step, step, step);
  return canvas;
}

/**
 * Creates the surface's own map from a die material's texture class. The canvas
 * carries the authored surface colour and the material tint stays white, so
 * nothing multiplies the map dark.
 */
export function createSurfaceTexture(
  material: unknown,
  look: DiceSurfaceLook,
  createCanvas: SurfaceCanvasFactory = defaultSurfaceCanvas,
): SceneTextureLike | null {
  const Texture = surfaceTextureConstructor(material);
  if (!Texture) return null;
  const canvas = createSurfaceCanvas(look.kind, look.tint, createCanvas);
  if (!canvas) return null;
  let texture: SceneTextureLike;
  try {
    texture = new Texture(canvas);
  } catch {
    return null;
  }
  if (applyTextureRepeat(texture, look.textureScale)) return texture;
  const tiled = tileSurfaceCanvas(canvas, look.textureScale, createCanvas);
  if (!tiled || tiled === canvas) return texture;
  let replacement: SceneTextureLike;
  try {
    replacement = new Texture(tiled);
  } catch {
    return texture;
  }
  try {
    texture.dispose?.();
  } catch {
    // A texture whose context is already gone needs no release.
  }
  return replacement;
}

/* ------------------------------------------------------------------ *
 * Die materials.
 * ------------------------------------------------------------------ */

/**
 * How far a metallic material's `metalness` is scaled down. This renderer ships
 * no environment map and sets `envMapIntensity` to 0, so a metallic material has
 * nothing to reflect: all its `metalness` can do is remove light from the map
 * the skin painted. Scaling it down keeps each preset's sheen — roughness and
 * specular are untouched — without turning the die into a dark mirror.
 */
export const dieMetalnessScale = 0.3;
export const dieMetalnessCeiling = 0.3;

/**
 * Restores a die material to the colours the skin authored, by making the baked
 * texture the only thing shaping the die's colour. Roughness, specular and bump
 * mapping are left alone, so the material presets stay distinct.
 *
 * Returns whether the material needed anything, so it can be applied
 * unconditionally without churning materials that are already right.
 */
export function normalizeDieMaterial(material: unknown): boolean {
  if (!material || typeof material !== "object") return false;
  const entry = material as SceneMaterialLike;
  let changed = false;
  // White leaves the baked canvas — numerals, body fill, outline and die edges —
  // carrying the colour, instead of it being multiplied by the preset's tint.
  if (typeof entry.color?.setRGB === "function") {
    entry.color.setRGB(1, 1, 1);
    changed = true;
  }
  if (typeof entry.metalness === "number" && entry.metalness > 0) {
    entry.metalness = Math.min(
      entry.metalness * dieMetalnessScale,
      dieMetalnessCeiling,
    );
    changed = true;
  }
  return changed;
}

/** The material-building half of the renderer's own die factory. */
export interface DieMaterialFactoryLike {
  createMaterials?: (...args: never[]) => unknown;
}

/** Marks a wrapped factory method, so a second patch is never stacked. */
const patchedMarker = Symbol.for("threepointpf.dice.factoryMethodPatched");

type PatchableMethod = ((this: unknown, ...args: unknown[]) => unknown) & {
  [patchedMarker]?: boolean;
};

/**
 * Wraps the renderer's own material builder so every die it produces wears the
 * authored colours. It is a wrapper rather than a fix-up after the throw because
 * the renderer builds a die's materials when it spawns the die — before the first
 * frame of the throw — and rebuilds them in place when a die is reused for a
 * reroll, so this is the one place both paths pass through.
 *
 * Returns whether it wrapped anything; a renderer without that method is left
 * exactly as it is.
 */
export function patchDieMaterials(factory: unknown): boolean {
  if (!factory || typeof factory !== "object") return false;
  const entry = factory as DieMaterialFactoryLike;
  if (typeof entry.createMaterials !== "function") return false;
  const original = entry.createMaterials as unknown as PatchableMethod;
  if (original[patchedMarker]) return false;
  const patched: PatchableMethod = function (this: unknown, ...args: unknown[]) {
    const materials = original.apply(this, args);
    if (Array.isArray(materials))
      for (const material of materials) normalizeDieMaterial(material);
    return materials;
  };
  patched[patchedMarker] = true;
  entry.createMaterials = patched as unknown as DieMaterialFactoryLike["createMaterials"];
  return true;
}

/** The die-building half of the renderer's own die factory. */
export interface DieFactoryLike {
  create?: (...args: never[]) => unknown;
}

/**
 * Wraps the renderer's own die builder so a freshly spawned die can carry the
 * surface with it. The surface plate has to be a material the renderer's own
 * scene class provided, and before the first throw there is no die to take one
 * from — while a die is spawned at the start of a throw, before any of that
 * throw is on screen. A callback that throws is swallowed: the appearance is not
 * worth losing a throw over.
 *
 * Returns whether it wrapped anything; a renderer without that method is left
 * exactly as it is.
 */
export function patchDieCreation(
  factory: unknown,
  onDie: (die: unknown) => void,
): boolean {
  if (!factory || typeof factory !== "object") return false;
  const entry = factory as DieFactoryLike;
  if (typeof entry.create !== "function") return false;
  const original = entry.create as unknown as PatchableMethod;
  if (original[patchedMarker]) return false;
  const patched: PatchableMethod = function (this: unknown, ...args: unknown[]) {
    const die = original.apply(this, args);
    if (die) {
      try {
        onDie(die);
      } catch {
        // A surface that cannot be painted still leaves a throwable die.
      }
    }
    return die;
  };
  patched[patchedMarker] = true;
  entry.create = patched as unknown as DieFactoryLike["create"];
  return true;
}

/** The material a die mesh draws with, whether it holds one or a face list. */
export function dieMaterialTemplate(die: unknown): SceneMaterialLike | null {
  const material = (die as SceneMeshLike | null | undefined)?.material;
  if (Array.isArray(material)) {
    for (const entry of material)
      if (entry && typeof entry === "object")
        return entry as SceneMaterialLike;
    return null;
  }
  return material && typeof material === "object"
    ? (material as SceneMaterialLike)
    : null;
}

/** The first die material of the renderer's own list, as the plate's template. */
export function firstDieMaterial(dice: unknown): SceneMaterialLike | null {
  if (!Array.isArray(dice)) return null;
  for (const die of dice) {
    const material = dieMaterialTemplate(die);
    if (material) return material;
  }
  return null;
}

function applyColor(color: SceneColorLike | undefined, hex: string): boolean {
  if (typeof color?.setRGB !== "function") return false;
  const [red, green, blue] = hexToRgb(hex);
  color.setRGB(red, green, blue);
  return true;
}

/**
 * A clone of the template, normalised into the surface's material: the die's own
 * material class, so the surface is drawn by the same rendering path as the dice
 * themselves, with every die-specific property explicitly overwritten. The clone
 * is why cleanup is safe — the die keeps its own material — and the overwrites
 * are why a glass die cannot make the table transparent and a metal die cannot
 * make felt metallic: the surface is a category of its own, not a function of
 * the dice sitting on it.
 *
 * The map is the generated surface texture; the material colour is white so
 * nothing multiplies that map dark, and the map carries the authored tint.
 */
export function surfacePlateMaterial(
  template: unknown,
  look: DiceSurfaceLook,
  texture: SceneTextureLike | null = null,
): SceneMaterialLike | null {
  const source = template as SceneMaterialLike | null | undefined;
  if (!source || typeof source.clone !== "function") return null;
  const material = source.clone() as SceneMaterialLike;
  material.map = texture;
  material.bumpMap = null;
  material.normalMap = null;
  // The dice draw with depth testing off so they land on top of the table; the
  // table itself stays depth-tested or it would draw over them.
  material.transparent = false;
  material.opacity = 1;
  material.depthTest = true;
  material.depthWrite = true;
  // The camera looks at the surface, but a surface that vanishes if it ever ends
  // up behind the camera is a worse failure than a shaded back face.
  material.side = 2;
  material.emissive?.setRGB(0, 0, 0);
  if (typeof material.emissiveIntensity === "number")
    material.emissiveIntensity = 0;
  // Every axis the die's preset could have set is overwritten from the surface
  // spec, so the two settings never leak into one another.
  if (typeof material.metalness === "number") material.metalness = look.metalness;
  if (typeof material.roughness === "number") material.roughness = look.roughness;
  if (typeof material.transmission === "number") material.transmission = 0;
  if (typeof material.envMapIntensity === "number")
    material.envMapIntensity = 0;
  material.color?.setRGB(1, 1, 1);
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------------ *
 * The applier.
 * ------------------------------------------------------------------ */

/** A plate this module painted onto the renderer's own shadow-catcher mesh. */
interface SurfacePlate {
  mesh: SceneMeshLike;
  material: SceneMaterialLike;
  texture: SceneTextureLike | null;
  surface: string;
}

export interface SurfaceApplierOptions {
  /** Injectable so a runtime without a document, or a test, can supply one. */
  createCanvas?: SurfaceCanvasFactory;
}

export interface SurfaceApplier {
  /**
   * Applies the surface now: the neutral light always, and the plate as soon as
   * a material template exists. The template only becomes reachable once the
   * renderer has spawned a die, which happens at the start of every throw — that
   * is, before anything of that throw is on screen — so no frame is ever drawn on
   * an unpainted surface. Safe to call repeatedly, including after the renderer
   * has rebuilt its own surface on a resize.
   */
  apply(surface: string, template?: unknown): boolean;
  /**
   * Releases the plate material and its generated texture; the mesh and its
   * geometry are upstream's. Called when the surface changes, when the renderer
   * is rebuilt, and on presenter teardown, so no CanvasTexture is ever leaked.
   */
  dispose(): void;
}

/**
 * Keeps one renderer's surface painted. The applier owns exactly one material
 * and one generated texture at a time: a new surface, a rebuilt mesh or teardown
 * releases the previous pair, so changing appearance between rolls leaks
 * nothing.
 */
export function createSurfaceApplier(
  target: DiceLookTarget,
  options: SurfaceApplierOptions = {},
): SurfaceApplier {
  const createCanvas = options.createCanvas ?? defaultSurfaceCanvas;
  let plate: SurfacePlate | null = null;
  let template: SceneMaterialLike | null = null;

  const disposePlate = () => {
    const previous = plate;
    plate = null;
    try {
      previous?.texture?.dispose?.();
    } catch {
      // A texture whose context is already gone needs no release.
    }
    try {
      previous?.material.dispose?.();
    } catch {
      // A material whose context is already gone needs no release.
    }
  };

  return {
    apply(surface, nextTemplate) {
      let changed = applyNeutralDiceLighting(target);
      const source = dieMaterialTemplate(nextTemplate);
      if (source) template = source;
      const desk = target.desk;
      if (!desk || !template) return changed;
      // Upstream rebuilds its mesh on a resize and its material is not ours to
      // repaint, so a new mesh — or a new surface — is a new plate.
      if (plate && plate.mesh === desk && plate.surface === surface)
        return changed;
      const look = diceSurfaceLook(surface);
      const texture = createSurfaceTexture(template, look, createCanvas);
      const material = surfacePlateMaterial(template, look, texture);
      if (!material) {
        texture?.dispose?.();
        return changed;
      }
      disposePlate();
      desk.material = material;
      plate = { mesh: desk, material, texture, surface };
      return true;
    },
    dispose() {
      disposePlate();
      template = null;
    },
  };
}
