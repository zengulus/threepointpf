import type { CharacterInput, CharacterRecord } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { Field } from "./primitives";

export function TextBlock({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field character-record-field"><span>{label}</span><textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

const listFields = [
  ["languages", "Languages"], ["traits", "Traits"], ["drawbacks", "Drawbacks"],
  ["racialFeatures", "Racial features"], ["classFeatures", "Class features"], ["feats", "Feats"],
] as const;

const storyFields = [
  ["background", "Story and miscellaneous notes"], ["raisedWith", "How were you raised? Who is your family?"],
  ["learnedSkillsFrom", "Where and from whom did you learn your skills?"],
  ["lifeGoals", "Personal goals and challenges"], ["beliefs", "Important personal beliefs"],
  ["flaws", "Character flaws"], ["fears", "Secret fears"], ["notes", "Other notes"],
] as const;

export function CharacterIdentityPanel({ sheet }: { sheet: CharacterSheet }) {
  const record = sheet.character.record ?? {};
  const workbookOptions = sheet.character.workbookOptions ?? {};
  const skillMode = workbookOptions.skillMode ?? (workbookOptions.backgroundSkills === false ? "classic" : "background");
  const set = (patch: Partial<CharacterRecord>) => sheet.update({ record: { ...record, ...patch } });
  return <section className="panel character-record-panel">
    <div className="panel-heading"><div><span className="eyebrow">MAIN SHEET · IDENTITY</span><h2>Character details</h2></div><span className="helper">Saved with this character</span></div>
    <div className="form-grid character-identity-grid">
      {([["alignment", "Alignment"], ["race", "Race"], ["deity", "Deity"], ["age", "Age"], ["ageCategory", "Age category"], ["height", "Height"], ["weight", "Weight"], ["gender", "Gender"], ["homeland", "Homeland"]] as const).map(([key, label]) => <Field key={key} label={label} value={record[key] ?? ""} onChange={(value) => set({ [key]: value })} />)}
    </div>
    <div className="form-grid character-record-lists">{listFields.map(([key, label]) => <TextBlock key={key} label={label + " (one per line)"} value={(record[key] ?? []).join("\n")} onChange={(value) => set({ [key]: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} />)}</div>
    <div className="workbook-rule-options">
      <label className="field"><span>Skill variant</span><select aria-label="Skill variant" value={skillMode} onChange={(event) => { const value = event.target.value as NonNullable<NonNullable<CharacterInput["workbookOptions"]>["skillMode"]>; sheet.update({ workbookOptions: { ...workbookOptions, skillMode: value, backgroundSkills: value === "background" || value === "ultimate-psionics-background" } }); }}><option value="background">Background Skills</option><option value="ultimate-psionics-background">Ultimate Psionics + Background Skills</option><option value="consolidated">Consolidated Skills</option><option value="classic">Classic Skills</option></select><small>Consolidated Skills uses the workbook’s 12 skill groups and its half-rank-per-level budget.</small></label>
      <label className="checkbox-field"><input type="checkbox" checked={workbookOptions.woundThresholds ?? false} onChange={(event) => sheet.update({ workbookOptions: { ...workbookOptions, woundThresholds: event.target.checked } })} /><span><strong>Unchained wound thresholds</strong><small>Apply −1/−2/−3 to AC, saves, attacks, skills, and caster levels below 75%/50%/25% HP.</small></span></label>
      <label className="checkbox-field"><input type="checkbox" checked={workbookOptions.minimumFourPlusIntSkillRanks ?? false} onChange={(event) => sheet.update({ workbookOptions: { ...workbookOptions, minimumFourPlusIntSkillRanks: event.target.checked } })} /><span><strong>Minimum 4 + INT skill ranks</strong><small>Use at least 4 class skill points per level before adding the Intelligence modifier during character creation and level-up.</small></span></label>
    </div>
  </section>;
}

export function CharacterDefenseInputs({ sheet }: { sheet: CharacterSheet }) {
  const defenses = sheet.character.defenses ?? {};
  const resistances = defenses.energyResistances ?? {};
  const resistanceTypes = ["acid", "cold", "electricity", "fire", "sonic"];
  return <section className="panel character-defense-inputs">
    <div className="panel-heading"><div><span className="eyebrow">MAIN SHEET · DEFENSES</span><h2>Damage reduction & resistances</h2></div></div>
    <div className="form-grid">
      <Field label="Spell resistance" type="number" value={defenses.spellResistance ?? ""} onChange={(value) => sheet.update({ defenses: { ...defenses, spellResistance: value === "" ? undefined : Math.max(0, Number(value) || 0) } })} />
      <Field label="Nonlethal damage" type="number" value={sheet.character.nonlethalDamage ?? 0} onChange={(value) => sheet.update({ nonlethalDamage: Math.max(0, Number(value) || 0) })} />
      {resistanceTypes.map((type) => <Field key={type} label={`${type} resistance`} type="number" value={resistances[type] ?? ""} onChange={(value) => {
        const next = { ...resistances };
        if (value === "") delete next[type]; else next[type] = Math.max(0, Number(value) || 0);
        sheet.update({ defenses: { ...defenses, energyResistances: next } });
      }} />)}
      <TextBlock label="Damage reduction (one per line: amount / bypass)" value={(defenses.damageReduction ?? []).map((item) => `${item.amount}${item.bypass ? ` / ${item.bypass}` : ""}`).join("\n")} onChange={(value) => {
        const damageReduction = value.split(/\r?\n/).map((line) => {
          const [rawAmount, ...rest] = line.split("/");
          const amount = Number(rawAmount?.trim());
          return Number.isFinite(amount) && amount >= 0 ? { amount, ...(rest.join("/").trim() ? { bypass: rest.join("/").trim() } : {}) } : null;
        }).filter((item): item is NonNullable<typeof item> => item !== null);
        sheet.update({ defenses: { ...defenses, damageReduction } });
      }} />
      <TextBlock label="Energy immunities (one per line)" value={(defenses.energyImmunities ?? []).join("\n")} onChange={(value) => sheet.update({ defenses: { ...defenses, energyImmunities: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} />
    </div>
  </section>;
}

export function CharacterNotesPanel({ character, update }: { character: CharacterInput; update: CharacterSheet["update"] }) {
  const record = character.record ?? {};
  const story = record.story ?? {};
  const setRecord = (patch: Partial<CharacterRecord>) => update({ record: { ...record, ...patch } });
  const setStory = (patch: Partial<NonNullable<CharacterRecord["story"]>>) => setRecord({ story: { ...story, ...patch } });
  return <section className="panel character-notes-panel">
    <div className="panel-heading"><div><span className="eyebrow">MAIN SHEET · NOTES</span><h2>Story and play notes</h2></div></div>
    <div className="form-grid character-story-grid">{storyFields.map(([key, label]) => <TextBlock key={key} label={label} value={story[key] ?? ""} onChange={(value) => setStory({ [key]: value })} />)}</div>
    <div className="form-grid character-story-grid">{([["savingThrowNotes", "Saving throw notes"], ["armorClassNotes", "Armor Class notes"], ["attackNotes", "Attack notes"], ["armorNotes", "Armor notes"]] as const).map(([key, label]) => <TextBlock key={key} label={label} value={record[key] ?? ""} onChange={(value) => setRecord({ [key]: value })} />)}</div>
  </section>;
}
