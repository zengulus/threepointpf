import { getDb } from "../../../db";
import { currentAccount, error, json, listAccounts, readObject, sameOrigin, sessionRequired, siteAdminAccount, validName, validPasswordMaterial, validUsername } from "../../../lib/accounts";

export async function GET(request: Request) {
  const actor = await siteAdminAccount(request);
  if (!actor) return (await currentAccount(request)) ? error("forbidden", "Only the site administrator can manage accounts.", 403) : sessionRequired();
  return json({ accounts: await listAccounts() });
}

export async function POST(request: Request) {
  const actor = await siteAdminAccount(request);
  if (!actor) return (await currentAccount(request)) ? error("forbidden", "Only the site administrator can add accounts.", 403) : sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const body = await readObject(request);
  if (!body || !validUsername(body.username) || !validName(body.name) || !validPasswordMaterial(body.salt, body.hash) || (body.role !== "dm" && body.role !== "player" && body.role !== "co_dm")) return error("validation", "Enter a valid name, username, password, and role.", 400);
  const account = { id: crypto.randomUUID(), username: body.username.trim().toLowerCase(), name: body.name.trim(), role: body.role, siteAdmin: false };
  try {
    await getDb().prepare("INSERT INTO accounts (id, username, name, role, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(account.id, account.username, account.name, account.role, body.salt, body.hash, new Date().toISOString()).run();
  } catch { return error("conflict", "That username is already in use.", 409); }
  return json({ account }, 201);
}
