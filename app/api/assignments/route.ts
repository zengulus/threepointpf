import { getDb } from "../../../db";
import { currentAccount, error, json, sessionRequired } from "../../../lib/accounts";
import { isSiteAdmin } from "../../../lib/character-access";

export async function GET(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can manage assignments.", 403);
  const rows = await getDb().prepare(`SELECT c.id, c.name, c.campaign_id AS campaignId, x.account_id AS accountId
    FROM characters c LEFT JOIN character_access x ON x.character_id = c.id AND x.permission = 'owner'
    WHERE ? = 1 OR EXISTS (SELECT 1 FROM campaign_members m
      WHERE m.campaign_id = c.campaign_id AND m.account_id = ? AND m.role = ?)
    ORDER BY c.name COLLATE NOCASE`).bind(isSiteAdmin(actor) ? 1 : 0, actor.id, actor.role).all();
  return json({ characters: rows.results ?? [] });
}
