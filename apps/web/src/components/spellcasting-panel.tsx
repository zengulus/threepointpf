import { useMemo, useState } from "react";
import { castSpell, concentrationRollPlan, deriveSpellcastingSource, prepareSpells, refreshSpellcasting } from "@threepointpf/rules-core";
import { spellCatalog } from "@threepointpf/rules-data";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import type { SpellSlotProgressionRow } from "@threepointpf/rules-schema";
import { nextId, slug } from "../lib/format";

export function SpellcastingPanel({ sheet }: { sheet: CharacterSheet }) {
  const [sourceName, setSourceName] = useState("");
  const [sourceMode, setSourceMode] = useState<"prepared" | "spontaneous">("spontaneous");
  const [ability, setAbility] = useState<"int" | "wis" | "cha">("cha");
  const [listAccess, setListAccess] = useState<"list" | "spellbook">("list");
  const [listId, setListId] = useState("arcane");
  const [entrySpell, setEntrySpell] = useState("");
  const [concentrationDc, setConcentrationDc] = useState("");
  const [customSpellName, setCustomSpellName] = useState("");
  const [customSpellLevel, setCustomSpellLevel] = useState("1");
  const [customSpellDamage, setCustomSpellDamage] = useState("1d6");
  const [rowLevel, setRowLevel] = useState("2");
  const [rowCasterLevel, setRowCasterLevel] = useState("2");
  const [rowMaxSpellLevel, setRowMaxSpellLevel] = useState("1");
  const [rowSlots, setRowSlots] = useState(["3", "2", "0", "0"]);
  const [rowKnown, setRowKnown] = useState(["", "", "", ""]);
  const customSpells = sheet.character.customSpells ?? {};
  const spells = useMemo(() => ({ ...spellCatalog, ...customSpells }), [customSpells]);
  const sources = sheet.character.spellcastingSources ?? [];
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
    const customSpells = { ...sheet.character.customSpells, [id]: { id, name: customSpellName.trim(), description: "Character-local custom spell.", school: "universal", levels: [{ spellListId: listId.trim() || "custom", level: Number(customSpellLevel) }], castingTime: { action: "standard" as const }, components: [], savingThrow: { result: "none" as const }, execution: { damage: { dice: { count: Number(die[1]), sides: Number(die[2]) }, damageType: "force" } } } };
    if (sheet.update({ customSpells }, `Added custom spell ${customSpellName.trim()}`)) setCustomSpellName("");
  };
  const cast = async (sourceId: string, spellId: string, preparedAllocationId?: string) => {
    const result = castSpell(sheet.engine, { sourceId, spellId, preparedAllocationId }, spellCatalog);
    if (!result.accepted) return sheet.fail(result.issues.map((issue) => issue.message).join(" "));
    if (!sheet.update(result.character, `Cast ${result.spell.name}`)) return;
    for (const plan of result.execution.rollPlans) await sheet.rollPlan(plan);
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
  const prepare = (sourceId: string) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;
    const chosen = (source.spellListAccess === "spellbook" ? source.spellbookSpellIds : Object.values(spells).filter((spell) => spell.levels.some((entry) => entry.spellListId === source.spellListId)).map((spell) => spell.id))?.[0];
    if (!chosen) return sheet.fail("No eligible spells are available to prepare.");
    const spellLevel = spells[chosen]?.levels.find((entry) => entry.spellListId === source.spellListId)?.level ?? 0;
    const current = source.preparedSpells ?? [];
    const id = nextId(`prepared-${slug(chosen)}`, current.map((item) => item.id));
    try { sheet.update(prepareSpells(sheet.character, sourceId, [...current.filter((item) => !item.expended), { id, spellId: chosen, spellLevel }], deriveSpellcastingSource(sheet.engine, source, spells).progressionLevel), `Prepared ${spells[chosen]?.name ?? chosen}`); }
    catch (error) { sheet.fail(error instanceof Error ? error.message : "Could not prepare spell."); }
  };
  return <div className="spellcasting-panel">
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SPELLCASTING</span><h2>Sources &amp; spells</h2></div></div>
      {!sources.length && <p className="muted">No casting sources yet. Add a source below; it stays independent from abilities and from other sources.</p>}
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
          <table className="spell-slot-table"><thead><tr><th>Level</th><th>Slots</th><th>Remaining</th></tr></thead><tbody>{derived.slots.map((slot) => <tr key={slot.level}><th>{slot.level}</th><td>{slot.capacity}</td><td>{slot.remaining}</td></tr>)}</tbody></table>
          {source.mode === "spontaneous" && derived.spellsKnown.length > 0 && <p className="muted">Spells known: {derived.spellsKnown.map((item) => `Level ${item.level}: ${source.knownSpellIds?.filter((spellId) => derived.spellLevel(spellId, spells) === item.level).length ?? 0}/${item.capacity}`).join(" · ")}</p>}
          <button className="button quiet" onClick={() => sheet.update(refreshSpellcasting(sheet.character, source.id), `Refreshed ${source.name} slots and preparations`)}>Refresh slots and preparations</button>
          <details><summary>Edit progression table</summary><div className="form-grid"><label>Progression level<input type="number" min="0" value={rowLevel} onChange={(event) => setRowLevel(event.target.value)} /></label><label>Caster level<input type="number" min="0" value={rowCasterLevel} onChange={(event) => setRowCasterLevel(event.target.value)} /></label><label>Maximum spell level<input type="number" min="0" value={rowMaxSpellLevel} onChange={(event) => setRowMaxSpellLevel(event.target.value)} /></label>{rowSlots.map((value, index) => <label key={index}>Level {index} slots<input type="number" min="0" value={value} onChange={(event) => setRowSlots((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}{rowKnown.map((value, index) => <label key={`known-${index}`}>Level {index} spells known<input type="number" min="0" value={value} onChange={(event) => setRowKnown((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}</div><button className="button quiet" onClick={() => addProgressionRow(source.id)}>Save progression row</button><table className="spell-slot-table"><tbody>{source.progression.map((row) => <tr key={row.level}><th>Progression {row.level}</th><td>CL {row.casterLevel}</td><td>Max spell {row.maximumSpellLevel}</td><td>{Object.entries(row.slots).map(([level, count]) => `${level}: ${count}`).join(" · ")}</td><td>{Object.entries(row.spellsKnown ?? {}).map(([level, count]) => `Known ${level}: ${count}`).join(" · ")}</td></tr>)}</tbody></table></details>
          {(source.mode === "spontaneous" || source.spellListAccess === "spellbook") && <div className="spell-entry-row"><select aria-label={`Add spell to ${source.name}`} value={entrySpell} onChange={(event) => setEntrySpell(event.target.value)}><option value="">Choose spell…</option>{listSpells.map((spell) => <option value={spell.id} key={spell.id}>{spell.name} ({spell.levels.find((item) => item.spellListId === source.spellListId)?.level})</option>)}</select><button className="button quiet" disabled={!entrySpell} onClick={() => addAccess(source.id, entrySpell)}>{source.mode === "prepared" ? "Add to spellbook" : "Learn spell"}</button></div>}
          {source.mode === "prepared" && <div className="spell-entry-row"><button className="button quiet" onClick={() => prepare(source.id)}>Prepare first spellbook entry</button></div>}
          <div className="spell-list">{[...spellGroups.entries()].sort(([a], [b]) => a - b).map(([spellLevel, spellIds]) => <section className="spell-level-group" key={spellLevel}><h4>Level {spellLevel}</h4>{spellIds.map((spellId) => {
            const spell = spells[spellId]; if (!spell) return null;
            const level = derived.spellLevel(spellId, spells) ?? 0;
            const dc = derived.saveDc(level);
            const allocations = source.preparedSpells?.filter((item) => item.spellId === spellId) ?? [];
            return <div className="spell-row" key={spellId}><div><b>{spell.name}</b><small>Level {level} · DC {dc.value} · {spell.castingTime.action} · {spell.description}</small></div>
              {source.mode === "spontaneous" ? <button className="button quiet" disabled={(derived.slots.find((item) => item.level === level)?.remaining ?? 0) <= 0} onClick={() => void cast(source.id, spell.id)}>Cast</button> : allocations.filter((item) => !item.expended).map((item) => <button className="button quiet" key={item.id} onClick={() => void cast(source.id, spell.id, item.id)}>Cast prepared</button>)}
            </div>;
          })}</section>)}</div>
          {source.mode === "prepared" && source.preparedSpells?.some((item) => item.expended) && <p className="muted">Expended: {source.preparedSpells.filter((item) => item.expended).length}</p>}
        </article>;
      })}
    </section>
    <section className="panel"><span className="eyebrow">EXPERT AUTHORING</span><h3>Add a casting source</h3><div className="form-grid"><label>Source name<input value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label><label>Mode<select value={sourceMode} onChange={(event) => { const next = event.target.value as typeof sourceMode; setSourceMode(next); setListAccess(next === "prepared" ? "spellbook" : "list"); }}><option value="spontaneous">Spontaneous</option><option value="prepared">Prepared</option></select></label><label>Casting ability<select value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}><option value="int">INT</option><option value="wis">WIS</option><option value="cha">CHA</option></select></label><label>Spell-list identity<input value={listId} onChange={(event) => setListId(event.target.value)} /></label><label>Spell access<select value={listAccess} onChange={(event) => setListAccess(event.target.value as typeof listAccess)}><option value="list">Spell list</option><option value="spellbook">Spellbook</option></select></label></div><p className="muted">A simple starter table is created. Progression rows and slot allowances are persisted on the source and can be extended through authored content.</p><button className="button" onClick={addSource}>Add source</button></section>
    <section className="panel"><span className="eyebrow">CHARACTER-LOCAL SPELL</span><h3>Define a custom spell</h3><div className="form-grid"><label>Name<input value={customSpellName} onChange={(event) => setCustomSpellName(event.target.value)} /></label><label>Level<input type="number" min="0" value={customSpellLevel} onChange={(event) => setCustomSpellLevel(event.target.value)} /></label><label>Damage dice<input value={customSpellDamage} onChange={(event) => setCustomSpellDamage(event.target.value)} /></label></div><button className="button quiet" onClick={addCustomSpell}>Add custom spell</button></section>
  </div>;
}
