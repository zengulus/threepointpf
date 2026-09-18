import { describe, expect, it, vi } from "vitest";
import { RulesEngine, isFullAttackAction } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { AttackDefinition, CharacterInput, RollPlan } from "@threepointpf/rules-schema";
import {
  activeDiceSkin,
  classifyRollPresentation,
  clearDicePreferences,
  customDiceSkinId,
  defaultDicePresentationSettings,
  diceColorPattern,
  diceFlourishes,
  diceMaterialOptions,
  diceNotationFor,
  dicePreferencesKey,
  diceSkinPresets,
  diceSurfaceOptions,
  diceTextureOptions,
  findDiceFlourish,
  flourishFor,
  hasStoredDicePreferences,
  loadDicePreferences,
  noneDiceFlourish,
  physicalFacesSupported,
  resolveRollPlan,
  saveDicePreferences,
  systemPrefersReducedMotion,
  updateDicePresentationSettings,
  validateDicePresentationSettings,
  type DicePreferencesStorage,
} from "@threepointpf/dice";

function homebrew(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    id: "presentation",
    name: "Presentation Test",
    baseAbilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    baseBab: 8,
    baseSaves: { fortitude: 3, reflex: 2, will: 1 },
    baseHpBeforeConstitution: 30,
    hitDiceCount: 2,
    skillRanks: { perception: 5 },
    attacks: [],
    features: [],
    damageTaken: 0,
    temporaryHp: 0,
    ...overrides,
  };
}

const sword = (
  id: string,
  overrides: Partial<AttackDefinition> = {},
): AttackDefinition => ({
  id,
  name: id,
  attackAbility: "str",
  damageAbility: "str",
  baseDamage: { count: 1, sides: 8 },
  attackTags: ["weapon.melee"],
  ...overrides,
});

const engine = (input: CharacterInput) =>
  new RulesEngine(input, rulesCatalogs);

/** A plan's event plus the resolved outcome it was derived from. */
function presentationFor(plan: RollPlan, faces: number[]) {
  const resolved = resolveRollPlan(plan, faces);
  return {
    resolved,
    ...classifyRollPresentation(plan, resolved.outcome),
  };
}

function memoryStorage(): DicePreferencesStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe("presentation events are derived from resolved facts", () => {
  it("shows the combat critical presentation for an attack critical hit", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
      { defense: { kind: "ac", value: 10 } },
    );
    const shown = presentationFor(plan, [20]);
    expect(shown.resolved.outcome.kind).toBe("criticalSuccess");
    expect(shown.event).toBe("critical-success");
    expect(shown.combat).toBe(true);
  });

  it("shows the combat critical-failure presentation for an attack natural 1", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
      { defense: { kind: "ac", value: 10 } },
    );
    const shown = presentationFor(plan, [1]);
    expect(shown.resolved.outcome.kind).toBe("criticalFailure");
    expect(shown.event).toBe("critical-failure");
    expect(shown.combat).toBe(true);
  });

  it("keeps a threat that missed out of the critical presentation", () => {
    const plan = engine(
      homebrew({
        attacks: [sword("keen", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
    ).createAttackRollPlan("keen", 0, { defense: { kind: "ac", value: 40 } });
    const shown = presentationFor(plan, [19]);
    expect(shown.resolved.outcome.inCriticalRange).toBe(true);
    expect(shown.resolved.outcome.critical).toBe(false);
    expect(shown.event).toBe("none");
  });

  it("shows the combat critical presentation for a threat that hit", () => {
    const plan = engine(
      homebrew({
        attacks: [sword("keen", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
    ).createAttackRollPlan("keen", 0, { defense: { kind: "ac", value: 5 } });
    const shown = presentationFor(plan, [19]);
    expect(shown.event).toBe("critical-success");
    expect(shown.resolved.outcome.kind).toBe("criticalSuccess");
  });

  it("leaves an unresolved threat with no special presentation", () => {
    const plan = engine(
      homebrew({
        attacks: [sword("keen", { criticalRange: { minimumNaturalRoll: 19 } })],
      }),
    ).createAttackRollPlan("keen", 0);
    const shown = presentationFor(plan, [19]);
    expect(shown.resolved.outcome.inCriticalRange).toBe(true);
    expect(shown.resolved.outcome.critical).toBeUndefined();
    expect(shown.event).toBe("none");
  });

  it("treats save naturals as combat presentations on both faces", () => {
    const saves = engine(homebrew({}));
    const success = presentationFor(
      saves.createSaveRollPlan("fortitude", { defense: { kind: "dc", value: 30 } }),
      [20],
    );
    expect(success.resolved.outcome.automaticSuccess).toBe(true);
    expect(success.event).toBe("critical-success");
    const failure = presentationFor(
      saves.createSaveRollPlan("fortitude", { defense: { kind: "dc", value: 1 } }),
      [1],
    );
    expect(failure.resolved.outcome.automaticFailure).toBe(true);
    expect(failure.event).toBe("critical-failure");
  });

  it("uses the natural-face presentations for non-combat checks", () => {
    const checks = engine(homebrew({}));
    const skill = presentationFor(
      checks.createSkillRollPlan("perception", {
        defense: { kind: "dc", value: 40 },
      }),
      [20],
    );
    expect(skill.combat).toBe(false);
    expect(skill.event).toBe("natural-20");
    const natural1 = presentationFor(checks.createSkillRollPlan("perception"), [1]);
    expect(natural1.event).toBe("natural-1");
    expect(presentationFor(checks.createManeuverRollPlan("trip"), [20]).event).toBe(
      "natural-20",
    );
    expect(presentationFor(checks.createInitiativeRollPlan(), [20]).event).toBe(
      "natural-20",
    );
  });

  it("gives a damage roll no special presentation even on a d20", () => {
    const plan = engine(
      homebrew({
        attacks: [
          sword("club", {
            baseDamage: { count: 1, sides: 20 },
          }),
        ],
      }),
    ).createDamageRollPlan("club");
    const shown = presentationFor(plan, [20]);
    expect(shown.resolved.naturalFace).toBeUndefined();
    expect(shown.event).toBe("none");
    expect(shown.reason).toContain("no natural-face semantics");
  });

  it("does not confuse a plain initiative roll with a combat critical", () => {
    const plan = engine(homebrew({})).createInitiativeRollPlan();
    expect(presentationFor(plan, [20]).event).toBe("natural-20");
  });
});

describe("flourish registry and selection", () => {
  it("offers a none flourish and unique ids", () => {
    const ids = diceFlourishes.map((flourish) => flourish.id);
    expect(ids).toContain("none");
    expect(new Set(ids).size).toBe(ids.length);
    expect(noneDiceFlourish.id).toBe("none");
    expect(noneDiceFlourish.motion).toBe("none");
  });

  it("falls back to none for an unknown flourish", () => {
    expect(findDiceFlourish("does-not-exist")).toBe(noneDiceFlourish);
    expect(findDiceFlourish(undefined)).toBe(noneDiceFlourish);
  });

  it("selects a flourish per presentation slot", () => {
    const settings = {
      ...defaultDicePresentationSettings,
      flourishes: {
        ordinary: "flare",
        criticalSuccess: "sparks",
        criticalFailure: "impact",
        natural20: "pulse",
        natural1: "shards",
      },
    };
    expect(flourishFor(settings, "critical-success").id).toBe("sparks");
    expect(flourishFor(settings, "critical-failure").id).toBe("impact");
    expect(flourishFor(settings, "natural-20").id).toBe("pulse");
    expect(flourishFor(settings, "natural-1").id).toBe("shards");
    expect(flourishFor(settings, "none").id).toBe("flare");
    expect(flourishFor(defaultDicePresentationSettings, "none").id).toBe("none");
  });
});

describe("dice skins", () => {
  it("only references textures, materials and surfaces the renderer ships", () => {
    const textures = diceTextureOptions.map((option) => option.id);
    const materials = diceMaterialOptions.map((option) => option.id);
    const surfaces = diceSurfaceOptions.map((option) => option.id);
    for (const preset of diceSkinPresets) {
      expect(textures).toContain(preset.texture);
      expect(materials).toContain(preset.material);
      expect(surfaces).toContain(preset.surface);
      expect(preset.foreground).toMatch(diceColorPattern);
      expect(preset.background).toMatch(diceColorPattern);
    }
  });

  it("offers only colour axes the renderer actually paints", () => {
    // The renderer bakes the numerals, the body fill and the die edges into its
    // face texture. It has no visible outline colour, so a skin has none either:
    // a control that changes nothing is worse than no control.
    for (const preset of diceSkinPresets) {
      expect(Object.keys(preset)).not.toContain("outline");
      if (preset.edge !== undefined)
        expect(preset.edge).toMatch(diceColorPattern);
    }
    expect(
      Object.keys(defaultDicePresentationSettings.customSkin),
    ).not.toContain("outline");
  });

  it("resolves a preset and a custom skin", () => {
    const preset = diceSkinPresets[2]!;
    const resolved = activeDiceSkin({
      ...defaultDicePresentationSettings,
      skinId: preset.id,
    });
    expect(resolved.background).toBe(preset.background);
    expect(resolved.texture).toBe(preset.texture);
    const custom = activeDiceSkin({
      ...defaultDicePresentationSettings,
      skinId: customDiceSkinId,
      customSkin: {
        foreground: "#101010",
        background: "#fefefe",
        edge: "#808080",
        texture: "wood",
        material: "wood",
        surface: "mahogany",
      },
    });
    expect(custom.foreground).toBe("#101010");
    expect(custom.surface).toBe("mahogany");
    // An unknown preset id degrades to the default preset rather than throwing.
    expect(activeDiceSkin({ ...defaultDicePresentationSettings, skinId: "nope" })).toEqual(
      activeDiceSkin(defaultDicePresentationSettings),
    );
  });
});

describe("settings validation and persistence", () => {
  it("degrades a corrupt blob field by field", () => {
    const settings = validateDicePresentationSettings({
      skinId: "not-a-skin",
      customSkin: { foreground: "red", texture: "nope", material: 5, surface: "nope" },
      flourishes: { criticalSuccess: "bogus", ordinary: "pulse" },
      sound: "yes",
      intensity: 900,
      reducedMotion: 1,
    });
    expect(settings.skinId).toBe(defaultDicePresentationSettings.skinId);
    expect(settings.customSkin.foreground).toBe(
      defaultDicePresentationSettings.customSkin.foreground,
    );
    expect(settings.customSkin.texture).toBe(
      defaultDicePresentationSettings.customSkin.texture,
    );
    expect(settings.flourishes.criticalSuccess).toBe(
      defaultDicePresentationSettings.flourishes.criticalSuccess,
    );
    expect(settings.flourishes.ordinary).toBe("pulse");
    expect(settings.sound).toBe(defaultDicePresentationSettings.sound);
    expect(settings.intensity).toBe(100);
    expect(settings.reducedMotion).toBe(
      defaultDicePresentationSettings.reducedMotion,
    );
    expect(validateDicePresentationSettings(null)).toEqual(
      defaultDicePresentationSettings,
    );
    expect(validateDicePresentationSettings("garbage")).toEqual(
      defaultDicePresentationSettings,
    );
  });

  it("applies nested patches through the same validation", () => {
    const next = updateDicePresentationSettings(defaultDicePresentationSettings, {
      skinId: customDiceSkinId,
      customSkin: { foreground: "#ABCDEF", texture: "marble" },
      flourishes: { natural20: "shards" },
      intensity: -20,
    });
    expect(next.skinId).toBe(customDiceSkinId);
    expect(next.customSkin.foreground).toBe("#abcdef");
    expect(next.customSkin.texture).toBe("marble");
    // The untouched axes keep their previous value.
    expect(next.customSkin.background).toBe(
      defaultDicePresentationSettings.customSkin.background,
    );
    expect(next.flourishes.natural20).toBe("shards");
    expect(next.flourishes.criticalSuccess).toBe(
      defaultDicePresentationSettings.flourishes.criticalSuccess,
    );
    expect(next.intensity).toBe(0);
  });

  it("round-trips through an injected storage without touching character state", () => {
    const storage = memoryStorage();
    expect(loadDicePreferences(storage)).toEqual(defaultDicePresentationSettings);
    expect(hasStoredDicePreferences(storage)).toBe(false);
    const changed = updateDicePresentationSettings(
      defaultDicePresentationSettings,
      { skinId: diceSkinPresets[1]!.id, sound: false, intensity: 25 },
    );
    expect(saveDicePreferences(changed, storage)).toBe(true);
    expect(hasStoredDicePreferences(storage)).toBe(true);
    expect(storage.entries.get(dicePreferencesKey)).toContain(diceSkinPresets[1]!.id);
    expect(loadDicePreferences(storage)).toEqual(changed);
    clearDicePreferences(storage);
    expect(hasStoredDicePreferences(storage)).toBe(false);
    expect(loadDicePreferences(storage)).toEqual(defaultDicePresentationSettings);
  });

  it("recovers from unparsable storage and from storage that is absent", () => {
    const storage = memoryStorage();
    storage.setItem(dicePreferencesKey, "{not json");
    expect(loadDicePreferences(storage)).toEqual(defaultDicePresentationSettings);
    expect(loadDicePreferences(null)).toEqual(defaultDicePresentationSettings);
    expect(saveDicePreferences(defaultDicePresentationSettings, null)).toBe(false);
    expect(hasStoredDicePreferences(null)).toBe(false);
    expect(() => clearDicePreferences(null)).not.toThrow();
  });

  it("reports the operating system's motion preference when observable", () => {
    const original = (globalThis as { matchMedia?: unknown }).matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = vi.fn(() => ({
      matches: true,
    }));
    expect(systemPrefersReducedMotion()).toBe(true);
    (globalThis as { matchMedia?: unknown }).matchMedia = () => {
      throw new Error("blocked");
    };
    expect(systemPrefersReducedMotion()).toBe(false);
    if (original === undefined)
      delete (globalThis as { matchMedia?: unknown }).matchMedia;
    else (globalThis as { matchMedia?: unknown }).matchMedia = original;
    // With no observable preference the answer is still a boolean, not a crash.
    expect(typeof systemPrefersReducedMotion()).toBe("boolean");
  });
});

describe("physical dice notation", () => {
  it("builds forced-face notation from the authoritative faces", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
    );
    expect(diceNotationFor(plan, [17])).toBe("1d20@17");
    const damage = engine(
      homebrew({ attacks: [sword("blade", { baseDamage: { count: 2, sides: 6 } })] }),
    ).createDamageRollPlan("blade");
    expect(diceNotationFor(damage, [4, 3])).toBe("2d6@4,3");
  });

  it("rejects faces that do not match the plan", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
    );
    expect(() => diceNotationFor(plan, [21])).toThrow(/Invalid d20 face/);
    expect(() => diceNotationFor(plan, [1, 2])).toThrow(/requires 1 face/);
  });

  it("carries every dice group of a plan in one throw", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
    );
    const multi: RollPlan = {
      ...plan,
      dice: [
        { sides: 20, count: 1 },
        { sides: 6, count: 2 },
      ],
    };
    expect(physicalFacesSupported(plan)).toBe(true);
    expect(physicalFacesSupported(multi)).toBe(true);
    // Groups are flattened in declaration order, which is the order the renderer
    // applies the predetermined faces in.
    expect(diceNotationFor(multi, [17, 4, 3])).toBe("1d20+2d6@17,4,3");
  });

  it("has nothing to throw for a plan that needs no dice", () => {
    const plan = engine(homebrew({ attacks: [sword("blade")] })).createAttackRollPlan(
      "blade",
      0,
    );
    const empty: RollPlan = { ...plan, dice: [] };
    expect(physicalFacesSupported(empty)).toBe(false);
    // An empty plan must not become a bare "@" notation.
    expect(() => diceNotationFor(empty, [])).toThrow(/nothing for physical dice/);
  });

  it("keeps attack planning free of presentation concerns", () => {
    const action = engine(
      homebrew({ attacks: [sword("blade")] }),
    ).createActionPlan({ action: "fullAttack", attackIds: ["blade"] });
    expect(isFullAttackAction(action.context)).toBe(true);
    expect(action.rolls.every((roll) => physicalFacesSupported(roll))).toBe(true);
  });
});
