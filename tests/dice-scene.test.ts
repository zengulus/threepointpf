import { describe, expect, it } from "vitest";
import {
  defaultDicePresentationSettings,
  findDiceFlourish,
  flourishColor,
} from "@threepointpf/dice";
import {
  dieSampleOf,
  dieValueTextureSize,
  drawDieValueTexture,
  drawFlourishTexture,
  facingQuaternion,
  flourishProfiles,
  hexToRgb,
  presentSceneValues,
  readTopFace,
  rotationBetween,
  sampleStable,
  samplesStable,
  sceneVocabularyFor,
  topFaceOf,
  upAxisFor,
  valueFadeMs,
  valueHoldMs,
  valueRiseMs,
  valueStaggerMs,
  valueStableFrames,
  valueStableTimeoutMs,
  type Canvas2DLike,
  type SceneMeshLike,
  type SceneObject3D,
} from "../apps/web/src/lib/dice-scene";
import {
  FakeObject3D,
  FakeQuaternion,
  FakeVector3,
  asCanvas,
  fakeCamera,
  fakeCanvas,
  fakeDie,
  fakeFrameLoop,
  fakeRenderer,
  worldPositionOf,
  worldQuaternionOf,
  type FakeMesh,
} from "./helpers/fake-three";

/**
 * The die-local presentation is real scene-graph work: the value and the
 * flourish are objects parented to the landed die mesh, so moving that mesh
 * carries them along. These tests use a real (if small) three.js stand-in
 * because that property is only observable through actual transforms.
 */

const asDie = (die: FakeMesh) => die as unknown as SceneMeshLike;
const asDice = (dice: FakeMesh[]) => dice as unknown as SceneMeshLike[];
const asScene = (object: FakeObject3D) => object as unknown as SceneObject3D;

/** The vocabulary a real die supplies, so the maths runs on real constructors. */
const vocabularyOf = (die: FakeMesh) => sceneVocabularyFor(asDie(die))!;

/* ------------------------------------------------------------------ *
 * Which face is up.
 * ------------------------------------------------------------------ */

describe("the upward face of a landed die", () => {
  // The renderer's own geometry carries one group per face triangle, and every
  // group's three vertices follow it, so each face here is three vertices of
  // data centred on the face.
  function geometryOf(
    faces: { normal: [number, number, number]; centre: [number, number, number] }[],
  ) {
    const normals: number[] = [];
    const positions: number[] = [];
    faces.forEach(({ normal, centre }) => {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        normals.push(...normal);
        positions.push(...centre);
      }
    });
    return {
      groups: faces.map((_, index) => ({ materialIndex: index + 1 })),
      normals: Float32Array.from(normals),
      positions: Float32Array.from(positions),
    };
  }

  const { groups, normals, positions } = geometryOf([
    { normal: [0, 0, 1], centre: [0, 0, 10] },
    { normal: [0, 0, -1], centre: [0, 0, -10] },
    { normal: [1, 0, 0], centre: [10, 0, 0] },
  ]);
  const identity = { x: 0, y: 0, z: 0, w: 1 };

  it("picks the face whose normal leaves the table", () => {
    const face = topFaceOf(normals, positions, groups, identity);
    expect(face?.group).toBe(0);
    expect(face?.normal).toEqual([0, 0, 1]);
    expect(face?.centre).toEqual([0, 0, 10]);
  });

  it("follows the die's rotation, not its build order", () => {
    // Half a turn about X puts the -Z face on top.
    const face = topFaceOf(normals, positions, groups, {
      x: 1,
      y: 0,
      z: 0,
      w: 0,
    });
    expect(face?.group).toBe(1);
    expect(face?.normal).toEqual([0, 0, -1]);
  });

  it("reads a d4 from the other side, as the renderer does", () => {
    expect(upAxisFor("d4")).toEqual([0, 0, -1]);
    expect(upAxisFor("d6")).toEqual([0, 0, 1]);
    const face = topFaceOf(normals, positions, groups, identity, upAxisFor("d4"));
    expect(face?.group).toBe(1);
  });

  it("ignores the composite group and unreadable geometry", () => {
    const composite = geometryOf([
      { normal: [0, 0, 1], centre: [0, 0, 99] },
      { normal: [0, 0, 1], centre: [0, 0, 10] },
      { normal: [0, 0, -1], centre: [0, 0, -10] },
    ]);
    // The group the renderer reserves for an unlabelled face is never a result.
    const groupsWithComposite = composite.groups.map((group, index) =>
      index === 0 ? { materialIndex: 0 } : group,
    );
    expect(
      topFaceOf(
        composite.normals,
        composite.positions,
        groupsWithComposite,
        identity,
      ),
    ).toMatchObject({ group: 1, centre: [0, 0, 10] });

    expect(topFaceOf(normals, positions, [], identity)).toBeNull();
    expect(
      topFaceOf(Float32Array.from([]), Float32Array.from([]), groups, identity),
    ).toBeNull();
    expect(
      topFaceOf(composite.normals, composite.positions, groupsWithComposite, identity),
    ).not.toBeNull();
  });

  it("skips a face whose normal has no direction", () => {
    const degenerate = geometryOf([
      { normal: [0, 0, 0], centre: [0, 0, 99] },
      { normal: [0, 0, -1], centre: [0, 0, -10] },
    ]);
    expect(
      topFaceOf(
        degenerate.normals,
        degenerate.positions,
        degenerate.groups,
        identity,
      )?.group,
    ).toBe(1);
  });

  it("reads the face off a die mesh, in the die's own space", () => {
    const die = fakeDie();
    const face = readTopFace(asDie(die), vocabularyOf(die));
    expect(face?.normal).toEqual([0, 0, 1]);
    expect(face?.centre[2]).toBeCloseTo(50);
  });

  it("is read from the die's own world rotation, in the die's own space", () => {
    const die = fakeDie();
    // Turned right over: the face that now shows on the table is the die's -Z.
    die.quaternion.set(1, 0, 0, 0);
    const face = readTopFace(asDie(die), vocabularyOf(die));
    // The normal stays in the die's local space — that is the direction the
    // value has to be lifted along, whatever the die's orientation.
    expect(face?.normal).toEqual([0, 0, -1]);
    expect(face?.centre[2]).toBeCloseTo(-50);
  });
});

/* ------------------------------------------------------------------ *
 * The stability gate.
 * ------------------------------------------------------------------ */

describe("the visual stability gate", () => {
  const resting = { position: [0, 0, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };

  it("counts a die that has not moved or turned as still", () => {
    expect(sampleStable(resting, { ...resting })).toBe(true);
    expect(samplesStable([resting], [{ ...resting }])).toBe(true);
  });

  it("rejects a die that is still travelling, even slightly", () => {
    expect(sampleStable(resting, { ...resting, position: [0.2, 0, 0] })).toBe(
      false,
    );
    // A die turning by more than a degree or so is still visibly moving.
    expect(
      sampleStable(resting, {
        position: [0, 0, 0],
        quaternion: [0, 0, 0.2, 0.98],
      }),
    ).toBe(false);
    expect(rotationBetween([0, 0, 0, 1], [0, 0, 0.2, 0.98])).toBeGreaterThan(
      0.3,
    );
    // A hair of numerical drift is not movement.
    expect(
      sampleStable(resting, {
        position: [0.001, 0, 0],
        quaternion: [0, 0, 0.001, 1],
      }),
    ).toBe(true);
  });

  it("treats a quaternion and its negative as the same orientation", () => {
    expect(
      sampleStable(resting, { position: [0, 0, 0], quaternion: [0, 0, 0, -1] }),
    ).toBe(true);
  });

  it("is not stable when the dice it watches have changed", () => {
    expect(samplesStable([], [])).toBe(false);
    expect(samplesStable([resting], [resting, resting])).toBe(false);
    expect(samplesStable([resting], [])).toBe(false);
  });

  it("samples the transforms a die mesh actually reports", () => {
    const die = fakeDie();
    die.position.set(3, 4, 5);
    die.quaternion.set(0, 0, 0, 1);
    expect(dieSampleOf(die)).toEqual({
      position: [3, 4, 5],
      quaternion: [0, 0, 0, 1],
    });
  });
});

/* ------------------------------------------------------------------ *
 * The textures.
 * ------------------------------------------------------------------ */

describe("what is drawn on a value's canvas", () => {
  const context = (canvas: ReturnType<typeof fakeCanvas>) =>
    canvas.context as unknown as Canvas2DLike;

  it("draws the authoritative value it was handed", () => {
    const canvas = fakeCanvas();
    drawDieValueTexture(context(canvas), {
      value: 17,
      accent: "#f1b66c",
      natural: true,
    });
    expect(canvas.context.texts.map((text) => text.text)).toEqual(["17"]);
    expect(canvas.context.texts[0]!.fillStyle).toBe("#f1b66c");
    expect(canvas.context.font).toContain(String(Math.round(dieValueTextureSize * 0.5)));
  });

  it("points the plate's rim at the presentation's own colour", () => {
    const canvas = fakeCanvas();
    drawDieValueTexture(context(canvas), { value: 4, accent: "#df754f" });
    expect(canvas.context.strokeStyle).toBe("#df754f");
    // Only the natural die's value is tinted; every other one stays plain.
    expect(canvas.context.texts[0]!.fillStyle).toBe("#f4efe4");
  });

  it("draws a flourish as a ring rather than a shape", () => {
    const canvas = fakeCanvas();
    drawFlourishTexture(context(canvas), 128);
    // A soft ring: transparent at the centre and at the very edge.
    expect(canvas.context.stops[0]![1]).toContain("0)");
    expect(canvas.context.stops.at(-1)![1]).toContain("0)");
    expect(
      canvas.context.stops.some(([, colour]) => colour.includes("0.86")),
    ).toBe(true);
  });

  it("parses a colour for the material tint, falling back to white", () => {
    const [red, green, blue] = hexToRgb(flourishColor("critical-success"));
    expect(red).toBeCloseTo(241 / 255);
    expect(green).toBeCloseTo(182 / 255);
    expect(blue).toBeCloseTo(108 / 255);
    expect(hexToRgb("nonsense")).toEqual([1, 1, 1]);
  });

  it("faces the camera and stays upright on screen", () => {
    const vocabulary = vocabularyOf(fakeDie());
    // A camera off to one side of the table, looking at the die: the view's own
    // up axis is what the value has to square up with.
    const camera = fakeCamera();
    camera.position.set(400, 0, 700);
    camera.quaternion.setFromUnitVectors(
      new FakeVector3(0, 0, -1),
      camera.position.clone().multiplyScalar(-1).normalize(),
    );
    const toCamera = camera.position.clone().normalize();
    const viewUp = new FakeVector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // A camera's view direction and its up axis are perpendicular, so this is
    // the case the turn has to hold to.
    expect(toCamera.dot(viewUp)).toBeCloseTo(0, 6);

    const facing = facingQuaternion(vocabulary, toCamera, viewUp);
    // The plane's own +Z points at the camera…
    const normal = new FakeVector3(0, 0, 1).applyQuaternion(facing);
    expect(normal.dot(toCamera)).toBeCloseTo(1, 4);
    // …and its up axis matches the view's, rather than rolling with the turn.
    const up = new FakeVector3(0, 1, 0).applyQuaternion(facing);
    expect(up.dot(viewUp)).toBeCloseTo(1, 4);
  });
});

/* ------------------------------------------------------------------ *
 * The presentation.
 * ------------------------------------------------------------------ */

/** The presentation's own material, as the tests need to inspect it. */
interface PaintedMaterial {
  disposed: number;
  map: { disposed: number };
  color: { r: number };
  blending: number;
  opacity: number;
}

/** The die's own materials, which are never replaced, only borrowed for a glow. */
interface DieMaterial {
  emissive: { r: number; g: number; b: number };
  emissiveIntensity: number;
  disposed: number;
}

const materialOf = (object: FakeObject3D) =>
  (object as unknown as { material: PaintedMaterial }).material;
const geometryOf = (object: FakeObject3D) =>
  (object as unknown as { geometry: { disposed: number } }).geometry;
const dieMaterials = (die: FakeMesh) => die.material as unknown as DieMaterial[];

interface FixtureOptions {
  faces?: number[];
  naturalFaceIndex?: number;
  flourish?: string;
  event?: "critical-success" | "none";
  dice?: FakeMesh[];
  intensity?: number;
  reducedMotion?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const faces = options.faces ?? [17];
  const dice = options.dice ?? faces.map(() => fakeDie());
  // Dice land apart, as they do on a real table.
  dice.forEach((die, index) =>
    die.position.set((index - (dice.length - 1) / 2) * 200, 0, 0),
  );
  const loop = fakeFrameLoop();
  const canvases: ReturnType<typeof fakeCanvas>[] = [];
  const shown: number[] = [];
  const scene = new FakeObject3D();
  const camera = fakeCamera();
  const renderer = fakeRenderer();
  scene.add(...dice);
  scene.add(camera);
  const settings = {
    ...defaultDicePresentationSettings,
    intensity: options.intensity ?? defaultDicePresentationSettings.intensity,
    reducedMotion: options.reducedMotion ?? false,
  };
  const presentation = presentSceneValues({
    request: {
      faces,
      naturalFaceIndex: options.naturalFaceIndex ?? -1,
      event: options.event ?? "none",
      // Most scene tests exercise the value choreography, not the separate
      // flourish. Individual flourish cases opt in explicitly below.
      flourish: findDiceFlourish(options.flourish ?? "none"),
      settings,
    },
    dice: asDice(dice),
    scene: asScene(scene),
    camera: asScene(camera),
    renderer,
    createCanvas: () => {
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return asCanvas(canvas);
    },
    onValueShown: () => shown.push(loop.now),
    now: () => loop.now,
    requestFrame: loop.requestFrame,
    cancelFrame: loop.cancelFrame,
  });
  const advance = (frames: number, stepMs = 16) => {
    for (let frame = 0; frame < frames; frame += 1) {
      loop.now += stepMs;
      loop.step();
    }
  };
  return {
    dice,
    loop,
    canvases,
    shown,
    scene,
    renderer,
    presentation,
    advance,
    texts: () => canvases.flatMap((canvas) => canvas.context.texts.map((t) => t.text)),
  };
}

describe("a landed value is an object on its die", () => {
  it("stays put while the die is still visibly moving", () => {
    const world = fixture();
    for (let frame = 0; frame < 8; frame += 1) {
      // The die keeps travelling between frames.
      world.dice[0]!.position.x += 3;
      world.advance(1);
    }
    expect(world.dice[0]!.children).toHaveLength(0);
    expect(world.shown).toHaveLength(0);
    expect(world.presentation).not.toBeNull();
  });

  it("appears only after consecutive still frames, not when the throw resolved", () => {
    const world = fixture();
    // One frame short of the gate, with the die turning as it settles.
    for (let frame = 1; frame < valueStableFrames; frame += 1) {
      world.dice[0]!.quaternion.set(0, 0, 0.05 * frame, 1).normalize();
      world.advance(1);
      expect(world.dice[0]!.children).toHaveLength(0);
    }
    world.advance(valueStableFrames);
    expect(world.dice[0]!.children).toHaveLength(1);
    expect(world.shown).toHaveLength(1);
  });

  it("gives up waiting and shows the value where the die lies", () => {
    const world = fixture();
    // A die that never holds still still gets its value, rather than nothing.
    for (let frame = 0; frame <= valueStableTimeoutMs / 16 + 1; frame += 1) {
      world.dice[0]!.position.y += 1;
      world.advance(1);
    }
    expect(world.shown.length).toBeGreaterThan(0);
    expect(world.dice[0]!.children).toHaveLength(1);
  });

  it("parents the value to the die mesh itself", () => {
    const world = fixture();
    world.advance(valueStableFrames);
    const value = world.dice[0]!.children[0]!;
    expect(value.parent).toBe(world.dice[0]);
    // It starts on the face it was rolled on: just above the centre, flat
    // against the face, and turned to look at the camera.
    expect(value.position.x).toBeCloseTo(0);
    expect(value.position.y).toBeCloseTo(0);
    expect(value.position.z).toBeGreaterThan(50);
    const normal = new FakeVector3(0, 0, 1).applyQuaternion(value.quaternion);
    expect(normal.z).toBeCloseTo(1);
  });

  it("carries the value with the die if the die's transform changes", () => {
    const world = fixture();
    world.advance(valueStableFrames);
    const die = world.dice[0]!;
    const value = die.children[0]!;

    // Nothing re-projects the value: moving the mesh moves what is parented to
    // it, by exactly the same amount.
    const before = worldPositionOf(value);
    die.position.set(120, -40, 15);
    const moved = worldPositionOf(value);
    expect(moved.x).toBeCloseTo(before.x + 120);
    expect(moved.y).toBeCloseTo(before.y - 40);
    expect(moved.z).toBeCloseTo(before.z + 15);

    // And turning the die turns the value with it, staying rigidly attached.
    const localBefore = value.quaternion.clone();
    const offsetBefore = worldPositionOf(value)
      .sub(worldPositionOf(die))
      .normalize();
    const heldAt = worldPositionOf(value).distanceTo(worldPositionOf(die));
    // A quarter turn about X, which tips the die's top face toward the table.
    const quarterTurn = new FakeQuaternion().setFromUnitVectors(
      new FakeVector3(0, 1, 0),
      new FakeVector3(0, 0, 1),
    );
    die.quaternion.copy(quarterTurn);

    expect(worldPositionOf(value).distanceTo(worldPositionOf(die))).toBeCloseTo(
      heldAt,
      4,
    );
    const offsetAfter = worldPositionOf(value)
      .sub(worldPositionOf(die))
      .normalize();
    expect(offsetAfter.x).toBeCloseTo(offsetBefore.x, 4);
    expect(offsetBefore.z).toBeCloseTo(1, 4);
    expect(offsetAfter.y).toBeCloseTo(-1, 4);
    // The value's own orientation turns with its die.
    const expected = quarterTurn.clone().multiply(localBefore);
    const turned = worldQuaternionOf(value);
    expect(turned.x).toBeCloseTo(expected.x, 6);
    expect(turned.y).toBeCloseTo(expected.y, 6);
    expect(turned.z).toBeCloseTo(expected.z, 6);
    expect(turned.w).toBeCloseTo(expected.w, 6);
  });

  it("lifts the value off the face", () => {
    const world = fixture();
    world.advance(valueStableFrames);
    const value = world.dice[0]!.children[0]!;
    const start = value.position.clone();
    world.advance(Math.ceil(valueRiseMs / 16));
    // It has risen out of the die, rather than sliding around on the table.
    expect(value.position.z).toBeGreaterThan(start.z + 20);
    // And it rose away from the face along its own normal.
    expect(value.position.x).toBeCloseTo(start.x, 6);
    expect(value.position.y).toBeGreaterThan(start.y);
  });

  it("squares a tilted value up with the screen as it rises", () => {
    // A die resting flat but rolled on the table: its face already looks at the
    // camera, while the number on it is sideways. Rising is also the turn that
    // puts it the right way up on screen.
    const die = fakeDie({
      quaternion: new FakeQuaternion(
        0,
        0,
        Math.sin(Math.PI / 8),
        Math.cos(Math.PI / 8),
      ),
    });
    const world = fixture({ faces: [17], dice: [die] });
    world.advance(valueStableFrames);
    const value = die.children[0]!;
    const start = value.quaternion.clone();
    const rolledUp = new FakeVector3(0, 1, 0).applyQuaternion(
      worldQuaternionOf(value),
    );
    // It starts parallel to the face it was rolled on: rolled with the die.
    expect(rolledUp.y).toBeCloseTo(Math.cos(Math.PI / 4), 4);
    expect(Math.abs(rolledUp.x)).toBeCloseTo(Math.sin(Math.PI / 4), 4);

    world.advance(Math.ceil(valueRiseMs / 16));
    const turn = value.quaternion.clone().invert().multiply(start);
    // The turn is real: it is not merely a fold out of the face.
    expect(Math.abs(turn.w)).toBeLessThan(Math.cos(Math.PI / 8));
    const upright = new FakeVector3(0, 1, 0).applyQuaternion(
      worldQuaternionOf(value),
    );
    expect(upright.x).toBeCloseTo(0, 4);
    expect(upright.y).toBeCloseTo(1, 4);
    const facing = new FakeVector3(0, 0, 1).applyQuaternion(
      worldQuaternionOf(value),
    );
    expect(facing.z).toBeGreaterThan(0.9);
  });

  it("draws the face the resolution decided, not the one the geometry shows", () => {
    // A die showing a different face than its geometry's first face still shows
    // the value the resolution decided.
    const die = fakeDie();
    const world = fixture({ faces: [4], dice: [die] });
    // Turned onto its side, so the landed face is not the geometry's first.
    die.quaternion.setFromUnitVectors(
      new FakeVector3(0, 0, 1),
      new FakeVector3(0, 1, 0),
    );
    // The turn resets the stillness clock, exactly as a moving die must.
    world.advance(valueStableFrames + 1);
    expect(die.children).toHaveLength(1);
    expect(world.texts()).toEqual(["4"]);
  });

  it("brings several dice's values together before the arithmetic", () => {
    const world = fixture({ faces: [4, 3] });
    world.advance(valueStableFrames);
    const [first, second] = world.dice.map((die) => die.children[0]!);
    const apartAtStart = worldPositionOf(first).distanceTo(worldPositionOf(second));
    expect(apartAtStart).toBeGreaterThan(100);
    world.advance(Math.ceil(valueRiseMs / 16));
    const apartAtEnd = worldPositionOf(first).distanceTo(worldPositionOf(second));
    // They gather: the values end closer together than the dice they came from.
    expect(apartAtEnd).toBeLessThan(apartAtStart);
    expect(apartAtEnd).toBeLessThan(100);
    expect(world.texts()).toEqual(["4", "3"]);
  });

  it("staggers several values so they do not move as one column", () => {
    const world = fixture({ faces: [4, 3] });
    world.advance(valueStableFrames);
    const starts = world.dice.map((die) => die.children[0]!);
    const startPositions = starts.map((value) => value.position.clone());
    // Just after the first value has begun to move, the second has not.
    world.advance(Math.ceil(valueStaggerMs / 2 / 16));
    expect(
      starts[0]!.position.distanceTo(startPositions[0]!),
    ).toBeGreaterThan(0);
    expect(starts[1]!.position.distanceTo(startPositions[1]!)).toBe(0);
  });
});

describe("the flourish is emitted by the die", () => {
  it("rings and glows the die the natural face landed on", () => {
    const world = fixture({
      faces: [20],
      naturalFaceIndex: 0,
      flourish: "sparks",
      event: "critical-success",
    });
    world.advance(valueStableFrames);
    const die = world.dice[0]!;
    // The ring is a second object on the same die, not a DOM element near it.
    expect(die.children).toHaveLength(2);
    const ring = die.children[1]!;
    expect(ring.parent).toBe(die);
    const material = materialOf(ring);
    expect(material.blending).toBe(2);
    const accent = hexToRgb(flourishColor("critical-success"));
    // The ring is tinted by the presentation's colour, and the die itself glows
    // with it.
    expect(material.color.r).toBeCloseTo(accent[0]!);
    expect(dieMaterials(die)[0]!.emissive.r).toBeCloseTo(accent[0]!);

    world.advance(6);
    expect(dieMaterials(die)[0]!.emissiveIntensity).toBeGreaterThan(0);
  });

  it("leaves the die alone when no flourish is asked for", () => {
    const world = fixture({
      faces: [20],
      naturalFaceIndex: 0,
      flourish: "none",
      event: "critical-success",
    });
    world.advance(valueStableFrames);
    expect(world.dice[0]!.children).toHaveLength(1);
    expect(dieMaterials(world.dice[0]!)[0]!.emissive.r).toBe(0);
  });

  it("uses the first landed die for a plain roll's flourish", () => {
    const world = fixture({ faces: [4, 3], naturalFaceIndex: -1, flourish: "flare" });
    world.advance(valueStableFrames);
    expect(world.dice[0]!.children).toHaveLength(2);
    expect(world.dice[1]!.children).toHaveLength(1);
  });

  it("scales its reach with the chosen motion", () => {
    expect(flourishProfiles.none!.ringScale).toBe(0);
    expect(flourishProfiles.flare!.ringScale).toBeGreaterThan(
      flourishProfiles.pulse!.ringScale,
    );
    expect(flourishProfiles.flare!.glow).toBeGreaterThan(
      flourishProfiles.pulse!.glow,
    );
  });

  it("dims the flourish with the intensity setting", () => {
    const loud = fixture({
      faces: [20],
      naturalFaceIndex: 0,
      flourish: "flare",
      intensity: 100,
    });
    const quiet = fixture({
      faces: [20],
      naturalFaceIndex: 0,
      flourish: "flare",
      intensity: 10,
    });
    loud.advance(valueStableFrames + 8);
    quiet.advance(valueStableFrames + 8);
    const loudGlow = dieMaterials(loud.dice[0]!)[0]!.emissiveIntensity;
    const quietGlow = dieMaterials(quiet.dice[0]!)[0]!.emissiveIntensity;
    expect(loudGlow).toBeGreaterThan(quietGlow);
  });
});

describe("a presentation cleans up after itself", () => {
  it("removes every temporary object, restores the die and frees its resources", async () => {
    const world = fixture({
      faces: [20],
      naturalFaceIndex: 0,
      flourish: "sparks",
      event: "critical-success",
    });
    world.advance(valueStableFrames);
    const die = world.dice[0]!;
    const value = die.children[0]!;
    const ring = die.children[1]!;
    const valueMaterial = materialOf(value);
    const texture = valueMaterial.map;
    const geometry = geometryOf(value);
    const original = { ...dieMaterials(die)[0]! };

    // Past the hold and the fade, the scene hands the values over and lets go.
    world.advance(Math.ceil((valueRiseMs + valueHoldMs + valueFadeMs) / 16) + 4);

    expect(die.children).toHaveLength(0);
    expect(value.parent).toBeNull();
    expect(ring.parent).toBeNull();
    expect(valueMaterial.disposed).toBeGreaterThan(0);
    expect(texture.disposed).toBeGreaterThan(0);
    expect(geometry.disposed).toBeGreaterThan(0);
    // The die is left exactly as it was found, and its own material is never
    // the one that was disposed.
    expect(dieMaterials(die)[0]!.emissive.r).toBe(original.emissive.r);
    expect(dieMaterials(die)[0]!.emissiveIntensity).toBe(
      original.emissiveIntensity,
    );
    expect(dieMaterials(die).some((material) => material.disposed > 0)).toBe(false);
    await expect(world.presentation!.done).resolves.toBeUndefined();
  });

  it("resolves the handoff once the values have left their dice", async () => {
    const world = fixture();
    let handedOff = false;
    void world.presentation!.done.then(() => {
      handedOff = true;
    });
    // Mid-rise the caller is still waiting, so nothing hands over early.
    world.advance(valueStableFrames + Math.ceil(valueRiseMs / 2 / 16));
    await Promise.resolve();
    expect(handedOff).toBe(false);
    // It waits out the hold too: the moment of the values leaving the dice is
    // visible rather than being cut off by the arithmetic.
    world.advance(Math.ceil((valueRiseMs / 2 + valueHoldMs) / 16) + 2);
    await Promise.resolve();
    expect(handedOff).toBe(true);
    expect(world.dice[0]!.children).toHaveLength(1);
  });

  it("drops everything on dispose, mid-flight or afterwards", async () => {
    const world = fixture();
    world.advance(valueStableFrames);
    expect(world.dice[0]!.children).toHaveLength(1);
    world.presentation!.dispose();
    expect(world.dice[0]!.children).toHaveLength(0);
    expect(world.loop.pending).toBe(0);
    await expect(world.presentation!.done).resolves.toBeUndefined();
    // Disposing twice is not an error, and nothing is left scheduled.
    expect(() => world.presentation!.dispose()).not.toThrow();
    expect(world.loop.pending).toBe(0);
  });

  it("drives its own draw loop while the values are on screen", () => {
    const world = fixture();
    // The renderer's own loop has already stopped when the dice land, so the
    // presentation has to draw the frames its motion appears in.
    world.advance(valueStableFrames);
    const drawnWhenShown = world.renderer.renders;
    expect(drawnWhenShown).toBeGreaterThan(0);
    world.advance(3);
    expect(world.renderer.renders).toBeGreaterThan(drawnWhenShown);
    // Once it has cleaned up there is nothing left drawing the table.
    world.advance(Math.ceil((valueRiseMs + valueHoldMs + valueFadeMs) / 16) + 4);
    const drawnAtRest = world.renderer.renders;
    world.loop.step();
    expect(world.renderer.renders).toBe(drawnAtRest);
  });
});

describe("when a die-local phase is not possible", () => {
  it("declines rather than faking it in the DOM", () => {
    // Reduced motion has no throw at all, so there are no dice to attach to.
    const reduced = fixture({ reducedMotion: true });
    expect(reduced.presentation).toBeNull();

    // A renderer whose material has no canvas map has no texture class to use.
    const bare = fakeDie();
    (bare.material as { map: unknown }[])[0]!.map = null;
    const noTexture = fixture({ faces: [17], dice: [bare] });
    expect(noTexture.presentation).toBeNull();

    // No dice reported means nothing to attach a value to.
    const none = fixture({ faces: [] });
    expect(none.presentation).toBeNull();
  });
});
