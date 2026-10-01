import { describe, expect, it } from "vitest";
import { isRollFreeManeuverBoost, resolveManeuverBoostActivation, RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput, type CharacterInput, type CharacterSystemEntry, type FeatureActionRestriction } from "@threepointpf/rules-schema";
import { InMemoryCharacterRepository } from "@threepointpf/shared";
import { charlieCharacter } from "../apps/web/src/lib/charlie-character";

const sourceId = "charlie-stalker-maneuvers";
const entryId = "charlie-maneuver-strength-hell";
const sourceOf = (character: CharacterInput) => character.systems!.find((source) => source.id === sourceId)!;
const boostOf = (character: CharacterInput) => sourceOf(character).entries.find((entry) => entry.id === entryId)!;
function readyCharacter(patch: Partial<CharacterSystemEntry> = {}) {
  const character = structuredClone(charlieCharacter);
  Object.assign(boostOf(character), { readied: true }, patch);
  return character;
}
const transition = (character: CharacterInput, active = true) => resolveManeuverBoostActivation(character, sourceId, entryId, active, rulesCatalogs);

describe("roll-free maneuver boost activation", () => {
  it("activates the existing Strength of Hell effects and spends exactly one swift action and use", () => {
    const before = readyCharacter();
    const snapshot = structuredClone(before);
    const result = transition(before);
    expect(result.error).toBeUndefined();
    expect(before).toEqual(snapshot);
    expect(boostOf(result.character)).toMatchObject({ active: true, expended: true, usesSpent: 1 });
    expect(result.character.turnActions).toEqual({ swiftSpent: true });
    const beforeEngine = new RulesEngine(before, rulesCatalogs);
    const afterEngine = new RulesEngine(result.character, rulesCatalogs);
    expect(afterEngine.createAttackRollPlan("izanamis-nodachi").modifier).toBe(beforeEngine.createAttackRollPlan("izanamis-nodachi").modifier + 2);
    expect(afterEngine.derive().ac.value).toBe(beforeEngine.derive().ac.value - 2);
    expect(afterEngine.effects).toContainEqual(expect.objectContaining({ kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 6 }, label: "Strength of Hell" }));
    expect(boostOf(result.character).effects).toEqual(boostOf(before).effects);
  });

  it.each([
    [{ known: false }, "not known"],
    [{ readied: false }, "not readied"],
    [{ expended: true }, "expended"],
    [{ usesPerDay: 1, usesSpent: 1 }, "no daily uses"],
    [{ tier: 3 }, "maximum tier"],
  ] as [Partial<CharacterSystemEntry>, string][])("leaves all state untouched when unavailable: %j", (patch, error) => {
    const character = readyCharacter(patch);
    const snapshot = structuredClone(character);
    const result = transition(character);
    expect(result.error).toContain(error);
    expect(result.character).toBe(character);
    expect(character).toEqual(snapshot);
  });

  it.each(["noActions", "noPhysicalActions", "moveOnly", "fleeOnly"] as FeatureActionRestriction[])("honors %s without spending or activating", (restriction) => {
    const character = readyCharacter();
    character.features.push({ id: "blocked", name: "Blocked", enabled: true, effects: [], actionRestrictions: [restriction] });
    const result = transition(character);
    expect(result.error).toBeTruthy();
    expect(result.character).toBe(character);
  });

  it("honors a spent swift action without spending resources or daily uses", () => {
    const character = readyCharacter({ resourceCost: 2, usesPerDay: 3 });
    character.turnActions = { swiftSpent: true };
    const result = transition(character);
    expect(result.error).toContain("already spent");
    expect(result.character).toBe(character);
  });

  it.each([
    ["standard", { standardSpent: true }], ["move", { moveSpent: true }],
    ["immediate", { swiftSpent: true }], ["fullRound", { fullRoundSpent: true }], ["free", undefined],
  ] as const)("honors the authored %s action cost", (actionCost, turnActions) => {
    const result = transition(readyCharacter({ actionCost }));
    expect(result.error).toBeUndefined();
    expect(result.character.turnActions).toEqual(turnActions);
    expect(boostOf(result.character).usesSpent).toBe(1);
  });

  it("checks the current resource pool and commits its cost atomically", () => {
    const character = readyCharacter({ resourceCost: 2, usesPerDay: 3 });
    sourceOf(character).progression[0].resourceMaximum = 3;
    sourceOf(character).resourceSpent = 2;
    const blocked = transition(character);
    expect(blocked.error).toContain("Not enough");
    expect(blocked.character).toBe(character);
    sourceOf(character).resourceSpent = 1;
    const result = transition(character);
    expect(result.error).toBeUndefined();
    expect(sourceOf(result.character).resourceSpent).toBe(3);
    expect(boostOf(result.character)).toMatchObject({ usesSpent: 1, active: true, expended: true });
    expect(result.character.turnActions).toEqual({ swiftSpent: true });
  });

  it("makes repeated activation idempotent, including free actions", () => {
    for (const actionCost of ["swift", "free"] as const) {
      const first = transition(readyCharacter({ actionCost, resourceCost: 2 })).character;
      const repeated = transition(first);
      expect(repeated.error).toBeUndefined();
      expect(repeated.character).toBe(first);
      expect(boostOf(first).usesSpent).toBe(1);
      expect(sourceOf(first).resourceSpent).toBe(2);
    }
  });

  it("ending an effect never refunds actions, uses or resources, or allows off/on recovery", () => {
    const activated = transition(readyCharacter({ resourceCost: 2, roundsRemaining: 1 })).character;
    const ended = transition(activated, false).character;
    expect(boostOf(ended)).toMatchObject({ active: false, expended: true, usesSpent: 1 });
    expect(boostOf(ended).roundsRemaining).toBeUndefined();
    expect(sourceOf(ended).resourceSpent).toBe(2);
    expect(ended.turnActions).toBe(activated.turnActions);
    expect(transition(ended, false).character).toBe(ended);
    const newTurn = { ...ended, turnActions: {} };
    const attempted = transition(newTurn);
    expect(attempted.error).toContain("expended");
    expect(attempted.character).toBe(newTurn);
    const afterEngine = new RulesEngine(ended, rulesCatalogs);
    expect(afterEngine.effects.some((effect) => effect.kind === "damageDice" && effect.label === "Strength of Hell")).toBe(false);
  });

  it("allows deactivation even while actions are blocked", () => {
    const character = transition(readyCharacter()).character;
    character.features.push({ id: "blocked", name: "Blocked", enabled: true, effects: [], actionRestrictions: ["noActions", "noPhysicalActions"] });
    const result = transition(character, false);
    expect(result.error).toBeUndefined();
    expect(boostOf(result.character)).toMatchObject({ active: false, expended: true });
  });

  it("preserves the active boost, expenditure and turn state through persistence", async () => {
    const repository = new InMemoryCharacterRepository(rulesCatalogs);
    const activated = transition(readyCharacter()).character;
    await repository.save(parseCharacterInput(activated));
    const loaded = (await repository.load(activated.id))!;
    expect(boostOf(loaded)).toMatchObject({ active: true, expended: true, usesSpent: 1 });
    expect(loaded.turnActions).toEqual({ swiftSpent: true });
    const ended = transition(loaded, false).character;
    await repository.save(parseCharacterInput(ended));
    const reloaded = (await repository.load(ended.id))!;
    expect(transition(reloaded).error).toContain("expended");
  });

  it("does not reroute stances, rolled maneuvers or other systems", () => {
    const character = readyCharacter();
    const source = sourceOf(character);
    for (const entry of source.entries.filter((entry) => entry.id !== entryId)) {
      if (entry.roll || /^Stance/.test(entry.category ?? "")) {
        expect(isRollFreeManeuverBoost(source, entry)).toBe(false);
        const result = resolveManeuverBoostActivation(character, sourceId, entry.id, true, rulesCatalogs);
        expect(result.error).toContain("only supports");
        expect(result.character).toBe(character);
      }
    }
    expect(isRollFreeManeuverBoost({ kind: "psionics" }, boostOf(character))).toBe(false);
  });
});
