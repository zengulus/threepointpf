import {
  targetLabels,
  type AbilityId,
  type TargetId,
} from "@threepointpf/rules-schema";
import { lookup } from "./contributions.js";

/** Display names for the skills this engine knows about without an injected catalog. */
export const skillDisplayNames: Record<string, string> = {
  "disable-device": "Disable Device",
  "escape-artist": "Escape Artist",
  "handle-animal": "Handle Animal",
  "knowledge-arcana": "Knowledge (Arcana)",
  "knowledge-dungeoneering": "Knowledge (Dungeoneering)",
  "knowledge-engineering": "Knowledge (Engineering)",
  "knowledge-geography": "Knowledge (Geography)",
  "knowledge-history": "Knowledge (History)",
  "knowledge-local": "Knowledge (Local)",
  "knowledge-nature": "Knowledge (Nature)",
  "knowledge-nobility": "Knowledge (Nobility)",
  "knowledge-planes": "Knowledge (Planes)",
  "knowledge-religion": "Knowledge (Religion)",
  "sense-motive": "Sense Motive",
  "sleight-of-hand": "Sleight of Hand",
  spellcraft: "Spellcraft",
  "use-magic-device": "Use Magic Device",
};

/** Fallback governing abilities for skills when no skill catalog is injected. */
export const defaultSkillAbilities: Record<string, AbilityId> = {
  acrobatics: "dex",
  appraise: "int",
  bluff: "cha",
  climb: "str",
  craft: "int",
  diplomacy: "cha",
  "disable-device": "dex",
  disguise: "cha",
  "escape-artist": "dex",
  fly: "dex",
  "handle-animal": "cha",
  heal: "wis",
  intimidate: "cha",
  "knowledge-arcana": "int",
  "knowledge-dungeoneering": "int",
  "knowledge-engineering": "int",
  "knowledge-geography": "int",
  "knowledge-history": "int",
  "knowledge-local": "int",
  "knowledge-nature": "int",
  "knowledge-nobility": "int",
  "knowledge-planes": "int",
  "knowledge-religion": "int",
  linguistics: "int",
  perception: "wis",
  perform: "cha",
  profession: "wis",
  ride: "dex",
  "sense-motive": "wis",
  "sleight-of-hand": "dex",
  spellcraft: "int",
  stealth: "dex",
  survival: "wis",
  swim: "str",
  "use-magic-device": "cha",
};

export function skillLabel(id: string): string {
  return (
    lookup(skillDisplayNames, id) ??
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function labelForTarget(target: TargetId): string {
  if (targetLabels[target]) return targetLabels[target];
  if (target.startsWith("skill.")) return skillLabel(target.slice(6));
  return target;
}
