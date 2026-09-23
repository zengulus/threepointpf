-- 3.PF Tabletop Simulator client.
-- This script is intentionally a thin, untrusted client: it never calculates a rule.
--
-- DEFERRED (do this later): frozen at its MVP scope -- saves, one authoritative
-- attack member with a standard/full choice, maneuvers, one physical d20. New
-- roll families (initiative, damage) and multi-die plans are deliberately not
-- wired in here. See the TTS gate in docs/open-decisions.md before extending it.

API_BASE = "https://YOUR-SITE.example/api"
API_TOKEN = "" -- Deferred prototype credential; keep secrets out of source control.
CHARACTER_ID = "human-martial"
PANEL_ID = "threepf-panel"
PLAYER_CHARACTERS = {} -- steam_id -> character id; populate through bindPlayer below.
CHARACTER_ATTACK_IDS = {} -- character id -> authoritative displayed attack id
CHARACTER_ATTACK_INDICES = {} -- character id -> zero-based sequence member displayed by this panel
CHARACTER_ATTACK_MODES = {} -- character id -> "fullAttack" | "standardAttack"
CHARACTER_ATTACKS = {} -- authoritative rows; Lua never derives attack modifiers
CHARACTER_ATTACK_POSITIONS = {} -- character id -> one-based weapon choice
pendingPlan = nil
pendingDie = nil
settledFrames = 0
rollBusy = false -- one physical roll at a time; never overwrite an in-flight plan

function onLoad()
    math.randomseed(os.time())
    UI.setXml(UI_XML)
    fetchCharacterState()
end

function authHeaders()
    return { ["Authorization"] = "Bearer " .. API_TOKEN, ["Content-Type"] = "application/json" }
end

-- Called by a GM button, notebook, or another mod to associate a player with a sheet.
function bindPlayer(player, characterId)
    PLAYER_CHARACTERS[player.steam_id] = characterId
    fetchCharacterState(characterId)
end

function characterForPlayer(player)
    return PLAYER_CHARACTERS[player.steam_id] or CHARACTER_ID
end

function fetchCharacterState(characterId)
    local requestedCharacterId = characterId or CHARACTER_ID
    WebRequest.custom(API_BASE .. "/character-state?characterId=" .. requestedCharacterId, "GET", true, "", authHeaders(), function(request)
        if request.is_error or request.response_code < 200 or request.response_code >= 300 then
            UI.setAttribute(PANEL_ID .. "-status", "text", "State unavailable")
            return
        end
        local ok, state = pcall(JSON.decode, request.text)
        if ok and state then
            UI.setAttribute(PANEL_ID .. "-name", "text", state.name or "Character")
            local temporary = (state.temporaryHp or 0) > 0 and ("  +" .. tostring(state.temporaryHp) .. " temp") or ""
            UI.setAttribute(PANEL_ID .. "-hp", "text", "HP  " .. tostring(state.currentHp) .. " / " .. tostring(state.maxHp) .. temporary)
            UI.setAttribute(PANEL_ID .. "-ac", "text", "AC  " .. tostring(state.ac))
            UI.setAttribute(PANEL_ID .. "-bab", "text", "BAB " .. signed(state.bab or 0))
            UI.setAttribute(PANEL_ID .. "-fort", "text", "Fort  " .. signed(state.saves.fortitude))
            UI.setAttribute(PANEL_ID .. "-ref", "text", "Ref   " .. signed(state.saves.reflex))
            UI.setAttribute(PANEL_ID .. "-will", "text", "Will  " .. signed(state.saves.will))
            CHARACTER_ATTACKS[requestedCharacterId] = state.attacks or {}
            CHARACTER_ATTACK_POSITIONS[requestedCharacterId] = 1
            CHARACTER_ATTACK_INDICES[requestedCharacterId] = 0
            CHARACTER_ATTACK_MODES[requestedCharacterId] = CHARACTER_ATTACK_MODES[requestedCharacterId] or "fullAttack"
            displayAttack(requestedCharacterId)
        end
    end)
end

-- The authoritative steps of an action. `steps` carries an explicit role per
-- member; older payloads expose the full-attack values only.
function attackSteps(characterId)
    local rows = CHARACTER_ATTACKS[characterId] or {}
    local attack = rows[CHARACTER_ATTACK_POSITIONS[characterId] or 1]
    if not attack then return nil, nil end
    local mode = CHARACTER_ATTACK_MODES[characterId] or "fullAttack"
    if mode == "standardAttack" then
        return attack, { { modifier = attack.modifier or 0, role = "primary" } }
    end
    if attack.steps then return attack, attack.steps end
    local steps = {}
    for index, value in ipairs(attack.fullAttack or { attack.modifier }) do
        steps[index] = { modifier = value, role = index == 1 and "primary" or "iterative" }
    end
    return attack, steps
end

function displayAttack(characterId)
    local attack, steps = attackSteps(characterId)
    if not attack then
        CHARACTER_ATTACK_IDS[characterId] = nil
        UI.setAttribute(PANEL_ID .. "-attack", "text", "No attack available")
        UI.setAttribute("greatsword", "active", "false")
        return
    end
    local attackIndex = CHARACTER_ATTACK_INDICES[characterId] or 0
    if not steps[attackIndex + 1] then attackIndex = 0 end
    CHARACTER_ATTACK_IDS[characterId] = attack.id
    CHARACTER_ATTACK_INDICES[characterId] = attackIndex
    local step = steps[attackIndex + 1]
    -- The threat range is authored content, never inferred from a weapon name.
    local threat = step.criticalRange and ("  threat " .. tostring(step.criticalRange.minimumNaturalRoll) .. "-20") or ""
    UI.setAttribute(PANEL_ID .. "-attack", "text", attack.name .. " [" .. tostring(attackIndex + 1) .. "/" .. tostring(#steps) .. "] " .. (step.role or "primary") .. " " .. signed(step.modifier) .. threat)
    UI.setAttribute("greatsword", "active", "true")
end

-- The natural face and the semantic outcome stay separate facts on screen.
function outcomeLabel(resolved)
    local outcome = resolved.outcome
    if not outcome then return tostring(resolved.total) end
    local parts = { tostring(resolved.total) }
    if outcome.natural20 then parts[#parts + 1] = "natural 20" elseif outcome.natural1 then parts[#parts + 1] = "natural 1" end
    if outcome.automaticHit or outcome.automaticSuccess then parts[#parts + 1] = "automatic" end
    parts[#parts + 1] = tostring(outcome.kind)
    return table.concat(parts, " · ")
end

-- Standard attack vs full attack is an explicit action choice, not a
-- modifier the client may invent.
function toggleAttackMode(player, value, id)
    local characterId = characterForPlayer(player)
    CHARACTER_ATTACK_MODES[characterId] = (CHARACTER_ATTACK_MODES[characterId] or "fullAttack") == "fullAttack" and "standardAttack" or "fullAttack"
    CHARACTER_ATTACK_INDICES[characterId] = 0
    displayAttack(characterId)
end

function nextAttack(player, value, id)
    local characterId = characterForPlayer(player)
    local rows = CHARACTER_ATTACKS[characterId] or {}
    if #rows == 0 then displayResult("Attack unavailable; wait for character state") return end
    CHARACTER_ATTACK_POSITIONS[characterId] = (CHARACTER_ATTACK_POSITIONS[characterId] or 1) % #rows + 1
    CHARACTER_ATTACK_INDICES[characterId] = 0
    displayAttack(characterId)
end

function nextStrike(player, value, id)
    local characterId = characterForPlayer(player)
    local rows = CHARACTER_ATTACKS[characterId] or {}
    local attack = rows[CHARACTER_ATTACK_POSITIONS[characterId] or 1]
    if not attack then displayResult("Attack unavailable; wait for character state") return end
    local _, steps = attackSteps(characterId)
    CHARACTER_ATTACK_INDICES[characterId] = ((CHARACTER_ATTACK_INDICES[characterId] or 0) + 1) % #steps
    displayAttack(characterId)
end

function signed(value)
    if value >= 0 then return "+" .. tostring(value) end
    return tostring(value)
end

function rollSave(player, value, id)
    requestPlan({ kind = "save", saveId = id }, value, characterForPlayer(player))
end

function rollAttack(player, value, id)
    -- The static UI button id is not a character attack id. The server remains
    -- rules authority, but TTS must request the selected authoritative row.
    local characterId = characterForPlayer(player)
    local attackId = CHARACTER_ATTACK_IDS[characterId]
    local attackIndex = CHARACTER_ATTACK_INDICES[characterId] or 0
    if not attackId then
        displayResult("Attack unavailable; wait for character state")
        return
    end
    requestPlan({ kind = "attack", attackId = attackId, attackIndex = attackIndex, action = CHARACTER_ATTACK_MODES[characterId] or "fullAttack" }, value, characterId)
end

function rollManeuver(player, value, id)
    requestPlan({ kind = "maneuver", maneuver = id }, value, characterForPlayer(player))
end

function requestPlan(request, label, characterId)
    if rollBusy then displayResult("Finish the current roll first") return end
    rollBusy = true
    local body = { characterId = characterId or CHARACTER_ID, kind = request.kind, saveId = request.saveId, attackId = request.attackId, attackIndex = request.attackIndex, action = request.action, maneuver = request.maneuver }
    WebRequest.custom(API_BASE .. "/roll-plan", "POST", true, JSON.encode(body), authHeaders(), function(response)
        if response.is_error or response.response_code < 200 or response.response_code >= 300 then rollBusy = false displayResult(label .. ": plan unavailable") return end
        local ok, decoded = pcall(JSON.decode, response.text)
        if not ok or not decoded or not decoded.plan then rollBusy = false displayResult(label .. ": invalid plan") return end
        pendingPlan = decoded.plan
        pendingPlan.displayLabel = label
        spawnPhysicalDice()
    end)
end

function spawnPhysicalDice()
    if pendingDie then pendingDie.destruct() pendingDie = nil end
    settledFrames = 0
    local requirement = pendingPlan.dice[1]
    if not requirement or requirement.sides ~= 20 or requirement.count ~= 1 then
        rollBusy = false
        pendingPlan = nil
        displayResult("Only one physical d20 is supported in this MVP")
        return
    end
    spawnObject({ type = "Die_D20", position = { 0, 2, 0 }, rotation = { math.random(0, 360), math.random(0, 360), math.random(0, 360) }, callback_function = function(object)
        pendingDie = object
        object.randomize()
    end })
end

function onUpdate()
    if not pendingDie then return end
    local velocity = pendingDie.getVelocity()
    local angular = pendingDie.getAngularVelocity()
    if math.abs(velocity.x) < 0.05 and math.abs(velocity.y) < 0.05 and math.abs(velocity.z) < 0.05 and math.abs(angular.x) < 0.05 and math.abs(angular.y) < 0.05 and math.abs(angular.z) < 0.05 then
        settledFrames = settledFrames + 1
    else
        settledFrames = 0
    end
    if settledFrames >= 15 then
        local face = pendingDie.getValue()
        local label = pendingPlan.displayLabel or pendingPlan.label
        submitRawFace(face, label)
        pendingDie = nil
    end
end

function submitRawFace(face, label)
    WebRequest.custom(API_BASE .. "/resolve-roll", "POST", true, JSON.encode({ plan = pendingPlan, faces = { face } }), authHeaders(), function(response)
        rollBusy = false
        pendingPlan = nil
        if response.is_error or response.response_code < 200 or response.response_code >= 300 then displayResult(label .. ": resolve unavailable") return end
        local ok, decoded = pcall(JSON.decode, response.text)
        if ok and decoded and decoded.resolved then
            displayResult(label .. ": " .. outcomeLabel(decoded.resolved))
        else
            displayResult(label .. ": invalid result")
        end
    end)
end

function displayResult(text)
    UI.setAttribute(PANEL_ID .. "-status", "text", text)
end

UI_XML = [[
<Defaults>
    <Text fontSize="22" color="#f3ead6" />
    <Button fontSize="18" color="#c85b40" textColor="#fff9ef" />
</Defaults>
<Panel id="threepf-panel" width="560" height="570" position="0 0 -0.2" color="#171c24" padding="24 24 24 24" visibility="Player1|Player2|Player3|Player4|Player5|Player6|Player7|Player8">
    <VerticalLayout spacing="10">
        <Text id="threepf-panel-name" text="CHARACTER" fontSize="30" alignment="MiddleCenter" />
        <HorizontalLayout spacing="24"><Text id="threepf-panel-hp" text="HP  -- / --" /><Text id="threepf-panel-ac" text="AC  --" /><Text id="threepf-panel-bab" text="BAB --" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-fort" text="Fort  --" /><Button text="ROLL" onClick="rollSave" id="fortitude" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-ref" text="Ref   --" /><Button text="ROLL" onClick="rollSave" id="reflex" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-will" text="Will  --" /><Button text="ROLL" onClick="rollSave" id="will" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-attack" text="Attack  --" /><Button id="greatsword" text="ROLL" onClick="rollAttack" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Button text="NEXT WEAPON" onClick="nextAttack" /><Button text="NEXT STRIKE" onClick="nextStrike" /><Button text="STANDARD / FULL" onClick="toggleAttackMode" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text text="TRIP" /><Button text="ROLL" id="trip" onClick="rollManeuver" /><Text text="DISARM" /><Button text="ROLL" id="disarm" onClick="rollManeuver" /></HorizontalLayout>
        <Text id="threepf-panel-status" text="Ready" fontSize="18" color="#e9b872" alignment="MiddleCenter" />
    </VerticalLayout>
</Panel>]]
