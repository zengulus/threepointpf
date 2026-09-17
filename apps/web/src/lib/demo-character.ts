import type { CharacterInput } from "@threepointpf/rules-schema";

export const demoCharacter: CharacterInput = {
  id: "human-martial",
  campaignId: "demo-campaign",
  name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 },
  baseHpBeforeConstitution: 50,
  hitDiceCount: 1,
  damageTaken: 5,
  temporaryHp: 0,
  baseLandSpeed: 30,
  baseSpeeds: { land: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
  baseSize: "medium",
  skillRanks: { acrobatics: 2, perception: 3, intimidate: 0 },
  skills: {
    acrobatics: { governingAbility: "dex", classSkillOverride: true },
    perception: { governingAbility: "wis" },
  },
  attacks: [
    {
      id: "greatsword",
      name: "Greatsword",
      attackAbility: "str",
      damageAbility: "str",
      damageAbilityMultiplier: 1.5,
      baseDamage: { count: 2, sides: 6 },
      attackTags: ["weapon.melee", "weapon.two-handed"],
      mode: "melee",
    },
  ],
  equipment: [],
  features: [
    {
      id: "weapon-focus",
      name: "Weapon Focus",
      description: "A focused martial attack.",
      enabled: true,
      effects: [
        {
          kind: "modifier",
          target: "attack.melee",
          value: 1,
          bonusType: "untyped",
        },
      ],
    },
    {
      id: "heroism",
      definitionId: "pf1e.paizo.heroism",
      name: "Heroism",
      enabled: true,
      effects: [],
    },
    {
      id: "rage",
      name: "Rage",
      description: "A combat toggle affecting the whole dependency graph.",
      enabled: false,
      effects: [
        {
          kind: "modifier",
          target: "ability.str",
          value: 4,
          bonusType: "morale",
        },
        {
          kind: "modifier",
          target: "ability.con",
          value: 4,
          bonusType: "morale",
        },
        {
          kind: "modifier",
          target: "ac",
          value: -2,
          bonusType: "untyped",
          appliesTo: ["normal", "touch", "flatFooted"],
        },
      ],
    },
  ],
};
