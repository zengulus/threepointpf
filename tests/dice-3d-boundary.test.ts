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
  type DiceFlourish,
  type DicePresentationSettings,
  type RollPresentationEvent,
} from "@threepointpf/dice";
import {
  createDiceBoxPresenter,
  createDiceBoxRenderer,
  diceBoxOptions,
  diceSkinKey,
  playFlourishCue,
  diceStageSelector,
  readLandedDieAnchors,
  renderedFaceValues,
  reportedDieIds,
  type DiceBoxFactory,
  type DiceBoxInit,
} from "../apps/web/src/lib/dice-3d";
import type { DicePresentationAnchor } from "@threepointpf/dice";

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
  /** What the renderer reports for the dice that landed, when it can. */
  anchors?: DicePresentationAnchor[] | null;
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
        landedDieAnchors() {
          return state.anchors ?? null;
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

  it("plays the flourish's own cue for each throw", async () => {
    const cues: DiceFlourish[] = [];
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: fakeRenderer().factory,
      playCue: (flourish) => cues.push(flourish),
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    await presenter.present(requestFor(plan, [17]));
    await presenter.present(
      requestFor(
        plan,
        [20],
        defaultDicePresentationSettings,
        "critical-success",
        findDiceFlourish("sparks"),
      ),
    );
    expect(cues.map((flourish) => flourish.id)).toEqual(["pulse", "sparks"]);
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
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [20] }]));
    const seen: RollPresentationEvent[] = [];
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
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
    expect(seen).toEqual(["sparks"]);
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

/**
 * A landed die mesh is only ever projected, never read for a value: the fixture
 * exposes `clone().project()` and nothing else, which is exactly the surface the
 * adapter is allowed to use.
 */
function fakeDie(ndc: { x: number; y: number }) {
  return {
    position: {
      clone: () => ({
        project: () => ({ x: ndc.x, y: ndc.y, z: 0 }),
      }),
    },
  };
}

function anchorOptions() {
  return diceBoxOptions(
    activeDiceSkin(defaultDicePresentationSettings),
    defaultDicePresentationSettings,
  );
}

describe("landed dice expose a position for the values to rise from", () => {
  it("pairs each reported die with its projected screen position", () => {
    const results = rendererResult([
      { sides: 20, values: [17] },
      { sides: 6, values: [4, 3] },
    ]);
    // The ids are the renderer's own flattened die order, which is the order the
    // faces were applied in.
    expect(reportedDieIds(results)).toEqual([0, 100, 101]);
    const diceList: { position?: unknown }[] = [];
    diceList[0] = fakeDie({ x: 0, y: 0 });
    diceList[100] = fakeDie({ x: -0.5, y: 0.5 });
    diceList[101] = fakeDie({ x: 1.4, y: -1.2 });
    expect(readLandedDieAnchors(results, diceList, {})).toEqual([
      { faceIndex: 0, x: 0.5, y: 0.5 },
      { faceIndex: 1, x: 0.25, y: 0.25 },
      { faceIndex: 2, x: 1, y: 1 },
    ]);
  });

  it("is a position only — never a value, and never a guess", () => {
    // A response the adapter has no reason to trust reports no positions at all.
    expect(reportedDieIds({ sets: [{ rolls: [{ value: 17 }] }] })).toBeNull();
    expect(reportedDieIds(undefined)).toBeNull();
    expect(reportedDieIds({ sets: [{ sides: 20, dice: [{ value: 17 }] }] })).toBeNull();
    const results = rendererResult([{ sides: 20, values: [17] }]);
    const diceList = [fakeDie({ x: 0, y: 0 })];
    expect(readLandedDieAnchors(results, undefined, {})).toBeNull();
    expect(readLandedDieAnchors(results, [], {})).toBeNull();
    expect(readLandedDieAnchors(results, diceList, undefined)).toBeNull();
    const anchor = readLandedDieAnchors(results, diceList, {})![0]!;
    expect(Object.keys(anchor).sort()).toEqual(["faceIndex", "x", "y"]);
  });

  it("keeps the face a die belongs to when another die cannot be projected", () => {
    const results = rendererResult([
      { sides: 20, values: [17] },
      { sides: 6, values: [4, 3] },
    ]);
    const diceList: { position?: unknown }[] = [];
    diceList[0] = fakeDie({ x: 0, y: 0 });
    // A die the renderer no longer has, and a position that cannot project.
    diceList[101] = { position: { clone: () => ({}) } };
    expect(readLandedDieAnchors(results, diceList, {})).toEqual([
      { faceIndex: 0, x: 0.5, y: 0.5 },
    ]);
  });

  it("carries the landed positions into the presentation report", async () => {
    const renderer = fakeRenderer(rendererResult([{ sides: 20, values: [17] }]));
    renderer.anchors = [{ faceIndex: 0, x: 0.4, y: 0.7 }];
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: renderer.factory,
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [17]));
    expect(report.mode).toBe("rendered");
    expect(report.anchors).toEqual([{ faceIndex: 0, x: 0.4, y: 0.7 }]);
  });

  it("reports no anchors when the renderer cannot project the dice", async () => {
    const presenter = createDiceBoxPresenter({
      settings: defaultDicePresentationSettings,
      factory: () => ({
        async initialize() {},
        async roll() {
          return rendererResult([{ sides: 20, values: [17] }]);
        },
        clear() {},
        dispose() {},
      }),
      playCue: () => {},
    });
    const plan = engine().createAttackRollPlan("blade", 0);
    const report = await presenter.present(requestFor(plan, [17]));
    // The result is still shown; it is only the anchoring that is unavailable.
    expect(report).toMatchObject({ mode: "rendered", handoff: "matched" });
    expect(report.anchors).toBeUndefined();
  });

  it("projects the dice the wrapper actually rolled", async () => {
    /** A renderer that keeps its dice meshes and camera the way upstream does. */
    class ProjectedBox {
      camera = {};
      diceList = [fakeDie({ x: 0, y: 0 })];
      constructor(_selector: string, _options: unknown) {}
      async initialize() {}
      async roll() {
        return rendererResult([{ sides: 20, values: [17] }]);
      }
      clearDice() {}
    }
    const handle = createDiceBoxRenderer({
      loadModule: async () => ProjectedBox,
      // The wrapper captures the renderer's own resize subscription.
      resizeTarget: { addEventListener() {}, removeEventListener() {} },
    })({ selector: diceStageSelector, options: anchorOptions() });
    await handle.initialize();
    // Nothing has landed yet, so there is nothing to anchor to.
    expect(handle.landedDieAnchors?.()).toBeNull();
    await handle.roll("1d20@17");
    expect(handle.landedDieAnchors?.()).toEqual([{ faceIndex: 0, x: 0.5, y: 0.5 }]);
  });
});
