import { useState } from "react";
import { applicabilityOf, autosheetTalentRanks, deriveCharacterSystems, resolveTurnAction, sourceContribution, unchainedWoundPenalty, plainOutcomePolicy } from "@threepointpf/rules-core";
import { autosheetSphereCategoryCatalog, progressionCatalog } from "@threepointpf/rules-data";
import { characterSystemKinds, veilChakras, type BonusType, type CharacterSystemKind, type CharacterSystemEntry, type CharacterSystemSource, type Effect, type EffectApplicability, type EffectTargetId, type RollPlan, type VeilChakra } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { abilities, abilityLabels, bonusTypes, effectTargets } from "../lib/options";
import { catalogValues, describeEffect, nextId, slug } from "../lib/format";
import { Field } from "./primitives";

const systemNames: Record<CharacterSystemKind, string> = {
  maneuvers: "Maneuvers & stances", veilweaving: "Veilweaving", spheresOfPower: "Spheres of Power",
  spheresOfMight: "Spheres of Might", psionics: "Psionics", ffd20: "FFd20 spellcasting",
};
const systemResources: Record<CharacterSystemKind, string> = {
  maneuvers: "Readied maneuvers", veilweaving: "Essence", spheresOfPower: "Spell points",
  spheresOfMight: "Martial talents", psionics: "Power points", ffd20: "Magic points",
};
const isStanceEntry = (entry: Pick<CharacterSystemEntry, "entryType" | "category">) => entry.entryType ? entry.entryType === "stance" : /^stance\b/i.test(entry.category?.trim() ?? "");

export function SystemEntryEffectsEditor({ effects, onChange }: { effects: Effect[]; onChange(effects: Effect[]): void }) {
  const [kind, setKind] = useState<Effect["kind"]>("modifier");
  const [target, setTarget] = useState<EffectTargetId>("attack.melee");
  const [value, setValue] = useState("1");
  const [bonus, setBonus] = useState<BonusType>("untyped");
  const [dice, setDice] = useState("1d6");
  const [damageType, setDamageType] = useState("");
  const [criticalOperation, setCriticalOperation] = useState<"widen" | "double">("widen");
  const [criticalBehavior, setCriticalBehavior] = useState<"normal" | "notMultiplied">("normal");
  const [acContexts, setAcContexts] = useState<Array<"normal" | "touch" | "flatFooted" | "deniedDexterity">>(["normal"]);
  const [rollKinds, setRollKinds] = useState<NonNullable<EffectApplicability["kinds"]>>([]);
  const [modes, setModes] = useState<NonNullable<EffectApplicability["modes"]>>([]);
  const [requiredFlags, setRequiredFlags] = useState("");
  const [excludedFlags, setExcludedFlags] = useState("");
  const [requiredTags, setRequiredTags] = useState("");
  const [excludedTags, setExcludedTags] = useState("");
  const [maneuverIds, setManeuverIds] = useState("");
  const [attackIds, setAttackIds] = useState("");
  const [touch, setTouch] = useState<"any" | "touch" | "nonTouch">("any");
  const [fullAttack, setFullAttack] = useState<"any" | "full" | "standard">("any");
  const availableTargets = kind === "damageDice" ? ["damage.melee", "damage.ranged"] as EffectTargetId[]
    : kind === "criticalRange" ? ["attack.melee", "attack.ranged"] as EffectTargetId[]
    : kind === "grant" || kind === "replaceBase" || kind === "multiply" || kind === "minimum" || kind === "maximum" ? effectTargets.filter((item) => item !== "ac")
    : effectTargets;
  const addEffect = () => {
    const appliesWhen = {
      ...(rollKinds.length ? { kinds: rollKinds } : {}),
      ...(modes.length ? { modes } : {}),
      ...(requiredFlags.trim() ? { requiredFlags: requiredFlags.split(",").map((flag) => flag.trim()).filter(Boolean) } : {}),
      ...(excludedFlags.trim() ? { excludedFlags: excludedFlags.split(",").map((flag) => flag.trim()).filter(Boolean) } : {}),
      ...(requiredTags.trim() ? { requiredTags: requiredTags.split(",").map((tag) => tag.trim()).filter(Boolean) as NonNullable<EffectApplicability["requiredTags"]> } : {}),
      ...(excludedTags.trim() ? { excludedTags: excludedTags.split(",").map((tag) => tag.trim()).filter(Boolean) as NonNullable<EffectApplicability["excludedTags"]> } : {}),
      ...(maneuverIds.trim() ? { maneuvers: maneuverIds.split(",").map((maneuver) => maneuver.trim()).filter(Boolean) } : {}),
      ...(attackIds.trim() ? { attackIds: attackIds.split(",").map((attackId) => attackId.trim()).filter(Boolean) } : {}),
      ...(touch !== "any" ? { touch: touch === "touch" } : {}),
      ...(fullAttack !== "any" ? { fullAttack: fullAttack === "full" } : {}),
    };
    if (kind === "damageDice") {
      const match = /^(\d+)d(\d+)$/i.exec(dice.trim());
      if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) return;
      onChange([...effects, { kind, target: target as "damage.melee" | "damage.ranged", dice: { count: Number(match[1]), sides: Number(match[2]) }, ...(damageType.trim() ? { damageType: damageType.trim() } : {}), criticalBehavior, ...(Object.keys(appliesWhen).length ? { appliesWhen } : {}) }]);
      return;
    }
    if (kind === "criticalRange") {
      const numeric = Number(value);
      if (target !== "attack.melee" && target !== "attack.ranged") return;
      if (criticalOperation === "widen" && (!Number.isInteger(numeric) || numeric < 1)) return;
      onChange([...effects, { kind, target, operation: criticalOperation, ...(criticalOperation === "widen" ? { widenBy: numeric } : {}), ...(Object.keys(appliesWhen).length ? { appliesWhen } : {}) }]);
      return;
    }
    if (kind === "grant") {
      if (!damageType.trim()) return;
      onChange([...effects, { kind, target: target as Exclude<EffectTargetId, "ac">, grant: damageType.trim() }]);
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    if (kind === "multiply" && numeric <= 0) return;
    if (target === "ac" && (kind !== "modifier" || acContexts.length === 0)) return;
    const effect: Effect = kind === "modifier"
      ? target === "ac" ? { kind, target, value: numeric, bonusType: bonus, appliesTo: acContexts } : { kind, target: target as Exclude<EffectTargetId, "ac">, value: numeric, bonusType: bonus, ...(Object.keys(appliesWhen).length ? { appliesWhen } : {}) }
      : kind === "replaceBase" ? { kind, target: target as Exclude<EffectTargetId, "ac">, value: numeric }
      : kind === "multiply" ? { kind, target: target as Exclude<EffectTargetId, "ac">, factor: numeric }
      : kind === "minimum" ? { kind, target: target as Exclude<EffectTargetId, "ac">, value: numeric }
      : { kind, target: target as Exclude<EffectTargetId, "ac">, value: numeric };
    onChange([...effects, effect]);
  };
  return <section className="system-entry-effects" aria-label="Player-authored effects">
    <div className="system-effect-heading"><b>Player-authored effects</b><span>{effects.length ? `${effects.length} active rule${effects.length === 1 ? "" : "s"}` : "No effects added"}</span></div>
    {effects.length > 0 && <div className="system-effect-list">{effects.map((effect, index) => <span className="chip" key={index}>{describeEffect(effect)}<button aria-label={`Remove effect ${index + 1}`} onClick={() => onChange(effects.filter((_, item) => item !== index))}>×</button></span>)}</div>}
    <div className="system-effect-builder">
      <label><span>Effect</span><select aria-label="Authored effect type" value={kind} onChange={(event) => { const next = event.target.value as Effect["kind"]; setKind(next); setTarget(next === "damageDice" ? "damage.melee" : "attack.melee"); }}><option value="modifier">Numeric modifier</option><option value="replaceBase">Replace baseline</option><option value="multiply">Multiply</option><option value="minimum">Minimum</option><option value="maximum">Maximum</option><option value="grant">Grant capability</option><option value="criticalRange">Critical range</option><option value="damageDice">Additional damage dice</option></select></label>
      <label><span>Applies to</span><select aria-label="Authored effect target" value={target} onChange={(event) => setTarget(event.target.value as EffectTargetId)}>{availableTargets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      {kind === "damageDice" ? <><label><span>Dice</span><input aria-label="Effect damage dice" value={dice} onChange={(event) => setDice(event.target.value)} placeholder="1d6" /></label><label><span>Damage type</span><input aria-label="Effect damage type" value={damageType} onChange={(event) => setDamageType(event.target.value)} placeholder="bleed, fire…" /></label><label><span>Criticals</span><select aria-label="Effect critical behavior" value={criticalBehavior} onChange={(event) => setCriticalBehavior(event.target.value as typeof criticalBehavior)}><option value="normal">Multiply on critical</option><option value="notMultiplied">Do not multiply</option></select></label></> : kind === "criticalRange" ? <><label><span>Change</span><select aria-label="Critical range operation" value={criticalOperation} onChange={(event) => setCriticalOperation(event.target.value as typeof criticalOperation)}><option value="widen">Widen by N</option><option value="double">Double base threat range</option></select></label>{criticalOperation === "widen" && <label><span>Widen by</span><input aria-label="Critical range widening" type="number" min="1" step="1" value={value} onChange={(event) => setValue(event.target.value)} /></label>}</> : kind === "grant" ? <label><span>Capability</span><input aria-label="Granted capability" value={damageType} onChange={(event) => setDamageType(event.target.value)} placeholder="Capability name" /></label> : <><label><span>Value</span><input aria-label="Effect value" type="number" value={value} onChange={(event) => setValue(event.target.value)} /></label>{kind === "modifier" && <label><span>Bonus type</span><select aria-label="Effect bonus type" value={bonus} onChange={(event) => setBonus(event.target.value as BonusType)}>{bonusTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</>}
      <button className="button quiet" type="button" onClick={addEffect}>Add effect</button>
    </div>
    <details className="system-effect-advanced"><summary>Advanced applicability</summary><div className="system-effect-conditions">
      {kind === "modifier" && target === "ac" ? <label><span>Armor Class situations</span><select aria-label="Effect AC contexts" multiple value={acContexts} onChange={(event) => setAcContexts([...event.currentTarget.selectedOptions].map((option) => option.value as typeof acContexts[number]))}><option value="normal">Normal AC</option><option value="touch">Touch AC</option><option value="flatFooted">Flat-footed AC</option><option value="deniedDexterity">Denied Dexterity AC</option></select></label> : <>
        <label><span>Roll types</span><select aria-label="Effect roll kinds" multiple value={rollKinds} onChange={(event) => setRollKinds([...event.currentTarget.selectedOptions].map((option) => option.value as NonNullable<EffectApplicability["kinds"]>[number]))}>{["attack", "damage", "healing", "maneuver", "save", "skill", "initiative"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>Attack modes</span><select aria-label="Effect attack modes" multiple value={modes} onChange={(event) => setModes([...event.currentTarget.selectedOptions].map((option) => option.value as NonNullable<EffectApplicability["modes"]>[number]))}><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label>
        <label><span>Touch</span><select aria-label="Effect touch applicability" value={touch} onChange={(event) => setTouch(event.target.value as typeof touch)}><option value="any">Touch or non-touch</option><option value="touch">Touch only</option><option value="nonTouch">Non-touch only</option></select></label>
        <label><span>Attack action</span><select aria-label="Effect attack-action applicability" value={fullAttack} onChange={(event) => setFullAttack(event.target.value as typeof fullAttack)}><option value="any">Standard or full attack</option><option value="standard">Standard attack only</option><option value="full">Full attack only</option></select></label>
        <input aria-label="Effect required attack tags" value={requiredTags} onChange={(event) => setRequiredTags(event.target.value)} placeholder="Required attack tags, comma-separated" />
        <input aria-label="Effect excluded attack tags" value={excludedTags} onChange={(event) => setExcludedTags(event.target.value)} placeholder="Excluded attack tags, comma-separated" />
        <input aria-label="Effect maneuver IDs" value={maneuverIds} onChange={(event) => setManeuverIds(event.target.value)} placeholder="Maneuver IDs, comma-separated" />
        <input aria-label="Effect attack IDs" value={attackIds} onChange={(event) => setAttackIds(event.target.value)} placeholder="Specific attack IDs, comma-separated" />
        <input aria-label="Effect required flags" value={requiredFlags} onChange={(event) => setRequiredFlags(event.target.value)} placeholder="Required context flags, comma-separated" />
        <input aria-label="Effect excluded flags" value={excludedFlags} onChange={(event) => setExcludedFlags(event.target.value)} placeholder="Excluded context flags, comma-separated" />
      </>}
    </div></details>
  </section>;
}

function SphereSelectionEditor({ source, options, onChange }: { source: CharacterSystemSource; options: string[]; onChange(values: string[]): void }) {
  const [draft, setDraft] = useState("");
  const selected = source.sphereSelections ?? [];
  const add = () => {
    const value = draft.trim();
    if (!value || selected.some((item) => item.trim().toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US"))) return;
    onChange([...selected, options.find((item) => item.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US")) ?? value]);
    setDraft("");
  };
  return <div className="workbook-system-subsection sphere-selection-editor">
    <h4>Spheres selected</h4>
    <p className="muted">Each selected sphere adds one base talent, except Equipment for Spheres of Might.</p>
    <div className="catalog-add-row">
      <label className="field"><span>Sphere</span><input list={`sphere-selections-${slug(source.id)}`} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <datalist id={`sphere-selections-${slug(source.id)}`}>{options.map((option) => <option value={option} key={option} />)}</datalist>
      <button className="button quiet" type="button" disabled={!draft.trim()} onClick={add}>+ Add sphere</button>
    </div>
    <div className="inline-actions">{selected.map((value) => <span className="chip" key={value}>{value}<button type="button" aria-label={`Remove selected sphere ${value}`} onClick={() => onChange(selected.filter((item) => item !== value))}>×</button></span>)}</div>
  </div>;
}

export function WorkbookSystemsPanel({ sheet }: { sheet: CharacterSheet }) {
  const sources = sheet.character.systems ?? [];
  const [kind, setKind] = useState<CharacterSystemKind>(characterSystemKinds[0]);
  const [name, setName] = useState(systemNames[characterSystemKinds[0]]);
  const [ability, setAbility] = useState<(typeof abilities)[number]>("cha");
  const [classTemplateId, setClassTemplateId] = useState("");
  const [diceExpressions, setDiceExpressions] = useState<Record<string, string>>({});
  const [cursedTargets, setCursedTargets] = useState<Record<string, boolean>>({});
  const classTemplates = catalogValues(progressionCatalog).flatMap((definition) => (definition.characterSystemTemplates ?? []).map((template) => ({ ...template, progressionName: definition.name })));
  const negativeLevelCount = sheet.character.features.filter((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.negative-levels").reduce((total, feature) => total + (feature.stackCount ?? 1), 0);
  const addSystem = () => {
    const id = nextId(slug(name) || kind, sources.map((source) => source.id));
    const progressionId = sheet.character.advancementSlots?.flatMap((slot) => slot.tracks.map((track) => track.entry.progressionId))[0];
    const source: CharacterSystemSource = {
      id, kind, name: name.trim() || systemNames[kind], keyAbility: ability,
      ...(progressionId ? { progressionId } : {}), resourceName: systemResources[kind],
      resourceSpent: 0, progression: [], entries: [],
    };
    if (sheet.update({ systems: [...sources, source] }, `Added ${source.name}`)) setName(systemNames[kind]);
  };
  const addClassSystem = () => {
    const template = classTemplates.find((item) => item.id === classTemplateId);
    if (!template) return;
    if (sources.some((source) => source.id === template.id)) return sheet.fail(`${template.name} system is already on this character.`);
    const source: CharacterSystemSource = { id: template.id, kind: template.kind, name: template.name, progressionId: template.progressionId, keyAbility: template.keyAbility, resourceName: template.resourceName, resourceSpent: 0, progression: template.progression, entries: [], notes: `Imported from ${template.source?.document ?? "workbook class chart"}.` };
    if (sheet.update({ systems: [...sources, source] }, `Added ${template.progressionName} ${systemNames[template.kind]}`)) setClassTemplateId("");
  };
  const derived = deriveCharacterSystems(
    sources,
    Object.fromEntries(abilities.map((id) => [id, sheet.derived.abilities[id].modifier.value])),
    Object.fromEntries(Object.entries(sheet.derived.advancement?.progressionLevels ?? {}).map(([id, value]) => [id, value.value])),
    sheet.derived.bab.value,
    sheet.character.advancementSlots?.length ?? sheet.character.hitDiceCount ?? 0,
    negativeLevelCount + (sheet.character.workbookOptions?.woundThresholds ? Math.abs(unchainedWoundPenalty(sheet.derived.currentHp, sheet.derived.maxHp.value)) : 0),
    negativeLevelCount,
  );
  const update = (id: string, patch: Partial<CharacterSystemSource>) => sheet.update({ systems: sources.map((source) => source.id === id ? { ...source, ...patch } : source) });
  const commitEntryUse = (source: CharacterSystemSource, patch: Partial<CharacterSystemSource>, actionCost?: CharacterSystemEntry["actionCost"], skipAction = false) => {
    const currentActions = sheet.character.turnActions ?? {};
    const restrictions = sheet.engine.actionRestrictions();
    const physicalEntry = source.kind === "maneuvers";
    if (physicalEntry && restrictions.includes("noPhysicalActions")) return sheet.fail("This condition prevents physical actions.");
    const action = resolveTurnAction(currentActions, skipAction ? undefined : actionCost, restrictions);
    if (action.error) return sheet.fail(action.error);
    return sheet.update({
      systems: sources.map((candidate) => candidate.id === source.id ? { ...source, ...patch } : candidate),
      ...(action.state !== currentActions ? { turnActions: action.state } : {}),
    });
  };
  const setEntryActive = (source: CharacterSystemSource, entryId: string, active: boolean) => {
    const selected = source.entries.find((entry) => entry.id === entryId);
    if (!selected) return;
    const isStance = source.kind === "maneuvers" && isStanceEntry(selected);
    if (active && source.kind === "maneuvers" && sheet.engine.actionRestrictions().includes("noPhysicalActions")) return sheet.fail("This condition prevents physical actions.");
    if (active && selected.known === false) return sheet.fail(`${selected.name} is not known.`);
    const currentActions = sheet.character.turnActions ?? {};
    const action = active ? resolveTurnAction(currentActions, selected.actionCost, sheet.engine.actionRestrictions()) : { state: currentActions };
    if (action.error) return sheet.fail(action.error);
    sheet.update({ systems: sources.map((candidate) => ({
      ...candidate,
      entries: candidate.entries.map((entry) => {
        const chosen = candidate.id === source.id && entry.id === entryId;
        const otherStance = isStance && active && candidate.kind === "maneuvers" && isStanceEntry(entry);
        if (chosen) return { ...entry, active, ...(isStance ? { expended: false } : active ? { expended: true } : {}), ...(!active ? { roundsRemaining: undefined } : {}) };
        return otherStance ? { ...entry, active: false, expended: false, roundsRemaining: undefined } : entry;
      }),
    })) , ...(action.state !== currentActions ? { turnActions: action.state } : {}) });
  };
  const useEntry = async (source: CharacterSystemSource, entry: CharacterSystemSource["entries"][number], current: ReturnType<typeof deriveCharacterSystems>[number]) => {
    const pendingDice = diceExpressions[entry.id];
    if (pendingDice && !/^\d+d\d+$/i.test(pendingDice.trim())) return sheet.fail(`Enter dice for ${entry.name} as 1d6 or 2d8.`);
    if (sheet.engine.actionRestrictions().includes("noPhysicalActions") && (source.kind === "maneuvers" || entry.roll?.kind === "weaponAttack" || entry.roll?.kind === "combatManeuver")) return sheet.fail("This condition prevents physical actions.");
    if (entry.known === false) return sheet.fail(`${entry.name} is not known.`);
    if (source.progression.length && entry.tier !== undefined && entry.tier > current.maximumTier) return sheet.fail(`${entry.name} exceeds the current maximum tier ${current.maximumTier}.`);
    const isStance = source.kind === "maneuvers" && isStanceEntry(entry);
    if (source.kind === "maneuvers" && !isStance && !entry.readied) return sheet.fail(`${entry.name} is not readied.`);
    if (isStance && !entry.active) return sheet.fail(`Activate ${entry.name} before using it.`);
    if (entry.roll?.kind === "skillCheck") {
      if (isStance && !entry.active) return sheet.fail(`Activate ${entry.name} before using its skill check.`);
      if (entry.expended && !(isStance && entry.active)) return sheet.fail(`${entry.name} is expended; restore it before using it again.`);
      if (!sheet.derived.skills[entry.roll.skillId]) return sheet.fail(`Choose a skill available on this character for ${entry.name}.`);
      if (entry.usesPerDay !== undefined && (entry.usesSpent ?? 0) >= entry.usesPerDay) return sheet.fail(`${entry.name} has no daily uses remaining.`);
      const cost = entry.resourceCost ?? 0;
      if (current.resourceRemaining !== undefined && cost > current.resourceRemaining) return sheet.fail(`Not enough ${source.resourceName || "resource"} to use ${entry.name}.`);
      const usesSpent = entry.usesPerDay === undefined ? entry.usesSpent ?? 0 : (entry.usesSpent ?? 0) + 1;
      const expended = source.kind === "maneuvers" && !isStance || entry.usesPerDay !== undefined && usesSpent >= entry.usesPerDay;
      if (!commitEntryUse(source, { resourceSpent: (source.resourceSpent ?? 0) + cost, entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent, ...(expended ? { expended: true } : {}) } : item) }, entry.actionCost, isStance && entry.active)) return;
      sheet.rollSkill(entry.roll.skillId, undefined, entry.roll.flags ?? [], { systemId: source.id, entryId: entry.id });
      return;
    }
    const weaponAttackId = entry.roll?.kind === "weaponAttack" ? entry.roll.attackId : undefined;
    if (weaponAttackId && !sheet.character.attacks.some((attack) => attack.id === weaponAttackId)) return sheet.fail(`Choose a valid weapon attack for ${entry.name}.`);
    if ((entry.roll?.kind === "damage" || entry.roll?.kind === "healing") && entry.roll.perCasterLevel && current.casterLevel < 1) return sheet.fail(`${entry.name} requires a caster level of at least 1.`);
    if (entry.usesPerDay !== undefined && (entry.usesSpent ?? 0) >= entry.usesPerDay) return sheet.fail(`${entry.name} has no daily uses remaining.`);
    const cost = entry.resourceCost ?? 0;
    if (current.resourceRemaining !== undefined && cost > current.resourceRemaining) return sheet.fail(`Not enough ${source.resourceName || "resource"} to use ${entry.name}.`);
      const usesSpent = isStance && entry.usesPerDay === undefined ? entry.usesSpent ?? 0 : (entry.usesSpent ?? 0) + 1;
      const expended = isStance ? false : entry.usesPerDay === undefined || usesSpent >= entry.usesPerDay;
      if (!commitEntryUse(source, { resourceSpent: (source.resourceSpent ?? 0) + cost, entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent, expended } : item) }, entry.actionCost, isStance && entry.active || Boolean(entry.active))) return;
    if (entry.roll?.kind === "combatManeuver") {
      sheet.rollManeuver(entry.roll.maneuver, entry.roll.abilityOverride, entry.roll.babProgressionId, { systemId: source.id, entryId: entry.id });
      return;
    }
    if (weaponAttackId) {
      const attack = sheet.character.attacks.find((item) => item.id === weaponAttackId)!;
      const weaponRoll = entry.roll?.kind === "weaponAttack" ? entry.roll : undefined;
      const targetCursed = cursedTargets[entry.id] ?? (sheet.linkedTargetCharacter?.activeConditions ?? []).some((condition) => slug(condition) === "cursed");
      const bonusDamage = weaponRoll?.bonusDamageVsCursed && targetCursed
        ? weaponRoll.bonusDamageVsCursed
        : weaponRoll?.bonusDamage;
      sheet.rollWeaponStrike(attack.id, `${entry.name}${entry.actionCost ? ` (${entry.actionCost === "fullRound" ? "full-round" : entry.actionCost} action)` : ""} · ${attack.name}`, bonusDamage ? {
        dice: bonusDamage,
        label: `${entry.name} bonus damage`,
        sourceId: `system.${source.id}.${entry.id}.${usesSpent}`,
      } : undefined, {
        repeatCount: entry.roll?.kind === "weaponAttack" ? entry.roll.repeatCount ?? 1 : 1,
        ...(source.kind === "maneuvers" ? { maneuverId: slug(entry.name) || undefined } : {}),
        ...(targetCursed ? { flags: ["target-cursed"] } : {}),
        systemId: source.id,
        systemEntryId: entry.id,
      });
      return;
    }
    if (entry.roll?.kind === "damage" || entry.roll?.kind === "healing") {
      const count = entry.roll.perCasterLevel ? Math.floor(Math.min(current.casterLevel, entry.roll.casterLevelCap ?? Infinity)) * entry.roll.dice.count : entry.roll.dice.count;
      const modifier = entry.roll.kind === "healing" ? entry.roll.flatBonus ?? 0 : 0;
      const damageType = entry.roll.kind === "damage" ? entry.roll.damageType ?? "untyped" : undefined;
      const context = { kind: entry.roll.kind, actorCharacterId: sheet.character.id, action: { kind: "other" as const }, ...(source.kind === "maneuvers" ? { maneuver: slug(entry.name) } : {}), ...(entry.roll.kind === "damage" ? { mode: entry.roll.damageMode ?? "melee" as const } : {}) };
      const rollEngine = sheet.engineForSystemEntry(source.id, entry.id);
      const damageTarget = entry.roll.kind === "damage" ? `damage.${context.mode ?? "melee"}` as const : undefined;
      const damageModifiers = damageTarget ? rollEngine.directModifiers(damageTarget, { context, reportExclusions: true }) : undefined;
      const damageEffects = damageTarget ? rollEngine.effects.filter((effect): effect is Extract<Effect, { kind: "damageDice" }> => effect.kind === "damageDice" && effect.target === damageTarget) : [];
      const applicableDamage = damageEffects.flatMap((effect) => applicabilityOf(effect, { context }).applies ? [{ kind: "dice" as const, dice: effect.dice, label: effect.label ?? effect.source?.label ?? effect.damageType ?? "Additional damage", source: effect.source ?? { id: `system.${source.id}.${entry.id}`, label: entry.name }, ...(effect.damageType ? { damageType: effect.damageType } : {}), criticalBehavior: effect.criticalBehavior ?? (effect.damageType?.toLowerCase() === "precision" ? "notMultiplied" as const : "normal" as const), multiplier: 1 }] : []);
      const excludedDamage = damageEffects.flatMap((effect) => { const applicability = applicabilityOf(effect, { context }); return applicability.applies ? [] : [{ dice: effect.dice, label: effect.label ?? effect.source?.label ?? effect.damageType ?? "Additional damage", source: effect.source ?? { id: `system.${source.id}.${entry.id}`, label: entry.name }, ...(effect.damageType ? { damageType: effect.damageType } : {}), reason: applicability.reason ?? "not applicable", rollContext: context }]; });
      const baseDamageTerm = damageType ? [{ kind: "dice" as const, dice: { sides: entry.roll.dice.sides, count: Math.max(1, count) }, label: entry.name, source: { id: `system.${source.id}.${entry.id}`, label: entry.name }, damageType, criticalBehavior: "notMultiplied" as const, multiplier: 1 }] : [];
      const effectModifier = damageModifiers?.applied.reduce((total, contribution) => total + contribution.value, 0) ?? 0;
      const plan: RollPlan = {
        id: `system:${sheet.character.id}:${source.id}:${entry.id}:${usesSpent}`, characterId: sheet.character.id,
        label: `${entry.name}${damageType ? ` (${damageType})` : " healing"}`, dice: [{ sides: entry.roll.dice.sides, count: Math.max(1, count) }], modifier: modifier + effectModifier,
        context, outcomePolicy: plainOutcomePolicy,
        provenance: { modifier: [...(modifier ? [sourceContribution("hp", modifier, `system.${source.id}.${entry.id}.roll`, `${entry.name} healing bonus`)] : []), ...(damageModifiers?.applied ?? [])], excluded: damageModifiers?.excluded ?? [], ...(damageType ? { damageTerms: [...baseDamageTerm, ...applicableDamage], ...(excludedDamage.length ? { excludedDamageTerms: excludedDamage } : {}) } : {}) },
      };
      await sheet.rollPlan(plan);
    }
  };
  const restoreEntry = (source: CharacterSystemSource, entry: CharacterSystemSource["entries"][number]) => update(source.id, { resourceSpent: Math.max(0, (source.resourceSpent ?? 0) - (entry.resourceCost ?? 0)), entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent: Math.max(0, (item.usesSpent ?? 0) - 1), expended: false, ...(item.effects?.length && !(source.kind === "maneuvers" && isStanceEntry(item)) ? { active: false } : {}) } : item) });
  const restoreAll = (source: CharacterSystemSource) => update(source.id, { resourceSpent: 0, entries: source.entries.map((entry) => ({ ...entry, usesSpent: 0, expended: false, ...(entry.effects?.length ? { active: false } : {}) })) });
  const entryAction = (source: CharacterSystemSource, entry: CharacterSystemEntry, current: ReturnType<typeof deriveCharacterSystems>[number]) => {
    const isStance = source.kind === "maneuvers" && isStanceEntry(entry);
    if (isStance && !entry.roll) return null;
    const disabled = Boolean(entry.expended && !entry.active) || source.kind === "maneuvers" && (isStance ? !entry.active : !entry.readied) || entry.usesPerDay !== undefined && (entry.usesSpent ?? 0) >= entry.usesPerDay;
    const label = entry.roll?.kind === "combatManeuver" ? `Attempt ${entry.roll.maneuver} vs CMD`
      : entry.roll?.kind === "skillCheck" ? `Roll ${entry.roll.skillId}`
      : entry.roll?.kind === "weaponAttack" ? "Use attack"
      : entry.roll?.kind === "damage" || entry.roll?.kind === "healing" ? "Roll effect"
      : "Use";
    return <button className="button primary" disabled={disabled} onClick={() => void useEntry(source, entry, current)}>{label}</button>;
  };
  return <section className="panel workbook-systems-panel">
    <div className="panel-heading"><div><span className="eyebrow">AUTOSHEET · ADDITIONAL SYSTEMS</span><h2>Maneuvers & specialized magic</h2></div><span className="helper">Character-owned charts and selections</span></div>
    <p className="muted">Class level follows the linked advancement track. Each system’s source chart is stored with this character so level, caster level, resource capacity, maximum tier, and save DCs can be recalculated together.</p>
    <details className="system-add-controls"><summary>Add or link another rules system</summary><div className="system-add-fields"><div className="catalog-add-row">
      <select aria-label="Additional rules system" value={kind} onChange={(event) => { const next = event.target.value as CharacterSystemKind; setKind(next); setName(systemNames[next]); }}>
        {characterSystemKinds.map((entry) => <option key={entry} value={entry}>{systemNames[entry]}</option>)}
      </select>
      <input aria-label="System source name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Class or source" />
      <select aria-label="System key ability" value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}>{abilities.map((entry) => <option key={entry} value={entry}>{abilityLabels[entry]}</option>)}</select>
      <button className="button quiet" onClick={addSystem}>+ Add system</button>
    </div>
    {classTemplates.length > 0 && <div className="catalog-add-row"><select aria-label="Workbook class system chart" value={classTemplateId} onChange={(event) => setClassTemplateId(event.target.value)}><option value="">Choose a workbook class chart…</option>{classTemplates.map((template) => <option key={template.id} value={template.id}>{template.progressionName} · {systemNames[template.kind]}</option>)}</select><button className="button quiet" disabled={!classTemplateId} onClick={addClassSystem}>Add class chart</button></div>}</div></details>
    {sources.map((source) => {
      const current = derived.find((item: { id: string }) => item.id === source.id)!;
      const categoryOptions = source.kind === "spheresOfPower" ? autosheetSphereCategoryCatalog.spheresOfPower : source.kind === "spheresOfMight" ? autosheetSphereCategoryCatalog.spheresOfMight : [];
      const categoryListId = `autosheet-sphere-categories-${slug(source.id)}`;
      return <article className="workbook-system-card" key={source.id}>
        <div className="panel-heading"><div><span className="eyebrow">{systemNames[source.kind]}</span><h3>{source.name}</h3></div><div className="inline-actions"><button className="button quiet" onClick={() => restoreAll(source)}>Restore all uses</button><button className="table-action" aria-label={`Remove ${source.name}`} onClick={() => sheet.update({ systems: sources.filter((item) => item.id !== source.id) })}>Remove</button></div></div>
        <details className="system-source-edit"><summary>Edit system & progression</summary>
        <div className="form-grid system-source-fields">
          <Field label="Source name" value={source.name} onChange={(value) => update(source.id, { name: value || source.name })} />
          <label className="field"><span>Linked progression</span><select value={source.progressionId ?? ""} onChange={(event) => update(source.id, { progressionId: event.target.value || undefined })}><option value="">Use manual level</option>{catalogValues(progressionCatalog).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          <Field label="Manual level (when unlinked)" type="number" value={source.level === undefined ? "" : Math.min(20, source.level)} onChange={(value) => update(source.id, { level: value === "" ? undefined : Math.min(20, Math.max(0, Number(value) || 0)) })} />
          <Field label="Class level adjustment" type="number" value={source.classLevelAdjustment ?? 0} onChange={(value) => update(source.id, { classLevelAdjustment: Number(value) || 0 })} />
          <label className="field"><span>Key ability</span><select value={source.keyAbility} onChange={(event) => update(source.id, { keyAbility: event.target.value as typeof source.keyAbility })}>{abilities.map((entry) => <option key={entry} value={entry}>{abilityLabels[entry]}</option>)}</select></label>
          <Field label="Caster / initiator level adjustment" type="number" value={source.casterLevelBonus ?? 0} onChange={(value) => update(source.id, { casterLevelBonus: Number(value) || 0 })} />
          {source.kind === "spheresOfMight" && <Field label="Effective BAB adjustment" type="number" value={source.effectiveBabBonus ?? 0} onChange={(value) => update(source.id, { effectiveBabBonus: Number(value) || 0 })} />}
          <Field label="Save DC adjustment" type="number" value={source.dcAdjustment ?? 0} onChange={(value) => update(source.id, { dcAdjustment: Number(value) || 0 })} />
          <Field label="Resource name" value={source.resourceName ?? ""} onChange={(value) => update(source.id, { resourceName: value })} />
          <Field label="Resource spent" type="number" value={source.resourceSpent ?? 0} onChange={(value) => update(source.id, { resourceSpent: Math.max(0, Number(value) || 0) })} />
          <Field label="Resource maximum adjustment" type="number" value={source.resourceMaximumBonus ?? 0} onChange={(value) => update(source.id, { resourceMaximumBonus: Number(value) || 0 })} />
          {source.kind === "veilweaving" && <Field label="Essence capacity adjustment" type="number" value={source.essenceCapacityBonus ?? 0} onChange={(value) => update(source.id, { essenceCapacityBonus: Number(value) || 0 })} />}
          {categoryOptions.length > 0 && <SphereSelectionEditor source={source} options={categoryOptions.map((item) => item.name)} onChange={(sphereSelections) => update(source.id, { sphereSelections })} />}
        </div>
        <div className="system-derived-summary"><b>Level {current.level}</b><span>Caster / initiator level {current.casterLevel}</span><span>Maximum tier {current.maximumTier}</span>{current.essenceCapacity !== undefined && <span>Essence capacity {current.essenceCapacity} per receptacle</span>}{current.knownCount !== undefined && <span>Known {current.knownCount}</span>}{current.knownByTier && <span>Known by tier {Object.entries(current.knownByTier).map(([tier, count]) => `${tier}:${count}`).join(" · ")}</span>}{current.talentCount !== undefined && <span>Talents {current.talentCount}</span>}{current.saveDc && (current.maximumTier > 0 || source.kind === "spheresOfPower" || source.kind === "spheresOfMight") && <span>Save DC {current.saveDc(current.maximumTier)}</span>}</div>
        {source.kind === "veilweaving" && <div className="workbook-system-subsection"><h4>Non-veil receptacles</h4><div className="inline-actions">{veilChakras.map((chakra) => { const checked = source.nonVeilReceptacles?.includes(chakra) ?? false; return <label className="system-entry-toggle" key={chakra}><input type="checkbox" checked={checked} onChange={() => update(source.id, { nonVeilReceptacles: checked ? (source.nonVeilReceptacles ?? []).filter((value) => value !== chakra) : [...(source.nonVeilReceptacles ?? []), chakra] })} />{chakra.charAt(0).toUpperCase() + chakra.slice(1)}</label>; })}</div></div>}
        <div className="workbook-system-subsection"><div className="subsection-heading"><h4>Level progression chart</h4><button className="button quiet" onClick={() => update(source.id, { progression: [...source.progression, { level: Math.max(1, current.level || source.progression.length + 1), casterLevel: Math.max(0, current.level || source.progression.length + 1), maximumTier: 0, resourceMaximum: 0 }] })}>+ Add row</button></div>
          {!source.progression.length && <p className="muted">No table row yet. Without a row, level supplies caster level and no tier or resource cap is assumed.</p>}
          {source.progression.map((row, index) => <div className="system-progression-row" key={`${row.level}-${index}`}>
            <Field label="Level" type="number" value={row.level} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, level: Math.max(1, Number(value) || 1) } : entry) })} />
            <Field label="Caster / initiator level" type="number" value={row.casterLevel} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, casterLevel: Math.max(0, Number(value) || 0) } : entry) })} />
            <Field label="Maximum tier" type="number" value={row.maximumTier} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, maximumTier: Math.max(0, Number(value) || 0) } : entry) })} />
            <Field label="Resource maximum" type="number" value={row.resourceMaximum ?? ""} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, resourceMaximum: value === "" ? undefined : Math.max(0, Number(value) || 0) } : entry) })} />
            <Field label="Known" type="number" value={row.knownCount ?? ""} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, knownCount: value === "" ? undefined : Math.max(0, Number(value) || 0) } : entry) })} />
            <Field label="Talents" type="number" value={row.talentCount ?? ""} onChange={(value) => update(source.id, { progression: source.progression.map((entry, at) => at === index ? { ...entry, talentCount: value === "" ? undefined : Math.max(0, Number(value) || 0) } : entry) })} />
            <button className="table-action" aria-label={`Remove level ${row.level} row`} onClick={() => update(source.id, { progression: source.progression.filter((_, at) => at !== index) })}>×</button>
          </div>)}
        </div>
        </details>
        <div className="workbook-system-subsection system-entry-list"><div className="subsection-heading"><h4>Ready to play</h4><div className="inline-actions">{current.resourceMaximum !== undefined && <div className="system-resource-tracker" aria-label={`${source.resourceName || "Resource"} usage tracker`}><div className="system-resource-tracker-count"><b>{source.resourceName || "Resource"}</b><strong>{current.resourceRemaining}<span> / {current.resourceMaximum}</span></strong><small>remaining{current.resourceInvested ? ` · ${current.resourceInvested} invested` : ""}{current.resourceBonus ? ` · includes +${current.resourceBonus} ability bonus` : ""}</small></div><div className="system-resource-tracker-actions"><button className="table-action" aria-label={`Spend one ${source.resourceName || "resource"}`} disabled={(current.resourceRemaining ?? 0) <= 0} onClick={() => update(source.id, { resourceSpent: Math.min(current.resourceMaximum!, (source.resourceSpent ?? 0) + 1) })}>Spend 1</button><button className="table-action" aria-label={`Restore one ${source.resourceName || "resource"}`} disabled={(source.resourceSpent ?? 0) <= 0} onClick={() => update(source.id, { resourceSpent: Math.max(0, (source.resourceSpent ?? 0) - 1) })}>Restore 1</button><button className="table-action" aria-label={`Refresh ${source.resourceName || "resource"}`} disabled={(source.resourceSpent ?? 0) <= 0} onClick={() => update(source.id, { resourceSpent: 0 })}>Refresh</button></div></div>}<button className="button quiet" onClick={() => update(source.id, { entries: [...source.entries, { id: nextId(`${source.id}-entry`, source.entries.map((entry) => entry.id)), name: "New entry", ...(source.kind === "maneuvers" ? { entryType: "maneuver" as const } : {}), known: true }] })}>+ Add entry</button></div></div>
          {source.kind === "maneuvers" && <p className="muted">These are authored on this character. Add, edit, or remove the maneuvers and stances used by your player.</p>}
          {source.entries.map((entry) => { const isStance = source.kind === "maneuvers" && isStanceEntry(entry); return <article className="system-entry-card" key={entry.id}>
            <div className="system-entry-play">
              <div className="system-entry-title"><b>{entry.name}</b><span>{[isStance ? "Stance" : entry.category || (source.kind === "maneuvers" ? "Maneuver" : "Entry"), entry.actionCost ? entry.actionCost === "fullRound" ? "Full round" : entry.actionCost : "Action cost unset", entry.tier !== undefined ? `Tier ${entry.tier}` : ""].filter(Boolean).join(" · ")}</span></div>
              <div className="system-entry-state">
                <label className="system-entry-toggle"><input type="checkbox" checked={entry.known !== false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, known: event.target.checked, ...(event.target.checked ? {} : { active: false, roundsRemaining: undefined }) } : item) })} /> Known</label>
                <label className="system-entry-toggle"><input type="checkbox" checked={entry.readied ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, readied: event.target.checked } : item) })} /> Readied</label>
                {(entry.effects?.length || isStance) && <label className="system-entry-toggle"><input type="checkbox" checked={entry.active ?? false} disabled={(entry.known === false && !entry.active) || (!isStance && source.kind === "maneuvers" && !entry.readied && !entry.active)} onChange={(event) => isStance ? setEntryActive(source, entry.id, event.target.checked) : update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, active: event.target.checked, ...(event.target.checked ? { expended: true } : { roundsRemaining: undefined }) } : item) })} />{isStance ? "Active stance" : "Active effect"}</label>}
              </div>
              <div className="system-entry-use">{entry.usesPerDay !== undefined && <span className="helper">{Math.max(0, entry.usesPerDay - (entry.usesSpent ?? 0))}/{entry.usesPerDay} uses left</span>}{entry.resourceCost ? <span className="helper">Cost {entry.resourceCost}</span> : null}{entryAction(source, entry, current)}{(entry.usesSpent ?? 0) > 0 && <button className="table-action" aria-label={`Restore one use of ${entry.name}`} onClick={() => restoreEntry(source, entry)}>Restore</button>}</div>
            </div>
            <details className="system-entry-edit"><summary>Edit {entry.name}</summary><div className="system-entry-row">
            <Field label="Name" value={entry.name} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, name: value || item.name } : item) })} />
            {source.kind === "maneuvers" && <label className="field"><span>Entry type</span><select aria-label={`${entry.name} entry type`} value={isStance ? "stance" : "maneuver"} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, entryType: event.target.value as "maneuver" | "stance" } : item) })}><option value="maneuver">Maneuver</option><option value="stance">Stance</option></select></label>}<label className="field"><span>Category</span><input list={categoryOptions.length ? categoryListId : undefined} value={entry.category ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, category: event.target.value } : item) })} />{categoryOptions.length > 0 && <datalist id={categoryListId}>{categoryOptions.map((category) => <option value={category.name} key={category.name} />)}</datalist>}</label>
            <label className="field"><span>Action cost</span><select aria-label={`${entry.name} action cost`} value={entry.actionCost ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, actionCost: event.target.value ? event.target.value as NonNullable<typeof item.actionCost> : undefined } : item) })}><option value="">Unspecified</option><option value="standard">Standard</option><option value="move">Move</option><option value="swift">Swift</option><option value="immediate">Immediate</option><option value="fullRound">Full round</option><option value="free">Free</option></select></label>
            {source.kind === "veilweaving" && <><label className="field"><span>Chakra</span><select aria-label={`${entry.name} chakra`} value={entry.chakra ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, chakra: event.target.value ? event.target.value as VeilChakra : undefined } : item) })}><option value="">Unassigned</option>{veilChakras.map((chakra) => <option key={chakra} value={chakra}>{chakra.charAt(0).toUpperCase() + chakra.slice(1)}</option>)}</select></label><Field label="Essence invested" type="number" value={entry.essenceInvested ?? 0} onChange={(value) => { const available = Math.max(0, (current.resourceRemaining ?? 0) + (entry.essenceInvested ?? 0)); const receptacleLimit = Math.max(0, current.essenceCapacity ?? Infinity); const amount = Math.min(available, receptacleLimit, Math.max(0, Math.floor(Number(value) || 0))); update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, essenceInvested: amount } : item) }); }} /></>}
            <Field label="Tier" type="number" value={entry.tier ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, tier: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            {(["spheresOfPower", "spheresOfMight"].includes(source.kind)) && <Field label="Talent ranks" type="number" value={entry.ranks ?? autosheetTalentRanks(entry.name)} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, ranks: Math.max(0, Number(value) || 0) } : item) })} />}
            {current.saveDc && entry.tier !== undefined && <span className="helper">Save DC {current.saveDc(entry.tier)}</span>}
            {entry.actionCost && <span className="helper">Action: {entry.actionCost === "fullRound" ? "full round" : entry.actionCost}</span>}
            <label className="field"><span>Roll effect</span><select aria-label={`${entry.name} roll effect`} value={entry.roll?.kind ?? ""} onChange={(event) => {
              const selected = event.target.value;
              if (selected === "weaponAttack") { const attackId = sheet.character.attacks[0]?.id; if (!attackId) return sheet.fail("Add a weapon attack before linking it to this maneuver."); update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll: { kind: "weaponAttack", attackId } } : item) }); return; }
              if (selected === "skillCheck") { update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll: { kind: "skillCheck", skillId: "intimidate", flags: ["demoralize"] } } : item) }); return; }
              if (selected === "combatManeuver") { update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll: { kind: "combatManeuver", maneuver: slug(item.name) || "custom-maneuver" } } : item) }); return; }
              const priorDice = entry.roll && (entry.roll.kind === "damage" || entry.roll.kind === "healing") ? entry.roll.dice : { count: 1, sides: 6 };
              const priorType = entry.roll && (entry.roll.kind === "damage" || entry.roll.kind === "healing") && entry.roll.kind === "damage" ? entry.roll.damageType ?? "untyped" : "untyped";
              const roll = selected === "damage" || selected === "healing" ? { kind: selected, dice: priorDice, ...(selected === "damage" ? { damageType: priorType } : {}) } as const : undefined;
              setDiceExpressions((values) => ({ ...values, [entry.id]: roll ? `${roll.dice.count}d${roll.dice.sides}` : "" }));
              update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll } : item) });
            }}><option value="">No roll</option><option value="weaponAttack">Weapon attack</option><option value="skillCheck">Skill check</option>{source.kind === "maneuvers" && <option value="combatManeuver">Combat maneuver vs CMD</option>}<option value="damage">Damage</option><option value="healing">Healing</option></select></label>
            {entry.roll?.kind === "combatManeuver" && <><Field label="CMB maneuver slug" value={entry.roll.maneuver} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "combatManeuver" ? { ...item, roll: { ...item.roll, maneuver: slug(value) || "custom-maneuver" } } : item) })} /><label className="field"><span>CMB ability override</span><select aria-label={`${entry.name} CMB ability override`} value={entry.roll.abilityOverride ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "combatManeuver" ? { ...item, roll: { ...item.roll, abilityOverride: event.target.value ? event.target.value as typeof abilities[number] : undefined } } : item) })}><option value="">Standard CMB ability</option>{abilities.map((id) => <option key={id} value={id}>{abilityLabels[id]}</option>)}</select></label><label className="field"><span>CMB class progression</span><select aria-label={`${entry.name} CMB class progression`} value={entry.roll.babProgressionId ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "combatManeuver" ? { ...item, roll: { ...item.roll, babProgressionId: event.target.value || undefined } } : item) })}><option value="">Character BAB</option>{[...new Set((sheet.character.advancementSlots ?? []).flatMap((slot) => slot.tracks.map((track) => track.entry.progressionId)))].map((id) => <option value={id} key={id}>{catalogValues(progressionCatalog).find((definition) => definition.id === id)?.name ?? id}</option>)}</select></label></>}
            {entry.roll?.kind === "skillCheck" && <><label className="field"><span>Skill</span><select aria-label={`${entry.name} skill`} value={entry.roll.skillId} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "skillCheck" ? { ...item, roll: { ...item.roll, skillId: event.target.value } } : item) })}>{Object.keys(sheet.derived.skills).map((skillId) => <option value={skillId} key={skillId}>{skillId}</option>)}</select></label><Field label="Context flags (comma-separated)" value={(entry.roll.flags ?? []).join(", ")} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "skillCheck" ? { ...item, roll: { ...item.roll, flags: value.split(",").map((flag) => flag.trim()).filter(Boolean) } } : item) })} /></>}
            {entry.roll?.kind === "weaponAttack" && <><label className="field"><span>Weapon profile</span><select aria-label={`${entry.name} weapon profile`} value={entry.roll.attackId} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll: { ...entry.roll!, kind: "weaponAttack", attackId: event.target.value } } : item) })}>{sheet.character.attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</select></label><Field label="Strike count" type="number" value={entry.roll.repeatCount ?? 1} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "weaponAttack" ? { ...item, roll: { ...item.roll, repeatCount: Math.max(1, Math.min(20, Math.floor(Number(value) || 1))) } } : item) })} /><label className="field"><span>Bonus damage dice</span><input aria-label={`${entry.name} bonus damage dice`} value={diceExpressions[`${entry.id}:bonus`] ?? (entry.roll.bonusDamage ? `${entry.roll.bonusDamage.count}d${entry.roll.bonusDamage.sides}` : "")} placeholder="e.g. 1d6" onChange={(event) => { const value = event.target.value; setDiceExpressions((values) => ({ ...values, [`${entry.id}:bonus`]: value })); const match = /^(\d+)d(\d+)$/i.exec(value.trim()); if (match) update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "weaponAttack" ? { ...item, roll: { ...item.roll, bonusDamage: { count: Number(match[1]), sides: Number(match[2]) } } } : item) }); else if (!value.trim()) update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "weaponAttack" ? { ...item, roll: { ...item.roll, bonusDamage: undefined } } : item) }); }} /></label>{entry.roll.bonusDamageVsCursed && <label className="system-entry-toggle"><input type="checkbox" checked={cursedTargets[entry.id] ?? (sheet.linkedTargetCharacter?.activeConditions ?? []).some((condition) => slug(condition) === "cursed")} disabled={(sheet.linkedTargetCharacter?.activeConditions ?? []).some((condition) => slug(condition) === "cursed")} onChange={(event) => setCursedTargets((values) => ({ ...values, [entry.id]: event.target.checked }))} /> Target is cursed (+{entry.roll.bonusDamageVsCursed.count}d{entry.roll.bonusDamageVsCursed.sides})</label>}</>}
            {entry.roll && (entry.roll.kind === "damage" || entry.roll.kind === "healing") && <><label className="field"><span>Dice{entry.roll.perCasterLevel ? ` per caster level (CL ${current.casterLevel})` : ""}</span><input aria-label={`${entry.name} roll dice`} value={diceExpressions[entry.id] ?? `${entry.roll.dice.count}d${entry.roll.dice.sides}`} onChange={(event) => { const value = event.target.value; setDiceExpressions((values) => ({ ...values, [entry.id]: value })); const match = /^(\d+)d(\d+)$/i.exec(value.trim()); if (match) update(source.id, { entries: source.entries.map((item) => item.id === entry.id && (item.roll?.kind === "damage" || item.roll?.kind === "healing") ? { ...item, roll: { ...item.roll, dice: { count: Number(match[1]), sides: Number(match[2]) } } } : item) }); }} /></label>{entry.roll.kind === "damage" ? <><Field label="Damage type" value={entry.roll.damageType ?? "untyped"} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "damage" ? { ...item, roll: { ...item.roll, damageType: value || "untyped" } } : item) })} /><label className="field"><span>Damage mode for effects</span><select aria-label={`${entry.name} damage mode`} value={entry.roll.damageMode ?? "melee"} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "damage" ? { ...item, roll: { ...item.roll, damageMode: event.target.value as "melee" | "ranged" } } : item) })}><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label></> : <Field label="Healing bonus" type="number" value={entry.roll.flatBonus ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll?.kind === "healing" ? { ...item, roll: { ...item.roll, flatBonus: value === "" ? undefined : Number(value) } } : item) })} />}<label className="system-entry-toggle"><input type="checkbox" checked={entry.roll.perCasterLevel ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && (item.roll?.kind === "damage" || item.roll?.kind === "healing") ? { ...item, roll: { ...item.roll, perCasterLevel: event.target.checked, ...(event.target.checked ? { casterLevelCap: item.roll.casterLevelCap ?? 10 } : {}) } } : item) })} /> Dice per caster level</label>{entry.roll.perCasterLevel && <Field label="Caster level cap" type="number" value={entry.roll.casterLevelCap ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && (item.roll?.kind === "damage" || item.roll?.kind === "healing") ? { ...item, roll: { ...item.roll, casterLevelCap: value === "" ? undefined : Math.max(1, Number(value) || 1) } } : item) })} />}</>}
            <Field label="Resource cost" type="number" value={entry.resourceCost ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, resourceCost: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            <Field label="Uses per day" type="number" value={entry.usesPerDay ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesPerDay: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            {entry.usesPerDay !== undefined && <Field label="Uses spent" type="number" value={entry.usesSpent ?? 0} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent: Math.min(item.usesPerDay ?? 0, Math.max(0, Number(value) || 0)), expended: Number(value) >= (item.usesPerDay ?? Infinity) } : item) })} />}
            {entry.active && <label className="field"><span>Rounds remaining</span><input aria-label={`${entry.name} rounds remaining`} type="number" min="0" step="1" value={entry.roundsRemaining ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Math.max(0, Math.floor(Number(event.target.value) || 0)); update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roundsRemaining: value } : item) }); }} /></label>}
            <SystemEntryEffectsEditor effects={entry.effects ?? []} onChange={(effects) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, effects } : item) })} />
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.prepared ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, prepared: event.target.checked } : item) })} /> Prepared / bound</label>
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.expended ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, expended: event.target.checked } : item) })} /> Expended</label>
            <button className="table-action" aria-label={`Remove ${entry.name}`} onClick={() => update(source.id, { entries: source.entries.filter((item) => item.id !== entry.id) })}>×</button>
            <textarea aria-label={`${entry.name} notes`} rows={2} value={entry.description ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, description: event.target.value } : item) })} />
            </div></details>
          </article>; })}
        </div>
      </article>;
    })}
  </section>;
}
