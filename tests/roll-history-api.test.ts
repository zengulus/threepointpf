import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRollResponse } from "@threepointpf/shared";

const runtime = vi.hoisted(() => ({ env: { DB: undefined as D1Database | undefined }, waitUntil: vi.fn() }));
vi.mock("cloudflare:workers", () => runtime);

import { GET } from "../app/api/rolls/route";

type HistoryPage = { rolls: HostedRollResponse[]; nextCursor: string | null };
const now = "2026-10-12T00:00:00.000Z";
let sqlite: DatabaseSync;
let queries: string[];
let cookies: Record<string, string>;

/** Execute the route's real SQL against SQLite with only D1's read methods exposed. */
function readOnlyD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      queries.push(sql);
      if (!/^SELECT\b/.test(sql.trim())) throw new Error("Roll history must remain read-only.");
      const statement = database.prepare(sql);
      let values: SQLInputValue[] = [];
      return {
        bind(...bindings: SQLInputValue[]) { values = bindings; return this; },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values), success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

function addAccount(id: string, role = "player", siteAdmin = false) {
  sqlite.prepare(`INSERT INTO accounts (id, username, name, role, site_admin, salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, 'test-salt', 'test-hash', ?)`)
    .run(id, id, id, role, Number(siteAdmin), now);
  addSession(id, id, role === "dm" ? "dm" : "player");
}

function addSession(key: string, accountId: string, activeRole: string) {
  const token = createHash("sha256").update(`test-session-${key}`).digest("hex");
  sqlite.prepare(`INSERT INTO sessions (token_hash, account_id, active_role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(createHash("sha256").update(token).digest("hex"), accountId, activeRole,
      Math.floor(Date.now() / 1000) + 3600, now);
  cookies[key] = `threepointpf_session=${token}`;
}

function addRoll(id: string, createdAtMs: number, characterId = "hero") {
  const createdAt = new Date(createdAtMs).toISOString();
  sqlite.prepare(`INSERT INTO roll_events (id, actor_id, client_request_id, request_hash,
    character_id, campaign_id, character_name, character_revision, rules_version,
    request_json, plan_json, result_json, created_at, created_at_ms)
    VALUES (?, 'owner', ?, 'test-hash', ?, 'campaign', 'Recorded Hero', 3, 'test', '{}', ?, ?, ?, ?)`)
    .run(id, `request-${id}`, characterId,
      JSON.stringify({ id: "save:fortitude", title: "Fortitude", dice: [{ count: 1, sides: 20 }], modifier: 4 }),
      JSON.stringify({ faces: [17], total: 21 }), createdAt, createdAtMs);
  sqlite.prepare(`INSERT INTO discord_deliveries (roll_id, campaign_id, state, attempts, created_at, updated_at)
    VALUES (?, 'campaign', 'pending', 0, ?, ?)`)
    .run(id, createdAt, createdAt);
}

function readHistory(params = new URLSearchParams({ characterId: "hero" }), account: string | null = "owner") {
  return GET(new Request(`https://site.example/api/rolls?${params}`, {
    headers: account ? { cookie: cookies[account]! } : {},
  }));
}

beforeEach(() => {
  queries = [];
  cookies = {};
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  runtime.env.DB = readOnlyD1(sqlite);
  runtime.waitUntil.mockClear();
  for (const id of ["owner", "editor", "unassigned", "removed"]) addAccount(id);
  addAccount("dm", "dm");
  addAccount("other-dm", "dm");
  addAccount("admin", "dm", true);
  addAccount("co-dm", "co_dm");
  addSession("co-dm-active", "co-dm", "dm");
  sqlite.prepare("INSERT INTO campaigns (id, name, created_at) VALUES ('campaign', 'Campaign', ?)").run(now);
  for (const id of ["hero", "peer"])
    sqlite.prepare(`INSERT INTO characters (id, name, campaign_id, snapshot, revision, updated_at, updated_by)
      VALUES (?, ?, 'campaign', '{}', 3, ?, 'owner')`).run(id, id, now);
  for (const id of ["owner", "editor", "unassigned", "dm", "co-dm"])
    sqlite.prepare(`INSERT INTO campaign_members (campaign_id, account_id, role)
      SELECT 'campaign', id, role FROM accounts WHERE id = ?`).run(id);
  for (const id of ["owner", "editor", "removed"])
    sqlite.prepare("INSERT INTO character_access (character_id, account_id, permission) VALUES ('hero', ?, ?)")
      .run(id, id === "editor" ? "editor" : "owner");
});

afterEach(() => {
  expect(runtime.waitUntil).not.toHaveBeenCalled();
  runtime.env.DB = undefined;
  sqlite.close();
});

describe("recorded roll history pagination", () => {
  it("pages deterministically through tied timestamps without duplicates or omissions", async () => {
    const entries = Array.from({ length: 47 }, (_, index) => ({
      id: `roll-${String(index).padStart(3, "0")}`,
      createdAtMs: index < 30 ? 2000 : 1000,
    }));
    for (const entry of entries) addRoll(entry.id, entry.createdAtMs);
    addRoll("another-character", 3000, "peer");
    const expected = [...entries].sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id)).map((entry) => entry.id);
    const ids: string[] = [];
    let cursor: string | null = null;
    for (const expectedSize of [20, 20, 7]) {
      const params = new URLSearchParams({ characterId: "hero" });
      if (cursor) params.set("before", cursor);
      const response = await readHistory(params);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const page = await response.json() as HistoryPage;
      expect(page.rolls).toHaveLength(expectedSize);
      expect(page.rolls.every((roll) => roll.characterId === "hero")).toBe(true);
      expect(page.nextCursor).toBe(expectedSize === 20 ? page.rolls.at(-1)!.rollId : null);
      ids.push(...page.rolls.map((roll) => roll.rollId));
      cursor = page.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(entries.length);
  });

  it.each([0, 1, 20])("ends a history of exactly %i rolls without an extra page", async (count) => {
    for (let index = 0; index < count; index++) addRoll(`roll-${index}`, 1000 + index);
    const response = await readHistory();
    expect(response.status).toBe(200);
    const page = await response.json() as HistoryPage;
    expect(page.rolls).toHaveLength(count);
    expect(page.nextCursor).toBeNull();
  });

  it("preserves recorded payloads and delivery state while reading an older page", async () => {
    addRoll("newer", 2000);
    addRoll("older", 1000);
    sqlite.prepare(`UPDATE discord_deliveries SET state = 'sent', message_id = 'discord-message'
      WHERE roll_id = 'older'`).run();
    const before = sqlite.prepare("SELECT * FROM discord_deliveries ORDER BY roll_id").all();
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: "newer" }));
    expect(await response.json()).toMatchObject({
      rolls: [{ rollId: "older", characterName: "Recorded Hero", characterRevision: 3,
        result: { faces: [17], total: 21 }, delivery: { state: "sent", messageId: "discord-message" } }],
      nextCursor: null,
    });
    expect(sqlite.prepare("SELECT * FROM discord_deliveries ORDER BY roll_id").all()).toEqual(before);
    const exhausted = await readHistory(new URLSearchParams({ characterId: "hero", before: "older" }));
    expect(await exhausted.json()).toEqual({ rolls: [], nextCursor: null });
  });

  it("does not repeat earlier results when newer rolls arrive between pages", async () => {
    for (let index = 0; index < 21; index++) addRoll(`roll-${String(index).padStart(2, "0")}`, 1000);
    const first = await (await readHistory()).json() as HistoryPage;
    addRoll("newer-roll", 2000);
    addRoll("roll-99", 1000);
    const next = await readHistory(new URLSearchParams({ characterId: "hero", before: first.nextCursor! }));
    expect(await next.json()).toMatchObject({ rolls: [{ rollId: "roll-00" }], nextCursor: null });
  });

  it.each(["", " ", "roll id", "x".repeat(129), "../roll", "' OR 1=1 --"])("rejects malformed cursor %j", async (cursor) => {
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: cursor }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "validation", message: "Choose a valid roll history cursor." } });
    expect(queries.some((sql) => sql.includes("FROM roll_events"))).toBe(false);
  });

  it("rejects duplicate cursors", async () => {
    const params = new URLSearchParams({ characterId: "hero", before: "one" });
    params.append("before", "two");
    expect((await readHistory(params)).status).toBe(400);
    expect(queries.some((sql) => sql.includes("FROM roll_events"))).toBe(false);
  });

  it("treats missing and cross-character cursors alike, even when both characters are accessible", async () => {
    addRoll("peer-cursor", 2000, "peer");
    addRoll("own-roll", 1000);
    const own = await readHistory(undefined, "dm");
    expect(own.status).toBe(200);
    const missing = await readHistory(new URLSearchParams({ characterId: "hero", before: "missing" }), "dm");
    const crossCharacter = await readHistory(new URLSearchParams({ characterId: "hero", before: "peer-cursor" }), "dm");
    expect(missing.status).toBe(400);
    expect(crossCharacter.status).toBe(400);
    expect(await crossCharacter.json()).toEqual(await missing.json());
  });
});

describe("recorded roll history access", () => {
  it("requires a session before validating or looking up a cursor", async () => {
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: "unknown" }), null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect(queries).toHaveLength(0);
  });

  it.each(["owner", "editor", "dm", "admin", "co-dm-active"])("allows the currently authorized %s", async (account) => {
    addRoll("cursor", 2000);
    addRoll("older", 1000);
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: "cursor" }), account);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rolls: [{ rollId: "older" }], nextCursor: null });
  });

  it.each(["unassigned", "removed", "other-dm", "co-dm"])("denies %s before cursor lookup", async (account) => {
    addRoll("known-cursor", 1000);
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: "known-cursor" }), account);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not-found", message: "Character not found." } });
    expect(queries.some((sql) => sql.includes("FROM roll_events"))).toBe(false);
  });

  it("rechecks character access on each page after an assignment is revoked", async () => {
    for (let index = 0; index < 21; index++) addRoll(`roll-${index}`, 1000 + index);
    const first = await (await readHistory()).json() as HistoryPage;
    expect(first.nextCursor).not.toBeNull();
    sqlite.exec("DELETE FROM character_access WHERE character_id = 'hero' AND account_id = 'owner'");
    const response = await readHistory(new URLSearchParams({ characterId: "hero", before: first.nextCursor! }));
    expect(response.status).toBe(404);
  });

  it.each([null, "", "x".repeat(129)])("keeps character validation for %j", async (characterId) => {
    const params = new URLSearchParams();
    if (characterId !== null) params.set("characterId", characterId);
    const response = await readHistory(params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "validation", message: "Choose a character." } });
  });
});
