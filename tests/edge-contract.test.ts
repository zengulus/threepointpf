import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Edge roll authority contract", () => {
  it("only reconstructs exact supported save targets and advertises its CORS methods", () => {
    const resolveRoll = readFileSync("supabase/functions/resolve-roll/index.ts", "utf8");
    const http = readFileSync("supabase/functions/_shared/http.ts", "utf8");
    expect(resolveRoll).toContain('saveIds.find((id) => metadata.target === `save.${id}`)');
    expect(resolveRoll).not.toContain('metadata.target.startsWith("save.")');
    expect(http).toContain('"Access-Control-Allow-Methods": "GET, POST, OPTIONS"');
  });
});
