import type { CharacterInput, CharacterSystemEntry, CharacterSystemSource } from "@threepointpf/rules-schema";
import { RulesEngine, type RulesEngineOptions } from "./character.js";
import { deriveCharacterSystems } from "./sheet-systems.js";
import { resolveTurnAction } from "./spellcasting.js";

/** Sustained, authored maneuver effects that do not require a roll transaction. */
export function isRollFreeManeuverBoost(source: Pick<CharacterSystemSource, "kind">, entry: CharacterSystemEntry): boolean {
  const stance = entry.entryType ? entry.entryType === "stance" : /^stance\b/i.test(entry.category?.trim() ?? "");
  return source.kind === "maneuvers" && !stance && !entry.roll && Boolean(entry.effects?.length);
}

export interface ManeuverBoostTransition {
  character: CharacterInput;
  error?: string;
}

/**
 * Resolve one boost activation against the current character. All checks precede
 * the single state change, so effects, expenditure, uses, resources and actions
 * are committed together. Ending an effect never recovers it or refunds costs.
 */
export function resolveManeuverBoostActivation(character: CharacterInput, sourceId: string, entryId: string, active: boolean, rules: RulesEngineOptions = {}): ManeuverBoostTransition {
  const source = character.systems?.find((candidate) => candidate.id === sourceId);
  const entry = source?.entries.find((candidate) => candidate.id === entryId);
  const fail = (error: string): ManeuverBoostTransition => ({ character, error });
  if (!source || !entry) return fail("This maneuver is no longer on the character.");
  if (!isRollFreeManeuverBoost(source, entry)) return fail("This action only supports roll-free maneuver boosts.");
  // A repeated request is a no-op, including before the UI has re-rendered.
  if (Boolean(entry.active) === active) return { character };
  const replaceEntry = (next: CharacterSystemEntry, resourceSpent = source.resourceSpent): CharacterInput => ({
    ...character,
    systems: character.systems!.map((candidate) => candidate.id === sourceId ? {
      ...candidate,
      resourceSpent,
      entries: candidate.entries.map((item) => item.id === entryId ? next : item),
    } : candidate),
  });
  if (!active) return { character: replaceEntry({ ...entry, active: false, roundsRemaining: undefined }) };

  const runtime = new RulesEngine(character, rules);
  const restrictions = runtime.actionRestrictions();
  if (restrictions.includes("noPhysicalActions")) return fail("This condition prevents physical actions.");
  if (entry.known === false) return fail(`${entry.name} is not known.`);
  if (!entry.readied) return fail(`${entry.name} is not readied.`);
  if (entry.expended) return fail(`${entry.name} is expended; restore it before using it again.`);
  const current = deriveCharacterSystems(
    [source],
    { [source.keyAbility]: runtime.abilityModifierValue(source.keyAbility) },
    Object.fromEntries(runtime.advancementProgressionLevels().map(({ id, level }) => [id, level])),
  )[0]!;
  if (source.progression.length && entry.tier !== undefined && entry.tier > current.maximumTier)
    return fail(`${entry.name} exceeds the current maximum tier ${current.maximumTier}.`);
  if (entry.usesPerDay !== undefined && (entry.usesSpent ?? 0) >= entry.usesPerDay)
    return fail(`${entry.name} has no daily uses remaining.`);
  const cost = entry.resourceCost ?? 0;
  if (current.resourceRemaining !== undefined && cost > current.resourceRemaining)
    return fail(`Not enough ${source.resourceName || "resource"} to use ${entry.name}.`);
  const currentActions = character.turnActions ?? {};
  const action = resolveTurnAction(currentActions, entry.actionCost, restrictions);
  if (action.error) return fail(action.error);

  return { character: {
    ...replaceEntry({ ...entry, active: true, expended: true, usesSpent: (entry.usesSpent ?? 0) + 1 }, (source.resourceSpent ?? 0) + cost),
    ...(action.state !== currentActions ? { turnActions: action.state } : {}),
  } };
}
