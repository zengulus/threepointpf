import { RulesEngine } from "@threepointpf/rules-core";
import { rollPlanRequestSchema, type RollPlanRequest } from "../../../packages/shared/src/index.ts";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const body = rollPlanRequestSchema.parse(await request.json()) as RollPlanRequest;
    const character = await loadCharacter(body.characterId, token);
    const engine = new RulesEngine(character);
    if (body.kind === "save" && body.saveId) return json({ plan: engine.createSaveRollPlan(body.saveId) });
    if (body.kind === "attack" && body.attackId) return json({ plan: engine.createAttackRollPlan(body.attackId) });
    return json({ error: "A valid saveId or attackId is required" }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to create roll plan" }, 400); }
});
