import type {
  CharacterInput,
  Effect,
  EquipmentCatalog,
  EquipmentMaterialCatalog,
  SizeCategory,
} from "@threepointpf/rules-schema";
import { lookup } from "./contributions.js";
import type { EquipmentEntry } from "./runtime.js";

/**
 * Merges authored equipment instances with their injected catalog definitions.
 * A definition supplies the chassis; an instance supplies the override and the
 * equipped state. Instance attacks and effects win over definition ones.
 */
export function resolveEquipment(
  character: CharacterInput,
  catalog?: EquipmentCatalog,
  materialCatalog?: EquipmentMaterialCatalog,
): EquipmentEntry[] {
  return (character.equipment ?? []).map((item) => {
    const definition = item.definitionId
      ? lookup(catalog, item.definitionId)
      : undefined;
    if (item.definitionId && !definition)
      throw new Error(`Unknown equipment definition ${item.definitionId}`);
    const material = item.material ? Object.values(materialCatalog ?? {}).find((candidate) => candidate.id === item.material || candidate.name.toLocaleLowerCase("en-US") === item.material?.trim().toLocaleLowerCase("en-US")) : undefined;
    const equipmentKind = item.kind ?? definition?.kind;
    const shield = equipmentKind === "shield";
    const equipmentMaterialType = item.materialType ?? definition?.materialType;
    const canApplyMaterial = equipmentKind === undefined || equipmentKind === "armor" || equipmentKind === "shield";
    const materialVariant = canApplyMaterial ? material?.variants.find((variant) =>
      (variant.materialType === "-" || variant.materialType === equipmentMaterialType) && (!shield || variant.shield === true),
    ) : undefined;
    const materialWarning = item.material && !material ? `Unknown Autosheet material: ${item.material}` : item.material && !materialVariant ? `${material?.name ?? item.material} has no compatible material rule for this ${definition?.kind ?? "custom item"}` : undefined;
    const effects = [...(definition?.effects ?? []), ...(item.effects ?? [])].map((effect) => ({ ...effect }));
    if (materialVariant?.armorClassAdjustment) {
      const bonusType = shield ? "shield" : "armor";
      const acEffect = effects.find((effect) => effect.kind === "modifier" && effect.target === "ac" && effect.bonusType === bonusType && (effect.appliesTo?.includes("normal") ?? true));
      if (acEffect?.kind === "modifier") {
        acEffect.value += materialVariant.armorClassAdjustment;
        acEffect.source = { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} material adjustment`, ...(materialVariant.source ? { content: materialVariant.source } : {}) };
      } else effects.push({ kind: "modifier", target: "ac", value: materialVariant.armorClassAdjustment, bonusType, appliesTo: ["normal", "flatFooted"], source: { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} material adjustment`, ...(materialVariant.source ? { content: materialVariant.source } : {}) } });
    }
    const maxDexterity = item.maxDexterity ?? definition?.maxDexterity;
    const armorCheckPenalty = item.armorCheckPenalty ?? definition?.armorCheckPenalty;
    const arcaneSpellFailureChance = item.arcaneSpellFailureChance ?? definition?.arcaneSpellFailureChance;
    return {
      ...definition,
      ...item,
      ...(equipmentKind ? { kind: equipmentKind } : {}),
      effects,
      ...(maxDexterity !== undefined && materialVariant?.maxDexterityAdjustment !== undefined ? { maxDexterity: Math.max(0, maxDexterity + materialVariant.maxDexterityAdjustment) } : maxDexterity !== undefined ? { maxDexterity } : {}),
      ...(armorCheckPenalty !== undefined ? { armorCheckPenalty: Math.min(0, armorCheckPenalty + (materialVariant?.armorCheckPenaltyAdjustment ?? 0)) } : {}),
      ...(arcaneSpellFailureChance !== undefined ? { arcaneSpellFailureChance: Math.min(1, Math.max(0, arcaneSpellFailureChance + (materialVariant?.arcaneSpellFailureAdjustment ?? 0))) } : {}),
      ...(materialVariant?.notes ? { materialNotes: materialVariant.notes } : {}),
      ...(materialWarning ? { materialWarning } : {}),
    };
  });
}

/**
 * Equipped items contribute effects with an item-qualified source, so
 * provenance names the actual item rather than a bare catalog entry.
 */
export function collectEquipmentEffects(equipment: EquipmentEntry[]): Effect[] {
  const effects: Effect[] = [];
  for (const item of equipment.filter((entry) => entry.equipped)) {
    const metadata = item.definitionId ? item.source : undefined;
    for (const effect of item.effects ?? [])
      effects.push({
        ...effect,
        source: {
          id: `equipment.${item.id}${effect.source ? `.${effect.source.id}` : ""}`,
          label: effect.source
            ? `${item.name ?? item.id}: ${effect.source.label}`
            : (item.name ?? item.id),
          ...((effect.source?.content ?? metadata)
            ? { content: effect.source?.content ?? metadata }
            : {}),
        },
      });
  }
  return effects;
}

export type CarryLoadBand = "light" | "medium" | "heavy" | "over capacity";
export interface CarryLoad {
  carriedWeight: number;
  lightLimit: number;
  mediumLimit: number;
  heavyLimit: number;
  band: CarryLoadBand;
  containerOverloads: Array<{ itemId: string; name: string; weight: number; capacity: number }>;
}

const heavyLoadByStrength = [0,10,20,30,40,50,60,70,80,90,100,115,130,150,175,200,230,260,300,350,400,460,520,600,700,800,920,1040,1200,1400,1600] as const;
const sizeLoadMultiplier: Record<SizeCategory, number> = { fine: 0.125, diminutive: 0.25, tiny: 0.5, small: 0.75, medium: 1, large: 2, huge: 4, gargantuan: 8, colossal: 16 };

/** Pathfinder Autosheet carrying-capacity chart with its size scaling. */
export function heavyCarryCapacity(strength: number, size: SizeCategory = "medium"): number {
  const score = Math.max(0, Math.floor(strength));
  const decade = Math.floor(score / 10);
  const remainder = score % 10;
  const base = decade === 0 ? (heavyLoadByStrength[score] ?? score * 10) : (heavyLoadByStrength[10 + remainder] ?? 100) * 4 ** (decade - 1);
  return base * sizeLoadMultiplier[size];
}

/** Includes stacked quantities and nested containers; a carried container applies its authored weight multiplier to contents. */
export function calculateCarryLoad(items: EquipmentEntry[], strength: number, size: SizeCategory = "medium"): CarryLoad {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const containerOverloads: CarryLoad["containerOverloads"] = [];
  const itemWeight = (item: EquipmentEntry): number => {
    if (visited.has(item.id) || item.carried === false) return 0;
    visited.add(item.id);
    const own = (item.weight ?? 0) * (item.quantity ?? 1);
    const contents = items.filter((child) => child.containerId === item.id).reduce((total, child) => total + itemWeight(child), 0);
    visited.delete(item.id);
    if (item.containerCapacity !== undefined && contents > item.containerCapacity)
      containerOverloads.push({ itemId: item.id, name: item.name ?? item.id, weight: contents, capacity: item.containerCapacity });
    return own + contents * (item.containerWeightMultiplier ?? 1);
  };
  const carriedWeight = items.filter((item) => !item.containerId || !byId.has(item.containerId)).reduce((total, item) => total + itemWeight(item), 0);
  const heavyLimit = heavyCarryCapacity(strength, size);
  const lightLimit = heavyLimit / 3;
  const mediumLimit = heavyLimit * 2 / 3;
  const band: CarryLoadBand = carriedWeight <= lightLimit ? "light" : carriedWeight <= mediumLimit ? "medium" : carriedWeight <= heavyLimit ? "heavy" : "over capacity";
  return { carriedWeight, lightLimit, mediumLimit, heavyLimit, band, containerOverloads };
}
