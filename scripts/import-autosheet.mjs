#!/usr/bin/env node
/**
 * Deterministically imports class chassis, standard class spell progressions,
 * and class-skill facts in the supplied Pathfinder Autosheet. The workbook is development
 * input only: this script emits static rules-data source files and never runs
 * in the browser or rules engine.
 *
 * We intentionally read SheetJS's cached formula values and never evaluate a
 * workbook formula.  Class Skills uses cached X markers extensively, including
 * formulas that rely on spreadsheet-only REGEXMATCH functions.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import XLSX from "xlsx";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const inputRelativePath = "INGEST THIS - Pathfinder Autosheet (v6.2.1).xlsx";
const inputPath = path.join(repositoryRoot, inputRelativePath);
const generatedDirectory = path.join(
  repositoryRoot,
  "packages/rules-data/src/generated",
);
const progressionOutputPath = path.join(
  generatedDirectory,
  "autosheet-progressions.ts",
);
const skillOutputPath = path.join(generatedDirectory, "autosheet-skills.ts");
const equipmentOutputPath = path.join(
  generatedDirectory,
  "autosheet-equipment.ts",
);
const equipmentMaterialOutputPath = path.join(generatedDirectory, "autosheet-equipment-materials.ts");
const reportOutputPath = path.join(
  generatedDirectory,
  "autosheet-import-report.json",
);

// Load the actual current schema without a pre-existing dist build. Only the
// repository TypeScript is transpiled; workbook cells never become code.
const schemaPath = path.join(
  repositoryRoot,
  "packages/rules-schema/src/index.ts",
);
const schemaRequire = createRequire(schemaPath);
const schemaCode = ts
  .transpileModule(await readFile(schemaPath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace(
    'from "zod"',
    `from ${JSON.stringify(pathToFileURL(schemaRequire.resolve("zod")).href)}`,
  );
const schemas = await import(
  `data:text/javascript;base64,${Buffer.from(schemaCode).toString("base64")}`
);

const documentName = "Pathfinder Autosheet v6.2.1";
const classChartsSheetName = "Class Charts";
const classSkillsSheetName = "Class Skills";
const expectedClassChartHeaders = [
  "HD",
  "BAB",
  "Fort",
  "Ref",
  "Will",
  "Skills",
];
const expectedClassSkillsSections = new Set([
  "BASE CLASSES",
  "NPC CLASSES",
  "HYBRID CLASSES CLASSES",
  "OCCULT CLASSES",
  "MONSTROUS HD",
  "PRESTIGE CLASSES",
  "3PP CLASSES",
  "3PP PSIONICS",
  "3PP PATH OF WAR",
  "HOMEBREW AND SHIT",
]);

// These two Paizo progressions have a class-skills list in their published
// rules, but no matching scoped row in this workbook's Class Skills sheet.
// Keep the supplement closed and explicitly sourced; never infer by name.
const publishedClassSkillSupplements = {
  "pf1e.paizo.mystery-cultist": {
    ids: ["diplomacy", "heal", "intimidate", "knowledge-planes", "knowledge-religion", "sense-motive", "spellcraft"],
    consolidatedIds: ["consolidated-influence", "consolidated-survival", "consolidated-religion", "consolidated-perception", "consolidated-spellcraft"],
    source: { document: "Chronicle of the Righteous", sheet: "Mystery Cultist class skills", system: "PF1e", publisher: "Paizo", category: "Paizo Prestige" },
  },
  "pf1e.paizo.sentinel": {
    ids: ["climb", "craft", "handle-animal", "intimidate", "knowledge-religion", "perception", "profession", "ride", "survival", "swim"],
    consolidatedIds: ["consolidated-acrobatics", "consolidated-athletics", "consolidated-influence", "consolidated-nature", "consolidated-perception", "consolidated-religion", "consolidated-survival"],
    source: { document: "Inner Sea Gods", sheet: "Sentinel class skills", system: "PF1e", publisher: "Paizo", category: "Paizo Prestige" },
  },
};

/**
 * Keep the import boundary visible in the generated report.  This importer is
 * deliberately narrow: the workbook also contains character-instance data,
 * specialized magic systems and spreadsheet formula references which need
 * separate explicit mappings.
 */
const workbookSheetUsage = {
  "Welcome Page": {
    importStatus: "partial",
    reason: "Spreadsheet-only copy, color, gridline, and linked-document instructions are excluded; skill and optional-rule controls are mapped to character options, with relevant operating guidance adapted for the shared web app.",
  },
  "Main Sheet": {
    importStatus: "partial",
    reason:
      "Character-instance cells are not imported. Reviewed quick-toggle semantics are authored in src/content.ts with cell provenance.",
  },
  Equipment: {
    importStatus: "partial",
    reason:
      "Character inventory rows remain character-owned; the worn-slot capacity reference and magical storage item weight/capacity table are imported from the workbook.",
    semanticRows: "G5:G6,Q10:Q22,CR3:CT10",
  },
  "Spells, Spheres and other stuff": {
    importStatus: "partial",
    reason:
      "Class-linked Psionics and FFd20 progressions and the Spheres of Power/Might category lists are imported into character-owned system sources; specialized talent corpora and remaining system mechanics still need explicit mappings.",
  },
  "Class Charts": {
    importStatus: "imported",
    reason:
      "Class chassis, recognized prepared/spontaneous PF1e spell tables, Psionics charts, and FFd20 MP/spells-known tables are imported with provenance.",
    semanticRows: "3:295,312:492,518:538,541:632",
  },
  "Class Skills": {
    importStatus: "imported",
    reason:
      "Classic class-skill membership and skill metadata are imported from the bounded semantic region.",
    semanticRows: "1:278",
  },
  "Formula References": {
    importStatus: "partial",
    reason:
      "Age adjustments, XP thresholds, size adjustments and carrying-capacity multipliers, ability-based attack profiles, armor/shield chassis and compatible material adjustments, numeric condition modifiers, and the bonus-type reference are generated. Main Sheet quick toggles and additional PRD equipment supplements are reviewed declarative content in src/content.ts. Context-dependent special material notes and remaining spreadsheet formulas are not executed.",
      semanticRows: "4:29,28:34,37:39,45:61,96:110,114:134,138:146,149:232,237:268",
  },
  Changelog: {
    importStatus: "excluded",
    reason: "Workbook release history, not rules content.",
  },
};

/**
 * A deliberately explicit source map protects us from workbook layout quirks:
 * Region 8 is duplicated in the source and the generic third-party block
 * interleaves Akashic and martial rows.
 */
function sourceInfoFor(classChartRow, category) {
  if (
    ["Base", "Hybrid", "Occult", "Monstrous", "Paizo Prestige", "NPC"].includes(
      category,
    )
  ) {
    return {
      namespace: "pf1e.paizo",
      system: "PF1e",
      publisher: "Paizo",
      classSkillsSection: {
        Base: "BASE CLASSES",
        Hybrid: "HYBRID CLASSES CLASSES",
        Occult: "OCCULT CLASSES",
        Monstrous: "MONSTROUS HD",
        "Paizo Prestige": "PRESTIGE CLASSES",
        NPC: "NPC CLASSES",
      }[category],
      heading: {
        Base: "Paizo Base Classes (Core, APG, UM, UC, UI, UW, Unchained)",
        Hybrid: "Advanced Class Guide",
        Occult: "Occult Adventures",
        Monstrous: "Monstrous HD (Bestiary)",
        "Paizo Prestige": "Paizo Prestige Classes",
        NPC: "Non Player Character Classes (Core)",
      }[category],
    };
  }

  if (category === "SoP Classes") {
    return {
      namespace: "pf1e.3pp.spheres-of-power",
      system: "PF1e",
      classSkillsSection: "3PP CLASSES",
      heading: "3PP Classes",
    };
  }
  if (category === "SoM Classes") {
    return {
      namespace: "pf1e.3pp.spheres-of-might",
      system: "PF1e",
      classSkillsSection: "3PP CLASSES",
      heading: "3PP Classes",
    };
  }
  if (category === "CotS Classes") {
    return {
      namespace: "pf1e.3pp.champions-of-the-spheres",
      system: "PF1e",
      classSkillsSection: "3PP CLASSES",
      heading: "3PP Classes",
    };
  }
  if (category === "Akashic Classes") {
    return {
      namespace: "pf1e.3pp.akashic",
      system: "PF1e",
      classSkillsSection: "3PP CLASSES",
      heading: "3PP Classes",
    };
  }
  if (category === "3PP-Martial") {
    if (classChartRow <= 214) {
      return {
        namespace: "pf1e.3pp.martial",
        system: "PF1e",
        classSkillsSection: "3PP CLASSES",
        heading: "3PP Classes",
      };
    }
    return {
      namespace: "pf1e.dreamscarred-press.path-of-war",
      system: "PF1e",
      publisher: "Dreamscarred Press",
      classSkillsSection: "3PP PATH OF WAR",
      heading:
        'Martial Classes (3rd Party Publisher - Dreamscarred Press "Path of War")',
    };
  }
  if (category === "3PP-Psionics") {
    return {
      namespace: "pf1e.dreamscarred-press.psionics",
      system: "PF1e",
      publisher: "Dreamscarred Press",
      classSkillsSection: "3PP PSIONICS",
      heading:
        'Psionic Classes (3rd Party Publisher - Dreamscarred Press "Ultimate Psionics" and "Psionics Expanded")',
    };
  }
  if (category === "FFd20") {
    return {
      namespace: "ffd20.autosheet",
      system: "FFd20",
      classSkillsSection: "HOMEBREW AND SHIT",
      heading: "Other",
    };
  }
  if (category === "Other") {
    return {
      namespace: "pf1e.autosheet",
      system: "PF1e",
      classSkillsSection: "HOMEBREW AND SHIT",
      heading: "Other",
    };
  }
  throw new Error(
    `No stable namespace/class-skills source mapping for Class Charts category ${JSON.stringify(category)} at row ${classChartRow}`,
  );
}

const classSkillColumns = {
  B: "acrobatics",
  C: "appraise",
  D: "bluff",
  E: "climb",
  F: "craft",
  G: "craft",
  H: "diplomacy",
  I: "disable-device",
  J: "disguise",
  K: "escape-artist",
  L: "fly",
  M: "handle-animal",
  N: "heal",
  O: "intimidate",
  P: "knowledge-arcana",
  Q: "knowledge-dungeoneering",
  R: "knowledge-engineering",
  S: "knowledge-geography",
  T: "knowledge-history",
  U: "knowledge-local",
  V: "knowledge-nature",
  W: "knowledge-nobility",
  X: "knowledge-planes",
  Y: "knowledge-religion",
  Z: "linguistics",
  AA: "perception",
  AB: "perform",
  AC: "perform",
  AD: "profession",
  AE: "profession",
  AF: "ride",
  AG: "sense-motive",
  AH: "sleight-of-hand",
  AI: "spellcraft",
  AJ: "stealth",
  AK: "survival",
  AL: "swim",
  AM: "use-magic-device",
  AP: "artistry",
  AQ: "lore",
  BG: "autohypnosis",
  BH: "knowledge-psionics",
};

const contextualClassSkillColumns = {
  "OCCULT CLASSES": { AN: "autohypnosis", AO: "knowledge-psionics" },
  "3PP CLASSES": { AN: "autohypnosis", AO: "knowledge-psionics" },
  "3PP PSIONICS": { AN: "autohypnosis", AO: "knowledge-psionics" },
  "3PP PATH OF WAR": { AN: "knowledge-martial" },
};

const consolidatedSkillColumns = {
  AS: "consolidated-acrobatics", AT: "consolidated-athletics",
  AU: "consolidated-finesse", AV: "consolidated-influence",
  AW: "consolidated-nature", AX: "consolidated-perception",
  AY: "consolidated-performance", AZ: "consolidated-religion",
  BA: "consolidated-society", BB: "consolidated-spellcraft",
  BC: "consolidated-stealth", BD: "consolidated-survival",
};
const alternateConsolidatedColumns = new Set(Object.keys(consolidatedSkillColumns));
const intentionallyCustomColumns = new Set(["AN", "AO"]);

const skillDefinitions = [
  ["acrobatics", "Acrobatics", "dex", false, true],
  ["appraise", "Appraise", "int", false, false],
  ["bluff", "Bluff", "cha", false, false],
  ["climb", "Climb", "str", false, true],
  ["craft", "Craft", "int", false, false],
  ["diplomacy", "Diplomacy", "cha", false, false],
  ["disable-device", "Disable Device", "dex", true, true],
  ["disguise", "Disguise", "cha", false, false],
  ["escape-artist", "Escape Artist", "dex", false, true],
  ["fly", "Fly", "dex", false, true],
  ["handle-animal", "Handle Animal", "cha", true, false],
  ["heal", "Heal", "wis", false, false],
  ["intimidate", "Intimidate", "cha", false, false],
  ["knowledge-arcana", "Knowledge (Arcana)", "int", true, false],
  ["knowledge-dungeoneering", "Knowledge (Dungeoneering)", "int", true, false],
  ["knowledge-engineering", "Knowledge (Engineering)", "int", true, false],
  ["knowledge-geography", "Knowledge (Geography)", "int", true, false],
  ["knowledge-history", "Knowledge (History)", "int", true, false],
  ["knowledge-local", "Knowledge (Local)", "int", true, false],
  ["knowledge-nature", "Knowledge (Nature)", "int", true, false],
  ["knowledge-nobility", "Knowledge (Nobility)", "int", true, false],
  ["knowledge-planes", "Knowledge (Planes)", "int", true, false],
  ["knowledge-religion", "Knowledge (Religion)", "int", true, false],
  ["linguistics", "Linguistics", "int", true, false],
  ["perception", "Perception", "wis", false, false],
  ["perform", "Perform", "cha", false, false],
  ["profession", "Profession", "wis", true, false],
  ["ride", "Ride", "dex", false, true],
  ["sense-motive", "Sense Motive", "wis", false, false],
  ["sleight-of-hand", "Sleight of Hand", "dex", true, true],
  ["spellcraft", "Spellcraft", "int", true, false],
  ["stealth", "Stealth", "dex", false, true],
  ["survival", "Survival", "wis", false, false],
  ["swim", "Swim", "str", false, true],
  ["use-magic-device", "Use Magic Device", "cha", true, false],
  ["artistry", "Artistry", "int", false, false],
  ["lore", "Lore", "int", true, false],
  ["autohypnosis", "Autohypnosis", "wis", true, false],
  ["knowledge-psionics", "Knowledge (Psionics)", "int", true, false],
  ["knowledge-martial", "Knowledge (Martial)", "int", true, false],
  ["knowledge-technology", "Knowledge (Technology)", "int", true, false],
  ["repair", "Repair", "int", false, false],
];

function cellValue(sheet, column, row) {
  return sheet[`${column}${row}`]?.v;
}

function cellFormula(sheet, column, row) {
  return sheet[`${column}${row}`]?.f;
}

function asText(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}

function asInteger(value, description) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(
      `${description} must be an integer, received ${JSON.stringify(value)}`,
    );
  return parsed;
}

function normalizeName(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function slug(value) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized)
    throw new Error(
      `Could not make a stable slug from ${JSON.stringify(value)}`,
    );
  return normalized;
}

function babProgressionFor(value, row) {
  const numeric = Number(value);
  if (numeric === 1) return "full";
  if (numeric === 0.75) return "threeQuarters";
  if (numeric === 0.5) return "half";
  if (numeric === 0.25) return "quarter";
  throw new Error(
    `Unsupported BAB multiplier ${JSON.stringify(value)} in Class Charts row ${row}`,
  );
}

function saveProgressionFor(value, row, column) {
  const map = {
    Good: "good",
    Poor: "poor",
    "Prestige Good": "prestigeGood",
    "Prestige Poor": "prestigePoor",
  };
  const progression = map[asText(value)];
  if (!progression)
    throw new Error(
      `Unsupported ${column} save progression ${JSON.stringify(value)} in Class Charts row ${row}`,
    );
  return progression;
}

function saveAt(progression, level) {
  switch (progression) {
    case "good":
      return 2 + Math.floor(level / 2);
    case "poor":
      return Math.floor(level / 3);
    case "prestigeGood":
      return Math.floor((level + 1) / 2);
    case "prestigePoor":
      return Math.floor((level + 1) / 3);
    default:
      throw new Error(`Unknown save progression ${progression}`);
  }
}

function babAt(progression, level) {
  switch (progression) {
    case "full":
      return level;
    case "threeQuarters":
      return Math.floor(level * 0.75);
    case "half":
      return Math.floor(level * 0.5);
    case "quarter":
      return Math.floor(level * 0.25);
    default:
      throw new Error(`Unknown BAB progression ${progression}`);
  }
}

function sourceMetadata({ sheet, category, row, range, sourceInfo }) {
  return {
    document: documentName,
    sheet,
    system: sourceInfo.system,
    ...(sourceInfo.publisher ? { publisher: sourceInfo.publisher } : {}),
    category,
    row,
    range,
  };
}

const spellSlotColumns = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
const spellKnownColumns = ["O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"];

function chartAnchor(reference) {
  const match = /^\$?([A-Z]{1,2})\$?(\d+)$/i.exec(asText(reference) ?? "");
  return match ? { column: match[1].toUpperCase(), row: Number(match[2]) } : undefined;
}

function tableCount(value, description) {
  const text = asText(value);
  if (!text || text === "—" || text === "-") return 0;
  if (text === "∞") return "unlimited";
  return asInteger(value, description);
}

function spellcastingTemplateForRow(sheet, record) {
  const ability = asText(cellValue(sheet, "I", record.row))?.toLowerCase();
  const slotAnchor = chartAnchor(cellValue(sheet, "J", record.row));
  const knownValue = asText(cellValue(sheet, "K", record.row));
  if (!ability || !["int", "wis", "cha"].includes(ability) || !slotAnchor || slotAnchor.column !== "A") return undefined;
  const slotRow = slotAnchor.row;
  if (!asText(cellValue(sheet, slotAnchor.column, slotRow))?.toLowerCase().includes("level (character")) return undefined;

  const knownAnchor = chartAnchor(knownValue);
  const knownStartColumn = knownAnchor ? XLSX.utils.decode_col(knownAnchor.column) : undefined;
  const knownLevelColumn = knownStartColumn === undefined ? undefined : XLSX.utils.encode_col(knownStartColumn - 1);
  const spellbookClasses = new Set(["alchemist", "arcanist", "investigator", "magus", "witch", "wizard"]);
  const isSpellbookClass = spellbookClasses.has(record.name.toLocaleLowerCase("en-US"));
  const spellListAccess = knownValue === "Spellbook" || isSpellbookClass ? "spellbook" : "list";
  const mode = spellListAccess === "spellbook" || knownValue === "Divine" ? "prepared" : "spontaneous";
  const knownRow = mode === "spontaneous" ? knownAnchor?.row : undefined;
  if (knownValue === "Special" || (!knownRow && knownValue !== "Spellbook" && knownValue !== "Divine" && !isSpellbookClass)) return undefined;
  const divineNames = new Set(["oracle", "inquisitor"]);
  const spellListId = knownValue === "Divine" || divineNames.has(record.name.toLocaleLowerCase("en-US")) ? "divine" : "arcane";
  const sourceId = `${record.id}.spellcasting`;
  const progressionId = `${record.id}.spellcasting-table`;
  const progression = [];
  for (let offset = 1; offset <= 20; offset += 1) {
    const level = asInteger(cellValue(sheet, "A", slotRow + offset), `Class Charts A${slotRow + offset}`);
    if (level < 1 || level > 20) continue;
    const slots = {};
    const unlimitedSpellLevels = [];
    for (let spellLevel = 0; spellLevel < spellSlotColumns.length; spellLevel += 1) {
      const value = tableCount(cellValue(sheet, spellSlotColumns[spellLevel], slotRow + offset), `Class Charts ${spellSlotColumns[spellLevel]}${slotRow + offset}`);
      if (value === "unlimited") unlimitedSpellLevels.push(spellLevel);
      else if (value > 0) slots[String(spellLevel)] = value;
    }
    const spellsKnown = {};
    if (knownRow && knownStartColumn !== undefined && knownLevelColumn) {
      const knownLevel = asInteger(cellValue(sheet, knownLevelColumn, knownRow + offset), `Class Charts ${knownLevelColumn}${knownRow + offset}`);
      if (knownLevel !== level) throw new Error(`Class Charts known-spell level mismatch for ${record.name} at level ${level}`);
      for (let spellLevel = 0; spellLevel < spellKnownColumns.length; spellLevel += 1) {
        const column = XLSX.utils.encode_col(knownStartColumn + spellLevel);
        const value = tableCount(cellValue(sheet, column, knownRow + offset), `Class Charts ${column}${knownRow + offset}`);
        if (typeof value === "number" && value > 0) spellsKnown[String(spellLevel)] = value;
      }
    }
    slots["0"] ??= 0;
    const maximumSpellLevel = Math.max(0, ...Object.entries(slots).filter(([spellLevel, count]) => Number(spellLevel) > 0 && count > 0).map(([spellLevel]) => Number(spellLevel)), ...Object.entries(spellsKnown).filter(([spellLevel, count]) => Number(spellLevel) > 0 && count > 0).map(([spellLevel]) => Number(spellLevel)));
    progression.push({ level, casterLevel: level, maximumSpellLevel, slots, ...(Object.keys(spellsKnown).length ? { spellsKnown } : {}), ...(unlimitedSpellLevels.length ? { unlimitedSpellLevels } : {}) });
  }
  if (!progression.length) return undefined;
  const tableRange = knownRow && knownLevelColumn ? `; ${knownLevelColumn}${knownRow}:X${knownRow + 20}` : "";
  const metadata = sourceMetadata({ sheet: classChartsSheetName, category: record.category, row: record.row, range: `I${record.row}:K${record.row}; A${slotRow}:K${slotRow + 20}${tableRange}`, sourceInfo: record.sourceInfo });
  return { sourceId, progressionId, name: record.name, mode, castingAbility: ability, spellListId, spellListAccess, bonusSlots: "standard", progression, source: metadata };
}

function characterSystemTemplatesForRow(sheet, record) {
  const ability = asText(cellValue(sheet, "I", record.row))?.toLowerCase();
  const poolAnchor = chartAnchor(cellValue(sheet, "J", record.row));
  const knownAnchor = chartAnchor(cellValue(sheet, "K", record.row));
  const tierAnchor = chartAnchor(cellValue(sheet, "L", record.row));
  if (record.category === "FFd20" && ability && ["int", "wis", "cha"].includes(ability) && poolAnchor?.row === 541 && knownAnchor && [546, 568, 590, 612].includes(knownAnchor.row)) {
    const poolRow = ({ B: 543, C: 542, D: 544 })[poolAnchor.column];
    if (!poolRow) return [];
    const levels = [];
    const knownStart = XLSX.utils.decode_col(knownAnchor.column);
    for (let level = 1; level <= 20; level += 1) {
      const resourceColumn = XLSX.utils.encode_col(level);
      const resourceMaximum = tableCount(cellValue(sheet, resourceColumn, poolRow), `Class Charts ${resourceColumn}${poolRow}`);
      if (typeof resourceMaximum !== "number") throw new Error(`Invalid FFd20 magic-point progression for ${record.name} at level ${level}`);
      const knownByTier = {};
      for (let tier = 0; tier <= 9; tier += 1) {
        const column = XLSX.utils.encode_col(knownStart + tier);
        const value = tableCount(cellValue(sheet, column, knownAnchor.row + level), `Class Charts ${column}${knownAnchor.row + level}`);
        if (typeof value !== "number") throw new Error(`Invalid FFd20 spells-known progression for ${record.name} at tier ${tier}, level ${level}`);
        if (value > 0) knownByTier[String(tier)] = value;
      }
      const maximumTier = Math.max(0, ...Object.keys(knownByTier).map(Number));
      levels.push({ level, casterLevel: level, maximumTier, resourceMaximum, knownCount: Object.values(knownByTier).reduce((sum, value) => sum + value, 0), ...(Object.keys(knownByTier).length ? { knownByTier } : {}) });
    }
    const source = sourceMetadata({ sheet: classChartsSheetName, category: record.category, row: record.row, range: `I${record.row}:K${record.row}; A541:U544; ${knownAnchor.column}${knownAnchor.row}:K${knownAnchor.row + 20}`, sourceInfo: record.sourceInfo });
    return [{ id: `${record.id}.ffd20`, kind: "ffd20", name: record.name, progressionId: record.id, keyAbility: ability, resourceName: "Magic points", progression: levels, source }];
  }
  if (!ability || !["int", "wis", "cha"].includes(ability) || !poolAnchor || !knownAnchor || !tierAnchor) return [];
  if (poolAnchor.row !== 518 || knownAnchor.row !== 518 || tierAnchor.row !== 518) return [];
  const levels = [];
  for (let level = 1; level <= 20; level += 1) {
    const pool = tableCount(cellValue(sheet, poolAnchor.column, poolAnchor.row + level), `Class Charts ${poolAnchor.column}${poolAnchor.row + level}`);
    const known = tableCount(cellValue(sheet, knownAnchor.column, knownAnchor.row + level), `Class Charts ${knownAnchor.column}${knownAnchor.row + level}`);
    const tierValue = asText(cellValue(sheet, tierAnchor.column, tierAnchor.row + level));
    const maximumTier = tierValue && tierValue !== "—" ? Number(/^\d+/.exec(tierValue)?.[0] ?? tierValue) : 0;
    if (typeof pool !== "number" || typeof known !== "number" || !Number.isInteger(maximumTier) || maximumTier < 0) throw new Error(`Invalid psionic chart values for ${record.name} at level ${level}`);
    const resourceBonusByAbility = {};
    for (let modifier = 0; modifier <= 15; modifier += 1) {
      const column = XLSX.utils.encode_col(23 + level);
      const bonus = tableCount(cellValue(sheet, column, 519 + modifier), `Class Charts ${column}${519 + modifier}`);
      if (typeof bonus !== "number") throw new Error(`Invalid Psionics bonus power point chart at modifier ${modifier}, level ${level}`);
      resourceBonusByAbility[String(modifier)] = bonus;
    }
    levels.push({ level, casterLevel: level, maximumTier, resourceMaximum: pool, resourceBonusByAbility, knownCount: known });
  }
  const source = sourceMetadata({ sheet: classChartsSheetName, category: record.category, row: record.row, range: `I${record.row}:L${record.row}; B518:L538; G518:K538; O518:R538`, sourceInfo: record.sourceInfo });
  return [{ id: `${record.id}.psionics`, kind: "psionics", name: record.name, progressionId: record.id, keyAbility: ability, resourceName: "Power points", progression: levels, source }];
}

function parseClassCharts(sheet) {
  const rows = [];
  const failures = [];
  for (let row = 1; row <= 295; row += 1) {
    const category = asText(cellValue(sheet, "A", row));
    const name = asText(cellValue(sheet, "B", row));
    const values = ["C", "D", "E", "F", "G", "H"].map((column) =>
      cellValue(sheet, column, row),
    );
    if (
      !category ||
      !name ||
      values.some(
        (value) => value === undefined || value === null || value === "",
      )
    )
      continue;

    try {
      const hitDieSides = asInteger(values[0], `Class Charts C${row}`);
      const skillPointsPerLevel = asInteger(values[5], `Class Charts H${row}`);
      if (hitDieSides <= 0 || skillPointsPerLevel < 0)
        throw new Error(
          "hit die must be positive and skill points must be non-negative",
        );
      const sourceInfo = sourceInfoFor(row, category);
      const babProgression = babProgressionFor(values[1], row);
      const saveProgressions = {
        fortitude: saveProgressionFor(values[2], row, "Fort"),
        reflex: saveProgressionFor(values[3], row, "Ref"),
        will: saveProgressionFor(values[4], row, "Will"),
      };
      const usesPrestigeChart = Object.values(saveProgressions).some((value) =>
        value.startsWith("prestige"),
      );
      const maximumLevel = usesPrestigeChart
        ? asInteger(cellValue(sheet, "L", row), `Class Charts L${row}`)
        : undefined;
      if (maximumLevel !== undefined && maximumLevel <= 0)
        throw new Error("prestige maximum level must be positive");
      const id = `${sourceInfo.namespace}.${slug(name)}`;
      const record = {
        row,
        category,
        name,
        id,
        sourceInfo,
        hitDieSides,
        skillPointsPerLevel,
        babProgression,
        saveProgressions,
        maximumLevel,
      };
      const spellcastingTemplate = spellcastingTemplateForRow(sheet, record);
      const characterSystemTemplates = characterSystemTemplatesForRow(sheet, record);
      rows.push({ ...record, ...(spellcastingTemplate ? { spellcastingTemplate } : {}), ...(characterSystemTemplates.length ? { characterSystemTemplates } : {}) });
    } catch (error) {
      failures.push({
        row,
        category,
        name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (failures.length)
    throw new Error(
      `Class Charts import failures:\n${failures.map((failure) => `row ${failure.row}: ${failure.reason}`).join("\n")}`,
    );
  return rows;
}

function parseClassSkillRows(sheet) {
  /** @type {Map<string, { row: number, name: string, section: string, prose?: string }>} */
  const byScopedName = new Map();
  let section;
  for (let row = 1; row <= 278; row += 1) {
    const name = asText(cellValue(sheet, "A", row));
    if (!name) continue;
    if (expectedClassSkillsSections.has(name)) {
      section = name;
      continue;
    }
    if (!section) continue;
    const key = `${section}\u0000${normalizeName(name)}`;
    if (byScopedName.has(key))
      throw new Error(
        `Duplicate Class Skills name ${name} in section ${section}`,
      );
    const prose = asText(cellValue(sheet, "AR", row));
    byScopedName.set(key, { row, name, section, ...(prose ? { prose } : {}) });
  }
  return byScopedName;
}

function classSkillIdsForRow(sheet, entry) {
  const ids = new Set();
  const unsupportedColumns = [];
  const alternateMarkers = [];
  const consolidatedIds = [];
  const contextual = contextualClassSkillColumns[entry.section] ?? {};
  for (const column of Object.keys(classSkillColumns)) {
    if (asText(cellValue(sheet, column, entry.row)) === "X")
      ids.add(classSkillColumns[column]);
  }
  for (const [column, id] of Object.entries(contextual)) {
    if (asText(cellValue(sheet, column, entry.row)) === "X") ids.add(id);
  }
  for (const column of alternateConsolidatedColumns) {
    if (asText(cellValue(sheet, column, entry.row)) === "X")
      { alternateMarkers.push(column); consolidatedIds.push(consolidatedSkillColumns[column]); }
  }
  for (const column of intentionallyCustomColumns) {
    if (
      !contextual[column] &&
      asText(cellValue(sheet, column, entry.row)) === "X"
    )
      unsupportedColumns.push(column);
  }

  // A small, closed supplement set handles skill names present only in the
  // prose declaration column.  Do not attempt to parse arbitrary prose.
  const proseSupplements = [];
  const prose = entry.prose?.toLocaleLowerCase("en-US") ?? "";
  if (/knowledge\s*\(\s*martial\s*\)/.test(prose))
    proseSupplements.push("knowledge-martial");
  if (/knowledge\s*\([^)]*\btechnology\b[^)]*\)/.test(prose))
    proseSupplements.push("knowledge-technology");
  if (/\brepair\s*\(/.test(prose)) proseSupplements.push("repair");
  for (const id of proseSupplements) ids.add(id);

  return {
    ids: [...ids].sort(),
    consolidatedIds: consolidatedIds.sort(),
    unsupportedColumns,
    alternateMarkers,
    proseSupplements,
    nameWasFormula: Boolean(cellFormula(sheet, "A", entry.row)),
  };
}

function makeProgressionChart(record) {
  if (!record.maximumLevel) return undefined;
  return Array.from({ length: record.maximumLevel }, (_, index) => {
    const level = index + 1;
    return {
      level,
      bab: babAt(record.babProgression, level),
      saves: Object.fromEntries(
        Object.entries(record.saveProgressions).map(([save, progression]) => [
          save,
          saveAt(progression, level),
        ]),
      ),
    };
  });
}

function buildSkillCatalog(sheet, warnings) {
  const source = {
    document: documentName,
    sheet: classSkillsSheetName,
    system: "PF1e",
    category: "Classic skill metadata",
    row: 1,
    range: "B1:BH4",
  };
  const catalog = Object.fromEntries(
    skillDefinitions.map(
      ([id, name, fallbackAbility, fallbackTrained, fallbackArmor]) => {
        const column = Object.keys(classSkillColumns).find(
          (key) => classSkillColumns[key] === id,
        );
        if (!column) {
          warnings.push({
            kind: "supplemental-skill-metadata",
            skillId: id,
            source: { sheet: classSkillsSheetName, range: "AR5:AR278" },
            message:
              "Skill appears only in scoped class descriptions. Ability/training metadata is an explicit normalized supplement, not a header extraction.",
          });
          return [
            id,
            {
              id,
              name,
              governingAbility: fallbackAbility,
              ...(fallbackTrained ? { trainedOnly: true } : {}),
              ...(fallbackArmor ? { armorCheckPenalty: true } : {}),
              source: {
                ...source,
                category: "Normalized prose supplement",
                range: "AR5:AR278",
              },
            },
          ];
        }
        const governingAbility = asText(
          cellValue(sheet, column, 3),
        )?.toLowerCase();
        if (
          !["str", "dex", "con", "int", "wis", "cha"].includes(governingAbility)
        )
          throw new Error(`Unknown skill ability at ${column}3`);
        const trainedMarker = asText(cellValue(sheet, column, 2));
        const armorMarker = asText(cellValue(sheet, column, 4));
        if (trainedMarker && trainedMarker !== "Trained Only")
          throw new Error(`Unknown trained-only marker at ${column}2`);
        if (armorMarker && !["Armor Penalty", "X"].includes(armorMarker))
          throw new Error(`Unknown armor-penalty marker at ${column}4`);
        return [
          id,
          {
            id,
            name,
            governingAbility,
            ...(trainedMarker ? { trainedOnly: true } : {}),
            ...(armorMarker ? { armorCheckPenalty: true } : {}),
            source: { ...source, range: `${column}1:${column}4` },
          },
        ];
      },
    ),
  );
  for (const [column, id] of Object.entries(consolidatedSkillColumns)) {
    const name = asText(cellValue(sheet, column, 1));
    const governingAbility = asText(cellValue(sheet, column, 3))?.toLowerCase();
    if (!name || !["str", "dex", "con", "int", "wis", "cha"].includes(governingAbility))
      throw new Error(`Invalid consolidated skill metadata at ${column}1:${column}3`);
    const trainedMarker = asText(cellValue(sheet, column, 2));
    const armorMarker = asText(cellValue(sheet, column, 4));
    if (trainedMarker && trainedMarker !== "Trained Only") throw new Error(`Unknown trained-only marker at ${column}2`);
    if (armorMarker && !["Armor Penalty", "X"].includes(armorMarker)) throw new Error(`Unknown armor-penalty marker at ${column}4`);
    catalog[id] = {
      id, name, governingAbility, system: "consolidated",
      ...(trainedMarker ? { trainedOnly: true } : {}),
      ...(armorMarker ? { armorCheckPenalty: true } : {}),
      source: { ...source, category: "Consolidated skill metadata", range: `${column}1:${column}4` },
    };
  }
  return catalog;
}

function buildEquipmentCatalog(sheet, inventorySheet, warnings, unsupported) {
  if (
    !sheet ||
    cellValue(sheet, "B", 149) !== "AC Bonus" ||
    cellValue(sheet, "C", 149) !== "Max Dex"
  )
    throw new Error("Unexpected Formula References armor table headers");
  const remainingGoldFormula = inventorySheet?.G6?.f;
  if (
    typeof remainingGoldFormula !== "string" ||
    !remainingGoldFormula.includes("G5") ||
    !remainingGoldFormula.toUpperCase().includes("SUM(") ||
    !remainingGoldFormula.includes("N10:O63") ||
    !remainingGoldFormula.includes("BG10:BH29")
  )
    throw new Error("Unexpected Equipment remaining-gold formula at G6");
  const catalog = {};
  const physicalRows = [
    151,
    152,
    153,
    154,
    ...Array.from({ length: 41 }, (_, i) => 156 + i),
    200,
    201,
    202,
    203,
    204,
    205,
    206,
  ];
  for (const row of physicalRows) {
    const name = asText(cellValue(sheet, "A", row));
    if (!name || typeof cellValue(sheet, "B", row) !== "number") continue; // bounded section headings and blank separators
    const bonus = row === 154 ? 3 : cellValue(sheet, "B", row);
    const dex = cellValue(sheet, "C", row);
    const penalty = cellValue(sheet, "D", row) ?? 0;
    const failure = cellValue(sheet, "E", row) ?? 0;
    const category = asText(cellValue(sheet, "F", row));
    const shield = row >= 200;
    if (
      !Number.isInteger(bonus) ||
      bonus < 0 ||
      !Number.isInteger(penalty) ||
      penalty < 0 ||
      (dex != null && (!Number.isInteger(dex) || dex < 0))
    )
      throw new Error(`Invalid armor chassis at Formula References row ${row}`);
    if (typeof failure !== "number" || failure < 0 || failure > 1)
      throw new Error(`Invalid armor spell-failure metadata at row ${row}`);
    if (
      !shield && row !== 154 &&
      !["Unarmored", "Light", "Medium", "Heavy"].includes(category)
    )
      throw new Error(`Unrecognized armor category ${category} at row ${row}`);
    const id = `pf1e.autosheet.${slug(name)}`;
    if (catalog[id]) throw new Error(`Duplicate equipment id ${id}`);
    catalog[id] = {
      id,
      name,
      kind: row === 152 ? "wondrous" : shield ? "shield" : "armor",
      effects: [
        {
          kind: "modifier",
          target: "ac",
          value: bonus,
          bonusType: shield ? "shield" : "armor",
          appliesTo: ["normal", "flatFooted"],
        },
      ],
      ...(dex != null ? { maxDexterity: dex } : {}),
      armorCheckPenalty: -penalty,
      ...(typeof cellValue(sheet, "I", row) === "number" ? { armorWeightCategory: cellValue(sheet, "I", row) } : {}),
      reduceLandSpeed: ["Medium", "Heavy"].includes(category),
      wornArmor: ["Light", "Medium", "Heavy"].includes(category),
      ...(row === 154 ? { requiresUnarmored: true, armorBonusProgression: { base: 3, incrementEveryBab: 3 } } : {}),
      arcaneSpellFailureChance: Math.round(failure * 1000) / 1000,
      ...(![151, 152, 205].includes(row) && asText(cellValue(sheet, "H", row)) ? { materialType: asText(cellValue(sheet, "H", row)) } : {}),
      source: {
        document: documentName,
        sheet: "Formula References",
        row,
        range: `A${row}:I${row}`,
        system: "PF1e",
        category: `${category ?? "Special"} / ${asText(cellValue(sheet, "G", row))}`,
      },
    };
  }
  warnings.push({
    kind: "armor-table-normalization",
    source: { sheet: "Formula References", range: "A149:I206" },
    message:
      "Positive check-penalty magnitudes become negative contributions; blank Max Dex means unlimited (zero remains a cap). Medium/heavy armor reduces land speed. Spell-failure percentage is retained as metadata. Column I is armor weight category, not pounds. Material compatibility labels are retained, and numeric material adjustments change the effective category and land-speed penalty.",
  });
  if (Object.keys(catalog).length !== 49)
    throw new Error(
      `Expected 49 armor/shield and spell-protection rows, found ${Object.keys(catalog).length}`,
    );
  if (
    !inventorySheet ||
    cellValue(inventorySheet, "CR", 3) !== "Item" ||
    cellValue(inventorySheet, "CS", 3) !== "Weight" ||
    cellValue(inventorySheet, "CT", 3) !== "Capacity"
  ) throw new Error("Unexpected Equipment magical storage table headers");
  for (let row = 4; row <= 10; row++) {
    const name = asText(cellValue(inventorySheet, "CR", row));
    const weight = cellValue(inventorySheet, "CS", row);
    const capacity = cellValue(inventorySheet, "CT", row);
    if (!name || typeof weight !== "number" || (typeof capacity !== "number" && capacity !== "inf"))
      throw new Error(`Invalid magical storage item at Equipment row ${row}`);
    const id = `pf1e.autosheet.${slug(name)}`;
    if (catalog[id]) throw new Error(`Duplicate equipment id ${id}`);
    catalog[id] = {
      id,
      name,
      kind: "wondrous",
      effects: [],
      weight,
      ...(capacity === "inf" ? { unlimitedContainer: true } : { containerCapacity: capacity }),
      source: { document: documentName, sheet: "Equipment", row, range: `CR${row}:CT${row}`, system: "PF1e", category: "Magical storage" },
    };
  }
  warnings.push({
    kind: "magical-storage-catalog",
    source: { sheet: "Equipment", range: "CR3:CT10" },
    message: "Imported the workbook's seven magical storage items with their authored carried weights and capacities; Portable Hole has unlimited capacity.",
  });
  return catalog;
}

function buildEquipmentMaterialCatalog(sheet) {
  if (cellValue(sheet, "A", 208) !== "Armor Materials" || cellValue(sheet, "B", 208) !== "AC Bonus")
    throw new Error("Unexpected Formula References material table headers");
  const catalog = {};
  for (let row = 209; row <= 232; row += 1) {
    const name = asText(cellValue(sheet, "A", row));
    if (!name) continue;
    const materialType = asText(cellValue(sheet, "F", row));
    if (!materialType) throw new Error(`Missing material compatibility type at row ${row}`);
    const numeric = { B: "armorClassAdjustment", C: "maxDexterityAdjustment", D: "armorCheckPenaltyAdjustment", E: "arcaneSpellFailureAdjustment", I: "weightCategoryAdjustment" };
    const values = {};
    for (const [column, key] of Object.entries(numeric)) {
      const value = cellValue(sheet, column, row);
      if (value !== undefined && value !== null && value !== "") {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid material value at ${column}${row}`);
        values[key] = value;
      }
    }
    const id = `pf1e.autosheet.material.${slug(name)}`;
    const source = { document: documentName, sheet: "Formula References", row, range: `A${row}:I${row}`, system: "PF1e", category: "Armor and shield materials" };
    const notes = asText(cellValue(sheet, "G", row));
    const effects = {
      "Electricity Resist 2": { energyResistance: { damageType: "electricity", amount: 2 } },
      "Fire Resist 2": { energyResistance: { damageType: "fire", amount: 2 } },
      "Cold Resist 2": { energyResistance: { damageType: "cold", amount: 2 } },
      "DR 1/-": { damageReduction: { amount: 1 }, damageReductionByArmorWeightCategory: Boolean(sheet[`G${row}`]?.f?.includes("$O$154")) },
      "DR 1/- vs. Beasts/Humanoids": { damageReduction: { amount: 1, appliesAgainst: ["animal", "humanoid"] }, damageReductionByArmorWeightCategory: Boolean(sheet[`G${row}`]?.f?.includes("$O$154")) },
      "+2 Fly": { flyBonus: 2 },
      "+1 Initiative": { initiativeBonus: 1, initiativeBonusByArmorWeightCategory: Boolean(sheet[`G${row}`]?.f?.includes("$O$154")) },
    }[notes] ?? {};
    const variant = { materialType, ...(cellValue(sheet, "H", row) === "Shield" ? { shield: true } : {}), ...values, ...effects, ...(notes ? { notes } : {}), source };
    if (!catalog[id]) catalog[id] = { id, name, variants: [], source };
    catalog[id].variants.push(variant);
  }
  return catalog;
}

function buildAttackProfiles(sheet, warnings, unsupported) {
  const legacyNames = {
    C45: "standard-melee",
    C46: "two-handed",
    F45: "off-hand",
    C49: "finesse",
    C50: "agile",
    I45: "ranged",
    I46: "thrown",
    L46: "off-hand-thrown",
    AA45: "natural-single",
    AA46: "natural-primary",
    AA47: "natural-no-haste",
    AA48: "natural-secondary",
  };
  const catalog = {};
  for (const column of ["C", "F", "I", "L", "X", "AA"]) {
    for (let row = 45; row <= 61; row++) {
      const cell = `${column}${row}`;
      const description = asText(cellValue(sheet, column, row));
      if (!description || /^[~\-]+$/.test(description)) continue;
      if (cell === "C56" && description === "INT to hit, INT to damage") {
        warnings.push({ kind: "character-specific-attack-profile", source: { sheet: "Formula References", range: cell }, message: "Skipped Charlie-specific attack profile; Charlie's seeded character attacks already carry INT hit and damage modifiers." });
        continue;
      }
      const natural = column === "AA";
      const offhand = ["F", "L"].includes(column);
      const single = column === "X";
      const mode =
        ["I", "L"].includes(column) ||
        (single && description.startsWith("Ranged:"))
          ? "ranged"
          : "melee";
      const secondary = natural && description.includes("Secondary");
      const clause = description
        .replace(/^(Melee|Ranged):\s*/, "")
        .split("(")[0]
        .trim();
      const normalMatch =
        /^(STR|DEX|CON|INT|WIS|CHA) to hit(?:,\s*(?:(0\.5|1\.5)\s*\*\s*)?(STR|DEX|CON|INT|WIS|CHA)(?:\s*\*\s*(0\.5|1\.5))? to damage)?$/i.exec(
          clause,
        );
      const naturalMatch =
        /^(STR|DEX|CON|INT|WIS|CHA)\/(STR|DEX|CON|INT|WIS|CHA)(?:\*(0\.5|1\.5))?\s/.exec(
          clause,
        );
      if (!(natural ? naturalMatch : normalMatch))
        throw new Error(
          `Unrecognized bounded attack profile at ${cell}: ${description}`,
        );
      const attackAbility = (
        natural ? naturalMatch[1] : normalMatch[1]
      ).toLowerCase();
      const damageAbility = (
        natural ? naturalMatch[2] : normalMatch[3]
      )?.toLowerCase();
      const multiplier = damageAbility
        ? Number(
            natural
              ? (naturalMatch[3] ?? 1)
              : (normalMatch[2] ?? normalMatch[4] ?? 1),
          )
        : 0;
      const group = natural
        ? secondary
          ? "natural-secondary"
          : /Single Primary/.test(description)
            ? "natural-single"
            : /does not apply/.test(description)
              ? "natural-no-haste"
              : "natural-primary"
        : `${single ? "single-" : offhand ? "off-hand-" : ""}${mode}`;
      const id = `pf1e.autosheet.${legacyNames[cell] ?? `${group}-${attackAbility}-${damageAbility ?? "none"}-${String(multiplier).replace(".", "-")}`}`;
      if (catalog[id])
        throw new Error(`Duplicate imported attack profile ${id}`);
      catalog[id] = {
        id,
        name: `${group.replaceAll("-", " ")}: ${attackAbility.toUpperCase()} / ${damageAbility ? `${multiplier}×${damageAbility.toUpperCase()}` : "no damage ability"}`,
        description,
        attackAbility,
        ...(damageAbility ? { damageAbility } : {}),
        damageAbilityMultiplier: multiplier,
        mode,
        attackTags: [
          natural ? "natural.attack" : `weapon.${mode}`,
          ...(offhand || secondary ? ["weapon.off-hand"] : []),
          ...(multiplier === 1.5 && mode === "melee"
            ? ["weapon.two-handed"]
            : []),
        ],
        iterative: !single && !natural && !offhand,
        extraAttackEligible:
          !single &&
          !offhand &&
          !(natural && description.includes("does not apply")),
        ...(secondary ? { attackBonus: -5 } : {}),
        source: {
          document: documentName,
          sheet: "Formula References",
          row,
          range: cell,
          system: "PF1e",
          category: "Ability-based attack profiles",
        },
      };
    }
  }
  if (Object.keys(catalog).length !== 60)
    throw new Error(
      `Expected 60 ordinary attack profiles, found ${Object.keys(catalog).length}`,
    );
  const bombDescription = asText(cellValue(sheet, "AD", 45));
  if (!bombDescription?.startsWith("Alchemist Bomb (DEX to hit, INT to damage)"))
    throw new Error(`Unexpected Autosheet bomb profile at AD45: ${bombDescription}`);
  const bombId = "pf1e.autosheet.alchemist-bomb";
  catalog[bombId] = {
    id: bombId,
    name: "Alchemist Bomb: DEX / INT",
    description: bombDescription,
    attackAbility: "dex",
    damageAbility: "int",
    damageAbilityMultiplier: 1,
    mode: "ranged",
    attackTags: ["weapon.ranged", "weapon.touch"],
    iterative: false,
    extraAttackEligible: false,
    source: { document: documentName, sheet: "Formula References", row: 45, range: "AD45:AF45", system: "PF1e", category: "Specialized attack profiles" },
  };
  const addSpecialProfile = (id, name, attackAbility, damageAbility, multiplier, mode, row, range, options = {}) => {
    const description = asText(cellValue(sheet, "AD", row));
    if (!description?.startsWith(options.expectedPrefix ?? name)) throw new Error(`Unexpected specialized attack profile at AD${row}: ${description}`);
    const profileId = `pf1e.autosheet.${id}`;
    catalog[profileId] = {
      id: profileId, name, description, attackAbility, damageAbility,
      damageAbilityMultiplier: multiplier, mode,
      attackTags: [...(mode === "ranged" ? ["weapon.ranged"] : ["weapon.melee"]), ...(options.touch ? ["weapon.touch"] : [])],
      iterative: options.iterative ?? true,
      extraAttackEligible: options.extraAttackEligible ?? true,
      ...(options.damageModifierMode ? { damageModifierMode: options.damageModifierMode } : {}),
      source: { document: documentName, sheet: "Formula References", row, range, system: "PF1e", category: "Specialized attack profiles" },
    };
  };
  addSpecialProfile("alchemist-rapid-bomb", "Alchemist Bomb: Rapid Bomb", "dex", "int", 1, "ranged", 46, "AD46:AF46", { touch: true, expectedPrefix: "Alchemist Bomb (DEX to hit, INT to damage)" });
  addSpecialProfile("witch-prehensile-hair", "Witch Prehensile Hair", "int", "int", 1, "melee", 48, "AD48:AF48");
  addSpecialProfile("white-witch-hair-str", "White Witch Hair: STR / INT", "str", "int", 1, "melee", 49, "AD49:AF49", { expectedPrefix: "White Witch Hair (" });
  addSpecialProfile("white-witch-hair-dex", "White Witch Hair: DEX / INT", "dex", "int", 1, "melee", 50, "AD50:AF50", { expectedPrefix: "White Witch Hair (" });
  addSpecialProfile("kineticist-ranged-con", "Kineticist Ranged: DEX / CON", "dex", "con", 1, "ranged", 53, "AD53:AF53", { touch: true, iterative: false, extraAttackEligible: false, expectedPrefix: "Kineticist Ranged (" });
  addSpecialProfile("kineticist-ranged-half-con", "Kineticist Ranged: DEX / ½ CON", "dex", "con", 0.5, "ranged", 54, "AD54:AF54", { touch: true, iterative: false, extraAttackEligible: false, expectedPrefix: "Kineticist Ranged (" });
  addSpecialProfile("kineticist-melee-dex-con", "Kineticist Melee: DEX / CON", "dex", "con", 1, "melee", 55, "AD55:AF55", { touch: true, iterative: false, extraAttackEligible: false, damageModifierMode: "ranged", expectedPrefix: "Kineticist Melee (" });
  addSpecialProfile("kineticist-melee-dex-half-con", "Kineticist Melee: DEX / ½ CON", "dex", "con", 0.5, "melee", 56, "AD56:AF56", { touch: true, iterative: false, extraAttackEligible: false, damageModifierMode: "ranged", expectedPrefix: "Kineticist Melee (" });
  addSpecialProfile("kineticist-melee-str-con", "Kineticist Melee: STR / CON", "str", "con", 1, "melee", 57, "AD57:AF57", { touch: true, iterative: false, extraAttackEligible: false, expectedPrefix: "Kineticist Melee (" });
  addSpecialProfile("kineticist-melee-str-half-con", "Kineticist Melee: STR / ½ CON", "str", "con", 0.5, "melee", 58, "AD58:AF58", { touch: true, iterative: false, extraAttackEligible: false, expectedPrefix: "Kineticist Melee (" });
  for (const row of [45, 46, 48, 49, 51, 52, 53, 55, 56, 57, 58, 59, 60]) {
    const description = asText(cellValue(sheet, "U", row));
    const match = /^(STR|DEX|WIS)\/(STR|DEX|WIS|---)(?:\*(0\.5|1\.5))? Monk (Melee|Ranged) Flurry \(/.exec(description ?? "");
    if (!match) throw new Error(`Unrecognized Monk Flurry profile at U${row}: ${description}`);
    const attackAbility = match[1].toLowerCase();
    const damageAbility = match[2] === "---" ? undefined : match[2].toLowerCase();
    const multiplier = damageAbility ? Number(match[3] ?? 1) : 0;
    const mode = match[4].toLowerCase();
    const profileId = `pf1e.autosheet.monk-flurry-${mode}-${attackAbility}-${damageAbility ?? "none"}-${String(multiplier).replace(".", "-")}`;
    if (catalog[profileId]) throw new Error(`Duplicate Monk Flurry profile ${profileId}`);
    catalog[profileId] = {
      id: profileId,
      name: `${match[4]} Monk Flurry: ${attackAbility.toUpperCase()} / ${damageAbility ? `${multiplier}×${damageAbility.toUpperCase()}` : "no ability damage"}`,
      description,
      attackAbility,
      ...(damageAbility ? { damageAbility, damageAbilityMultiplier: multiplier } : {}),
      mode,
      attackTags: [mode === "melee" ? "weapon.melee" : "weapon.ranged"],
      iterative: true,
      extraAttackEligible: true,
      babProgressionId: "pf1e.paizo.monk",
      bonusAttackProgression: {
        progressionId: "pf1e.paizo.monk",
        steps: [
          { level: 1, count: 1 },
          { level: 8, count: 2 },
          { level: 15, count: 3 },
        ],
      },
      requiredEligibilityTags: ["monk-flurry-weapon"],
      fullAttackOnly: true,
      source: { document: documentName, sheet: "Formula References", row, range: `U${row}:W${row}`, system: "PF1e", category: "Monk Flurry attack profiles" },
    };
  }
  catalog["pf1e.autosheet.spell-based"] = {
    id: "pf1e.autosheet.spell-based",
    name: "Spell-Based Attack (Caster Level + Casting Ability)",
    description: "Uses one selected spellcasting source's caster level and key ability instead of BAB and an attack ability.",
    attackAbility: "int",
    attackBaseline: "casterLevel",
    mode: "ranged",
    attackTags: ["weapon.ranged"],
    iterative: false,
    extraAttackEligible: false,
    source: { document: documentName, sheet: "Formula References", row: 53, range: "O53:Q53", system: "PF1e", category: "Spell-based attack profile" },
  };
  warnings.push({
    kind: "attack-profile-normalization",
    source: { sheet: "Formula References", range: "C45:AB61" },
    message:
      "Ability pairs and 0.5/1/1.5 ratios are extracted from a closed label grammar, never cached character totals. Secondary natural attacks default to −5; an authored +3 adjustment can represent an independently qualified −2 case. Names describe prerequisite-dependent profiles, not automatic feat grants. Off-hand/single/natural profiles do not gain BAB iteratives. Haste eligibility is explicit; combined multiweapon sequences remain contextual.",
  });
  warnings.push({
    kind: "character-authored-attack-options",
    source: { sheet: "Formula References", range: "O45:V61,AD45:AF58" },
    reason:
      "All contextual attack rows have selectable profiles, including class-level maneuver training, White Witch Hair CMB, Monk Flurry and spell-based caster-level attacks. Kineticist blast dice and class-specific options are authored on each character's attack because the workbook leaves them tied to active class features.",
  });
  return catalog;
}

function buildExperienceCatalog(sheet, warnings) {
  const entries = ["B", "C", "D"].map((column, index) => {
    const name = asText(cellValue(sheet, column, 114));
    if (name !== ["Slow", "Medium", "Fast"][index])
      throw new Error(`Unexpected XP chart at ${column}114`);
    const id = `pf1e.autosheet.experience-${name.toLowerCase()}`;
    const thresholds = Array.from({ length: 20 }, (_, index) => {
      const row = index + 115;
      const raw = cellValue(sheet, column, row);
      return {
        level: cellValue(sheet, "A", row),
        points: index === 0 && raw === "—" ? 0 : raw,
      };
    });
    return [
      id,
      {
        id,
        name,
        thresholds,
        source: {
          document: documentName,
          sheet: "Formula References",
          range: `${column}114:${column}134`,
          row: 114,
          system: "PF1e",
          category: "XP thresholds",
        },
      },
    ];
  });
  warnings.push({
    kind: "xp-level-one-normalization",
    source: { sheet: "Formula References", range: "B115:D115" },
    message:
      "Level-one em dashes normalize to zero XP. The chart ends at level 20; higher thresholds are not extrapolated. XP eligibility does not auto-advance authored class slots.",
  });
  return Object.fromEntries(entries);
}

function buildAgeFeatures(sheet, warnings) {
  const categories = ["Young", "Adult", "Middle Age", "Old", "Venerable"];
  warnings.push({
    kind: "age-table-scope",
    source: { sheet: "Formula References", range: "B28:F34" },
    message:
      "Imports only the workbook's explicit ability adjustments, not racial age thresholds or the separate Young Creature template. Entries in the same age group do not stack; choose one age category.",
  });
  return Object.fromEntries(
    categories.map((name, index) => {
      const column = XLSX.utils.encode_col(index + 1);
      if (cellValue(sheet, column, 28) !== name)
        throw new Error(`Unexpected age table header at ${column}28`);
      const id = `pf1e.autosheet.age-${slug(name)}`;
      const effects = ["str", "dex", "con", "int", "wis", "cha"]
        .map((ability, index) => {
          const value = cellValue(sheet, column, index + 29);
          if (!Number.isInteger(value))
            throw new Error(`Invalid age adjustment ${column}${index + 29}`);
          return {
            kind: "modifier",
            target: `ability.${ability}`,
            value,
            bonusType: "untyped",
          };
        })
        .filter((effect) => effect.value !== 0);
      return [
        id,
        {
          id,
          name: `Age: ${name}`,
          effects,
          exclusiveGroup: "pf1e.autosheet.age",
          priority: index,
          description:
            "Workbook age-category ability adjustments only. Select one age category; racial thresholds and creature templates are not inferred.",
          source: {
            document: documentName,
            sheet: "Formula References",
            row: 28,
            range: `${column}28:${column}34`,
            system: "PF1e",
            category: "Age ability adjustments",
          },
        },
      ];
    }),
  );
}

function buildSphereCategories(sheet) {
  const lists = [
    ["spheresOfMight", "O", "Spheres of Might"],
    ["spheresOfPower", "P", "Spheres of Power"],
  ];
  const catalog = {};
  for (const [key, column, label] of lists) {
    const categories = [];
    for (let row = 4; row <= 29; row += 1) {
      const name = asText(cellValue(sheet, column, row));
      if (!name) continue;
      categories.push({
        name,
        source: { document: documentName, sheet: "Formula References", row, range: `${column}${row}`, system: "PF1e-compatible", category: label },
      });
    }
    if (!categories.length) throw new Error(`No ${label} categories found in Formula References!${column}4:${column}29`);
    catalog[key] = categories;
  }
  return catalog;
}

function buildBonusTypeReference(sheet) {
  return Array.from({ length: 14 }, (_, index) => {
    const row = 97 + index;
    const label = asText(cellValue(sheet, "A", row));
    if (!label) throw new Error(`Missing bonus type label at Formula References!A${row}`);
    return {
      label,
      source: { document: documentName, sheet: "Formula References", row, range: `A${row}`, system: "PF1e", category: "Types of Bonuses" },
    };
  });
}

function buildSizeAdjustmentCatalog(sheet) {
  const catalog = {};
  for (let row = 138; row <= 146; row += 1) {
    const category = asText(cellValue(sheet, "B", row))?.toLocaleLowerCase("en-US");
    if (!schemas.sizeCategories.includes(category)) throw new Error(`Unexpected size category at Formula References!B${row}`);
    const values = ["C", "D", "E", "F", "G"].map((column) => cellValue(sheet, column, row));
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`Incomplete size adjustment at Formula References!C${row}:G${row}`);
    const [attackAc, cmbCmd, fly, stealth, carryingCapacityMultiplier] = values;
    if (carryingCapacityMultiplier <= 0) throw new Error(`Invalid carrying-capacity multiplier at Formula References!G${row}`);
    catalog[category] = {
      attackAc,
      cmbCmd,
      fly,
      stealth,
      carryingCapacityMultiplier,
      source: { document: documentName, sheet: "Formula References", row, range: `B${row}:G${row}`, system: "PF1e", category: "Size adjustments" },
    };
  }
  for (const category of schemas.sizeCategories) if (!catalog[category]) throw new Error(`Missing size adjustment for ${category}`);
  return catalog;
}

function buildWornSlotReference(sheet) {
  const labels = Array.from({ length: 13 }, (_, index) => asText(cellValue(sheet, "Q", 10 + index)));
  if (labels.some((label) => !label)) throw new Error("Equipment!Q10:Q22 must list all worn slots");
  const counts = new Map();
  for (const label of labels) counts.set(label.toLocaleLowerCase("en-US"), (counts.get(label.toLocaleLowerCase("en-US")) ?? 0) + 1);
  return labels.map((slot, index) => ({
    slot,
    capacity: counts.get(slot.toLocaleLowerCase("en-US")),
    source: { document: documentName, sheet: "Equipment", row: 10 + index, range: `Q${10 + index}`, system: "PF1e", category: "Worn magic-item slots" },
  }));
}

function buildConditionFeatures(sheet, warnings) {
  const targets = [["B", "ac"], ["C", "ability.str"], ["D", "ability.dex"], ["E", "ability.con"], ["F", "ability.int"], ["G", "ability.wis"], ["H", "ability.cha"], ["I", "save.fortitude"], ["J", "save.reflex"], ["K", "save.will"], ["L", "attack.melee"], ["M", "damage.melee"], ["N", "attack.ranged"], ["O", "damage.ranged"], ["P", "skill.all"], ["Q", "casterLevel"]];
  const result = {};
  for (let row = 237; row <= 268; row += 1) {
    const name = asText(cellValue(sheet, "A", row));
    if (!name) continue;
    const effects = [];
    const dynamicAcPenalty = { 238: -2, 241: -2, 255: -4 }[row];
    for (const [column, target] of targets) {
      const value = target === "ac" && dynamicAcPenalty !== undefined ? dynamicAcPenalty : cellValue(sheet, column, row);
      if (!Number.isFinite(value) || value === 0) continue;
      const bonusType = value > 0 ? "circumstance" : "penalty";
      effects.push(target === "ac"
        ? { kind: "modifier", target, value, bonusType, appliesTo: ["normal", "touch", "flatFooted"] }
        : { kind: "modifier", target, value, bonusType });
    }
    const proseModifier = /^(.*?)\s+(-\d+(?:\.\d+)?)\s*$/.exec(asText(cellValue(sheet, "U", row)) ?? "");
    if (proseModifier) {
      const value = Number(proseModifier[2]);
      for (const term of proseModifier[1].split(",").map((item) => item.trim()).filter(Boolean)) {
        const target = term.toLocaleLowerCase("en-US") === "initiative" ? "initiative" : `skill.${slug(term)}`;
        effects.push({ kind: "modifier", target, value, bonusType: "penalty" });
      }
    }
    const rawMovement = cellValue(sheet, "R", row);
    const movementMatch = typeof rawMovement === "number" ? rawMovement : /^x\s*([0-9]+(?:\.[0-9]+)?)$/i.exec(asText(rawMovement) ?? "")?.[1];
    const movementFactor = movementMatch === undefined ? undefined : Number(movementMatch);
    if (movementFactor !== undefined && Number.isFinite(movementFactor) && movementFactor > 0 && movementFactor !== 1) {
      for (const mode of ["land", "fly", "swim", "climb", "burrow"]) effects.push({ kind: "multiply", target: `speed.${mode}`, factor: movementFactor });
    }
    const extraMovement = ["S", "T"].flatMap((column) => {
      const value = cellValue(sheet, column, row);
      if (!Number.isFinite(value) || value === 1) return [];
      const action = column === "S" ? "charge" : "run";
      if (value !== 1) effects.push({ kind: "multiply", target: `speed.${action}`, factor: value });
      return [value === 0 ? `cannot ${action}` : `${action} speed ×${value}`];
    });
    const description = [asText(cellValue(sheet, "U", row)), ...extraMovement].filter(Boolean).join("; ");
    const id = `pf1e.paizo.${slug(name)}`;
    if (result[id]) throw new Error(`Duplicate condition in Formula References at row ${row}: ${name}`);
    result[id] = { id, name, effects, ...(description ? { description } : {}), source: { document: documentName, sheet: "Formula References", row, range: `A${row}:U${row}`, system: "PF1e", category: "Conditions" } };
  }
  warnings.push({ kind: "condition-prose-effects", source: { sheet: "Formula References", range: "U238:U244" }, message: "Parsed the workbook's listed Blinded skill, Dazzled Perception, and Deafened initiative/Perception penalties into roll modifiers." });
  warnings.push({ kind: "condition-action-scope", source: { sheet: "Formula References", range: "A237:U268" }, message: "Imported numeric modifiers, listed roll penalties, and movement multipliers; selected Pathfinder action and defense rules are overlaid in the rules content." });
  return result;
}

function checkWorkbookShape(workbook) {
  const classCharts = workbook.Sheets[classChartsSheetName];
  const classSkills = workbook.Sheets[classSkillsSheetName];
  if (!classCharts || !classSkills)
    throw new Error("Autosheet is missing Class Charts or Class Skills");
  const chartHeader = expectedClassChartHeaders.map((_, index) =>
    asText(
      cellValue(classCharts, String.fromCharCode("C".charCodeAt(0) + index), 2),
    ),
  );
  if (
    chartHeader.some(
      (value, index) => value !== expectedClassChartHeaders[index],
    )
  ) {
    throw new Error(
      `Unexpected Class Charts header at row 2: ${JSON.stringify(chartHeader)}`,
    );
  }
  if (
    asText(cellValue(classSkills, "B", 1)) !== "Acrobatics" ||
    asText(cellValue(classSkills, "BH", 1)) !== "Kn. Psionics"
  ) {
    throw new Error("Unexpected Class Skills header layout");
  }
  return { classCharts, classSkills };
}

function sheetState(workbook, sheetName) {
  const entry = workbook.Workbook?.Sheets?.find(
    (sheet) => sheet.name === sheetName,
  );
  return entry?.Hidden === 1
    ? "hidden"
    : entry?.Hidden === 2
      ? "veryHidden"
      : "visible";
}

function workbookSheetInventory(workbook) {
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const formulaRows = new Map();
    let formulaCells = 0;
    for (const [address, cell] of Object.entries(sheet ?? {})) {
      if (address.startsWith("!") || typeof cell?.f !== "string") continue;
      const row = XLSX.utils.decode_cell(address).r + 1;
      formulaCells += 1;
      formulaRows.set(row, (formulaRows.get(row) ?? 0) + 1);
    }
    const rows = [...formulaRows.keys()].sort((left, right) => left - right);
    const formulaRowGroups = [];
    for (const row of rows) {
      const current = formulaRowGroups.at(-1);
      if (current && current.end + 1 === row) {
        current.end = row;
        current.cells += formulaRows.get(row);
      } else {
        formulaRowGroups.push({ start: row, end: row, cells: formulaRows.get(row) });
      }
    }
    return {
      name,
      state: sheetState(workbook, name),
      bounds: sheet?.["!ref"] ?? null,
      formulaCells,
      formulaRowGroups,
      ...(workbookSheetUsage[name] ?? {
        importStatus: "excluded",
        reason:
          "Unrecognized workbook sheet; excluded until an explicit deterministic mapping is added.",
      }),
    };
  });
}

function countBy(values, property) {
  return Object.fromEntries(
    values.reduce((counts, value) => {
      const key = value[property];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map()),
  );
}

async function generate() {
  const workbookBytes = await readFile(inputPath);
  const inputSha256 = createHash("sha256").update(workbookBytes).digest("hex");
  const workbook = XLSX.read(workbookBytes, {
    cellFormula: true,
    cellText: true,
    cellNF: true,
  });
  const { classCharts, classSkills: classSkillsSheet } =
    checkWorkbookShape(workbook);
  const chartRows = parseClassCharts(classCharts);
  if (chartRows.length !== 259)
    throw new Error(
      `Expected 259 safely parseable Class Charts rows, found ${chartRows.length}`,
    );

  const duplicateIds = chartRows.filter(
    (record, index) =>
      chartRows.findIndex((candidate) => candidate.id === record.id) !== index,
  );
  if (duplicateIds.length)
    throw new Error(
      `Stable progression id collision: ${duplicateIds.map((record) => `${record.id} (row ${record.row})`).join(", ")}`,
    );

  const classSkillRows = parseClassSkillRows(classSkillsSheet);
  const classSkillRowsBySection = countBy(
    [...classSkillRows.values()],
    "section",
  );
  const successfulRows = [];
  const normalizedOrWarnedRows = [];
  const unsupportedRows = [];
  const progressionCatalog = {};
  const usedSkillIds = new Set();

  for (const record of chartRows) {
    const classSkillKey = `${record.sourceInfo.classSkillsSection}\u0000${normalizeName(record.name)}`;
    const classSkillsEntry = classSkillRows.get(classSkillKey);
    const publishedClassSkillSupplement = publishedClassSkillSupplements[record.id];
    const classSkillResult = classSkillsEntry
      ? classSkillIdsForRow(classSkillsSheet, classSkillsEntry)
      : undefined;
    if (classSkillResult?.unsupportedColumns.length) {
      unsupportedRows.push({
        kind: "class-skill-column",
        progressionId: record.id,
        name: record.name,
        source: {
          sheet: classSkillsSheetName,
          row: classSkillsEntry.row,
          range: `${classSkillResult.unsupportedColumns[0]}${classSkillsEntry.row}:${classSkillResult.unsupportedColumns.at(-1)}${classSkillsEntry.row}`,
        },
        reason: `The source marks custom columns without a named skill: ${classSkillResult.unsupportedColumns.join(", ")}`,
      });
    }
    if (!classSkillsEntry && !publishedClassSkillSupplement) {
      unsupportedRows.push({
        kind: "missing-class-skills",
        progressionId: record.id,
        name: record.name,
        source: {
          sheet: classChartsSheetName,
          row: record.row,
          range: `A${record.row}:H${record.row}`,
        },
        reason: `No scoped Class Skills row exists in ${record.sourceInfo.classSkillsSection}; chassis was retained without classSkills.`,
      });
    }
    if (!classSkillsEntry && publishedClassSkillSupplement) {
      normalizedOrWarnedRows.push({
        kind: "published-class-skill-supplement",
        progressionId: record.id,
        source: { document: publishedClassSkillSupplement.source.document, sheet: publishedClassSkillSupplement.source.sheet },
        message: `Added the published Paizo class-skill list: ${publishedClassSkillSupplement.ids.join(", ")}.`,
      });
    }

    const chart = makeProgressionChart(record);
    const spellcastingTemplate = record.spellcastingTemplate;
    if (chart) {
      normalizedOrWarnedRows.push({
        kind: "explicit-prestige-chart",
        progressionId: record.id,
        source: {
          sheet: classChartsSheetName,
          row: record.row,
          range: `D${record.row}:L${record.row}`,
        },
        message: `Expanded Prestige Good/Poor schedules into ${chart.length} explicit cumulative levels.`,
      });
    }
    if (
      classSkillsEntry &&
      normalizeName(classSkillsEntry.name) === normalizeName(record.name) &&
      classSkillsEntry.name !== record.name
    ) {
      normalizedOrWarnedRows.push({
        kind: "scoped-class-skill-name-normalization",
        progressionId: record.id,
        source: {
          sheet: classSkillsSheetName,
          row: classSkillsEntry.row,
          range: `A${classSkillsEntry.row}`,
        },
        message: `Joined Class Charts ${JSON.stringify(record.name)} to Class Skills ${JSON.stringify(classSkillsEntry.name)} by case-folded scoped name.`,
      });
    }
    if (classSkillResult?.nameWasFormula) {
      normalizedOrWarnedRows.push({
        kind: "cached-class-skill-name-formula",
        progressionId: record.id,
        source: {
          sheet: classSkillsSheetName,
          row: classSkillsEntry.row,
          range: `A${classSkillsEntry.row}`,
        },
        message:
          "Used the source workbook's cached formula value; formulas were not evaluated.",
      });
    }
    if (classSkillResult?.proseSupplements.length) {
      normalizedOrWarnedRows.push({
        kind: "closed-prose-class-skill-supplement",
        progressionId: record.id,
        source: {
          sheet: classSkillsSheetName,
          row: classSkillsEntry.row,
          range: `AR${classSkillsEntry.row}`,
        },
        message: `Added source-declared skills not represented by a grid marker: ${classSkillResult.proseSupplements.join(", ")}.`,
      });
    }
    if (
      ["fighter", "rogue", "wizard"].includes(
        record.name.toLocaleLowerCase("en-US"),
      ) &&
      record.category === "Base"
    ) {
      normalizedOrWarnedRows.push({
        kind: "legacy-progression-alias",
        progressionId: record.id,
        source: {
          sheet: classChartsSheetName,
          row: record.row,
          range: `B${record.row}`,
        },
        message: `Preserved legacy bare id ${record.name.toLocaleLowerCase("en-US")} as an alias to the source-qualified id.`,
      });
    }

    const progression = {
      id: record.id,
      name: record.name,
      hitDieSides: record.hitDieSides,
      babProgression: record.babProgression,
      saveProgressions: record.saveProgressions,
      skillPointsPerLevel: record.skillPointsPerLevel,
      ...(classSkillsEntry ? { classSkills: classSkillResult.ids, consolidatedClassSkills: classSkillResult.consolidatedIds } : publishedClassSkillSupplement ? { classSkills: publishedClassSkillSupplement.ids, consolidatedClassSkills: publishedClassSkillSupplement.consolidatedIds } : {}),
      ...(spellcastingTemplate ? {
        spellcastingTemplates: [spellcastingTemplate],
        spellcastingAdvancement: [{ sourceId: spellcastingTemplate.sourceId, progressionId: spellcastingTemplate.progressionId, levels: 1 }],
      } : {}),
      ...(record.characterSystemTemplates ? { characterSystemTemplates: record.characterSystemTemplates } : {}),
      ...(chart ? { chart } : {}),
      ...(["fighter", "rogue", "wizard"].includes(
        record.name.toLocaleLowerCase("en-US"),
      ) && record.category === "Base"
        ? { aliases: [record.name.toLocaleLowerCase("en-US")] }
        : {}),
      source: sourceMetadata({
        sheet: classChartsSheetName,
        category: record.category,
        row: record.row,
        range: record.maximumLevel
          ? `A${record.row}:L${record.row}`
          : `A${record.row}:H${record.row}`,
        sourceInfo: record.sourceInfo,
      }),
      ...(classSkillsEntry
        ? {
            classSkillsSource: sourceMetadata({
              sheet: classSkillsSheetName,
              category: classSkillsEntry.section,
              row: classSkillsEntry.row,
              range: `A${classSkillsEntry.row}:BH${classSkillsEntry.row}`,
              sourceInfo: record.sourceInfo,
            }),
          }
        : publishedClassSkillSupplement ? { classSkillsSource: publishedClassSkillSupplement.source } : {}),
    };
    progressionCatalog[record.id] = progression;
    for (const skillId of [...(classSkillResult?.ids ?? []), ...(classSkillResult?.consolidatedIds ?? []), ...(publishedClassSkillSupplement?.ids ?? [])])
      usedSkillIds.add(skillId);
    successfulRows.push({
      progressionId: record.id,
      name: record.name,
      category: record.category,
      source: {
        sheet: classChartsSheetName,
        row: record.row,
        range: record.maximumLevel
          ? `A${record.row}:L${record.row}`
          : `A${record.row}:H${record.row}`,
      },
      ...(classSkillsEntry
        ? {
            classSkillsSource: {
              sheet: classSkillsSheetName,
              row: classSkillsEntry.row,
              range: `A${classSkillsEntry.row}:BH${classSkillsEntry.row}`,
            },
          }
        : publishedClassSkillSupplement ? { classSkillsSource: publishedClassSkillSupplement.source } : {}),
    });
  }

  const skillCatalog = buildSkillCatalog(
    classSkillsSheet,
    normalizedOrWarnedRows,
  );
  const equipmentCatalog = buildEquipmentCatalog(
    workbook.Sheets["Formula References"],
    workbook.Sheets.Equipment,
    normalizedOrWarnedRows,
    unsupportedRows,
  );
  const equipmentMaterialCatalog = buildEquipmentMaterialCatalog(workbook.Sheets["Formula References"]);
  const missingSkillDefinitions = [...usedSkillIds].filter(
    (id) => !skillCatalog[id],
  );
  if (missingSkillDefinitions.length)
    throw new Error(
      `Generated class skills are missing SkillDefinition metadata: ${missingSkillDefinitions.join(", ")}`,
    );

  const aliases = Object.fromEntries(
    Object.values(progressionCatalog).flatMap((progression) =>
      (progression.aliases ?? []).map((alias) => [alias, progression.id]),
    ),
  );
  const alternateMetadata = Object.fromEntries(
    [...alternateConsolidatedColumns].map((column) => [
      column,
      asText(cellValue(classSkillsSheet, column, 1)),
    ]),
  );
  const experienceCatalog = buildExperienceCatalog(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
  );
  const ageFeatureCatalog = buildAgeFeatures(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
  );
  const conditionFeatureCatalog = buildConditionFeatures(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
  );
  const attackProfileCatalog = buildAttackProfiles(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
    unsupportedRows,
  );
  const sphereCategoryCatalog = buildSphereCategories(workbook.Sheets["Formula References"]);
  const bonusTypeReference = buildBonusTypeReference(workbook.Sheets["Formula References"]);
  const sizeAdjustmentCatalog = buildSizeAdjustmentCatalog(workbook.Sheets["Formula References"]);
  const wornSlotReference = buildWornSlotReference(workbook.Sheets.Equipment);
  const report = {
    schemaVersion: 1,
    importer: "scripts/import-autosheet.mjs",
    input: {
      path: inputRelativePath,
      sha256: inputSha256,
      workbook: {
        sheets: workbookSheetInventory(workbook),
      },
    },
    summary: {
      safelyParseableClassChartRows: chartRows.length,
      generatedProgressions: Object.keys(progressionCatalog).length,
      progressionsWithSpellcastingTemplates: chartRows.filter((record) => record.spellcastingTemplate).length,
      progressionsWithCharacterSystemTemplates: chartRows.filter((record) => record.characterSystemTemplates?.length).length,
      generatedSkillDefinitions: Object.keys(skillCatalog).length,
      generatedEquipmentDefinitions: Object.keys(equipmentCatalog).length,
      generatedEquipmentMaterials: Object.keys(equipmentMaterialCatalog).length,
      generatedExperienceTracks: Object.keys(experienceCatalog).length,
      generatedAgeFeatures: Object.keys(ageFeatureCatalog).length,
      generatedConditionFeatures: Object.keys(conditionFeatureCatalog).length,
      generatedAttackProfiles: Object.keys(attackProfileCatalog).length,
      generatedSphereCategories: sphereCategoryCatalog.spheresOfPower.length + sphereCategoryCatalog.spheresOfMight.length,
      generatedBonusTypeReferenceRows: bonusTypeReference.length,
      generatedSizeAdjustments: Object.keys(sizeAdjustmentCatalog).length,
      generatedWornSlotRows: wornSlotReference.length,
      progressionsWithClassSkills: successfulRows.filter(
        (row) => row.classSkillsSource,
      ).length,
      explicitPrestigeCharts: chartRows.filter((record) => record.maximumLevel)
        .length,
      classChartCategories: countBy(chartRows, "category"),
      classSkills: {
        joinStrategy:
          "Class Skills section plus NFKC/case-folded class name; unmatched rows retain chassis without classSkills.",
        rowsBySection: classSkillRowsBySection,
        classicColumns: classSkillColumns,
        contextualColumns: contextualClassSkillColumns,
        consolidatedColumns: alternateMetadata,
      },
      aliases,
    },
    successfulRows,
    equipmentRows: Object.values(equipmentCatalog).map(
      ({ id, name, source }) => ({ equipmentId: id, name, source }),
    ),
    equipmentMaterialRows: Object.values(equipmentMaterialCatalog).map(({ id, name, source, variants }) => ({ id, name, variants: variants.length, source })),
    experienceRows: Object.values(experienceCatalog).map(
      ({ id, name, source }) => ({ id, name, source }),
    ),
    ageRows: Object.values(ageFeatureCatalog).map(({ id, name, source }) => ({
      id,
      name,
      source,
    })),
    attackProfileRows: Object.values(attackProfileCatalog).map(
      ({ id, name, source }) => ({ id, name, source }),
    ),
    sphereCategoryRows: Object.entries(sphereCategoryCatalog).flatMap(([system, categories]) => categories.map(({ name, source }) => ({ system, name, source }))),
    bonusTypeReferenceRows: bonusTypeReference,
    sizeAdjustmentRows: Object.entries(sizeAdjustmentCatalog).map(([category, values]) => ({ category, ...values })),
    wornSlotRows: wornSlotReference,
    normalizedOrWarnedRows,
    unsupportedRows,
    failures: [],
  };

  return {
    progressionCatalog: schemas.parseProgressionCatalog(progressionCatalog),
    skillCatalog: schemas.parseSkillCatalog(skillCatalog),
    equipmentCatalog: schemas.equipmentCatalogSchema.parse(equipmentCatalog),
    equipmentMaterialCatalog: schemas.equipmentMaterialCatalogSchema.parse(equipmentMaterialCatalog),
    experienceCatalog: schemas.experienceCatalogSchema.parse(experienceCatalog),
    ageFeatureCatalog: schemas.featureCatalogSchema.parse(ageFeatureCatalog),
    conditionFeatureCatalog: schemas.featureCatalogSchema.parse(conditionFeatureCatalog),
    attackProfileCatalog:
      schemas.attackProfileCatalogSchema.parse(attackProfileCatalog),
    sphereCategoryCatalog: schemas.autosheetSphereCatalogSchema.parse(sphereCategoryCatalog),
    bonusTypeReference: schemas.autosheetBonusTypeReferenceSchema.parse(bonusTypeReference),
    sizeAdjustmentCatalog: schemas.autosheetSizeAdjustmentCatalogSchema.parse(sizeAdjustmentCatalog),
    wornSlotReference: schemas.autosheetWornSlotReferenceSchema.parse(wornSlotReference),
    report,
  };
}

function generatedTypeScript(name, typeName, value) {
  return [
    "/*",
    " * Generated by scripts/import-autosheet.mjs. Do not edit by hand.",
    ` * Source: ${inputRelativePath}`,
    " */",
    `import type { ${typeName} } from \"@threepointpf/rules-schema\";`,
    "",
    `export const ${name} = ${JSON.stringify(value, null, 2)} satisfies ${typeName};`,
    "",
  ].join("\n");
}

async function expectedOutputs() {
  const {
    progressionCatalog,
    skillCatalog,
    equipmentCatalog,
    equipmentMaterialCatalog,
    experienceCatalog,
    ageFeatureCatalog,
    conditionFeatureCatalog,
    attackProfileCatalog,
    sphereCategoryCatalog,
    bonusTypeReference,
    sizeAdjustmentCatalog,
    wornSlotReference,
    report,
  } = await generate();
  return new Map([
    [
      progressionOutputPath,
      generatedTypeScript(
        "generatedAutosheetProgressionCatalog",
        "ProgressionCatalog",
        progressionCatalog,
      ),
    ],
    [
      skillOutputPath,
      generatedTypeScript(
        "generatedAutosheetSkillCatalog",
        "SkillCatalog",
        skillCatalog,
      ),
    ],
    [
      equipmentOutputPath,
      generatedTypeScript(
        "generatedAutosheetEquipmentCatalog",
        "EquipmentCatalog",
        equipmentCatalog,
      ),
    ],
    [reportOutputPath, `${JSON.stringify(report, null, 2)}\n`],
    [path.join(generatedDirectory, "autosheet-sphere-categories.ts"), generatedTypeScript("generatedAutosheetSphereCategoryCatalog", "AutosheetSphereCatalog", sphereCategoryCatalog)],
    [path.join(generatedDirectory, "autosheet-bonus-types.ts"), generatedTypeScript("generatedAutosheetBonusTypeReference", "AutosheetBonusTypeReference", bonusTypeReference)],
    [path.join(generatedDirectory, "autosheet-size-adjustments.ts"), generatedTypeScript("generatedAutosheetSizeAdjustmentCatalog", "AutosheetSizeAdjustmentCatalog", sizeAdjustmentCatalog)],
    [path.join(generatedDirectory, "autosheet-worn-slots.ts"), generatedTypeScript("generatedAutosheetWornSlotReference", "AutosheetWornSlotReference", wornSlotReference)],
    [
      path.join(generatedDirectory, "autosheet-experience.ts"),
      generatedTypeScript(
        "generatedAutosheetExperienceCatalog",
        "ExperienceCatalog",
        experienceCatalog,
      ),
    ],
    [
      path.join(generatedDirectory, "autosheet-age.ts"),
      generatedTypeScript(
        "generatedAutosheetAgeCatalog",
        "FeatureCatalog",
        ageFeatureCatalog,
      ),
    ],
    [equipmentMaterialOutputPath, generatedTypeScript("generatedAutosheetEquipmentMaterialCatalog", "EquipmentMaterialCatalog", equipmentMaterialCatalog)],
    [
      path.join(generatedDirectory, "autosheet-conditions.ts"),
      generatedTypeScript(
        "generatedAutosheetConditionCatalog",
        "FeatureCatalog",
        conditionFeatureCatalog,
      ),
    ],
    [
      path.join(generatedDirectory, "autosheet-attacks.ts"),
      generatedTypeScript(
        "generatedAutosheetAttackProfileCatalog",
        "AttackProfileCatalog",
        attackProfileCatalog,
      ),
    ],
    [
      path.join(generatedDirectory, "autosheet-experience.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-experience.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-age.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-age.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-conditions.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-conditions.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-attacks.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-attacks.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-progressions.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-progressions.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-skills.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-skills.ts";\n',
    ],
    [
      path.join(generatedDirectory, "autosheet-equipment.js"),
      '// Generated source-only Deno bridge.\nexport * from "./autosheet-equipment.ts";\n',
    ],
    [path.join(generatedDirectory, "autosheet-equipment-materials.js"), '// Generated source-only Deno bridge.\nexport * from "./autosheet-equipment-materials.ts";\n'],
    [path.join(generatedDirectory, "autosheet-sphere-categories.js"), '// Generated source-only Deno bridge.\nexport * from "./autosheet-sphere-categories.ts";\n'],
    [path.join(generatedDirectory, "autosheet-bonus-types.js"), '// Generated source-only Deno bridge.\nexport * from "./autosheet-bonus-types.ts";\n'],
    [path.join(generatedDirectory, "autosheet-size-adjustments.js"), '// Generated source-only Deno bridge.\nexport * from "./autosheet-size-adjustments.ts";\n'],
    [path.join(generatedDirectory, "autosheet-worn-slots.js"), '// Generated source-only Deno bridge.\nexport * from "./autosheet-worn-slots.ts";\n'],
  ]);
}

async function writeOutputs(outputs) {
  await mkdir(generatedDirectory, { recursive: true });
  await Promise.all(
    [...outputs].map(async ([outputPath, contents]) =>
      writeFile(outputPath, contents, "utf8"),
    ),
  );
}

async function checkOutputs(outputs) {
  const stale = [];
  for (const [outputPath, expected] of outputs) {
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch {
      stale.push(path.relative(repositoryRoot, outputPath));
      continue;
    }
    // Git may check out tracked generated files with CRLF on Windows. Their
    // content is fresh when only the platform line endings differ.
    if (actual.replace(/\r\n/g, "\n") !== expected.replace(/\r\n/g, "\n"))
      stale.push(path.relative(repositoryRoot, outputPath));
  }
  if (stale.length)
    throw new Error(
      `Autosheet generated rules data is stale. Run \`pnpm rules:import-autosheet\`.\n${stale.join("\n")}`,
    );
}

async function main() {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !["--write", "--check"].includes(mode[0])) {
    throw new Error("Usage: node scripts/import-autosheet.mjs --write|--check");
  }
  const outputs = await expectedOutputs();
  if (mode[0] === "--write") {
    await writeOutputs(outputs);
    process.stdout.write(
      `Imported Autosheet rules data (${outputs.size} generated files).\n`,
    );
  } else {
    await checkOutputs(outputs);
    process.stdout.write("Autosheet generated rules data is fresh.\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export { expectedOutputs, generate };
