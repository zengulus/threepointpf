import { describe, expect, it } from "vitest";
import { progressionCatalog, progressionOptions } from "./index.js";
import { progressionCatalogSchema } from "@threepointpf/rules-schema";

describe("Autosheet progression catalog", () => {
  it("validates the imported Fighter, Rogue, and Wizard class-chart chassis metadata", () => {
    expect(progressionCatalogSchema.parse(progressionCatalog)).toEqual(progressionCatalog);
    expect(progressionCatalog.fighter).toMatchObject({ hitDieSides: 10, babProgression: "full", saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2, source: { sheet: "Class Charts", row: 10 } });
    expect(progressionCatalog.rogue).toMatchObject({ hitDieSides: 8, babProgression: "threeQuarters", saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" }, skillPointsPerLevel: 8, source: { row: 19 } });
    expect(progressionCatalog.wizard).toMatchObject({ hitDieSides: 6, babProgression: "half", saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" }, skillPointsPerLevel: 2, source: { row: 26 } });
  });

  it("offers content separately from rules semantics", () => {
    expect(progressionOptions().map((definition) => definition.id)).toEqual(["fighter", "rogue", "wizard"]);
  });
});
