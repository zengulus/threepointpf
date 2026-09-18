import type { DiceRequirement, RollPlan } from "@threepointpf/rules-schema";

/**
 * Raw-face validation and the declared primary-check-die lookup. These live in
 * their own module because both resolution and presentation need them, and
 * because a plan's declared check die is validated against the dice it actually
 * requires rather than being trusted.
 */

/** Validates submitted faces against the plan's dice requirements. */
export function validateFaces(plan: RollPlan, faces: readonly number[]): void {
  const required = plan.dice.reduce((sum, group) => sum + group.count, 0);
  if (faces.length !== required)
    throw new Error(
      `Roll plan ${plan.id} requires ${required} face(s), received ${faces.length}`,
    );
  let index = 0;
  for (const group of plan.dice) {
    for (let i = 0; i < group.count; i += 1) {
      const face = faces[index];
      if (
        face === undefined ||
        !Number.isInteger(face) ||
        face < 1 ||
        face > group.sides
      )
        throw new Error(`Invalid d${group.sides} face: ${face}`);
      index += 1;
    }
  }
}

/**
 * A declared check die is only meaningful when it points at a real group and
 * when its declared sides match that group's dice: a plan that claims a d20
 * while rolling 2d6 would otherwise invent natural-face semantics out of
 * nothing.
 */
export function validatePrimaryCheckDie(plan: RollPlan): void {
  const die = plan.primaryCheckDie;
  if (!die) return;
  const group = plan.dice[die.group];
  if (!group || !Number.isInteger(die.group) || die.group < 0)
    throw new Error(`Roll plan ${plan.id} declares an unknown check-die group`);
  if (die.sides !== group.sides)
    throw new Error(
      `Roll plan ${plan.id} declares a d${die.sides} check die for a d${group.sides} group`,
    );
  const within = die.index ?? 0;
  if (!Number.isInteger(within) || within < 0 || within >= group.count)
    throw new Error(`Roll plan ${plan.id} declares an out-of-range check die`);
}

/**
 * The face of the plan's declared primary check die. The die is never
 * discovered by scanning for a d20: a damage roll that happens to use d20s
 * declares no check die and therefore has no natural face at all.
 */
export function primaryCheckFaceOf(
  plan: RollPlan,
  faces: readonly number[],
): number | undefined {
  const die = plan.primaryCheckDie;
  if (!die) return undefined;
  validatePrimaryCheckDie(plan);
  let offset = 0;
  for (let index = 0; index < die.group; index += 1)
    offset += plan.dice[index]!.count;
  return faces[offset + (die.index ?? 0)];
}

export function formatDiceExpression(dice: DiceRequirement): string {
  return `${dice.count}d${dice.sides}`;
}

export function parseDiceExpression(value: string): DiceRequirement {
  const match = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid dice expression: ${value}`);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 1)
    throw new Error(`Invalid dice expression: ${value}`);
  return { count, sides };
}
