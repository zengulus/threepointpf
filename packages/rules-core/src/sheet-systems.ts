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
  /** Autosheet capacity for investment in each receptacle, separate from pool. */
  essenceCapacity?: number;
  resourceBonus?: number;
  resourceInvested?: number;
  resourceRemaining?: number;
  knownCount?: number;
  knownByTier?: Record<string, number>;
  talentCount?: number;
  saveDc?: (tier: number) => number;
  entries: CharacterSystemSource["entries"];
  notes?: string;
}

/** Autosheet Spells!I63:AK68 and I85:AR100 talent-count convention. */
export function autosheetTalentRanks(name: string): number {
  let ranks = 1 - (name.includes("Free Talent") ? 1 : 0);
  for (let multiplier = 2; multiplier <= 5; multiplier += 1)
    if (name.includes(`x${multiplier}`)) ranks += multiplier - 1;
  return Math.max(0, ranks);
}

function sphereTalentCount(source: CharacterSystemSource): number {
  const authoredTalentRanks = source.entries
    .filter((entry) => entry.known !== false)
    .reduce((sum, entry) => sum + (entry.ranks ?? autosheetTalentRanks(entry.name)), 0);
  const selectedSpheres = new Set((source.sphereSelections ?? [])
    .map((name) => name.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean));
  const baseSphereTalents = [...selectedSpheres].filter((name) =>
    !(source.kind === "spheresOfMight" && name === "equipment"),
  ).length;
  return authoredTalentRanks + baseSphereTalents;
}

/** Resolves workbook-style level tables once; all displays use these rows. */
export function deriveCharacterSystems(
  sources: CharacterSystemSource[],
  abilityModifiers: Record<string, number>,
  progressionLevels: Record<string, number> = {},
  effectiveBab = 0,
  characterLevel = 0,
  globalLevelPenalty = 0,
  negativeLevelCount = 0,
): DerivedCharacterSystem[] {
  return sources.map((source) => {
    // Spells/Spheres!D19, D29, D52, D54, D56, D113 and D144 cap each
    // specialized-system class level with MIN(20, ...).
    const level = Math.min(20, (source.level ?? progressionLevels[source.progressionId ?? ""] ?? 0) + (source.classLevelAdjustment ?? 0));
    const row = [...source.progression].sort((a, b) => a.level - b.level).filter((item) => item.level <= level).at(-1);
    const fallbackCasterLevel = level;
    // Autosheet D54 sets Veilweaving level to adjusted class level (D52);
    // unlike the other chart-backed systems, an attached table cannot replace it.
    const baseCasterLevel = source.kind === "veilweaving" ? level : row?.casterLevel ?? fallbackCasterLevel;
    const casterLevel = baseCasterLevel + (source.casterLevelBonus ?? 0) - globalLevelPenalty;
    const resourceSpent = source.resourceSpent ?? 0;
    const abilityModifier = abilityModifiers[source.keyAbility] ?? 0;
    const resourceBase = source.kind === "veilweaving"
      // Autosheet D56 starts from character level; its level lookup belongs to
      // per-receptacle capacity in D58, not to the shared essence pool.
      ? characterLevel
      // Autosheet G65 is class level plus the key ability modifier, regardless
      // of any progression row attached to this character-owned source.
      : source.kind === "spheresOfPower" ? level + abilityModifier : row?.resourceMaximum;
    const resourceBonus = source.kind === "psionics"
      ? row?.resourceBonusByAbility?.[String(Math.min(15, Math.max(0, abilityModifier)))] ?? 0
      : 0;
    const resourceMaximum = resourceBase === undefined ? undefined
      : resourceBase + resourceBonus + (source.resourceMaximumBonus ?? 0) - (source.kind === "veilweaving" ? negativeLevelCount : 0);
    const essenceCapacity = source.kind === "veilweaving" && characterLevel > 0
      ? Math.floor(Math.min(20, characterLevel) / 6) + 1 + (source.essenceCapacityBonus ?? 0)
      : undefined;
    const resourceInvested = source.kind === "veilweaving" ? source.entries.reduce((sum, entry) => sum + (entry.essenceInvested ?? 0), 0) : 0;
    const saveDc = (tier: number) => source.kind === "spheresOfPower"
      ? 10 + Math.floor(casterLevel / 2) + abilityModifier
      : source.kind === "spheresOfMight"
        // Workbook D91 subtracts negative levels from effective BAB. Wound
        // penalties reduce caster level, not BAB, so they do not belong here.
        ? 10 + Math.floor((effectiveBab + (source.effectiveBabBonus ?? 0) - negativeLevelCount) / 2) + abilityModifier
      : 10 + Math.max(0, tier) + abilityModifier + (source.dcAdjustment ?? 0);
    return {
      id: source.id,
      kind: source.kind,
      name: source.name,
      level,
      casterLevel,
      maximumTier: row?.maximumTier ?? 0,
      ...(source.resourceName ? { resourceName: source.resourceName } : {}),
      ...(resourceMaximum !== undefined ? { resourceMaximum, resourceRemaining: Math.max(0, resourceMaximum - resourceSpent - resourceInvested), ...(source.kind === "veilweaving" ? { resourceInvested } : {}) } : {}),
      ...(essenceCapacity !== undefined ? { essenceCapacity } : {}),
      ...(resourceBonus ? { resourceBonus } : {}),
      ...(row?.knownCount !== undefined || source.entries.length ? { knownCount: row?.knownCount ?? source.entries.filter((entry) => entry.known !== false).length } : {}),
      ...(row?.knownByTier ? { knownByTier: row.knownByTier } : {}),
      ...(row?.talentCount !== undefined || source.entries.length || source.sphereSelections?.length ? { talentCount: row?.talentCount ?? (source.kind === "spheresOfPower" || source.kind === "spheresOfMight" ? sphereTalentCount(source) : source.entries.filter((entry) => entry.known !== false).length) } : {}),
      ...(source.kind !== "veilweaving" ? { saveDc } : {}),
      entries: source.entries,
      ...(source.notes ? { notes: source.notes } : {}),
    };
  });
}
