import { useMemo, useState } from "react";
import { castSpell, castSpellLike, commitAbilityActivation, concentrationRollPlan, spellLikeConcentrationRollPlan, deriveSpellcastingSource, prepareAbilityExecution, prepareSpells, refreshSpellcasting, saveOutcomePolicy, plainOutcomePolicy, spellDurationInRounds, slotResourceId, type ResourceFacts } from "@threepointpf/rules-core";
import { abilityCatalog, progressionCatalog, spellCatalog } from "@threepointpf/rules-data";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { d20CheckDie, type Effect, type SpellSlotProgressionRow, type SaveId, type RollPlan } from "@threepointpf/rules-schema";
import { nextId, slug } from "../lib/format";
import { LinkedTargetPicker, MissChanceField } from "./roll-actions";
import { SystemEntryEffectsEditor } from "./workbook-systems-panel";

function abilityResourceFacts(sheet: CharacterSheet): ResourceFacts {
  return {
    abilityModifier: (id, source = "current") => source === "base" ? Math.floor((sheet.character.baseAbilities[id] - 10) / 2) : sheet.derived.abilities[id].modifier.value,
    progressionLevel: (id) => sheet.derived.advancement?.progressionLevels[id]?.value ?? 0,
  };
}

function adjustSpellSlot(sheet: CharacterSheet, sourceId: string, level: number, delta: number, capacity: number) {
  const resourceId = slotResourceId(sourceId, level);
  const spent = sheet.character.resourceStates?.find((item) => item.resourceId === resourceId)?.spent ?? 0;
  const next = Math.max(0, Math.min(capacity, spent + delta));
  const resourceStates = (sheet.character.resourceStates ?? []).filter((item) => item.resourceId !== resourceId);
  sheet.update({ resourceStates: next ? [...resourceStates, { resourceId, spent: next }] : resourceStates });
}

export function SpellcastingPanel({ sheet }: { sheet: CharacterSheet }) {
  const [sourceName, setSourceName] = useState("");
  const [classTemplateId, setClassTemplateId] = useState("");
  const [sourceMode, setSourceMode] = useState<"prepared" | "spontaneous">("spontaneous");
  const [ability, setAbility] = useState<"int" | "wis" | "cha">("cha");
  const [listAccess, setListAccess] = useState<"list" | "spellbook">("list");
  const [listId, setListId] = useState("arcane");
  const [entrySpell, setEntrySpell] = useState("");
  const [prepareSpellBySource, setPrepareSpellBySource] = useState<Record<string, string>>({});
  const [concentrationDc, setConcentrationDc] = useState("");
  const [grapplerCmb, setGrapplerCmb] = useState("");
  const [customSpellName, setCustomSpellName] = useState("");
  const [customSpellDescription, setCustomSpellDescription] = useState("");
  const [customSpellSchool, setCustomSpellSchool] = useState("universal");
  const [customSpellSubschool, setCustomSpellSubschool] = useState("");
  const [customSpellDescriptors, setCustomSpellDescriptors] = useState("");
  const [customSpellLevel, setCustomSpellLevel] = useState("1");
  const [customSpellDamage, setCustomSpellDamage] = useState("1d6");
  const [customSpellDamageType, setCustomSpellDamageType] = useState("force");
  const [customSpellAttack, setCustomSpellAttack] = useState<"" | "meleeTouch" | "rangedTouch">("");
  const [customSpellEffectKind, setCustomSpellEffectKind] = useState<"damage" | "healing">("damage");
  const [customSpellPerCasterLevel, setCustomSpellPerCasterLevel] = useState(false);
  const [customSpellComponents, setCustomSpellComponents] = useState<string[]>(["verbal", "somatic"]);
  const [customSpellOtherComponents, setCustomSpellOtherComponents] = useState("");
  const [customSpellCastingAction, setCustomSpellCastingAction] = useState<"standard" | "swift" | "immediate" | "fullRound" | "move" | "free" | "timed">("standard");
  const [customSpellCastingTimeAmount, setCustomSpellCastingTimeAmount] = useState("1");
  const [customSpellCastingTimeUnit, setCustomSpellCastingTimeUnit] = useState<"rounds" | "minutes" | "hours" | "custom">("rounds");
  const [customSpellCastingTimeLabel, setCustomSpellCastingTimeLabel] = useState("");
  const [customSpellRange, setCustomSpellRange] = useState("");
  const [customSpellTarget, setCustomSpellTarget] = useState("");
  const [customSpellArea, setCustomSpellArea] = useState("");
  const [customSpellDuration, setCustomSpellDuration] = useState("");
  const [customSpellSave, setCustomSpellSave] = useState<"" | SaveId>("");
  const [customSpellSaveResult, setCustomSpellSaveResult] = useState<"negates" | "half" | "partial" | "disbelief" | "harmless">("negates");
  const [customSavedEffectKind, setCustomSavedEffectKind] = useState<"none" | "damage" | "healing">("none");
  const [customSavedEffectDice, setCustomSavedEffectDice] = useState("1d4");
  const [customSavedEffectDamageType, setCustomSavedEffectDamageType] = useState("untyped");
  const [customSavedEffectPerCasterLevel, setCustomSavedEffectPerCasterLevel] = useState(false);
  const [customSavedEffectText, setCustomSavedEffectText] = useState("");
  const [customSpellResistance, setCustomSpellResistance] = useState(false);
  const [customSpellEffects, setCustomSpellEffects] = useState<Effect[]>([]);
  const [customSpellEffectsApplyToCaster, setCustomSpellEffectsApplyToCaster] = useState(false);
  const [rowLevel, setRowLevel] = useState("2");
  const [rowCasterLevel, setRowCasterLevel] = useState("2");
  const [rowMaxSpellLevel, setRowMaxSpellLevel] = useState("1");
  const [rowSlots, setRowSlots] = useState(["3", "2", "0", "0"]);
  const [rowKnown, setRowKnown] = useState(["", "", "", ""]);
  const [targetName, setTargetName] = useState("");
  const [targetSaveBonus, setTargetSaveBonus] = useState("");
  const [targetSpellResistance, setTargetSpellResistance] = useState("");
  const [targetTouchAc, setTargetTouchAc] = useState("");
  const [targetMissChance, setTargetMissChance] = useState(0);
  const [fleeingUse, setFleeingUse] = useState(false);
  const customSpells = sheet.character.customSpells ?? {};
  const spells = useMemo(() => ({ ...spellCatalog, ...customSpells }), [customSpells]);
  const sources = sheet.character.spellcastingSources ?? [];
  const spellLikeAbilities = (sheet.character.abilities ?? []).filter((ability) => ability.spellLike && ability.spellId && ability.activation === "activated");
  const panicked = sheet.character.features.some((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.panicked");
  const grappled = sheet.character.features.some((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.grappled");
  const classTemplates = Object.values(progressionCatalog).flatMap((definition) => (definition.spellcastingTemplates ?? []).map((template) => ({ ...template, progressionName: definition.name })));
  const addClassSource = () => {
    const template = classTemplates.find((item) => item.sourceId === classTemplateId);
    if (!template) return sheet.fail("Choose a class casting chart.");
    if (sources.some((item) => item.id === template.sourceId)) return sheet.fail(`${template.name} casting is already on this character.`);
    const source = {
      id: template.sourceId, name: template.name, mode: template.mode, castingAbility: template.castingAbility,
      progressionId: template.progressionId, spellListId: template.spellListId, spellListAccess: template.spellListAccess,
      bonusSlots: template.bonusSlots, progression: template.progression, source: template.source,
      ...(template.mode === "prepared" ? { ...(template.spellListAccess === "spellbook" ? { spellbookSpellIds: [] } : {}), preparedSpells: [] } : { knownSpellIds: [] }),
    };
    if (sheet.update({ spellcastingSources: [...sources, source] }, `Added ${template.progressionName} casting`)) setClassTemplateId("");
  };
  const addSource = () => {
    if (!sourceName.trim()) return sheet.fail("Enter a casting source name.");
    const id = nextId(slug(sourceName) || "casting-source", sources.map((item) => item.id));
    const progression: SpellSlotProgressionRow[] = [{ level: 0, casterLevel: 0, maximumSpellLevel: 0, slots: { "0": 0 } }, { level: 1, casterLevel: 1, maximumSpellLevel: 1, slots: { "0": 3, "1": 1 } }];
    sheet.update({ spellcastingSources: [...sources, { id, name: sourceName.trim(), mode: sourceMode, castingAbility: ability, spellListId: listId.trim() || id, spellListAccess: listAccess, bonusSlots: "none", progression, ...(sourceMode === "prepared" ? { ...(listAccess === "spellbook" ? { spellbookSpellIds: [] } : {}), preparedSpells: [] } : { knownSpellIds: [] }) }] }, `Added ${sourceName.trim()}`);
    setSourceName("");
  };
  const addCustomSpell = () => {
    const die = /^(\d+)d(\d+)$/i.exec(customSpellDamage.trim());
    const savedDie = /^(\d+)d(\d+)$/i.exec(customSavedEffectDice.trim());
    if (!customSpellName.trim() || !customSpellSchool.trim() || !die || (customSavedEffectKind !== "none" && !savedDie) || !Number.isInteger(Number(customSpellLevel)) || Number(customSpellLevel) < 0 || customSpellCastingAction === "timed" && (!Number.isFinite(Number(customSpellCastingTimeAmount)) || Number(customSpellCastingTimeAmount) <= 0)) return sheet.fail("Enter a spell name, school, non-negative level, valid effect dice, and a positive timed casting period when used.");
    const id = `local.${slug(customSpellName) || "spell"}`;
    if (spells[id]) return sheet.fail("A spell with that local id already exists.");
    const dice = { count: Number(die[1]), sides: Number(die[2]) };
    const castingTime = customSpellCastingAction === "timed"
      ? { action: "timed" as const, amount: Number(customSpellCastingTimeAmount), unit: customSpellCastingTimeUnit, ...(customSpellCastingTimeLabel.trim() ? { label: customSpellCastingTimeLabel.trim() } : {}) }
      : { action: customSpellCastingAction };
    const savedEffectDice = savedDie ? { count: Number(savedDie[1]), sides: Number(savedDie[2]) } : undefined;
    const successfulEffect = customSpellSaveResult === "partial" || customSpellSaveResult === "disbelief"
      ? {
          ...(customSavedEffectText.trim() ? { text: customSavedEffectText.trim() } : {}),
          ...(customSavedEffectKind === "damage" && savedEffectDice ? { damage: { dice: savedEffectDice, damageType: customSavedEffectDamageType.trim() || "untyped", ...(customSavedEffectPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 10 } : {}) } } : {}),
          ...(customSavedEffectKind === "healing" && savedEffectDice ? { healing: { dice: savedEffectDice, ...(customSavedEffectPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 5 } : {}) } } : {}),
        }
      : undefined;
    const savingThrow = customSpellSave ? { save: customSpellSave, result: customSpellSaveResult, ...(successfulEffect && Object.keys(successfulEffect).length ? { successfulEffect } : {}) } : undefined;
    const customSpells = {
      ...sheet.character.customSpells,
      [id]: {
        id,
        name: customSpellName.trim(),
        description: customSpellDescription.trim(),
        school: customSpellSchool.trim(),
        ...(customSpellSubschool.trim() ? { subschool: customSpellSubschool.trim() } : {}),
        ...(customSpellDescriptors.trim() ? { descriptors: customSpellDescriptors.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
        levels: [{ spellListId: listId.trim() || "custom", level: Number(customSpellLevel) }],
        castingTime,
        components: [...customSpellComponents, ...(customSpellOtherComponents.trim() ? [customSpellOtherComponents.trim()] : [])],
        ...(customSpellRange.trim() ? { range: customSpellRange.trim() } : {}),
        ...(customSpellTarget.trim() ? { target: customSpellTarget.trim() } : {}),
        ...(customSpellArea.trim() ? { area: customSpellArea.trim() } : {}),
        ...(customSpellDuration.trim() ? { duration: customSpellDuration.trim() } : {}),
        ...(savingThrow ? { savingThrow } : {}),
        ...(customSpellResistance ? { spellResistance: true } : {}),
        ...(customSpellEffects.length ? { effects: customSpellEffects } : {}),
        ...(customSpellEffectsApplyToCaster && customSpellEffects.length ? { effectsApplyToCaster: true } : {}),
        execution: customSpellEffectKind === "healing"
          ? { healing: { dice, ...(customSpellPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 5 } : {}) } }
          : { ...(customSpellAttack ? { attack: customSpellAttack } : {}), damage: { dice, damageType: customSpellDamageType.trim() || "force", ...(customSpellPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 10 } : {}) } },
      },
    };
    if (sheet.update({ customSpells }, `Added custom spell ${customSpellName.trim()}`)) setCustomSpellName("");
  };
  const cast = async (sourceId: string, spellId: string, preparedAllocationId?: string) => {
    const linkedTargetReady = sheet.linkedTargetCharacter?.id === sheet.linkedTargetId;
    const targetLabel = targetName.trim() || (linkedTargetReady ? sheet.linkedTargetCharacter?.name : undefined) || "Target";
    const manualTouchAc = Number(targetTouchAc);
    const hasManualTouchAc = targetTouchAc.trim() !== "" && Number.isFinite(manualTouchAc);
    const touchAc = hasManualTouchAc ? manualTouchAc : linkedTargetReady ? sheet.linkedTargetTouchAc : undefined;
    const targetCharacterId = linkedTargetReady ? sheet.linkedTargetId : undefined;
    const spellForTarget = spells[spellId];
    const requiredSave = spellForTarget?.savingThrow;
    const manualSaveBonusAtStart = Number(targetSaveBonus);
    const hasManualSaveBonus = targetSaveBonus.trim() !== "" && Number.isFinite(manualSaveBonusAtStart);
    const linkedSaveBonusAtStart = linkedTargetReady && requiredSave?.save ? sheet.linkedTargetSaves?.[requiredSave.save]?.value : undefined;
    if (requiredSave?.save && requiredSave.result !== "none" && requiredSave.result !== "harmless" && !hasManualSaveBonus && linkedSaveBonusAtStart === undefined) return sheet.fail(`Enter ${targetLabel}'s ${requiredSave.save} save bonus or link a target character before casting.`);
    const abilityId = sourceId.startsWith("spell-like:") ? sourceId.slice("spell-like:".length) : undefined;
    const abilityProposal = abilityId ? { character: sheet.character, abilityId, ...(panicked && fleeingUse ? { actionRestrictions: sheet.engine.actionRestrictions().filter((restriction) => restriction !== "fleeOnly") } : {}) } : undefined;
    const facts = abilityResourceFacts(sheet);
    const abilityPreparation = abilityProposal ? prepareAbilityExecution(abilityProposal, facts, abilityCatalog) : undefined;
    if (abilityPreparation && !abilityPreparation.accepted) return sheet.fail(abilityPreparation.issues.map((issue) => issue.message).join(" "));
    let result = abilityId
      ? castSpellLike(sheet.engine, abilityId, { targetName: targetLabel, ...(panicked && fleeingUse ? { fleeing: true } : {}), ...(targetCharacterId ? { targetCharacterId } : {}), ...(touchAc !== undefined ? { targetTouchAc: touchAc } : {}), ...(targetMissChance ? { targetMissChance } : {}) }, spells)
      : castSpell(sheet.engine, { sourceId, spellId, preparedAllocationId, targetName: targetLabel, ...(panicked && fleeingUse ? { fleeing: true } : {}), ...(targetCharacterId ? { targetCharacterId } : {}), ...(touchAc !== undefined ? { targetTouchAc: touchAc } : {}), ...(targetMissChance ? { targetMissChance } : {}) }, spells);
    if (!result.accepted) return sheet.fail(result.issues.map((issue) => issue.message).join(" "));
    let abilityRollPlans: RollPlan[] = [];
    if (abilityId && abilityProposal && abilityPreparation?.accepted) {
      const rechargeRollResults: Record<string, number> = {};
      for (const plan of abilityPreparation.execution.rollPlans.filter((item) => item.id.startsWith("resource:"))) {
        const rolled = await sheet.rollPlan(plan);
        if (!rolled) return;
        const resourceId = (sheet.character.resources ?? []).find((resource) => plan.id === `resource:${sheet.character.id}:${resource.id}:recharge`)?.id;
        if (resourceId) rechargeRollResults[resourceId] = rolled.total;
      }
      const activated = commitAbilityActivation({ ...abilityProposal, character: result.character, rechargeRollResults }, facts, abilityCatalog);
      if (!activated.accepted) return sheet.fail(activated.issues.map((issue) => issue.message).join(" "));
      abilityRollPlans = activated.execution.rollPlans.filter((item) => item.id.startsWith("ability:"));
      result = { ...result, character: activated.character };
    }
    if (grappled) {
      const linkedCmb = sheet.linkedTargetCharacter?.id === sheet.linkedTargetId ? sheet.linkedTargetCmbValue : undefined;
      const cmbText = grapplerCmb.trim() || (linkedCmb !== undefined ? String(linkedCmb) : "");
      const cmb = Number(cmbText);
      if (!cmbText || !Number.isInteger(cmb)) return sheet.fail("Link the grappler or enter their whole-number CMB to calculate the concentration DC.");
      const dc = 10 + cmb + result.execution.spellLevel;
      const plan = abilityId
        ? spellLikeConcentrationRollPlan(sheet.engine, abilityId, dc)
        : concentrationRollPlan(sheet.engine, sourceId, dc);
      const check = await sheet.rollPlan(plan);
      if (!check) return;
      if (check.total < dc) {
        sheet.update(result.character, `${result.spell.name} was lost after failing the grappled concentration check (DC ${dc})`);
        return;
      }
    }
    if (result.execution.arcaneSpellFailurePlan) {
      const failureRoll = await sheet.rollPlan(result.execution.arcaneSpellFailurePlan);
      if (!failureRoll) return;
      if (failureRoll.total <= Math.round(result.execution.arcaneSpellFailureChance * 100)) {
        sheet.update(result.character, `${result.spell.name} was lost to arcane spell failure`);
        return;
      }
    }
    const durationText = result.spell.duration?.trim();
    const activeSpellDurations = result.character.activeSpellDurations ?? [];
    const updatedCharacter = durationText && !/\binstantaneous\b/i.test(durationText)
      ? { ...result.character, activeSpellDurations: [...activeSpellDurations, { id: nextId(`spell-duration-${slug(result.spell.id)}`, activeSpellDurations.map((item) => item.id)), spellId: result.spell.id, spellName: result.spell.name, sourceId, durationText, ...(spellDurationInRounds(durationText, result.execution.casterLevel) !== undefined ? { roundsRemaining: spellDurationInRounds(durationText, result.execution.casterLevel) } : {}), ...(targetLabel ? { targetName: targetLabel } : {}), ...(targetCharacterId ? { targetCharacterId } : {}), ...(spellForTarget?.effects?.length ? { effects: spellForTarget.effects } : {}), ...(spellForTarget?.effectsApplyToCaster ? { effectsApplyToCaster: true } : {}), active: true }] }
      : result.character;
    if (!sheet.update(updatedCharacter, `Cast ${result.spell.name}`)) return;
    let resisted = false;
    const manualSr = Number(targetSpellResistance);
    const targetSr = targetSpellResistance.trim() && Number.isFinite(manualSr) ? manualSr : sheet.linkedTargetSpellResistance ?? 0;
    if (result.spell.spellResistance && targetSr > 0) {
      const resistancePlan: RollPlan = {
        id: `spell:${sheet.character.id}:${sourceId}:${spellId}:resistance`, characterId: sheet.character.id,
        label: `${result.spell.name} spell resistance check vs ${targetLabel}`, dice: [{ sides: 20, count: 1 }],
        modifier: result.execution.casterLevel, context: { kind: "skill", actorCharacterId: sheet.character.id, action: { kind: "skillCheck" }, target: { ...(targetCharacterId ? { characterId: targetCharacterId } : {}), name: targetLabel, defense: { kind: "dc", value: targetSr } } },
        outcomePolicy: plainOutcomePolicy, primaryCheckDie: d20CheckDie,
        provenance: { modifier: [{ target: "casterLevel", value: result.execution.casterLevel, label: "Caster level", source: `spell.${spellId}.casterLevel` }], excluded: [] },
      };
      const resistance = await sheet.rollPlan(resistancePlan);
      resisted = resistance !== null && resistance.total < targetSr;
      if (resisted) { sheet.inspect(`${result.spell.name} resisted`, { target: "casterLevel", value: resistance!.total, contributions: [] }); return; }
    }
    const save = result.spell.savingThrow;
    let saved = false;
    const linkedSave = save?.save ? sheet.linkedTargetSaves?.[save.save]?.value : undefined;
    const manualSave = Number(targetSaveBonus);
    const bonus = targetSaveBonus.trim() && Number.isFinite(manualSave) ? manualSave : linkedSave;
    if (save?.save && save.result !== "none" && save.result !== "harmless" && bonus !== undefined) {
      if (Number.isFinite(bonus)) {
        const savePlan: RollPlan = {
          id: `spell:${sheet.character.id}:${sourceId}:${spellId}:target-save`, characterId: sheet.character.id,
          label: `${targetLabel} ${save.save} save vs ${result.execution.saveDc}`, dice: [{ sides: 20, count: 1 }], modifier: bonus,
          context: { kind: "save", actorCharacterId: sheet.character.id, action: { kind: "other" }, saveId: save.save as SaveId, target: { ...(targetCharacterId ? { characterId: targetCharacterId } : {}), name: targetLabel, defense: { kind: "dc", value: result.execution.saveDc } } },
          outcomePolicy: saveOutcomePolicy, primaryCheckDie: d20CheckDie,
          provenance: { modifier: [], excluded: [] },
        };
        const saveRoll = await sheet.rollPlan(savePlan);
        if (!saveRoll) return;
        saved = saveRoll?.outcome.success === true;
      }
    }
    if (saved && save?.result === "negates") {
      sheet.inspect(`${result.spell.name}: ${targetLabel} negates the effect`, { target: "hp", value: 0, contributions: [] });
      return;
    }
    const authoredSaveResolution = saved && (save?.result === "partial" || save?.result === "disbelief");
    if (authoredSaveResolution) {
      if (result.execution.saveSuccessText) sheet.inspect(`${result.spell.name}: ${targetLabel} succeeded at the save. ${result.execution.saveSuccessText}`, { target: "hp", value: 0, contributions: [] });
      if (!result.execution.saveSuccessText && !result.execution.saveSuccessRollPlans.length) sheet.inspect(`${result.spell.name}: ${targetLabel} succeeded at the save; no successful-save effect is authored.`, { target: "hp", value: 0, contributions: [] });
      for (const plan of result.execution.saveSuccessRollPlans) await sheet.rollPlan(plan);
    }
    let attackMissed = false;
    const plansToResolve = authoredSaveResolution ? [] : result.execution.rollPlans;
    for (const plan of plansToResolve) {
      if (attackMissed) break;
      const rolled = await sheet.rollPlan(plan);
      if (plan.context.kind === "attack" && rolled?.outcome.hit === false) attackMissed = true;
      if (saved && save?.result === "half" && plan.context.kind === "damage" && rolled) {
        sheet.inspect(`${result.spell.name}: half damage after ${targetLabel}'s successful save`, { target: "hp", value: Math.floor(rolled.total / 2), contributions: [] });
      }
    }
    const source = sheet.character.spellcastingSources?.find((item) => item.id === sourceId);
    const dc = source ? deriveSpellcastingSource(sheet.engine, source, spells).saveDc(result.execution.spellLevel) : undefined;
    if (dc) sheet.inspect(`${result.spell.name} DC`, dc);
    for (const plan of abilityRollPlans) await sheet.rollPlan(plan);
  };
  const addAccess = (sourceId: string, spellId: string) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;
    if (source.mode === "prepared" && source.spellListAccess === "list") return;
    const key = source.mode === "prepared" ? "spellbookSpellIds" : "knownSpellIds";
    const values = source[key] ?? [];
    if (values.includes(spellId)) return;
    if (source.mode === "spontaneous") {
      const derived = deriveSpellcastingSource(sheet.engine, source, spells);
      const level = derived.spellLevel(spellId, spells);
      const count = values.filter((knownId) => derived.spellLevel(knownId, spells) === level).length;
      const capacity = derived.spellsKnown.find((item) => item.level === level)?.capacity;
      if (level !== undefined && capacity !== undefined && count >= capacity) return sheet.fail(`The source has learned all ${capacity} level ${level} spells allowed by its current progression.`);
    }
    sheet.update({ spellcastingSources: sources.map((item) => item.id === sourceId ? { ...item, [key]: [...values, spellId] } : item) }, `Added ${spells[spellId]?.name ?? spellId} to ${source.name}`);
  };
  const addProgressionRow = (sourceId: string) => {
    const level = Number(rowLevel), casterLevel = Number(rowCasterLevel), maximumSpellLevel = Number(rowMaxSpellLevel);
    if (![level, casterLevel, maximumSpellLevel, ...rowSlots.map(Number)].every(Number.isInteger) || level < 0 || casterLevel < 0 || maximumSpellLevel < 0 || rowSlots.some((slot) => Number(slot) < 0)) return sheet.fail("Progression values must be non-negative whole numbers.");
    if (rowKnown.some((value) => value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 0))) return sheet.fail("Spells-known allowances must be non-negative whole numbers.");
    const source = sources.find((item) => item.id === sourceId); if (!source) return;
    const row: SpellSlotProgressionRow = { level, casterLevel, maximumSpellLevel, slots: Object.fromEntries(rowSlots.map((value, index) => [String(index), Number(value)])), ...(rowKnown.some((value) => value.trim()) ? { spellsKnown: Object.fromEntries(rowKnown.flatMap((value, index) => value.trim() ? [[String(index), Number(value)]] : [])) } : {}) };
    const progression = [...source.progression.filter((item) => item.level !== level), row].sort((a, b) => a.level - b.level);
    sheet.update({ spellcastingSources: sources.map((item) => item.id === sourceId ? { ...item, progression } : item) }, `Updated ${source.name} progression`);
  };
  const prepare = (sourceId: string, chosen: string) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;
    if (!chosen) return sheet.fail("No eligible spells are available to prepare.");
    const spellLevel = spells[chosen]?.levels.find((entry) => entry.spellListId === source.spellListId)?.level;
    if (spellLevel === undefined) return sheet.fail("The selected spell is not available to this source.");
    const current = source.preparedSpells ?? [];
    const id = nextId(`prepared-${slug(chosen)}`, current.map((item) => item.id));
    const derived = deriveSpellcastingSource(sheet.engine, source, spells);
    const capacities = Object.fromEntries(derived.slots.filter((slot) => !slot.unlimited).map((slot) => [String(slot.level), slot.capacity]));
    try {
      if (sheet.update(prepareSpells(sheet.character, sourceId, [...current.filter((item) => !item.expended), { id, spellId: chosen, spellLevel }], derived.progressionLevel, capacities), `Prepared ${spells[chosen]?.name ?? chosen}`)) setPrepareSpellBySource((state) => ({ ...state, [sourceId]: "" }));
    }
    catch (error) { sheet.fail(error instanceof Error ? error.message : "Could not prepare spell."); }
  };
  return <div className="spellcasting-panel">
    <section className="panel"><span className="eyebrow">TARGET RESOLUTION</span><h3>Spell target</h3><div className="form-grid"><LinkedTargetPicker characters={sheet.savedCharacters.filter((item) => item.id !== sheet.character.id && (!sheet.character.campaignId || item.campaignId === sheet.character.campaignId))} targetId={sheet.linkedTargetId} testId="spell-target-character" onTargetChange={sheet.setLinkedTargetId} onRefresh={sheet.refreshLinkedTarget} /><label>Target name<input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="Defaults to saved target" /></label><label>Target touch AC<input type="number" min="0" value={targetTouchAc || (sheet.linkedTargetCharacter?.id === sheet.linkedTargetId && sheet.linkedTargetTouchAc !== undefined ? String(sheet.linkedTargetTouchAc) : "")} onChange={(event) => setTargetTouchAc(event.target.value)} placeholder="Optional; linked AC used when blank" /></label><MissChanceField label="Target concealment" value={targetMissChance} testId="spell-target-miss-chance" onChange={setTargetMissChance} /><label>Target save bonus override<input type="number" value={targetSaveBonus} onChange={(event) => setTargetSaveBonus(event.target.value)} placeholder="Linked target save is used automatically" /></label><label>Target spell resistance override<input type="number" min="0" value={targetSpellResistance} onChange={(event) => setTargetSpellResistance(event.target.value)} placeholder="Use linked target or none" /></label>{grappled && <label>Grappler CMB override<input aria-label="Grappler CMB override" type="number" step="1" value={grapplerCmb} onChange={(event) => setGrapplerCmb(event.target.value)} placeholder={sheet.linkedTargetCharacter?.id === sheet.linkedTargetId && sheet.linkedTargetCmbValue !== undefined ? `Linked CMB ${sheet.linkedTargetCmbValue}` : "Link grappler or enter CMB"} /></label>}</div>{panicked && <label className="checkbox-field"><input type="checkbox" checked={fleeingUse} onChange={(event) => setFleeingUse(event.target.checked)} /><span>Use this spell or spell-like ability to flee Panicked</span></label>}{grappled && <p className="muted">Casting while grappled requires a concentration check against 10 + the grappler’s CMB + spell level. A linked grappler supplies CMB automatically; enter an override when they are not saved as a character. The slot or ability use is spent when the attempt is made.</p>}<p className="muted">A saved target supplies its current touch AC, relevant saving throw, and spell resistance. Enter a value to override it, or leave the field blank to use the linked character.</p></section>
    {spellLikeAbilities.length > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SPELL-LIKE ABILITIES</span><h2>Cast authored abilities</h2></div></div><div className="spell-source-list">{spellLikeAbilities.map((ability) => {
      const spell = spells[ability.spellId!];
      const remaining = ability.usesPerDay === undefined ? undefined : Math.max(0, ability.usesPerDay - (ability.usesSpent ?? 0));
      return <article className="spell-entry" key={ability.id}><div><b>{ability.name}</b><small>{spell?.name ?? ability.spellId}{spell ? ` · ${spell.castingTime.action === "timed" ? spell.castingTime.label ?? `${spell.castingTime.amount} ${spell.castingTime.unit}` : spell.castingTime.action}` : " · linked spell is unavailable"}{remaining === undefined ? " · at will" : ` · ${remaining}/${ability.usesPerDay} uses today`}</small></div><div className="inline-actions">{remaining !== undefined && <button className="table-action" disabled={(ability.usesSpent ?? 0) <= 0} onClick={() => sheet.update({ abilities: (sheet.character.abilities ?? []).map((item) => item.id === ability.id ? { ...item, usesSpent: Math.max(0, (item.usesSpent ?? 0) - 1) } : item) })}>Restore use</button>}<button className="button quiet" disabled={!spell || remaining === 0} onClick={() => void cast(`spell-like:${ability.id}`, ability.spellId!)}>Cast</button></div></article>;
    })}</div><p className="muted">Spell-like uses are tracked on the ability and do not spend class spell slots. Save DC uses its authored ability and spell level; caster level defaults to character level.</p></section>}
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SPELLCASTING</span><h2>Sources &amp; spells</h2></div></div>
      {!sources.length && <p className="muted">No casting sources yet. Add a source below; it stays independent from abilities and from other sources.</p>}
      {classTemplates.length > 0 && <div className="spell-entry-row class-spell-template"><label>Class chart<select aria-label="Class casting chart" value={classTemplateId} onChange={(event) => setClassTemplateId(event.target.value)}><option value="">Choose a workbook class chart…</option>{classTemplates.map((template) => <option key={template.sourceId} value={template.sourceId}>{template.progressionName} · {template.mode} · {template.castingAbility.toUpperCase()}</option>)}</select></label><button className="button quiet" disabled={!classTemplateId} onClick={addClassSource}>Add class casting</button></div>}
      {sources.map((source) => {
        const derived = deriveSpellcastingSource(sheet.engine, source, spells);
        const progressionKey = source.progressionId?.toLocaleLowerCase("en-US") ?? "";
        const inferredArcaneExemption = progressionKey.includes(".bard.") || progressionKey.endsWith(".bard")
          ? "lightArmorAndShields"
          : progressionKey.includes(".magus.") || progressionKey.endsWith(".magus")
            ? derived.progressionLevel >= 13 ? "heavyArmor" : derived.progressionLevel >= 7 ? "mediumArmor" : "lightArmor"
            : "none";
        const displayedArcaneExemption = source.arcaneSpellFailureExemption ?? inferredArcaneExemption;
        const listSpells = Object.values(spells).filter((spell) => spell.levels.some((level) => level.spellListId === source.spellListId));
        const available = source.mode === "prepared" ? source.spellListAccess === "spellbook" ? source.spellbookSpellIds ?? [] : listSpells.map((spell) => spell.id) : source.knownSpellIds ?? [];
        const spellGroups = new Map<number, string[]>();
        for (const spellId of available) {
          const level = derived.spellLevel(spellId, spells) ?? 0;
          spellGroups.set(level, [...(spellGroups.get(level) ?? []), spellId]);
        }
        return <article className="panel spell-source" key={source.id}>
          <div className="panel-heading"><div><h3>{source.name}</h3><small>{source.mode} · {source.spellListId}</small></div></div>
          {source.spellListId.trim().toLocaleLowerCase("en-US") === "arcane" && <label className="field">Arcane spell failure exemption<select aria-label={`Arcane spell failure exemption for ${source.name}`} value={displayedArcaneExemption} onChange={(event) => sheet.update({ spellcastingSources: sources.map((item) => item.id === source.id ? { ...item, arcaneSpellFailureExemption: event.target.value as NonNullable<typeof source.arcaneSpellFailureExemption> } : item) }, `Updated ${source.name} spell failure exemption`)}><option value="none">None</option><option value="lightArmor">Light armor</option><option value="lightArmorAndShields">Light armor and shields</option><option value="mediumArmor">Light and medium armor</option><option value="mediumArmorAndShields">Light/medium armor and shields</option><option value="heavyArmor">Any armor</option><option value="all">Armor and shields</option></select><small>Bard and Magus chart sources infer their class exemptions. Override for archetypes or other class features.</small></label>}
          <div className="spell-summary"><span>Class level <b>{derived.progressionLevel}</b></span><span>Caster level <b>{derived.casterLevel.value}</b></span><span>Maximum spell level <b>{derived.maximumSpellLevel}</b></span><span>Concentration <b>{derived.concentration.value >= 0 ? "+" : ""}{derived.concentration.value}</b></span><span>Ability <b>{source.castingAbility.toUpperCase()}</b></span></div>
          <details><summary>Workbook level adjustments</summary><div className="form-grid"><label className="field"><span>Class level adjustment</span><input type="number" value={source.progressionLevelAdjustment ?? 0} onChange={(event) => sheet.update({ spellcastingSources: sources.map((item) => item.id === source.id ? { ...item, progressionLevelAdjustment: Number(event.target.value) || 0 } : item) })} /></label><label className="field"><span>Caster level adjustment</span><input type="number" value={source.casterLevelAdjustment ?? 0} onChange={(event) => sheet.update({ spellcastingSources: sources.map((item) => item.id === source.id ? { ...item, casterLevelAdjustment: Number(event.target.value) || 0 } : item) })} /></label></div></details>
          <div className="spell-entry-row"><label>Concentration DC (optional)<input type="number" min="0" value={concentrationDc} onChange={(event) => setConcentrationDc(event.target.value)} /></label><button className="button quiet" onClick={() => void sheet.rollPlan(concentrationRollPlan(sheet.engine, source.id, concentrationDc.trim() ? Number(concentrationDc) : undefined))}>Roll concentration</button></div>
          <details><summary>Inspect derived values</summary><p>Caster level: {derived.casterLevel.contributions.map((item) => `${item.label} ${item.value >= 0 ? "+" : ""}${item.value}`).join(" · ")}</p><p>Concentration: {derived.concentration.contributions.map((item) => `${item.label} ${item.value >= 0 ? "+" : ""}${item.value}`).join(" · ")}</p></details>
          <table className="spell-slot-table"><thead><tr><th>Level</th><th>Slots</th><th>Remaining</th></tr></thead><tbody>{derived.slots.map((slot) => <tr key={slot.level}><th>{slot.level}</th><td>{slot.unlimited ? "∞" : slot.capacity}</td><td>{slot.unlimited ? "∞" : <div className="spell-slot-tracker"><b>{slot.remaining} / {slot.capacity} left</b><div className="inline-actions"><button className="table-action" aria-label={`Mark level ${slot.level} spell slot used for ${source.name}`} disabled={slot.remaining <= 0} onClick={() => adjustSpellSlot(sheet, source.id, slot.level, 1, slot.capacity)}>Use slot</button><button className="table-action" aria-label={`Restore level ${slot.level} spell slot for ${source.name}`} disabled={slot.spent <= 0} onClick={() => adjustSpellSlot(sheet, source.id, slot.level, -1, slot.capacity)}>Restore</button></div></div>}</td></tr>)}</tbody></table>
          {source.mode === "spontaneous" && derived.spellsKnown.length > 0 && <p className="muted">Spells known: {derived.spellsKnown.map((item) => `Level ${item.level}: ${source.knownSpellIds?.filter((spellId) => derived.spellLevel(spellId, spells) === item.level).length ?? 0}/${item.capacity}`).join(" · ")}</p>}
          <button className="button quiet" onClick={() => sheet.update(refreshSpellcasting(sheet.character, source.id), `Refreshed ${source.name} slots and preparations`)}>Refresh slots and preparations</button>
          <details><summary>Edit progression table</summary><div className="form-grid"><label>Progression level<input type="number" min="0" value={rowLevel} onChange={(event) => setRowLevel(event.target.value)} /></label><label>Caster level<input type="number" min="0" value={rowCasterLevel} onChange={(event) => setRowCasterLevel(event.target.value)} /></label><label>Maximum spell level<input type="number" min="0" value={rowMaxSpellLevel} onChange={(event) => setRowMaxSpellLevel(event.target.value)} /></label>{rowSlots.map((value, index) => <label key={index}>Level {index} slots<input type="number" min="0" value={value} onChange={(event) => setRowSlots((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}{rowKnown.map((value, index) => <label key={`known-${index}`}>Level {index} spells known<input type="number" min="0" value={value} onChange={(event) => setRowKnown((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}</div><button className="button quiet" onClick={() => addProgressionRow(source.id)}>Save progression row</button><table className="spell-slot-table"><tbody>{source.progression.map((row) => <tr key={row.level}><th>Progression {row.level}</th><td>CL {row.casterLevel}</td><td>Max spell {row.maximumSpellLevel}</td><td>{Object.entries(row.slots).map(([level, count]) => `${level}: ${count}`).join(" · ")}</td><td>{Object.entries(row.spellsKnown ?? {}).map(([level, count]) => `Known ${level}: ${count}`).join(" · ")}</td></tr>)}</tbody></table></details>
          {(source.mode === "spontaneous" || source.spellListAccess === "spellbook") && <div className="spell-entry-row"><select aria-label={`Add spell to ${source.name}`} value={entrySpell} onChange={(event) => setEntrySpell(event.target.value)}><option value="">Choose spell…</option>{listSpells.map((spell) => <option value={spell.id} key={spell.id}>{spell.name} ({spell.levels.find((item) => item.spellListId === source.spellListId)?.level})</option>)}</select><button className="button quiet" disabled={!entrySpell} onClick={() => addAccess(source.id, entrySpell)}>{source.mode === "prepared" ? "Add to spellbook" : "Learn spell"}</button></div>}
          {source.mode === "prepared" && <div className="spell-entry-row"><select aria-label={`Choose spell to prepare for ${source.name}`} value={prepareSpellBySource[source.id] ?? ""} onChange={(event) => setPrepareSpellBySource((state) => ({ ...state, [source.id]: event.target.value }))}><option value="">Choose a spell to prepare…</option>{available.map((spellId) => spells[spellId]).filter((spell): spell is NonNullable<typeof spells[string]> => Boolean(spell)).sort((a, b) => a.name.localeCompare(b.name)).map((spell) => <option key={spell.id} value={spell.id}>{spell.name} (level {derived.spellLevel(spell.id, spells)})</option>)}</select><button className="button quiet" disabled={!prepareSpellBySource[source.id]} onClick={() => prepare(source.id, prepareSpellBySource[source.id]!)}>Prepare selected spell</button></div>}
          <div className="spell-list">{[...spellGroups.entries()].sort(([a], [b]) => a - b).map(([spellLevel, spellIds]) => <section className="spell-level-group" key={spellLevel}><h4>Level {spellLevel}</h4>{spellIds.map((spellId) => {
            const spell = spells[spellId]; if (!spell) return null;
            const level = derived.spellLevel(spellId, spells) ?? 0;
            const dc = derived.saveDc(level);
            const allocations = source.preparedSpells?.filter((item) => item.spellId === spellId) ?? [];
            return <div className="spell-row" key={spellId}><div><b>{spell.name}</b><small>Level {level} · DC {dc.value} · {spell.castingTime.action}{spell.castingTime.action === "timed" ? ` (${spell.castingTime.amount} ${spell.castingTime.label ?? spell.castingTime.unit})` : ""} · Components: {spell.components.join(", ") || "none listed"}{spell.range ? ` · Range: ${spell.range}` : ""}{spell.target ? ` · Target: ${spell.target}` : ""}{spell.area ? ` · Area: ${spell.area}` : ""}{spell.duration ? ` · Duration: ${spell.duration}` : ""}{spell.savingThrow ? ` · Save: ${spell.savingThrow.save ?? "see text"} ${spell.savingThrow.result}` : " · No saving throw listed"}{spell.spellResistance ? " · Spell resistance applies" : " · Spell resistance does not apply"} · {spell.description}</small></div>
              {source.mode === "spontaneous" ? <button className="button quiet" disabled={!(derived.slots.find((item) => item.level === level)?.unlimited ?? false) && (derived.slots.find((item) => item.level === level)?.remaining ?? 0) <= 0} onClick={() => void cast(source.id, spell.id)}>Cast</button> : allocations.filter((item) => !item.expended).map((item) => <button className="button quiet" key={item.id} onClick={() => void cast(source.id, spell.id, item.id)}>Cast prepared</button>)}
            </div>;
          })}</section>)}</div>
          {source.mode === "prepared" && source.preparedSpells?.some((item) => item.expended) && <p className="muted">Expended: {source.preparedSpells.filter((item) => item.expended).length}</p>}
        </article>;
      })}
    </section>
    {(sheet.character.activeSpellDurations?.length ?? 0) > 0 && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SPELL DURATIONS</span><h3>Active and recent spells</h3></div></div><div className="spell-source-list">{sheet.character.activeSpellDurations!.map((entry) => <div className={`spell-entry ${entry.active ? "enabled" : ""}`} key={entry.id}><div><b>{entry.spellName}</b><small>{entry.active ? `Active on ${entry.targetName ?? "target"} · ${entry.durationText}` : `Ended · ${entry.durationText}`}</small></div><label className="field"><span>Rounds remaining</span><input aria-label={`${entry.spellName} rounds remaining`} type="number" min="0" step="1" disabled={!entry.active} value={entry.roundsRemaining ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Math.max(0, Math.floor(Number(event.target.value) || 0)); sheet.update({ activeSpellDurations: sheet.character.activeSpellDurations?.map((item) => item.id === entry.id ? { ...item, roundsRemaining: value } : item) }); }} /></label><label className="system-entry-toggle"><input type="checkbox" checked={entry.active} onChange={(event) => sheet.update({ activeSpellDurations: sheet.character.activeSpellDurations?.map((item) => item.id === entry.id ? { ...item, active: event.target.checked, ...(event.target.checked ? {} : { roundsRemaining: undefined }) } : item) })} /> Active</label></div>)}</div><p className="muted">Simple round, minute, and hour durations convert to rounds and expire at Start new turn. Edit the timer for durations that depend on other rules.</p></section>}
    <section className="panel"><span className="eyebrow">EXPERT AUTHORING</span><h3>Add a casting source</h3><div className="form-grid"><label>Source name<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label><label>Mode<select value={sourceMode} onChange={(event) => { const next = event.target.value as typeof sourceMode; setSourceMode(next); setListAccess(next === "prepared" ? "spellbook" : "list"); }}><option value="spontaneous">Spontaneous</option><option value="prepared">Prepared</option></select></label><label>Casting ability<select value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}><option value="int">INT</option><option value="wis">WIS</option><option value="cha">CHA</option></select></label><label>Spell-list identity<input value={listId} onChange={(event) => setListId(event.target.value)} /></label><label>Spell access<select value={listAccess} onChange={(event) => setListAccess(event.target.value as typeof listAccess)}><option value="list">Spell list</option><option value="spellbook">Spellbook</option></select></label></div><p className="muted">A simple starter table is created. Progression rows and slot allowances are persisted on the source and can be extended through authored content.</p><button className="button" onClick={addSource}>Add source</button></section>
    <section className="panel">
      <span className="eyebrow">CHARACTER-LOCAL SPELL</span><h3>Define a custom spell</h3>
      <div className="form-grid">
        <label>Name<input value={customSpellName} onChange={(event) => setCustomSpellName(event.target.value)} /></label>
        <label>School<input value={customSpellSchool} onChange={(event) => setCustomSpellSchool(event.target.value)} /></label>
        <label>Subschool<input value={customSpellSubschool} onChange={(event) => setCustomSpellSubschool(event.target.value)} /></label>
        <label>Descriptors<input placeholder="comma separated" value={customSpellDescriptors} onChange={(event) => setCustomSpellDescriptors(event.target.value)} /></label>
        <label>Level<input type="number" min="0" value={customSpellLevel} onChange={(event) => setCustomSpellLevel(event.target.value)} /></label>
        <label>Casting time<select aria-label="Custom spell casting time" value={customSpellCastingAction} onChange={(event) => setCustomSpellCastingAction(event.target.value as typeof customSpellCastingAction)}><option value="standard">Standard action</option><option value="swift">Swift action</option><option value="immediate">Immediate action</option><option value="fullRound">Full round</option><option value="move">Move action</option><option value="free">Free action</option><option value="timed">Timed</option></select></label>
        {customSpellCastingAction === "timed" && <><label>Time amount<input type="number" min="0.01" step="any" value={customSpellCastingTimeAmount} onChange={(event) => setCustomSpellCastingTimeAmount(event.target.value)} /></label><label>Time unit<select value={customSpellCastingTimeUnit} onChange={(event) => setCustomSpellCastingTimeUnit(event.target.value as typeof customSpellCastingTimeUnit)}><option value="rounds">Rounds</option><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="custom">Other</option></select></label><label>Time label (optional)<input value={customSpellCastingTimeLabel} onChange={(event) => setCustomSpellCastingTimeLabel(event.target.value)} /></label></>}
        <label>Components<select aria-label="Custom spell components" multiple value={customSpellComponents} onChange={(event) => setCustomSpellComponents(Array.from(event.target.selectedOptions, (option) => option.value))}><option value="verbal">Verbal</option><option value="somatic">Somatic</option><option value="material">Material</option><option value="focus">Focus</option><option value="divineFocus">Divine focus</option></select></label>
        <label>Component details<input placeholder="Material or focus details" value={customSpellOtherComponents} onChange={(event) => setCustomSpellOtherComponents(event.target.value)} /></label>
        <label>Range<input placeholder="e.g. close, 30 feet, touch" value={customSpellRange} onChange={(event) => setCustomSpellRange(event.target.value)} /></label>
        <label>Target<input value={customSpellTarget} onChange={(event) => setCustomSpellTarget(event.target.value)} /></label>
        <label>Area<input value={customSpellArea} onChange={(event) => setCustomSpellArea(event.target.value)} /></label>
        <label>Duration<input value={customSpellDuration} onChange={(event) => setCustomSpellDuration(event.target.value)} /></label>
        <label>Saving throw<select aria-label="Custom spell saving throw" value={customSpellSave} onChange={(event) => setCustomSpellSave(event.target.value as typeof customSpellSave)}><option value="">No saving throw</option><option value="fortitude">Fortitude</option><option value="reflex">Reflex</option><option value="will">Will</option></select></label>
        {customSpellSave && <label>Save result<select value={customSpellSaveResult} onChange={(event) => setCustomSpellSaveResult(event.target.value as typeof customSpellSaveResult)}><option value="negates">Negates</option><option value="half">Half</option><option value="partial">Partial</option><option value="disbelief">Disbelief</option><option value="harmless">Harmless</option></select></label>}
        {customSpellSave && (customSpellSaveResult === "partial" || customSpellSaveResult === "disbelief") && <><label>Effect if the target succeeds at the save<textarea aria-label="Successful-save spell effect text" rows={3} value={customSavedEffectText} onChange={(event) => setCustomSavedEffectText(event.target.value)} placeholder="What happens on a successful save?" /></label><label>Calculated effect on a successful save<select aria-label="Calculated successful-save spell effect" value={customSavedEffectKind} onChange={(event) => setCustomSavedEffectKind(event.target.value as typeof customSavedEffectKind)}><option value="none">Resolve from notes only</option><option value="damage">Damage</option><option value="healing">Healing</option></select></label>{customSavedEffectKind !== "none" && <><label>{customSavedEffectKind === "healing" ? "Successful-save healing dice" : "Successful-save damage dice"}<input value={customSavedEffectDice} onChange={(event) => setCustomSavedEffectDice(event.target.value)} /></label>{customSavedEffectKind === "damage" && <label>Successful-save damage type<input value={customSavedEffectDamageType} onChange={(event) => setCustomSavedEffectDamageType(event.target.value)} /></label>}<label><input type="checkbox" checked={customSavedEffectPerCasterLevel} onChange={(event) => setCustomSavedEffectPerCasterLevel(event.target.checked)} /> Scale successful-save dice by caster level{customSavedEffectKind === "healing" ? " (cap 5)" : " (cap 10)"}</label></>}</>}
        <label><input type="checkbox" checked={customSpellResistance} onChange={(event) => setCustomSpellResistance(event.target.checked)} /> Spell resistance applies</label>
        <label><input type="checkbox" checked={customSpellEffectsApplyToCaster} onChange={(event) => setCustomSpellEffectsApplyToCaster(event.target.checked)} /> Apply authored effects to this character while active</label>
        <label>Effect<select aria-label="Custom spell effect" value={customSpellEffectKind} onChange={(event) => setCustomSpellEffectKind(event.target.value as typeof customSpellEffectKind)}><option value="damage">Damage</option><option value="healing">Healing</option></select></label>
        {customSpellEffectKind === "damage" && <><label>Touch attack<select aria-label="Custom spell touch attack" value={customSpellAttack} onChange={(event) => setCustomSpellAttack(event.target.value as typeof customSpellAttack)}><option value="">No attack roll</option><option value="meleeTouch">Melee touch</option><option value="rangedTouch">Ranged touch</option></select></label><label>Damage type<input value={customSpellDamageType} onChange={(event) => setCustomSpellDamageType(event.target.value)} /></label></>}
        <label>{customSpellEffectKind === "healing" ? "Healing dice" : "Damage dice"}<input value={customSpellDamage} onChange={(event) => setCustomSpellDamage(event.target.value)} /></label>
        <label><input type="checkbox" checked={customSpellPerCasterLevel} onChange={(event) => setCustomSpellPerCasterLevel(event.target.checked)} /> Multiply dice by caster level (cap 5 for healing, 10 for damage)</label>
        <label className="field">Description<textarea value={customSpellDescription} onChange={(event) => setCustomSpellDescription(event.target.value)} /></label>
      </div>
      <SystemEntryEffectsEditor effects={customSpellEffects} onChange={setCustomSpellEffects} />
      <button className="button quiet" onClick={addCustomSpell}>Add custom spell</button>
    </section>
  </div>;
}
