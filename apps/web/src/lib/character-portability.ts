import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";
import { normalizeAuthoredCharacter } from "@threepointpf/shared";

export const CHARACTER_EXPORT_FORMAT = "threepointpf-character";
export const CHARACTER_EXPORT_VERSION = 1;

export function exportCharacterSnapshot(character: CharacterInput): string {
  const canonical = parseCharacterInput(character);
  return JSON.stringify({
    format: CHARACTER_EXPORT_FORMAT,
    version: CHARACTER_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    character: canonical,
  }, null, 2);
}

/** Validate an untrusted file and recompute all derived state before returning it. */
export function importCharacterSnapshot(text: string): CharacterInput {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error("This file is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This is not a valid ThreepointPF character export.");
  const envelope = raw as Record<string, unknown>;
  if (envelope.format !== CHARACTER_EXPORT_FORMAT || !Number.isInteger(envelope.version) || !("character" in envelope)) throw new Error("This is not a valid ThreepointPF character export.");
  if (Object.keys(envelope).some((key) => !["format", "version", "exportedAt", "character"].includes(key))) throw new Error("The character export contains unsupported envelope fields.");
  if (envelope.version !== CHARACTER_EXPORT_VERSION)
    throw new Error(`Unsupported character export version ${String(envelope.version)}. This app supports version ${CHARACTER_EXPORT_VERSION}.`);
  if (envelope.exportedAt !== undefined && (typeof envelope.exportedAt !== "string" || !Number.isFinite(Date.parse(envelope.exportedAt)))) throw new Error("The export timestamp is invalid.");
  const parsed = parseCharacterInput(envelope.character);
  const canonical = normalizeAuthoredCharacter(parsed, rulesCatalogs);
  new RulesEngine(canonical, rulesCatalogs).derive();
  return canonical;
}

export function copyWithNewCharacterId(character: CharacterInput): CharacterInput {
  return parseCharacterInput({
    ...character,
    id: globalThis.crypto?.randomUUID?.() ?? `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
  });
}

export function characterFilename(name: string): string {
  const safe = name.normalize("NFKD").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "character";
  return `${safe.toLowerCase()}.threepointpf.json`;
}
