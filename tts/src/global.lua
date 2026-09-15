-- 3.PF Tabletop Simulator client.
-- This script is intentionally a thin, untrusted client: it never calculates a rule.

API_BASE = "https://YOUR-PROJECT.supabase.co/functions/v1"
API_TOKEN = "" -- A short-lived user/campaign token; never put a Supabase service-role key here.
CHARACTER_ID = "human-martial"
PANEL_ID = "threepf-panel"
PLAYER_CHARACTERS = {} -- steam_id -> character id; populate through bindPlayer below.
pendingPlan = nil
pendingDie = nil
settledFrames = 0

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
    WebRequest.get(API_BASE .. "/character-state?characterId=" .. (characterId or CHARACTER_ID), function(request)
        if request.is_error then
            UI.setAttribute(PANEL_ID .. "-status", "text", "State unavailable")
            return
        end
        local ok, state = pcall(JSON.decode, request.text)
        if ok and state then
            UI.setAttribute(PANEL_ID .. "-name", "text", state.name or "Character")
            UI.setAttribute(PANEL_ID .. "-hp", "text", "HP  " .. tostring(state.currentHp) .. " / " .. tostring(state.maxHp))
            UI.setAttribute(PANEL_ID .. "-ac", "text", "AC  " .. tostring(state.ac))
            UI.setAttribute(PANEL_ID .. "-fort", "text", "Fort  " .. signed(state.saves.fortitude))
            UI.setAttribute(PANEL_ID .. "-ref", "text", "Ref   " .. signed(state.saves.reflex))
            UI.setAttribute(PANEL_ID .. "-will", "text", "Will  " .. signed(state.saves.will))
            if state.attacks and state.attacks[1] then
                UI.setAttribute(PANEL_ID .. "-attack", "text", state.attacks[1].name .. "  " .. signed(state.attacks[1].modifier))
                UI.setAttribute("greatsword", "active", "true")
            end
        end
    end, authHeaders())
end

function signed(value)
    if value >= 0 then return "+" .. tostring(value) end
    return tostring(value)
end

function rollSave(player, value, id)
    requestPlan({ kind = "save", saveId = id }, value, characterForPlayer(player))
end

function rollAttack(player, value, id)
    requestPlan({ kind = "attack", attackId = id }, value, characterForPlayer(player))
end

function requestPlan(request, label, characterId)
    local body = { characterId = characterId or CHARACTER_ID, kind = request.kind, saveId = request.saveId, attackId = request.attackId }
    WebRequest.post(API_BASE .. "/roll-plan", function(response)
        if response.is_error then displayResult(label .. ": plan unavailable") return end
        local ok, decoded = pcall(JSON.decode, response.text)
        if not ok or not decoded or not decoded.plan then displayResult(label .. ": invalid plan") return end
        pendingPlan = decoded.plan
        pendingPlan.displayLabel = label
        spawnPhysicalDice()
    end, JSON.encode(body), authHeaders())
end

function spawnPhysicalDice()
    if pendingDie then pendingDie.destruct() pendingDie = nil end
    settledFrames = 0
    local requirement = pendingPlan.dice[1]
    if not requirement or requirement.sides ~= 20 or requirement.count ~= 1 then
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
    WebRequest.post(API_BASE .. "/resolve-roll", function(response)
        if response.is_error then displayResult(label .. ": resolve unavailable") return end
        local ok, decoded = pcall(JSON.decode, response.text)
        if ok and decoded and decoded.resolved then
            displayResult(label .. ": " .. tostring(decoded.resolved.total))
        else
            displayResult(label .. ": invalid result")
        end
    end, JSON.encode({ plan = pendingPlan, faces = { face } }), authHeaders())
end

function displayResult(text)
    UI.setAttribute(PANEL_ID .. "-status", "text", text)
end

UI_XML = [[
<Defaults>
    <Text fontSize="22" color="#f3ead6" />
    <Button fontSize="18" color="#c85b40" textColor="#fff9ef" />
</Defaults>
<Panel id="threepf-panel" width="560" height="520" position="0 0 -0.2" color="#171c24" padding="24 24 24 24" visibility="Player1|Player2|Player3|Player4|Player5|Player6|Player7|Player8">
    <VerticalLayout spacing="10">
        <Text id="threepf-panel-name" text="CHARACTER" fontSize="30" alignment="MiddleCenter" />
        <HorizontalLayout spacing="24"><Text id="threepf-panel-hp" text="HP  -- / --" /><Text id="threepf-panel-ac" text="AC  --" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-fort" text="Fort  --" /><Button text="ROLL" onClick="rollSave" id="fortitude" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-ref" text="Ref   --" /><Button text="ROLL" onClick="rollSave" id="reflex" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-will" text="Will  --" /><Button text="ROLL" onClick="rollSave" id="will" /></HorizontalLayout>
        <HorizontalLayout spacing="8"><Text id="threepf-panel-attack" text="Attack  --" /><Button id="greatsword" text="ROLL" onClick="rollAttack" /></HorizontalLayout>
        <Text id="threepf-panel-status" text="Ready" fontSize="18" color="#e9b872" alignment="MiddleCenter" />
    </VerticalLayout>
</Panel>]]
