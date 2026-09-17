import { rulesCatalogs } from "@threepointpf/rules-data";
import {
  actionPlanRequestSchema,
  createCharacterActionPlan,
  createCharacterRollPlan,
  rollPlanRequestSchema,
  type RollPlanRequest,
} from "../../../packages/shared/src/index.ts";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const body = await request.json();
    // An action request names the action and its selected attacks; a roll
    // request names one sequence member of one attack. Both are recomputed
    // server-side from authored state plus the requested context.
    const action = actionPlanRequestSchema.safeParse(body);
    if (action.success) {
      const character = await loadCharacter(action.data.characterId, token, rulesCatalogs);
      return json({ action: createCharacterActionPlan(character, action.data, rulesCatalogs) });
    }
    const rollRequest = rollPlanRequestSchema.parse(body) as RollPlanRequest;
    const character = await loadCharacter(rollRequest.characterId, token, rulesCatalogs);
    return json({ plan: createCharacterRollPlan(character, rollRequest, rulesCatalogs) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to create roll plan" }, 400); }
});
