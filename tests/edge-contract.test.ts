import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Edge roll authority contract", () => {
  it("only reconstructs exact supported save targets and advertises its CORS methods", () => {
    const resolveRoll = readFileSync("supabase/functions/resolve-roll/index.ts", "utf8");
    const rollPlan = readFileSync("supabase/functions/roll-plan/index.ts", "utf8");
    const characterState = readFileSync("supabase/functions/character-state/index.ts", "utf8");
    const http = readFileSync("supabase/functions/_shared/http.ts", "utf8");
    expect(resolveRoll).toContain('saveIds.find((id) => metadata.target === `save.${id}`)');
    expect(resolveRoll).not.toContain('metadata.target.startsWith("save.")');
    expect(resolveRoll).toContain("attackIndex: metadata.attackIndex ?? 0");
    for (const source of [characterState, rollPlan, resolveRoll]) {
      expect(source).toContain("rulesCatalogs");
      expect(source).toContain("loadCharacter(");
    }
    expect(http).toContain('"Access-Control-Allow-Methods": "GET, POST, OPTIONS"');
  });
});
