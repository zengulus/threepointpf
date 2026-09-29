import { getDb } from "../db";

export type AccountRole = "dm" | "player" | "co_dm";
export type ActiveRole = "dm" | "player";
export type Account = { id: string; username: string; name: string; role: AccountRole; activeRole: ActiveRole; siteAdmin: boolean };
export type AccountSummary = Omit<Account, "activeRole">;
export const SESSION_COOKIE = "threepointpf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function error(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

export async function readObject(request: Request, maximumBytes = 2_000_000): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximumBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maximumBytes) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(value.trim());
}

export function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

export function validPasswordMaterial(salt: unknown, hash: unknown): boolean {
  return typeof salt === "string" && /^[a-f0-9]{32}$/i.test(salt) && typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}

export async function passwordHash(password: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = Uint8Array.from(salt.match(/../g) ?? [], (part) => parseInt(part, 16));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 160000, hash: "SHA-256" }, material, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return /^[a-f0-9]{64}$/i.test(value) ? value : null;
    }
  }
  return null;
}

export async function sessionTokenHash(request: Request): Promise<string | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  return token ? digestHex(token) : null;
}

export async function digestHex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function currentAccount(request: Request): Promise<Account | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const row = await db.prepare(
    "SELECT a.id, a.username, a.name, a.role, a.site_admin AS siteAdmin, s.active_role AS activeRole FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?",
  ).bind(await digestHex(token), Math.floor(Date.now() / 1000)).first<Omit<Account, "siteAdmin"> & { siteAdmin: number }>();
  if (!row) return null;
  const activeRole = row.role === "dm" ? "dm" : row.role === "player" ? "player" : row.activeRole === "dm" ? "dm" : "player";
  return { ...row, activeRole, siteAdmin: row.siteAdmin === 1 };
}

export async function createSession(accountId: string, role: AccountRole): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  await getDb().prepare("INSERT INTO sessions (token_hash, account_id, active_role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await digestHex(token), accountId, role === "dm" ? "dm" : "player", now + SESSION_SECONDS, new Date().toISOString()).run();
  return token;
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export async function dmAccount(request: Request): Promise<Account | null> {
  const account = await currentAccount(request);
  return account?.activeRole === "dm" ? account : null;
}

export async function siteAdminAccount(request: Request): Promise<Account | null> {
  const account = await currentAccount(request);
  return account?.activeRole === "dm" && account.siteAdmin ? account : null;
}

export async function listAccounts(): Promise<AccountSummary[]> {
  return getDb().prepare("SELECT id, username, name, role, site_admin AS siteAdmin FROM accounts ORDER BY name COLLATE NOCASE")
    .all<Omit<AccountSummary, "siteAdmin"> & { siteAdmin: number }>()
    .then((result) => (result.results ?? []).map((row) => ({ ...row, siteAdmin: row.siteAdmin === 1 })));
}

export function sessionRequired() { return error("unauthenticated", "Sign in to continue.", 401); }
export function forbidden() { return error("forbidden", "You do not have permission to do that.", 403); }
