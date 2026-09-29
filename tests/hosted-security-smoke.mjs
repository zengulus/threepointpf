import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = process.env.SECURITY_TEST_BASE || "http://127.0.0.1:8888";
const password = "LongLocalTestPassword!";
function credentials() {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: pbkdf2Sync(password, Buffer.from(salt, "hex"), 160000, 32, "sha256").toString("hex") };
}
async function call(path, { method = "GET", body, cookie } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json", origin: base } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (response.status === 503 && text.startsWith("Your worker restarted mid-request") && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    return { status: response.status, data: JSON.parse(text), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  throw new Error("Local Worker did not settle after retries");
}
function expectStatus(label, result, status) {
  if (result.status !== status) throw new Error(`${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.data)}`);
}
const initial = await call("/api/auth");
expectStatus("initial auth", initial, 200);
if (!initial.data.bootstrapAvailable) throw new Error("Use a fresh isolated local D1 database");
const dm = await call("/api/auth", { method: "POST", body: { action: "bootstrap", username: "testdm", name: "Test DM", ...credentials() } });
expectStatus("bootstrap DM", dm, 201);
const playerA = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "playera", name: "Player A", role: "player", siteAdmin: true, ...credentials() } });
expectStatus("add player A", playerA, 201);
if (playerA.data.account.siteAdmin) throw new Error("Player acquired the site administrator flag");
const playerB = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "playerb", name: "Player B", role: "player", ...credentials() } });
expectStatus("add player B", playerB, 201);
const a = await call("/api/auth", { method: "POST", body: { action: "login", username: "playera", password } });
expectStatus("login player A", a, 200);
const b = await call("/api/auth", { method: "POST", body: { action: "login", username: "playerb", password } });
expectStatus("login player B", b, 200);
const hashReplay = await call("/api/auth", { method: "POST", body: { action: "login", username: "playera", hash: credentials().hash } });
expectStatus("hash replay rejected", hashReplay, 401);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/simple-character.json", import.meta.url), "utf8"));
const created = await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: dm.cookie, body: { character: fixture } });
expectStatus("DM creates character", created, 200);
expectStatus("add A to campaign", await call("/api/campaigns/demo-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: playerA.data.account.id, role: "player" } }), 200);
expectStatus("add B to campaign", await call("/api/campaigns/demo-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: playerB.data.account.id, role: "player" } }), 200);
expectStatus("A cannot read before assignment", await call(`/api/characters/${fixture.id}`, { cookie: a.cookie }), 404);
expectStatus("A sees empty list", await call("/api/characters", { cookie: a.cookie }), 200);
const assignment = await call(`/api/characters/${fixture.id}/assignment`, { method: "PUT", cookie: dm.cookie, body: { accountId: playerA.data.account.id } });
expectStatus("DM assigns", assignment, 200);
const aList = await call("/api/characters", { cookie: a.cookie });
if (aList.data.length !== 1 || aList.data[0].id !== fixture.id) throw new Error("A did not receive only their character");
expectStatus("B cannot read A", await call(`/api/characters/${fixture.id}`, { cookie: b.cookie }), 404);
expectStatus("B cannot save A", await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: b.cookie, body: { character: fixture, revision: 1 } }), 404);
expectStatus("B cannot reassign A", await call(`/api/characters/${fixture.id}/assignment`, { method: "PUT", cookie: b.cookie, body: { accountId: playerB.data.account.id } }), 403);
// Local Wrangler can restart after a D1 write; let its worker settle before
// testing the revisioned update, which must be sent only once.
await new Promise((resolve) => setTimeout(resolve, 500));
const saved = await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: a.cookie, body: { character: { ...fixture, name: "Player A edited" }, revision: 1 } });
expectStatus("A saves assigned character", saved, 200);
if (saved.data.revision !== 2) throw new Error("Revision did not advance");
expectStatus("stale revision conflicts", await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: a.cookie, body: { character: fixture, revision: 1 } }), 409);
const otherDmAccount = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "otherdm", name: "Other DM", role: "dm", ...credentials() } });
expectStatus("create second DM", otherDmAccount, 201);
const otherDm = await call("/api/auth", { method: "POST", body: { action: "login", username: "otherdm", password } });
expectStatus("login second DM", otherDm, 200);
expectStatus("create second campaign", await call("/api/campaigns", { method: "POST", cookie: dm.cookie, body: { id: "other-campaign", name: "Other Campaign" } }), 201);
expectStatus("second DM joins own campaign", await call("/api/campaigns/other-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: otherDmAccount.data.account.id, role: "dm" } }), 200);
expectStatus("second DM cannot list accounts", await call("/api/accounts", { cookie: otherDm.cookie }), 403);
expectStatus("second DM cannot read first campaign", await call("/api/characters/human-martial", { cookie: otherDm.cookie }), 404);
expectStatus("second DM cannot change first campaign", await call("/api/characters/human-martial", { method: "PUT", cookie: otherDm.cookie, body: { character: fixture, revision: 2 } }), 404);
expectStatus("second DM cannot assign first campaign", await call("/api/characters/human-martial/assignment", { method: "PUT", cookie: otherDm.cookie, body: { accountId: playerB.data.account.id } }), 404);
expectStatus("second DM cannot view first Discord settings", await call("/api/campaigns/demo-campaign/discord", { cookie: otherDm.cookie }), 404);
expectStatus("second DM cannot add campaign DMs", await call("/api/campaigns/other-campaign/members", { method: "PUT", cookie: otherDm.cookie, body: { accountId: dm.data.account.id, role: "dm" } }), 403);
const secondCharacter = { ...fixture, id: "other-character", campaignId: "other-campaign", name: "Other DM's Character" };
expectStatus("second DM creates in own campaign", await call("/api/characters/other-character", { method: "PUT", cookie: otherDm.cookie, body: { character: secondCharacter } }), 200);
expectStatus("first player cannot create in other campaign", await call("/api/characters/denied-character", { method: "PUT", cookie: a.cookie, body: { character: { ...secondCharacter, id: "denied-character" } } }), 403);
const otherList = await call("/api/characters", { cookie: otherDm.cookie });
if (otherList.data.length !== 1 || otherList.data[0].id !== "other-character") throw new Error("Second DM saw another campaign's character");
const playerList = await call("/api/characters", { cookie: a.cookie });
if (playerList.data.length !== 1 || playerList.data[0].id !== fixture.id) throw new Error("Player A saw another campaign's character");
const coAccount = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "codm", name: "Co-DM", role: "co_dm", ...credentials() } });
expectStatus("create Co-DM", coAccount, 201);
const co = await call("/api/auth", { method: "POST", body: { action: "login", username: "codm", password } });
expectStatus("login Co-DM", co, 200);
if (co.data.account.activeRole !== "player") throw new Error("Co-DM did not start in Player mode");
expectStatus("Co-DM cannot switch by request field alone", await call("/api/auth", { method: "POST", cookie: a.cookie, body: { action: "switch-role", activeRole: "dm" } }), 403);
expectStatus("Co-DM joins second campaign", await call("/api/campaigns/other-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: coAccount.data.account.id, role: "co_dm" } }), 200);
expectStatus("Co-DM Player mode cannot read unassigned character", await call("/api/characters/other-character", { cookie: co.cookie }), 404);
expectStatus("Co-DM Player mode cannot manage assignments", await call("/api/assignments", { cookie: co.cookie }), 403);
const coDm = await call("/api/auth", { method: "POST", cookie: co.cookie, body: { action: "switch-role", activeRole: "dm" } });
expectStatus("Co-DM switches to DM", coDm, 200);
if (coDm.data.account.activeRole !== "dm") throw new Error("Co-DM did not enter DM mode");
expectStatus("Co-DM DM mode reads own campaign", await call("/api/characters/other-character", { cookie: co.cookie }), 200);
expectStatus("Co-DM DM mode cannot read unrelated campaign", await call(`/api/characters/${fixture.id}`, { cookie: co.cookie }), 404);
expectStatus("Co-DM DM mode can manage own campaign", await call("/api/campaigns/other-campaign/members", { cookie: co.cookie }), 200);
const coSecondDevice = await call("/api/auth", { method: "POST", body: { action: "login", username: "codm", password } });
expectStatus("Co-DM signs in on second device", coSecondDevice, 200);
if (coSecondDevice.data.account.activeRole !== "player") throw new Error("Co-DM second session did not start in Player mode");
expectStatus("Co-DM second session still has Player permissions", await call("/api/characters/other-character", { cookie: coSecondDevice.cookie }), 404);
expectStatus("assign character to Co-DM", await call("/api/characters/other-character/assignment", { method: "PUT", cookie: otherDm.cookie, body: { accountId: coAccount.data.account.id } }), 200);
expectStatus("Co-DM second session sees assigned character", await call("/api/characters/other-character", { cookie: coSecondDevice.cookie }), 200);
const extraCharacter = { ...secondCharacter, id: "other-unassigned", name: "Unassigned in second campaign" };
expectStatus("second DM creates unassigned character", await call("/api/characters/other-unassigned", { method: "PUT", cookie: otherDm.cookie, body: { character: extraCharacter } }), 200);
const coPlayer = await call("/api/auth", { method: "POST", cookie: co.cookie, body: { action: "switch-role", activeRole: "player" } });
expectStatus("Co-DM switches back to Player", coPlayer, 200);
expectStatus("Co-DM Player mode cannot read unassigned peer", await call("/api/characters/other-unassigned", { cookie: co.cookie }), 404);
expectStatus("Co-DM Player mode cannot roll unassigned peer", await call("/api/rolls", { method: "POST", cookie: co.cookie, body: { version: 1, clientRequestId: randomUUID(), characterId: "other-unassigned", expectedRevision: 1, action: { characterId: "other-unassigned", kind: "save", saveId: "fortitude", defense: { kind: "dc", value: 17 } } } }), 404);
expectStatus("Co-DM returns to DM mode", await call("/api/auth", { method: "POST", cookie: co.cookie, body: { action: "switch-role", activeRole: "dm" } }), 200);
const coRoll = await call("/api/rolls", { method: "POST", cookie: co.cookie, body: { version: 1, clientRequestId: randomUUID(), characterId: "other-unassigned", expectedRevision: 1, action: { characterId: "other-unassigned", kind: "save", saveId: "fortitude", defense: { kind: "dc", value: 17 } } } });
expectStatus("Co-DM DM mode can record campaign roll", coRoll, 201);
expectStatus("Co-DM returns to Player mode", await call("/api/auth", { method: "POST", cookie: co.cookie, body: { action: "switch-role", activeRole: "player" } }), 200);
expectStatus("Co-DM Player mode cannot read unassigned DM roll", await call(`/api/rolls/${coRoll.data.rollId}`, { cookie: co.cookie }), 404);
expectStatus("Co-DM Player mode cannot change Discord", await call("/api/campaigns/other-campaign/discord", { method: "DELETE", cookie: co.cookie, body: {} }), 403);
const ownCharacter = { ...fixture, id: "player-created", name: "Player-created character" };
expectStatus("player creates in own campaign", await call("/api/characters/player-created", { method: "PUT", cookie: a.cookie, body: { character: ownCharacter } }), 200);
expectStatus("player reads own new character", await call("/api/characters/player-created", { cookie: a.cookie }), 200);
expectStatus("other player cannot read new character", await call("/api/characters/player-created", { cookie: b.cookie }), 404);
const rollAction = { characterId: fixture.id, kind: "save", saveId: "fortitude", defense: { kind: "dc", value: 17 } };
expectStatus("other DM cannot roll first campaign", await call("/api/rolls", { method: "POST", cookie: otherDm.cookie, body: { version: 1, clientRequestId: randomUUID(), characterId: fixture.id, expectedRevision: 2, action: rollAction } }), 404);
expectStatus("remove player from campaign", await call("/api/campaigns/demo-campaign/members", { method: "DELETE", cookie: dm.cookie, body: { accountId: playerA.data.account.id } }), 200);
expectStatus("removed player cannot read former assignment", await call(`/api/characters/${fixture.id}`, { cookie: a.cookie }), 404);
expectStatus("removed player cannot read self-created character", await call("/api/characters/player-created", { cookie: a.cookie }), 404);
expectStatus("removed player cannot roll", await call("/api/rolls", { method: "POST", cookie: a.cookie, body: { version: 1, clientRequestId: randomUUID(), characterId: fixture.id, expectedRevision: 2, action: rollAction } }), 404);
expectStatus("cannot assign removed player", await call(`/api/characters/${fixture.id}/assignment`, { method: "PUT", cookie: dm.cookie, body: { accountId: playerA.data.account.id } }), 400);
console.log("Security smoke passed: Co-DM session role switching, cross-campaign isolation, player creation and revocation, assignments, revisions, and raw-password login.");

