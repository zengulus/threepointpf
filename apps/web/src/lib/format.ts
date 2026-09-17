import { skillCatalog } from "@threepointpf/rules-data";
import {
  targetLabels,
  type Effect,
  type EffectTargetId,
} from "@threepointpf/rules-schema";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unexpected validation error.";
}

export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sourceLabel(
  source:
    | { document: string; sheet: string; row?: number; range?: string }
    | undefined,
): string {
  if (!source) return "Local authored content";
  return (
    source.document +
    " · " +
    source.sheet +
    (source.range ? " " + source.range : source.row ? " row " + source.row : "")
  );
}

export function nextId(prefix: string, ids: string[]): string {
  let index = 1;
  while (ids.includes(prefix + "-" + index)) index += 1;
  return prefix + "-" + index;
}

export function labelFor(target: EffectTargetId): string {
  return (
    targetLabels[target] ??
    (target.startsWith("skill.")
      ? skillCatalog[target.slice(6)]?.name
      : undefined) ??
    target
  );
}

export function catalogValues<T extends { id: string; name: string }>(
  catalog: Record<string, T>,
): T[] {
  return Object.values(catalog).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function describeEffect(effect: Effect): string {
  if (effect.kind === "modifier")
    return (
      (effect.value >= 0 ? "+" : "") +
      effect.value +
      " " +
      effect.bonusType +
      " → " +
      labelFor(effect.target) +
      ("appliesWhen" in effect && effect.appliesWhen ? " (situational)" : "")
    );
  if (effect.kind === "replaceBase")
    return "replace baseline → " + labelFor(effect.target);
  if (effect.kind === "multiply")
    return "×" + effect.factor + " → " + labelFor(effect.target);
  if (effect.kind === "minimum")
    return "minimum " + effect.value + " → " + labelFor(effect.target);
  if (effect.kind === "maximum")
    return "maximum " + effect.value + " → " + labelFor(effect.target);
  return "grant " + effect.grant + " → " + labelFor(effect.target);
}
