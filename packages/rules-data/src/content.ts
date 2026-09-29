import {
  attackProfileCatalogSchema,
  equipmentCatalogSchema,
  equipmentMaterialCatalogSchema,
  featureCatalogSchema,
  movementModes,
  type AbilityCatalog,
  type AttackDefinition,
  type AttackTag,
  type BonusType,
  type Effect,
  type EffectApplicability,
  type EffectTargetId,
  type EquipmentDefinition,
  type FeatureDefinition,
  type FeatureActionRestriction,
  type ProgressionSourceMetadata,
} from "@threepointpf/rules-schema";
import { generatedAutosheetEquipmentCatalog } from "./generated/autosheet-equipment.js";
import { generatedAutosheetEquipmentMaterialCatalog } from "./generated/autosheet-equipment-materials.js";
import { generatedAutosheetAgeCatalog } from "./generated/autosheet-age.js";
import { generatedAutosheetConditionCatalog } from "./generated/autosheet-conditions.js";
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
const coreConditionSource = (id: string, label: string) => ({
  id,
  label,
  content: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Conditions", system: "PF1e", publisher: "Paizo", range: "https://legacy.aonprd.com/coreRuleBook/glossary.html" },
});
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
  stacking?: "additive",
): FeatureDefinition => ({
  id: `pf1e.paizo.${slug}`,
  name,
  effects,
  ...(stacking ? { stacking } : {}),
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
      modifier("initiative", 2, "morale"),
    ],
    104,
    "+2 morale to attack rolls, saves, skill checks, and initiative.",
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
  feature(
    "negative-levels",
    "Negative Level",
    [
      ...attacks(-1),
      ...saves(-1),
      modifier("skill.all", -1, "penalty"),
      modifier("hp", -5, "penalty"),
      modifier("casterLevel", -1, "penalty"),
    ],
    115,
    "One negative level: −1 on attacks, combat maneuvers, saves, skill checks, and caster level; −5 maximum hit points. Ability checks are not separately represented in the workbook formulas.",
    "Main Sheet",
    "additive",
  ),
];
const contextFlagCatalog: Record<string, string[]> = {
  "pf1e.paizo.combat-expertise": ["combat-expertise"],
};
const conditionActionRestrictions: Record<string, FeatureActionRestriction[]> = {
  "pf1e.paizo.dazed": ["noActions"],
  "pf1e.paizo.fascinated": ["noActions"],
  "pf1e.paizo.nauseated": ["moveOnly"],
  "pf1e.paizo.panicked": ["fleeOnly"],
  "pf1e.paizo.paralyzed": ["noPhysicalActions"],
  "pf1e.paizo.staggered": ["oneStandardOrMove"],
  "pf1e.paizo.stunned": ["noActions"],
  "pf1e.paizo.cowering": ["noActions"],
  "pf1e.paizo.grappled": ["noTwoHandedActions"],
};
const conditionDefenseRestrictions = {
  "pf1e.paizo.stunned": ["denyDexterityBonus"],
  "pf1e.paizo.blinded": ["denyDexterityBonus"],
  "pf1e.paizo.cowering": ["denyDexterityBonus", "denyDodgeBonus"],
  "pf1e.paizo.pinned": ["denyDexterityBonus"],
} as const;
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
  ...generatedAutosheetConditionCatalog,
  ...generatedAutosheetAgeCatalog,
  ...Object.fromEntries(Object.entries(conditionActionRestrictions).map(([id, actionRestrictions]) => [id, { ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)[id], actionRestrictions }])),
  ...Object.fromEntries(Object.entries(conditionDefenseRestrictions).map(([id, defenseRestrictions]) => [id, { ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)[id], ...(conditionActionRestrictions[id] ? { actionRestrictions: conditionActionRestrictions[id] } : {}), defenseRestrictions }])),
  "pf1e.paizo.fascinated": {
    ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)["pf1e.paizo.fascinated"],
    actionRestrictions: conditionActionRestrictions["pf1e.paizo.fascinated"],
    description: "Takes no actions other than paying attention; potential or obvious threats can end the effect. Reaction-based skill checks take −4.",
    effects: [
      {
        ...when(modifier("skill.all", -4, "penalty"), { kinds: ["skill"], requiredFlags: ["reaction-check"] }),
        source: {
          id: "pf1e.paizo.condition.fascinated.reaction-check",
          label: "Fascinated reaction check penalty",
          content: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Conditions", system: "PF1e", publisher: "Paizo", range: "https://legacy.aonprd.com/coreRuleBook/glossary.html" },
        },
      },
    ],
  },
  "pf1e.paizo.panicked": {
    ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)["pf1e.paizo.panicked"],
    actionRestrictions: conditionActionRestrictions["pf1e.paizo.panicked"],
    description: "Must flee from danger and cannot take other actions. Spells and spell-like abilities can be marked as fleeing uses in the spell panel. If prevented from fleeing, activate Cowering as appropriate. Drop held items when this condition is activated.",
    dropHeldItemsOnActivation: true,
  },
  "pf1e.paizo.grappled": {
    ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)["pf1e.paizo.grappled"],
    actionRestrictions: conditionActionRestrictions["pf1e.paizo.grappled"],
    description: "Cannot move or take actions that require two hands. Takes −2 on attacks and combat maneuver checks other than grapple or escape-grapple checks. Cannot make attacks of opportunity. Casting a spell or using a spell-like ability requires concentration at DC 10 + grappler's CMB + spell level.",
    effects: [
      ...((generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)["pf1e.paizo.grappled"]?.effects ?? []),
      { ...modifier("attack.melee", -2, "penalty"), source: coreConditionSource("pf1e.paizo.condition.grappled.attack-melee", "Grappled melee attack penalty") },
      { ...modifier("attack.ranged", -2, "penalty"), source: coreConditionSource("pf1e.paizo.condition.grappled.attack-ranged", "Grappled ranged attack penalty") },
      {
        ...when(modifier("cmb", -2, "penalty"), { kinds: ["maneuver"], excludedManeuvers: ["grapple", "escape-grapple"] }),
        source: coreConditionSource("pf1e.paizo.condition.grappled.cmb-penalty", "Grappled CMB penalty"),
      },
      ...movementModes.map((mode) => ({ kind: "multiply" as const, target: `speed.${mode}` as EffectTargetId, factor: 0, source: coreConditionSource(`pf1e.paizo.condition.grappled.speed-${mode}`, `Grappled ${mode} speed restriction`) })),
    ],
  },
  "pf1e.paizo.stunned": { ...(generatedAutosheetConditionCatalog as Record<string, FeatureDefinition>)["pf1e.paizo.stunned"], actionRestrictions: conditionActionRestrictions["pf1e.paizo.stunned"], defenseRestrictions: conditionDefenseRestrictions["pf1e.paizo.stunned"], dropHeldItemsOnActivation: true },
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

/** Additive migration seam from curated features to first-class abilities. */
export const abilityCatalog: AbilityCatalog = Object.fromEntries(
  Object.values(featureCatalog).map((definition) => [definition.id, {
    id: definition.id,
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    activation: "toggleable" as const,
    effects: definition.effects,
    ...(definition.contextFlags ? { contextFlags: definition.contextFlags } : {}),
    ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
    ...(definition.priority !== undefined ? { priority: definition.priority } : {}),
    ...(definition.source ? { source: definition.source } : {}),
  }]),
);

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
  /** Threat range: 20 (omitted) crits only on a natural 20, 19 on 19–20, and so on. */
  threatMinimum?: number,
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
    ...(threatMinimum ? { criticalRange: { minimumNaturalRoll: threatMinimum } } : {}),
    source: equipmentSource,
  },
});
const equipment: EquipmentDefinition[] = [
  weapon("longsword", "Longsword", 1, 8, "standard-melee", 4, 19),
  weapon("greatsword", "Greatsword", 2, 6, "two-handed", 8, 19),
  weapon("dagger", "Dagger", 1, 4, "standard-melee", 1, 19),
  // Rapiers threaten on 18–20; the critical range is authored data, never
  // inferred from the weapon's name.
  weapon("rapier", "Rapier (finesse)", 1, 6, "finesse", 2, 18),
  weapon("light-crossbow", "Light crossbow", 1, 8, "ranged", 4, 19),
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
export const equipmentMaterialCatalog = equipmentMaterialCatalogSchema.parse(generatedAutosheetEquipmentMaterialCatalog);

/** Raw slot codes from Formula References!B38:L39, preserved as authored. */
export const autosheetCompanionWondrousSlots = {
  avian: { name: "Avian", slots: ["2", "3", "5", "6", "8", "9", "10", "12"] },
  "biped-claws-paws": { name: "Biped (claws/paws)", slots: ["2", "3", "4", "5", "6", "8", "9", "10", "12"] },
  "biped-hands": { name: "Biped (hands)", slots: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"] },
  piscine: { name: "Piscine", slots: ["3", "6.1", "9"] },
  "quadruped-claws-paws": { name: "Quadruped (claws/paws)", slots: ["2", "3", "4", "5", "6", "8", "9.1", "10"] },
  "quadruped-hexapod-feet": { name: "Quadruped/Hexapod (feet)", slots: ["2", "3", "4", "5", "6", "8", "9.1", "10"] },
  "quadruped-hooves": { name: "Quadruped (hooves)", slots: ["1", "2", "3", "4", "5", "6", "8", "9.1", "10", "13.2"] },
  "quadruped-squat-body": { name: "Quadruped (squat-body)", slots: ["2", "3", "4", "5", "8", "10"] },
  saurian: { name: "Saurian", slots: ["2", "3", "5", "6", "8", "9.1"] },
  serpentine: { name: "Serpentine", slots: ["2", "3", "9"] },
  verminous: { name: "Verminous", slots: ["3", "9"] },
} as const;
export const autosheetCompanionWondrousSlotsSource = {
  document: "Pathfinder Autosheet v6.2.1",
  sheet: "Formula References",
  range: "B38:L39",
  system: "PF1e",
  category: "Companion creature wondrous item slots",
} as const;
const armorSupplementSource: ProgressionSourceMetadata = {
  ...equipmentSource,
  document: "Pathfinder Ultimate Equipment / PRD",
  range: "https://legacy.aonprd.com/ultimateEquipment/armsAndArmor/armor.html",
};
// Explicit supplements, not guesses made by the importer. Context-specific
// jumping and cover use still need roll-context inputs.
const armorSupplements: Record<
  string,
  { effects?: Effect[]; description: string; containerWeightMultiplier?: number; containerWeightSource?: ProgressionSourceMetadata; source?: ProgressionSourceMetadata }
> = {
  "pf1e.autosheet.handy-haversack": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Handy Haversack", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Always weighs 5 lb, even when filled. Its contents do not add to carrying weight.",
  },
  "pf1e.autosheet.bag-of-holding-i": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Bag of Holding", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Weighs a fixed 15 lb regardless of contents. Contents count toward capacity, but not carrying weight.",
  },
  "pf1e.autosheet.bag-of-holding-ii": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Bag of Holding", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Weighs a fixed 25 lb regardless of contents. Contents count toward capacity, but not carrying weight.",
  },
  "pf1e.autosheet.bag-of-holding-iii": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Bag of Holding", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Weighs a fixed 35 lb regardless of contents. Contents count toward capacity, but not carrying weight.",
  },
  "pf1e.autosheet.bag-of-holding-iv": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Bag of Holding", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Weighs a fixed 60 lb regardless of contents. Contents count toward capacity, but not carrying weight.",
  },
  "pf1e.autosheet.portable-hole": {
    containerWeightMultiplier: 0,
    containerWeightSource: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Portable Hole", system: "PF1e", publisher: "Paizo", category: "Fixed container weight" },
    description: "Its cloth does not accumulate weight when filled. Its contents count toward capacity, but not carrying weight.",
  },
  "pf1e.autosheet.tower-shield": {
    effects: attacks(-2),
    description:
      "Includes the tower shield −2 attack penalty. Choosing total cover is not an automatic numeric bonus.",
  },
  "pf1e.autosheet.agile-breastplate": {
    effects: [
      modifier("skill.climb", 3),
      when(modifier("skill.acrobatics", 3), {
        kinds: ["skill"],
        requiredFlags: ["jump-check"],
      }),
    ],
    description:
      "Climb and jump-only Acrobatics checks use −1 armor check penalty; other Acrobatics checks retain −4.",
  },
  "pf1e.autosheet.agile-half-plate": {
    effects: [
      modifier("skill.climb", 3),
      when(modifier("skill.acrobatics", 3), {
        kinds: ["skill"],
        requiredFlags: ["jump-check"],
      }),
    ],
    description:
      "Climb and jump-only Acrobatics checks use −4 armor check penalty; other Acrobatics checks retain −7. Allows quadruple-speed running.",
  },
  "pf1e.autosheet.armored-kilt": {
    description:
      "Can be attached to one light or medium armor item. The combined armor gains +1 armor bonus and moves up one weight category; attached kilts do not function with heavy armor.",
  },
  "pf1e.autosheet.buckler": {
    effects: [
      when(modifier("attack.melee", -1, "penalty"), { kinds: ["attack"], requiredFlags: ["buckler-arm-used"] }),
      when(modifier("attack.ranged", -1, "penalty"), { kinds: ["attack"], requiredFlags: ["buckler-arm-used"] }),
    ],
    description: "Using the buckler arm to wield a weapon gives −1 on that attack and removes the buckler AC bonus until your next turn.",
    source: { document: "Pathfinder Core Rulebook (PRD)", sheet: "Buckler", system: "PF1e", publisher: "Paizo", category: "Buckler hand use", range: "https://legacy.aonprd.com/coreRuleBook/equipment.html" },
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
          ...(item.id === "pf1e.autosheet.armored-kilt" ? { weight: 10 } : {}),
          ...(supplement ? { description: supplement.description } : {}),
          ...(supplement?.containerWeightMultiplier !== undefined ? { containerWeightMultiplier: supplement.containerWeightMultiplier } : {}),
          ...(supplement?.containerWeightSource ? { containerWeightSource: supplement.containerWeightSource } : {}),
          effects: [
            ...item.effects,
            ...(supplement?.effects ?? []).map((effect) => ({
              ...effect,
              source: {
                id: `equipment-rule.${item.id}`,
                label: `${item.name} special rule`,
                content: supplement?.source ?? armorSupplementSource,
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
