import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TTS advancement roll-plan contract", () => {
  it("requests the character attack id returned by the authoritative state endpoint", () => {
    const script = readFileSync("tts/src/global.lua", "utf8");
    expect(script).toContain("CHARACTER_ATTACK_IDS[characterId] = attack.id");
    expect(script).toContain("CHARACTER_ATTACK_INDICES[requestedCharacterId] = 0");
    expect(script).toContain("local attackId = CHARACTER_ATTACK_IDS[characterId]");
    expect(script).toContain("local attackIndex = CHARACTER_ATTACK_INDICES[characterId] or 0");
    expect(script).toContain('displayResult("Attack unavailable; wait for character state")');
    // The client asks for one explicit action and one member of that action's
    // sequence; it never sends a modifier.
    expect(script).toContain(
      'requestPlan({ kind = "attack", attackId = attackId, attackIndex = attackIndex, action = CHARACTER_ATTACK_MODES[characterId] or "fullAttack" }, value, characterId)',
    );
    expect(script).toContain("attackIndex = request.attackIndex");
    expect(script).toContain("action = request.action");
    expect(script).toContain("maneuver = request.maneuver");
    expect(script).toContain("function toggleAttackMode(player, value, id)");
    expect(script).toContain("function attackSteps(characterId)");
    expect(script).not.toContain("CHARACTER_ATTACK_IDS[characterId] or id");
    expect(script).toContain('"BAB " .. signed(state.bab or 0)');
    expect(script).toContain('WebRequest.custom(API_BASE .. "/roll-plan", "POST", true');
    expect(script).toContain('WebRequest.custom(API_BASE .. "/resolve-roll", "POST", true');
    expect(script).toContain('"GET", true, "", authHeaders()');
    expect(script).not.toContain("WebRequest.get(");
    expect(script).not.toContain("WebRequest.post(");
    expect(script).not.toContain("end, authHeaders())");
    // No rules arithmetic may live in the Lua client.
    expect(script).not.toMatch(/bonusType|applicability|scaling/);
  });
});
