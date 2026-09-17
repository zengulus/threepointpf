import type {
  DerivedCharacter,
  ExperienceCatalog,
} from "@threepointpf/rules-schema";
import { lookup, sourceContribution } from "./contributions.js";
import type { RulesRuntime } from "./runtime.js";

/** XP eligibility is advisory: it never creates advancement slots. */
export function experienceResult(
  runtime: RulesRuntime,
  catalog: ExperienceCatalog | undefined,
): DerivedCharacter["experience"] {
  const experience = runtime.character.experience;
  if (!experience) return undefined;
  const track = lookup(catalog, experience.trackId);
  if (!track) throw new Error(`Unknown experience track ${experience.trackId}`);
  const reached = track.thresholds.filter(
    (row) => row.points <= experience.points,
  );
  const level = reached.at(-1)!;
  const next = track.thresholds[reached.length];
  return {
    ...experience,
    eligibleLevel: {
      target: "experience.level",
      value: level.level,
      contributions: reached.map((row) =>
        sourceContribution(
          "experience.level",
          1,
          `experience.${track.id}.level.${row.level}`,
          `Level ${row.level}: ${row.points} XP threshold`,
          undefined,
          {
            note: `Authored XP ${experience.points}; selected ${track.name} track. Eligibility does not advance a class automatically.`,
            ...(track.source ? { sourceMetadata: track.source } : {}),
          },
        ),
      ),
    },
    ...(next
      ? {
          nextThreshold: next.points,
          remaining: next.points - experience.points,
        }
      : {}),
  };
}
