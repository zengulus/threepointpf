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
  diceBoxOptions,
  diceSkinKey,
  playFlourishCue,
  renderedFaceValues,
  type DiceBoxFactory,
  type DiceBoxInit,
} from "../apps/web/src/lib/dice-3d";

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
  factory: DiceBoxFactory;
  results: unknown;
  failInitialize: boolean;
}

function fakeRenderer(results: unknown = undefined): FakeRenderer {
  const state: FakeRenderer = {
    inits: [],
    rolls: [],
    cleared: 0,
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
          return state.results;
        },
        clear() {
          state.cleared += 1;
        },
      };
    },
  };
  return state;
}

function stageElement(): HTMLElement {
  return { innerHTML: "stale canvas" } as unknown as HTMLElement;
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
    const renderer = fakeRenderer({ sets: [{ sides: 20, dice: [{ value: 17 }] }] });
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
    const renderer = fakeRenderer({ sets: [{ sides: 20, dice: [{ value: 3 }] }] });
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
    expect(renderedFaceValues({ sets: [{ sides: 20, dice: [{ value: 3 }] }] })).toEqual([3]);
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
    const renderer = fakeRenderer({ sets: [{ sides: 6, dice: [{ value: 4 }, { value: 3 }] }] });
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

  it("falls back for a plan it cannot force in one throw", async () => {
    const renderer = fakeRenderer();
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
        { sides: 6, count: 1 },
      ],
    };
    const report = await presenter.present(requestFor(multi, [17, 4]));
    expect(report.mode).toBe("fallback");
    expect(report.reason).toContain("dice groups");
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
    // One clear per throw, one when the skin rebuilt the renderer, one on dispose.
    expect(renderer.cleared).toBe(4);
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
    const renderer = fakeRenderer({ sets: [{ sides: 20, dice: [{ value: 20 }] }] });
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
