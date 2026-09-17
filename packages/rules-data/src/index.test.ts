import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  progressionAliases,
  autosheetEquipmentCatalog,
  progressionCatalog,
  progressionOptions,
  rulesCatalogs,
  skillCatalog,
} from "./index.js";
import { progressionCatalogSchema, skillCatalogSchema } from "@threepointpf/rules-schema";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const importScript = resolve(repositoryRoot, "scripts/import-autosheet.mjs");
const reportPath = resolve(repositoryRoot, "packages/rules-data/src/generated/autosheet-import-report.json");

describe("Autosheet generated rules data", () => {
  it("imports every safely parseable Class Charts progression under source-qualified ids", () => {
    expect(progressionCatalogSchema.parse(progressionCatalog)).toEqual(progressionCatalog);
    expect(Object.keys(progressionCatalog)).toHaveLength(259);
    expect(Object.keys(progressionCatalog).every((id) => id.split(".").length >= 3)).toBe(true);

    expect(progressionCatalog["pf1e.paizo.fighter"]).toMatchObject({
      id: "pf1e.paizo.fighter",
      name: "Fighter",
      hitDieSides: 10,
      babProgression: "full",
      saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" },
      skillPointsPerLevel: 2,
      aliases: ["fighter"],
      source: { sheet: "Class Charts", row: 10, category: "Base" },
      classSkillsSource: { sheet: "Class Skills", row: 12 },
    });
    expect(progressionCatalog["pf1e.paizo.rogue"]).toMatchObject({ aliases: ["rogue"], source: { row: 19 }, classSkillsSource: { row: 21 } });
    expect(progressionCatalog["pf1e.paizo.wizard"]).toMatchObject({ aliases: ["wizard"], source: { row: 26 }, classSkillsSource: { row: 26 } });
    expect(progressionAliases).toEqual({
      fighter: "pf1e.paizo.fighter",
      rogue: "pf1e.paizo.rogue",
      wizard: "pf1e.paizo.wizard",
    });
  });

  it("keeps workbook-specific prestige save schedules as explicit, bounded charts", () => {
    const agent = progressionCatalog["pf1e.paizo.agent-of-the-grave"];
    expect(agent?.saveProgressions).toEqual({ fortitude: "prestigeGood", reflex: "prestigePoor", will: "prestigeGood" });
    expect(agent?.chart).toHaveLength(5);
    expect(agent?.chart?.[0]).toEqual({ level: 1, bab: 0, saves: { fortitude: 1, reflex: 0, will: 1 } });
    expect(agent?.chart?.[1]).toEqual({ level: 2, bab: 1, saves: { fortitude: 1, reflex: 1, will: 1 } });
    expect(progressionCatalog["pf1e.paizo.mystery-cultist"]?.classSkills).toBeUndefined();
    expect(progressionCatalog["pf1e.paizo.sentinel"]?.classSkills).toBeUndefined();
  });

  it("exposes the classic skill metadata and the imported class-skill sets", () => {
    expect(skillCatalogSchema.parse(skillCatalog)).toEqual(skillCatalog);
    expect(skillCatalog).toMatchObject({
      acrobatics: { governingAbility: "dex", armorCheckPenalty: true },
      "knowledge-arcana": { governingAbility: "int", trainedOnly: true },
      "knowledge-martial": { governingAbility: "int", trainedOnly: true },
      repair: { governingAbility: "int" },
    });
    expect(progressionCatalog["pf1e.paizo.fighter"]?.classSkills).toEqual(expect.arrayContaining(["climb", "craft", "knowledge-engineering", "ride"]));
    expect(progressionCatalog["pf1e.dreamscarred-press.path-of-war.stalker"]?.classSkills).toContain("knowledge-martial");
    expect(progressionCatalog["ffd20.autosheet.engineer"]?.classSkills).toEqual(expect.arrayContaining(["knowledge-technology", "repair"]));
  });

  it("keeps content injected separately from rules semantics", () => {
    expect(progressionOptions()).toHaveLength(259);
    expect(progressionOptions().map((definition) => definition.id)).toContain("pf1e.paizo.fighter");
    expect(rulesCatalogs.progressionCatalog).toBe(progressionCatalog);
    expect(rulesCatalogs.skillCatalog).toBe(skillCatalog);
  });

  it("imports armor tables without confusing zero caps, blanks, and weight categories", () => {
    expect(Object.keys(autosheetEquipmentCatalog)).toHaveLength(45);
    expect(autosheetEquipmentCatalog["pf1e.autosheet.chain-shirt"]).toMatchObject({ armorCheckPenalty: -2, maxDexterity: 4, arcaneSpellFailureChance: 0.2, source: { sheet: "Formula References", row: 169 } });
    expect(autosheetEquipmentCatalog["pf1e.autosheet.half-plate"]).toMatchObject({ maxDexterity: 0, reduceLandSpeed: true });
    expect(autosheetEquipmentCatalog["pf1e.autosheet.buckler"]?.maxDexterity).toBeUndefined();
    expect(autosheetEquipmentCatalog["pf1e.autosheet.full-plate"]?.weight).toBeUndefined();
    expect(autosheetEquipmentCatalog["pf1e.autosheet.tower-shield"]?.kind).toBe("shield");
  });

  it("records source bounds, safe omissions, and deterministic generated freshness", () => {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.input.sha256).toBe("bf1fe035fe70688b0c7406308252a6c10013d2ce3220c7f21241fb55233d71b8");
    expect(report.summary).toMatchObject({
      safelyParseableClassChartRows: 259,
      generatedProgressions: 259,
      generatedEquipmentDefinitions: 45,
      progressionsWithClassSkills: 257,
      explicitPrestigeCharts: 89,
      classChartCategories: {
        Base: 28,
        "Paizo Prestige": 89,
        "3PP-Martial": 9,
        FFd20: 38,
      },
    });
    expect(report.summary.classSkills).toMatchObject({
      joinStrategy: expect.stringContaining("NFKC/case-folded"),
      rowsBySection: { "PRESTIGE CLASSES": 87, "3PP PATH OF WAR": 3 },
      classicColumns: { B: "acrobatics", BG: "autohypnosis", BH: "knowledge-psionics" },
      contextualColumns: { "3PP PATH OF WAR": { AN: "knowledge-martial" } },
    });
    expect(report.input.workbook.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Class Charts", state: "visible", bounds: "A1:AR633" }),
      expect.objectContaining({ name: "Class Skills", state: "hidden", bounds: "A1:BH366" }),
    ]));
    expect(report.input.workbook.sheets).toHaveLength(8);
    expect(report.input.workbook.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Spells, Spheres and other stuff", importStatus: "excluded" }),
      expect.objectContaining({ name: "Formula References", importStatus: "partial", bounds: "A1:AF323" }),
      expect.objectContaining({ name: "Changelog", state: "hidden", bounds: "A1:C1006" }),
    ]));
    expect(report.unsupportedRows.filter((row: { kind: string }) => row.kind === "missing-class-skills").map((row: { name: string }) => row.name)).toEqual(["Mystery Cultist", "Sentinel"]);
    expect(() => execFileSync(process.execPath, [importScript, "--check"], { cwd: repositoryRoot, stdio: "pipe" })).not.toThrow();
  });
});
