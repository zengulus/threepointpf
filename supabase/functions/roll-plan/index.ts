import { progressionCatalog } from "@threepointpf/rules-data";
import { createCharacterRollPlan, rollPlanRequestSchema, type RollPlanRequest } from "../../../packages/shared/src/index.ts";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const body = rollPlanRequestSchema.parse(await request.json()) as RollPlanRequest;
    const character = await loadCharacter(body.characterId, token);
    return json({ plan: createCharacterRollPlan(character, body, progressionCatalog) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to create roll plan" }, 400); }
});
