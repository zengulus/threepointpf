import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput } from "@threepointpf/rules-schema";
import { createCharacterRollPlan } from "@threepointpf/shared";
import { resolveRollPlan } from "@threepointpf/dice";

// A dev-only Lua VM executes the actual checked-in script. TTS's UI, HTTP and
// physical dice host APIs are mocked, not the Lua client code under test.
const { lua, lauxlib, lualib, to_luastring } = createRequire(import.meta.url)("fengari");
const script = readFileSync("tts/src/global.lua", "utf8");
const fixture = JSON.parse(readFileSync("tests/fixtures/simple-character.json", "utf8"));
const character = parseCharacterInput({ ...fixture, equipment: [{ id: "second-weapon", definitionId: "pf1e.paizo.rapier", equipped: true }] });
const derived = new RulesEngine(character, rulesCatalogs).derive();
const plan = createCharacterRollPlan(character, { characterId: character.id, kind: "attack", attackId: "equipment.second-weapon", attackIndex: 1 }, rulesCatalogs);
const state = {
  name: character.name, currentHp: derived.currentHp, maxHp: derived.maxHp.value,
  ac: derived.ac.value, bab: derived.bab.value, saves: Object.fromEntries(Object.entries(derived.saves).map(([key, result]) => [key, result.value])),
  attacks: derived.attacks.map((attack) => ({ id: attack.definition.id, name: attack.definition.name, modifier: attack.attack.value, fullAttack: attack.fullAttack.map((strike) => strike.value), steps: attack.action.attacks[0].steps.map((step) => ({ index: step.index, role: step.role, modifier: step.modifier, rollId: step.roll.id, criticalRange: step.roll.criticalRange })) })),
};

function literal(value: unknown): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  return "{" + Object.entries(value).map(([key, item]) => `[${Array.isArray(value) ? Number(key) + 1 : JSON.stringify(key)}]=${literal(item)}`).join(",") + "}";
}

function execute(assertions: string): void {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const host = `
    attrs = {}; requests = {}; planFailure = false
    serverState = ${literal(state)}
    serverPlan = ${literal(plan)}
    serverResult = ${literal(resolveRollPlan(plan, [17]))}
    UI = { setXml = function(xml) assert(string.find(xml, 'nextStrike')) end,
      setAttribute = function(id, key, value) attrs[id .. ':' .. key] = value end }
    JSON = { encode = function(value) return value end,
      decode = function(text)
        if text == 'state' then return serverState end
        if text == 'plan' then return { plan = serverPlan } end
        if text == 'resolved' then return { resolved = serverResult } end
        error('Unexpected response')
      end }
    WebRequest = { custom = function(url, method, download, body, headers, callback)
      assert(headers.Authorization == 'Bearer test-token')
      requests[#requests + 1] = { url = url, method = method, body = body }
      local response = string.find(url, '/character%-state') and 'state' or string.find(url, '/roll%-plan') and 'plan' or 'resolved'
      callback({ is_error = planFailure and response == 'plan', response_code = 200, text = response })
    end }
    spawnObject = function(options)
      assert(options.type == 'Die_D20')
      options.callback_function({ randomize = function() end, destruct = function() end,
        getVelocity = function() return { x = 0, y = 0, z = 0 } end,
        getAngularVelocity = function() return { x = 0, y = 0, z = 0 } end,
        getValue = function() return 17 end })
    end
  `;
  try {
    const status = lauxlib.luaL_dostring(L, to_luastring(host + "\n" + script + `\nAPI_TOKEN = 'test-token'; CHARACTER_ID = ${literal(character.id)}; player = { steam_id = 'test-player' }; onLoad()\n` + assertions));
    if (status !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
    expect(status).toBe(lua.LUA_OK);
  } finally { lua.lua_close(L); }
}

describe("executed TTS Lua client", () => {
  it("selects a real equipment weapon/strike, preserves its authoritative plan, and sends only raw die faces", () => {
    execute(`
      nextAttack(player, '', '')
      nextStrike(player, '', '')
      assert(CHARACTER_ATTACK_IDS[CHARACTER_ID] == 'equipment.second-weapon')
      assert(CHARACTER_ATTACK_INDICES[CHARACTER_ID] == 1)
      assert(string.find(attrs[PANEL_ID .. '-attack:text'], '[2/2]', 1, true))
      rollAttack(player, 'Rapier', 'greatsword')
      local request = requests[#requests].body
      assert(request.attackId == serverPlan.context.attackId and request.attackIndex == 1)
      -- The client sends its situation, never a modifier.
      assert(request.action == 'fullAttack' and request.defense == nil)
      assert(request.modifier == nil and request.characterId == CHARACTER_ID)
      assert(rollBusy and pendingPlan == serverPlan)
      local requestCount = #requests
      rollAttack(player, 'Second roll', 'greatsword')
      assert(#requests == requestCount)
      for frame = 1, 15 do onUpdate() end
      local submission = requests[#requests].body
      assert(#submission.faces == 1 and submission.faces[1] == 17)
      assert(submission.plan.context.action.sequenceIndex == 1)
      assert(not rollBusy and pendingPlan == nil)
      -- The panel reports the natural face and semantic outcome, not just a total.
      assert(attrs[PANEL_ID .. '-status:text'] == 'Rapier: ' .. tostring(serverResult.total) .. ' · ' .. serverResult.outcome.kind)
    `);
  });

  it("wraps choices and refuses stale attack requests after an empty authoritative refresh", () => {
    execute(`
      nextAttack(player, '', '')
      nextStrike(player, '', '')
      nextStrike(player, '', '')
      assert(CHARACTER_ATTACK_INDICES[CHARACTER_ID] == 0)
      nextAttack(player, '', '')
      assert(CHARACTER_ATTACK_POSITIONS[CHARACTER_ID] == 1)
      serverState.attacks = {}
      fetchCharacterState()
      assert(CHARACTER_ATTACK_IDS[CHARACTER_ID] == nil)
      local count = #requests
      rollAttack(player, 'Unavailable', 'greatsword')
      assert(#requests == count and not rollBusy)
      assert(attrs['greatsword:active'] == 'false')
    `);
  });

  it("releases the physical-roll lock after a plan failure so the user can retry", () => {
    execute(`
      planFailure = true
      rollAttack(player, 'Failed', 'greatsword')
      assert(not rollBusy)
      local count = #requests
      rollAttack(player, 'Retry', 'greatsword')
      assert(#requests == count + 1 and not rollBusy)
    `);
  });
});
