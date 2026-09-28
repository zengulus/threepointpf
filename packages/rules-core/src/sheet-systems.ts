import type { CharacterSystemSource } from "@threepointpf/rules-schema";

export interface DerivedCharacterSystem {
  id: string;
  kind: CharacterSystemSource["kind"];
  name: string;
  level: number;
  casterLevel: number;
  maximumTier: number;
  resourceName?: string;
  resourceMaximum?: number;
  resourceBonus?: number;
  resourceRemaining?: number;
  knownCount?: number;
  knownByTier?: Record<string, number>;
  talentCount?: number;
  saveDc?: (tier: number) => number;
  entries: CharacterSystemSource["entries"];
  notes?: string;
}

/** Resolves workbook-style level tables once; all displays use these rows. */
export function deriveCharacterSystems(
  sources: CharacterSystemSource[],
  abilityModifiers: Record<string, number>,
  progressionLevels: Record<string, number> = {},
  effectiveBab = 0,
  characterLevel = 0,
  globalLevelPenalty = 0,
): DerivedCharacterSystem[] {
  return sources.map((source) => {
    const level = source.level ?? progressionLevels[source.progressionId ?? ""] ?? 0;
    const row = [...source.progression].sort((a, b) => a.level - b.level).filter((item) => item.level <= level).at(-1);
    const fallbackCasterLevel = level;
    const casterLevel = Math.max(0, (row?.casterLevel ?? fallbackCasterLevel) + (source.casterLevelBonus ?? 0) - globalLevelPenalty);
    const resourceSpent = source.resourceSpent ?? 0;
    const abilityModifier = abilityModifiers[source.keyAbility] ?? 0;
    const resourceBase = row?.resourceMaximum
      ?? (source.kind === "spheresOfPower" ? Math.max(0, level + abilityModifier)
        : source.kind === "veilweaving" && characterLevel > 0 ? Math.floor(Math.min(20, characterLevel) / 6) + 1
          : undefined);
    const resourceBonus = row?.resourceBonusByAbility?.[String(Math.min(15, Math.max(0, abilityModifier)))] ?? 0;
    const resourceMaximum = resourceBase === undefined ? undefined : Math.max(0, resourceBase + resourceBonus + (source.resourceMaximumBonus ?? 0));
    const saveDc = (tier: number) => source.kind === "spheresOfPower"
      ? 10 + Math.floor(casterLevel / 2) + abilityModifier
      : source.kind === "spheresOfMight"
        ? 10 + Math.floor(Math.max(0, effectiveBab + (source.effectiveBabBonus ?? 0) - globalLevelPenalty) / 2) + abilityModifier
      : 10 + Math.max(0, tier) + abilityModifier + (source.dcAdjustment ?? 0);
    return {
      id: source.id,
      kind: source.kind,
      name: source.name,
      level,
      casterLevel,
      maximumTier: row?.maximumTier ?? 0,
      ...(source.resourceName ? { resourceName: source.resourceName } : {}),
      ...(resourceMaximum !== undefined ? { resourceMaximum, resourceRemaining: Math.max(0, resourceMaximum - resourceSpent) } : {}),
      ...(resourceBonus ? { resourceBonus } : {}),
      ...(row?.knownCount !== undefined || source.entries.length ? { knownCount: row?.knownCount ?? source.entries.filter((entry) => entry.known !== false).length } : {}),
      ...(row?.knownByTier ? { knownByTier: row.knownByTier } : {}),
      ...(row?.talentCount !== undefined || source.entries.length ? { talentCount: row?.talentCount ?? (source.kind === "spheresOfPower" || source.kind === "spheresOfMight" ? source.entries.filter((entry) => entry.known !== false).reduce((sum, entry) => sum + (entry.ranks ?? 1), 0) : source.entries.filter((entry) => entry.known !== false).length) } : {}),
      ...(source.kind !== "veilweaving" ? { saveDc } : {}),
      entries: source.entries,
      ...(source.notes ? { notes: source.notes } : {}),
    };
  });
}
