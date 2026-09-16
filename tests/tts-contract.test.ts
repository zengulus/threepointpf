import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TTS advancement roll-plan contract", () => {
  it("requests the character attack id returned by the authoritative state endpoint", () => {
    const script = readFileSync("tts/src/global.lua", "utf8");
    expect(script).toContain("CHARACTER_ATTACK_IDS[requestedCharacterId] = state.attacks[1].id");
    expect(script).toContain("local attackId = CHARACTER_ATTACK_IDS[characterId]");
    expect(script).toContain('displayResult("Attack unavailable; wait for character state")');
    expect(script).toContain('requestPlan({ kind = "attack", attackId = attackId }, value, characterId)');
    expect(script).not.toContain("CHARACTER_ATTACK_IDS[characterId] or id");
    expect(script).toContain('"BAB " .. signed(state.bab or 0)');
    expect(script).toContain('WebRequest.custom(API_BASE .. "/roll-plan", "POST", true');
    expect(script).toContain('WebRequest.custom(API_BASE .. "/resolve-roll", "POST", true');
    expect(script).toContain('"GET", true, "", authHeaders()');
    expect(script).not.toContain("WebRequest.get(");
    expect(script).not.toContain("WebRequest.post(");
    expect(script).not.toContain("end, authHeaders())");
  });
});
