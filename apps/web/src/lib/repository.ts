import { progressionCatalog, rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput, ProgressionCatalog } from "@threepointpf/rules-schema";
import { HttpCharacterRepository, InMemoryCharacterRepository, LocalStorageCharacterRepository, type CharacterRepository } from "@threepointpf/shared";
import { activeSheetEnvironment, sheetModeFor, type SheetEnvironment, type SheetMode } from "./sheet-mode";

export function activeCatalog(character: CharacterInput): ProgressionCatalog {
  return { ...progressionCatalog, ...(character.customProgressions ?? {}) };
}
export function sheetMode(environment: SheetEnvironment = activeSheetEnvironment()): SheetMode { return sheetModeFor(environment); }

function browserRepository(): CharacterRepository {
  try { return new LocalStorageCharacterRepository(rulesCatalogs); }
  catch { return new InMemoryCharacterRepository(rulesCatalogs); }
}
export function repositoryFor(mode: SheetMode, _environment: SheetEnvironment = activeSheetEnvironment()): CharacterRepository {
  if (mode === "hosted") return new HttpCharacterRepository({ rules: rulesCatalogs });
  return browserRepository();
}
export function repository(): CharacterRepository {
  const environment = activeSheetEnvironment();
  return repositoryFor(sheetModeFor(environment), environment);
}
