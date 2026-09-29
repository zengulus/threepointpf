import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["dm", "player", "co_dm"] }).notNull(),
  siteAdmin: integer("site_admin", { mode: "boolean" }).notNull().default(false),
  salt: text("salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  activeRole: text("active_role", { enum: ["dm", "player"] }).notNull().default("dm"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  campaignId: text("campaign_id").notNull(),
  snapshot: text("snapshot").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const campaignMembers = sqliteTable("campaign_members", {
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["dm", "player", "co_dm"] }).notNull(),
}, (table) => [primaryKey({ columns: [table.campaignId, table.accountId] }), index("idx_campaign_members_account").on(table.accountId)]);

export const characterAccess = sqliteTable("character_access", {
  characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  permission: text("permission", { enum: ["owner", "editor"] }).notNull(),
}, (table) => [primaryKey({ columns: [table.characterId, table.accountId] }), index("idx_character_access_account").on(table.accountId)]);

export const campaignDiscordConnections = sqliteTable("campaign_discord_connections", {
  campaignId: text("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(),
  encryptedUrl: text("encrypted_url").notNull(),
  webhookId: text("webhook_id").notNull(),
  channelId: text("channel_id").notNull(),
  guildId: text("guild_id"),
  version: integer("version").notNull().default(1),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastTestAt: integer("last_test_at"),
});

export const rollEvents = sqliteTable("roll_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  clientRequestId: text("client_request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "restrict" }),
  campaignId: text("campaign_id").notNull(),
  characterName: text("character_name").notNull(),
  characterRevision: integer("character_revision").notNull(),
  rulesVersion: text("rules_version").notNull(),
  requestJson: text("request_json").notNull(),
  planJson: text("plan_json").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
}, (table) => [
  uniqueIndex("roll_events_actor_request_unique").on(table.actorId, table.clientRequestId),
  index("roll_events_character_created_idx").on(table.characterId, table.createdAtMs),
  index("roll_events_actor_created_idx").on(table.actorId, table.createdAtMs),
]);

export const discordDeliveries = sqliteTable("discord_deliveries", {
  rollId: text("roll_id").primaryKey().references(() => rollEvents.id, { onDelete: "restrict" }),
  campaignId: text("campaign_id").notNull(),
  connectionId: text("connection_id"),
  connectionVersion: integer("connection_version"),
  state: text("state", { enum: ["not_configured", "pending", "sending", "sent", "retryable_failed", "permanent_failed", "delivery_unknown", "cancelled"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAtMs: integer("next_attempt_at_ms"),
  leaseToken: text("lease_token"),
  leaseExpiresAtMs: integer("lease_expires_at_ms"),
  messageId: text("message_id"),
  safeErrorCode: text("safe_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("discord_deliveries_due_idx").on(table.state, table.nextAttemptAtMs),
  index("discord_deliveries_campaign_idx").on(table.campaignId),
]);
