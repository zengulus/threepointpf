import type { CharacterInput } from "@threepointpf/rules-schema";
import { refreshResources } from "./ability-resources.js";
import { refreshSpellcasting } from "./spellcasting.js";

/** Refreshes explicitly daily character resources without changing timed effects or combat state. */
export function refreshDailyCharacterResources(character: CharacterInput): CharacterInput {
  let next = refreshResources(character, "daily");
  for (const source of next.spellcastingSources ?? [])
    next = refreshSpellcasting(next, source.id);

  return {
    ...next,
    abilities: (next.abilities ?? []).map((ability) => ability.usesPerDay === undefined
      ? ability
      : { ...ability, usesSpent: 0 }),
    systems: (next.systems ?? []).map((source) => ({
      ...source,
      ...(["veilweaving", "spheresOfPower", "psionics", "ffd20"].includes(source.kind)
        ? { resourceSpent: 0 }
        : {}),
      entries: source.entries.map((entry) => entry.usesPerDay === undefined
        ? entry
        : { ...entry, usesSpent: 0, expended: false }),
    })),
  };
}
