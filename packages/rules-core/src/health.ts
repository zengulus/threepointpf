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
