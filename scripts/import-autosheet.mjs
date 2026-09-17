#!/usr/bin/env node
/**
 * Deterministically imports the non-spellcasting chassis and class-skill
 * facts in the supplied Pathfinder Autosheet.  The workbook is development
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

/**
 * Keep the import boundary visible in the generated report.  This importer is
 * deliberately narrow: the workbook also contains character-instance data,
 * spellcasting material, and spreadsheet formula references that are not a
 * stable progression catalog.
 */
const workbookSheetUsage = {
  "Welcome Page": {
    importStatus: "excluded",
    reason: "Workbook cover and instructions, not reusable rule content.",
  },
  "Main Sheet": {
    importStatus: "partial",
    reason:
      "Character-instance cells are not imported. Reviewed quick-toggle semantics are authored in src/content.ts with cell provenance.",
  },
  Equipment: {
    importStatus: "excluded",
    reason:
      "Character inventory layout, not an authoritative equipment corpus.",
  },
  "Spells, Spheres and other stuff": {
    importStatus: "excluded",
    reason:
      "Spellcasting and sphere material is outside this advancement import scope.",
  },
  "Class Charts": {
    importStatus: "imported",
    reason:
      "Non-spellcasting class chassis rows are imported from the bounded semantic region.",
    semanticRows: "3:295",
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
      "Age adjustments, XP thresholds, ability-based attack profiles and armor/shield chassis are generated. Quick toggles, straightforward conditions and explicit PRD equipment supplements are reviewed declarative content in src/content.ts. Contextual material combinations and remaining spreadsheet formulas are not executed.",
    semanticRows: "28:34,45:61,114:134,149:206",
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

const alternateConsolidatedColumns = new Set([
  "AS",
  "AT",
  "AU",
  "AV",
  "AW",
  "AX",
  "AY",
  "AZ",
  "BA",
  "BB",
  "BC",
  "BD",
]);
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
      rows.push({
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
      });
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
      alternateMarkers.push(column);
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
  return Object.fromEntries(
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
        if (armorMarker && armorMarker !== "Armor Penalty")
          warnings.push({
            kind: "unrecognized-skill-metadata-marker",
            skillId: id,
            source: { sheet: classSkillsSheetName, range: `${column}4` },
            message: `Ignored ${JSON.stringify(armorMarker)} in the armor-penalty row; only the explicit Armor Penalty label is recognized.`,
          });
        return [
          id,
          {
            id,
            name,
            governingAbility,
            ...(trainedMarker ? { trainedOnly: true } : {}),
            ...(armorMarker === "Armor Penalty"
              ? { armorCheckPenalty: true }
              : {}),
            source: { ...source, range: `${column}1:${column}4` },
          },
        ];
      },
    ),
  );
}

function buildEquipmentCatalog(sheet, warnings, unsupported) {
  if (
    !sheet ||
    cellValue(sheet, "B", 149) !== "AC Bonus" ||
    cellValue(sheet, "C", 149) !== "Max Dex"
  )
    throw new Error("Unexpected Formula References armor table headers");
  const catalog = {};
  const physicalRows = [
    153,
    ...Array.from({ length: 41 }, (_, i) => 156 + i),
    200,
    201,
    202,
    203,
    204,
    206,
  ];
  for (const row of physicalRows) {
    const name = asText(cellValue(sheet, "A", row));
    if (!name || typeof cellValue(sheet, "B", row) !== "number") continue; // bounded section headings and blank separators
    const bonus = cellValue(sheet, "B", row);
    const dex = cellValue(sheet, "C", row);
    const penalty = cellValue(sheet, "D", row);
    const failure = cellValue(sheet, "E", row);
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
      !shield &&
      !["Unarmored", "Light", "Medium", "Heavy"].includes(category)
    )
      throw new Error(`Unrecognized armor category ${category} at row ${row}`);
    const id = `pf1e.autosheet.${slug(name)}`;
    if (catalog[id]) throw new Error(`Duplicate equipment id ${id}`);
    catalog[id] = {
      id,
      name,
      kind: shield ? "shield" : "armor",
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
      reduceLandSpeed: ["Medium", "Heavy"].includes(category),
      arcaneSpellFailureChance: Math.round(failure * 1000) / 1000,
      source: {
        document: documentName,
        sheet: "Formula References",
        row,
        range: `A${row}:I${row}`,
        system: "PF1e",
        category: `${category} / ${asText(cellValue(sheet, "G", row))}`,
      },
    };
  }
  warnings.push({
    kind: "armor-table-normalization",
    source: { sheet: "Formula References", range: "A149:I206" },
    message:
      "Positive check-penalty magnitudes become negative contributions; blank Max Dex means unlimited (zero remains zero). Medium/heavy armor reduces land speed. Spell-failure percentage is retained as metadata only. Column I is weight category, not pounds, and is never imported as weight. Item-specific maneuvers, proficiency and material combinations require contextual rules.",
  });
  for (const [row, reason] of [
    [151, "Mage Armor is a spell effect, not worn equipment."],
    [
      152,
      "Bracers of Armor has a parameterized +0 placeholder, not a complete item.",
    ],
    [154, "Unarmored Training depends on a separate feat."],
    [205, "Shield is a spell effect, not a physical shield."],
  ])
    unsupported.push({
      kind: "non-equipment-armor-row",
      name: asText(cellValue(sheet, "A", row)),
      source: { sheet: "Formula References", row },
      reason,
    });
  unsupported.push({
    kind: "contextual-equipment-materials",
    source: { sheet: "Formula References", range: "A208:I232" },
    reason:
      "Material/attachment combinations require item-specific eligibility and interaction rules; raw modifiers are not applied globally. Custom items can author their final numeric chassis.",
  });
  if (Object.keys(catalog).length !== 45)
    throw new Error(
      `Expected 45 physical armor/shield rows, found ${Object.keys(catalog).length}`,
    );
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
  warnings.push({
    kind: "attack-profile-normalization",
    source: { sheet: "Formula References", range: "C45:AB61" },
    message:
      "Ability pairs and 0.5/1/1.5 ratios are extracted from a closed label grammar, never cached character totals. Secondary natural attacks default to −5; an authored +3 adjustment can represent an independently qualified −2 case. Names describe prerequisite-dependent profiles, not automatic feat grants. Off-hand/single/natural profiles do not gain BAB iteratives. Haste eligibility is explicit; combined multiweapon sequences remain contextual.",
  });
  unsupported.push({
    kind: "contextual-attack-profiles",
    source: { sheet: "Formula References", range: "O45:V61,AD45:AF58" },
    reason:
      "Maneuver training, flurry, kineticist and spell-based attack variants require class/ability/roll-context semantics beyond ordinary ability-based weapon profiles; their cached character formulas are not imported.",
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
  return workbook.SheetNames.map((name) => ({
    name,
    state: sheetState(workbook, name),
    bounds: workbook.Sheets[name]?.["!ref"] ?? null,
    ...(workbookSheetUsage[name] ?? {
      importStatus: "excluded",
      reason:
        "Unrecognized workbook sheet; excluded until an explicit deterministic mapping is added.",
    }),
  }));
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
    if (!classSkillsEntry) {
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

    const chart = makeProgressionChart(record);
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
      ...(classSkillsEntry ? { classSkills: classSkillResult.ids } : {}),
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
        : {}),
    };
    progressionCatalog[record.id] = progression;
    for (const skillId of classSkillResult?.ids ?? [])
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
        : {}),
    });
  }

  const skillCatalog = buildSkillCatalog(
    classSkillsSheet,
    normalizedOrWarnedRows,
  );
  const equipmentCatalog = buildEquipmentCatalog(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
    unsupportedRows,
  );
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
  const attackProfileCatalog = buildAttackProfiles(
    workbook.Sheets["Formula References"],
    normalizedOrWarnedRows,
    unsupportedRows,
  );
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
      generatedSkillDefinitions: Object.keys(skillCatalog).length,
      generatedEquipmentDefinitions: Object.keys(equipmentCatalog).length,
      generatedExperienceTracks: Object.keys(experienceCatalog).length,
      generatedAgeFeatures: Object.keys(ageFeatureCatalog).length,
      generatedAttackProfiles: Object.keys(attackProfileCatalog).length,
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
        ignoredAlternateConsolidatedColumns: alternateMetadata,
      },
      aliases,
    },
    successfulRows,
    equipmentRows: Object.values(equipmentCatalog).map(
      ({ id, name, source }) => ({ equipmentId: id, name, source }),
    ),
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
    normalizedOrWarnedRows,
    unsupportedRows,
    failures: [],
  };

  return {
    progressionCatalog: schemas.parseProgressionCatalog(progressionCatalog),
    skillCatalog: schemas.parseSkillCatalog(skillCatalog),
    equipmentCatalog: schemas.equipmentCatalogSchema.parse(equipmentCatalog),
    experienceCatalog: schemas.experienceCatalogSchema.parse(experienceCatalog),
    ageFeatureCatalog: schemas.featureCatalogSchema.parse(ageFeatureCatalog),
    attackProfileCatalog:
      schemas.attackProfileCatalogSchema.parse(attackProfileCatalog),
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
    experienceCatalog,
    ageFeatureCatalog,
    attackProfileCatalog,
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
    if (actual !== expected)
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export { expectedOutputs, generate };
