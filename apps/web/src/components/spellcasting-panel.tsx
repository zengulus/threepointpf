import { useMemo, useState } from "react";
import { castSpell, concentrationRollPlan, deriveSpellcastingSource, prepareSpells, refreshSpellcasting, saveOutcomePolicy, plainOutcomePolicy } from "@threepointpf/rules-core";
import { progressionCatalog, spellCatalog } from "@threepointpf/rules-data";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { d20CheckDie, type SpellSlotProgressionRow, type SaveId, type RollPlan } from "@threepointpf/rules-schema";
import { nextId, slug } from "../lib/format";

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
  const [customSpellName, setCustomSpellName] = useState("");
  const [customSpellLevel, setCustomSpellLevel] = useState("1");
  const [customSpellDamage, setCustomSpellDamage] = useState("1d6");
  const [customSpellAttack, setCustomSpellAttack] = useState<"" | "meleeTouch" | "rangedTouch">("");
  const [customSpellEffectKind, setCustomSpellEffectKind] = useState<"damage" | "healing">("damage");
  const [customSpellPerCasterLevel, setCustomSpellPerCasterLevel] = useState(false);
  const [rowLevel, setRowLevel] = useState("2");
  const [rowCasterLevel, setRowCasterLevel] = useState("2");
  const [rowMaxSpellLevel, setRowMaxSpellLevel] = useState("1");
  const [rowSlots, setRowSlots] = useState(["3", "2", "0", "0"]);
  const [rowKnown, setRowKnown] = useState(["", "", "", ""]);
  const [targetName, setTargetName] = useState("Target");
  const [targetSaveBonus, setTargetSaveBonus] = useState("");
  const [targetSpellResistance, setTargetSpellResistance] = useState("");
  const [targetTouchAc, setTargetTouchAc] = useState("");
  const customSpells = sheet.character.customSpells ?? {};
  const spells = useMemo(() => ({ ...spellCatalog, ...customSpells }), [customSpells]);
  const sources = sheet.character.spellcastingSources ?? [];
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
    if (!customSpellName.trim() || !die || !Number.isInteger(Number(customSpellLevel)) || Number(customSpellLevel) < 0) return sheet.fail("Enter a spell name, non-negative level, and dice such as 1d6.");
    const id = `local.${slug(customSpellName) || "spell"}`;
    if (spells[id]) return sheet.fail("A spell with that local id already exists.");
    const dice = { count: Number(die[1]), sides: Number(die[2]) };
    const customSpells = { ...sheet.character.customSpells, [id]: { id, name: customSpellName.trim(), description: "Character-local custom spell.", school: "universal", levels: [{ spellListId: listId.trim() || "custom", level: Number(customSpellLevel) }], castingTime: { action: "standard" as const }, components: [], savingThrow: { result: "none" as const }, execution: customSpellEffectKind === "healing" ? { healing: { dice, ...(customSpellPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 5 } : {}) } } : { ...(customSpellAttack ? { attack: customSpellAttack } : {}), damage: { dice, damageType: "force", ...(customSpellPerCasterLevel ? { perCasterLevel: true, casterLevelCap: 10 } : {}) } } } };
    if (sheet.update({ customSpells }, `Added custom spell ${customSpellName.trim()}`)) setCustomSpellName("");
  };
  const cast = async (sourceId: string, spellId: string, preparedAllocationId?: string) => {
    const targetLabel = targetName.trim() || "Target";
    const touchAc = Number(targetTouchAc);
    const result = castSpell(sheet.engine, { sourceId, spellId, preparedAllocationId, targetName: targetLabel, ...(targetTouchAc.trim() && Number.isFinite(touchAc) ? { targetTouchAc: touchAc } : {}) }, spellCatalog);
    if (!result.accepted) return sheet.fail(result.issues.map((issue) => issue.message).join(" "));
    if (!sheet.update(result.character, `Cast ${result.spell.name}`)) return;
    let resisted = false;
    const targetSr = Number(targetSpellResistance);
    if (result.spell.spellResistance && targetSpellResistance.trim() && targetSr > 0) {
      const resistancePlan: RollPlan = {
        id: `spell:${sheet.character.id}:${sourceId}:${spellId}:resistance`, characterId: sheet.character.id,
        label: `${result.spell.name} spell resistance check vs ${targetLabel}`, dice: [{ sides: 20, count: 1 }],
        modifier: result.execution.casterLevel, context: { kind: "skill", actorCharacterId: sheet.character.id, action: { kind: "skillCheck" }, target: { name: targetLabel, defense: { kind: "dc", value: targetSr } } },
        outcomePolicy: plainOutcomePolicy, primaryCheckDie: d20CheckDie,
        provenance: { modifier: [{ target: "casterLevel", value: result.execution.casterLevel, label: "Caster level", source: `spell.${spellId}.casterLevel` }], excluded: [] },
      };
      const resistance = await sheet.rollPlan(resistancePlan);
      resisted = resistance !== null && resistance.total < targetSr;
      if (resisted) { sheet.inspect(`${result.spell.name} resisted`, { target: "casterLevel", value: resistance!.total, contributions: [] }); return; }
    }
    const save = result.spell.savingThrow;
    let saved = false;
    if (save?.save && save.result !== "none" && save.result !== "harmless" && targetSaveBonus.trim()) {
      const bonus = Number(targetSaveBonus);
      if (Number.isFinite(bonus)) {
        const savePlan: RollPlan = {
          id: `spell:${sheet.character.id}:${sourceId}:${spellId}:target-save`, characterId: sheet.character.id,
          label: `${targetLabel} ${save.save} save vs ${result.execution.saveDc}`, dice: [{ sides: 20, count: 1 }], modifier: bonus,
          context: { kind: "save", actorCharacterId: sheet.character.id, action: { kind: "other" }, saveId: save.save as SaveId, target: { name: targetLabel, defense: { kind: "dc", value: result.execution.saveDc } } },
          outcomePolicy: saveOutcomePolicy, primaryCheckDie: d20CheckDie,
          provenance: { modifier: [], excluded: [] },
        };
        const saveRoll = await sheet.rollPlan(savePlan);
        saved = saveRoll?.outcome.success === true;
      }
    }
    if (saved && save?.result === "negates") {
      sheet.inspect(`${result.spell.name}: ${targetLabel} negates the effect`, { target: "hp", value: 0, contributions: [] });
      return;
    }
    let attackMissed = false;
    for (const plan of result.execution.rollPlans) {
      if (attackMissed) break;
      const rolled = await sheet.rollPlan(plan);
      if (plan.context.kind === "attack" && rolled?.outcome.hit === false) attackMissed = true;
      if (saved && save?.result === "half" && plan.context.kind === "damage" && rolled) {
        sheet.inspect(`${result.spell.name}: half damage after ${targetLabel}'s successful save`, { target: "hp", value: Math.floor(rolled.total / 2), contributions: [] });
      }
    }
    if (saved && save?.result === "partial") sheet.inspect(`${result.spell.name}: ${targetLabel} saved; apply the spell's partial effect`, { target: "hp", value: 0, contributions: [] });
    const source = sheet.character.spellcastingSources?.find((item) => item.id === sourceId);
    const dc = source ? deriveSpellcastingSource(sheet.engine, source, spells).saveDc(result.execution.spellLevel) : undefined;
    if (dc) sheet.inspect(`${result.spell.name} DC`, dc);
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
    <section className="panel"><span className="eyebrow">TARGET RESOLUTION</span><h3>Spell target</h3><div className="form-grid"><label>Target name<input value={targetName} onChange={(event) => setTargetName(event.target.value)} /></label><label>Target touch AC<input type="number" min="0" value={targetTouchAc} onChange={(event) => setTargetTouchAc(event.target.value)} placeholder="Optional; enables hit / miss" /></label><label>Target save bonus<input type="number" value={targetSaveBonus} onChange={(event) => setTargetSaveBonus(event.target.value)} placeholder="Enter the relevant save bonus" /></label><label>Target spell resistance<input type="number" min="0" value={targetSpellResistance} onChange={(event) => setTargetSpellResistance(event.target.value)} placeholder="Leave blank if none" /></label></div><p className="muted">When a spell lists a save, spell resistance, or touch attack, enter the relevant target value. The app rolls the target save and caster-level resistance check, and resolves negates, half damage, resistance, and attack misses.</p></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SPELLCASTING</span><h2>Sources &amp; spells</h2></div></div>
      {!sources.length && <p className="muted">No casting sources yet. Add a source below; it stays independent from abilities and from other sources.</p>}
      {classTemplates.length > 0 && <div className="spell-entry-row class-spell-template"><label>Class chart<select aria-label="Class casting chart" value={classTemplateId} onChange={(event) => setClassTemplateId(event.target.value)}><option value="">Choose a workbook class chart…</option>{classTemplates.map((template) => <option key={template.sourceId} value={template.sourceId}>{template.progressionName} · {template.mode} · {template.castingAbility.toUpperCase()}</option>)}</select></label><button className="button quiet" disabled={!classTemplateId} onClick={addClassSource}>Add class casting</button></div>}
      {sources.map((source) => {
        const derived = deriveSpellcastingSource(sheet.engine, source, spells);
        const listSpells = Object.values(spells).filter((spell) => spell.levels.some((level) => level.spellListId === source.spellListId));
        const available = source.mode === "prepared" ? source.spellListAccess === "spellbook" ? source.spellbookSpellIds ?? [] : listSpells.map((spell) => spell.id) : source.knownSpellIds ?? [];
        const spellGroups = new Map<number, string[]>();
        for (const spellId of available) {
          const level = derived.spellLevel(spellId, spells) ?? 0;
          spellGroups.set(level, [...(spellGroups.get(level) ?? []), spellId]);
        }
        return <article className="panel spell-source" key={source.id}>
          <div className="panel-heading"><div><h3>{source.name}</h3><small>{source.mode} · {source.spellListId}</small></div></div>
          <div className="spell-summary"><span>Caster level <b>{derived.casterLevel.value}</b></span><span>Maximum spell level <b>{derived.maximumSpellLevel}</b></span><span>Concentration <b>{derived.concentration.value >= 0 ? "+" : ""}{derived.concentration.value}</b></span><span>Ability <b>{source.castingAbility.toUpperCase()}</b></span></div>
          <div className="spell-entry-row"><label>Concentration DC (optional)<input type="number" min="0" value={concentrationDc} onChange={(event) => setConcentrationDc(event.target.value)} /></label><button className="button quiet" onClick={() => void sheet.rollPlan(concentrationRollPlan(sheet.engine, source.id, concentrationDc.trim() ? Number(concentrationDc) : undefined))}>Roll concentration</button></div>
          <details><summary>Inspect derived values</summary><p>Caster level: {derived.casterLevel.contributions.map((item) => `${item.label} ${item.value >= 0 ? "+" : ""}${item.value}`).join(" · ")}</p><p>Concentration: {derived.concentration.contributions.map((item) => `${item.label} ${item.value >= 0 ? "+" : ""}${item.value}`).join(" · ")}</p></details>
          <table className="spell-slot-table"><thead><tr><th>Level</th><th>Slots</th><th>Remaining</th></tr></thead><tbody>{derived.slots.map((slot) => <tr key={slot.level}><th>{slot.level}</th><td>{slot.unlimited ? "∞" : slot.capacity}</td><td>{slot.unlimited ? "∞" : slot.remaining}</td></tr>)}</tbody></table>
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
    <section className="panel"><span className="eyebrow">EXPERT AUTHORING</span><h3>Add a casting source</h3><div className="form-grid"><label>Source name<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label><label>Mode<select value={sourceMode} onChange={(event) => { const next = event.target.value as typeof sourceMode; setSourceMode(next); setListAccess(next === "prepared" ? "spellbook" : "list"); }}><option value="spontaneous">Spontaneous</option><option value="prepared">Prepared</option></select></label><label>Casting ability<select value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}><option value="int">INT</option><option value="wis">WIS</option><option value="cha">CHA</option></select></label><label>Spell-list identity<input value={listId} onChange={(event) => setListId(event.target.value)} /></label><label>Spell access<select value={listAccess} onChange={(event) => setListAccess(event.target.value as typeof listAccess)}><option value="list">Spell list</option><option value="spellbook">Spellbook</option></select></label></div><p className="muted">A simple starter table is created. Progression rows and slot allowances are persisted on the source and can be extended through authored content.</p><button className="button" onClick={addSource}>Add source</button></section>
    <section className="panel"><span className="eyebrow">CHARACTER-LOCAL SPELL</span><h3>Define a custom spell</h3><div className="form-grid"><label>Name<input value={customSpellName} onChange={(event) => setCustomSpellName(event.target.value)} /></label><label>Level<input type="number" min="0" value={customSpellLevel} onChange={(event) => setCustomSpellLevel(event.target.value)} /></label><label>Effect<select aria-label="Custom spell effect" value={customSpellEffectKind} onChange={(event) => setCustomSpellEffectKind(event.target.value as typeof customSpellEffectKind)}><option value="damage">Damage</option><option value="healing">Healing</option></select></label>{customSpellEffectKind === "damage" && <label>Touch attack<select aria-label="Custom spell touch attack" value={customSpellAttack} onChange={(event) => setCustomSpellAttack(event.target.value as typeof customSpellAttack)}><option value="">No attack roll</option><option value="meleeTouch">Melee touch</option><option value="rangedTouch">Ranged touch</option></select></label>}<label>{customSpellEffectKind === "healing" ? "Healing dice" : "Damage dice"}<input value={customSpellDamage} onChange={(event) => setCustomSpellDamage(event.target.value)} /></label><label><input type="checkbox" checked={customSpellPerCasterLevel} onChange={(event) => setCustomSpellPerCasterLevel(event.target.checked)} /> Multiply dice by caster level (cap 5 for healing, 10 for damage)</label></div><button className="button quiet" onClick={addCustomSpell}>Add custom spell</button></section>
  </div>;
}
