import { getDb } from "../db";
import type { Account } from "./accounts";

/** The original site's first DM retains recovery access to unassigned records. */
export function isSiteAdmin(actor: Account): boolean {
  return actor.activeRole === "dm" && actor.siteAdmin;
}

export async function mayManageCampaign(actor: Account, campaignId: string): Promise<boolean> {
  if (isSiteAdmin(actor)) return true;
  if (actor.activeRole !== "dm") return false;
  const row = await getDb().prepare("SELECT 1 FROM campaign_members WHERE campaign_id = ? AND account_id = ? AND role = ?")
    .bind(campaignId, actor.id, actor.role).first();
  return Boolean(row);
}

export async function mayViewCampaign(actor: Account, campaignId: string): Promise<boolean> {
  if (isSiteAdmin(actor)) return true;
  const row = await getDb().prepare("SELECT 1 FROM campaign_members WHERE campaign_id = ? AND account_id = ? AND role = ?")
    .bind(campaignId, actor.id, actor.role).first();
  return Boolean(row);
}

export async function mayReadCharacter(actor: Account, characterId: string): Promise<boolean> {
  if (isSiteAdmin(actor)) return true;
  const row = await getDb().prepare(`SELECT 1 FROM characters c
    JOIN campaign_members m ON m.campaign_id = c.campaign_id AND m.account_id = ? AND m.role = ?
    WHERE c.id = ? AND (? = 'dm' OR EXISTS
      (SELECT 1 FROM character_access x WHERE x.character_id = c.id AND x.account_id = ?))`)
    .bind(actor.id, actor.role, characterId, actor.activeRole, actor.id).first();
  return Boolean(row);
}

export async function mayEditCharacter(actor: Account, characterId: string): Promise<boolean> {
  if (isSiteAdmin(actor)) return true;
  const row = await getDb().prepare(`SELECT 1 FROM characters c
    JOIN campaign_members m ON m.campaign_id = c.campaign_id AND m.account_id = ? AND m.role = ?
    WHERE c.id = ? AND (? = 'dm' OR EXISTS
      (SELECT 1 FROM character_access x WHERE x.character_id = c.id AND x.account_id = ?
       AND x.permission IN ('owner', 'editor')))`)
    .bind(actor.id, actor.role, characterId, actor.activeRole, actor.id).first();
  return Boolean(row);
}

export async function mayCreateCharacter(actor: Account, campaignId: string): Promise<boolean> {
  if (isSiteAdmin(actor)) return true;
  const row = await getDb().prepare("SELECT 1 FROM campaign_members WHERE campaign_id = ? AND account_id = ? AND role = ?")
    .bind(campaignId, actor.id, actor.role).first();
  return Boolean(row);
}
