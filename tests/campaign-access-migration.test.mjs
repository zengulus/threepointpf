import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
for (const number of ["0000", "0001", "0002", "0003", "0004"]) {
  const file = new URL(`../drizzle/${[
    "0000_true_mister_sinister.sql", "0001_curved_spencer_smythe.sql",
    "0002_wide_kree.sql", "0003_luxuriant_frightful_four.sql",
    "0004_icy_whistler.sql",
  ][Number(number)]}`, import.meta.url);
  db.exec(readFileSync(file, "utf8"));
}

const insertAccount = db.prepare(`INSERT INTO accounts
  (id, username, name, role, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const salt = "0".repeat(32), hash = "0".repeat(64);
insertAccount.run("dm-old", "old-dm", "Old DM", "dm", salt, hash, "2025-01-01T00:00:00Z");
insertAccount.run("dm-new", "new-dm", "New DM", "dm", salt, hash, "2025-02-01T00:00:00Z");
insertAccount.run("player-a", "player-a", "Player A", "player", salt, hash, "2025-03-01T00:00:00Z");
insertAccount.run("player-b", "player-b", "Player B", "player", salt, hash, "2025-03-01T00:00:00Z");
db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
  .run("dm-session", "dm-old", 9999999999, "2025-03-01");
db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
  .run("player-session", "player-a", 9999999999, "2025-03-01");
db.prepare("INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)").run("one", "Existing Name", "2025-01-01");
const insertCharacter = db.prepare(`INSERT INTO characters
  (id, name, campaign_id, snapshot, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`);
insertCharacter.run("char-one", "First", "one", '{"id":"char-one","campaignId":"one"}', 7, "2025-04-01", "dm-new");
insertCharacter.run("char-two", "Second", "two", '{"id":"char-two","campaignId":"two"}', 12, "2025-04-02", "player-a");
insertCharacter.run("char-orphan", "Unplaced", "", '{"id":"char-orphan"}', 4, "2025-04-03", "dm-old");
db.prepare("INSERT INTO character_access (character_id, account_id, permission) VALUES (?, ?, ?)").run("char-one", "player-a", "owner");
db.prepare("INSERT INTO character_access (character_id, account_id, permission) VALUES (?, ?, ?)").run("char-two", "player-b", "owner");

const before = db.prepare("SELECT id, snapshot, revision FROM characters ORDER BY id").all();
db.exec(readFileSync(new URL("../drizzle/0005_dazzling_barracuda.sql", import.meta.url), "utf8"));
db.exec(readFileSync(new URL("../drizzle/0006_open_bastion.sql", import.meta.url), "utf8"));
const after = db.prepare("SELECT id, snapshot, revision FROM characters ORDER BY id").all();
assert.deepEqual(after, before, "character IDs, exports, and revisions must survive");
assert.deepEqual(db.prepare("SELECT id, name FROM campaigns ORDER BY id").all().map((row) => ({ ...row })), [
  { id: "one", name: "Existing Name" }, { id: "two", name: "two" },
], "existing campaign name must remain and distinct character campaign must be created");
assert.deepEqual(db.prepare("SELECT id FROM accounts WHERE site_admin = 1").all().map((row) => ({ ...row })), [{ id: "dm-old" }]);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campaign_members WHERE role = 'dm'").get().n, 4);
assert.deepEqual(db.prepare("SELECT campaign_id AS campaignId, account_id AS accountId FROM campaign_members WHERE role = 'player' ORDER BY campaign_id").all().map((row) => ({ ...row })), [
  { campaignId: "one", accountId: "player-a" },
  { campaignId: "two", accountId: "player-b" },
]);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE id = ''").get().n, 0, "missing campaign IDs must not be guessed");
assert.deepEqual(db.prepare("SELECT token_hash AS token, active_role AS role FROM sessions ORDER BY token_hash").all().map((row) => ({ ...row })), [
  { token: "dm-session", role: "dm" }, { token: "player-session", role: "player" },
], "existing sessions retain their effective role");
db.close();
console.log("Campaign migration passed: admin election, membership and session role backfill, preserved snapshots/revisions, orphan visibility, and foreign keys.");
