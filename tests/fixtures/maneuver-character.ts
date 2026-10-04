import type { CharacterInput } from "@threepointpf/rules-schema";

/** Minimal, synthetic maneuver fixture, independent of any player's sheet. */
export const maneuverCharacter: CharacterInput = {
  id: "test-maneuver-character", name: "Maneuver Test Character", campaignId: "test-campaign",
  baseAbilities: { str: 16, dex: 12, con: 14, int: 12, wis: 10, cha: 10 },
  baseHpBeforeConstitution: 24, baseLandSpeed: 30, baseSize: "medium",
  advancementSlots: [1, 2, 3].map((level) => ({ id: `level-${level}`, tracks: [{ id: "main", entry: { progressionId: "pf1e.paizo.fighter" } }] })),
  skillRanks: {}, skills: {}, equipment: [], features: [], damageTaken: 0, temporaryHp: 0,
  attacks: [{ id: "test-blade", name: "Test blade", mode: "melee", attackAbility: "str", damageAbility: "str", baseDamage: { count: 1, sides: 8 }, attackTags: ["weapon.melee"] }],
  systems: [{ id: "test-maneuvers", kind: "maneuvers", name: "Test Maneuvers", progressionId: "pf1e.paizo.fighter", keyAbility: "int", resourceName: "Readied maneuvers", resourceSpent: 0,
    progression: [{ level: 3, casterLevel: 3, maximumTier: 2, resourceMaximum: 4 }],
    entries: [
      { id: "test-stance-one", name: "Test stance one", category: "Stance", actionCost: "swift", known: true },
      { id: "test-stance-two", name: "Test stance two", category: "Stance", actionCost: "swift", known: true },
      { id: "test-strike", name: "Test strike", category: "Strike", actionCost: "standard", known: true, readied: false, tier: 1, roll: { kind: "weaponAttack", attackId: "test-blade" } },
      { id: "test-boost", name: "Test boost", category: "Boost", actionCost: "swift", known: true, readied: false, active: false, tier: 1, effects: [
        { kind: "modifier", target: "attack.melee", value: 2, bonusType: "profane", appliesWhen: { kinds: ["attack"], modes: ["melee"] } },
        { kind: "damageDice", target: "damage.melee", dice: { count: 1, sides: 6 }, damageType: "profane", label: "Test boost", criticalBehavior: "normal", appliesWhen: { modes: ["melee"] } },
        { kind: "modifier", target: "ac", value: -2, bonusType: "untyped", appliesTo: ["normal", "touch", "flatFooted", "deniedDexterity"] },
      ] },
    ],
  }],
};
