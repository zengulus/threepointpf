import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = process.env.ROLL_TEST_BASE || "http://127.0.0.1:8888";
const password = "LongLocalRollTestPassword!";
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
    // Wrangler can reload after local D1 writes. Roll POSTs are safe to retry
    // because their clientRequestId is stable, and roll GETs are read-only.
    if (path.startsWith("/api/rolls") && response.status === 503 && text.startsWith("Your worker restarted mid-request") && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    return { status: response.status, data: JSON.parse(text), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  throw new Error("Local Worker did not settle after retries");
}
function status(label, result, expected) {
  if (result.status !== expected) throw new Error(`${label}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.data)}`);
}
const dm = await call("/api/auth", { method: "POST", body: { action: "bootstrap", username: "rolldm", name: "Roll DM", ...credentials() } });
status("bootstrap", dm, 201);
const playerA = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "rolla", name: "Roll A", role: "player", ...credentials() } });
status("player A", playerA, 201);
const playerB = await call("/api/accounts", { method: "POST", cookie: dm.cookie, body: { username: "rollb", name: "Roll B", role: "player", ...credentials() } });
status("player B", playerB, 201);
const a = await call("/api/auth", { method: "POST", body: { action: "login", username: "rolla", password } });
status("login A", a, 200);
const b = await call("/api/auth", { method: "POST", body: { action: "login", username: "rollb", password } });
status("login B", b, 200);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/simple-character.json", import.meta.url), "utf8"));
fixture.spellcastingSources = [{ id: "arcane", name: "Arcane", mode: "spontaneous", castingAbility: "int",
  spellListId: "arcane", spellListAccess: "list", bonusSlots: "none", knownSpellIds: [],
  progression: [{ level: 1, casterLevel: 1, maximumSpellLevel: 1, slots: { "1": 1 } }] }];
status("create", await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: dm.cookie, body: { character: fixture } }), 200);
status("add A to campaign", await call("/api/campaigns/demo-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: playerA.data.account.id, role: "player" } }), 200);
status("add B to campaign", await call("/api/campaigns/demo-campaign/members", { method: "PUT", cookie: dm.cookie, body: { accountId: playerB.data.account.id, role: "player" } }), 200);
status("assign", await call(`/api/characters/${fixture.id}/assignment`, { method: "PUT", cookie: dm.cookie, body: { accountId: playerA.data.account.id } }), 200);

const action = { characterId: fixture.id, kind: "save", saveId: "fortitude", defense: { kind: "dc", value: 17 } };
const request = { version: 1, clientRequestId: randomUUID(), characterId: fixture.id, expectedRevision: 1, action };
status("anonymous denied", await call("/api/rolls", { method: "POST", body: request }), 401);
status("other player denied", await call("/api/rolls", { method: "POST", cookie: b.cookie, body: request }), 404);
status("forged faces denied", await call("/api/rolls", { method: "POST", cookie: a.cookie, body: { ...request, action: { ...action, faces: [20] } } }), 400);
status("wrong defense denied", await call("/api/rolls", { method: "POST", cookie: a.cookie, body: { ...request, action: { ...action, defense: { kind: "ac", value: 5 } } } }), 400);

const [first, concurrent] = await Promise.all([
  call("/api/rolls", { method: "POST", cookie: a.cookie, body: request }),
  call("/api/rolls", { method: "POST", cookie: a.cookie, body: request }),
]);
if (![200, 201].includes(first.status) || ![200, 201].includes(concurrent.status))
  throw new Error(`concurrent results: ${first.status} ${JSON.stringify(first.data)}; ${concurrent.status} ${JSON.stringify(concurrent.data)}`);
if (first.data.rollId !== concurrent.data.rollId || JSON.stringify(first.data.result.faces) !== JSON.stringify(concurrent.data.result.faces))
  throw new Error("duplicate request did not recover the same persisted roll");
if (first.data.delivery.state !== "not_configured" || first.data.result.faces.length !== 1)
  throw new Error("unexpected roll response");
const concentrationAction = { characterId: fixture.id, kind: "concentration", sourceId: "arcane", defense: { kind: "dc", value: 18 } };
const concentrationRequest = { ...request, clientRequestId: randomUUID(), action: concentrationAction };
status("unknown concentration source denied", await call("/api/rolls", { method: "POST", cookie: a.cookie,
  body: { ...concentrationRequest, action: { ...concentrationAction, sourceId: "forged" } } }), 422);
status("concentration modifier denied", await call("/api/rolls", { method: "POST", cookie: a.cookie,
  body: { ...concentrationRequest, action: { ...concentrationAction, modifier: 100 } } }), 400);
const concentration = await call("/api/rolls", { method: "POST", cookie: a.cookie, body: concentrationRequest });
status("record concentration", concentration, 201);
if (concentration.data.plan.id !== `spellcasting:${fixture.id}:arcane:concentration` || concentration.data.result.faces.length !== 1)
  throw new Error("concentration was not rebuilt and recorded from the saved casting source");
const read = await call(`/api/rolls/${first.data.rollId}`, { cookie: a.cookie });
status("read own roll", read, 200);
if (read.data.rollId !== first.data.rollId) throw new Error("stored roll changed");
const historyPath = `/api/rolls?characterId=${encodeURIComponent(fixture.id)}`;
status("anonymous history denied", await call(historyPath), 401);
status("other player history denied", await call(historyPath, { cookie: b.cookie }), 404);
const history = await call(historyPath, { cookie: a.cookie });
status("read own history", history, 200);
if (history.data.rolls.length !== 2 || !history.data.rolls.some((roll) => roll.rollId === first.data.rollId) ||
  !history.data.rolls.some((roll) => roll.rollId === concentration.data.rollId))
  throw new Error("history did not contain both recorded results");
status("other player cannot read roll", await call(`/api/rolls/${first.data.rollId}`, { cookie: b.cookie }), 404);
status("unconnected delivery cannot retry", await call(`/api/rolls/${first.data.rollId}/discord/retry`, { method: "POST", cookie: a.cookie, body: {} }), 409);
const drained = await call("/api/discord/drain", { method: "POST", cookie: a.cookie, body: {} });
status("empty outbox drain", drained, 200);
if (drained.data.processed !== 0) throw new Error("an unconnected delivery was selected for sending");
status("reused request ID with different action", await call("/api/rolls", { method: "POST", cookie: a.cookie, body: { ...request, action: { ...action, saveId: "will" } } }), 409);
const updated = await call(`/api/characters/${fixture.id}`, { method: "PUT", cookie: a.cookie, body: { character: { ...fixture, name: "After roll" }, revision: 1 } });
status("update character", updated, 200);
status("stale new roll denied", await call("/api/rolls", { method: "POST", cookie: a.cookie, body: { ...request, clientRequestId: randomUUID() } }), 409);
const recovered = await call("/api/rolls", { method: "POST", cookie: a.cookie, body: request });
status("retry after revision change", recovered, 200);
if (recovered.data.rollId !== first.data.rollId) throw new Error("retry did not recover the original roll");
console.log("Hosted roll API smoke passed: permissions, history, concentration, forged input, concurrency, idempotency, and stale revision.");
