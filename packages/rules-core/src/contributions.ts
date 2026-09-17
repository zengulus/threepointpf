import type {
  BonusType,
  Contribution,
  ProgressionSourceMetadata,
  TargetId,
} from "@threepointpf/rules-schema";

/** Bonus types that always stack; every other type keeps its best positive value. */
export const stackableBonusTypes = new Set<BonusType>([
  "untyped",
  "dodge",
  "circumstance",
  "penalty",
]);

/** Own-property lookup keeps prototype keys such as `toString` out of catalogs. */
export function lookup<T>(
  catalog: Record<string, T> | undefined,
  id: string,
): T | undefined {
  return catalog && Object.prototype.hasOwnProperty.call(catalog, id)
    ? catalog[id]
    : undefined;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Pathfinder typed reduction: stackable types sum; other types keep the best positive bonus and all penalties. */
export function reduceContributions(
  contributions: Contribution[],
): Contribution[] {
  const result: Contribution[] = [];
  const untyped = contributions.filter((item) => !item.bonusType);
  result.push(...untyped);
  const byType = new Map<BonusType, Contribution[]>();
  for (const contribution of contributions) {
    if (!contribution.bonusType) continue;
    const existing = byType.get(contribution.bonusType) ?? [];
    existing.push(contribution);
    byType.set(contribution.bonusType, existing);
  }
  for (const [bonusType, typed] of byType) {
    if (stackableBonusTypes.has(bonusType)) {
      result.push(...typed);
      continue;
    }
    const positives = typed.filter((item) => item.value > 0);
    const negatives = typed.filter((item) => item.value < 0);
    const zeros = typed.filter((item) => item.value === 0);
    if (positives.length > 0) {
      const best = positives.reduce((a, b) => (b.value > a.value ? b : a));
      result.push(best);
    }
    result.push(...negatives, ...zeros);
  }
  return result;
}

export function sum(contributions: Contribution[]): number {
  return contributions.reduce((total, item) => total + item.value, 0);
}

export type ContributionExtras = Pick<
  Contribution,
  "appliesTo" | "children" | "note" | "sourceMetadata" | "abilityPenalty"
>;

export function sourceContribution(
  target: TargetId,
  value: number,
  source: string,
  label: string,
  bonusType?: BonusType,
  extras: ContributionExtras = {},
): Contribution {
  return {
    target,
    value,
    source,
    label,
    ...(bonusType ? { bonusType } : {}),
    ...extras,
  };
}

/** An unnamed intrinsic/derived contribution that carries no bonus type. */
export function base(
  target: TargetId,
  value: number,
  source: string,
  label: string,
): Contribution {
  return sourceContribution(target, value, source, label);
}

export function withSourceMetadata(
  contribution: Contribution,
  metadata: ProgressionSourceMetadata | undefined,
): Contribution {
  return metadata ? { ...contribution, sourceMetadata: metadata } : contribution;
}
