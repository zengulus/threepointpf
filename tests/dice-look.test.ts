import { describe, expect, it, vi } from "vitest";
import { diceSurfaceOptions } from "@threepointpf/dice";
import {
  applySurfaceLighting,
  createSurfaceApplier,
  defaultDiceSurfaceLook,
  dieMetalnessCeiling,
  dieMetalnessScale,
  diceSurfaceLook,
  diceSurfaceLooks,
  firstDieMaterial,
  normalizeDieMaterial,
  patchDieCreation,
  patchDieMaterials,
  surfacePlateMaterial,
  type DiceLookTarget,
  type SceneColorLike,
  type SceneLightLike,
  type SceneMaterialLike,
  type SceneMeshLike,
} from "../apps/web/src/lib/dice-look";

/**
 * The surface and the die colours are both written into objects the renderer
 * already owns, so what matters is exactly what this module writes — and that it
 * releases the one thing it allocates. These tests drive it against small
 * structural stand-ins, the same way the renderer hands it real three.js
 * materials, lights and meshes.
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

function fakeDie(materials: FakeMaterial[] = [fakeMaterial()]) {
  return { material: materials, geometry: { kind: "die-geometry" } };
}

function fakeLight(intensity = 1) {
  return { color: fakeColor(), intensity };
}

function fakeTarget() {
  const ambient = { ...fakeLight(), groundColor: fakeColor() };
  return {
    desk: { material: fakeMaterial(), receiveShadow: true } as SceneMeshLike,
    light: fakeLight() as SceneLightLike,
    light_amb: ambient as SceneLightLike,
  } satisfies DiceLookTarget & {
    desk: SceneMeshLike;
    light: SceneLightLike;
    light_amb: SceneLightLike;
  };
}

type FakeTarget = ReturnType<typeof fakeTarget>;
const lightColorOf = (target: FakeTarget) =>
  rgbOf(target.light.color as FakeColor);
const plateOf = (target: FakeTarget) => target.desk.material as FakeMaterial;

describe("surface looks", () => {
  it("gives every selectable surface a look of its own", () => {
    for (const option of diceSurfaceOptions)
      expect(diceSurfaceLooks[option.id], option.id).toBeDefined();
  });

  it("keeps the surfaces visibly distinguishable", () => {
    const desks = diceSurfaceOptions.map(
      (option) => diceSurfaceLook(option.id).desk,
    );
    expect(new Set(desks).size).toBe(desks.length);
  });

  it("authors every colour as a six-digit hex the scene can read", () => {
    for (const look of Object.values(diceSurfaceLooks)) {
      expect(look.desk).toMatch(/^#[0-9a-f]{6}$/i);
      expect(look.spot.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(look.ambient.sky).toMatch(/^#[0-9a-f]{6}$/i);
      expect(look.ambient.ground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(look.spot.intensity).toBeGreaterThan(0);
      expect(look.ambient.intensity).toBeGreaterThan(0);
    }
  });

  it("falls back to the neutral look for an unknown surface", () => {
    expect(diceSurfaceLook("not-a-surface")).toBe(defaultDiceSurfaceLook);
  });
});

describe("applySurfaceLighting", () => {
  it("throws the surface's own light on the dice", () => {
    const target = fakeTarget();
    expect(applySurfaceLighting(target, "green-felt")).toBe(true);
    const look = diceSurfaceLook("green-felt");
    expect(lightColorOf(target)).toEqual(rgbOf(fakeColorFrom(look.spot.color)));
    expect(target.light.intensity).toBe(look.spot.intensity);
    expect(rgbOf(target.light_amb.groundColor as FakeColor)).toEqual(
      rgbOf(fakeColorFrom(look.ambient.ground)),
    );
    expect(target.light_amb.intensity).toBe(look.ambient.intensity);
  });

  it("gives different surfaces different light", () => {
    const steel = fakeTarget();
    const neon = fakeTarget();
    applySurfaceLighting(steel, "stainless");
    applySurfaceLighting(neon, "cyberpunk");
    expect(lightColorOf(steel)).not.toEqual(lightColorOf(neon));
    expect(steel.light.intensity).not.toBe(neon.light.intensity);
  });

  it("reports nothing to do for a scene without lights", () => {
    expect(applySurfaceLighting({}, "mahogany")).toBe(false);
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
  it("paints the surface onto a material that can carry it", () => {
    const look = diceSurfaceLook("stainless");
    const plate = surfacePlateMaterial(fakeMaterial(), look)!;
    expect(rgbOf(plate.color as FakeColor)).toEqual(
      rgbOf(fakeColorFrom(look.desk)),
    );
    expect(plate.map).toBeNull();
    expect(plate.bumpMap).toBeNull();
    expect(plate.normalMap).toBeNull();
    expect(plate.emissiveIntensity).toBe(0);
    expect(plate.metalness).toBe(0);
  });

  it("leaves the die's own material untouched", () => {
    const template = fakeMaterial();
    const before = {
      map: template.map,
      bumpMap: template.bumpMap,
      transparent: template.transparent,
      depthTest: template.depthTest,
      color: { ...template.color },
    };
    surfacePlateMaterial(template, diceSurfaceLook("red-felt"));
    expect(template.map).toBe(before.map);
    expect(template.bumpMap).toBe(before.bumpMap);
    expect(template.transparent).toBe(before.transparent);
    expect(template.depthTest).toBe(before.depthTest);
    expect(rgbOf(template.color)).toEqual(rgbOf(before.color as FakeColor));
  });

  it("stays depth-tested and opaque so the dice land on top of it", () => {
    const plate = surfacePlateMaterial(
      fakeMaterial(),
      diceSurfaceLook("taverntable"),
    )!;
    expect(plate.depthTest).toBe(true);
    expect(plate.depthWrite).toBe(true);
    expect(plate.transparent).toBe(false);
    expect(plate.opacity).toBe(1);
  });

  it("reports nothing for a material it cannot clone", () => {
    expect(surfacePlateMaterial(null, diceSurfaceLook("default"))).toBeNull();
    expect(
      surfacePlateMaterial({ color: fakeColor() }, diceSurfaceLook("default")),
    ).toBeNull();
  });
});

describe("the surface applier", () => {
  it("lights the scene before there is a die to take a material from", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
    expect(applier.apply("cyberpunk")).toBe(true);
    expect(target.light.intensity).toBe(
      diceSurfaceLook("cyberpunk").spot.intensity,
    );
    // The renderer's own shadow-catcher material is untouched until a plate can
    // be built from a material of the scene's own class.
    expect(plateOf(target).map).toEqual({ kind: "die-texture" });
    applier.dispose();
  });

  it("paints the surface onto the renderer's own mesh", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
    expect(applier.apply("green-felt", fakeDie())).toBe(true);
    expect(rgbOf(plateOf(target).color)).toEqual(
      rgbOf(fakeColorFrom(diceSurfaceLook("green-felt").desk)),
    );
    // It is still the renderer's mesh, so it still catches the dice's shadow.
    expect(target.desk.receiveShadow).toBe(true);
    applier.dispose();
  });

  it("keeps the plate it already built for the same surface and mesh", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
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
    const applier = createSurfaceApplier(target);
    const die = fakeDie();
    applier.apply("green-felt", die);
    const previous = plateOf(target);
    expect(applier.apply("stainless", die)).toBe(true);
    expect(target.desk.material).not.toBe(previous);
    expect(previous.disposed).toBe(1);
    applier.dispose();
  });

  it("repaints a surface the renderer rebuilt on a resize", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
    applier.apply("green-felt", fakeDie());
    const rebuilt: SceneMeshLike = {
      material: fakeMaterial(),
      receiveShadow: true,
    };
    target.desk = rebuilt;
    expect(applier.apply("green-felt", fakeDie())).toBe(true);
    expect(rgbOf((rebuilt.material as FakeMaterial).color)).toEqual(
      rgbOf(fakeColorFrom(diceSurfaceLook("green-felt").desk)),
    );
    applier.dispose();
  });

  it("gets the plate in place as soon as a die supplies a material", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
    const original = target.desk.material;
    applier.apply("mahogany");
    expect(target.desk.material).toBe(original);
    applier.apply("mahogany", fakeDie());
    expect(target.desk.material).not.toBe(original);
    applier.dispose();
  });

  it("releases the plate it created on disposal, once", () => {
    const target = fakeTarget();
    const applier = createSurfaceApplier(target);
    applier.apply("blue-felt", fakeDie());
    const plate = plateOf(target);
    applier.dispose();
    applier.dispose();
    expect(plate.disposed).toBe(1);
  });
});
