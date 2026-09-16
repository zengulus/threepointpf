import {
  saveIds,
  type AdvancementSlot,
  type BabProgression,
  type ProgressionCatalog,
  type ProgressionDefinition,
  type SaveId,
  type SaveProgression,
} from "@threepointpf/rules-schema";

export interface ProgressionIncrement {
  slotId: string;
  trackId: string;
  progressionId: string;
  /** Level in this progression before this ordered slot/track entry. */
  previousLevel: number;
  /** Character-global level in this progression after this entry. */
  level: number;
  bab: number;
  saves: Record<SaveId, number>;
  hitDieSides: number;
  skillPoints: number;
}

export interface TrackAdvancementResult {
  id: string;
  bab: number;
  saves: Record<SaveId, number>;
  hitDieSides: number[];
  skillPoints: number;
  /** Every global progression increment credited to this complete track. */
  increments: ProgressionIncrement[];
}

export interface ProgressionLevelResult {
  id: string;
  name: string;
  level: number;
  /** Ordered evidence showing where each character-global level was earned. */
  increments: ProgressionIncrement[];
}

export interface AdvancementFeatureGrant {
  id: string;
  name: string;
  progressionId: string;
  level: number;
  slotId: string;
  trackId: string;
  description?: string;
}

export interface SlotHitDie {
  slotId: string;
  trackId: string;
  sides: number;
}

export interface AdvancementEvaluation {
  slotCount: number;
  tracks: TrackAdvancementResult[];
  babTrack: TrackAdvancementResult;
  saveTracks: Record<SaveId, TrackAdvancementResult>;
  progressionLevels: ProgressionLevelResult[];
  features: AdvancementFeatureGrant[];
  hitDiceCount: number;
  hitDieSides: number[];
  hitDieSources: SlotHitDie[];
  skillPoints: number;
}

interface AdvancementValues {
  bab: number;
  saves: Record<SaveId, number>;
}

function babAt(progression: BabProgression, level: number): number {
  if (progression === "full") return level;
  if (progression === "threeQuarters") return Math.floor(level * 3 / 4);
  if (progression === "half") return Math.floor(level / 2);
  return Math.floor(level / 4);
}

function saveAt(progression: SaveProgression, level: number): number {
  if (level === 0) return 0;
  return progression === "good" ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
}

function emptySaves(): Record<SaveId, number> {
  return { fortitude: 0, reflex: 0, will: 0 };
}

function valuesAt(definition: ProgressionDefinition, level: number): AdvancementValues {
  if (level === 0) return { bab: 0, saves: emptySaves() };
  const chartEntry = definition.chart?.find((entry) => entry.level === level);
  if (definition.chart && !chartEntry) throw new Error(`Progression ${definition.id} has no chart row for global level ${level}`);
  if (chartEntry) return { bab: chartEntry.bab, saves: { ...chartEntry.saves } };
  const saves = emptySaves();
  for (const saveId of saveIds) saves[saveId] = saveAt(definition.saveProgressions[saveId], level);
  return { bab: babAt(definition.babProgression, level), saves };
}

function bestTrack(tracks: TrackAdvancementResult[], property: (track: TrackAdvancementResult) => number): TrackAdvancementResult {
  const first = tracks[0];
  if (!first) throw new Error("Advancement requires at least one track");
  return tracks.slice(1).reduce((best, candidate) => property(candidate) > property(best) ? candidate : best, first);
}

function assertSlotTopology(slots: AdvancementSlot[]): void {
  const first = slots[0];
  if (!first) throw new Error("Advancement requires at least one slot");
  const slotIds = new Set<string>();
  const expectedTrackIds = first.tracks.map((track) => track.id);
  if (expectedTrackIds.length === 0) throw new Error(`Advancement slot ${first.id} requires at least one track`);
  for (const slot of slots) {
    if (slotIds.has(slot.id)) throw new Error(`Duplicate advancement slot id ${slot.id}`);
    slotIds.add(slot.id);
    const seen = new Set<string>();
    for (const track of slot.tracks) {
      if (seen.has(track.id)) throw new Error(`Duplicate advancement track id ${track.id} in slot ${slot.id}`);
      seen.add(track.id);
    }
    if (slot.tracks.length !== expectedTrackIds.length || slot.tracks.some((track, index) => track.id !== expectedTrackIds[index])) {
      throw new Error("Each advancement slot must use the same ordered track ids");
    }
  }
}

/**
 * Evaluates ordered advancement slots using an injected content catalog.
 *
 * Progression level is character-global: if Fighter occurs on two different
 * tracks, the second ordered occurrence earns Fighter level 2. The resulting
 * BAB/save delta is nevertheless credited to the track occupying that slot.
 * A slot's track-array order is therefore the deterministic order when the
 * same progression occurs more than once in a single slot.
 */
export function evaluateAdvancement(slots: AdvancementSlot[], catalog: ProgressionCatalog): AdvancementEvaluation {
  assertSlotTopology(slots);
  const byTrack = new Map<string, TrackAdvancementResult>();
  const globalProgressionLevels = new Map<string, ProgressionLevelResult>();
  const hitDieSources: SlotHitDie[] = [];
  const slotSkillPoints: number[] = [];
  const featureGrants: AdvancementFeatureGrant[] = [];

  for (const slot of slots) {
    const slotCandidates: Array<{ trackId: string; definition: ProgressionDefinition }> = [];
    for (const track of slot.tracks) {
      const definition = catalog[track.entry.progressionId];
      if (!definition) throw new Error(`Unknown progression definition ${track.entry.progressionId}`);
      slotCandidates.push({ trackId: track.id, definition });

      const progression = globalProgressionLevels.get(definition.id) ?? {
        id: definition.id,
        name: definition.name,
        level: 0,
        increments: [],
      };
      const previousLevel = progression.level;
      const level = previousLevel + 1;
      const previousValues = valuesAt(definition, previousLevel);
      const currentValues = valuesAt(definition, level);
      const saves = emptySaves();
      for (const saveId of saveIds) saves[saveId] = currentValues.saves[saveId] - previousValues.saves[saveId];
      const increment: ProgressionIncrement = {
        slotId: slot.id,
        trackId: track.id,
        progressionId: definition.id,
        previousLevel,
        level,
        bab: currentValues.bab - previousValues.bab,
        saves,
        hitDieSides: definition.hitDieSides,
        skillPoints: definition.skillPointsPerLevel ?? 0,
      };
      progression.level = level;
      progression.increments.push(increment);
      globalProgressionLevels.set(definition.id, progression);

      const result = byTrack.get(track.id) ?? { id: track.id, bab: 0, saves: emptySaves(), hitDieSides: [], skillPoints: 0, increments: [] };
      result.bab += increment.bab;
      for (const saveId of saveIds) result.saves[saveId] += increment.saves[saveId];
      result.hitDieSides.push(definition.hitDieSides);
      result.skillPoints += increment.skillPoints;
      result.increments.push(increment);
      byTrack.set(track.id, result);

      for (const feature of definition.features?.filter((item) => item.level === level) ?? []) {
        // Metadata is exposed as an unlock; it never invents a numeric rule effect.
        featureGrants.push({
          id: feature.id,
          name: feature.name,
          progressionId: definition.id,
          level,
          slotId: slot.id,
          trackId: track.id,
          ...(feature.description ? { description: feature.description } : {}),
        });
      }
    }

    const bestHitDie = slotCandidates.reduce((best, candidate) => candidate.definition.hitDieSides > best.definition.hitDieSides ? candidate : best);
    hitDieSources.push({ slotId: slot.id, trackId: bestHitDie.trackId, sides: bestHitDie.definition.hitDieSides });
    slotSkillPoints.push(Math.max(...slotCandidates.map((candidate) => candidate.definition.skillPointsPerLevel ?? 0)));
  }

  const tracks = [...byTrack.values()];
  const saveTracks = {} as Record<SaveId, TrackAdvancementResult>;
  for (const saveId of saveIds) saveTracks[saveId] = bestTrack(tracks, (track) => track.saves[saveId]);
  const babTrack = bestTrack(tracks, (track) => track.bab);
  return {
    slotCount: slots.length,
    tracks,
    babTrack,
    saveTracks,
    progressionLevels: [...globalProgressionLevels.values()],
    features: featureGrants,
    hitDiceCount: slots.length,
    hitDieSides: hitDieSources.map((source) => source.sides),
    hitDieSources,
    skillPoints: slotSkillPoints.reduce((total, value) => total + value, 0),
  };
}

/** Finds one character-global progression level record in an advancement evaluation. */
export function progressionLevel(evaluation: AdvancementEvaluation, progressionId: string): ProgressionLevelResult | undefined {
  return evaluation.progressionLevels.find((item) => item.id === progressionId);
}
