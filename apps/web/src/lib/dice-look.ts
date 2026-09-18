import { hexToRgb } from "./dice-scene";

/**
 * The renderer's own appearance, driven by the skin the settings resolved.
 *
 * Upstream 0.0.12 leaves two of the skin's axes inert, and both are fixed here at
 * the Three.js level rather than around it:
 *
 * - `theme_surface` selects the impact *sounds* only: the scene's surface is a
 *   `ShadowMaterial` backdrop that renders nothing except the dice's shadow, so
 *   the selected table never appears. {@link createSurfaceApplier} lights the
 *   scene with the surface's own light and turns that backdrop into an opaque
 *   plate in the surface's colour, which keeps catching the shadow because it is
 *   still upstream's own mesh.
 * - every die material multiplies its baked canvas texture by the preset's own
 *   tint (`0xB5B5B5` matte, `0xDDDDDD` metal) and, for the metallic presets,
 *   scales that texture away by a `metalness` with no environment map to reflect.
 *   {@link normalizeDieMaterial} restores the authored colours.
 *
 * Nothing here decides a game fact: it only writes appearance into objects the
 * renderer already owns, and the plate is a clone, so everything this module
 * allocates is ours to release.
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
  map?: unknown;
  bumpMap?: unknown;
  normalMap?: unknown;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  side?: number;
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

/** The parts of the renderer's scene a surface is applied to. */
export interface DiceLookTarget {
  /** The mesh upstream uses to catch shadows; it becomes the surface plate. */
  desk?: SceneMeshLike | null;
  light?: SceneLightLike | null;
  light_amb?: SceneLightLike | null;
}

/**
 * One surface: the colour of the table the dice are thrown against, and the
 * light they are thrown in. Upstream's scene has one surface and two lights, so
 * those three facts are the whole look.
 */
export interface DiceSurfaceLook {
  /** Six-digit hex, so a test can assert the surfaces stay distinguishable. */
  desk: string;
  spot: { color: string; intensity: number };
  ambient: { sky: string; ground: string; intensity: number };
}

/**
 * The looks, one per `diceSurfaceOptions` id: a felt table is a felt-green
 * surface under a flat white light, stainless is a bright cold plate, and the
 * neon surface is a dark plate under a magenta spot with a cold ground bounce.
 */
export const diceSurfaceLooks: Record<string, DiceSurfaceLook> = {
  taverntable: {
    desk: "#3a2a1c",
    spot: { color: "#ffe6c2", intensity: 0.85 },
    ambient: { sky: "#4a3626", ground: "#16100a", intensity: 0.4 },
  },
  mahogany: {
    desk: "#4d2016",
    spot: { color: "#ffd9b0", intensity: 0.9 },
    ambient: { sky: "#5c2a1c", ground: "#200c07", intensity: 0.42 },
  },
  "green-felt": {
    desk: "#1d5237",
    spot: { color: "#f8fff6", intensity: 0.95 },
    ambient: { sky: "#26472f", ground: "#0b1a12", intensity: 0.46 },
  },
  "blue-felt": {
    desk: "#1b3c66",
    spot: { color: "#eef4ff", intensity: 0.95 },
    ambient: { sky: "#24384f", ground: "#0a1420", intensity: 0.46 },
  },
  "red-felt": {
    desk: "#66212c",
    spot: { color: "#fff0ee", intensity: 0.95 },
    ambient: { sky: "#4c2128", ground: "#1c0a0d", intensity: 0.46 },
  },
  stainless: {
    desk: "#8f969e",
    spot: { color: "#ffffff", intensity: 1.05 },
    ambient: { sky: "#c9d3dd", ground: "#3a4046", intensity: 0.55 },
  },
  cyberpunk: {
    desk: "#1c0e2f",
    spot: { color: "#ff45d2", intensity: 1 },
    ambient: { sky: "#31205c", ground: "#06202a", intensity: 0.5 },
  },
  cagetown: {
    desk: "#4c473d",
    spot: { color: "#ffe9c9", intensity: 0.8 },
    ambient: { sky: "#4c4639", ground: "#171512", intensity: 0.38 },
  },
  default: {
    desk: "#22262c",
    spot: { color: "#ffffff", intensity: 0.7 },
    ambient: { sky: "#3a4048", ground: "#12151a", intensity: 0.42 },
  },
};

export const defaultDiceSurfaceLook: DiceSurfaceLook = diceSurfaceLooks.default!;

/** The look for a surface id, falling back to the neutral plate. */
export function diceSurfaceLook(surface: string): DiceSurfaceLook {
  return diceSurfaceLooks[surface] ?? defaultDiceSurfaceLook;
}

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
 * surface with it. The surface plate has to clone a material the renderer's own
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
 * A lit clone of the template, painted the surface's colour: the die's own
 * material class, so the surface is drawn by the same rendering path as the dice
 * themselves, with every map cleared so nothing of the die's texture shows
 * through. The clone is why cleanup is safe — the die keeps its own material.
 */
export function surfacePlateMaterial(
  template: unknown,
  look: DiceSurfaceLook,
): SceneMaterialLike | null {
  const source = template as SceneMaterialLike | null | undefined;
  if (!source || typeof source.clone !== "function") return null;
  const material = source.clone() as SceneMaterialLike;
  material.map = null;
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
  if (typeof material.metalness === "number") material.metalness = 0;
  if (typeof material.roughness === "number") material.roughness = 0.92;
  applyColor(material.color, look.desk);
  return material;
}

/** Applies the surface's own light to the scene's two lights. */
export function applySurfaceLighting(
  target: DiceLookTarget,
  surface: string,
): boolean {
  const look = diceSurfaceLook(surface);
  let changed = false;
  const spot = target.light;
  if (spot) {
    applyColor(spot.color, look.spot.color);
    if (typeof spot.intensity === "number") {
      spot.intensity = look.spot.intensity;
      changed = true;
    }
  }
  const ambient = target.light_amb;
  if (ambient) {
    applyColor(ambient.color, look.ambient.sky);
    applyColor(ambient.groundColor, look.ambient.ground);
    if (typeof ambient.intensity === "number") {
      ambient.intensity = look.ambient.intensity;
      changed = true;
    }
  }
  return changed;
}

/** A plate this module painted onto the renderer's own shadow-catcher mesh. */
interface SurfacePlate {
  mesh: SceneMeshLike;
  material: SceneMaterialLike;
  surface: string;
}

export interface SurfaceApplier {
  /**
   * Applies the surface now: the light always, and the plate as soon as a
   * material template exists. The template only becomes reachable once the
   * renderer has spawned a die, which happens at the start of every throw — that
   * is, before anything of that throw is on screen — so no frame is ever drawn on
   * an unpainted surface. Safe to call repeatedly, including after the renderer
   * has rebuilt its own surface on a resize.
   */
  apply(surface: string, template?: unknown): boolean;
  /** Releases the plate material; the mesh and its geometry are upstream's. */
  dispose(): void;
}

/**
 * Keeps one renderer's surface painted. The applier owns exactly one material at
 * a time: a new surface, a rebuilt mesh or teardown releases the previous one, so
 * changing appearance between rolls leaks nothing.
 */
export function createSurfaceApplier(target: DiceLookTarget): SurfaceApplier {
  let plate: SurfacePlate | null = null;
  let template: SceneMaterialLike | null = null;

  const disposePlate = () => {
    const previous = plate;
    plate = null;
    try {
      previous?.material.dispose?.();
    } catch {
      // A material whose context is already gone needs no release.
    }
  };

  return {
    apply(surface, nextTemplate) {
      let changed = applySurfaceLighting(target, surface);
      const source = dieMaterialTemplate(nextTemplate);
      if (source) template = source;
      const desk = target.desk;
      if (!desk || !template) return changed;
      // Upstream rebuilds its mesh on a resize and its material is not ours to
      // repaint, so a new mesh — or a new surface — is a new plate.
      if (plate && plate.mesh === desk && plate.surface === surface)
        return changed;
      const material = surfacePlateMaterial(
        template,
        diceSurfaceLook(surface),
      );
      if (!material) return changed;
      disposePlate();
      desk.material = material;
      plate = { mesh: desk, material, surface };
      return true;
    },
    dispose() {
      disposePlate();
      template = null;
    },
  };
}
