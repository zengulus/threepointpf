import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Edge roll authority contract", () => {
  it("rebuilds plans from the submitted context and advertises its CORS methods", () => {
    const resolveRoll = readFileSync("supabase/functions/resolve-roll/index.ts", "utf8");
    const rollPlan = readFileSync("supabase/functions/roll-plan/index.ts", "utf8");
    const characterState = readFileSync("supabase/functions/character-state/index.ts", "utf8");
    const http = readFileSync("supabase/functions/_shared/http.ts", "utf8");
    // The submitted plan is rebuilt from its own context: every roll family the
    // endpoint supports names an explicit context field, and nothing else is
    // used to guess what was rolled.
    expect(resolveRoll).toContain("function requestForContext(");
    expect(resolveRoll).toContain("context.saveId");
    expect(resolveRoll).toContain("context.skillId");
    expect(resolveRoll).toContain("context.attackId");
    expect(resolveRoll).toContain("attackIndex: context.action.sequenceIndex ?? 0");
    expect(resolveRoll).toContain("action: context.action.kind");
    // Damage and initiative plans rebuild from their own context too, so a
    // critical damage roll stays authoritative instead of client-doubled.
    expect(resolveRoll).toContain('context.kind === "damage"');
    expect(resolveRoll).toContain('context.kind === "initiative"');
    expect(resolveRoll).toContain('kind: "damage"');
    expect(resolveRoll).toContain('kind: "initiative"');
    expect(resolveRoll).toContain("criticalDamage: true");
    // A submitted plan is never trusted for arithmetic.
    expect(resolveRoll).not.toContain("body.plan.modifier");
    expect(resolveRoll).not.toContain("plan.metadata");
    expect(resolveRoll).toContain("Unsupported roll plan");
    for (const source of [characterState, rollPlan, resolveRoll]) {
      expect(source).toContain("rulesCatalogs");
      expect(source).toContain("loadCharacter(");
    }
    // The authoritative state endpoint forwards each step's own roll and the
    // threat range it was evaluated with.
    expect(characterState).toContain("rollId: step.roll.id");
    expect(characterState).toContain("criticalRange: step.roll.criticalRange ?? null");
    expect(http).toContain('"Access-Control-Allow-Methods": "GET, POST, OPTIONS"');
  });
});
