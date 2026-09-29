import { getDb } from "../../../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired } from "../../../../../lib/accounts";
import { mayManageCampaign } from "../../../../../lib/character-access";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can manage assignments.", 403);
  const { id } = await context.params;
  const row = await getDb().prepare("SELECT c.id, c.campaign_id AS campaignId, a.account_id AS accountId FROM characters c LEFT JOIN character_access a ON a.character_id = c.id AND a.permission = 'owner' WHERE c.id = ?").bind(id).first<{ id: string; campaignId: string; accountId: string | null }>();
  if (row && !await mayManageCampaign(actor, row.campaignId)) return error("not-found", "Character not found.", 404);
  return row ? json({ assignment: row }) : error("not-found", "Character not found.", 404);
}

export async function PUT(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (actor.activeRole !== "dm") return error("forbidden", "Only a Dungeon Master can manage assignments.", 403);
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  const body = await readObject(request, 1000);
  if (!body || (body.accountId !== null && (typeof body.accountId !== "string" || !body.accountId))) return error("validation", "Choose a player or leave the character unassigned.", 400);
  const db = getDb();
  const character = await db.prepare("SELECT id, campaign_id AS campaignId FROM characters WHERE id = ?").bind(id).first<{ id: string; campaignId: string }>();
  if (!character) return error("not-found", "Character not found.", 404);
  if (!await mayManageCampaign(actor, character.campaignId)) return error("not-found", "Character not found.", 404);
  if (body.accountId !== null) {
    const player = await db.prepare(`SELECT a.id FROM accounts a JOIN campaign_members m
      ON m.account_id = a.id AND m.campaign_id = ? AND m.role = a.role
      WHERE a.id = ? AND a.role IN ('player', 'co_dm')`).bind(character.campaignId, body.accountId).first();
    if (!player) return error("validation", "Choose a player who belongs to this campaign.", 400);
  }
  const statements = [db.prepare("DELETE FROM character_access WHERE character_id = ? AND permission = 'owner'").bind(id)];
  if (body.accountId !== null) {
    statements.push(db.prepare("INSERT INTO character_access (character_id, account_id, permission) VALUES (?, ?, 'owner')").bind(id, body.accountId));
  }
  await db.batch(statements);
  return json({ characterId: id, accountId: body.accountId });
}
