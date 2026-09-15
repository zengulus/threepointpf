import { resolveRollPlan } from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import { resolveRollRequestSchema, type ResolveRollRequest } from "../../../packages/shared/src/index.ts";
import { createClient } from "@supabase/supabase-js";
import { bearer, json, options } from "../_shared/http.ts";
import { loadCharacter } from "../_shared/load-character.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  try {
    const token = bearer(request); if (!token) return json({ error: "Authorization required" }, 401);
    const body = resolveRollRequestSchema.parse(await request.json()) as ResolveRollRequest;
    const character = await loadCharacter(body.plan.characterId, token);
    const engine = new RulesEngine(character);
    const metadata = body.plan.metadata;
    const serverPlan = metadata?.kind === "save" && metadata.target.startsWith("save.")
      ? engine.createSaveRollPlan(metadata.target.slice(5) as "fortitude" | "reflex" | "will")
      : metadata?.kind === "attack" && metadata.attackId ? engine.createAttackRollPlan(metadata.attackId) : null;
    if (!serverPlan) return json({ error: "Unsupported roll plan" }, 400);
    const resolved = resolveRollPlan(serverPlan, body.faces);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error: historyError } = await client.from("roll_history").insert({ campaign_id: character.campaignId ?? "default", character_id: character.id, roll_plan: serverPlan, faces: body.faces, resolved });
    if (historyError) throw new Error(historyError.message);
    return json({ resolved });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to resolve roll" }, 400); }
});
