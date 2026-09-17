import { RulesEngine, isFullAttackAction } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const characterId = new URL(request.url).searchParams.get("characterId");
    if (!characterId) return json({ error: "characterId is required" }, 400);
    const character = await loadCharacter(characterId, token, rulesCatalogs); const derived = new RulesEngine(character, rulesCatalogs).derive();
    return json({ name: character.name, currentHp: derived.currentHp, maxHp: derived.maxHp.value, damageTaken: derived.damageTaken, temporaryHp: derived.temporaryHp, bab: derived.bab.value, ac: derived.ac.value, saves: { fortitude: derived.saves.fortitude.value, reflex: derived.saves.reflex.value, will: derived.saves.will.value }, attacks: derived.attacks.map((attack) => ({
      id: attack.definition.id,
      name: attack.definition.name,
      modifier: attack.attack.value,
      // The authoritative full-attack action, with explicit step roles. TTS
      // requests a step identity and never derives a modifier itself.
      action: { kind: attack.action.action, label: attack.action.label, attackIds: [attack.definition.id] },
      // Every step names the roll that resolves it and the threat range that
      // roll was evaluated with; the client derives neither.
      steps: attack.action.attacks[0]!.steps.map((step) => ({ index: step.index, role: step.role, modifier: step.modifier, rollId: step.roll.id, flags: step.roll.context.flags ?? [], fullAttack: step.roll.context ? isFullAttackAction(step.roll.context) : true, criticalRange: step.roll.criticalRange ?? null })),
      fullAttack: attack.fullAttack.map((strike) => strike.value),
    })) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to load character" }, 400); }
});
