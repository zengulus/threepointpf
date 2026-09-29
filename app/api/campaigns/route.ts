import { getDb } from "../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired } from "../../../lib/accounts";
import { isSiteAdmin } from "../../../lib/character-access";

export async function GET(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const rows = isSiteAdmin(actor)
    ? await getDb().prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE").all()
    : await getDb().prepare("SELECT c.id, c.name, m.role FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id WHERE m.account_id = ? AND m.role = ? ORDER BY c.name COLLATE NOCASE").bind(actor.id, actor.role).all();
  return json({ campaigns: rows.results ?? [] });
}

export async function POST(request: Request) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!isSiteAdmin(actor)) return error("forbidden", "Only the site administrator can create campaigns.", 403);
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const body = await readObject(request, 1_000);
  if (!body || Object.keys(body).some((key) => key !== "id" && key !== "name") || typeof body.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(body.id) || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80)
    return error("validation", "Choose a campaign ID and name.", 400);
  const now = new Date().toISOString();
  try {
    await getDb().batch([
      getDb().prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)").bind(body.id, body.name.trim(), now),
      getDb().prepare("INSERT INTO campaign_members (campaign_id, account_id, role) VALUES (?, ?, ?)").bind(body.id, actor.id, actor.role),
    ]);
  } catch { return error("conflict", "That campaign ID is already in use.", 409); }
  return json({ campaign: { id: body.id, name: body.name.trim(), role: actor.role } }, 201);
}
