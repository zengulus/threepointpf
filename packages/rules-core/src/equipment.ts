import type {
  CharacterInput,
  Effect,
  EquipmentCatalog,
} from "@threepointpf/rules-schema";
import { lookup } from "./contributions.js";
import type { EquipmentEntry } from "./runtime.js";

/**
 * Merges authored equipment instances with their injected catalog definitions.
 * A definition supplies the chassis; an instance supplies the override and the
 * equipped state. Instance attacks and effects win over definition ones.
 */
export function resolveEquipment(
  character: CharacterInput,
  catalog?: EquipmentCatalog,
): EquipmentEntry[] {
  return (character.equipment ?? []).map((item) => {
    const definition = item.definitionId
      ? lookup(catalog, item.definitionId)
      : undefined;
    if (item.definitionId && !definition)
      throw new Error(`Unknown equipment definition ${item.definitionId}`);
    return {
      ...definition,
      ...item,
      effects: [...(definition?.effects ?? []), ...(item.effects ?? [])],
    };
  });
}

/**
 * Equipped items contribute effects with an item-qualified source, so
 * provenance names the actual item rather than a bare catalog entry.
 */
export function collectEquipmentEffects(equipment: EquipmentEntry[]): Effect[] {
  const effects: Effect[] = [];
  for (const item of equipment.filter((entry) => entry.equipped)) {
    const metadata = item.definitionId ? item.source : undefined;
    for (const effect of item.effects ?? [])
      effects.push({
        ...effect,
        source: {
          id: `equipment.${item.id}${effect.source ? `.${effect.source.id}` : ""}`,
          label: effect.source
            ? `${item.name ?? item.id}: ${effect.source.label}`
            : (item.name ?? item.id),
          ...((effect.source?.content ?? metadata)
            ? { content: effect.source?.content ?? metadata }
            : {}),
        },
      });
  }
  return effects;
}
