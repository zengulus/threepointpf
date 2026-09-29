ALTER TABLE `accounts` ADD `site_admin` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- The oldest existing DM becomes the explicit site recovery administrator.
UPDATE accounts SET site_admin = 1 WHERE id =
  (SELECT id FROM accounts WHERE role = 'dm' ORDER BY created_at, id LIMIT 1);
--> statement-breakpoint
-- Keep every existing character in its authored campaign; never infer ownership.
INSERT OR IGNORE INTO campaigns (id, name, created_at)
  SELECT campaign_id, campaign_id, MIN(updated_at) FROM characters
  WHERE campaign_id <> '' GROUP BY campaign_id;
--> statement-breakpoint
-- Pre-migration DMs already had global access, so preserve it for existing campaigns.
INSERT OR IGNORE INTO campaign_members (campaign_id, account_id, role)
  SELECT c.id, a.id, 'dm' FROM campaigns c CROSS JOIN accounts a WHERE a.role = 'dm';
--> statement-breakpoint
-- Retain existing explicit player assignments only in their character's campaign.
INSERT OR IGNORE INTO campaign_members (campaign_id, account_id, role)
  SELECT DISTINCT c.campaign_id, a.id, 'player' FROM character_access x
  JOIN characters c ON c.id = x.character_id
  JOIN accounts a ON a.id = x.account_id
  WHERE a.role = 'player' AND c.campaign_id <> '';
