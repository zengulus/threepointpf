import { saveIds, type AdvancementSlot, type BabProgression, type ProgressionDefinition, type SaveId, type SaveProgression } from "@threepointpf/rules-schema";

/** Tiny structural seed only; this is intentionally not the Pathfinder class corpus. */
export const progressionDefinitions: Record<string, ProgressionDefinition> = {
  fighter: {
    id: "fighter", name: "Fighter", hitDieSides: 10, babProgression: "full",
    saveProgressions: { fortitude: "good", reflex: "poor", will: "poor" }, skillPointsPerLevel: 2,
  },
  wizard: {
    id: "wizard", name: "Wizard", hitDieSides: 6, babProgression: "half",
    saveProgressions: { fortitude: "poor", reflex: "poor", will: "good" }, skillPointsPerLevel: 2,
  },
  rogue: {
    id: "rogue", name: "Rogue", hitDieSides: 8, babProgression: "threeQuarters",
    saveProgressions: { fortitude: "poor", reflex: "good", will: "poor" }, skillPointsPerLevel: 8,
  },
};

export interface TrackAdvancementResult {
  id: string;
  bab: number;
  saves: Record<SaveId, number>;
  hitDieSides: number[];
  skillPoints: number;
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
  hitDiceCount: number;
  hitDieSides: number[];
  hitDieSources: SlotHitDie[];
  skillPoints: number;
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

function bestTrack(tracks: TrackAdvancementResult[], property: (track: TrackAdvancementResult) => number): TrackAdvancementResult {
  const first = tracks[0];
  if (!first) throw new Error("Advancement requires at least one track");
  return tracks.slice(1).reduce((best, candidate) => property(candidate) > property(best) ? candidate : best, first);
}

/**
 * Evaluates ordered advancement slots. BAB and each save choose one complete
 * track total. Hit dice choose one die per slot, using the best die type in
 * that slot; no property shares a generic gestalt reducer.
 */
export function evaluateAdvancement(slots: AdvancementSlot[], catalog: Record<string, ProgressionDefinition> = progressionDefinitions): AdvancementEvaluation {
  if (slots.length === 0) throw new Error("Advancement requires at least one slot");
  const byTrack = new Map<string, TrackAdvancementResult>();
  const progressionLevels = new Map<string, Map<string, number>>();
  const hitDieSources: SlotHitDie[] = [];
  const slotSkillPoints: number[] = [];

  for (const slot of slots) {
    const slotCandidates: Array<{ trackId: string; definition: ProgressionDefinition }> = [];
    const seenTrackIds = new Set<string>();
    for (const track of slot.tracks) {
      if (seenTrackIds.has(track.id)) throw new Error(`Duplicate advancement track id ${track.id} in slot ${slot.id}`);
      seenTrackIds.add(track.id);
      const definition = catalog[track.entry.progressionId];
      if (!definition) throw new Error(`Unknown progression definition ${track.entry.progressionId}`);
      slotCandidates.push({ trackId: track.id, definition });

      const result = byTrack.get(track.id) ?? { id: track.id, bab: 0, saves: emptySaves(), hitDieSides: [], skillPoints: 0 };
      const levels = progressionLevels.get(track.id) ?? new Map<string, number>();
      const previousLevel = levels.get(definition.id) ?? 0;
      const currentLevel = previousLevel + 1;
      result.bab += babAt(definition.babProgression, currentLevel) - babAt(definition.babProgression, previousLevel);
      for (const saveId of saveIds) result.saves[saveId] += saveAt(definition.saveProgressions[saveId], currentLevel) - saveAt(definition.saveProgressions[saveId], previousLevel);
      result.hitDieSides.push(definition.hitDieSides);
      result.skillPoints += definition.skillPointsPerLevel ?? 0;
      levels.set(definition.id, currentLevel);
      progressionLevels.set(track.id, levels);
      byTrack.set(track.id, result);
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
    hitDiceCount: slots.length,
    hitDieSides: hitDieSources.map((source) => source.sides),
    hitDieSources,
    skillPoints: slotSkillPoints.reduce((total, value) => total + value, 0),
  };
}
