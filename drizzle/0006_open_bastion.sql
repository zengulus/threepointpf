ALTER TABLE `sessions` ADD `active_role` text DEFAULT 'dm' NOT NULL;
--> statement-breakpoint
-- Existing player sessions stay in the player role after this additive migration.
UPDATE sessions SET active_role = 'player' WHERE account_id IN
  (SELECT id FROM accounts WHERE role = 'player');
