import { getDb } from "../../../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired, validUsername } from "../../../../../lib/accounts";
import { isSiteAdmin, mayManageCampaign } from "../../../../../lib/character-access";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const { id } = await context.params;
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const campaign = await getDb().prepare("SELECT 1 FROM campaigns WHERE id = ?").bind(id).first();
  if (!campaign) return error("not-found", "Campaign not found.", 404);
  const rows = await getDb().prepare(`SELECT a.id AS accountId, a.username, a.name, m.role
    FROM campaign_members m JOIN accounts a ON a.id = m.account_id
    WHERE m.campaign_id = ? ORDER BY a.name COLLATE NOCASE`).bind(id).all();
  return json({ members: rows.results ?? [] });
}

export async function PUT(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const campaign = await getDb().prepare("SELECT 1 FROM campaigns WHERE id = ?").bind(id).first();
  if (!campaign) return error("not-found", "Campaign not found.", 404);
  const body = await readObject(request, 1_000);
  if (!body || Object.keys(body).some((key) => key !== "accountId" && key !== "username" && key !== "role") ||
      (typeof body.accountId === "string") === (typeof body.username === "string") ||
      (body.accountId !== undefined && (typeof body.accountId !== "string" || !body.accountId)) ||
      (body.username !== undefined && !validUsername(body.username)) ||
      (body.role !== "dm" && body.role !== "player" && body.role !== "co_dm"))
    return error("validation", "Choose an account and campaign role.", 400);
  const db = getDb();
  const account = typeof body.accountId === "string"
    ? await db.prepare("SELECT id, username, name, role FROM accounts WHERE id = ?").bind(body.accountId).first<{ id: string; username: string; name: string; role: "dm" | "player" | "co_dm" }>()
    : await db.prepare("SELECT id, username, name, role FROM accounts WHERE username = ? COLLATE NOCASE").bind(String(body.username).trim()).first<{ id: string; username: string; name: string; role: "dm" | "player" | "co_dm" }>();
  if (!account || account.role !== body.role) return error("validation", "The account role must match this campaign role.", 400);
  const existing = await db.prepare("SELECT role FROM campaign_members WHERE campaign_id = ? AND account_id = ?").bind(id, account.id).first<{ role: "dm" | "player" | "co_dm" }>();
  if (!isSiteAdmin(actor) && (body.role !== "player" || existing?.role === "dm" || existing?.role === "co_dm"))
    return error("forbidden", "Only the site administrator can change campaign Dungeon Masters.", 403);
  await db.prepare("INSERT INTO campaign_members (campaign_id, account_id, role) VALUES (?, ?, ?) ON CONFLICT(campaign_id, account_id) DO UPDATE SET role = excluded.role")
    .bind(id, account.id, body.role).run();
  return json({ member: { accountId: account.id, username: account.username, name: account.name, role: body.role } });
}

export async function DELETE(request: Request, context: Context) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (!await mayManageCampaign(actor, id)) return error("not-found", "Campaign not found.", 404);
  const body = await readObject(request, 1_000);
  if (!body || Object.keys(body).some((key) => key !== "accountId") || typeof body.accountId !== "string" || !body.accountId)
    return error("validation", "Choose a campaign member.", 400);
  const db = getDb();
  const member = await db.prepare("SELECT role FROM campaign_members WHERE campaign_id = ? AND account_id = ?").bind(id, body.accountId).first<{ role: "dm" | "player" | "co_dm" }>();
  if (!member) return error("not-found", "Campaign member not found.", 404);
  if (!isSiteAdmin(actor) && member.role !== "player") return error("forbidden", "Only the site administrator can remove a campaign Dungeon Master.", 403);
  if (body.accountId === actor.id) return error("validation", "You cannot remove your own campaign membership.", 400);
  await db.batch([
    db.prepare(`DELETE FROM character_access WHERE account_id = ? AND character_id IN
      (SELECT id FROM characters WHERE campaign_id = ?)`)
      .bind(body.accountId, id),
    db.prepare("DELETE FROM campaign_members WHERE campaign_id = ? AND account_id = ?").bind(id, body.accountId),
  ]);
  return json({ ok: true });
}
