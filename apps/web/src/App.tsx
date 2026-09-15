import { useMemo, useState } from "react";
import { BrowserDiceProvider, formatModifier, resolveRollPlan } from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import type { CharacterInput, AbilityId, BonusType, Contribution, DefenseContext, Effect, FeatureInstance, TargetId } from "@threepointpf/rules-schema";
import { InMemoryCharacterRepository, SupabaseCharacterRepository, type CharacterRepository } from "@threepointpf/shared";
import { createClient } from "@supabase/supabase-js";

const demoCharacter: CharacterInput = {
  id: "human-martial", campaignId: "demo-campaign", name: "Nathan's Character",
  baseAbilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }, baseBab: 6,
  baseSaves: { fortitude: 5, reflex: 2, will: 2 }, baseHpBeforeConstitution: 50, hitDiceCount: 1, damageTaken: 5, temporaryHp: 0, baseLandSpeed: 30,
  skillRanks: { acrobatics: 2, perception: 3, intimidation: 0 },
  skills: { acrobatics: { governingAbility: "dex", classSkill: true }, perception: { governingAbility: "wis" } },
  attacks: [{ id: "greatsword", name: "Greatsword", attackAbility: "str", damageAbility: "str", damageAbilityMultiplier: 1.5, baseDamage: { count: 2, sides: 6 }, weaponBonus: 0, attackTags: ["weapon.melee", "weapon.two-handed"], mode: "melee" }],
  features: [
    { id: "weapon-focus", name: "Weapon Focus", description: "A focused martial attack.", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 1, bonusType: "untyped" }] },
    { id: "heroism", name: "Heroism", description: "Confidence under pressure.", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.fortitude", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.reflex", value: 2, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "initiative", value: 2, bonusType: "morale" }] },
    { id: "rage", name: "Rage", description: "A combat toggle affecting the whole dependency graph.", enabled: false, effects: [{ kind: "modifier", target: "ability.str", value: 4, bonusType: "morale" }, { kind: "modifier", target: "ability.con", value: 4, bonusType: "morale" }, { kind: "modifier", target: "save.will", value: 2, bonusType: "morale" }, { kind: "modifier", target: "ac", value: -2, bonusType: "untyped", appliesTo: ["normal", "touch", "flatFooted"] }] },
    { id: "power-attack", name: "Power Attack", description: "Trade attack for two-handed damage.", enabled: true, effects: [{ kind: "modifier", target: "attack.melee", value: -2, bonusType: "untyped" }, { kind: "modifier", target: "damage.melee", value: 6, bonusType: "untyped" }] },
  ],
};

const abilityOrder: AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];
const abilityNames: Record<AbilityId, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const bonusTypeOptions: BonusType[] = ["untyped", "dodge", "circumstance", "armor", "shield", "naturalArmor", "enhancement", "deflection", "resistance", "competence", "insight", "luck", "morale", "sacred", "profane", "size", "racial"];

function repository(): CharacterRepository {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) return new SupabaseCharacterRepository(createClient(url, key));
  return new InMemoryCharacterRepository();
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function StatCard({ label, value, evaluation, onClick, testId }: { label: string; value: string | number; evaluation: { contributions: Contribution[] }; onClick: () => void; testId: string }) {
  return <button className="stat-card" data-testid={testId} onClick={onClick} title="Show calculation breakdown"><span>{label}</span><strong>{value}</strong><small>inspect →</small></button>;
}

function Breakdown({ selected }: { selected: { label: string; evaluation: { value: number; contributions: Contribution[] } } | null }) {
  if (!selected) return <div className="breakdown empty"><span className="eyebrow">AUDIT TRAIL</span><p>Select a calculated value to see its sources.</p></div>;
  return <div className="breakdown"><div className="eyebrow">AUDIT TRAIL</div><h3>{selected.label} <span>= {selected.evaluation.value}</span></h3><div className="contributions">{selected.evaluation.contributions.map((item, index) => <div className="contribution" key={`${item.source}-${index}`}><span className="contribution-value">{formatModifier(item.value)}</span><span><b>{item.label}</b><em>{item.bonusType ?? "base / derived"}</em></span></div>)}</div></div>;
}

function Field({ label, value, onChange, type = "number" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function App() {
  const [character, setCharacter] = useState<CharacterInput>(() => clone(demoCharacter));
  const [selected, setSelected] = useState<{ label: string; evaluation: { value: number; contributions: Contribution[] } } | null>(null);
  const [notice, setNotice] = useState("Local draft ready");
  const [newFeatureName, setNewFeatureName] = useState("");
  const [newFeatureTarget, setNewFeatureTarget] = useState<TargetId>("attack.melee");
  const [newFeatureValue, setNewFeatureValue] = useState("1");
  const [newFeatureType, setNewFeatureType] = useState<BonusType>("untyped");
  const [newFeatureKind, setNewFeatureKind] = useState<"modifier" | "replaceBase">("modifier");
  const [newFeatureDefenseScope, setNewFeatureDefenseScope] = useState<"all" | "normal" | "normalTouch">("all");
  const [newAttackName, setNewAttackName] = useState("");
  const [newAttackDice, setNewAttackDice] = useState("1d8");
  const [newAttackAbility, setNewAttackAbility] = useState<AbilityId>("str");
  const [repo] = useState(repository);
  const engine = useMemo(() => new RulesEngine(character), [character]);
  const derived = useMemo(() => engine.derive(), [engine]);

  const update = (changes: Partial<CharacterInput>) => setCharacter((current) => ({ ...current, ...changes }));
  const updateAbility = (id: AbilityId, value: string) => update({ baseAbilities: { ...character.baseAbilities, [id]: Number(value) || 0 } });
  const toggleFeature = (id: string) => update({ features: character.features.map((feature) => feature.id === id ? { ...feature, enabled: !feature.enabled } : feature) });
  const inspect = (label: string, evaluation: { value: number; contributions: Contribution[] }) => setSelected({ label, evaluation });

  async function save() { await repo.save(character); setNotice(import.meta.env.VITE_SUPABASE_URL ? "Saved to Supabase" : "Saved locally (set VITE_SUPABASE_URL for Supabase)"); }
  async function reload() { const loaded = await repo.load(character.id); if (loaded) { setCharacter(loaded); setNotice("Reloaded authored inputs and recomputed"); } else setNotice("No saved character found"); }
  async function roll(label: string, planFactory: () => ReturnType<RulesEngine["createSaveRollPlan"]>) {
    try { const plan = planFactory(); const raw = await new BrowserDiceProvider().roll({ planId: plan.id, dice: plan.dice }); const result = resolveRollPlan(plan, raw.faces); setNotice(`${label}: ${raw.faces.join(", ")} ${formatModifier(result.modifier)} = ${result.total}`); } catch (error) { setNotice(error instanceof Error ? error.message : "Roll failed"); }
  }
  function addFeature() {
    if (!newFeatureName.trim()) return;
    const appliesTo: DefenseContext[] = newFeatureDefenseScope === "all" ? ["normal", "touch", "flatFooted"] : newFeatureDefenseScope === "normal" ? ["normal"] : ["normal", "touch"];
    const effect: Effect = newFeatureKind === "replaceBase"
      ? { kind: "replaceBase", target: newFeatureTarget, value: Number(newFeatureValue) || 0 }
      : newFeatureTarget === "ac"
        ? { kind: "modifier", target: "ac", value: Number(newFeatureValue) || 0, bonusType: newFeatureType, appliesTo }
        : { kind: "modifier", target: newFeatureTarget, value: Number(newFeatureValue) || 0, bonusType: newFeatureType };
    const feature: FeatureInstance = { id: `custom-${Date.now()}`, name: newFeatureName.trim(), enabled: true, effects: [effect] };
    update({ features: [...character.features, feature] }); setNewFeatureName(""); setNotice(`Added ${feature.name}`);
  }
  function addAttack() {
    const match = /^(\d+)d(\d+)$/i.exec(newAttackDice.trim()); if (!newAttackName.trim() || !match) return;
    update({ attacks: [...character.attacks, { id: `attack-${Date.now()}`, name: newAttackName.trim(), attackAbility: newAttackAbility, damageAbility: newAttackAbility, damageAbilityMultiplier: 1, baseDamage: { count: Number(match[1]), sides: Number(match[2]) }, mode: "melee", attackTags: ["weapon.melee"] }] }); setNewAttackName(""); setNotice("Added attack");
  }

  return <main className="app-shell">
    <header className="topbar"><div><div className="brand-mark">3.PF</div><div className="brand-subtitle">character sheet / rules engine</div></div><div className="top-actions"><span className="status-dot" />{notice}<button className="button quiet" onClick={reload}>Reload</button><button className="button primary" onClick={save}>Save character</button></div></header>
    <section className="hero"><div><span className="eyebrow">PATHFINDER 1E · VERTICAL SLICE</span><input className="character-name" aria-label="Character name" value={character.name} onChange={(event) => update({ name: event.target.value })} /><p>Authored inputs flow through features, contributions and reducers into an inspectable sheet.</p></div><div className="hero-meta"><span>CAMPAIGN</span><b>{character.campaignId ?? "Unassigned"}</b><span>LEVEL / BAB</span><b>{character.advancementSlots ? `${derived.advancement?.slotCount ?? 0} / advancement` : `— / ${formatModifier(character.baseBab ?? 0)}`}</b></div></section>
    <div className="layout"><div className="main-column">
      <section className="panel inputs-panel"><div className="panel-heading"><div><span className="eyebrow">AUTHORED INPUTS</span><h2>Core numbers</h2></div><span className="pill">recompute on edit</span></div><div className="ability-grid">{abilityOrder.map((id) => <div className="ability-input" key={id}><span>{id.toUpperCase()}</span><input aria-label={`${abilityNames[id]} base score`} type="number" value={character.baseAbilities[id]} onChange={(event) => updateAbility(id, event.target.value)} /><b>{formatModifier(derived.abilities[id].modifier.value)}</b></div>)}</div><div className="inline-fields"><Field label="Base BAB" value={character.baseBab ?? ""} onChange={(value) => update({ baseBab: Number(value) || 0 })} /><Field label="HP before CON" value={character.baseHpBeforeConstitution} onChange={(value) => update({ baseHpBeforeConstitution: Number(value) || 0 })} /><Field label="Hit dice" value={character.hitDiceCount ?? ""} onChange={(value) => update({ hitDiceCount: Math.max(1, Number(value) || 1) })} /><Field label="Damage taken" value={character.damageTaken} onChange={(value) => update({ damageTaken: Math.max(0, Number(value) || 0) })} /><Field label="Temporary HP" value={character.temporaryHp} onChange={(value) => update({ temporaryHp: Math.max(0, Number(value) || 0) })} /><Field label="Land speed" value={character.baseLandSpeed ?? 30} onChange={(value) => update({ baseLandSpeed: Number(value) || 0 })} /></div><div className="save-inputs">{(["fortitude", "reflex", "will"] as const).map((id) => <Field key={id} label={`Base ${id}`} value={character.baseSaves?.[id] ?? ""} onChange={(value) => update({ baseSaves: { ...(character.baseSaves ?? { fortitude: 0, reflex: 0, will: 0 }), [id]: Number(value) || 0 } })} />)}</div></section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">DERIVED SHEET</span><h2>Defenses & combat</h2></div><span className="helper">Click any value to inspect</span></div><div className="stats-grid"><StatCard label="Armor Class" value={derived.ac.value} evaluation={derived.ac} onClick={() => inspect("Armor Class", derived.ac)} testId="stat-ac" /><StatCard label="Touch AC" value={derived.touchAc.value} evaluation={derived.touchAc} onClick={() => inspect("Touch AC", derived.touchAc)} testId="stat-touch-ac" /><StatCard label="Flat-footed" value={derived.flatFootedAc.value} evaluation={derived.flatFootedAc} onClick={() => inspect("Flat-footed AC", derived.flatFootedAc)} testId="stat-flat-footed" /><StatCard label="HP" value={`${derived.currentHp} / ${derived.maxHp.value}`} evaluation={derived.maxHp} onClick={() => inspect("Maximum HP", derived.maxHp)} testId="stat-current-hp" /><StatCard label="Max HP" value={derived.maxHp.value} evaluation={derived.maxHp} onClick={() => inspect("Maximum HP", derived.maxHp)} testId="stat-max-hp" /><StatCard label="Initiative" value={formatModifier(derived.initiative.value)} evaluation={derived.initiative} onClick={() => inspect("Initiative", derived.initiative)} testId="stat-initiative" /><StatCard label="CMB" value={formatModifier(derived.cmb.value)} evaluation={derived.cmb} onClick={() => inspect("CMB", derived.cmb)} testId="stat-cmb" /><StatCard label="CMD" value={derived.cmd.value} evaluation={derived.cmd} onClick={() => inspect("CMD", derived.cmd)} testId="stat-cmd" /></div><div className="saves-row">{(["fortitude", "reflex", "will"] as const).map((id) => <div className="roll-row" key={id}><button className="value-link" onClick={() => inspect(id, derived.saves[id])}><span>{id}</span><strong>{formatModifier(derived.saves[id].value)}</strong></button><button className="roll-button" data-testid={`roll-${id}`} onClick={() => roll(`${id} save`, () => engine.createSaveRollPlan(id))}>ROLL d20</button></div>)}</div></section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ATTACKS</span><h2>Weapons</h2></div></div>{derived.attacks.map((attack) => <div className="attack-row" key={attack.definition.id}><button className="value-link attack-name" onClick={() => inspect(`${attack.definition.name} attack`, attack.attack)}><span>{attack.definition.name}</span><strong>{formatModifier(attack.attack.value)}</strong><small>{attack.damage.formula}</small></button><button className="roll-button" data-testid={`roll-attack-${attack.definition.id}`} onClick={() => roll(`${attack.definition.name} attack`, () => engine.createAttackRollPlan(attack.definition.id))}>ROLL d20</button></div>)}<div className="add-row"><input placeholder="Attack name" aria-label="New attack name" value={newAttackName} onChange={(event) => setNewAttackName(event.target.value)} /><input placeholder="1d8" aria-label="New attack dice" value={newAttackDice} onChange={(event) => setNewAttackDice(event.target.value)} /><select aria-label="New attack ability" value={newAttackAbility} onChange={(event) => setNewAttackAbility(event.target.value as AbilityId)}>{abilityOrder.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}</select><button className="button quiet" onClick={addAttack}>+ Add attack</button></div></section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SKILLS</span><h2>PF skills</h2></div><span className="helper">Ranks + ability + class/misc</span></div><div className="skills-grid">{Object.values(derived.skills).map((skill) => <div className="skill-row" key={skill.id}><button className="skill-inspect" onClick={() => inspect(skill.label, skill.total)}><span>{skill.label}</span><em>{skill.governingAbility.toUpperCase()}{skill.classSkill ? " · class" : ""}</em><b>{formatModifier(skill.total.value)}</b></button><label className="rank-input"><span>ranks</span><input aria-label={`${skill.label} ranks`} type="number" min="0" value={skill.ranks} onChange={(event) => update({ skillRanks: { ...character.skillRanks, [skill.id]: Number(event.target.value) || 0 } })} /></label></div>)}</div></section>
    </div><aside className="side-column"><Breakdown selected={selected} /><section className="panel features-panel"><div className="panel-heading"><div><span className="eyebrow">FEATURES / EFFECTS</span><h2>Combat toggles</h2></div></div>{character.features.map((feature) => <div className={`feature-row ${feature.enabled ? "enabled" : ""}`} key={feature.id}><button className="toggle" aria-label={`Toggle ${feature.name}`} aria-pressed={feature.enabled} onClick={() => toggleFeature(feature.id)}><span /></button><div><b>{feature.name}</b><small>{feature.effects.map((effect) => effect.kind === "modifier" ? `${effect.value >= 0 ? "+" : ""}${effect.value} ${effect.bonusType} → ${effect.target}` : effect.kind === "replaceBase" ? `baseline replacement → ${effect.target}` : effect.kind).join(" · ")}</small></div><i>{feature.enabled ? "ON" : "OFF"}</i></div>)}<div className="feature-form"><input placeholder="Feature name" aria-label="New feature name" value={newFeatureName} onChange={(event) => setNewFeatureName(event.target.value)} /><select aria-label="New feature kind" value={newFeatureKind} onChange={(event) => setNewFeatureKind(event.target.value as "modifier" | "replaceBase")}><option value="modifier">Modifier</option><option value="replaceBase">Replace intrinsic baseline</option></select><select aria-label="New feature target" value={newFeatureTarget} onChange={(event) => setNewFeatureTarget(event.target.value as TargetId)}><option value="attack.melee">Melee attack</option><option value="damage.melee">Melee damage</option><option value="ac">AC</option><option value="initiative">Initiative</option><option value="save.fortitude">Fortitude</option><option value="save.reflex">Reflex</option><option value="save.will">Will</option><option value="ability.str">Strength</option><option value="ability.dex">Dexterity</option><option value="skill.all">All skills</option></select><div className="mini-fields"><input aria-label="New feature value" type="number" value={newFeatureValue} onChange={(event) => setNewFeatureValue(event.target.value)} /><select aria-label="New feature bonus type" value={newFeatureType} onChange={(event) => setNewFeatureType(event.target.value as BonusType)}>{bonusTypeOptions.map((type) => <option key={type}>{type}</option>)}</select></div>{newFeatureTarget === "ac" && newFeatureKind === "modifier" && <select aria-label="New feature AC applicability (required)" value={newFeatureDefenseScope} onChange={(event) => setNewFeatureDefenseScope(event.target.value as "all" | "normal" | "normalTouch")}><option value="all">AC: all contexts (required)</option><option value="normal">AC: normal only</option><option value="normalTouch">AC: normal + touch</option></select>}<button className="button quiet" onClick={addFeature}>+ Add structured effect</button></div></section><div className="side-note"><span className="eyebrow">SOURCE OF TRUTH</span><p>Only authored inputs, features and attacks are persisted. The sheet always derives its current values from the pure TypeScript engine.</p></div></aside></div>
  </main>;
}
