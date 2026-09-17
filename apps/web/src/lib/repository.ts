import { progressionCatalog, rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput, ProgressionCatalog } from "@threepointpf/rules-schema";
import {
  LocalStorageCharacterRepository,
  SupabaseCharacterRepository,
  type CharacterRepository,
} from "@threepointpf/shared";
import { createClient } from "@supabase/supabase-js";

/** Imported content plus the character's own local definitions. */
export function activeCatalog(character: CharacterInput): ProgressionCatalog {
  return { ...progressionCatalog, ...(character.customProgressions ?? {}) };
}

/**
 * Supabase when the deployment supplies public credentials, otherwise the
 * local-storage draft. Never a service-role key.
 */
export function repository(): CharacterRepository {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key)
    return new SupabaseCharacterRepository(
      createClient(url, key),
      rulesCatalogs,
    );
  return new LocalStorageCharacterRepository(rulesCatalogs);
}
