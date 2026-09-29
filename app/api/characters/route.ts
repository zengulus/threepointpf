import { getDb } from "../../../db";
import { currentAccount, json, sessionRequired } from "../../../lib/accounts";
import { isSiteAdmin } from "../../../lib/character-access";

export async function GET(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const rows = isSiteAdmin(actor)
    ? await getDb().prepare("SELECT id, name, campaign_id AS campaignId, updated_at AS updatedAt FROM characters ORDER BY name COLLATE NOCASE").all()
    : await getDb().prepare(`SELECT c.id, c.name, c.campaign_id AS campaignId, c.updated_at AS updatedAt
      FROM characters c JOIN campaign_members m ON m.campaign_id = c.campaign_id
      WHERE m.account_id = ? AND m.role = ? AND
        (? = 'dm' OR EXISTS (SELECT 1 FROM character_access a WHERE a.character_id = c.id AND a.account_id = ?))
      ORDER BY c.name COLLATE NOCASE`).bind(actor.id, actor.role, actor.activeRole, actor.id).all();
  return json(rows.results ?? []);
}
