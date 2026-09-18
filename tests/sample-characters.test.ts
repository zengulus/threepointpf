import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput } from "@threepointpf/rules-schema";
import {
  defaultSample,
  defaultSampleId,
  eliteArray,
  levelOneFighter,
  sampleCharacter,
  sampleCharacters,
} from "../apps/web/src/lib/sample-characters";

const engineFor = (character = levelOneFighter) =>
  new RulesEngine(parseCharacterInput(character), rulesCatalogs);

describe("the sample registry", () => {
  it("opens on the level 1 fighter", () => {
    expect(defaultSampleId).toBe("level-1-fighter");
    expect(defaultSample().label).toBe("Level 1 fighter");
    expect(defaultSample().character).toBe(levelOneFighter);
  });

  it("rejects an unknown sample instead of silently defaulting", () => {
    expect(() => sampleCharacter("nope")).toThrow(/Unknown sample character/);
    expect(sampleCharacter("showcase").character.id).toBe("human-martial");
  });

  it("keeps every sample as authored state that derives and round-trips", () => {
    for (const sample of sampleCharacters) {
      const parsed = parseCharacterInput(sample.character);
      expect(() => new RulesEngine(parsed, rulesCatalogs).derive()).not.toThrow();
      // Authored samples never carry derived numbers: the JSON of a sample is
      // exactly what a save would store.
      const json = JSON.stringify(sample.character);
      expect(json).not.toMatch(/"(bab|ac|cmd|maxHp|saves)"\s*:/);
      expect(parsed.id).toBe(sample.character.id);
      expect(sample.label.length).toBeGreaterThan(0);
      expect(sample.description.length).toBeGreaterThan(0);
    }
  });
});

describe("the level 1 fighter sample", () => {
  const engine = engineFor();
  const derived = engine.derive();

  it("uses the elite array with the human bonus already applied", () => {
    expect({ ...eliteArray }).toEqual({
      str: 15,
      dex: 13,
      con: 14,
      int: 12,
      wis: 10,
      cha: 8,
    });
    expect(levelOneFighter.baseAbilities).toEqual({
      str: 17,
      dex: 13,
      con: 14,
      int: 12,
      wis: 10,
      cha: 8,
    });
    expect(derived.abilities.str.modifier.value).toBe(3);
    expect(derived.abilities.con.modifier.value).toBe(2);
  });

  it("derives its level, BAB, hit dice and hit points from one fighter level", () => {
    expect(derived.advancement?.slotCount).toBe(1);
    expect(derived.advancement?.hitDiceCount).toBe(1);
    expect(derived.advancement?.hitDieSides).toEqual([10]);
    expect(derived.advancement?.skillPoints).toBe(2);
    expect(derived.bab.value).toBe(1);
    // d10 maximum at level 1, Constitution +2, Toughness +3.
    expect(derived.maxHp.value).toBe(15);
    expect(derived.currentHp).toBe(15);
  });

  it("derives the class defenses of a level 1 fighter", () => {
    expect(derived.ac.value).toBe(15); // chain shirt 4 + Dexterity 1
    expect(derived.touchAc.value).toBe(11);
    expect(derived.flatFootedAc.value).toBe(14);
    expect(derived.saves.fortitude.value).toBe(4); // fighter +2, Constitution +2
    expect(derived.saves.reflex.value).toBe(1);
    expect(derived.saves.will.value).toBe(0);
    expect(derived.initiative.value).toBe(1);
    // Power Attack's melee penalty reaches CMB but not CMD.
    expect(derived.cmb.value).toBe(3);
    expect(derived.cmd.value).toBe(15);
  });

  it("applies the fighter's class skills and armor check penalty to its ranks", () => {
    expect(derived.skills.climb!.total.value).toBe(5); // 1 rank + 3 STR + 3 class − 2 armor
    expect(derived.skills.intimidate!.total.value).toBe(3); // 1 rank + 3 class − 1 CHA
    expect(derived.skills.ride!.total.value).toBe(3); // 1 rank + 3 class + 1 DEX − 2 armor
    expect(Object.values(levelOneFighter.skillRanks).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("attacks with the curated greatsword through the two-handed profile", () => {
    expect(derived.attacks).toHaveLength(1);
    const attack = derived.attacks[0]!;
    expect(attack.definition.id).toBe("equipment.greatsword");
    expect(attack.definition.attackTags).toEqual([
      "weapon.melee",
      "weapon.two-handed",
    ]);
    // BAB 1 + STR 3 + Weapon Focus 1 − Power Attack 1.
    expect(attack.attack.value).toBe(4);
    // 2d6 + 1.5×STR (4) + Power Attack (3, two-handed).
    expect(attack.damage.formula).toBe("2d6 + 7");
    expect(attack.damage.modifier).toBe(7);
    expect(
      attack.damage.contributions.map((item) => `${item.label}:${item.value}`),
    ).toContain("Power Attack:3");
  });

  it("keeps the two-handed Power Attack variant and explains the others", () => {
    const excluded = derived.attacks[0]!.damage.excluded ?? [];
    expect(excluded).toHaveLength(2);
    expect(excluded.map((item) => item.value).sort()).toEqual([1, 2]);
    expect(
      excluded.find((item) => item.value === 2)?.reason,
    ).toBe("excluded for tags weapon.two-handed, weapon.off-hand");
    expect(excluded.find((item) => item.value === 1)?.reason).toBe(
      "requires tags weapon.off-hand",
    );
  });

  it("builds a full attack through the same action plan as any other sheet", () => {
    const plan = engine.createActionPlan({
      action: "fullAttack",
      attackIds: ["equipment.greatsword"],
    });
    expect(plan.action).toBe("fullAttack");
    // One attack at level 1, so the sequence is the primary step only.
    expect(plan.attacks[0]?.steps).toHaveLength(1);
    expect(plan.attacks[0]?.steps[0]?.role).toBe("primary");
    expect(plan.rolls.length).toBe(2); // the attack roll and its damage roll
  });
});
