import type {
  DiceDieValuePresentation,
  DiceDieValueRequest,
  DiceFlourish,
  RollPresentationEvent,
} from "@threepointpf/dice";
import { flourishColor } from "@threepointpf/dice";

/**
 * The die-local half of the roll presentation, living inside the renderer's own
 * Three.js scene.
 *
 * A DOM element positioned over a die is not *on* the die: it is a screen-space
 * stand-in that has to be re-projected as the die moves, and that drifts the
 * moment the projection is stale. So the value and the flourish here are real
 * `Object3D`s parented to the landed die mesh. Translating or rotating that mesh
 * carries them along through the scene graph, with no projection step anywhere.
 *
 * Every object is built from the renderer's own classes: the geometry,
 * attribute, texture, mesh and vector constructors are read off the landed die
 * and its material, so the presentation joins the same three.js instance as the
 * scene it is added to and this module needs no dependency on three at all. That
 * keeps it correct across the renderer's bundled three version.
 *
 * Values are the authoritative `ResolvedRoll` faces, handed in by the caller.
 * This module contributes placement and motion only: it never reads a value back
 * out of the renderer or its physics, so a die can never roll itself into the
 * result.
 */

/* ------------------------------------------------------------------ *
 * The parts of three.js this module uses, structurally.
 * ------------------------------------------------------------------ */

export interface SceneVector {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): SceneVector;
  copy(v: SceneVector): SceneVector;
  clone(): SceneVector;
  add(v: SceneVector): SceneVector;
  sub(v: SceneVector): SceneVector;
  addScaledVector(v: SceneVector, scale: number): SceneVector;
  multiplyScalar(scale: number): SceneVector;
  normalize(): SceneVector;
  dot(v: SceneVector): number;
  cross(v: SceneVector): SceneVector;
  lerpVectors(a: SceneVector, b: SceneVector, t: number): SceneVector;
  applyQuaternion(q: SceneQuaternion): SceneVector;
}

export interface SceneQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  copy(q: SceneQuaternion): SceneQuaternion;
  clone(): SceneQuaternion;
  invert(): SceneQuaternion;
  multiply(q: SceneQuaternion): SceneQuaternion;
  setFromUnitVectors(from: SceneVector, to: SceneVector): SceneQuaternion;
  slerp(q: SceneQuaternion, t: number): SceneQuaternion;
}

export interface SceneColor {
  r: number;
  g: number;
  b: number;
  clone(): SceneColor;
  setRGB(r: number, g: number, b: number): SceneColor;
}

export interface SceneAttribute {
  array: ArrayLike<number>;
}

export interface SceneGeometry {
  groups: readonly { start: number; count: number; materialIndex: number }[];
  attributes: Record<string, SceneAttribute | undefined>;
  boundingSphere?: { radius: number } | null;
  setAttribute(name: string, attribute: unknown): unknown;
  setIndex(index: readonly number[]): unknown;
  dispose?(): void;
}

export interface SceneMaterialLike {
  map?: unknown;
  bumpMap?: unknown;
  normalMap?: unknown;
  color?: SceneColor;
  emissive?: SceneColor;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  blending?: number;
  side?: number;
  needsUpdate?: boolean;
  clone(): SceneMaterialLike;
  dispose?(): void;
}

export interface SceneTextureLike {
  needsUpdate?: boolean;
  dispose?(): void;
}

export interface SceneObject3D {
  position: SceneVector;
  quaternion: SceneQuaternion;
  scale: SceneVector;
  renderOrder: number;
  children: unknown[];
  parent?: unknown;
  add(...objects: SceneObject3D[]): SceneObject3D;
  remove(...objects: SceneObject3D[]): SceneObject3D;
}

export interface SceneMeshLike extends SceneObject3D {
  geometry: SceneGeometry;
  material: SceneMaterialLike | SceneMaterialLike[];
  /** The renderer's own shape id, used only to pick which way a d4 is read. */
  shape?: string;
}

/** A renderer whose draw loop this presentation drives while it is on screen. */
export interface SceneRendererLike {
  render(scene: unknown, camera: unknown): void;
}

/**
 * Constructors taken from the renderer's own objects, so everything this module
 * adds belongs to the same three.js instance as the scene it joins.
 */
export interface SceneVocabulary {
  geometry(): SceneGeometry;
  attribute(array: Float32Array, itemSize: number): unknown;
  texture(canvas: HTMLCanvasElement): SceneTextureLike;
  mesh(geometry: SceneGeometry, material: SceneMaterialLike): SceneObject3D;
  vector(x: number, y: number, z: number): SceneVector;
  quaternion(): SceneQuaternion;
}

/** A constructor taken from a live object, with its signature erased. */
type ConstructorOf<Instance> = new (...args: never[]) => Instance;

function constructorOf(value: unknown): ConstructorOf<unknown> | null {
  const candidate = (value as { constructor?: unknown } | null | undefined)
    ?.constructor;
  return typeof candidate === "function"
    ? (candidate as ConstructorOf<unknown>)
    : null;
}

/** Calls one of those erased constructors with real arguments. */
function construct<Instance>(
  ctor: ConstructorOf<unknown>,
  ...args: unknown[]
): Instance {
  const callable = ctor as unknown as new (...args: unknown[]) => Instance;
  return new callable(...args);
}

/** The die's own material, whichever way the renderer stores it. */
export function dieMaterialOf(die: SceneMeshLike): SceneMaterialLike | null {
  const material = Array.isArray(die.material) ? die.material[0] : die.material;
  return material ?? null;
}

/**
 * Reads the constructors for the presentation objects off a landed die. Returns
 * `null` when the renderer's objects cannot supply one, in which case the caller
 * shows the result without a die-local phase rather than faking one in the DOM.
 */
export function sceneVocabularyFor(die: SceneMeshLike): SceneVocabulary | null {
  const material = dieMaterialOf(die);
  const geometryConstructor = constructorOf(die.geometry);
  const attributeConstructor = constructorOf(die.geometry?.attributes?.position);
  const meshConstructor = constructorOf(die);
  const textureConstructor = constructorOf(material?.map);
  const vectorConstructor = constructorOf(die.position);
  const quaternionConstructor = constructorOf(die.quaternion);
  if (
    !geometryConstructor ||
    !attributeConstructor ||
    !meshConstructor ||
    !textureConstructor ||
    !vectorConstructor ||
    !quaternionConstructor
  )
    return null;
  return {
    geometry: () => construct<SceneGeometry>(geometryConstructor),
    attribute: (array, itemSize) =>
      construct<unknown>(attributeConstructor, array, itemSize),
    texture: (canvas) =>
      construct<SceneTextureLike>(textureConstructor, canvas),
    mesh: (geometry, meshMaterial) =>
      construct<SceneObject3D>(meshConstructor, geometry, meshMaterial),
    vector: (x, y, z) => construct<SceneVector>(vectorConstructor, x, y, z),
    quaternion: () => construct<SceneQuaternion>(quaternionConstructor),
  };
}

/* ------------------------------------------------------------------ *
 * World transforms.
 *
 * The renderer parents its dice to the scene root, so every chain here is
 * translation plus rotation (a die's size lives in its geometry), which is
 * exactly the case this composition covers.
 * ------------------------------------------------------------------ */

export function worldQuaternionOf(
  object: SceneObject3D,
  vocabulary: SceneVocabulary,
): SceneQuaternion {
  const chain: SceneObject3D[] = [];
  for (
    let node: SceneObject3D | undefined = object;
    node;
    node = node.parent as SceneObject3D | undefined
  )
    chain.push(node);
  const quaternion = vocabulary.quaternion().copy(chain[0]!.quaternion);
  for (let index = 1; index < chain.length; index += 1)
    quaternion.multiply(chain[index]!.quaternion);
  return quaternion;
}

export function worldPositionOf(
  object: SceneObject3D,
  vocabulary: SceneVocabulary,
): SceneVector {
  const chain: SceneObject3D[] = [];
  for (
    let node: SceneObject3D | undefined = object;
    node;
    node = node.parent as SceneObject3D | undefined
  )
    chain.push(node);
  const position = vocabulary.vector(0, 0, 0);
  const rotation = vocabulary.quaternion();
  // Walked root-first, so each node's own rotation is composed before it is
  // applied to its local offset.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const local = vocabulary
      .vector(chain[index]!.position.x, chain[index]!.position.y, chain[index]!.position.z);
    position.add(local.applyQuaternion(rotation));
    rotation.multiply(chain[index]!.quaternion);
  }
  return position;
}

/** A world point expressed in a die's local space, for parenting to that die. */
export function toDieLocal(
  die: SceneObject3D,
  vocabulary: SceneVocabulary,
  worldPoint: SceneVector,
): SceneVector {
  const position = worldPositionOf(die, vocabulary);
  const rotation = worldQuaternionOf(die, vocabulary).invert();
  return worldPoint.clone().sub(position).applyQuaternion(rotation);
}

/** A world rotation expressed in a die's local space. */
export function toDieLocalQuaternion(
  die: SceneObject3D,
  vocabulary: SceneVocabulary,
  worldRotation: SceneQuaternion,
): SceneQuaternion {
  return worldQuaternionOf(die, vocabulary).invert().multiply(worldRotation);
}

/* ------------------------------------------------------------------ *
 * Which face of a landed die points up out of the table.
 * ------------------------------------------------------------------ */

/** The renderer reads a result face as the one closest to +Z; so do we. */
export const diceUpAxis: readonly [number, number, number] = [0, 0, 1];
/** A d4 is read the other way up: the face resting on the table is its result. */
export const d4UpAxis: readonly [number, number, number] = [0, 0, -1];

export function upAxisFor(
  shape: string | undefined,
): readonly [number, number, number] {
  return shape === "d4" ? d4UpAxis : diceUpAxis;
}

export interface LocalFace {
  /** Index of the geometry group (one triangle) that forms the upward face. */
  group: number;
  /** Unit face normal in the die's local space. */
  normal: [number, number, number];
  /** Face centroid in the die's local space. */
  centre: [number, number, number];
}

function normalised(
  vector: readonly [number, number, number],
): [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length === 0) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** Rotates a vector by a quaternion, exactly as `Vector3.applyQuaternion` does. */
export function rotateByQuaternion(
  vector: readonly [number, number, number],
  quaternion: { x: number; y: number; z: number; w: number },
): [number, number, number] {
  const [x, y, z] = vector;
  const { x: qx, y: qy, z: qz, w: qw } = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Picks the face of a landed die that points up out of the table, mirroring the
 * renderer's own value reading: the landed geometry has one group per face
 * triangle, and the group whose first-vertex normal comes nearest the +Z axis
 * (the -Z axis for a d4) is the face the table is showing.
 *
 * Only the face's *geometry* is read here. Its value is never derived from it:
 * the number shown is the authoritative face the caller passed in.
 */
export function topFaceOf(
  normals: ArrayLike<number>,
  positions: ArrayLike<number>,
  groups: readonly { materialIndex: number }[],
  quaternion: { x: number; y: number; z: number; w: number },
  up: readonly [number, number, number] = diceUpAxis,
): LocalFace | null {
  let best: LocalFace | null = null;
  let bestDot = -Infinity;
  for (let group = 0; group < groups.length; group += 1) {
    if (groups[group]!.materialIndex === 0) continue;
    const at = group * 9;
    if (at + 8 >= normals.length || at + 8 >= positions.length) continue;
    const normal = normalised([normals[at]!, normals[at + 1]!, normals[at + 2]!]);
    if (!normal) continue;
    const world = rotateByQuaternion(normal, quaternion);
    const dot = world[0] * up[0] + world[1] * up[1] + world[2] * up[2];
    if (dot <= bestDot) continue;
    bestDot = dot;
    best = {
      group,
      normal,
      centre: [
        (positions[at]! + positions[at + 3]! + positions[at + 6]!) / 3,
        (positions[at + 1]! + positions[at + 4]! + positions[at + 7]!) / 3,
        (positions[at + 2]! + positions[at + 5]! + positions[at + 8]!) / 3,
      ],
    };
  }
  return best;
}

/** The upward face of a landed die mesh, in the die's local space. */
export function readTopFace(
  die: SceneMeshLike,
  vocabulary: SceneVocabulary,
): LocalFace | null {
  const normals = die.geometry?.attributes?.normal?.array;
  const positions = die.geometry?.attributes?.position?.array;
  const groups = die.geometry?.groups;
  if (!normals || !positions || !groups?.length) return null;
  return topFaceOf(
    normals,
    positions,
    groups,
    worldQuaternionOf(die, vocabulary),
    upAxisFor(die.shape),
  );
}

/* ------------------------------------------------------------------ *
 * The visual stability gate.
 * ------------------------------------------------------------------ */

export interface DieSample {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

/** How still a die must be between two frames, in world units. */
export const stabilityEpsilon = 0.05;
/**
 * How far a die may turn between two frames and still count as still, in
 * radians. A die that is visibly rolling turns by far more than this; a die at
 * rest on the table reports the same transform twice.
 */
export const stabilityRotationEpsilon = 0.01;
/** Consecutive still frames required before a value may appear. */
export const valueStableFrames = 3;
/** Longest we wait for that, before showing the value on the die as it lies. */
export const valueStableTimeoutMs = 1500;

export function dieSampleOf(die: SceneObject3D): DieSample {
  const { position, quaternion } = die;
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  };
}

/** The angle between two orientations, in radians, ignoring their sign. */
export function rotationBetween(
  previous: DieSample["quaternion"],
  next: DieSample["quaternion"],
): number {
  const dot = Math.min(
    1,
    Math.abs(
      next[0] * previous[0] +
        next[1] * previous[1] +
        next[2] * previous[2] +
        next[3] * previous[3],
    ),
  );
  return 2 * Math.acos(dot);
}

/** Whether one die held still between two frames. */
export function sampleStable(
  previous: DieSample,
  next: DieSample,
  epsilon = stabilityEpsilon,
  rotationEpsilon = stabilityRotationEpsilon,
): boolean {
  const moved = Math.hypot(
    next.position[0] - previous.position[0],
    next.position[1] - previous.position[1],
    next.position[2] - previous.position[2],
  );
  if (moved > epsilon) return false;
  return rotationBetween(previous.quaternion, next.quaternion) <= rotationEpsilon;
}

/** Whether every die held still between two frames. */
export function samplesStable(
  previous: readonly DieSample[],
  next: readonly DieSample[],
  epsilon = stabilityEpsilon,
  rotationEpsilon = stabilityRotationEpsilon,
): boolean {
  if (previous.length === 0 || previous.length !== next.length) return false;
  return previous.every((sample, index) =>
    sampleStable(sample, next[index]!, epsilon, rotationEpsilon),
  );
}

/* ------------------------------------------------------------------ *
 * Canvas textures.
 * ------------------------------------------------------------------ */

export interface Canvas2DLike {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalCompositeOperation: string;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): { addColorStop(offset: number, color: string): void };
}

export const dieValueTextureSize = 256;

export interface DieValueTextureSpec {
  /** The authoritative value to draw. */
  value: number;
  /** Accent hex for the plate's rim. */
  accent: string;
  /** Whether this die carried the plan's natural face. */
  natural?: boolean;
  /** Canvas edge length in pixels. */
  size?: number;
}

function roundedRect(
  context: Canvas2DLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

/**
 * Draws one rolled value onto its own canvas: a dark plate with the number on
 * it, so the value stays readable over any dice skin, rimmed in the
 * presentation's colour. The value drawn is the one passed in, never one read
 * back from the renderer.
 */
export function drawDieValueTexture(
  context: Canvas2DLike,
  spec: DieValueTextureSpec,
): void {
  const size = spec.size ?? dieValueTextureSize;
  const inset = size * 0.09;
  const plate = size - inset * 2;
  context.clearRect(0, 0, size, size);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "rgba(12, 12, 18, 0.74)";
  roundedRect(context, inset, inset, plate, plate, size * 0.17);
  context.fill();
  context.strokeStyle = spec.accent;
  context.lineWidth = size * 0.035;
  roundedRect(context, inset, inset, plate, plate, size * 0.17);
  context.stroke();
  context.fillStyle = spec.natural ? spec.accent : "#f4efe4";
  context.font = `bold ${Math.round(size * 0.5)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(spec.value), size / 2, size * 0.54);
}

/**
 * Draws a soft white ring. White because the material's own colour tints it to
 * the presentation's colour, so every flourish shares one texture.
 */
export function drawFlourishTexture(
  context: Canvas2DLike,
  size: number = dieValueTextureSize,
): void {
  const centre = size / 2;
  context.clearRect(0, 0, size, size);
  context.globalAlpha = 1;
  const gradient = context.createRadialGradient(
    centre,
    centre,
    0,
    centre,
    centre,
    centre,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.52, "rgba(255, 255, 255, 0.14)");
  gradient.addColorStop(0.76, "rgba(255, 255, 255, 0.86)");
  gradient.addColorStop(0.92, "rgba(255, 255, 255, 0.28)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
}

/** A six-digit hex colour as three 0–1 channels, for material tints. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [1, 1, 1];
  const value = Number.parseInt(match[1]!, 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

/* ------------------------------------------------------------------ *
 * Motion.
 * ------------------------------------------------------------------ */

export const valueRiseMs = 780;
export const valueStaggerMs = 110;
export const valueHoldMs = 300;
export const valueFadeMs = 220;
export const flourishMs = 1050;

/** Distance a value travels along its own face normal, in die radii. */
const valueLiftRatio = 1.15;
/** Extra rise along the screen's up axis, so a lift reads from a top-down view. */
const valueViewLiftRatio = 0.8;
const valueGapRatio = 0.07;
const valueSizeRatio = 1.32;
const gatherUpRatio = 2.9;
const gatherSpreadRatio = 1.35;

/** How a flourish reads on its die: how far the ring reaches, how brightly. */
export interface FlourishProfile {
  ringScale: number;
  glow: number;
}

export const flourishProfiles: Record<string, FlourishProfile> = {
  none: { ringScale: 0, glow: 0 },
  pulse: { ringScale: 2.3, glow: 0.3 },
  sparks: { ringScale: 2.6, glow: 0.72 },
  impact: { ringScale: 3.1, glow: 0.86 },
  flare: { ringScale: 3.4, glow: 1 },
  shards: { ringScale: 2.9, glow: 0.55 },
};

export function flourishProfileOf(flourish: DiceFlourish): FlourishProfile {
  return flourishProfiles[flourish.motion] ?? flourishProfiles.none!;
}

function easeOutCubic(t: number): number {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) ** 3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The world rotation that faces the camera and stays upright on screen: point
 * the plane's own +Z at the camera, then roll it back so its up axis matches the
 * view's up axis.
 */
export function facingQuaternion(
  vocabulary: SceneVocabulary,
  toCamera: SceneVector,
  viewUp: SceneVector,
): SceneQuaternion {
  const forward = vocabulary.quaternion();
  forward.setFromUnitVectors(vocabulary.vector(0, 0, 1), toCamera);
  const rolledUp = vocabulary
    .vector(0, 1, 0)
    .applyQuaternion(forward);
  const upright = vocabulary.quaternion();
  upright.setFromUnitVectors(rolledUp, viewUp);
  return upright.multiply(forward);
}

/* ------------------------------------------------------------------ *
 * The presentation.
 * ------------------------------------------------------------------ */

export interface SceneValuesOptions {
  request: DiceDieValueRequest;
  /** The landed dice, in the plan's flattened face order. */
  dice: readonly SceneMeshLike[];
  scene: SceneObject3D;
  camera: SceneObject3D;
  renderer: SceneRendererLike;
  /** Called once the values have been attached to their dice and are visible. */
  onValueShown?: () => void;
  /**
   * Injectable so a test can draw into a recording context, and so a runtime
   * with no document declines the die-local phase instead of throwing.
   */
  createCanvas?: () => HTMLCanvasElement | null;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

interface DieEntry {
  die: SceneMeshLike;
  value: number;
  faceIndex: number;
}

interface DieValue {
  die: SceneMeshLike;
  object: SceneObject3D;
  material: SceneMaterialLike;
  texture: SceneTextureLike;
  geometry: SceneGeometry;
  startPosition: SceneVector;
  endPosition: SceneVector;
  startQuaternion: SceneQuaternion;
  endQuaternion: SceneQuaternion;
  workingQuaternion: SceneQuaternion;
  delayMs: number;
}

interface FlourishEffect {
  die: SceneMeshLike;
  object: SceneObject3D;
  material: SceneMaterialLike;
  texture: SceneTextureLike;
  geometry: SceneGeometry;
  profile: FlourishProfile;
  restore: {
    material: SceneMaterialLike;
    emissive: SceneColor;
    intensity: number;
  }[];
}

function defaultCreateCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

interface FrameScheduler {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

/**
 * The runtime's own animation frames. Without them there is no loop to animate a
 * die-local phase in, so the presentation declines rather than half-running.
 */
function globalFrameScheduler(): FrameScheduler | null {
  const scope = globalThis as {
    requestAnimationFrame?: (callback: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  if (
    typeof scope.requestAnimationFrame !== "function" ||
    typeof scope.cancelAnimationFrame !== "function"
  )
    return null;
  return {
    requestFrame: (callback) => scope.requestAnimationFrame!(callback),
    cancelFrame: (handle) => scope.cancelAnimationFrame!(handle),
  };
}

function drawTexture(
  createCanvas: () => HTMLCanvasElement | null,
  vocabulary: SceneVocabulary,
  draw: (context: Canvas2DLike, size: number) => void,
  size: number,
): SceneTextureLike | null {
  const canvas = createCanvas();
  if (!canvas) return null;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: true }) as
    | Canvas2DLike
    | null;
  if (!context) return null;
  draw(context, size);
  try {
    return vocabulary.texture(canvas) ?? null;
  } catch {
    // A renderer whose map class cannot take a canvas gets no die-local phase
    // rather than a broken one.
    return null;
  }
}

function quadGeometry(
  vocabulary: SceneVocabulary,
  halfSize: number,
): SceneGeometry {
  const geometry = vocabulary.geometry();
  geometry.setAttribute(
    "position",
    vocabulary.attribute(
      new Float32Array([
        -halfSize, -halfSize, 0,
        halfSize, -halfSize, 0,
        halfSize, halfSize, 0,
        -halfSize, halfSize, 0,
      ]),
      3,
    ),
  );
  // Without normals a lit material has nothing to shade against, so the quad
  // would not match the die it was rolled on.
  geometry.setAttribute(
    "normal",
    vocabulary.attribute(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    vocabulary.attribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * A quad wearing a clone of the die's own material class, textured with a canvas
 * this presentation owns. The clone is what makes cleanup safe: the die keeps its
 * material and its cached map, and everything this module added is disposed.
 */
function quadObject(
  vocabulary: SceneVocabulary,
  die: SceneMeshLike,
  texture: SceneTextureLike,
  size: number,
  tint: string | null,
): {
  object: SceneObject3D;
  material: SceneMaterialLike;
  geometry: SceneGeometry;
} | null {
  const source = dieMaterialOf(die);
  if (!source?.clone) return null;
  const material = source.clone();
  material.map = texture;
  material.bumpMap = null;
  material.normalMap = null;
  material.transparent = true;
  material.opacity = 1;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = 2;
  material.emissive?.setRGB(0, 0, 0);
  if (typeof material.emissiveIntensity === "number")
    material.emissiveIntensity = 0;
  const [red, green, blue] = hexToRgb(tint ?? "#ffffff");
  material.color?.setRGB(red, green, blue);
  const geometry = quadGeometry(vocabulary, size / 2);
  const object = vocabulary.mesh(geometry, material);
  // The dice draw with depth testing off, so the value has to be drawn after
  // them to stay on top of the die it came out of.
  object.renderOrder = 20;
  return { object, material, geometry };
}

/**
 * Shows every landed value as an object parented to the die that produced it,
 * then hands the caller back its arithmetic. Returns `null` when the renderer has
 * no scene to attach to, so the result is shown without a die-local phase.
 */
export function presentSceneValues(
  options: SceneValuesOptions,
): DiceDieValuePresentation | null {
  const {
    request,
    dice,
    scene,
    camera,
    renderer,
    onValueShown,
    createCanvas = defaultCreateCanvas,
    now = () => performance.now(),
  } = options;

  const scheduler: FrameScheduler | null =
    options.requestFrame && options.cancelFrame
      ? {
          requestFrame: options.requestFrame,
          cancelFrame: options.cancelFrame,
        }
      : globalFrameScheduler();
  if (!scheduler) return null;
  const { requestFrame, cancelFrame } = scheduler;

  if (request.settings.reducedMotion) return null;

  const entries: DieEntry[] = [];
  request.faces.forEach((value, faceIndex) => {
    const die = dice[faceIndex];
    if (die) entries.push({ die, value, faceIndex });
  });
  if (entries.length === 0) return null;
  const vocabularyOfDie = sceneVocabularyFor(entries[0]!.die);
  if (!vocabularyOfDie) return null;
  // Annotated so the closures below see a settled, non-nullable vocabulary.
  const vocabulary: SceneVocabulary = vocabularyOfDie;

  const accent = flourishColor(request.event);
  const amplitude = clamp01(request.settings.intensity / 100);
  const accentRgb = hexToRgb(accent);

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  let state: "settling" | "playing" | "fading" | "disposed" = "settling";
  let frame = 0;
  let stillFrames = 0;
  let previousSamples = entries.map(({ die }) => dieSampleOf(die));
  const settlingSince = now();
  let startedAt = 0;
  let finishedAt = 0;
  let doneResolved = false;
  let totalMs = 0;
  let values: DieValue[] = [];
  let flourish: FlourishEffect | null = null;

  function buildValues(): void {
    const positions = entries.map(({ die }) => worldPositionOf(die, vocabulary));
    const centre = positions[0]!.clone();
    for (let index = 1; index < positions.length; index += 1)
      centre.add(positions[index]!);
    centre.multiplyScalar(1 / Math.max(1, positions.length));
    const viewRotation = worldQuaternionOf(camera, vocabulary);
    const viewUp = vocabulary.vector(0, 1, 0).applyQuaternion(viewRotation);
    const viewRight = vocabulary.vector(1, 0, 0).applyQuaternion(viewRotation);
    const cameraPosition = worldPositionOf(camera, vocabulary);
    const gathering = entries.length > 1;
    const averageRadius =
      entries.reduce(
        (total, { die }) => total + (die.geometry.boundingSphere?.radius ?? 0),
        0,
      ) / entries.length;

    for (let index = 0; index < entries.length; index += 1) {
      const { die, value, faceIndex } = entries[index]!;
      const face = readTopFace(die, vocabulary);
      if (!face) continue;
      const radius = die.geometry.boundingSphere?.radius ?? 1;
      const natural = request.naturalFaceIndex === faceIndex;
      const texture = drawTexture(
        createCanvas,
        vocabulary,
        (context, size) =>
          drawDieValueTexture(context, { value, accent, natural, size }),
        dieValueTextureSize,
      );
      if (!texture) continue;
      const quad = quadObject(
        vocabulary,
        die,
        texture,
        radius * valueSizeRatio,
        null,
      );
      if (!quad) {
        texture.dispose?.();
        continue;
      }
      const { object, material, geometry } = quad;

      const worldRotation = worldQuaternionOf(die, vocabulary);
      const localNormal = vocabulary.vector(
        face.normal[0],
        face.normal[1],
        face.normal[2],
      );
      const localCentre = vocabulary.vector(
        face.centre[0],
        face.centre[1],
        face.centre[2],
      );
      const startPosition = localCentre
        .clone()
        .addScaledVector(localNormal, radius * valueGapRatio);
      const startWorld = worldPositionOf(die, vocabulary).add(
        startPosition.clone().applyQuaternion(worldRotation),
      );
      const worldNormal = localNormal.clone().applyQuaternion(worldRotation);

      const endWorld = gathering
        ? centre
            .clone()
            .addScaledVector(viewUp, averageRadius * gatherUpRatio)
            .addScaledVector(
              viewRight,
              (index - (entries.length - 1) / 2) *
                averageRadius *
                gatherSpreadRatio,
            )
        : startWorld
            .clone()
            .addScaledVector(worldNormal, radius * valueLiftRatio)
            .addScaledVector(viewUp, radius * valueViewLiftRatio);

      values.push({
        die,
        object,
        material,
        texture,
        geometry,
        // Both ends are held in the die's own space, so if anything moves that
        // die the value travels with it instead of being re-projected.
        startPosition,
        endPosition: toDieLocal(die, vocabulary, endWorld),
        startQuaternion: vocabulary
          .quaternion()
          .setFromUnitVectors(
            vocabulary.vector(0, 0, 1),
            localNormal.clone(),
          ),
        endQuaternion: toDieLocalQuaternion(
          die,
          vocabulary,
          facingQuaternion(
            vocabulary,
            cameraPosition.clone().sub(endWorld).normalize(),
            viewUp,
          ),
        ),
        workingQuaternion: vocabulary.quaternion(),
        delayMs: index * valueStaggerMs,
      });
      object.scale.set(0.55, 0.55, 0.55);
      material.opacity = 0;
      die.add(object);
    }

    buildFlourish(entries, vocabulary);
    totalMs =
      values.reduce(
        (longest, value) => Math.max(longest, value.delayMs + valueRiseMs),
        0,
      ) + valueHoldMs;
  }

  function buildFlourish(
    diceEntries: readonly DieEntry[],
    vocabularyForRings: SceneVocabulary,
  ): void {
    // A check's primary die is the meaningful home for its flourish. Damage
    // and other plain rolls have no natural-face die, so use their first landed
    // die instead; selecting an ordinary flourish must work for those rolls too.
    const flourishFaceIndex =
      request.naturalFaceIndex >= 0
        ? request.naturalFaceIndex
        : diceEntries[0]?.faceIndex;
    const naturalDie = diceEntries.find(
      (entry) => entry.faceIndex === flourishFaceIndex,
    )?.die;
    if (!naturalDie) return;
    const profile = flourishProfileOf(request.flourish);
    if (profile.ringScale <= 0) return;
    const face = readTopFace(naturalDie, vocabularyForRings);
    if (!face) return;
    const radius = naturalDie.geometry.boundingSphere?.radius ?? 1;
    const texture = drawTexture(
      createCanvas,
      vocabularyForRings,
      (context, size) => drawFlourishTexture(context, size),
      dieValueTextureSize,
    );
    if (!texture) return;
    const quad = quadObject(
      vocabularyForRings,
      naturalDie,
      texture,
      radius * 2,
      accent,
    );
    if (!quad) {
      texture.dispose?.();
      return;
    }
    const localNormal = vocabularyForRings.vector(
      face.normal[0],
      face.normal[1],
      face.normal[2],
    );
    quad.object.position
      .set(face.centre[0], face.centre[1], face.centre[2])
      .addScaledVector(localNormal, radius * valueGapRatio);
    quad.object.quaternion.setFromUnitVectors(
      vocabularyForRings.vector(0, 0, 1),
      localNormal,
    );
    // Additive blending turns the ring into light rather than a decal.
    quad.material.blending = 2;
    quad.object.renderOrder = 21;

    // The die's own material glows: the flourish is emitted by the mesh, not
    // drawn near it.
    const restore: FlourishEffect["restore"] = [];
    const materials = Array.isArray(naturalDie.material)
      ? naturalDie.material
      : [naturalDie.material];
    for (const material of materials) {
      if (!material.emissive) continue;
      restore.push({
        material,
        emissive: material.emissive.clone(),
        intensity: material.emissiveIntensity ?? 0,
      });
      material.emissive.setRGB(accentRgb[0], accentRgb[1], accentRgb[2]);
    }
    naturalDie.add(quad.object);
    flourish = {
      die: naturalDie,
      object: quad.object,
      material: quad.material,
      texture,
      geometry: quad.geometry,
      profile,
      restore,
    };
  }

  function updateValues(elapsed: number): void {
    for (const value of values) {
      const progress = clamp01((elapsed - value.delayMs) / valueRiseMs);
      const lift = easeOutCubic(progress);
      value.object.position.lerpVectors(
        value.startPosition,
        value.endPosition,
        lift,
      );
      // It leaves the face first, then turns toward the camera and squares up
      // with the screen.
      value.workingQuaternion
        .copy(value.startQuaternion)
        .slerp(value.endQuaternion, easeOutCubic(clamp01((progress - 0.22) / 0.78)));
      value.object.quaternion.copy(value.workingQuaternion);
      const scale = 0.55 + 0.45 * easeOutCubic(clamp01(progress / 0.3));
      value.object.scale.set(scale, scale, scale);
      value.material.opacity = clamp01(progress / 0.18);
    }
    if (!flourish) return;
    const progress = clamp01(elapsed / flourishMs);
    const reach = 0.55 + flourish.profile.ringScale * easeOutCubic(progress);
    flourish.object.scale.set(reach, reach, reach);
    flourish.material.opacity = (1 - progress) ** 1.4;
    const glow =
      Math.sin(Math.PI * clamp01(progress / 0.7)) *
      flourish.profile.glow *
      amplitude;
    for (const entry of flourish.restore)
      if (typeof entry.material.emissiveIntensity === "number")
        entry.material.emissiveIntensity = glow;
  }

  function fadeValues(elapsed: number): void {
    const remaining = 1 - clamp01(elapsed / valueFadeMs);
    for (const value of values)
      value.material.opacity = clamp01(remaining);
    if (!flourish) return;
    flourish.material.opacity = (flourish.material.opacity ?? 1) * remaining;
    for (const entry of flourish.restore)
      if (typeof entry.material.emissiveIntensity === "number")
        entry.material.emissiveIntensity *= remaining;
  }

  function cleanup(): void {
    if (state === "disposed") return;
    state = "disposed";
    if (frame) cancelFrame(frame);
    frame = 0;
    for (const value of values) {
      value.die.remove(value.object);
      value.geometry.dispose?.();
      value.material.dispose?.();
      value.texture.dispose?.();
    }
    values = [];
    if (flourish) {
      flourish.die.remove(flourish.object);
      flourish.geometry.dispose?.();
      flourish.material.dispose?.();
      flourish.texture.dispose?.();
      for (const entry of flourish.restore) {
        entry.material.emissive?.setRGB(
          entry.emissive.r,
          entry.emissive.g,
          entry.emissive.b,
        );
        if (typeof entry.material.emissiveIntensity === "number")
          entry.material.emissiveIntensity = entry.intensity;
      }
      flourish = null;
    }
    renderer.render(scene, camera);
    if (!doneResolved) {
      doneResolved = true;
      resolveDone();
    }
  }

  function schedule(): void {
    if (state === "disposed" || frame) return;
    frame = requestFrame(tick);
  }

  function tick(): void {
    frame = 0;
    if (state === "disposed") return;
    const elapsed = now();
    if (state === "settling") {
      // The value appears only once the landed mesh has held still for
      // consecutive frames, never merely because the throw's promise resolved.
      const samples = entries.map(({ die }) => dieSampleOf(die));
      stillFrames = samplesStable(previousSamples, samples)
        ? stillFrames + 1
        : 0;
      previousSamples = samples;
      if (
        stillFrames >= valueStableFrames ||
        elapsed - settlingSince >= valueStableTimeoutMs
      ) {
        startedAt = elapsed;
        buildValues();
        state = "playing";
        updateValues(0);
        renderer.render(scene, camera);
        onValueShown?.();
      }
      schedule();
      return;
    }
    if (state === "playing") {
      const since = elapsed - startedAt;
      updateValues(since);
      renderer.render(scene, camera);
      if (since >= totalMs && !doneResolved) {
        doneResolved = true;
        finishedAt = elapsed;
        state = "fading";
        // The caller starts its screen-space arithmetic here; the scene fades
        // the same values out rather than cutting them.
        resolveDone();
      }
      schedule();
      return;
    }
    fadeValues(elapsed - finishedAt);
    renderer.render(scene, camera);
    if (elapsed - finishedAt >= valueFadeMs) {
      cleanup();
      return;
    }
    schedule();
  }

  schedule();
  return { done, dispose: cleanup };
}
