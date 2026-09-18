import { progressionCatalog, rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput, ProgressionCatalog } from "@threepointpf/rules-schema";
import {
  InMemoryCharacterRepository,
  LocalStorageCharacterRepository,
  SupabaseCharacterRepository,
  type CharacterRepository,
} from "@threepointpf/shared";
import { createClient } from "@supabase/supabase-js";
import {
  activeSheetEnvironment,
  sheetModeFor,
  type SheetEnvironment,
  type SheetMode,
} from "./sheet-mode";

/** Imported content plus the character's own local definitions. */
export function activeCatalog(character: CharacterInput): ProgressionCatalog {
  return { ...progressionCatalog, ...(character.customProgressions ?? {}) };
}

export function sheetMode(
  environment: SheetEnvironment = activeSheetEnvironment(),
): SheetMode {
  return sheetModeFor(environment);
}

/**
 * Draft storage that needs nothing but the browser. `localStorage` is used when
 * the browser grants it, and an in-memory repository when it does not (private
 * browsing, hardened settings, a test process), so the demo always has
 * somewhere to save instead of failing on the first click.
 */
function browserDraftRepository(): CharacterRepository {
  try {
    return new LocalStorageCharacterRepository(rulesCatalogs);
  } catch {
    return new InMemoryCharacterRepository(rulesCatalogs);
  }
}

/**
 * The repository for a mode. `cloud` uses Supabase with the deployment's public
 * credentials; `demo` never talks to a server. Both keep the same validation and
 * canonicalization boundary, so a demo character and a cloud character are the
 * same shape.
 */
export function repositoryFor(
  mode: SheetMode,
  environment: SheetEnvironment = activeSheetEnvironment(),
): CharacterRepository {
  if (mode === "cloud" && environment.supabaseUrl && environment.supabaseKey)
    return new SupabaseCharacterRepository(
      createClient(environment.supabaseUrl, environment.supabaseKey),
      rulesCatalogs,
    );
  return browserDraftRepository();
}

/**
 * Supabase when the deployment supplies public credentials, otherwise the
 * in-browser draft. Never a service-role key.
 */
export function repository(): CharacterRepository {
  const environment = activeSheetEnvironment();
  return repositoryFor(sheetModeFor(environment), environment);
}
