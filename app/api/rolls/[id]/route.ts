import { getDb } from "../../../../db";
import { currentAccount, error, json, sessionRequired } from "../../../../lib/accounts";
import { mayReadCharacter } from "../../../../lib/character-access";
import { reconcileExpiredDelivery } from "../../../../lib/discord-delivery";
import { loadRollEvent, storedRollResponse } from "../../../../lib/roll-events";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const { id } = await context.params;
  let row = await loadRollEvent(getDb(), id);
  if (!row || !await mayReadCharacter(actor, row.characterId)) return error("not-found", "Roll not found.", 404);
  await reconcileExpiredDelivery(getDb(), id);
  row = await loadRollEvent(getDb(), id);
  if (!row) return error("server", "The recorded roll could not be loaded.", 500);
  return json(storedRollResponse(row));
}
