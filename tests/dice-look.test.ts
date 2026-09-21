import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { diceSurfaceOptions } from "@threepointpf/dice";
import {
  applyNeutralDiceLighting,
  applyTextureRepeat,
  createSurfaceApplier,
  createSurfaceCanvas,
  createSurfaceTexture,
  defaultDiceSurfaceLook,
  dieMetalnessCeiling,
  dieMetalnessScale,
  diceSurfaceLook,
  diceSurfaceLooks,
  firstDieMaterial,
  linearFilter,
  linearMipmapLinearFilter,
  neutralDiceLighting,
  normalizeDieMaterial,
  patchDieCreation,
  patchDieMaterials,
  readableNumeralOutline,
  rendererTextureAnisotropy,
  repeatWrapping,
  surfaceAnisotropyCap,
  surfacePlateMaterial,
  surfaceTextureSize,
  type DiceLookTarget,
  type DiceSurfaceKind,
  type SceneColorLike,
  type SceneLightLike,
  type SceneMaterialLike,
  type SceneMeshLike,
  type SceneTextureLike,
  type SurfaceMaterialFactoryLike,
} from "../apps/web/src/lib/dice-look";
import { asCanvas } from "./helpers/fake-three";

/**
 * The surface and the die colours are both written into objects the renderer
 * already owns, so what matters is exactly what this module writes — and that it
 * releases everything it allocates. These tests drive it against small
 * structural stand-ins, the same way the renderer hands it real three.js
 * materials, lights, meshes and canvas textures.
 */

interface FakeColor extends SceneColorLike {
  r: number;
  g: number;
  b: number;
}

interface FakeMaterial extends SceneMaterialLike {
  color: FakeColor;
  disposed: number;
}

function fakeColor(r = 0, g = 0, b = 0): FakeColor {
  return {
    r,
    g,
    b,
    setRGB(red, green, blue) {
      this.r = red;
      this.g = green;
      this.b = blue;
    },
  };
}

/** The floats a colour holds once the module has written a hex onto it. */
function fakeColorFrom(hex: string): FakeColor {
  const value = Number.parseInt(hex.slice(1), 16);
  return fakeColor(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

const rgbOf = (color: FakeColor) =>
  [color.r, color.g, color.b].map((value) => Math.round(value * 255));

/**
 * A material shaped like the renderer's own: it can be cloned, and a clone
 * counts its own disposal so a leak, or a release of the renderer's material,
 * is observable.
 */
function fakeMaterial(overrides: Partial<FakeMaterial> = {}): FakeMaterial {
  const material: FakeMaterial = {
    color: fakeColor(0.71, 0.71, 0.71),
    emissive: fakeColor(0, 0, 0),
    emissiveIntensity: 1,
    metalness: 0.6,
    roughness: 0.5,
    map: { kind: "die-texture" },
    bumpMap: { kind: "die-bump" },
    normalMap: null,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
    clone() {
      return fakeMaterial({ ...overrides });
    },
    ...overrides,
  };
  return material;
}

/** The renderer's own canvas-texture class, as much of it as the plate uses. */
class FakeCanvasTexture implements SceneTextureLike {
  canvas: unknown;
  needsUpdate = true;
  wrapS = 0;
  wrapT = 0;
  disposed = 0;
  repeat = {
    x: 1,
    y: 1,
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
  };
  constructor(canvas: unknown) {
    this.canvas = canvas;
  }
  dispose() {
    this.disposed += 1;
  }
}

/** A patched upstream DiceFactory: every table material is Standard-shaped. */
class FakeSurfaceFactory implements SurfaceMaterialFactoryLike {
  readonly materials: FakeMaterial[] = [];
  readonly textures: FakeCanvasTexture[] = [];

  createSurfaceMaterial(parameters: Record<string, unknown> = {}) {
    const material = fakeMaterial({
      map: null,
      bumpMap: null,
      normalMap: null,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
    if (typeof parameters.metalness === "number")
      material.metalness = parameters.metalness;
    if (typeof parameters.roughness === "number")
      material.roughness = parameters.roughness;
    if (typeof parameters.transparent === "boolean")
      material.transparent = parameters.transparent;
    if (typeof parameters.opacity === "number") material.opacity = parameters.opacity;
    if (typeof parameters.depthTest === "boolean")
      material.depthTest = parameters.depthTest;
    if (typeof parameters.depthWrite === "boolean")
      material.depthWrite = parameters.depthWrite;
    if (typeof parameters.side === "number") material.side = parameters.side;
    if (typeof parameters.envMapIntensity === "number")
      material.envMapIntensity = parameters.envMapIntensity;
    this.materials.push(material);
    return material;
  }

  createSurfaceTexture(canvas: unknown) {
    const texture = new FakeCanvasTexture(canvas);
    this.textures.push(texture);
    return texture;
  }
}

/** A die material whose map belongs to a real texture class. */
function fakeTexturedDie(texture: FakeCanvasTexture = new FakeCanvasTexture(null)) {
  return { material: [fakeMaterial({ map: texture })] };
}

function fakeDie(materials: FakeMaterial[] = [fakeMaterial()]) {
  return { material: materials, geometry: { kind: "die-geometry" } };
}

function fakeLight(intensity = 1) {
  return { color: fakeColor(), intensity };
}

function fakeTarget() {
  const ambient = { ...fakeLight(), groundColor: fakeColor() };
  const DiceFactory = new FakeSurfaceFactory();
  return {
    desk: { material: fakeMaterial(), receiveShadow: true } as SceneMeshLike,
    light: fakeLight() as SceneLightLike,
    light_amb: ambient as SceneLightLike,
    DiceFactory,
  } satisfies DiceLookTarget & {
    desk: SceneMeshLike;
    light: SceneLightLike;
    light_amb: SceneLightLike;
    DiceFactory: FakeSurfaceFactory;
  };
}

type FakeTarget = ReturnType<typeof fakeTarget>;
const lightColorOf = (target: FakeTarget) =>
  rgbOf(target.light.color as FakeColor);
const plateOf = (target: FakeTarget) => target.desk.material as FakeMaterial;

/* ------------------------------------------------------------------ *
 * Recording canvases, so a generated surface can be inspected.
 * ------------------------------------------------------------------ */

interface RecordingCanvas {
  width: number;
  height: number;
  context: RecordingContext;
  getContext(): RecordingContext;
}

interface RecordingContext {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  rects: number;
  strokes: number;
  fills: number;
  /** A rolling hash of every drawing call, for determinism comparisons. */
  signature: number;
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
  drawImage(
    image: unknown,
    dx: number,
    dy: number,
    width: number,
    height: number,
  ): void;
}

function recordingCanvas(): RecordingCanvas {
  const context = {
    globalAlpha: 1,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 1,
    rects: 0,
    strokes: 0,
    fills: 0,
    signature: 0x811c9dc5,
    fillRect(x, y, width, height) {
      context.rects += 1;
      record(
        context,
        `rect ${String(context.fillStyle)} ${x},${y},${width},${height}`,
      );
    },
    beginPath() {
      record(context, "begin");
    },
    closePath() {
      record(context, "close");
    },
    moveTo(x, y) {
      record(context, `move ${x},${y}`);
    },
    lineTo(x, y) {
      record(context, `line ${x},${y}`);
    },
    quadraticCurveTo(controlX, controlY, x, y) {
      record(context, `quad ${controlX},${controlY},${x},${y}`);
    },
    stroke() {
      context.strokes += 1;
      record(context, `stroke ${String(context.strokeStyle)} ${context.lineWidth}`);
    },
    fill() {
      context.fills += 1;
      record(context, "fill");
    },
    drawImage(image, dx, dy, width, height) {
      record(context, `image ${dx},${dy},${width},${height}`);
    },
  } as unknown as RecordingContext;
  const canvas: RecordingCanvas = {
    width: 0,
    height: 0,
    context,
    getContext: () => context,
  };
  return canvas;
}

function record(context: RecordingContext, token: string): void {
  let hash = context.signature;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  context.signature = hash >>> 0;
}

/** Generates a surface on a recording canvas and hands back what it drew. */
function generate(kind: DiceSurfaceKind, tint: string): RecordingContext {
  const canvas = recordingCanvas();
  createSurfaceCanvas(kind, tint, () => asCanvas(canvas));
  return canvas.context;
}

const recordingFactory = () => asCanvas(recordingCanvas());

describe("readableNumeralOutline", () => {
  it("gives light numerals a dark outline and dark numerals a light one", () => {
    // The four colours the appearance matrix calls out explicitly.
    expect(readableNumeralOutline("#ffffff")).toBe("#050608");
    expect(readableNumeralOutline("#f3c877")).toBe("#050608");
    expect(readableNumeralOutline("#111111")).toBe("#f7f7f2");
    expect(readableNumeralOutline("#2b2b34")).toBe("#f7f7f2");
  });

  it("chooses the ink with the higher contrast, not a luminance threshold", () => {
    // A saturated yellow is bright to the eye even though it is not a light
    // grey; it takes the dark outline.
    expect(readableNumeralOutline("#f2d21a")).toBe("#050608");
    // A saturated blue is dark to the eye; it takes the light outline.
    expect(readableNumeralOutline("#1020d0")).toBe("#f7f7f2");
    // These colours sit below the old 0.4 threshold, but the dark ink has much
    // stronger contrast than off-white (8.36:1 and 8.71:1 respectively).
    expect(readableNumeralOutline("#a5a5a5")).toBe("#050608");
    expect(readableNumeralOutline("#00aa00")).toBe("#050608");
  });

  it("never returns the fill colour itself", () => {
    for (const fill of ["#ffffff", "#111111", "#f3c877", "#2b2b34", "#245b3b"])
      expect(readableNumeralOutline(fill)).not.toBe(fill);
  });
});

describe("the patched upstream numeral canvas", () => {
  it("backs every real texture and gives d4 the same proportional treatment", () => {
    const patch = readFileSync(
      "patches/@3d-dice__dice-box-threejs@0.0.12.patch",
      "utf8",
    );

    // Texture objects, rather than their display names, decide whether a face
    // needs its base-colour knockout. This covers every shipped texture and
    // future custom ones with the same upstream shape.
    expect(patch).toContain(
      '+        const textured = Boolean(o?.texture) && o.name != "" && o.name != "none";',
    );
    expect(patch).toContain(
      "+          f.strokeStyle = a, f.lineWidth = backingWidth, f.strokeText(text, x, y);",
    );
    expect(patch).toContain(
      '+      const fontSize = w / 128 * 24;',
    );
    expect(patch).toContain(
      "+          drawGlyphBacking(d[F], x, M - w * 0.3, fontSize),",
    );
    // Removed diff lines retain the old condition, so inspect additions only.
    expect(patch).not.toMatch(/^\+.*l != a/m);
    expect(patch).not.toContain("textureName");
  });
});

describe("surface looks", () => {
  it("gives every selectable surface a look of its own", () => {
    for (const option of diceSurfaceOptions)
      expect(diceSurfaceLooks[option.id], option.id).toBeDefined();
  });

  it("keeps the surfaces visibly distinguishable", () => {
    const tints = diceSurfaceOptions.map(
      (option) => diceSurfaceLook(option.id).tint,
    );
    expect(new Set(tints).size).toBe(tints.length);
  });

  it("authors every look as a tinted material spec the scene can read", () => {
    const kinds: DiceSurfaceKind[] = [
      "solid",
      "wood",
      "felt",
      "brushed-metal",
      "cyber-grid",
      "stone",
    ];
    for (const look of Object.values(diceSurfaceLooks)) {
      expect(look.tint).toMatch(/^#[0-9a-f]{6}$/i);
      expect(kinds).toContain(look.kind);
      expect(look.roughness).toBeGreaterThan(0);
      expect(look.roughness).toBeLessThanOrEqual(1);
      expect(look.metalness).toBeGreaterThanOrEqual(0);
      expect(look.metalness).toBeLessThanOrEqual(1);
      expect(look.textureScale).toBeGreaterThan(0);
    }
  });

  it("matches the authored definitions exactly", () => {
    expect(diceSurfaceLooks.default).toEqual({
      kind: "solid",
      tint: "#22262c",
      roughness: 0.9,
      metalness: 0,
      textureScale: 1,
    });
    expect(diceSurfaceLooks.taverntable).toEqual({
      kind: "wood",
      tint: "#6b4528",
      roughness: 0.78,
      metalness: 0,
      textureScale: 2,
    });
    expect(diceSurfaceLooks.mahogany).toEqual({
      kind: "wood",
      tint: "#4a1e17",
      roughness: 0.7,
      metalness: 0,
      textureScale: 2,
    });
    expect(diceSurfaceLooks["green-felt"]).toEqual({
      kind: "felt",
      tint: "#245b3b",
      roughness: 1,
      metalness: 0,
      textureScale: 4,
    });
    expect(diceSurfaceLooks.stainless).toEqual({
      kind: "brushed-metal",
      tint: "#9da5ad",
      roughness: 0.48,
      metalness: 0.55,
      textureScale: 3,
    });
    expect(diceSurfaceLooks.cyberpunk).toEqual({
      kind: "cyber-grid",
      tint: "#171526",
      roughness: 0.55,
      metalness: 0.15,
      textureScale: 1,
    });
    expect(diceSurfaceLooks.cagetown).toEqual({
      kind: "stone",
      tint: "#4c4941",
      roughness: 0.96,
      metalness: 0,
      textureScale: 3,
    });
  });

  it("falls back to the neutral look for an unknown surface", () => {
    expect(diceSurfaceLook("not-a-surface")).toBe(defaultDiceSurfaceLook);
  });

  it("carries no per-surface light any more", () => {
    for (const look of Object.values(diceSurfaceLooks)) {
      expect(look).not.toHaveProperty("desk");
      expect(look).not.toHaveProperty("spot");
      expect(look).not.toHaveProperty("ambient");
    }
  });
});

describe("generated surface textures", () => {
  it("draws a real pattern for every surface, not a flat colour", () => {
    const solid = generate("solid", "#22262c");
    // The solid plate is one fill and nothing else.
    expect(solid.rects).toBe(1);
    expect(solid.strokes).toBe(0);

    const wood = generate("wood", "#6b4528");
    // Periodic grain plus several knot rings; it is visibly more than a tint.
    expect(wood.strokes).toBeGreaterThanOrEqual(72);

    const felt = generate("felt", "#245b3b");
    // Multi-pixel fibres are stroked so they survive mip generation.
    expect(felt.strokes).toBeGreaterThanOrEqual(4200);

    const metal = generate("brushed-metal", "#9da5ad");
    expect(metal.strokes).toBeGreaterThanOrEqual(420);
    expect(metal.rects).toBeGreaterThanOrEqual(surfaceTextureSize);

    const grid = generate("cyber-grid", "#171526");
    // Minor, major and accent lines, each drawn both ways.
    expect(grid.strokes).toBeGreaterThan(32);

    const stone = generate("stone", "#4c4941");
    expect(stone.rects).toBeGreaterThanOrEqual(2200);
    expect(stone.strokes).toBeGreaterThanOrEqual(13);
  });

  it("is deterministic: the same kind and tint draw the same pixels", () => {
    for (const [kind, tint] of [
      ["wood", "#6b4528"],
      ["felt", "#245b3b"],
      ["brushed-metal", "#9da5ad"],
      ["cyber-grid", "#171526"],
      ["stone", "#4c4941"],
      ["solid", "#22262c"],
    ] as const) {
      const first = generate(kind, tint);
      const second = generate(kind, tint);
      expect(second.signature, kind).toBe(first.signature);
      expect(second.rects).toBe(first.rects);
      expect(second.strokes).toBe(first.strokes);
    }
  });

  it("gives different surfaces and tints different patterns", () => {
    const tavern = generate("wood", diceSurfaceLook("taverntable").tint);
    const mahogany = generate("wood", diceSurfaceLook("mahogany").tint);
    // Same generator, different tint: the tint alone seeds a different grain.
    expect(mahogany.signature).not.toBe(tavern.signature);
    expect(generate("felt", "#245b3b").signature).not.toBe(
      generate("stone", "#245b3b").signature,
    );
  });

  it("produces a canvas at the authored resolution", () => {
    const canvas = createSurfaceCanvas("wood", "#6b4528", () =>
      asCanvas(recordingCanvas()),
    )!;
    expect(canvas.width).toBe(surfaceTextureSize);
    expect(canvas.height).toBe(surfaceTextureSize);
  });

  it("declines rather than throwing when the runtime has no canvas", () => {
    expect(createSurfaceCanvas("wood", "#6b4528", () => null)).toBeNull();
  });
});

describe("surface textures own their repetition and lifetime", () => {
  it("tiles the generated canvas at the look's scale", () => {
    const factory = new FakeSurfaceFactory();
    const texture = createSurfaceTexture(
      factory,
      diceSurfaceLook("green-felt"),
      recordingFactory,
      16,
    ) as FakeCanvasTexture;
    expect(texture).toBeInstanceOf(FakeCanvasTexture);
    expect(texture.repeat.x).toBe(4);
    expect(texture.repeat.y).toBe(4);
    expect(texture.wrapS).toBe(repeatWrapping);
    expect(texture.wrapT).toBe(repeatWrapping);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(linearMipmapLinearFilter);
    expect(texture.magFilter).toBe(linearFilter);
    expect(texture.anisotropy).toBe(surfaceAnisotropyCap);
    expect(texture.needsUpdate).toBe(true);
  });

  it("uses the renderer cap for anisotropy without assuming a renderer class", () => {
    expect(
      rendererTextureAnisotropy({
        capabilities: { getMaxAnisotropy: () => 6 },
      }),
    ).toBe(6);
    expect(rendererTextureAnisotropy({ capabilities: {} })).toBeUndefined();
    expect(
      rendererTextureAnisotropy({
        capabilities: { getMaxAnisotropy: () => Number.NaN },
      }),
    ).toBeUndefined();
  });

  it("reports a texture that cannot express a repeat instead of guessing", () => {
    expect(applyTextureRepeat(null, 4)).toBe(false);
    expect(applyTextureRepeat({}, 4)).toBe(false);
    expect(applyTextureRepeat({ repeat: {} }, 4)).toBe(false);
    expect(applyTextureRepeat({ repeat: {} }, 0)).toBe(false);
  });

  it("bakes the repetition into the canvas when the texture cannot repeat", () => {
    const created: NoRepeatTexture[] = [];
    class NoRepeatTexture implements SceneTextureLike {
      canvas: unknown;
      disposed = 0;
      constructor(canvas: unknown) {
        this.canvas = canvas;
        created.push(this);
      }
      dispose() {
        this.disposed += 1;
      }
    }
    const dieMap = new NoRepeatTexture(null);
    const template = fakeMaterial({ map: dieMap as unknown as SceneTextureLike });
    const texture = createSurfaceTexture(
      template,
      diceSurfaceLook("mahogany"),
      recordingFactory,
    ) as NoRepeatTexture;
    // created[0] is the template's own map; the plate's untiled texture is
    // created[1] and is released in favour of the tiled created[2].
    expect(created).toHaveLength(3);
    expect(texture).toBe(created[2]);
    expect(created[1]!.disposed).toBe(1);
    // The die's own map is never ours to dispose.
    expect(dieMap.disposed).toBe(0);
  });

  it("declines rather than faking a map when there is no canvas at all", () => {
    class NoRepeatTexture implements SceneTextureLike {
      canvas: unknown;
      constructor(canvas: unknown) {
        this.canvas = canvas;
      }
    }
    const first = new NoRepeatTexture(null);
    const template = fakeMaterial({ map: first });
    // Without a canvas the surface has no map; it never returns a broken one.
    const texture = createSurfaceTexture(
      template,
      diceSurfaceLook("mahogany"),
      () => null,
    );
    expect(texture).toBeNull();
  });

  it("releases the plate texture when the surface changes or the applier is disposed", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    applier.apply("green-felt", fakeTexturedDie());
    const felt = plateOf(target).map as FakeCanvasTexture;
    expect(felt).toBeInstanceOf(FakeCanvasTexture);
    expect(felt.disposed).toBe(0);

    applier.apply("stainless", fakeTexturedDie());
    const steel = plateOf(target).map as FakeCanvasTexture;
    expect(steel).not.toBe(felt);
    expect(felt.disposed).toBe(1);

    applier.dispose();
    expect(steel.disposed).toBe(1);
  });

  it("releases the texture of a plate the renderer rebuilt", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    applier.apply("green-felt", fakeTexturedDie());
    const first = plateOf(target).map as FakeCanvasTexture;
    target.desk = { material: fakeMaterial(), receiveShadow: true };
    applier.apply("green-felt", fakeTexturedDie());
    expect(first.disposed).toBe(1);
    applier.dispose();
  });
});

describe("applyNeutralDiceLighting", () => {
  it("applies the one neutral light, whatever the surface", () => {
    const target = fakeTarget();
    expect(applyNeutralDiceLighting(target)).toBe(true);
    expect(lightColorOf(target)).toEqual([255, 255, 255]);
    expect(target.light.intensity).toBe(neutralDiceLighting.spot.intensity);
    expect(rgbOf(target.light_amb.color as FakeColor)).toEqual([255, 255, 255]);
    expect(rgbOf(target.light_amb.groundColor as FakeColor)).toEqual(
      rgbOf(fakeColorFrom(neutralDiceLighting.ambient.ground)),
    );
    expect(target.light_amb.intensity).toBe(
      neutralDiceLighting.ambient.intensity,
    );
  });

  it("does not take a surface id, so selecting a surface cannot recolour the dice", () => {
    const first = fakeTarget();
    const second = fakeTarget();
    applyNeutralDiceLighting(first);
    applyNeutralDiceLighting(second);
    expect(lightColorOf(first)).toEqual(lightColorOf(second));
    expect(first.light.intensity).toBe(second.light.intensity);
    expect(first.light_amb.intensity).toBe(second.light_amb.intensity);
  });

  it("reports nothing to do for a scene without lights", () => {
    expect(applyNeutralDiceLighting({})).toBe(false);
  });
});

describe("normalizeDieMaterial", () => {
  it("leaves the baked texture carrying the authored colour", () => {
    const material = fakeMaterial();
    expect(normalizeDieMaterial(material)).toBe(true);
    expect([material.color.r, material.color.g, material.color.b]).toEqual([
      1, 1, 1,
    ]);
  });

  it("scales down a metalness that has no environment map to reflect", () => {
    const metallic = fakeMaterial({ metalness: 0.6 });
    normalizeDieMaterial(metallic);
    expect(metallic.metalness).toBeCloseTo(0.6 * dieMetalnessScale, 6);

    const perfect = fakeMaterial({ metalness: 1 });
    normalizeDieMaterial(perfect);
    expect(perfect.metalness).toBe(dieMetalnessCeiling);
    expect(perfect.metalness).toBeLessThanOrEqual(dieMetalnessCeiling);

    const matte = fakeMaterial({ metalness: 0 });
    normalizeDieMaterial(matte);
    expect(matte.metalness).toBe(0);
  });

  it("keeps the material's own sheen and bump mapping", () => {
    const material = fakeMaterial({ roughness: 0.9 });
    normalizeDieMaterial(material);
    expect(material.roughness).toBe(0.9);
    expect(material.bumpMap).toEqual({ kind: "die-bump" });
  });

  it("shrugs off values that are not materials", () => {
    expect(normalizeDieMaterial(null)).toBe(false);
    expect(normalizeDieMaterial("plastic")).toBe(false);
    expect(normalizeDieMaterial({})).toBe(false);
  });
});

describe("patchDieMaterials", () => {
  it("normalises every material the renderer builds", () => {
    const factory = {
      createMaterials: () => [fakeMaterial(), fakeMaterial({ metalness: 0.6 })],
    };
    expect(patchDieMaterials(factory)).toBe(true);
    const materials = factory.createMaterials() as FakeMaterial[];
    for (const material of materials) {
      expect([material.color.r, material.color.g, material.color.b]).toEqual([
        1, 1, 1,
      ]);
      expect(material.metalness).toBeLessThanOrEqual(dieMetalnessCeiling);
    }
  });

  it("passes the renderer's own arguments and receiver through", () => {
    const calls: unknown[] = [];
    const receiver = {
      label: "factory",
      createMaterials(this: unknown, ...args: unknown[]) {
        calls.push([this, ...args]);
        return [fakeMaterial()];
      },
    };
    patchDieMaterials(receiver);
    receiver.createMaterials(100, 0.5, 1, false, 2);
    expect(calls).toEqual([[receiver, 100, 0.5, 1, false, 2]]);
  });

  it("wraps once, however often it is applied", () => {
    const original = vi.fn(() => []);
    const inner = { createMaterials: original };
    expect(patchDieMaterials(inner)).toBe(true);
    expect(patchDieMaterials(inner)).toBe(false);
    inner.createMaterials();
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("leaves a factory without a material builder alone", () => {
    expect(patchDieMaterials({})).toBe(false);
    expect(patchDieMaterials(null)).toBe(false);
    expect(patchDieMaterials({ createMaterials: "not a function" })).toBe(false);
  });

  it("tolerates a builder that returns something unexpected", () => {
    const factory = { createMaterials: () => null };
    patchDieMaterials(factory);
    expect(factory.createMaterials()).toBeNull();
  });
});

describe("patchDieCreation", () => {
  it("hands every spawned die to the caller", () => {
    const spawned: unknown[] = [];
    const factory = { create: (type: string) => ({ type }) };
    expect(patchDieCreation(factory, (die) => spawned.push(die))).toBe(true);
    const die = factory.create("d6");
    expect(die).toEqual({ type: "d6" });
    expect(spawned).toEqual([die]);
  });

  it("still returns the die when the caller throws", () => {
    const factory = { create: () => ({ type: "d20" }) };
    patchDieCreation(factory, () => {
      throw new Error("no surface to paint");
    });
    expect(factory.create()).toEqual({ type: "d20" });
  });

  it("wraps once, however often it is applied", () => {
    const original = vi.fn(() => null);
    const factory = { create: original };
    expect(patchDieCreation(factory, () => {})).toBe(true);
    expect(patchDieCreation(factory, () => {})).toBe(false);
    factory.create();
    expect(original).toHaveBeenCalledTimes(1);
  });
});

describe("die material templates", () => {
  it("reads a face-material array or a single material", () => {
    const first = fakeMaterial();
    expect(firstDieMaterial([fakeDie([first, fakeMaterial()])])).toBe(first);
    expect(firstDieMaterial([{ material: first }])).toBe(first);
  });

  it("reports nothing for a renderer with no dice yet", () => {
    expect(firstDieMaterial([])).toBeNull();
    expect(firstDieMaterial(undefined)).toBeNull();
    expect(firstDieMaterial([{}])).toBeNull();
    expect(firstDieMaterial([fakeDie([])])).toBeNull();
  });
});

describe("surfacePlateMaterial", () => {
  it("wears the surface's own map with a white tint, so it cannot be multiplied dark", () => {
    const look = diceSurfaceLook("stainless");
    const texture = new FakeCanvasTexture(null);
    const plate = surfacePlateMaterial(new FakeSurfaceFactory(), look, texture)!;
    expect(plate.map).toBe(texture);
    expect(rgbOf(plate.color as FakeColor)).toEqual([255, 255, 255]);
    expect(plate.bumpMap).toBeNull();
    expect(plate.normalMap).toBeNull();
    expect(plate.emissiveIntensity).toBe(0);
    expect(plate.metalness).toBe(look.metalness);
    expect(plate.roughness).toBe(look.roughness);
  });

  it("does not clone, inspect, or mutate the die material", () => {
    const template = fakeMaterial();
    template.clone = vi.fn(() => fakeMaterial());
    const before = {
      map: template.map,
      bumpMap: template.bumpMap,
      transparent: template.transparent,
      depthTest: template.depthTest,
      color: { ...template.color },
    };
    surfacePlateMaterial(new FakeSurfaceFactory(), diceSurfaceLook("red-felt"), null);
    expect(template.map).toBe(before.map);
    expect(template.bumpMap).toBe(before.bumpMap);
    expect(template.transparent).toBe(before.transparent);
    expect(template.depthTest).toBe(before.depthTest);
    expect(rgbOf(template.color)).toEqual(rgbOf(before.color as FakeColor));
    expect(template.clone).not.toHaveBeenCalled();
  });

  it("stays depth-tested and opaque so the dice land on top of it", () => {
    const plate = surfacePlateMaterial(
      new FakeSurfaceFactory(),
      diceSurfaceLook("taverntable"),
      null,
    )!;
    expect(plate.depthTest).toBe(true);
    expect(plate.depthWrite).toBe(true);
    expect(plate.transparent).toBe(false);
    expect(plate.opacity).toBe(1);
  });

  it("fails loudly when the upstream Standard-material factory is unavailable", () => {
    expect(surfacePlateMaterial(null, diceSurfaceLook("default"))).toBeNull();
    expect(
      surfacePlateMaterial({ color: fakeColor() }, diceSurfaceLook("default")),
    ).toBeNull();
  });
});

describe("the surface material does not depend on the die material", () => {
  /** Runs the applier for one dice material and records the plate it produced. */
  function plateFor(material: FakeMaterial) {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    applier.apply("green-felt", { material: [material] });
    const plate = plateOf(target);
    const record = {
      transparent: plate.transparent,
      opaque: plate.opacity,
      metalness: plate.metalness,
      roughness: plate.roughness,
      color: rgbOf(plate.color),
      depthTest: plate.depthTest,
      depthWrite: plate.depthWrite,
      // The felt map is the generated surface texture, never the die's map.
      mapIsSurfaceTexture: plate.map instanceof FakeCanvasTexture,
      mapIsDieTexture: plate.map === material.map,
      mapRepeat: (plate.map as FakeCanvasTexture).repeat.x,
    };
    applier.dispose();
    return record;
  }

  it("builds the same opaque felt table for a plastic die and a glass one", () => {
    const plastic = plateFor(
      fakeMaterial({
        map: new FakeCanvasTexture(null),
        metalness: 0.2,
        roughness: 0.5,
        transparent: false,
        opacity: 1,
      }),
    );
    const glass = plateFor(
      fakeMaterial({
        map: new FakeCanvasTexture(null),
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.3,
        transmission: 1,
        envMapIntensity: 1.5,
      }),
    );
    // A glass die must not make the table transparent, a metal die must not make
    // felt metallic: the two records are identical.
    expect(glass).toEqual(plastic);
    expect(plastic).toMatchObject({
      transparent: false,
      opaque: 1,
      metalness: 0,
      roughness: 1,
      color: [255, 255, 255],
      depthTest: true,
      depthWrite: true,
      mapIsSurfaceTexture: true,
      mapIsDieTexture: false,
    });
  });

  it("uses Standard surface controls even when the only die is Matte/Phong", () => {
    const target = fakeTarget();
    const matte = {
      map: new FakeCanvasTexture(null),
      // Deliberately lacks roughness and metalness, as MeshPhongMaterial does.
      shininess: 5,
    };
    const applier = createSurfaceApplier(target, { createCanvas: recordingFactory });
    applier.apply("stainless", { material: [matte] });
    const plate = plateOf(target);
    expect(plate).toBe(target.DiceFactory.materials[0]);
    expect(plate.metalness).toBe(diceSurfaceLook("stainless").metalness);
    expect(plate.roughness).toBe(diceSurfaceLook("stainless").roughness);
    applier.dispose();
  });

  it("zeroes transmission on a new table material rather than inheriting glass", () => {
    const glass = fakeMaterial({ transmission: 1 });
    const plate = surfacePlateMaterial(
      new FakeSurfaceFactory(),
      diceSurfaceLook("green-felt"),
      null,
    )!;
    expect(plate.transmission).toBe(0);
    // The die's own material is not consulted and remains untouched.
    expect(glass.transmission).toBe(1);
  });
});

describe("the surface applier", () => {
  it("paints the table before the first die is spawned", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    expect(applier.apply("cyberpunk")).toBe(true);
    expect(target.light.intensity).toBe(neutralDiceLighting.spot.intensity);
    expect(plateOf(target).map).toBeInstanceOf(FakeCanvasTexture);
    applier.dispose();
  });

  it("paints the surface onto the renderer's own mesh", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    expect(applier.apply("green-felt", fakeTexturedDie())).toBe(true);
    const plate = plateOf(target);
    expect(rgbOf(plate.color)).toEqual([255, 255, 255]);
    expect(plate.map).toBeInstanceOf(FakeCanvasTexture);
    // It is still the renderer's mesh, so it still catches the dice's shadow.
    expect(target.desk.receiveShadow).toBe(true);
    applier.dispose();
  });

  it("releases the displaced upstream ShadowMaterial after replacing it", () => {
    const target = fakeTarget();
    const shadowMaterial = target.desk.material as FakeMaterial;
    const applier = createSurfaceApplier(target, { createCanvas: recordingFactory });
    applier.apply("green-felt");
    expect(shadowMaterial.disposed).toBe(1);
    applier.dispose();
  });

  it("keeps the plate it already built for the same surface and mesh", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    const die = fakeDie();
    applier.apply("green-felt", die);
    const plate = plateOf(target);
    applier.apply("green-felt");
    applier.apply("green-felt", die);
    expect(target.desk.material).toBe(plate);
    expect(plate.disposed).toBe(0);
    applier.dispose();
  });

  it("swaps and releases the plate when the surface changes", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    const die = fakeTexturedDie();
    applier.apply("green-felt", die);
    const previous = plateOf(target);
    expect(applier.apply("stainless", die)).toBe(true);
    expect(target.desk.material).not.toBe(previous);
    expect(previous.disposed).toBe(1);
    applier.dispose();
  });

  it("repaints a surface the renderer rebuilt on a resize", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    const oldDesk = target.desk;
    let oldGeometryDisposals = 0;
    oldDesk.geometry = { dispose: () => oldGeometryDisposals += 1 };
    applier.apply("green-felt", fakeTexturedDie());
    const oldPlate = plateOf(target);
    const rebuiltShadow = fakeMaterial();
    const rebuilt: SceneMeshLike = {
      material: rebuiltShadow,
      receiveShadow: true,
    };
    target.desk = rebuilt;
    expect(applier.apply("green-felt", fakeTexturedDie())).toBe(true);
    expect(rgbOf((rebuilt.material as FakeMaterial).color)).toEqual([
      255, 255, 255,
    ]);
    expect(oldPlate.disposed).toBe(1);
    expect(oldGeometryDisposals).toBe(1);
    expect(rebuiltShadow.disposed).toBe(1);
    applier.dispose();
  });

  it("gets the plate in place without waiting for a die material", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    const original = target.desk.material;
    applier.apply("mahogany");
    expect(target.desk.material).not.toBe(original);
    applier.dispose();
  });

  it("releases the plate it created on disposal, once", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target, {
      createCanvas: recordingFactory,
    });
    applier.apply("blue-felt", fakeTexturedDie());
    const plate = plateOf(target);
    applier.dispose();
    applier.dispose();
    expect(plate.disposed).toBe(1);
  });
});
