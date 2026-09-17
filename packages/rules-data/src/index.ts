import {
  parseProgressionCatalog,
  parseSkillCatalog,
  experienceCatalogSchema,
  type ProgressionAliasMap,
  type ProgressionCatalog,
  type ProgressionDefinition,
  type SkillCatalog,
  type SkillDefinition,
} from "@threepointpf/rules-schema";
import {
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

/** The application-level composition root; rules semantics remain catalog-free. */
export const rulesCatalogs = {
  progressionCatalog,
  skillCatalog,
  featureCatalog,
  equipmentCatalog,
  attackProfileCatalog,
  experienceCatalog,
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
  attackFromProfile,
  attackProfileCatalog,
  autosheetEquipmentCatalog,
  equipmentCatalog,
  featureCatalog,
};
