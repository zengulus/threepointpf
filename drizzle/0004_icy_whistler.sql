CREATE TABLE `discord_deliveries` (
	`roll_id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`connection_id` text,
	`connection_version` integer,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer,
	`lease_token` text,
	`lease_expires_at_ms` integer,
	`message_id` text,
	`safe_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`roll_id`) REFERENCES `roll_events`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `discord_deliveries_due_idx` ON `discord_deliveries` (`state`,`next_attempt_at_ms`);--> statement-breakpoint
CREATE INDEX `discord_deliveries_campaign_idx` ON `discord_deliveries` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `roll_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`character_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`character_name` text NOT NULL,
	`character_revision` integer NOT NULL,
	`rules_version` text NOT NULL,
	`request_json` text NOT NULL,
	`plan_json` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roll_events_actor_request_unique` ON `roll_events` (`actor_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `roll_events_character_created_idx` ON `roll_events` (`character_id`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `roll_events_actor_created_idx` ON `roll_events` (`actor_id`,`created_at_ms`);