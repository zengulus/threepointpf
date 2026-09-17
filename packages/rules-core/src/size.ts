import {
  sizeCategories,
  type Contribution,
  type EvaluationResult,
  type MovementMode,
  type SizeCategory,
  type TargetId,
} from "@threepointpf/rules-schema";
import { base, sourceContribution } from "./contributions.js";
import type { RulesRuntime } from "./runtime.js";

/** The current structural size is base category plus integral relative steps. */
export function computeSizeResult(runtime: RulesRuntime): EvaluationResult {
  const target = "size.relative" as TargetId;
  const raw = runtime.result(target, [
    runtime.replacement(target, 0, "size.relative.base", "Base size adjustment"),
    ...runtime.directModifiers(target).applied,
  ]);
  if (!Number.isInteger(raw.value))
    throw new Error(
      "Size-relative effects must resolve to integral category steps",
    );
  const baseSize = runtime.character.baseSize ?? "medium";
  const baseIndex = sizeCategories.indexOf(baseSize);
  const requestedIndex = baseIndex + raw.value;
  const clampedIndex = Math.max(
    0,
    Math.min(sizeCategories.length - 1, requestedIndex),
  );
  const clampedRelative = clampedIndex - baseIndex;
  return clampedRelative === raw.value
    ? raw
    : {
        ...raw,
        value: clampedRelative,
        contributions: [
          ...raw.contributions,
          sourceContribution(
            target,
            clampedRelative - raw.value,
            "rules-core.size-clamp",
            "Size category boundary",
            undefined,
            {
              note: `Requested ${sizeCategories[Math.max(0, Math.min(sizeCategories.length - 1, requestedIndex))]}; clamped to ${sizeCategories[clampedIndex]}`,
            },
          ),
        ],
      };
}

export function sizeCategoryOf(runtime: RulesRuntime): SizeCategory {
  const baseIndex = sizeCategories.indexOf(
    runtime.character.baseSize ?? "medium",
  );
  return sizeCategories[baseIndex + runtime.sizeResult().value]!;
}

/** Size table offsets are derived from the resulting category, not authored ad hoc. */
export function sizeAdjustment(
  runtime: RulesRuntime,
  target: TargetId,
  perCategoryStep: number,
  label: string,
): Contribution {
  const size = runtime.sizeResult();
  const index = sizeCategories.indexOf(runtime.sizeCategory());
  const categoryOffset = index - sizeCategories.indexOf("medium");
  const baseSize = runtime.character.baseSize ?? "medium";
  const attackAc = [8, 4, 2, 1, 0, -1, -2, -4, -8][index]!;
  const value =
    target === "cmb" || target === "cmd"
      ? -attackAc
      : target === "ac" || target.startsWith("attack.")
        ? attackAc
        : categoryOffset * perCategoryStep;
  return sourceContribution(target, value, "rules-core.size", label, "size", {
    note: `${runtime.sizeCategory()} size; Autosheet Formula References!A${138 + index}:G${138 + index}`,
    children: [
      sourceContribution(
        "size.relative",
        sizeCategories.indexOf(baseSize) - sizeCategories.indexOf("medium"),
        "size.base",
        `Base size: ${baseSize}`,
      ),
      ...size.contributions,
    ],
  });
}

/**
 * Absent non-land modes remain an explicit zero baseline; effects may only
 * change a mode when authored.
 */
export function evaluateMovement(
  runtime: RulesRuntime,
  mode: MovementMode = "land",
): EvaluationResult {
  const character = runtime.character;
  const target = `speed.${mode}` as TargetId;
  const fallback =
    character.baseSpeeds?.[mode] ??
    (mode === "land" ? (character.baseLandSpeed ?? 30) : 0);
  const baseline = runtime.replacement(
    target,
    fallback,
    `base-speed.${mode}`,
    `Base ${mode} speed`,
  );
  const armor =
    mode === "land"
      ? runtime.equipment.find((item) => item.equipped && item.reduceLandSpeed)
      : undefined;
  if (armor) {
    const reduced = Math.ceil((baseline.value * 2) / 3 / 5) * 5;
    baseline.children = [
      { ...baseline },
      sourceContribution(
        target,
        reduced - baseline.value,
        `equipment.${armor.id}.speed`,
        `${armor.name ?? armor.id} armor movement`,
        undefined,
        { ...(armor.source ? { sourceMetadata: armor.source } : {}) },
      ),
    ];
    baseline.value = reduced;
    baseline.note =
      "Armor speed table: two thirds, rounded up to the next 5 feet";
  }
  const result = runtime.result(target, [
    baseline,
    ...runtime.directModifiers(target, { baseline: baseline.value }).applied,
  ]);
  if (result.value >= 0) return result;
  return {
    ...result,
    value: 0,
    contributions: [
      ...result.contributions,
      base(
        target,
        -result.value,
        "rules-core.speed-floor",
        "Movement minimum 0",
      ),
    ],
  };
}
