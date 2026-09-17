import {
  attackProfileCatalogSchema,
  equipmentCatalogSchema,
  featureCatalogSchema,
  movementModes,
  type AttackDefinition,
  type AttackTag,
  type BonusType,
  type Effect,
  type EffectApplicability,
  type EffectTargetId,
  type EquipmentDefinition,
  type FeatureDefinition,
  type ProgressionSourceMetadata,
} from "@threepointpf/rules-schema";
import { generatedAutosheetEquipmentCatalog } from "./generated/autosheet-equipment.js";
import { generatedAutosheetAgeCatalog } from "./generated/autosheet-age.js";
import { generatedAutosheetAttackProfileCatalog } from "./generated/autosheet-attacks.js";

const workbook = (
  sheet: string,
  row: number,
  range: string,
): ProgressionSourceMetadata => ({
  document: "Pathfinder Autosheet v6.2.1",
  sheet,
  row,
  range,
  system: "PF1e",
});
const modifier = (
  target: Exclude<EffectTargetId, "ac">,
  value: number,
  bonusType: BonusType = "untyped",
): Effect => ({ kind: "modifier", target, value, bonusType });
const ac = (
  value: number,
  bonusType: BonusType,
  touch = true,
  flat = true,
): Effect => ({
  kind: "modifier",
  target: "ac",
  value,
  bonusType,
  appliesTo: [
    "normal",
    ...(touch ? ["touch" as const] : []),
    ...(flat ? ["flatFooted" as const] : []),
  ],
});
const saves = (value: number, type: BonusType = "penalty"): Effect[] =>
  ["fortitude", "reflex", "will"].map((id) =>
    modifier(`save.${id}` as EffectTargetId & `save.${string}`, value, type),
  );
const attacks = (value: number, type: BonusType = "penalty"): Effect[] => [
  modifier("attack.melee", value, type),
  modifier("attack.ranged", value, type),
  modifier("cmb", value, type),
];
const halfSpeed: Effect[] = movementModes.map((mode) => ({
  kind: "multiply",
  target: `speed.${mode}`,
  factor: 0.5,
}));
const babStep = { kind: "babStep", every: 4, base: 1 } as const;
const scaled = (effect: Effect): Effect =>
  effect.kind === "modifier" ? { ...effect, scaling: babStep } : effect;
/**
 * Declares when an effect applies instead of requiring duplicate static
 * targets. `appliesWhen` is evaluated against the roll context: attack or roll
 * kind, melee/ranged, touch, full-attack membership, weapon tags, maneuvers and
 * situational flags.
 */
/** Only non-AC modifiers accept situational applicability. */
const when = <T extends Effect>(
  effect: T,
  appliesWhen: EffectApplicability,
): T => ({ ...effect, appliesWhen }) as T;
const rangedNonTouch: EffectApplicability = { modes: ["ranged"], touch: false };
const rangedFullAttack: EffectApplicability = {
  ...rangedNonTouch,
  fullAttack: true,
};
const fullAttackOnly: EffectApplicability = { fullAttack: true };
const combatExpertiseAttack: EffectApplicability = {
  modes: ["melee"],
  requiredFlags: ["combat-expertise"],
};
const combatExpertiseManeuver: EffectApplicability = {
  requiredFlags: ["combat-expertise"],
};
const sightBased: EffectApplicability = {
  kinds: ["skill"],
  requiredFlags: ["sight-based"],
};
const twoHanded: AttackTag[] = ["weapon.two-handed"];
const offHand: AttackTag[] = ["weapon.off-hand"];
const feature = (
  slug: string,
  name: string,
  effects: Effect[],
  row: number,
  description: string,
  sheet = "Formula References",
): FeatureDefinition => ({
  id: `pf1e.paizo.${slug}`,
  name,
  effects,
  description,
  source: workbook(
    sheet,
    row,
    sheet === "Main Sheet" ? `B${row}:AQ${row}` : `A${row}:U${row}`,
  ),
});
const features: FeatureDefinition[] = [
  feature(
    "power-attack",
    "Power Attack",
    [
      scaled(modifier("attack.melee", -1)),
      scaled(modifier("cmb", -1)),
      scaled(
        when(
          {
            kind: "modifier",
            target: "damage.melee",
            value: 2,
            bonusType: "untyped",
          },
          { modes: ["melee"], excludedTags: [...twoHanded, ...offHand] },
        ),
      ),
      scaled(
        when(
          {
            kind: "modifier",
            target: "damage.melee",
            value: 3,
            bonusType: "untyped",
          },
          { modes: ["melee"], requiredTags: twoHanded, excludedTags: offHand },
        ),
      ),
      scaled(
        when(
          {
            kind: "modifier",
            target: "damage.melee",
            value: 1,
            bonusType: "untyped",
          },
          { modes: ["melee"], requiredTags: offHand },
        ),
      ),
    ],
    101,
    "BAB-scaled melee attack penalty and damage tradeoff; the weapon's own tags select one-/two-handed/off-hand damage, and one-handed use is excluded from the two-handed and off-hand cases. Melee only, so ranged and touch attacks exclude it with a visible reason.",
    "Main Sheet",
  ),
  feature(
    "combat-expertise",
    "Combat Expertise",
    [
      scaled(when(modifier("attack.melee", -1), combatExpertiseAttack)),
      scaled(when(modifier("cmb", -1), combatExpertiseManeuver)),
      // The dodge AC bonus is a sheet fact; CMD now consumes it semantically.
      // The attack/CMB tradeoff is situational and gated on the flag this
      // feature contributes.
      scaled(ac(1, "dodge", true, false)),
    ],
    102,
    "BAB-scaled melee penalty and dodge defense bonus; CMD derives its dodge bonus from AC. Activate when using the combat option.",
    "Main Sheet",
  ),
  feature(
    "deadly-aim",
    "Deadly Aim",
    [
      scaled(when(modifier("attack.ranged", -1), rangedNonTouch)),
      scaled(when(modifier("damage.ranged", 2), rangedNonTouch)),
    ],
    103,
    "BAB-scaled ranged attack penalty and damage bonus. Touch attacks (rays and touch spells) are excluded by the roll context rather than by duplicating targets.",
    "Main Sheet",
  ),
  feature(
    "heroism",
    "Heroism",
    [
      ...attacks(2, "morale"),
      ...saves(2, "morale"),
      modifier("skill.all", 2, "morale"),
    ],
    104,
    "+2 morale to attack rolls, saves, and skill checks.",
    "Main Sheet",
  ),
  feature(
    "haste",
    "Haste",
    [
      // CMD consumes this dodge bonus and the AC penalty rules semantically.
      ac(1, "dodge", true, false),
      modifier("save.reflex", 1, "untyped"),
      ...attacks(1, "untyped"),
      ...movementModes.map(
        (mode): Effect => ({
          kind: "modifier",
          target: `speed.${mode}`,
          value: 30,
          bonusType: "enhancement",
          capToBase: true,
        }),
      ),
      // Action-level extras: one shared extra attack for the whole full-attack
      // action, never one per weapon and never on a standard attack.
      when(modifier("attacks.extra.melee", 1, "enhancement"), fullAttackOnly),
      when(modifier("attacks.extra.ranged", 1, "enhancement"), fullAttackOnly),
    ],
    105,
    "+1 attacks, Reflex and dodge AC; speed increases by up to 30 feet, at most the intrinsic speed. Grants one extra attack to the full-attack action as a whole (attached to the primary weapon), not one per weapon.",
    "Main Sheet",
  ),
  feature(
    "rapid-shot",
    "Rapid Shot",
    [
      when(modifier("attack.ranged", -2), rangedFullAttack),
      when(modifier("attacks.extra.ranged", 1), rangedFullAttack),
    ],
    106,
    "Full-attack ranged option: one additional attack at highest bonus and −2 to all ranged attacks. Applies only inside a ranged, non-touch full attack.",
    "Main Sheet",
  ),
  feature(
    "dazzled",
    "Dazzled",
    [
      ...attacks(-1),
      // Contextual rather than universal: the penalty reaches a Perception roll
      // only when that roll carries the `sight-based` flag.
      when(
        modifier("skill.perception", -1, "penalty"),
        sightBased,
      ),
      {
        kind: "grant",
        target: "skill.perception",
        grant: "minus-1-sight-based-perception",
      },
    ],
    243,
    "−1 attack rolls. −1 to sight-based Perception only: the flag-driven modifier applies when a Perception roll is made with the sight-based flag, and the ordinary sheet total stays unpenalized.",
  ),
  feature(
    "deafened",
    "Deafened",
    [
      modifier("initiative", -4, "penalty"),
      { kind: "grant", target: "skill.perception", grant: "cannot-hear" },
      {
        kind: "grant",
        target: "skill.perception",
        grant: "minus-4-opposed-perception",
      },
    ],
    244,
    "−4 initiative; hearing-based checks fail. Perception is contextual, so it is not penalized universally.",
  ),
  feature(
    "entangled",
    "Entangled",
    [
      modifier("ability.dex", -4, "penalty"),
      ...attacks(-2),
      ...halfSpeed,
      { kind: "grant", target: "speed.land", grant: "cannot-run-or-charge" },
    ],
    245,
    "−4 Dexterity, −2 attacks, half speed; cannot run or charge.",
  ),
  feature(
    "exhausted",
    "Exhausted",
    [
      modifier("ability.str", -6, "penalty"),
      modifier("ability.dex", -6, "penalty"),
      ...halfSpeed,
      { kind: "grant", target: "speed.land", grant: "cannot-run-or-charge" },
    ],
    246,
    "−6 Strength and Dexterity, half speed. Replaces Fatigued; enable only the stronger condition.",
  ),
  feature(
    "fatigued",
    "Fatigued",
    [
      modifier("ability.str", -2, "penalty"),
      modifier("ability.dex", -2, "penalty"),
      { kind: "grant", target: "speed.land", grant: "cannot-run-or-charge" },
    ],
    248,
    "−2 Strength and Dexterity; cannot run or charge.",
  ),
  feature(
    "frightened",
    "Frightened",
    [
      ...saves(-2),
      ...attacks(-2),
      modifier("skill.all", -2, "penalty"),
      modifier("initiative", -2, "penalty"),
      { kind: "grant", target: "speed.land", grant: "must-flee" },
    ],
    249,
    "−2 attacks, saves, skills and ability checks (including initiative); must flee. Select the current fear severity; repeated exposure is not automatically adjudicated.",
  ),
  feature(
    "shaken",
    "Shaken",
    [
      ...saves(-2),
      ...attacks(-2),
      modifier("skill.all", -2, "penalty"),
      modifier("initiative", -2, "penalty"),
    ],
    257,
    "−2 attacks, saves, skills and ability checks (including initiative).",
  ),
  feature(
    "sickened",
    "Sickened",
    [
      ...saves(-2),
      ...attacks(-2),
      modifier("damage.melee", -2, "penalty"),
      modifier("damage.ranged", -2, "penalty"),
      modifier("skill.all", -2, "penalty"),
      modifier("initiative", -2, "penalty"),
    ],
    258,
    "−2 attacks, weapon damage, saves, skills and ability checks (including initiative).",
  ),
  feature(
    "staggered",
    "Staggered",
    [
      {
        kind: "grant",
        target: "speed.land",
        grant: "single-move-or-standard-action",
      },
    ],
    259,
    "One move action or standard action per round.",
  ),
  feature(
    "dazed",
    "Dazed",
    [{ kind: "grant", target: "initiative", grant: "cannot-act" }],
    242,
    "Cannot take actions; defenses do not automatically change.",
  ),
  feature(
    "nauseated",
    "Nauseated",
    [{ kind: "grant", target: "initiative", grant: "move-action-only" }],
    252,
    "Only a single move action each turn.",
  ),
];
const contextFlagCatalog: Record<string, string[]> = {
  "pf1e.paizo.combat-expertise": ["combat-expertise"],
};
const severity: Record<string, { exclusiveGroup: string; priority: number }> = {
  "pf1e.paizo.fatigued": {
    exclusiveGroup: "pf1e.condition.fatigue",
    priority: 1,
  },
  "pf1e.paizo.exhausted": {
    exclusiveGroup: "pf1e.condition.fatigue",
    priority: 2,
  },
  "pf1e.paizo.shaken": { exclusiveGroup: "pf1e.condition.fear", priority: 1 },
  "pf1e.paizo.frightened": {
    exclusiveGroup: "pf1e.condition.fear",
    priority: 2,
  },
};
export const featureCatalog = featureCatalogSchema.parse({
  ...generatedAutosheetAgeCatalog,
  ...Object.fromEntries(
    features.map((item) => [
      item.id,
      {
        ...item,
        ...severity[item.id],
        ...(contextFlagCatalog[item.id]
          ? { contextFlags: contextFlagCatalog[item.id] }
          : {}),
      },
    ]),
  ),
});

export const attackProfileCatalog = attackProfileCatalogSchema.parse(
  generatedAutosheetAttackProfileCatalog,
);

// The Equipment tab is character inventory. Formula References supplies the
// generated armor catalog; the starter weapons/magic items below are PRD data.
const equipmentSource: ProgressionSourceMetadata = {
  document: "Pathfinder Core Rulebook / PRD",
  sheet: "Equipment",
  system: "PF1e",
  publisher: "Paizo",
  range: "https://legacy.aonprd.com/coreRulebook/equipment.html",
};
const weapon = (
  slug: string,
  name: string,
  count: number,
  sides: number,
  profileSlug: string,
  weight: number,
): EquipmentDefinition => ({
  id: `pf1e.paizo.${slug}`,
  name,
  kind: "weapon",
  effects: [],
  weight,
  source: equipmentSource,
  attack: {
    id: slug,
    name,
    attackAbility: "str",
    baseDamage: { count, sides },
    profileId: `pf1e.autosheet.${profileSlug}`,
    source: equipmentSource,
  },
});
const equipment: EquipmentDefinition[] = [
  weapon("longsword", "Longsword", 1, 8, "standard-melee", 4),
  weapon("greatsword", "Greatsword", 2, 6, "two-handed", 8),
  weapon("dagger", "Dagger", 1, 4, "standard-melee", 1),
  weapon("rapier", "Rapier (finesse)", 1, 6, "finesse", 2),
  weapon("light-crossbow", "Light crossbow", 1, 8, "ranged", 4),
  weapon("javelin", "Javelin", 1, 6, "thrown", 2),
  {
    id: "pf1e.paizo.heavy-steel-shield",
    name: "Heavy steel shield",
    kind: "shield",
    effects: [ac(2, "shield", false)],
    armorCheckPenalty: -2,
    weight: 15,
    source: equipmentSource,
  },
  {
    id: "pf1e.paizo.ring-of-protection-1",
    name: "Ring of protection +1",
    kind: "wondrous",
    // CMD derives its deflection bonus from this AC effect; no duplicate
    // hand-authored CMD effect is needed.
    effects: [ac(1, "deflection")],
    source: {
      ...equipmentSource,
      sheet: "Magic Items: Rings",
      range:
        "https://legacy.aonprd.com/coreRulebook/magicItems/rings.html#ring-of-protection",
    },
  },
  {
    id: "pf1e.paizo.cloak-of-resistance-1",
    name: "Cloak of resistance +1",
    kind: "wondrous",
    effects: saves(1, "resistance"),
    source: {
      ...equipmentSource,
      sheet: "Magic Items: Wondrous Items",
      range:
        "https://legacy.aonprd.com/coreRulebook/magicItems/wondrousItems.html#cloak-of-resistance",
    },
  },
  {
    id: "pf1e.paizo.amulet-of-natural-armor-1",
    name: "Amulet of natural armor +1",
    kind: "wondrous",
    effects: [modifier("ac.natural", 1, "enhancement")],
    source: {
      ...equipmentSource,
      sheet: "Magic Items: Wondrous Items",
      range:
        "https://legacy.aonprd.com/coreRulebook/magicItems/wondrousItems.html#amulet-of-natural-armor",
    },
  },
];
export const autosheetEquipmentCatalog = equipmentCatalogSchema.parse(
  generatedAutosheetEquipmentCatalog,
);
const armorSupplementSource: ProgressionSourceMetadata = {
  ...equipmentSource,
  document: "Pathfinder Ultimate Equipment / PRD",
  range: "https://legacy.aonprd.com/ultimateEquipment/armsAndArmor/armor.html",
};
// Explicit supplements, not guesses made by the importer. Context-specific
// jumping/cover/buckler-hand use remain notes until roll contexts exist.
const armorSupplements: Record<
  string,
  { effects?: Effect[]; description: string }
> = {
  "pf1e.autosheet.tower-shield": {
    effects: attacks(-2),
    description:
      "Includes the tower shield −2 attack penalty. Choosing total cover is not an automatic numeric bonus.",
  },
  "pf1e.autosheet.agile-breastplate": {
    effects: [modifier("skill.climb", 3)],
    description:
      "Climb uses −1 armor check penalty. Jump-only checks also use −1; apply that exception manually (other Acrobatics checks retain −4).",
  },
  "pf1e.autosheet.agile-half-plate": {
    effects: [modifier("skill.climb", 3)],
    description:
      "Climb uses −4 armor check penalty. Jump-only checks also use −4; apply that exception manually. Allows quadruple-speed running.",
  },
  "pf1e.autosheet.armored-kilt": {
    description:
      "Standalone chassis. Attaching a kilt to other armor requires a custom combined item; do not equip both expecting attachment rules.",
  },
  "pf1e.autosheet.buckler": {
    description:
      "Passive equipped shield bonus. Off-hand attacks, two-handed weapon use, and loss of the bonus require a contextual adjustment.",
  },
};
export const equipmentCatalog = equipmentCatalogSchema.parse({
  ...Object.fromEntries(
    Object.values(autosheetEquipmentCatalog).map((item) => {
      const supplement = armorSupplements[item.id];
      return [
        item.id,
        {
          ...item,
          ...(supplement ? { description: supplement.description } : {}),
          effects: [
            ...item.effects,
            ...(supplement?.effects ?? []).map((effect) => ({
              ...effect,
              source: {
                id: `equipment-rule.${item.id}`,
                label: `${item.name} special rule`,
                content: armorSupplementSource,
              },
            })),
          ],
        },
      ];
    }),
  ),
  ...Object.fromEntries(equipment.map((item) => [item.id, item])),
});

/** Resolve the profile into ordinary authored attack fields for custom weapons. */
export function attackFromProfile(
  profileId: string,
  attack: Pick<AttackDefinition, "id" | "name" | "baseDamage">,
): AttackDefinition {
  const entry = attackProfileCatalog[profileId];
  if (!entry) throw new Error(`Unknown attack profile ${profileId}`);
  return { ...attack, attackAbility: entry.attackAbility, profileId };
}
