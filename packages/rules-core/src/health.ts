import { parseCharacterInput, type CharacterInput } from "@threepointpf/rules-schema";

/** Damage removes temporary HP first; any remainder is persisted as damage. */
export function applyDamage(character: CharacterInput, amount: number): CharacterInput {
  const value = wholeAmount(amount);
  const absorbed = Math.min(character.temporaryHp, value);
  return parseCharacterInput({
    ...character,
    temporaryHp: character.temporaryHp - absorbed,
    damageTaken: character.damageTaken + value - absorbed,
  });
}

export interface DamageMitigation { incoming: number; afterImmunity: number; afterResistance: number; afterDamageReduction: number; immune: boolean; resistance: number; damageReduction: number }

export interface NoteDerivedDefenses {
  spellResistance?: number;
  damageReduction: Array<{ amount: number; bypass?: string; appliesAgainst?: string[] }>;
}

/**
 * The Autosheet summarizes active feature/effect note text beginning with DR
 * and SR. Keep the notes as the editable source while exposing their numeric
 * defense values to the same consumers as explicitly authored defenses.
 */
export function deriveNoteDefenses(notes: readonly string[]): NoteDerivedDefenses {
  const reductions = new Map<string, { amount: number; bypass?: string; appliesAgainst?: string[] }>();
  let spellResistance = 0;
  for (const note of notes) {
    for (const match of note.matchAll(/\bDR\s*(\d+)\s*\/\s*([\w-]+)(?:\s*(?:vs\.?|against)\s*([\w /,-]+)|\s*\(([\w /,-]+)\))?/gi)) {
      const amount = Number(match[1]);
      const bypass = match[2] === "-" ? undefined : match[2];
      const appliesAgainst = (match[3] ?? match[4])?.split(/[\s,/]+/).map((type) => type.trim().toLowerCase()).filter(Boolean);
      const key = `${bypass?.toLowerCase() ?? ""}|${(appliesAgainst ?? []).slice().sort().join(",")}`;
      const previous = reductions.get(key);
      if (!previous || amount > previous.amount)
        reductions.set(key, { amount, ...(bypass ? { bypass } : {}), ...(appliesAgainst?.length ? { appliesAgainst } : {}) });
    }
    for (const match of note.matchAll(/\bSR\s*(\d+)\b/gi)) spellResistance = Math.max(spellResistance, Number(match[1]));
  }
  return {
    ...(spellResistance ? { spellResistance } : {}),
    damageReduction: [...reductions.values()],
  };
}

/** Autosheet Unchained wound penalties at 75%, 50% and 25% maximum HP. */
export function unchainedWoundPenalty(currentHp: number, maximumHp: number): number {
  if (maximumHp <= 0) return 0;
  const ratio = Math.max(0, currentHp) / maximumHp;
  return ratio < 0.25 ? -3 : ratio < 0.5 ? -2 : ratio < 0.75 ? -1 : 0;
}

/** Applies the authored immunity, energy resistance, then damage reduction to a typed damage instance. */
export function mitigateDamage(character: CharacterInput, amount: number, damageType: string, bypass?: string, attackerType?: string): DamageMitigation {
  const incoming = wholeAmount(amount);
  const type = damageType.trim().toLowerCase();
  const defenses = character.defenses;
  const immune = (defenses?.energyImmunities ?? []).some((entry) => entry.trim().toLowerCase() === type);
  const afterImmunity = immune ? 0 : incoming;
  const resistance = Math.max(0, defenses?.energyResistances?.[type] ?? 0);
  const afterResistance = Math.max(0, afterImmunity - resistance);
  const bypassKey = bypass?.trim().toLowerCase();
  const reduction = ["bludgeoning", "piercing", "slashing"].includes(type)
    ? (defenses?.damageReduction ?? []).filter((entry) => (!entry.appliesAgainst || Boolean(attackerType && entry.appliesAgainst.includes(attackerType))) && (!entry.bypass || !bypassKey || !entry.bypass.toLowerCase().split(/\s+or\s+|,\s*/).includes(bypassKey))).reduce((maximum, entry) => Math.max(maximum, entry.amount), 0)
    : 0;
  const afterDamageReduction = Math.max(0, afterResistance - reduction);
  return { incoming, afterImmunity, afterResistance, afterDamageReduction, immune, resistance: Math.min(afterImmunity, resistance), damageReduction: Math.min(afterResistance, reduction) };
}

/** Healing reduces lethal damage and stops at maximum HP. */
export function applyHealing(character: CharacterInput, amount: number): CharacterInput {
  const value = wholeAmount(amount);
  return parseCharacterInput({ ...character, damageTaken: Math.max(0, character.damageTaken - value) });
}

export function setTemporaryHp(character: CharacterInput, amount: number): CharacterInput {
  return parseCharacterInput({ ...character, temporaryHp: wholeAmount(amount) });
}

export function clearTemporaryHp(character: CharacterInput): CharacterInput {
  return setTemporaryHp(character, 0);
}

function wholeAmount(amount: number): number {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0)
    throw new Error("Hit point amounts must be non-negative whole numbers");
  return amount;
}
