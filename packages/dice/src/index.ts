export interface DiceRequirement {
  sides: number;
  count: number;
}

export interface PhysicalRollRequest {
  planId: string;
  dice: DiceRequirement[];
}

export interface PhysicalRollResult {
  planId: string;
  faces: number[];
}

export interface RollMetadata {
  kind: "save" | "attack" | "skill" | "damage" | "other";
  target: string;
  attackId?: string;
  attackIndex?: number;
}

export interface RollPlan {
  id: string;
  characterId: string;
  label: string;
  dice: DiceRequirement[];
  modifier: number;
  metadata?: RollMetadata;
}

export interface ResolvedRoll {
  planId: string;
  label: string;
  faces: number[];
  modifier: number;
  total: number;
}

export interface DiceProvider {
  roll(request: PhysicalRollRequest): Promise<PhysicalRollResult>;
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function formatDiceExpression(dice: DiceRequirement): string {
  return `${dice.count}d${dice.sides}`;
}

export function parseDiceExpression(value: string): DiceRequirement {
  const match = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid dice expression: ${value}`);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 1) throw new Error(`Invalid dice expression: ${value}`);
  return { count, sides };
}

export function validateFaces(plan: RollPlan, faces: readonly number[]): void {
  const required = plan.dice.reduce((sum, group) => sum + group.count, 0);
  if (faces.length !== required) throw new Error(`Roll plan ${plan.id} requires ${required} face(s), received ${faces.length}`);
  let index = 0;
  for (const group of plan.dice) {
    for (let i = 0; i < group.count; i += 1) {
      const face = faces[index];
      if (face === undefined || !Number.isInteger(face) || face < 1 || face > group.sides) throw new Error(`Invalid d${group.sides} face: ${face}`);
      index += 1;
    }
  }
}

export function resolveRollPlan(plan: RollPlan, faces: readonly number[]): ResolvedRoll {
  validateFaces(plan, faces);
  return { planId: plan.id, label: plan.label, faces: [...faces], modifier: plan.modifier, total: faces.reduce((sum, face) => sum + face, 0) + plan.modifier };
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be positive");
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const maxUint = 0x1_0000_0000;
    const limit = Math.floor(maxUint / maxExclusive) * maxExclusive;
    const bytes = new Uint32Array(1);
    let sample: number;
    do { cryptoObject.getRandomValues(bytes); sample = bytes[0]!; } while (sample >= limit);
    return sample % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export class BrowserDiceProvider implements DiceProvider {
  async roll(request: PhysicalRollRequest): Promise<PhysicalRollResult> {
    const faces: number[] = [];
    for (const group of request.dice) for (let i = 0; i < group.count; i += 1) faces.push(secureRandomInt(group.sides) + 1);
    return { planId: request.planId, faces };
  }
}
