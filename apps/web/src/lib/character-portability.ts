import { RulesEngine } from "@threepointpf/rules-core";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";
import { normalizeAuthoredCharacter } from "@threepointpf/shared";

export const CHARACTER_EXPORT_FORMAT = "threepointpf-character";
export const CHARACTER_EXPORT_VERSION = 1;
export const CHARACTER_LIBRARY_EXPORT_FORMAT = "threepointpf-character-library";
export const CHARACTER_LIBRARY_EXPORT_VERSION = 1;

export function exportCharacterSnapshot(character: CharacterInput): string {
  const canonical = parseCharacterInput(character);
  return JSON.stringify({
    format: CHARACTER_EXPORT_FORMAT,
    version: CHARACTER_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    character: canonical,
  }, null, 2);
}

/** Portable backup of the saved library, including the current in-memory draft. */
export function exportCharacterLibrarySnapshot(characters: CharacterInput[]): string {
  if (characters.length === 0) throw new Error("There are no characters to export.");
  const canonical = characters.map((character) => parseCharacterInput(character));
  const ids = new Set<string>();
  for (const character of canonical) {
    if (ids.has(character.id)) throw new Error("The character library contains duplicate ids.");
    ids.add(character.id);
  }
  canonical.sort((left, right) => left.name.localeCompare(right.name));
  return JSON.stringify({
    format: CHARACTER_LIBRARY_EXPORT_FORMAT,
    version: CHARACTER_LIBRARY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    characters: canonical,
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
  return validateImportedCharacter(envelope.character);
}

/** Validate every entry before a roster import is allowed to write any of them. */
export function importCharacterLibrarySnapshot(text: string): CharacterInput[] {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error("This file is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This is not a valid ThreePointPF character library export.");
  const envelope = raw as Record<string, unknown>;
  if (envelope.format !== CHARACTER_LIBRARY_EXPORT_FORMAT || !Number.isInteger(envelope.version) || !Array.isArray(envelope.characters)) throw new Error("This is not a valid ThreePointPF character library export.");
  if (Object.keys(envelope).some((key) => !["format", "version", "exportedAt", "characters"].includes(key))) throw new Error("The character library export contains unsupported envelope fields.");
  if (envelope.version !== CHARACTER_LIBRARY_EXPORT_VERSION) throw new Error(`Unsupported character library version ${String(envelope.version)}. This app supports version ${CHARACTER_LIBRARY_EXPORT_VERSION}.`);
  if (envelope.exportedAt !== undefined && (typeof envelope.exportedAt !== "string" || !Number.isFinite(Date.parse(envelope.exportedAt)))) throw new Error("The export timestamp is invalid.");
  if (envelope.characters.length === 0) throw new Error("This character library contains no characters.");
  const characters = envelope.characters.map(validateImportedCharacter);
  const ids = new Set<string>();
  for (const character of characters) {
    if (ids.has(character.id)) throw new Error(`The character library contains duplicate id ${character.id}.`);
    ids.add(character.id);
  }
  return characters;
}

function validateImportedCharacter(value: unknown): CharacterInput {
  const parsed = parseCharacterInput(value);
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
