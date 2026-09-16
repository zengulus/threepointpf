import { RulesEngine } from "@threepointpf/rules-core";
import { progressionCatalog } from "@threepointpf/rules-data";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const characterId = new URL(request.url).searchParams.get("characterId");
    if (!characterId) return json({ error: "characterId is required" }, 400);
    const character = await loadCharacter(characterId, token); const derived = new RulesEngine(character, { progressionCatalog }).derive();
    return json({ name: character.name, currentHp: derived.currentHp, maxHp: derived.maxHp.value, damageTaken: derived.damageTaken, temporaryHp: derived.temporaryHp, bab: derived.bab.value, ac: derived.ac.value, saves: { fortitude: derived.saves.fortitude.value, reflex: derived.saves.reflex.value, will: derived.saves.will.value }, attacks: derived.attacks.map((attack) => ({ id: attack.definition.id, name: attack.definition.name, modifier: attack.attack.value })) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to load character" }, 400); }
});
