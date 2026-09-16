import {
  parseProgressionCatalog,
  type ProgressionCatalog,
  type ProgressionDefinition,
} from "@threepointpf/rules-schema";

/**
 * Chassis facts transcribed from `INGEST THIS - Pathfinder Autosheet
 * (v6.2.1).xlsx`, `Class Charts`, columns A:H.  The source sheet has no
 * usable class-feature rows, and its spell columns intentionally stay out of
 * this non-spellcasting advancement catalog.
 */
const autosheetBaseClassRows = {
  fighter: {
    id: "fighter",
    name: "Fighter",
    hitDieSides: 10,
    babProgression: "full",
    saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
    skillPointsPerLevel: 2,
    source: { document: "Pathfinder Autosheet v6.2.1", sheet: "Class Charts", category: "Base", row: 10, range: "A10:H10" },
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    hitDieSides: 8,
    babProgression: "threeQuarters",
    saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" },
    skillPointsPerLevel: 8,
    source: { document: "Pathfinder Autosheet v6.2.1", sheet: "Class Charts", category: "Base", row: 19, range: "A19:H19" },
  },
  wizard: {
    id: "wizard",
    name: "Wizard",
    hitDieSides: 6,
    babProgression: "half",
    saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" },
    skillPointsPerLevel: 2,
    source: { document: "Pathfinder Autosheet v6.2.1", sheet: "Class Charts", category: "Base", row: 26, range: "A26:H26" },
  },
} satisfies ProgressionCatalog;

/**
 * Validated content boundary. Rules-core imports no class corpus; callers
 * deliberately pass this catalog (or a campaign-specific one) to the engine.
 */
export const autosheetProgressionCatalog: ProgressionCatalog = parseProgressionCatalog(autosheetBaseClassRows);

/** Default catalog for the PF1e Autosheet-backed application boundary. */
export const progressionCatalog = autosheetProgressionCatalog;

export function progressionOptions(catalog: ProgressionCatalog = progressionCatalog): ProgressionDefinition[] {
  return Object.values(catalog);
}
