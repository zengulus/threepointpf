import {
  parseProgressionCatalog,
  parseSkillCatalog,
  experienceCatalogSchema,
  spellCatalogSchema,
  type ProgressionAliasMap,
  type ProgressionCatalog,
  type ProgressionDefinition,
  type SkillCatalog,
  type SkillDefinition,
} from "@threepointpf/rules-schema";
import {
  abilityCatalog,
  attackFromProfile,
  attackProfileCatalog,
  autosheetEquipmentCatalog,
  equipmentCatalog,
  featureCatalog,
} from "./content.js";
import { generatedAutosheetProgressionCatalog } from "./generated/autosheet-progressions.js";
import { generatedAutosheetSkillCatalog } from "./generated/autosheet-skills.js";
import { generatedAutosheetExperienceCatalog } from "./generated/autosheet-experience.js";

/**
 * Validated PF1e chassis data generated from the supplied Autosheet workbook.
 * Rules-core receives this catalog from its caller and never imports it.
 */
export const autosheetProgressionCatalog: ProgressionCatalog =
  parseProgressionCatalog(generatedAutosheetProgressionCatalog);

/** Default catalog for the PF1e Autosheet-backed application boundary. */
export const progressionCatalog = autosheetProgressionCatalog;

/**
 * Historical short ids accepted by application persistence and normalized to
 * the source-qualified ids in `progressionCatalog`.
 */
export const progressionAliases: ProgressionAliasMap = Object.fromEntries(
  Object.values(progressionCatalog).flatMap((definition) =>
    (definition.aliases ?? []).map((alias) => [alias, definition.id] as const),
  ),
);

/** Validated skill facts imported alongside class-skill membership. */
export const autosheetSkillCatalog: SkillCatalog = parseSkillCatalog(
  generatedAutosheetSkillCatalog,
);

export const skillCatalog = autosheetSkillCatalog;
export const experienceCatalog = experienceCatalogSchema.parse(
  generatedAutosheetExperienceCatalog,
);

/** Small curated examples for the spellcasting foundation, not a full rules corpus. */
export const spellCatalog = spellCatalogSchema.parse({
  "sample.magic-missile": { id: "sample.magic-missile", name: "Magic Missile", description: "Force darts strike their targets automatically.", school: "evocation", levels: [{ spellListId: "arcane", level: 1 }], castingTime: { action: "standard" }, components: ["verbal", "somatic"], range: "close", target: "up to five creatures", duration: "instantaneous", savingThrow: { result: "none" }, spellResistance: true, source: { document: "Curated foundation examples", sheet: "sample spell set", system: "PF1e-compatible" } },
  "sample.fireball": { id: "sample.fireball", name: "Fireball", description: "A burst of fire deals damage in an area.", school: "evocation", levels: [{ spellListId: "arcane", level: 3 }], castingTime: { action: "standard" }, components: ["verbal", "somatic", "material"], range: "long", area: "20-foot-radius spread", duration: "instantaneous", savingThrow: { save: "reflex", result: "half" }, spellResistance: true, execution: { damage: { dice: { count: 1, sides: 6 }, damageType: "fire", perCasterLevel: true, casterLevelCap: 10 } }, source: { document: "Curated foundation examples", sheet: "sample spell set", system: "PF1e-compatible" } },
  "sample.cure-light-wounds": { id: "sample.cure-light-wounds", name: "Cure Light Wounds", description: "Positive energy heals a living target.", school: "conjuration", descriptors: ["healing"], levels: [{ spellListId: "divine", level: 1 }], castingTime: { action: "standard" }, components: ["verbal", "somatic"], range: "touch", target: "creature touched", duration: "instantaneous", savingThrow: { result: "harmless" }, spellResistance: false, source: { document: "Curated foundation examples", sheet: "sample spell set", system: "PF1e-compatible" } },
  "sample.detect-magic": { id: "sample.detect-magic", name: "Detect Magic", description: "Sense the presence of magic.", school: "divination", levels: [{ spellListId: "arcane", level: 0 }, { spellListId: "divine", level: 0 }], castingTime: { action: "standard" }, components: ["verbal", "somatic"], range: "60 feet", area: "cone-shaped emanation", duration: "concentration, up to 1 minute/level", savingThrow: { result: "none" }, spellResistance: false, source: { document: "Curated foundation examples", sheet: "sample spell set", system: "PF1e-compatible" } },
});

/** The application-level composition root; rules semantics remain catalog-free. */
export const rulesCatalogs = {
  progressionCatalog,
  skillCatalog,
  featureCatalog,
  abilityCatalog,
  equipmentCatalog,
  attackProfileCatalog,
  experienceCatalog,
  spellCatalog,
};

export function progressionOptions(
  catalog: ProgressionCatalog = progressionCatalog,
): ProgressionDefinition[] {
  return Object.values(catalog);
}

export function skillOptions(
  catalog: SkillCatalog = skillCatalog,
): SkillDefinition[] {
  return Object.values(catalog);
}

export {
  abilityCatalog,
  attackFromProfile,
  attackProfileCatalog,
  autosheetEquipmentCatalog,
  equipmentCatalog,
  featureCatalog,
};
