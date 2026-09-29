import { getDb } from "../../../../db";
import { currentAccount, digestHex, error, json, readObject, sameOrigin, sessionRequired, siteAdminAccount, validPasswordMaterial } from "../../../../lib/accounts";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await siteAdminAccount(request);
  if (!actor) return (await currentAccount(request)) ? error("forbidden", "Only the site administrator can manage accounts.", 403) : sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  const body = await readObject(request);
  if (!body) return error("validation", "Enter valid account details.", 400);
  if (body.salt !== undefined || body.hash !== undefined) {
    if (!validPasswordMaterial(body.salt, body.hash)) return error("validation", "Choose a password of at least eight characters.", 400);
    const updated = await getDb().prepare("UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?")
      .bind(body.salt, body.hash, id).run();
    if (!updated.meta.changes) return error("not-found", "Campaign account not found.", 404);
    const cookie = request.headers.get("cookie") ?? "";
    const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("threepointpf_session="))?.slice("threepointpf_session=".length);
    const keepHash = id === actor.id && token && /^[a-f0-9]{64}$/i.test(token) ? await digestHex(token) : "";
    if (keepHash) await getDb().prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?").bind(id, keepHash).run();
    else await getDb().prepare("DELETE FROM sessions WHERE account_id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (body.role !== "dm" && body.role !== "player" && body.role !== "co_dm") return error("validation", "Choose a valid site role.", 400);
  if (id === actor.id && body.role === "player") return error("validation", "You cannot change your own account to a player role.", 400);

  const db = getDb();
  const previous = await db.prepare("SELECT role, site_admin AS siteAdmin FROM accounts WHERE id = ?")
    .bind(id).first<{ role: "dm" | "player" | "co_dm"; siteAdmin: number }>();
  if (!previous) return error("not-found", "Campaign account not found.", 404);
  if (previous.siteAdmin && body.role === "player") return error("validation", "The site administrator must remain a Dungeon Master.", 400);
  if (previous.role !== body.role) {
    if ((previous.role === "dm" || previous.role === "co_dm") && body.role === "player") {
      const others = await db.prepare("SELECT 1 FROM accounts WHERE role IN ('dm', 'co_dm') AND id <> ? LIMIT 1").bind(id).first();
      if (!others) return error("validation", "Keep at least one Dungeon Master account.", 400);
    }
    await db.batch([
      db.prepare("DELETE FROM character_access WHERE account_id = ?").bind(id),
      db.prepare("DELETE FROM campaign_members WHERE account_id = ?").bind(id),
      db.prepare("UPDATE accounts SET role = ? WHERE id = ? AND site_admin = 0").bind(body.role, id),
    ]);
  }
  const row = await getDb().prepare("SELECT id, username, name, role, site_admin AS siteAdmin FROM accounts WHERE id = ?").bind(id).first<{ id: string; username: string; name: string; role: "dm" | "player" | "co_dm"; siteAdmin: number }>();
  return json({ account: row ? { ...row, siteAdmin: row.siteAdmin === 1 } : null });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await siteAdminAccount(request);
  if (!actor) return (await currentAccount(request)) ? error("forbidden", "Only the site administrator can manage accounts.", 403) : sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  if (id === actor.id) return error("validation", "You cannot remove your own account.", 400);

  const result = await getDb().prepare(
    "DELETE FROM accounts WHERE id = ? AND site_admin = 0 AND (role = 'player' OR EXISTS (SELECT 1 FROM accounts AS other WHERE other.role IN ('dm', 'co_dm') AND other.id <> accounts.id))",
  ).bind(id).run();
  if (!result.meta.changes) {
    const exists = await getDb().prepare("SELECT id FROM accounts WHERE id = ?").bind(id).first<{ id: string }>();
    return exists ? error("validation", "Keep at least one Dungeon Master account.", 400) : error("not-found", "Campaign account not found.", 404);
  }
  return json({ ok: true });
}
