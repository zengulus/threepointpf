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
    // The panel shows the natural face, the automatic rule and the semantic
    // outcome the server returned; it derives none of them.
    expect(script).toContain("function outcomeLabel(resolved)");
    expect(script).toContain("outcome.kind");
    expect(script).toContain("step.criticalRange.minimumNaturalRoll");
    expect(script).not.toMatch(/minimumNaturalRoll\s*[-+]/);
    expect(script).toContain('WebRequest.custom(API_BASE .. "/roll-plan", "POST", true');
    expect(script).toContain('WebRequest.custom(API_BASE .. "/resolve-roll", "POST", true');
    expect(script).toContain('"GET", true, "", authHeaders()');
    expect(script).not.toContain("WebRequest.get(");
    expect(script).not.toContain("WebRequest.post(");
    expect(script).not.toContain("end, authHeaders())");
    // No rules arithmetic may live in the Lua client.
    expect(script).not.toMatch(/bonusType|applicability|scaling/);
  });

  it("is gated off, so new roll families are not wired into it by accident", () => {
    const script = readFileSync("tts/src/global.lua", "utf8");
    // The client says out loud that it is deferred at its frozen scope, so
    // nothing here is treated as a live parity target.
    expect(script).toContain("DEFERRED (do this later)");
    expect(script).toContain("docs/open-decisions.md");
    // Damage and initiative plans exist server-side but stay out of the frozen
    // client; wiring either in here means deliberately un-gating it.
    expect(script).not.toContain('kind = "damage"');
    expect(script).not.toContain('kind = "initiative"');
  });
});
