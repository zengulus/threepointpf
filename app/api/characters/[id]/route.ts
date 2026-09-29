import { parseCharacterInput } from "@threepointpf/rules-schema";
import { getDb } from "../../../../db";
import { currentAccount, error, json, readObject, sameOrigin, sessionRequired } from "../../../../lib/accounts";
import { isSiteAdmin, mayCreateCharacter, mayEditCharacter, mayReadCharacter } from "../../../../lib/character-access";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  const { id } = await context.params;
  if (!await mayReadCharacter(actor, id)) return error("not-found", "Character not found.", 404);
  const row = await getDb().prepare("SELECT snapshot, revision FROM characters WHERE id = ?").bind(id).first<{ snapshot: string; revision: number }>();
  if (!row) return error("not-found", "Character not found.", 404);
  try { return json({ character: JSON.parse(row.snapshot), revision: row.revision }); }
  catch { return error("server", "Character data could not be loaded.", 500); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentAccount(request);
  if (!actor) return sessionRequired();
  if (!sameOrigin(request)) return error("forbidden", "This request could not be verified.", 403);
  const { id } = await context.params;
  const body = await readObject(request);
  if (!body || !body.character || typeof body.character !== "object" || Array.isArray(body.character)) return error("validation", "Character data is invalid.", 400);
  let character;
  try { character = parseCharacterInput(body.character); }
  catch { return error("validation", "Character data did not pass validation.", 422); }
  if (character.id !== id || !character.name.trim()) return error("validation", "Character ID and name are required.", 400);
  if (body.revision !== undefined && (!Number.isInteger(body.revision) || Number(body.revision) < 1)) return error("validation", "Character revision is invalid.", 400);
  const db = getDb();
  const existing = await db.prepare("SELECT campaign_id AS campaignId, revision FROM characters WHERE id = ?").bind(id).first<{ campaignId: string; revision: number }>();
  if (existing) {
    if (!await mayEditCharacter(actor, id)) return error("not-found", "Character not found.", 404);
    if (character.campaignId && character.campaignId !== existing.campaignId) return error("forbidden", "Move characters through campaign management.", 403);
    if (body.revision === undefined) return error("conflict", "Reload this character before saving.", 409);
  } else if (body.revision !== undefined) {
    return error("conflict", "This character was removed elsewhere. Reload before saving again.", 409);
  } else if (!character.campaignId && !isSiteAdmin(actor)) {
    return error("validation", "Choose a campaign before adding a character.", 400);
  } else if (!await mayCreateCharacter(actor, character.campaignId ?? "demo-campaign")) {
    return error("forbidden", "You cannot add a character to this campaign.", 403);
  }
  const updatedAt = new Date().toISOString();
  const snapshot = JSON.stringify(character);
  if (existing) {
    const admin = isSiteAdmin(actor) ? 1 : 0;
    const result = await db.prepare(`UPDATE characters SET name = ?, snapshot = ?, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE id = ? AND revision = ?
        AND (? = 1 OR EXISTS (SELECT 1 FROM campaign_members
          WHERE campaign_id = ? AND account_id = ? AND role = ?))
        AND (? = 1 OR ? = 'dm' OR EXISTS (SELECT 1 FROM character_access
          WHERE character_id = ? AND account_id = ? AND permission IN ('owner', 'editor')))`)
      .bind(character.name, snapshot, updatedAt, actor.id, id, body.revision,
        admin, existing.campaignId, actor.id, actor.role, admin, actor.activeRole, id, actor.id).run();
    if (!result.meta.changes) return error("conflict", "This character changed elsewhere. Reload before saving again.", 409);
  } else {
    try {
      const campaignId = character.campaignId ?? "demo-campaign";
      const statements = [];
      if (isSiteAdmin(actor)) statements.push(db.prepare("INSERT OR IGNORE INTO campaigns (id, name, created_at) VALUES (?, ?, ?)").bind(campaignId, campaignId, updatedAt));
      statements.push(db.prepare(`INSERT INTO characters (id, name, campaign_id, snapshot, revision, updated_at, updated_by)
        SELECT ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (
          SELECT 1 FROM accounts a WHERE a.id = ? AND
            ((a.site_admin = 1 AND ? = 'dm') OR EXISTS (
              SELECT 1 FROM campaign_members m WHERE m.campaign_id = ? AND m.account_id = a.id AND m.role = a.role))
        )`).bind(id, character.name, campaignId, snapshot, updatedAt, actor.id, actor.id, actor.activeRole, campaignId));
      if (actor.activeRole === "player") statements.push(db.prepare(`INSERT INTO character_access (character_id, account_id, permission)
        SELECT id, ?, 'owner' FROM characters WHERE id = ? AND updated_by = ?`).bind(actor.id, id, actor.id));
      const result = await db.batch(statements);
      if (!result[isSiteAdmin(actor) ? 1 : 0]?.meta.changes) return error("forbidden", "You cannot add a character to this campaign.", 403);
    } catch { return error("conflict", "This character already exists. Reload before saving again.", 409); }
  }
  const row = await db.prepare("SELECT revision FROM characters WHERE id = ?").bind(id).first<{ revision: number }>();
  return json({ character, revision: row?.revision ?? 1 });
}
