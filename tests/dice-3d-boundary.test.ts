import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type {
  AttackDefinition,
  CharacterInput,
  RollPlan,
} from "@threepointpf/rules-schema";
import {
  classifyRollPresentation,
  defaultDicePresentationSettings,
  diceNotationFor,
  findDiceFlourish,
  activeDiceSkin,
  resolveRollPlan,
  updateDicePresentationSettings,
  type DiceDieValueRequest,
  type DiceFlourish,
  type DicePresentationSettings,
  type RollPresentationEvent,
} from "@threepointpf/dice";
import {
  createDiceBoxPresenter,
  createDiceBoxRenderer,
  diceBoxOptions,
  diceSkinKey,
  landedDice,
  playFlourishCue,
  diceStageSelector,
  renderedFaceValues,
  reportedDieIds,
  type DiceBoxFactory,
  type DiceBoxInit,
} from "../apps/web/src/lib/dice-3d";
import { valueStableFrames } from "../apps/web/src/lib/dice-scene";
import {
  diceSurfaceLook,
  dieMetalnessCeiling,
} from "../apps/web/src/lib/dice-look";
import {
  FakeColor,
  FakeMaterial,
  FakeObject3D,
  asCanvas,
  fakeCamera,
  fakeCanvas,
  fakeDie,
  fakeFrameLoop,
  worldPositionOf,
  type FakeMesh,
} from "./helpers/fake-three";

/**
 * The renderer boundary is mocked here: no WebGL, no physics and no assets run
 * in CI. What is asserted is the ordering contract — the authoritative faces
 * come first and the renderer is only ever asked to animate exactly those.
 */

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "three-d",
    name: "3D Test",
    baseAbilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 2,
    skillRanks: {},
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...overrides,
  };
}

const blade: AttackDefinition = {
  id: "blade",
  name: "Blade",
  attackAbility: "str",
  damageAbility: "str",
  baseDamage: { count: 2, sides: 6 },
  attackTags: ["weapon.melee"],
};

const engine = () => new RulesEngine(homebrew({ attacks: [blade] }), rulesCatalogs);

interface FakeRenderer {
  inits: DiceBoxInit[];
  rolls: string[];
  cleared: number;
  disposed: number;
  factory: DiceBoxFactory;
  results: unknown;
  failInitialize: boolean;
  /** Lets a test hold a throw open, so an overlap is real rather than assumed. */
  onRoll?: (notation: string) => Promise<unknown>;
}

function fakeRenderer(results: unknown = undefined): FakeRenderer {
  const state: FakeRenderer = {
    inits: [],
    rolls: [],
    cleared: 0,
    disposed: 0,
    results,
    failInitialize: false,
    factory: (init) => {
      state.inits.push(init);
      return {
        async initialize() {
          if (state.failInitialize) throw new Error("WebGL is unavailable");
        },
        async roll(notation: string) {
          state.rolls.push(notation);
          if (state.onRoll) return state.onRoll(notation);
          return state.results;
        },
        clear() {
          state.cleared += 1;
        },
        dispose() {
          state.disposed += 1;
        },
      };
    },
  };
  return state;
}

function stageElement(): HTMLElement {
  return { innerHTML: "stale canvas" } as unknown as HTMLElement;
}

function optionsFor() {
  return diceBoxOptions(
    activeDiceSkin(defaultDicePresentationSettings),
    defaultDicePresentationSettings,
  );
}

function dieValueRequest(
  faces: number[],
  overrides: Partial<DiceDieValueRequest> = {},
): DiceDieValueRequest {
  return {
    faces,
    naturalFaceIndex: -1,
    event: "none",
    flourish: findDiceFlourish("pulse"),
    settings: defaultDicePresentationSettings,
    ...overrides,
  };
}

/**
 * A renderer that keeps its scene, camera and dice meshes the way upstream does,
 * with the die-local presentation's environment supplied from the fake three.js
 * fixture. Everything the adapter attaches therefore goes onto real (if small)
 * scene-graph objects, so "parented to the die" can actually be checked.
 */
function sceneRenderer(results: unknown, diceCount = 1) {
  const loop = fakeFrameLoop();
  const sceneRoot = new FakeObject3D();
  const viewCamera = fakeCamera();
  const canvases: ReturnType<typeof fakeCanvas>[] = [];
  const dice: FakeMesh[] = Array.from({ length: diceCount }, () => fakeDie());
  dice.forEach((die, index) => die.position.set(index * 200, 0, 0));
  sceneRoot.add(...dice);
  sceneRoot.add(viewCamera);
  let renders = 0;

  class SceneBox {
    camera = viewCamera;
    scene = sceneRoot;
    diceList = dice;
    renderer = {
      render: () => {
        renders += 1;
      },
    };
    constructor(_selector: string, _options: unknown) {}
    async initialize() {}
    async roll() {
      return results;
    }
    clearDice() {}
  }

  const factory = createDiceBoxRenderer({
    loadModule: async () => SceneBox as never,
    resizeTarget: { addEventListener() {}, removeEventListener() {} },
    dieValueEnvironment: {
      createCanvas: () => {
        const canvas = fakeCanvas();
        canvases.push(canvas);
        return asCanvas(canvas);
      },
      now: () => loop.now,
      requestFrame: loop.requestFrame,
      cancelFrame: loop.cancelFrame,
    },
  });
  return {
    factory,
    loop,
    dice,
    scene: sceneRoot,
    canvases,
    renders: () => renders,
    advance(frames: number) {
      for (let frame = 0; frame < frames; frame += 1) {
        loop.now += 16;
        loop.step();
      }
    },
    texts: () =>
      canvases.flatMap((canvas) =>
        canvas.context.texts.map((text) => text.text),
      ),
  };
}

/**
 * The response `dice-box-threejs` actually resolves a throw with. Every group's
 * final die results are spread into `rolls` as `{ type, sides, id, value, ... }`
 * inside `sets`, alongside the group total and the overall `modifier`/`total`.
 * Building it here, rather than hand-writing a shape, is what keeps these tests
 * honest about the shape upstream really sends.
 */
function rendererResult(groups: { sides: number; values: number[] }[]) {
  const sets = groups.map((group, setIndex) => {
    const rolls = group.values.map((value, dieIndex) => ({
      type: `d${group.sides}`,
      sides: group.sides,
      id: setIndex * 100 + dieIndex,
      value,
      reason: "roll",
    }));
    return {
      num: group.values.length,
      type: `d${group.sides}`,
      sides: group.sides,
      rolls,
      total: group.values.reduce((sum, value) => sum + value, 0),
    };
  });
  return {
    sets,
    modifier: 0,
    total: sets.reduce((sum, set) => sum + set.total, 0),
  };
}

function requestFor(
  plan: RollPlan,
  faces: number[],
  settings: DicePresentationSettings = defaultDicePresentationSettings,
  event: RollPresentationEvent = "none",
  flourish: DiceFlourish = findDiceFlourish("pulse"),
) {
  return {
    plan,
    faces,
    event,
    flourish,
    skin: activeDiceSkin(settings),
    settings,
  };
}

describe("the 3D dice adapter animates faces that were already decided", () => {
  it("hands the renderer the resolved faces, never a random notation", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const resolved = resolveRollPlan(plan, [17]);
    const report = await presenter.present(requestFor(plan, resolved.faces));
    expect(renderer.rolls).toEqual([diceNotationFor(plan, [17])]);
    expect(renderer.rolls[0]).toBe("1d20@17");
    expect(report).toMatchObject({ mode: "rendered", handoff: "matched" });
  });

  it("reports a renderer that disagrees without changing the result", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [3] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const resolved = resolveRollPlan(plan, [17]);
    const report = await presenter.present(requestFor(plan, resolved.faces));
    expect(report).toMatchObject({ mode: "rendered", handoff: "mismatch" });
    // The resolution is untouched by whatever the physics reported.
    expect(resolved.total).toBe(17 + plan.modifier);
    expect(renderedFaceValues(rendererResult([{ sides: 20, values: [3] }]))).toEqual([3]);
    expect(renderedFaceValues(undefined)).toBeNull();
    expect(renderer.rolls[0]).toBe("1d20@17");
  });

  it("marks a renderer that reports nothing as unreported", async () => {
    const renderer = fakeRenderer(undefined);
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [4]));
    expect(report.handoff).toBe("unreported");
  });

  it("flattens multi-die damage rolls into one forced group", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 6, values: [4, 3] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const damage = engine().createDamageRollPlan("blade");
    const report = await presenter.present(requestFor(damage, [4, 3]));
    expect(renderer.rolls[0]).toBe("2d6@4,3");
    expect(report.mode).toBe("rendered");
  });
});

describe("fallbacks never hide the authoritative result", () => {
  it("skips the throw under reduced motion without touching the renderer", async () => {
    const renderer = fakeRenderer();
    const settings = updateDicePresentationSettings(
      defaultDicePresentationSettings,
      { reducedMotion: true },
    );
    const presenter = createDiceBoxPresenter({
      settings,
      factory: renderer.factory,
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [17], settings));
    expect(report.mode).toBe("skipped");
    expect(report.reason).toContain("reduced motion");
    expect(renderer.inits).toHaveLength(0);
    expect(renderer.rolls).toHaveLength(0);
  });

  it("falls back when the renderer cannot start, and retries next time", async () => {
    const renderer = fakeRenderer();
    renderer.failInitialize = true;
    const stage = stageElement();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      stage: () => stage,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const first = await presenter.present(requestFor(plan, [17]));
    expect(first.mode).toBe("fallback");
    expect(first.reason).toContain("WebGL");
    // A renderer that failed to start leaves no canvas behind.
    expect(stage.innerHTML).toBe("");
    renderer.failInitialize = false;
    const second = await presenter.present(requestFor(plan, [17]));
    expect(second.mode).toBe("rendered");
    expect(renderer.inits).toHaveLength(2);
  });

  it("throws every dice group of a plan in one roll", async () => {
    const renderer = fakeRenderer(
      rendererResult([
        { sides: 20, values: [17] },
        { sides: 6, values: [4, 3] },
      ]),
    );
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const multi: RollPlan = {
      ...plan,
      dice: [
        { sides: 20, count: 1 },
        { sides: 6, count: 2 },
      ],
    };
    const report = await presenter.present(requestFor(multi, [17, 4, 3]));
    // Several groups are still one throw, with the faces flattened in group
    // order — the order the renderer applies them in.
    expect(renderer.rolls).toEqual(["1d20+2d6@17,4,3"]);
    expect(report).toMatchObject({ mode: "rendered", handoff: "matched" });
  });

  it("falls back when a plan needs no dice", async () => {
    const renderer = fakeRenderer();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const noDice: RollPlan = { ...plan, dice: [] };
    const report = await presenter.present(requestFor(noDice, []));
    expect(report.mode).toBe("fallback");
    expect(report.reason).toContain("needs no dice");
    expect(renderer.inits).toHaveLength(0);
  });

  it("falls back rather than rolling faces that cannot be forced", async () => {
    const renderer = fakeRenderer();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [21]));
    expect(report.mode).toBe("fallback");
    expect(report.reason).toMatch(/Invalid d20 face/);
    expect(renderer.inits).toHaveLength(0);
  });
});

describe("skins and settings reach the renderer", () => {
  it("maps a skin onto renderer options", () => {
    const settings = updateDicePresentationSettings(
      defaultDicePresentationSettings,
      { intensity: 80, sound: true },
    );
    const skin = activeDiceSkin(settings);
    const options = diceBoxOptions(skin, settings);
    expect(options.sounds).toBe(true);
    expect(options.volume).toBe(80);
    expect(options.strength).toBeCloseTo(1.3);
    expect(options.theme_surface).toBe(skin.surface);
    expect(options.theme_customColorset.foreground).toBe(skin.foreground);
    expect(options.theme_customColorset.background).toBe(skin.background);
    expect(options.theme_customColorset.material).toBe(skin.material);
    expect(options.theme_customColorset.texture).toBe(skin.texture);
    // The colourset name changes with the skin so the renderer's internal
    // colourset cache can never serve a stale look.
    const other = updateDicePresentationSettings(settings, { skinId: "arcane" });
    expect(diceBoxOptions(activeDiceSkin(other), other).theme_customColorset.name).not.toBe(
      options.theme_customColorset.name,
    );
    expect(diceSkinKey(skin, settings)).toBe(diceSkinKey(skin, settings));
  });

  it("rebuilds the renderer when the skin changes", async () => {
    const renderer = fakeRenderer();
    const stage = stageElement();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      stage: () => stage,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    expect(renderer.inits).toHaveLength(1);
    expect(renderer.cleared).toBe(1);
    const arcane = updateDicePresentationSettings(defaultDicePresentationSettings, {
      skinId: "arcane",
    });
    presenter.configure(arcane);
    await presenter.present(requestFor(plan, [12], arcane));
    expect(renderer.inits).toHaveLength(2);
    expect(renderer.inits[1]!.options.theme_customColorset.background).toBe(
      activeDiceSkin(arcane).background,
    );
    // The stale canvas is removed rather than stacked.
    expect(stage.innerHTML).toBe("");
    expect(renderer.rolls).toEqual(["1d20@17", "1d20@12"]);
    presenter.dispose();
    // One clear per throw; the rebuild and the teardown are real disposals, not
    // another table clear.
    expect(renderer.cleared).toBe(2);
    expect(renderer.disposed).toBe(2);
  });

  it("rebuilds when the overlay remounts the stage element", async () => {
    const renderer = fakeRenderer();
    let stage = stageElement();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      stage: () => stage,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    expect(renderer.inits).toHaveLength(1);

    // Dismissing the overlay unmounts its stage, so the next throw gets a new
    // container. The renderer looks its container up once, at construction, so
    // the cached one would animate an element that is no longer on screen.
    stage = stageElement();
    await presenter.present(requestFor(plan, [12]));
    expect(renderer.inits).toHaveLength(2);
    expect(renderer.disposed).toBe(1);

    // A stage that did not change is still reused rather than rebuilt.
    await presenter.present(requestFor(plan, [12]));
    expect(renderer.inits).toHaveLength(2);
  });

  it("plays the flourish's own cue when the values leave the dice", async () => {
    const cues: DiceFlourish[] = [];
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: scene.factory,
      playCue: (flourish) => cues.push(flourish),
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    // The throw landing is not the moment the flourish happens: nothing has been
    // shown yet.
    expect(cues).toEqual([]);
    const presentation = presenter.presentDieValues?.(dieValueRequest([17]));
    expect(presentation).not.toBeNull();
    expect(cues).toEqual([]);
    // The cue belongs to the values appearing on the dice.
    scene.advance(valueStableFrames);
    expect(cues.map((flourish) => flourish.id)).toEqual(["pulse"]);
    presentation!.dispose();
  });

  it("is a no-op cue without Web Audio", () => {
    expect(playFlourishCue(findDiceFlourish("sparks"), defaultDicePresentationSettings)).toBe(
      false,
    );
    expect(
      playFlourishCue(findDiceFlourish("none"), defaultDicePresentationSettings),
    ).toBe(false);
  });
});

describe("presentation classification crosses the boundary", () => {
  it("carries the event the resolution produced into the request", async () => {
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [20] }]));
    const seen: RollPresentationEvent[] = [];
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: scene.factory,
      playCue: (flourish) => seen.push(flourish.id as RollPresentationEvent),
    });
    const plan = engine().createAttackRollPlan("blade", 0, {
      defense: { kind: "ac", value: 10 },
    });
    const resolved = resolveRollPlan(plan, [20]);
    const presentation = classifyRollPresentation(plan, resolved.outcome);
    const flourish = findDiceFlourish("sparks");
    const report = await presenter.present(
      requestFor(plan, resolved.faces, defaultDicePresentationSettings, presentation.event, flourish),
    );
    expect(presentation.event).toBe("critical-success");
    expect(report.mode).toBe("rendered");
    // Landing the dice makes no sound of its own; the flourish's cue belongs to
    // the moment the critical face produces its effect.
    expect(seen).toEqual([]);
    presenter.presentDieValues?.(
      dieValueRequest(resolved.faces, {
        naturalFaceIndex: 0,
        event: presentation.event,
        flourish,
      }),
    );
    scene.advance(valueStableFrames);
    expect(seen).toEqual(["sparks"]);
    presenter.dispose();
  });

  it("loads the renderer lazily so importing the adapter costs nothing", () => {
    const source = readFileSync(
      new URL("../apps/web/src/lib/dice-3d.ts", import.meta.url),
      "utf8",
    );
    // Only a dynamic import is allowed; a static one would pull three.js and
    // cannon-es into the initial bundle (and into Node-side tests).
    expect(source).toMatch(/await import\("@3d-dice\/dice-box-threejs"\)/);
    expect(source).not.toMatch(/^import .*@3d-dice\/dice-box-threejs/m);
  });

  it("works with no stage element and no DOM at all", async () => {
    const renderer = fakeRenderer();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [7]));
    expect(report.mode).toBe("rendered");
    // No stage to clean: teardown still succeeds.
    expect(() => presenter.dispose()).not.toThrow();
  });
});

/**
 * Drains microtasks until `check` holds. The renderer boundary resolves through
 * promises only, so no timers are involved and the overlap in the queueing test
 * is real rather than assumed.
 */
async function waitFor(check: () => boolean, ticks = 200): Promise<void> {
  for (let index = 0; index < ticks && !check(); index += 1) await Promise.resolve();
  if (!check()) throw new Error("the expected renderer state never happened");
}

describe("the adapter reads the response upstream really sends", () => {
  it("reads each group's rolls, which are the faces", () => {
    const response = rendererResult([
      { sides: 20, values: [17] },
      { sides: 6, values: [4, 3] },
    ]);
    expect(renderedFaceValues(response)).toEqual([17, 4, 3]);
    // The group totals upstream sends alongside them are sums, not faces.
    expect(response.sets[1]!.total).toBe(7);
  });

  it("never mistakes a different shape for agreement", () => {
    // Regression guard: faces used to be read from a `dice` array upstream has
    // never sent, which made every real throw look like it reported nothing.
    expect(renderedFaceValues({ sets: [{ sides: 20, dice: [{ value: 17 }] }] })).toBeNull();
    expect(renderedFaceValues({ sets: [{ sides: 20, rolls: [{ value: "17" }] }] })).toBeNull();
    expect(renderedFaceValues({ sets: [{}] })).toBeNull();
    expect(renderedFaceValues({ sets: [{ rolls: [] }] })).toEqual([]);
    expect(renderedFaceValues({})).toBeNull();
    expect(renderedFaceValues(null)).toBeNull();
  });

  it("reports a real response as a matched handoff", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [17]));
    expect(report.handoff).toBe("matched");
  });

  it("still notices a renderer that lands on the wrong face", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 6, values: [4, 1] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const damage = engine().createDamageRollPlan("blade");
    const report = await presenter.present(requestFor(damage, [4, 3]));
    expect(report.handoff).toBe("mismatch");
  });
});

describe("an in-flight throw is never interrupted", () => {
  it("queues a second presentation behind the first", async () => {
    const renderer = fakeRenderer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    renderer.onRoll = async (notation) => {
      order.push(`start ${notation}`);
      await gate;
      order.push(`end ${notation}`);
      return rendererResult([{ sides: 20, values: [17] }]);
    };
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const first = presenter.present(requestFor(plan, [17]));
    await waitFor(() => order.length === 1);
    const second = presenter.present(requestFor(plan, [17]));

    // The second throw must not start, or clear the table, while the first is
    // still landing.
    await Promise.resolve();
    expect(order).toEqual(["start 1d20@17"]);
    expect(renderer.rolls).toEqual(["1d20@17"]);
    expect(renderer.cleared).toBe(1);

    release();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "start 1d20@17",
      "end 1d20@17",
      "start 1d20@17",
      "end 1d20@17",
    ]);
    expect(renderer.rolls).toEqual(["1d20@17", "1d20@17"]);
  });

  it("lets go of a throw that is torn down mid-flight", async () => {
    const renderer = fakeRenderer();
    let started = 0;
    renderer.onRoll = () => {
      started += 1;
      // Never settles: this is what a disposed animation loop looks like, since
      // the renderer resolves its own promise from inside that loop.
      return new Promise<unknown>(() => {});
    };
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const inFlight = presenter.present(requestFor(plan, [17]));
    await waitFor(() => started === 1);

    presenter.dispose();

    const report = await inFlight;
    expect(report.mode).toBe("skipped");
    expect(report.reason).toContain("stopped before the dice landed");
    // The queue must keep working rather than wedging on the abandoned throw.
    renderer.onRoll = undefined;
    renderer.results = rendererResult([{ sides: 20, values: [17] }]);
    await expect(presenter.present(requestFor(plan, [17]))).resolves.toMatchObject({
      mode: "rendered",
      handoff: "matched",
    });
  });

  it("keeps accepting throws after a failed one", async () => {
    const renderer = fakeRenderer();
    let broken = true;
    renderer.onRoll = async () => {
      if (broken) throw new Error("the renderer died mid-throw");
      return rendererResult([{ sides: 20, values: [17] }]);
    };
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const failed = await presenter.present(requestFor(plan, [17]));
    expect(failed.mode).toBe("fallback");
    broken = false;
    // The queue must not inherit the rejection and wedge every later throw.
    await expect(presenter.present(requestFor(plan, [17]))).resolves.toMatchObject({
      mode: "rendered",
      handoff: "matched",
    });
  });
});

describe("the renderer wrapper releases what upstream keeps", () => {
  /** A `window` stand-in that records what is subscribed to it. */
  function fakeWindow() {
    const listeners = new Set<(event: unknown) => void>();
    return {
      listeners,
      addEventListener(type: string, listener: unknown) {
        if (type === "resize" && typeof listener === "function")
          listeners.add(listener as (event: unknown) => void);
      },
      removeEventListener(type: string, listener: unknown) {
        if (type === "resize")
          listeners.delete(listener as (event: unknown) => void);
      },
      resize() {
        for (const listener of [...listeners]) listener({ type: "resize" });
      },
    };
  }

  interface UpstreamLog {
    contextLost: number;
    rendererDisposed: number;
    clearedDice: number;
    detached: number;
    resizeEvents: number;
  }

  function upstreamLog(): UpstreamLog {
    return {
      contextLost: 0,
      rendererDisposed: 0,
      clearedDice: 0,
      detached: 0,
      resizeEvents: 0,
    };
  }

  /**
   * A stand-in for the real renderer's documented behaviour: it subscribes to
   * `window` resize without unsubscribing, owns a canvas it never detaches and
   * exposes no `dispose()`.
   */
  function fakeUpstream(
    log: UpstreamLog,
    target: ReturnType<typeof fakeWindow>,
  ) {
    const parent = {
      removeChild() {
        log.detached += 1;
      },
    };
    return class FakeDiceBox {
      renderer = {
        domElement: { parentNode: parent },
        forceContextLoss() {
          log.contextLost += 1;
        },
        dispose() {
          log.rendererDisposed += 1;
        },
      };
      async initialize() {
        target.addEventListener("resize", () => {
          log.resizeEvents += 1;
        });
      }
      async roll() {
        return rendererResult([{ sides: 20, values: [17] }]);
      }
      clearDice() {
        log.clearedDice += 1;
      }
    };
  }

  function rendererFor(log: UpstreamLog, target: ReturnType<typeof fakeWindow>) {
    return createDiceBoxRenderer({
      loadModule: async () => fakeUpstream(log, target),
      resizeTarget: target,
    });
  }

  function optionsFor() {
    return diceBoxOptions(
      activeDiceSkin(defaultDicePresentationSettings),
      defaultDicePresentationSettings,
    );
  }

  it("unsubscribes the captured resize listener and frees the context", async () => {
    const target = fakeWindow();
    const log = upstreamLog();
    const handle = rendererFor(log, target)({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    expect(target.listeners.size).toBe(1);
    // Capturing records the listener; it must still reach the renderer.
    target.resize();
    expect(log.resizeEvents).toBe(1);

    handle.dispose?.();

    expect(target.listeners.size).toBe(0);
    expect(log.clearedDice).toBe(1);
    expect(log.detached).toBe(1);
    expect(log.contextLost).toBe(1);
    expect(log.rendererDisposed).toBe(1);
    // Nothing is left subscribed to keep firing at a discarded renderer.
    target.resize();
    expect(log.resizeEvents).toBe(1);
  });

  it("puts the listener registration back after initializing", async () => {
    const target = fakeWindow();
    const log = upstreamLog();
    const original = target.addEventListener;
    const handle = rendererFor(log, target)({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    // The capture must not remain installed for the life of the page.
    expect(target.addEventListener).toBe(original);
    handle.dispose?.();
    expect(target.listeners.size).toBe(0);
  });

  it("releases a renderer that failed to initialize", async () => {
    const target = fakeWindow();
    const log = upstreamLog();
    class BrokenBox {
      renderer = {
        domElement: { parentNode: { removeChild: () => (log.detached += 1) } },
        forceContextLoss: () => (log.contextLost += 1),
        dispose: () => (log.rendererDisposed += 1),
      };
      async initialize() {
        target.addEventListener("resize", () => {});
        throw new Error("WebGL is unavailable");
      }
      clearDice() {
        log.clearedDice += 1;
      }
    }
    const factory = createDiceBoxRenderer({
      loadModule: async () => BrokenBox,
      resizeTarget: target,
    });
    const handle = factory({ selector: diceStageSelector, options: optionsFor() });
    await expect(handle.initialize()).rejects.toThrow("WebGL is unavailable");
    // A half-initialized renderer has already taken a context and a listener.
    expect(target.listeners.size).toBe(0);
    expect(log.clearedDice).toBe(1);
    expect(log.contextLost).toBe(1);
    expect(log.rendererDisposed).toBe(1);
  });

  it("rebuilds for a skin change without accumulating listeners", async () => {
    const target = fakeWindow();
    const log = upstreamLog();
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: rendererFor(log, target),
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    expect(target.listeners.size).toBe(1);

    const arcane = updateDicePresentationSettings(defaultDicePresentationSettings, {
      skinId: "arcane",
    });
    presenter.configure(arcane);
    await presenter.present(requestFor(plan, [12], arcane));
    // The old renderer is gone, not stacked behind the new one.
    expect(target.listeners.size).toBe(1);
    expect(log.rendererDisposed).toBe(1);

    presenter.dispose();
    expect(target.listeners.size).toBe(0);
    expect(log.rendererDisposed).toBe(2);
  });
});

describe("each landed face is paired with the die mesh that rolled it", () => {
  it("uses the renderer's own die ids, in the flattened face order", () => {
    const results = rendererResult([{ sides: 6, values: [4, 3] }]);
    expect(reportedDieIds(results)).toEqual([0, 1]);
    const dice = [fakeDie(), fakeDie()];
    const landed = landedDice(results, dice);
    expect(landed).toHaveLength(2);
    expect(landed![0]).toBe(dice[0]);
    expect(landed![1]).toBe(dice[1]);
  });

  it("never guesses a pairing it cannot trust", () => {
    const dice = [fakeDie(), fakeDie()];
    expect(landedDice({ sets: [{ rolls: [{ value: 17 }] }] }, dice)).toBeNull();
    expect(landedDice(undefined, dice)).toBeNull();
    expect(landedDice(rendererResult([{ sides: 6, values: [4, 3] }]), undefined)).toBeNull();
    expect(landedDice(rendererResult([{ sides: 6, values: [4, 3] }]), [])).toBeNull();
    // An id the renderer no longer has cannot be paired with anything.
    expect(
      landedDice(rendererResult([{ sides: 6, values: [4, 3] }]), [dice[0]!]),
    ).toBeNull();
  });
});

describe("the values live in the renderer's scene, on the dice", () => {
  it("parents each authoritative value to the die that rolled it", async () => {
    const scene = sceneRenderer(rendererResult([{ sides: 6, values: [4, 3] }]), 2);
    const handle = scene.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    await handle.roll("2d6@4,3");

    const materials = scene.dice.map((die) => (die.material as unknown[])[0]);
    const presentation = handle.presentDieValues?.(dieValueRequest([4, 3]));
    expect(presentation).not.toBeNull();
    // Nothing appears until the landed die has held still for consecutive frames.
    expect(scene.dice[0]!.children).toHaveLength(0);
    expect(scene.texts()).toEqual([]);

    scene.advance(valueStableFrames);
    const [first, second] = scene.dice.map((die) => die.children[0]!);
    expect(first).toBeDefined();
    expect(first!.parent).toBe(scene.dice[0]);
    expect(second!.parent).toBe(scene.dice[1]);
    // The values drawn are the resolved faces, drawn once per die.
    expect(scene.texts()).toEqual(["4", "3"]);
    // The die keeps its own material and its shared texture: the presentation
    // only ever wears a clone.
    scene.dice.forEach((die, index) => {
      expect((die.material as unknown[])[0]).toBe(materials[index]);
    });
    presentation!.dispose();
  });

  it("moves the values with their dice, with no projection step", () => {
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const handle = scene.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    return handle.initialize().then(async () => {
      await handle.roll("1d20@17");
      const presentation = handle.presentDieValues?.(dieValueRequest([17]));
      scene.advance(valueStableFrames);
      const value = scene.dice[0]!.children[0]!;
      const before = worldPositionOf(value);

      // Translating the die mesh translates the value: it is in the scene graph,
      // not positioned by a stored screen coordinate.
      scene.dice[0]!.position.set(75, -25, 10);
      const after = worldPositionOf(value);
      expect(after.x).toBeCloseTo(before.x + 75);
      expect(after.y).toBeCloseTo(before.y - 25);
      presentation!.dispose();
    });
  });

  it("drives the draw loop itself, because the renderer's has stopped", async () => {
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const handle = scene.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    await handle.roll("1d20@17");
    const presentation = handle.presentDieValues?.(dieValueRequest([17]));
    scene.advance(valueStableFrames);
    const drawn = scene.renders();
    expect(drawn).toBeGreaterThan(0);
    scene.advance(2);
    expect(scene.renders()).toBeGreaterThan(drawn);
    presentation!.dispose();
  });

  it("releases every scene object the presentation created", async () => {
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const handle = scene.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    await handle.roll("1d20@17");
    const presentation = handle.presentDieValues?.(dieValueRequest([17], {
      naturalFaceIndex: 0,
      event: "critical-success",
      flourish: findDiceFlourish("sparks"),
    }));
    scene.advance(valueStableFrames);
    // Two objects on the die: the value and the flourish it emitted.
    expect(scene.dice[0]!.children).toHaveLength(2);
    const dieMesh = scene.dice[0]!;
    const dieMaterial = (dieMesh.material as { emissive: { r: number } }[])[0]!;
    expect(dieMaterial.emissive.r).toBeGreaterThan(0);
    presentation!.dispose();
    expect(scene.dice[0]!.children).toHaveLength(0);
    // The flourish is over, so the die stops glowing.
    expect(dieMaterial.emissive.r).toBe(0);
    await expect(presentation!.done).resolves.toBeUndefined();
  });

  it("drops a running presentation when the next throw clears the table", async () => {
    const scene = sceneRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: scene.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    const presentation = presenter.presentDieValues?.(dieValueRequest([17]));
    scene.advance(valueStableFrames);
    expect(scene.dice[0]!.children).toHaveLength(1);

    await presenter.present(requestFor(plan, [17]));
    // The old dice are gone from the table, so nothing may ride on them.
    expect(scene.dice[0]!.children).toHaveLength(0);
    await expect(presentation!.done).resolves.toBeUndefined();
  });

  it("declines when the throw never rendered, so the result is shown plainly", async () => {
    // A test double with no scene at all.
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [17] }]));
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [17]));
    expect(report.mode).toBe("rendered");
    expect(presenter.presentDieValues?.(dieValueRequest([17]))).toBeNull();
  });

  it("keeps the value out of the document entirely", () => {
    // Guards against a regression to the previous approach, where a DOM chip
    // was positioned over a die and merely looked like it was on it.
    const overlay = readFileSync(
      new URL("../apps/web/src/components/dice-overlay.tsx", import.meta.url),
      "utf8",
    );
    expect(overlay).toMatch(/presentDieValues/);
    expect(overlay).not.toMatch(/dice-burst/);
    expect(overlay).not.toMatch(/--die-x|--die-y/);
    const stylesheet = readFileSync(
      new URL("../apps/web/src/styles.css", import.meta.url),
      "utf8",
    );
    expect(stylesheet).not.toMatch(/dice-burst/);
    expect(stylesheet).not.toMatch(/--die-x|--die-y|--dice-lift/);
  });
});

describe("the chosen skin reaches the renderer's own scene", () => {
  /** A stand-in shaped like the parts of upstream the look is applied through. */
  interface FakeUpstreamBox {
    desk: { material: FakeMaterial; receiveShadow: boolean };
    light: { color: FakeColor; intensity: number };
    light_amb: { color: FakeColor; groundColor: FakeColor; intensity: number };
    diceList: unknown[];
    DiceFactory: {
      createMaterials(): FakeMaterial[];
      create(): unknown;
    };
  }

  /** A `window` stand-in that can dispatch a resize at the renderer. */
  function fakeResizeTarget() {
    const listeners = new Set<(event: unknown) => void>();
    return {
      addEventListener(type: string, listener: unknown) {
        if (type === "resize" && typeof listener === "function")
          listeners.add(listener as (event: unknown) => void);
      },
      removeEventListener(type: string, listener: unknown) {
        if (type === "resize")
          listeners.delete(listener as (event: unknown) => void);
      },
      resize() {
        for (const listener of [...listeners]) listener({ type: "resize" });
      },
      subscribed: () => listeners.size,
    };
  }

  const rgbOf = (color: FakeColor) =>
    [color.r, color.g, color.b].map((value) => Math.round(value * 255));

  /**
   * Upstream's own scene objects, with a die factory that builds the metallic
   * material the presets really build, and a surface it rebuilds on a resize.
   */
  function upstreamRenderer(options = optionsFor()) {
    const loop = fakeFrameLoop();
    const target = fakeResizeTarget();
    const instances: FakeUpstreamBox[] = [];
    /** Upstream's own surface: a shadow catcher with nothing painted on it. */
    const shadowCatcher = () => {
      const material = new FakeMaterial();
      material.map = { kind: "shadow-catcher" };
      return material;
    };
    class LookBox implements FakeUpstreamBox {
      desk = { material: shadowCatcher(), receiveShadow: true };
      light = { color: new FakeColor(1, 1, 1), intensity: 0.7 };
      light_amb = {
        color: new FakeColor(1, 1, 1),
        groundColor: new FakeColor(0.4, 0.4, 0.8),
        intensity: 0.7,
      };
      diceList: unknown[] = [];
      scene = new FakeObject3D();
      camera = fakeCamera();
      renderer = { render() {} };
      DiceFactory = {
        createMaterials: () => {
          const material = new FakeMaterial();
          // The metallic preset, exactly as upstream builds it.
          material.color = new FakeColor(0.87, 0.87, 0.87);
          material.metalness = 0.6;
          material.roughness = 0.5;
          material.map = { kind: "die-texture" };
          return [material];
        },
        create: () => {
          const die = fakeDie();
          this.diceList.push(die);
          return die;
        },
      };
      constructor(_selector: string, options: unknown) {
        this.options = options;
        instances.push(this);
      }
      options: unknown;
      async initialize() {}
      async roll() {
        // Upstream spawns a die at the start of a throw, before any frame of it.
        this.DiceFactory.create();
        return rendererResult([{ sides: 20, values: [17] }]);
      }
      clearDice() {}
      /** A resize rebuilds the surface, the way upstream rebuilds its own. */
      resize() {
        this.desk = { material: shadowCatcher(), receiveShadow: true };
      }
    }
    const factory = createDiceBoxRenderer({
      loadModule: async () => LookBox as never,
      resizeTarget: target,
      dieValueEnvironment: {
        createCanvas: () => asCanvas(fakeCanvas()),
        now: () => loop.now,
        requestFrame: loop.requestFrame,
        cancelFrame: loop.cancelFrame,
      },
    });
    return {
      factory,
      loop,
      target,
      instance: () => instances[instances.length - 1]!,
      instances,
    };
  }

  it("throws the selected surface's own light on the scene", async () => {
    const upstream = upstreamRenderer();
    const handle = upstream.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    const look = diceSurfaceLook(optionsFor().theme_surface);
    expect(upstream.instance().light.intensity).toBe(look.spot.intensity);
    expect(rgbOf(upstream.instance().light.color)).toEqual(
      rgbOf(hexColor(look.spot.color)),
    );
    expect(upstream.instance().light_amb.intensity).toBe(
      look.ambient.intensity,
    );
    handle.dispose?.();
  });

  it("paints the surface onto the renderer's own backdrop", async () => {
    const upstream = upstreamRenderer();
    const handle = upstream.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    // Before a die exists there is no material of the scene's class to build the
    // plate from, so the renderer's own shadow material is left alone.
    const shadowMaterial = upstream.instance().desk.material;
    expect(shadowMaterial.map).toEqual({ kind: "shadow-catcher" });

    await handle.roll("1d20@17");
    const plate = upstream.instance().desk.material;
    expect(plate).not.toBe(shadowMaterial);
    expect(rgbOf(plate.color)).toEqual(
      rgbOf(hexColor(diceSurfaceLook(optionsFor().theme_surface).desk)),
    );
    // It is still the renderer's mesh, so it still catches the dice's shadow.
    expect(upstream.instance().desk.receiveShadow).toBe(true);
    expect(shadowMaterial.disposed).toBe(0);

    handle.dispose?.();
    expect(plate.disposed).toBe(1);
  });

  it("normalises the die materials the renderer itself builds", async () => {
    const upstream = upstreamRenderer();
    const handle = upstream.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    const material = upstream.instance().DiceFactory.createMaterials()[0]!;
    // The metallic preset's own tint is replaced, so the baked canvas carries
    // the authored colours, and its metalness no longer darkens them.
    expect(rgbOf(material.color)).toEqual([255, 255, 255]);
    expect(material.metalness).toBeLessThanOrEqual(dieMetalnessCeiling);
    expect(material.metalness).toBeGreaterThan(0);
    expect(material.roughness).toBe(0.5);
    handle.dispose?.();
  });

  it("repaints the surface the renderer rebuilt on a resize", async () => {
    const upstream = upstreamRenderer();
    const handle = upstream.factory({
      selector: diceStageSelector,
      options: optionsFor(),
    });
    await handle.initialize();
    await handle.roll("1d20@17");

    // Upstream rebuilds its surface on the frame after a resize; ours is
    // re-established on that same frame, right after it.
    upstream.instance().resize();
    const rebuilt = upstream.instance().desk.material;
    expect(rebuilt.map).toEqual({ kind: "shadow-catcher" });
    upstream.target.resize();
    upstream.loop.step();
    // The rebuilt surface wears a new plate, and the renderer's own material —
    // which is not ours to repaint — is left where it is.
    const plate = upstream.instance().desk.material;
    expect(plate).not.toBe(rebuilt);
    expect(plate.map).toBeNull();
    expect(rgbOf(plate.color)).toEqual(
      rgbOf(hexColor(diceSurfaceLook(optionsFor().theme_surface).desk)),
    );
    expect(rebuilt.map).toEqual({ kind: "shadow-catcher" });

    handle.dispose?.();
    // The extra subscription goes with the renderer it was made for.
    expect(upstream.target.subscribed()).toBe(0);
  });

  it("gives each surface a visibly different table", async () => {
    const surfaces = ["green-felt", "cyberpunk", "stainless"];
    const colours: string[] = [];
    for (const surface of surfaces) {
      const options = {
        ...optionsFor(),
        theme_surface: surface,
      };
      const upstream = upstreamRenderer(options);
      const handle = upstream.factory({
        selector: diceStageSelector,
        options,
      });
      await handle.initialize();
      await handle.roll("1d20@17");
      const plate = upstream.instance().desk.material;
      colours.push(rgbOf(plate.color).join(","));
      // The scene's light is the surface's own, not the renderer's default.
      expect(upstream.instance().light.intensity).not.toBe(0.7);
      handle.dispose?.();
    }
    expect(new Set(colours).size).toBe(surfaces.length);
  });
});

/** The rgb components a six-digit hex names, as the scene stores them. */
function hexColor(hex: string): FakeColor {
  const value = Number.parseInt(hex.slice(1), 16);
  return new FakeColor(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}
