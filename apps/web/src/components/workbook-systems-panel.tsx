import { useState } from "react";
import { deriveCharacterSystems, unchainedWoundPenalty, plainOutcomePolicy } from "@threepointpf/rules-core";
import { progressionCatalog } from "@threepointpf/rules-data";
import { characterSystemKinds, type CharacterSystemKind, type CharacterSystemSource, type RollPlan } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { abilities, abilityLabels } from "../lib/options";
import { catalogValues, nextId, slug } from "../lib/format";
import { Field } from "./primitives";

const systemNames: Record<CharacterSystemKind, string> = {
  maneuvers: "Maneuvers & stances", veilweaving: "Veilweaving", spheresOfPower: "Spheres of Power",
  spheresOfMight: "Spheres of Might", psionics: "Psionics", ffd20: "FFd20 spellcasting",
};
const systemResources: Record<CharacterSystemKind, string> = {
  maneuvers: "Readied maneuvers", veilweaving: "Essence", spheresOfPower: "Spell points",
  spheresOfMight: "Martial talents", psionics: "Power points", ffd20: "Magic points",
};

export function WorkbookSystemsPanel({ sheet }: { sheet: CharacterSheet }) {
  const sources = sheet.character.systems ?? [];
  const [kind, setKind] = useState<CharacterSystemKind>(characterSystemKinds[0]);
  const [name, setName] = useState(systemNames[characterSystemKinds[0]]);
  const [ability, setAbility] = useState<(typeof abilities)[number]>("cha");
  const [classTemplateId, setClassTemplateId] = useState("");
  const [diceExpressions, setDiceExpressions] = useState<Record<string, string>>({});
  const classTemplates = catalogValues(progressionCatalog).flatMap((definition) => (definition.characterSystemTemplates ?? []).map((template) => ({ ...template, progressionName: definition.name })));
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
    sheet.character.features.filter((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.negative-levels").length + (sheet.character.workbookOptions?.woundThresholds ? Math.abs(unchainedWoundPenalty(sheet.derived.currentHp, sheet.derived.maxHp.value)) : 0),
  );
  const update = (id: string, patch: Partial<CharacterSystemSource>) => sheet.update({ systems: sources.map((source) => source.id === id ? { ...source, ...patch } : source) });
  const useEntry = async (source: CharacterSystemSource, entry: CharacterSystemSource["entries"][number], current: ReturnType<typeof deriveCharacterSystems>[number]) => {
    const pendingDice = diceExpressions[entry.id];
    if (pendingDice && !/^\d+d\d+$/i.test(pendingDice.trim())) return sheet.fail(`Enter dice for ${entry.name} as 1d6 or 2d8.`);
    if (entry.known === false) return sheet.fail(`${entry.name} is not known.`);
    if (source.progression.length && entry.tier !== undefined && entry.tier > current.maximumTier) return sheet.fail(`${entry.name} exceeds the current maximum tier ${current.maximumTier}.`);
    if (source.kind === "maneuvers" && !entry.readied) return sheet.fail(`${entry.name} is not readied.`);
    if (source.kind === "veilweaving" && !entry.prepared) return sheet.fail(`${entry.name} is not bound or prepared.`);
    if (entry.roll?.perCasterLevel && current.casterLevel < 1) return sheet.fail(`${entry.name} requires a caster level of at least 1.`);
    if (entry.usesPerDay !== undefined && (entry.usesSpent ?? 0) >= entry.usesPerDay) return sheet.fail(`${entry.name} has no daily uses remaining.`);
    const cost = entry.resourceCost ?? 0;
    if (current.resourceRemaining !== undefined && cost > current.resourceRemaining) return sheet.fail(`Not enough ${source.resourceName || "resource"} to use ${entry.name}.`);
    const usesSpent = (entry.usesSpent ?? 0) + 1;
    if (!update(source.id, { resourceSpent: (source.resourceSpent ?? 0) + cost, entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent, expended: entry.usesPerDay === undefined || usesSpent >= entry.usesPerDay } : item) })) return;
    if (entry.roll) {
      const count = entry.roll.perCasterLevel ? Math.floor(Math.min(current.casterLevel, entry.roll.casterLevelCap ?? Infinity)) * entry.roll.dice.count : entry.roll.dice.count;
      const modifier = entry.roll.kind === "healing" ? entry.roll.flatBonus ?? 0 : 0;
      const damageType = entry.roll.kind === "damage" ? entry.roll.damageType ?? "untyped" : undefined;
      const plan: RollPlan = {
        id: `system:${sheet.character.id}:${source.id}:${entry.id}:${usesSpent}`, characterId: sheet.character.id,
        label: `${entry.name}${damageType ? ` (${damageType})` : " healing"}`, dice: [{ sides: entry.roll.dice.sides, count: Math.max(1, count) }], modifier,
        context: { kind: entry.roll.kind, actorCharacterId: sheet.character.id, action: { kind: "other" } }, outcomePolicy: plainOutcomePolicy,
        provenance: { modifier: modifier ? [{ target: "hp", value: modifier, label: `${entry.name} healing bonus`, source: `system.${source.id}.${entry.id}.roll` }] : [], excluded: [], ...(damageType ? { damageTerms: [{ kind: "dice" as const, dice: { sides: entry.roll.dice.sides, count: Math.max(1, count) }, label: entry.name, source: { id: `system.${source.id}.${entry.id}`, label: entry.name }, damageType, criticalBehavior: "notMultiplied" as const, multiplier: 1 }] } : {}) },
      };
      await sheet.rollPlan(plan);
    }
  };
  const restoreEntry = (source: CharacterSystemSource, entry: CharacterSystemSource["entries"][number]) => update(source.id, { resourceSpent: Math.max(0, (source.resourceSpent ?? 0) - (entry.resourceCost ?? 0)), entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent: Math.max(0, (item.usesSpent ?? 0) - 1), expended: false } : item) });
  const restoreAll = (source: CharacterSystemSource) => update(source.id, { resourceSpent: 0, entries: source.entries.map((entry) => ({ ...entry, usesSpent: 0, expended: false })) });
  return <section className="panel workbook-systems-panel">
    <div className="panel-heading"><div><span className="eyebrow">AUTOSHEET · ADDITIONAL SYSTEMS</span><h2>Maneuvers & specialized magic</h2></div><span className="helper">Character-owned charts and selections</span></div>
    <p className="muted">Class level follows the linked advancement track. Each system’s source chart is stored with this character so level, caster level, resource capacity, maximum tier, and save DCs can be recalculated together.</p>
    <div className="catalog-add-row">
      <select aria-label="Additional rules system" value={kind} onChange={(event) => { const next = event.target.value as CharacterSystemKind; setKind(next); setName(systemNames[next]); }}>
        {characterSystemKinds.map((entry) => <option key={entry} value={entry}>{systemNames[entry]}</option>)}
      </select>
      <input aria-label="System source name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Class or source" />
      <select aria-label="System key ability" value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}>{abilities.map((entry) => <option key={entry} value={entry}>{abilityLabels[entry]}</option>)}</select>
      <button className="button quiet" onClick={addSystem}>+ Add system</button>
    </div>
    {classTemplates.length > 0 && <div className="catalog-add-row"><select aria-label="Workbook class system chart" value={classTemplateId} onChange={(event) => setClassTemplateId(event.target.value)}><option value="">Choose a workbook class chart…</option>{classTemplates.map((template) => <option key={template.id} value={template.id}>{template.progressionName} · {systemNames[template.kind]}</option>)}</select><button className="button quiet" disabled={!classTemplateId} onClick={addClassSystem}>Add class chart</button></div>}
    {sources.map((source) => {
      const current = derived.find((item) => item.id === source.id)!;
      return <article className="workbook-system-card" key={source.id}>
        <div className="panel-heading"><div><span className="eyebrow">{systemNames[source.kind]}</span><h3>{source.name}</h3></div><div className="inline-actions"><button className="button quiet" onClick={() => restoreAll(source)}>Restore all uses</button><button className="table-action" aria-label={`Remove ${source.name}`} onClick={() => sheet.update({ systems: sources.filter((item) => item.id !== source.id) })}>Remove</button></div></div>
        <div className="form-grid system-source-fields">
          <Field label="Source name" value={source.name} onChange={(value) => update(source.id, { name: value || source.name })} />
          <label className="field"><span>Linked progression</span><select value={source.progressionId ?? ""} onChange={(event) => update(source.id, { progressionId: event.target.value || undefined })}><option value="">Use manual level</option>{catalogValues(progressionCatalog).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          <Field label="Manual level (when unlinked)" type="number" value={source.level ?? ""} onChange={(value) => update(source.id, { level: value === "" ? undefined : Math.max(0, Number(value) || 0) })} />
          <label className="field"><span>Key ability</span><select value={source.keyAbility} onChange={(event) => update(source.id, { keyAbility: event.target.value as typeof source.keyAbility })}>{abilities.map((entry) => <option key={entry} value={entry}>{abilityLabels[entry]}</option>)}</select></label>
          <Field label="Caster / initiator level adjustment" type="number" value={source.casterLevelBonus ?? 0} onChange={(value) => update(source.id, { casterLevelBonus: Number(value) || 0 })} />
          {source.kind === "spheresOfMight" && <Field label="Effective BAB adjustment" type="number" value={source.effectiveBabBonus ?? 0} onChange={(value) => update(source.id, { effectiveBabBonus: Number(value) || 0 })} />}
          <Field label="Save DC adjustment" type="number" value={source.dcAdjustment ?? 0} onChange={(value) => update(source.id, { dcAdjustment: Number(value) || 0 })} />
          <Field label="Resource name" value={source.resourceName ?? ""} onChange={(value) => update(source.id, { resourceName: value })} />
          <Field label="Resource spent" type="number" value={source.resourceSpent ?? 0} onChange={(value) => update(source.id, { resourceSpent: Math.max(0, Number(value) || 0) })} />
          <Field label="Resource maximum adjustment" type="number" value={source.resourceMaximumBonus ?? 0} onChange={(value) => update(source.id, { resourceMaximumBonus: Number(value) || 0 })} />
        </div>
        <div className="system-derived-summary"><b>Level {current.level}</b><span>Caster / initiator level {current.casterLevel}</span><span>Maximum tier {current.maximumTier}</span>{current.resourceMaximum !== undefined && <span>{source.resourceName || "Resource"} {current.resourceRemaining}/{current.resourceMaximum}{current.resourceBonus ? ` (includes +${current.resourceBonus} ability bonus)` : ""}</span>}{current.knownCount !== undefined && <span>Known {current.knownCount}</span>}{current.knownByTier && <span>Known by tier {Object.entries(current.knownByTier).map(([tier, count]) => `${tier}:${count}`).join(" · ")}</span>}{current.talentCount !== undefined && <span>Talents {current.talentCount}</span>}{current.saveDc && (current.maximumTier > 0 || source.kind === "spheresOfPower" || source.kind === "spheresOfMight") && <span>Save DC {current.saveDc(current.maximumTier)}</span>}</div>
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
        <div className="workbook-system-subsection"><div className="subsection-heading"><h4>Known, readied & active entries</h4><button className="button quiet" onClick={() => update(source.id, { entries: [...source.entries, { id: nextId(`${source.id}-entry`, source.entries.map((entry) => entry.id)), name: "New entry", known: true, ...(["spheresOfPower", "spheresOfMight"].includes(source.kind) ? { ranks: 1 } : {}) }] })}>+ Add entry</button></div>
          {source.entries.map((entry) => <div className="system-entry-row" key={entry.id}>
            <Field label="Name" value={entry.name} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, name: value || item.name } : item) })} />
            <Field label="Category" value={entry.category ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, category: value } : item) })} />
            <Field label="Tier" type="number" value={entry.tier ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, tier: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            {(["spheresOfPower", "spheresOfMight"].includes(source.kind)) && <Field label="Talent ranks" type="number" value={entry.ranks ?? 1} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, ranks: Math.max(0, Number(value) || 0) } : item) })} />}
            {current.saveDc && entry.tier !== undefined && <span className="helper">Save DC {current.saveDc(entry.tier)}</span>}
            <label className="field"><span>Roll effect</span><select aria-label={`${entry.name} roll effect`} value={entry.roll?.kind ?? ""} onChange={(event) => { const selected = event.target.value as "damage" | "healing" | ""; const roll = selected ? { kind: selected, dice: entry.roll?.dice ?? { count: 1, sides: 6 }, ...(selected === "damage" ? { damageType: entry.roll?.damageType ?? "untyped" } : {}) } as const : undefined; setDiceExpressions((values) => ({ ...values, [entry.id]: roll ? `${roll.dice.count}d${roll.dice.sides}` : "" })); update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, roll } : item) }); }}><option value="">No roll</option><option value="damage">Damage</option><option value="healing">Healing</option></select></label>
            {entry.roll && <><label className="field"><span>Dice{entry.roll.perCasterLevel ? ` per caster level (CL ${current.casterLevel})` : ""}</span><input aria-label={`${entry.name} roll dice`} value={diceExpressions[entry.id] ?? `${entry.roll.dice.count}d${entry.roll.dice.sides}`} onChange={(event) => { const value = event.target.value; setDiceExpressions((values) => ({ ...values, [entry.id]: value })); const match = /^(\d+)d(\d+)$/i.exec(value.trim()); if (match) update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll ? { ...item, roll: { ...item.roll, dice: { count: Number(match[1]), sides: Number(match[2]) } } } : item) }); }} /></label>{entry.roll.kind === "damage" ? <Field label="Damage type" value={entry.roll.damageType ?? "untyped"} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll ? { ...item, roll: { ...item.roll, damageType: value || "untyped" } } : item) })} /> : <Field label="Healing bonus" type="number" value={entry.roll.flatBonus ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll ? { ...item, roll: { ...item.roll, flatBonus: value === "" ? undefined : Number(value) } } : item) })} />}<label className="system-entry-toggle"><input type="checkbox" checked={entry.roll.perCasterLevel ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll ? { ...item, roll: { ...item.roll, perCasterLevel: event.target.checked, ...(event.target.checked ? { casterLevelCap: item.roll.casterLevelCap ?? 10 } : {}) } } : item) })} /> Dice per caster level</label>{entry.roll.perCasterLevel && <Field label="Caster level cap" type="number" value={entry.roll.casterLevelCap ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id && item.roll ? { ...item, roll: { ...item.roll, casterLevelCap: value === "" ? undefined : Math.max(1, Number(value) || 1) } } : item) })} />}</>}
            <Field label="Resource cost" type="number" value={entry.resourceCost ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, resourceCost: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            <Field label="Uses per day" type="number" value={entry.usesPerDay ?? ""} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesPerDay: value === "" ? undefined : Math.max(0, Number(value) || 0) } : item) })} />
            {entry.usesPerDay !== undefined && <Field label="Uses spent" type="number" value={entry.usesSpent ?? 0} onChange={(value) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, usesSpent: Math.min(item.usesPerDay ?? 0, Math.max(0, Number(value) || 0)), expended: Number(value) >= (item.usesPerDay ?? Infinity) } : item) })} />}
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.known !== false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, known: event.target.checked } : item) })} /> Known</label>
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.readied ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, readied: event.target.checked } : item) })} /> Readied</label>
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.prepared ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, prepared: event.target.checked } : item) })} /> Prepared / bound</label>
            <label className="system-entry-toggle"><input type="checkbox" checked={entry.expended ?? false} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, expended: event.target.checked } : item) })} /> Expended</label>
            {entry.usesPerDay !== undefined ? <><span className="helper">{Math.max(0, entry.usesPerDay - (entry.usesSpent ?? 0))}/{entry.usesPerDay} uses</span>{(entry.usesSpent ?? 0) > 0 && <button className="button quiet" onClick={() => restoreEntry(source, entry)}>Restore one</button>}{(entry.usesSpent ?? 0) < entry.usesPerDay && <button className="button quiet" onClick={() => useEntry(source, entry, current)}>Use</button>}</> : entry.expended ? <button className="button quiet" onClick={() => restoreEntry(source, entry)}>Restore</button> : <button className="button quiet" onClick={() => useEntry(source, entry, current)}>Use</button>}
            <button className="table-action" aria-label={`Remove ${entry.name}`} onClick={() => update(source.id, { entries: source.entries.filter((item) => item.id !== entry.id) })}>×</button>
            <textarea aria-label={`${entry.name} notes`} rows={2} value={entry.description ?? ""} onChange={(event) => update(source.id, { entries: source.entries.map((item) => item.id === entry.id ? { ...item, description: event.target.value } : item) })} />
          </div>)}
        </div>
      </article>;
    })}
  </section>;
}
