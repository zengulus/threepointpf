CREATE TABLE `campaign_discord_connections` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`encrypted_url` text NOT NULL,
	`webhook_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`guild_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
