import { formatModifier, type ResolvedRoll } from "@threepointpf/dice";
import type { RollPlan } from "@threepointpf/rules-schema";
import { formatResolvedOutcome, formatRollDefense } from "./roll-result";

/** Browser-local integration preferences; never authored character data. */
export interface DiscordRollSettings {
  enabled: boolean;
  webhookUrl: string;
  displayName: string;
}

export const defaultDiscordRollSettings: DiscordRollSettings = {
  enabled: false,
  webhookUrl: "",
  displayName: "",
};

export const discordRollSettingsStorageKey = "threepointpf.discord.roll-publishing";

export interface DiscordSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function browserDiscordSettingsStorage(): DiscordSettingsStorage | null {
  const storage = (globalThis as { localStorage?: DiscordSettingsStorage })
    .localStorage;
  return storage && typeof storage.getItem === "function" ? storage : null;
}

const discordWebhookHosts = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

export interface ValidDiscordWebhook {
  valid: true;
  value: string;
}

export interface InvalidDiscordWebhook {
  valid: false;
  message: string;
}

export type DiscordWebhookValidation = ValidDiscordWebhook | InvalidDiscordWebhook;

/**
 * Keep publishing deliberately limited to Discord's HTTPS webhook endpoints.
 * Besides giving useful validation, this prevents an accidentally pasted URL
 * from becoming an arbitrary cross-origin posting destination.
 */
export function validateDiscordWebhookUrl(
  value: string,
): DiscordWebhookValidation {
  const candidate = value.trim();
  if (!candidate)
    return { valid: false, message: "Enter a Discord webhook URL." };
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { valid: false, message: "Enter a valid Discord webhook URL." };
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !discordWebhookHosts.has(url.hostname.toLowerCase())
  )
    return { valid: false, message: "Use an HTTPS Discord webhook URL." };
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== "api" ||
    parts[1] !== "webhooks" ||
    !parts[2] ||
    !parts[3]
  )
    return { valid: false, message: "Use a Discord webhook URL copied from Discord." };
  return { valid: true, value: url.toString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

/** Corrupt stored credentials fail closed: no URL means publishing is disabled. */
export function validateDiscordRollSettings(value: unknown): DiscordRollSettings {
  if (!isRecord(value)) return { ...defaultDiscordRollSettings };
  const webhook =
    typeof value.webhookUrl === "string"
      ? validateDiscordWebhookUrl(value.webhookUrl)
      : { valid: false as const, message: "" };
  return {
    enabled: value.enabled === true && webhook.valid,
    webhookUrl: webhook.valid ? webhook.value : "",
    displayName: displayName(value.displayName),
  };
}

export function loadDiscordRollSettings(
  storage: DiscordSettingsStorage | null = browserDiscordSettingsStorage(),
): DiscordRollSettings {
  if (!storage) return { ...defaultDiscordRollSettings };
  try {
    const raw = storage.getItem(discordRollSettingsStorageKey);
    return raw ? validateDiscordRollSettings(JSON.parse(raw)) : { ...defaultDiscordRollSettings };
  } catch {
    return { ...defaultDiscordRollSettings };
  }
}

/** Returns false when browser storage is unavailable, without breaking rolls. */
export function saveDiscordRollSettings(
  settings: DiscordRollSettings,
  storage: DiscordSettingsStorage | null = browserDiscordSettingsStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      discordRollSettingsStorageKey,
      JSON.stringify(validateDiscordRollSettings(settings)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDiscordRollSettings(
  storage: DiscordSettingsStorage | null = browserDiscordSettingsStorage(),
): void {
  try {
    storage?.removeItem?.(discordRollSettingsStorageKey);
  } catch {
    // The in-memory settings can still be cleared if browser storage refuses it.
  }
}

/** Shows enough to identify a saved endpoint without rendering its token. */
export function maskDiscordWebhookUrl(value: string): string {
  const valid = validateDiscordWebhookUrl(value);
  if (!valid.valid) return "No webhook configured";
  const url = new URL(valid.value);
  const id = url.pathname.split("/").filter(Boolean)[2] ?? "";
  return `${url.hostname}/api/webhooks/${id.slice(0, 6)}…/••••`;
}

function compact(value: string, limit: number): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, limit);
}

export interface DiscordWebhookPayload {
  content: string;
  username?: string;
  allowed_mentions: { parse: [] };
  tts: false;
}

/** A readable table message made only from already-resolved roll facts. */
export function formatDiscordRollMessage(
  characterName: string,
  plan: RollPlan,
  resolved: ResolvedRoll,
): string {
  const parts = [
    `**${compact(characterName || "Unnamed character", 120)}** — **${compact(plan.label, 180)}**`,
    resolved.naturalFace === undefined
      ? `Dice ${resolved.faces.join(", ")}`
      : `Natural d20 ${resolved.naturalFace}`,
    `Modifier ${formatModifier(resolved.modifier)}`,
    plan.context.kind === "damage" ? `Damage ${resolved.total}` : `Total ${resolved.total}`,
  ];
  if (resolved.outcome.defense)
    parts.push(`vs ${formatRollDefense(resolved.outcome.defense)}`);
  if (plan.outcomePolicy.kind !== "plain")
    parts.push(formatResolvedOutcome(plan, resolved));
  if (plan.context.criticalDamage) parts.push("Critical damage");
  return compact(parts.join(" · "), 2_000);
}

export function discordPayloadForRoll(
  settings: DiscordRollSettings,
  characterName: string,
  plan: RollPlan,
  resolved: ResolvedRoll,
): DiscordWebhookPayload {
  const username = displayName(settings.displayName);
  return {
    content: formatDiscordRollMessage(characterName, plan, resolved),
    ...(username ? { username } : {}),
    allowed_mentions: { parse: [] },
    tts: false,
  };
}

export class DiscordPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordPublishError";
  }
}

type FetchLike = typeof fetch;

/**
 * One network boundary for both test messages and completed rolls. It never
 * includes an endpoint in an error, so callers can safely surface its message.
 */
export async function postDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  fetcher: FetchLike | undefined = globalThis.fetch,
): Promise<void> {
  const webhook = validateDiscordWebhookUrl(webhookUrl);
  if (!webhook.valid) throw new DiscordPublishError(webhook.message);
  if (!fetcher)
    throw new DiscordPublishError("Discord publishing is unavailable in this browser.");
  let response: Response;
  try {
    response = await fetcher(webhook.value, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new DiscordPublishError("Could not reach Discord. Check the webhook and connection.");
  }
  if (!response.ok)
    throw new DiscordPublishError(
      `Discord rejected the message (HTTP ${response.status}).`,
    );
}

export async function publishCompletedRoll(
  settings: DiscordRollSettings,
  characterName: string,
  plan: RollPlan,
  resolved: ResolvedRoll,
): Promise<boolean> {
  if (!settings.enabled) return false;
  await postDiscordWebhook(
    settings.webhookUrl,
    discordPayloadForRoll(settings, characterName, plan, resolved),
  );
  return true;
}

export async function testDiscordWebhook(
  settings: DiscordRollSettings,
): Promise<void> {
  const webhook = validateDiscordWebhookUrl(settings.webhookUrl);
  if (!webhook.valid) throw new DiscordPublishError(webhook.message);
  const username = displayName(settings.displayName);
  await postDiscordWebhook(webhook.value, {
    content: "3.PF test message — Discord roll publishing is connected.",
    ...(username ? { username } : {}),
    allowed_mentions: { parse: [] },
    tts: false,
  });
}
