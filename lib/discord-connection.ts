/** Runtime-neutral webhook validation and encryption. No URL enters client reads. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function parseDiscordWebhook(value: unknown): { url: string; id: string } | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password || url.search || url.hash) return null;
  const match = /^\/api\/webhooks\/([0-9]{15,22})\/([A-Za-z0-9_-]{40,})$/.exec(url.pathname);
  return match ? { url: url.toString(), id: match[1]! } : null;
}

async function aesKey(value: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = unbase64(value); } catch { throw new Error("Discord encryption key is unavailable."); }
  if (bytes.length !== 32) throw new Error("Discord encryption key is unavailable.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptDiscordWebhook(url: string, campaignId: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(campaignId) }, key, encoder.encode(url));
  return `v1:${base64(iv)}:${base64(new Uint8Array(ciphertext))}`;
}

export async function decryptDiscordWebhook(encrypted: string, campaignId: string, secret: string): Promise<string> {
  const [version, ivText, cipherText] = encrypted.split(":");
  if (version !== "v1" || !ivText || !cipherText) throw new Error("Discord connection cannot be read.");
  const key = await aesKey(secret);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(ivText), additionalData: encoder.encode(campaignId) }, key, unbase64(cipherText));
    const url = decoder.decode(plaintext);
    if (!parseDiscordWebhook(url)) throw new Error("Invalid webhook");
    return url;
  } catch { throw new Error("Discord connection cannot be read."); }
}

export async function inspectDiscordWebhook(url: string, fetcher: typeof fetch = fetch): Promise<{ id: string; channelId: string; guildId: string | null }> {
  const parsed = parseDiscordWebhook(url);
  if (!parsed) throw new Error("Use a valid Discord webhook URL.");
  let response: Response;
  // Workers' fetch rejects redirect:"error" even for a direct 200 in the
  // local runtime. Manual mode prevents following an untrusted Location.
  try { response = await fetcher(parsed.url, { method: "GET", redirect: "manual" }); }
  catch { throw new Error("Could not verify this Discord webhook."); }
  if (!response.ok) throw new Error("Discord rejected this webhook. Check that it is still active.");
  let metadata: unknown;
  try { metadata = await response.json(); } catch { throw new Error("Discord returned invalid webhook details."); }
  if (!metadata || typeof metadata !== "object") throw new Error("Discord returned invalid webhook details.");
  const data = metadata as Record<string, unknown>;
  if (data.type !== 1 || data.id !== parsed.id || typeof data.channel_id !== "string" || !/^\d{15,22}$/.test(data.channel_id)) throw new Error("This webhook does not belong to a supported channel.");
  return { id: parsed.id, channelId: data.channel_id, guildId: typeof data.guild_id === "string" ? data.guild_id : null };
}
