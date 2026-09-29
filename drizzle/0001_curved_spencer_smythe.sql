CREATE TABLE `campaign_members` (
	`campaign_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `account_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_members_account` ON `campaign_members` (`account_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `character_access` (
	`character_id` text NOT NULL,
	`account_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`character_id`, `account_id`),
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_character_access_account` ON `character_access` (`account_id`);