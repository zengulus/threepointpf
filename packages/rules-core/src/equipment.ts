import type {
  CharacterInput,
  Effect,
  EquipmentInstance,
  EquipmentCatalog,
  EquipmentMaterialCatalog,
  SizeCategory,
  AutosheetSizeAdjustmentCatalog,
  AutosheetWornSlotReference,
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
  const isArmoredKilt = (item: EquipmentInstance) => item.definitionId === "pf1e.autosheet.armored-kilt";
  const attachedKiltByArmor = new Map<string, EquipmentInstance>();
  for (const item of character.equipment ?? []) if (isArmoredKilt(item) && item.attachedTo) attachedKiltByArmor.set(item.attachedTo, item);
  // Formula References!O148/O154 sums the selected armor and shield weight
  // categories, then maps that total to unarmored/light/medium/heavy.
  const equippedArmorWeightTotal = (character.equipment ?? []).reduce((total, item) => {
    if (item.equipped === false) return total;
    if (isArmoredKilt(item) && item.attachedTo) return total;
    const definition = item.definitionId ? lookup(catalog, item.definitionId) : undefined;
    const kind = item.kind ?? definition?.kind;
    if (kind !== "armor" && kind !== "shield") return total;
    const material = item.material ? Object.values(materialCatalog ?? {}).find((candidate) => candidate.id === item.material || candidate.name.toLocaleLowerCase("en-US") === item.material?.trim().toLocaleLowerCase("en-US")) : undefined;
    const materialType = item.materialType ?? definition?.materialType;
    const variant = material?.variants.find((candidate) => (candidate.materialType === "-" || candidate.materialType === materialType) && (kind !== "shield" || candidate.shield === true));
    const base = item.armorWeightCategory ?? definition?.armorWeightCategory;
    const categoryBeforeKilt = base === undefined ? undefined : Math.max(0, Math.min(3, base + (variant?.weightCategoryAdjustment ?? 0)));
    const hasAttachedKilt = attachedKiltByArmor.get(item.id)?.equipped === true && kind === "armor" && (categoryBeforeKilt === undefined || (categoryBeforeKilt > 0 && categoryBeforeKilt < 3));
    return total + (categoryBeforeKilt === undefined ? 0 : Math.max(0, Math.min(3, (categoryBeforeKilt ?? 0) + (hasAttachedKilt ? 1 : 0))));
  }, 0);
  const combinedArmorWeightFactor = equippedArmorWeightTotal > 2 ? 3 : equippedArmorWeightTotal === 2 ? 2 : 1;
  return (character.equipment ?? []).map((item) => {
    const definition = item.definitionId
      ? lookup(catalog, item.definitionId)
      : undefined;
    if (item.definitionId && !definition)
      throw new Error(`Unknown equipment definition ${item.definitionId}`);
    const material = item.material ? Object.values(materialCatalog ?? {}).find((candidate) => candidate.id === item.material || candidate.name.toLocaleLowerCase("en-US") === item.material?.trim().toLocaleLowerCase("en-US")) : undefined;
    const equipmentKind = item.kind ?? definition?.kind;
    const shield = equipmentKind === "shield";
    const isBuckler = item.definitionId === "pf1e.autosheet.buckler" || item.name?.trim().toLocaleLowerCase("en-US") === "buckler";
    const bucklerAcLost = isBuckler && character.turnActions?.bucklerAcLostThisTurn === true;
    const shieldAcLost = shield && (character.turnActions?.shieldAcLostThisTurnIds ?? []).includes(item.id);
    const shieldOccupiesHand = shield && (item.shieldOccupiesHand ?? definition?.shieldOccupiesHand ?? (
      !isBuckler && item.definitionId !== "pf1e.autosheet.spell-shield"
    ));
    const equipmentMaterialType = item.materialType ?? definition?.materialType;
    const canApplyMaterial = equipmentKind === undefined || equipmentKind === "armor" || equipmentKind === "shield";
    const materialVariant = canApplyMaterial ? material?.variants.find((variant) =>
      (variant.materialType === "-" || variant.materialType === equipmentMaterialType) && (!shield || variant.shield === true),
    ) : undefined;
    const materialWarning = item.material && !material ? `Unknown Autosheet material: ${item.material}` : item.material && !materialVariant ? `${material?.name ?? item.material} has no compatible material rule for this ${definition?.kind ?? "custom item"}` : undefined;
    const attachedKilt = attachedKiltByArmor.get(item.id);
    const baseWeightCategory = item.armorWeightCategory ?? definition?.armorWeightCategory;
    const categoryBeforeKilt = baseWeightCategory === undefined ? undefined : Math.max(0, Math.min(3, baseWeightCategory + (materialVariant?.weightCategoryAdjustment ?? 0)));
    const hasAttachedKilt = attachedKilt?.equipped === true && equipmentKind === "armor" && (categoryBeforeKilt === undefined || (categoryBeforeKilt > 0 && categoryBeforeKilt < 3));
    const effects = [...(definition?.effects ?? []), ...(item.effects ?? [])]
      .filter((effect) => !((bucklerAcLost || shieldAcLost) && effect.kind === "modifier" && effect.target === "ac" && effect.bonusType === "shield"))
      .map((effect) => ({ ...effect }));
    if (hasAttachedKilt) {
      const armorEffect = effects.find((effect) => effect.kind === "modifier" && effect.target === "ac" && effect.bonusType === "armor");
      if (armorEffect?.kind === "modifier") {
        armorEffect.value += 1;
        armorEffect.source = { id: `equipment.${attachedKilt.id}`, label: "Armor plus Armored Kilt", content: { document: "Adventurer's Armory pg. 18", sheet: "Armored Kilt attachment", system: "PF1e", range: "https://aonprd.com/EquipmentArmorDisplay.aspx?ItemName=Armored%20kilt" } };
      } else {
        effects.push({ kind: "modifier", target: "ac", value: 1, bonusType: "armor", appliesTo: ["normal", "flatFooted"], source: { id: `equipment.${attachedKilt.id}`, label: "Armored Kilt attached bonus", content: { document: "Adventurer's Armory pg. 18", sheet: "Armored Kilt attachment", system: "PF1e", range: "https://aonprd.com/EquipmentArmorDisplay.aspx?ItemName=Armored%20kilt" } } });
      }
    }
    if (item.armorBonus !== undefined) {
      const armorBonus = effects.find((effect) => effect.kind === "modifier" && effect.target === "ac" && effect.bonusType === "armor");
      if (armorBonus?.kind === "modifier") armorBonus.value = item.armorBonus;
    }
    if (materialVariant?.initiativeBonus) effects.push({ kind: "modifier", target: "initiative", value: materialVariant.initiativeBonus * (materialVariant.initiativeBonusByArmorWeightCategory ? combinedArmorWeightFactor : 1), bonusType: "untyped", source: { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} initiative`, ...(materialVariant.source ? { content: materialVariant.source } : {}) } });
    if (materialVariant?.flyBonus) effects.push({ kind: "modifier", target: "skill.fly", value: materialVariant.flyBonus, bonusType: "untyped", source: { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} Fly`, ...(materialVariant.source ? { content: materialVariant.source } : {}) } });
    if (materialVariant?.armorClassAdjustment && !bucklerAcLost && !shieldAcLost) {
      const bonusType = shield ? "shield" : "armor";
      const acEffect = effects.find((effect) => effect.kind === "modifier" && effect.target === "ac" && effect.bonusType === bonusType && (effect.appliesTo?.includes("normal") ?? true));
      if (acEffect?.kind === "modifier") {
        acEffect.value += materialVariant.armorClassAdjustment;
        acEffect.source = { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} material adjustment`, ...(materialVariant.source ? { content: materialVariant.source } : {}) };
      } else effects.push({ kind: "modifier", target: "ac", value: materialVariant.armorClassAdjustment, bonusType, appliesTo: ["normal", "flatFooted"], source: { id: material?.id ?? "equipment-material", label: `${material?.name ?? item.material} material adjustment`, ...(materialVariant.source ? { content: materialVariant.source } : {}) } });
    }
    const maxDexterity = item.maxDexterity ?? definition?.maxDexterity;
    const armorCheckPenalty = item.armorCheckPenalty ?? definition?.armorCheckPenalty;
    const effectiveArmorCheckPenalty = armorCheckPenalty === undefined ? undefined : Math.min(0, armorCheckPenalty + (materialVariant?.armorCheckPenaltyAdjustment ?? 0));
    if (item.armorProficient === false && (equipmentKind === "armor" || equipmentKind === "shield") && effectiveArmorCheckPenalty && effectiveArmorCheckPenalty < 0) {
      const source = { id: `equipment.${item.id}.nonproficiency`, label: "Armor nonproficiency penalty" };
      effects.push({ kind: "modifier", target: "attack.melee", value: effectiveArmorCheckPenalty, bonusType: "penalty", source });
      effects.push({ kind: "modifier", target: "attack.ranged", value: effectiveArmorCheckPenalty, bonusType: "penalty", source });
    }
    const arcaneSpellFailureChance = item.arcaneSpellFailureChance ?? definition?.arcaneSpellFailureChance;
    const armorWeightCategory = baseWeightCategory === undefined
      ? undefined
      : Math.max(0, Math.min(3, (categoryBeforeKilt ?? 0) + (hasAttachedKilt ? 1 : 0)));
    const materialDamageReduction = materialVariant?.damageReduction
      ? {
          ...materialVariant.damageReduction,
          ...(materialVariant.damageReductionByArmorWeightCategory
            ? { amount: combinedArmorWeightFactor }
            : {}),
        }
      : undefined;
    let attachmentWarning: string | undefined;
    if (isArmoredKilt(item) && item.attachedTo) {
      const target = character.equipment?.find((candidate) => candidate.id === item.attachedTo);
      const targetDefinition = target?.definitionId ? lookup(catalog, target.definitionId) : undefined;
      const targetKind = target?.kind ?? targetDefinition?.kind;
      if (!target || !target.equipped || targetKind !== "armor") {
        attachmentWarning = "Choose an equipped armor item for the armored kilt to function.";
      } else {
        const targetBase = target.armorWeightCategory ?? targetDefinition?.armorWeightCategory;
        const targetMaterial = target.material ? Object.values(materialCatalog ?? {}).find((candidate) => candidate.id === target.material || candidate.name.toLocaleLowerCase("en-US") === target.material?.trim().toLocaleLowerCase("en-US")) : undefined;
        const targetMaterialType = target.materialType ?? targetDefinition?.materialType;
        const targetVariant = targetMaterial?.variants.find((candidate) => (candidate.materialType === "-" || candidate.materialType === targetMaterialType) && candidate.shield !== true);
        const targetCategory = targetBase === undefined ? undefined : Math.max(0, Math.min(3, targetBase + (targetVariant?.weightCategoryAdjustment ?? 0)));
        if (targetCategory === 3) attachmentWarning = "An armored kilt attached to heavy armor has no effect.";
      }
    }
    return {
      ...definition,
      ...item,
      ...(equipmentKind ? { kind: equipmentKind } : {}),
      ...(shield ? { shieldOccupiesHand } : {}),
      wornArmor: isArmoredKilt(item) && item.attachedTo ? false : item.wornArmor ?? definition?.wornArmor ?? (equipmentKind === "armor"),
      ...(definition?.requiresUnarmored ? { requiresUnarmored: true } : {}),
      ...(definition?.armorBonusProgression ? { armorBonusProgression: definition.armorBonusProgression } : {}),
      ...(armorWeightCategory !== undefined ? { armorWeightCategory } : {}),
      reduceLandSpeed: item.reduceLandSpeed ?? (armorWeightCategory !== undefined ? equipmentKind === "armor" && armorWeightCategory >= 2 : definition?.reduceLandSpeed ?? false),
      effects: isArmoredKilt(item) && item.attachedTo ? [] : effects,
      ...(maxDexterity !== undefined && materialVariant?.maxDexterityAdjustment !== undefined ? { maxDexterity: Math.max(0, maxDexterity + materialVariant.maxDexterityAdjustment) } : maxDexterity !== undefined ? { maxDexterity } : {}),
      ...(effectiveArmorCheckPenalty !== undefined ? { armorCheckPenalty: effectiveArmorCheckPenalty } : {}),
      ...(arcaneSpellFailureChance !== undefined ? { arcaneSpellFailureChance: Math.min(1, Math.max(0, arcaneSpellFailureChance + (materialVariant?.arcaneSpellFailureAdjustment ?? 0))) } : {}),
      ...(materialVariant?.notes ? { materialNotes: materialVariant.notes } : {}),
      ...(materialVariant?.energyResistance ? { materialEnergyResistance: materialVariant.energyResistance } : {}),
      ...(materialDamageReduction ? { materialDamageReduction } : {}),
      ...(materialWarning ? { materialWarning } : {}),
      ...(attachmentWarning ? { attachmentWarning } : {}),
    };
  });
}

export interface EquipmentBudget {
  startingGold: number;
  spentGold: number;
  remainingGold: number;
}

export interface EquipmentSlotOverload {
  slot: string;
  items: Array<{ id: string; name: string }>;
  capacity: number;
}

const autosheetWornSlots = new Set([
  "head", "headband", "face/eyes", "throat", "shoulders", "body",
  "torso", "arms", "hands", "waist", "feet", "ring",
]);

/** Workbook Equipment!Q10:Q22 lists one item per worn slot and two ring slots. */
export function equipmentSlotOverloads(
  character: CharacterInput,
  catalog?: EquipmentCatalog,
  slotReference?: AutosheetWornSlotReference,
): EquipmentSlotOverload[] {
  const capacities = slotReference
    ? new Map(slotReference.map((row) => [row.slot.trim().normalize("NFKC").toLocaleLowerCase("en-US"), row.capacity]))
    : new Map([...autosheetWornSlots].map((slot) => [slot, slot === "ring" ? 2 : 1] as const));
  const itemsBySlot = new Map<string, Array<{ id: string; name: string }>>();
  for (const item of character.equipment ?? []) {
    if (!item.equipped || !item.slot?.trim()) continue;
    const slot = item.slot.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!capacities.has(slot)) continue;
    const items = itemsBySlot.get(slot) ?? [];
    items.push({
      id: item.id,
      name: item.name ?? (item.definitionId ? lookup(catalog, item.definitionId)?.name : undefined) ?? item.id,
    });
    itemsBySlot.set(slot, items);
  }
  return [...itemsBySlot].flatMap(([slot, items]) => {
    const capacity = capacities.get(slot)!;
    return items.length > capacity ? [{ slot, items, capacity }] : [];
  });
}

/** Workbook Equipment!G6: starting gold less quantity × unit price for character item rows. Companion encumbrance is separate and has no purchase-balance range. */
export function calculateEquipmentBudget(character: CharacterInput): EquipmentBudget | undefined {
  const startingGold = character.inventory?.startingGold;
  if (startingGold === undefined) return undefined;
  const items = character.equipment ?? [];
  const spentGold = items.reduce(
    (total, item) => total + (item.price ?? 0) * (item.quantity ?? 1),
    0,
  );
  return { startingGold, spentGold, remainingGold: startingGold - spentGold };
}

/**
 * Equipped items contribute effects with an item-qualified source, so
 * provenance names the actual item rather than a bare catalog entry.
 */
export function collectEquipmentEffects(equipment: EquipmentEntry[]): Effect[] {
  const effects: Effect[] = [];
  const wearingArmor = equipment.some((entry) => entry.equipped && entry.wornArmor && !entry.requiresUnarmored);
  for (const item of equipment.filter((entry) => entry.equipped)) {
    if (item.requiresUnarmored && wearingArmor) continue;
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
export function heavyCarryCapacity(strength: number, size: SizeCategory = "medium", sizeAdjustments?: AutosheetSizeAdjustmentCatalog): number {
  const score = Math.max(0, Math.floor(strength));
  const decade = Math.floor(score / 10);
  const remainder = score % 10;
  const base = decade === 0 ? (heavyLoadByStrength[score] ?? score * 10) : (heavyLoadByStrength[10 + remainder] ?? 100) * 4 ** (decade - 1);
  return base * (sizeAdjustments?.[size].carryingCapacityMultiplier ?? sizeLoadMultiplier[size]);
}

/** Includes stacked quantities and nested containers; a carried container applies its authored weight multiplier to contents. */
export function calculateCarryLoad(items: EquipmentEntry[], strength: number, size: SizeCategory = "medium", sizeAdjustments?: AutosheetSizeAdjustmentCatalog): CarryLoad {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const containerOverloads: CarryLoad["containerOverloads"] = [];
  const itemWeight = (item: EquipmentEntry): number => {
    if (visited.has(item.id) || item.carried === false) return 0;
    visited.add(item.id);
    const own = (item.weight ?? 0) * (item.quantity ?? 1);
    const contents = items.filter((child) => child.containerId === item.id).reduce((total, child) => total + itemWeight(child), 0);
    visited.delete(item.id);
    if (!item.unlimitedContainer && item.containerCapacity !== undefined && contents > item.containerCapacity)
      containerOverloads.push({ itemId: item.id, name: item.name ?? item.id, weight: contents, capacity: item.containerCapacity });
    return own + contents * (item.containerWeightMultiplier ?? 1);
  };
  const carriedWeight = items.filter((item) => !item.containerId || !byId.has(item.containerId)).reduce((total, item) => total + itemWeight(item), 0);
  const heavyLimit = heavyCarryCapacity(strength, size, sizeAdjustments);
  const lightLimit = heavyLimit / 3;
  const mediumLimit = heavyLimit * 2 / 3;
  // Autosheet Equipment!CC3/CC4 uses strict less-than cutoffs: a load exactly
  // at 1/3 or 2/3 of heavy capacity enters the next encumbrance band.
  const band: CarryLoadBand = carriedWeight < lightLimit ? "light" : carriedWeight < mediumLimit ? "medium" : carriedWeight <= heavyLimit ? "heavy" : "over capacity";
  return { carriedWeight, lightLimit, mediumLimit, heavyLimit, band, containerOverloads };
}
