import { parseCharacterInput } from "@threepointpf/rules-schema";
import { getDb } from "../../../db";
import { createSession, currentAccount, digestHex, error, json, passwordHash, readObject, sameOrigin, sessionCookie, sessionTokenHash, SESSION_COOKIE, validName, validPasswordMaterial, validUsername } from "../../../lib/accounts";
import type { AccountRole } from "../../../lib/accounts";

const SESSION_TOKEN = /^[a-f0-9]{64}$/i;
const LEGACY_ID = /^[A-Za-z0-9._:-]{1,128}$/;

type LegacyAccount = { id: string; username: string; name: string; role: AccountRole; salt: string; hash: string };

function validLegacyAccount(value: unknown): value is LegacyAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && LEGACY_ID.test(row.id) && validUsername(row.username) && validName(row.name) &&
    (row.role === "dm" || row.role === "player" || row.role === "co_dm") && validPasswordMaterial(row.salt, row.hash);
}

function constantTimeEqualHex(left: string, right: string): boolean {
  let different = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) different |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return different === 0;
}

export async function GET(request: Request) {
  const account = await currentAccount(request);
  if (account) return json({ account });
  const count = await getDb().prepare("SELECT COUNT(*) AS count FROM accounts").first<{ count: number }>();
  return json({ account: null, bootstrapAvailable: (count?.count ?? 0) === 0 });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const body = await readObject(request, 10_000_000);
  if (!body) return error("validation", "The request is too large or invalid.", 400);
  const action = body.action;
  const db = getDb();

  if (action === "logout") {
    const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (token && SESSION_TOKEN.test(token)) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digestHex(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (action === "switch-role") {
    const actor = await currentAccount(request);
    if (!actor) return error("unauthenticated", "Sign in to continue.", 401);
    if (actor.role !== "co_dm") return error("forbidden", "Only a Co-DM can switch roles.", 403);
    if (body.activeRole !== "dm" && body.activeRole !== "player") return error("validation", "Choose DM or player mode.", 400);
    const tokenHash = await sessionTokenHash(request);
    if (!tokenHash) return error("unauthenticated", "Sign in to continue.", 401);
    const updated = await db.prepare(`UPDATE sessions SET active_role = ? WHERE token_hash = ? AND expires_at > ?
      AND EXISTS (SELECT 1 FROM accounts WHERE id = sessions.account_id AND role = 'co_dm')`)
      .bind(body.activeRole, tokenHash, Math.floor(Date.now() / 1000)).run();
    if (!updated.meta.changes) return error("unauthenticated", "Sign in to continue.", 401);
    return json({ account: { ...actor, activeRole: body.activeRole } });
  }

  if (action === "login") {
    if (!validUsername(body.username) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 256) return error("unauthenticated", "Username or password is incorrect.", 401);
    const username = body.username.trim().toLowerCase();
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const attemptKey = await digestHex(ip);
    const now = Math.floor(Date.now() / 1000);
    const attempt = await db.prepare(
      "INSERT INTO login_attempts (key, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN login_attempts.window_started_at <= ? THEN 1 ELSE login_attempts.attempts + 1 END, window_started_at = CASE WHEN login_attempts.window_started_at <= ? THEN excluded.window_started_at ELSE login_attempts.window_started_at END RETURNING attempts, window_started_at",
    ).bind(attemptKey, now, now - 900, now - 900).first<{ attempts: number; window_started_at: number }>();
    if (!attempt || attempt.attempts > 10) return error("rate-limited", "Too many sign-in attempts. Wait 15 minutes and try again.", 429);
    const found = await db.prepare("SELECT id, username, name, role, site_admin AS siteAdmin, salt, password_hash FROM accounts WHERE username = ? COLLATE NOCASE").bind(username)
      .first<{ id: string; username: string; name: string; role: AccountRole; siteAdmin: number; salt: string; password_hash: string }>();
    const expected = found?.password_hash ?? "0".repeat(64);
    const supplied = await passwordHash(body.password, found?.salt ?? "0".repeat(32));
    if (!constantTimeEqualHex(supplied, expected) || !found) return error("unauthenticated", "Username or password is incorrect.", 401);
    await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(attemptKey).run();
    const token = await createSession(found.id, found.role);
    return json({ account: { id: found.id, username: found.username, name: found.name, role: found.role, activeRole: found.role === "dm" ? "dm" : "player", siteAdmin: found.siteAdmin === 1 } }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (action === "bootstrap") {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM accounts").first<{ count: number }>();
    if ((count?.count ?? 0) !== 0) return error("conflict", "The campaign accounts are already set up. Sign in instead.", 409);

    let accounts: LegacyAccount[];
    const legacy = body.legacyAccounts;
    if (Array.isArray(legacy) && legacy.length > 0) {
      if (legacy.length > 100 || !legacy.every(validLegacyAccount)) return error("validation", "The saved browser accounts could not be imported.", 400);
      accounts = legacy.map((row) => ({ ...row, username: row.username.trim().toLowerCase(), name: row.name.trim() }));
      const currentId = typeof body.currentAccountId === "string" ? body.currentAccountId : "";
      const selected = accounts.find((row) => row.id === currentId && row.role === "dm") ?? accounts.find((row) => row.role === "dm");
      if (!selected) return error("validation", "The saved browser accounts do not contain a Dungeon Master account.", 400);
      accounts = [selected, ...accounts.filter((row) => row.id !== selected.id)];
    } else {
      if (!validUsername(body.username) || !validName(body.name) || !validPasswordMaterial(body.salt, body.hash)) return error("validation", "Choose a valid username, display name, and password of at least eight characters.", 400);
      accounts = [{ id: crypto.randomUUID(), username: body.username.trim().toLowerCase(), name: body.name.trim(), role: "dm", salt: body.salt as string, hash: body.hash as string }];
    }

    const legacyCharacters = Array.isArray(body.legacyCharacters) ? body.legacyCharacters : [];
    if (legacyCharacters.length > 200) return error("validation", "Too many saved characters to import at once.", 400);
    const nowText = new Date().toISOString();
    const statements = accounts.map((account, index) => index === 0
      ? db.prepare("INSERT INTO accounts (id, username, name, role, site_admin, salt, password_hash, created_at) SELECT ?, ?, ?, 'dm', 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts)")
        .bind(account.id, account.username, account.name, account.salt, account.hash, nowText)
      : db.prepare("INSERT INTO accounts (id, username, name, role, salt, password_hash, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ? AND role = 'dm')")
        .bind(account.id, account.username, account.name, account.role, account.salt, account.hash, nowText, accounts[0]!.id));
    const imported = [] as { id: string; name: string; campaignId: string; snapshot: string; updatedAt: string }[];
    try {
      for (const raw of legacyCharacters) {
        const character = parseCharacterInput(raw);
        imported.push({ id: character.id, name: character.name, campaignId: character.campaignId ?? "demo-campaign", snapshot: JSON.stringify(character), updatedAt: nowText });
      }
    } catch { return error("validation", "A saved character could not be imported. Export it from the old site and try again after setup.", 400); }
    for (const character of imported) statements.push(db.prepare(
      "INSERT INTO characters (id, name, campaign_id, snapshot, revision, updated_at, updated_by) SELECT ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ? AND role = 'dm')",
    ).bind(character.id, character.name, character.campaignId, character.snapshot, character.updatedAt, accounts[0]!.id, accounts[0]!.id));
    for (const campaignId of new Set(imported.map((character) => character.campaignId))) {
      statements.push(db.prepare("INSERT OR IGNORE INTO campaigns (id, name, created_at) VALUES (?, ?, ?)").bind(campaignId, campaignId, nowText));
      for (const account of accounts.filter((entry) => entry.role === "dm" || entry.role === "co_dm"))
        statements.push(db.prepare("INSERT OR IGNORE INTO campaign_members (campaign_id, account_id, role) VALUES (?, ?, ?)").bind(campaignId, account.id, account.role));
    }
    try { await db.batch(statements); }
    catch { return error("conflict", "The campaign setup changed while it was being saved. Refresh and sign in.", 409); }
    const created = await db.prepare("SELECT id FROM accounts WHERE id = ? AND role = 'dm'").bind(accounts[0]!.id).first<{ id: string }>();
    if (!created) return error("conflict", "The first campaign account has already been created. Sign in instead.", 409);
    const token = await createSession(accounts[0]!.id, "dm");
    const first = accounts[0]!;
    return json({ account: { id: first.id, username: first.username, name: first.name, role: "dm", activeRole: "dm", siteAdmin: true }, imported: { accounts: accounts.length, characters: imported.length } }, 201, { "Set-Cookie": sessionCookie(token) });
  }

  return error("validation", "Unsupported sign-in action.", 400);
}
