import type { CharacterInput } from "@threepointpf/rules-schema";
import { demoCharacter } from "./demo-character";

/**
 * The characters the sheet can start from. A sample is authored state only:
 * every derived fact on the sheet is recomputed from it by the rules engine, so
 * a sample doubles as a compact statement of what the engine can do.
 */

/** Pathfinder's elite array: 15, 14, 13, 12, 10, 8. */
export const eliteArray = {
  str: 15,
  dex: 13,
  con: 14,
  int: 12,
  wis: 10,
  cha: 8,
} as const;

/**
 * Level 1 human fighter on the elite array with the class's iconic kit.
 *
 * The ability scores already include the human +2 (Strength 15 → 17), because
 * the sheet stores final authored scores and never invents a race's adjustment.
 * Power Attack, Weapon Focus and Toughness are its three first-level feats, the
 * greatsword is the curated equipment definition (two-handed profile: 1.5×STR
 * damage), and the chain shirt is its armor. Advancement is authored as one
 * level of the fighter progression, so BAB, saves, class skills and hit dice
 * are all derived rather than typed in.
 */
export const levelOneFighter: CharacterInput = {
  id: "sample-level-1-fighter",
  campaignId: "demo-campaign",
  name: "Level 1 Fighter",
  baseAbilities: { str: 17, dex: 13, con: 14, int: 12, wis: 10, cha: 8 },
  // d10 hit die, maximum at level 1; the Constitution modifier is added by the
  // engine (10 + 2 = 12 HP).
  baseHpBeforeConstitution: 10,
  baseLandSpeed: 30,
  baseSpeeds: { land: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
  baseSize: "medium",
  advancementSlots: [
    {
      id: "slot-1",
      tracks: [
        { id: "track-1", entry: { progressionId: "pf1e.paizo.fighter" } },
      ],
    },
  ],
  // Fighter skill points at level 1: 2 + Intelligence 1 = 3 ranks.
  skillRanks: { climb: 1, intimidate: 1, ride: 1 },
  skills: {
    climb: { governingAbility: "str" },
    intimidate: { governingAbility: "cha" },
    ride: { governingAbility: "dex" },
  },
  attacks: [],
  equipment: [
    {
      id: "greatsword",
      definitionId: "pf1e.paizo.greatsword",
      name: "Greatsword",
      equipped: true,
      effects: [],
    },
    {
      id: "chain-shirt",
      definitionId: "pf1e.autosheet.chain-shirt",
      name: "Chain shirt",
      equipped: true,
      effects: [],
    },
  ],
  features: [
    {
      id: "power-attack",
      definitionId: "pf1e.paizo.power-attack",
      name: "Power Attack",
      enabled: true,
      effects: [],
    },
    {
      id: "weapon-focus",
      name: "Weapon Focus (greatsword)",
      description:
        "Homebrew +1 to attack rolls with the character's chosen weapon. The greatsword is the only melee weapon here, so a melee attack modifier covers it.",
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
      id: "toughness",
      name: "Toughness",
      description: "Homebrew +3 hit points.",
      enabled: true,
      effects: [
        {
          kind: "modifier",
          target: "hp",
          value: 3,
          bonusType: "untyped",
        },
      ],
    },
  ],
  damageTaken: 0,
  temporaryHp: 0,
};

export interface SampleCharacter {
  id: string;
  label: string;
  description: string;
  character: CharacterInput;
}

export const sampleCharacters: SampleCharacter[] = [
  {
    id: "level-1-fighter",
    label: "Level 1 fighter",
    description:
      "Elite-array human fighter: Power Attack, Weapon Focus, Toughness, a greatsword and a chain shirt.",
    character: levelOneFighter,
  },
  {
    id: "showcase",
    label: "Showcase (multi-level)",
    description:
      "The kitchen-sink sheet: rage and heroism toggles, N-track advancement, custom classes, equipment and full-attack plans.",
    character: demoCharacter,
  },
];

/** The sample the sheet opens on, so a first look is a plain, correct sheet. */
export const defaultSampleId = "level-1-fighter";

export function sampleCharacter(id: string): SampleCharacter {
  const found = sampleCharacters.find((sample) => sample.id === id);
  if (!found) throw new Error(`Unknown sample character: ${id}`);
  return found;
}

export function defaultSample(): SampleCharacter {
  return sampleCharacter(defaultSampleId);
}
