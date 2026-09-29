import { describe, expect, it, vi } from "vitest";
import { resolveRollPlan } from "@threepointpf/dice";
import { RulesEngine, concentrationRollPlan, spellLikeConcentrationRollPlan } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput } from "@threepointpf/rules-schema";
import { createCharacterRollPlan, rollPlanRequestSchema } from "@threepointpf/shared";
import { hostedActionForPlan, recordHostedRoll } from "../apps/web/src/lib/hosted-roll";

const character: CharacterInput = {
  id: "hosted-test", name: "Hosted Hero",
  baseAbilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 8 },
  baseBab: 3, baseSaves: { fortitude: 3, reflex: 1, will: 0 },
  baseHpBeforeConstitution: 16, hitDiceCount: 1, skillRanks: {},
  attacks: [{ id: "sword", name: "Sword", attackAbility: "str", damageAbility: "str",
    baseDamage: { count: 1, sides: 8 }, attackTags: ["weapon.melee"], mode: "melee" }],
  features: [], damageTaken: 0, temporaryHp: 0,
};

describe("hosted sheet roll boundary", () => {
  it("maps ordinary plans to strict server intents and rejects synthetic dice", () => {
    const engine = new RulesEngine(character, rulesCatalogs);
    const save = engine.createSaveRollPlan("fortitude", { defense: { kind: "dc", value: 17 } });
    const attack = engine.createAttackRollPlan("sword", 0, { defense: { kind: "ac", value: 14 } });
    const damage = engine.createDamageRollPlan("sword");
    const criticalDamage = engine.createDamageRollPlan("sword", { criticalDamage: true });
    const skill = engine.createSkillRollPlan("acrobatics", { defense: { kind: "dc", value: 15 } });
    const maneuver = engine.createManeuverRollPlan("trip", { defense: { kind: "cmd", value: 18 } });
    const initiative = engine.createInitiativeRollPlan();
    expect(hostedActionForPlan(character, save)).toMatchObject({ kind: "save", saveId: "fortitude" });
    expect(hostedActionForPlan(character, attack)).toMatchObject({ kind: "attack", attackId: "sword" });
    expect(hostedActionForPlan(character, damage)).toMatchObject({ kind: "damage", attackId: "sword" });
    expect(hostedActionForPlan(character, criticalDamage)).toMatchObject({ kind: "damage", criticalDamage: true });
    expect(hostedActionForPlan(character, skill)).toMatchObject({ kind: "skill", skillId: "acrobatics" });
    expect(hostedActionForPlan(character, maneuver)).toMatchObject({ kind: "maneuver", maneuver: "trip" });
    expect(hostedActionForPlan(character, initiative)).toMatchObject({ kind: "initiative" });
    expect(() => hostedActionForPlan(character, { ...attack, dice: [{ sides: 20, count: 20 }] })).toThrow(/server roll definition/);
  });

  it("recovers a lost response with the same request body", async () => {
    const plan = new RulesEngine(character, rulesCatalogs).createSaveRollPlan("will");
    const result = resolveRollPlan(plan, [17]);
    const payload = { version: 1, rollId: "recorded", characterId: character.id,
      clientRequestId: "server-id", characterName: character.name, characterRevision: 3,
      createdAt: new Date().toISOString(), plan, result, delivery: { state: "pending" } };
    const request = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 201 }));
    const recorded = await recordHostedRoll(character, plan, 3, request);
    expect(recorded.result).toEqual(result);
    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0]![1] as RequestInit;
    const second = request.mock.calls[1]![1] as RequestInit;
    expect(first.body).toBe(second.body);
    expect(JSON.parse(String(first.body))).toMatchObject({ expectedRevision: 3, action: { kind: "save", saveId: "will" } });
  });

  it("rebuilds concentration from an owned casting source or spell-like ability", () => {
    const caster: CharacterInput = {
      ...character,
      spellcastingSources: [{ id: "arcane", name: "Arcane", mode: "spontaneous", castingAbility: "int",
        spellListId: "arcane", spellListAccess: "list", bonusSlots: "none", knownSpellIds: [],
        progression: [{ level: 1, casterLevel: 1, maximumSpellLevel: 1, slots: { "1": 1 } }] }],
      abilities: [{ id: "innate", name: "Innate", activation: "activated", effects: [], spellLike: true, spellId: "sample.spell" }],
    };
    const engine = new RulesEngine(caster, rulesCatalogs);
    const sourcePlan = concentrationRollPlan(engine, "arcane", 18);
    const sourceAction = hostedActionForPlan(caster, sourcePlan);
    expect(sourceAction).toMatchObject({ kind: "concentration", sourceId: "arcane", defense: { kind: "dc", value: 18 } });
    expect(createCharacterRollPlan(caster, sourceAction, rulesCatalogs)).toEqual(sourcePlan);

    const abilityPlan = spellLikeConcentrationRollPlan(engine, "innate");
    const abilityAction = hostedActionForPlan(caster, abilityPlan);
    expect(abilityAction).toMatchObject({ kind: "concentration", abilityId: "innate" });
    expect(createCharacterRollPlan(caster, abilityAction, rulesCatalogs)).toEqual(abilityPlan);

    expect(() => rollPlanRequestSchema.parse({ characterId: caster.id, kind: "concentration", sourceId: "arcane", abilityId: "innate" })).toThrow();
    expect(() => rollPlanRequestSchema.parse({ characterId: caster.id, kind: "concentration", sourceId: "arcane", skillId: "acrobatics" })).toThrow();
    expect(() => createCharacterRollPlan(caster, { characterId: caster.id, kind: "concentration", sourceId: "unknown" }, rulesCatalogs)).toThrow();
    expect(() => hostedActionForPlan(caster, { ...sourcePlan, modifier: sourcePlan.modifier + 5 })).toThrow(/server roll definition/);
  });
});
