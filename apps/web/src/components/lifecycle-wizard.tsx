import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptLifecycleWarning, beginAdvancement, beginCharacterCreation, commitAdvancement, commitCharacterCreation,
  previewAdvancement, previewCharacterCreation, progressionChoicesForCampaign,
  proposeAdvancement, proposeCharacterCreation, validateAdvancement, validateCharacterCreation,
  plainOutcomePolicy, type AdvancementProposal, type CampaignCharacterProfile, type CharacterCreationProposal,
  type ChoiceSelection, type LifecycleChoiceRequirement,
} from "@threepointpf/rules-core";
import { abilityIds, parseCharacterInput, type AbilityId, type CharacterInput, type ProgressionDefinition, type RollPlan } from "@threepointpf/rules-schema";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { formatModifier } from "@threepointpf/dice";
import { errorText, slug } from "../lib/format";
import { lifecycleChoiceKey, updateLifecycleChoice } from "../lib/lifecycle-choices";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

type Mode = "create" | "level-up";
type HpPreset = "averageDown" | "averageDownFirstMax" | "averageUp" | "averageUpFirstMax" | "maximum" | "customRoll";
type SkillRuleset = "pathfinder" | "dnd35";
type SkillMode = NonNullable<NonNullable<CharacterInput["workbookOptions"]>["skillMode"]>;
const skillModes: Record<SkillMode, string> = { background: "Background Skills", "ultimate-psionics-background": "Ultimate Psionics + Background Skills", consolidated: "Consolidated Skills", classic: "Classic Skills" };
const abilities: Record<AbilityId, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

function hpPolicyForPreset(preset: HpPreset): CampaignCharacterProfile["hpPolicy"] {
  if (preset === "averageDown") return { firstLevel: { kind: "averageDown" }, laterLevels: { kind: "averageDown" } };
  if (preset === "averageDownFirstMax") return { firstLevel: { kind: "maximum" }, laterLevels: { kind: "averageDown" } };
  if (preset === "averageUp") return { firstLevel: { kind: "averageUp" }, laterLevels: { kind: "averageUp" } };
  if (preset === "averageUpFirstMax") return { firstLevel: { kind: "maximum" }, laterLevels: { kind: "averageUp" } };
  if (preset === "maximum") return { firstLevel: { kind: "maximum" }, laterLevels: { kind: "maximum" } };
  return { firstLevel: { kind: "maximum" }, laterLevels: { kind: "rolled" } };
}

function profileForCreate(tracks: number, hpPreset: HpPreset, skillRuleset: SkillRuleset): CampaignCharacterProfile {
  return { id: "player-default", name: "Default campaign", startingLevel: 1,
    tracks: Array.from({ length: tracks }, (_, index) => ({ id: `track-${index + 1}`, name: tracks === 1 ? "Class / progression" : `Track ${String.fromCharCode(64 + index + 1)}` })),
    hpPolicy: hpPolicyForPreset(hpPreset),
    skillAllocationPolicy: { kind: "calculated", includeIntelligenceModifier: true, minimumPerLevel: 1, ruleset: skillRuleset }, allowCustomProgressions: true, allowManualOverrides: true };
}

function profileForAdvancement(character: CharacterInput, hpPreset: HpPreset, skillRuleset: SkillRuleset): CampaignCharacterProfile {
  const tracks = character.advancementSlots?.[0]?.tracks ?? [];
  return { id: character.campaignId ?? "current-campaign", startingLevel: 1,
    tracks: tracks.map((track, index) => ({ id: track.id, name: tracks.length === 1 ? "Class / progression" : `Track ${String.fromCharCode(64 + index + 1)}` })),
    hpPolicy: hpPolicyForPreset(hpPreset),
    skillAllocationPolicy: { kind: "calculated", includeIntelligenceModifier: true, minimumPerLevel: 1, ruleset: skillRuleset }, allowCustomProgressions: true, allowManualOverrides: true };
}

export function LifecycleWizard({ mode, sheet, onClose }: { mode: Mode; sheet: CharacterSheet; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [creationId] = useState(() => `character-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`);
  const [trackCount, setTrackCount] = useState(1);
  const [homebrewName, setHomebrewName] = useState("");
  const [homebrewHd, setHomebrewHd] = useState("");
  const [homebrewBab, setHomebrewBab] = useState<ProgressionDefinition["babProgression"]>("threeQuarters");
  const [homebrewFort, setHomebrewFort] = useState<ProgressionDefinition["saveProgressions"]["fortitude"]>("good");
  const [homebrewRef, setHomebrewRef] = useState<ProgressionDefinition["saveProgressions"]["reflex"]>("poor");
  const [homebrewWill, setHomebrewWill] = useState<ProgressionDefinition["saveProgressions"]["will"]>("poor");
  const [homebrewSkills, setHomebrewSkills] = useState("4");
  const [homebrewFeature, setHomebrewFeature] = useState("");
  const [homebrewPrompt, setHomebrewPrompt] = useState("");
  const [homebrewOptions, setHomebrewOptions] = useState("");
  const [name, setName] = useState("");
  const [abilityValues, setAbilityValues] = useState<Record<AbilityId, string>>({ str: "", dex: "", con: "", int: "", wis: "", cha: "" });
  const [abilityLine, setAbilityLine] = useState("");
  const [abilityLineError, setAbilityLineError] = useState<string | null>(null);
  const [progressions, setProgressions] = useState<Record<string, string>>(() => {
    if (mode !== "level-up") return {};
    const latestTracks = sheet.character.advancementSlots?.at(-1)?.tracks ?? [];
    return Object.fromEntries(latestTracks.map((track) => [track.id, track.entry.progressionId]));
  });
  const [progressionSearch, setProgressionSearch] = useState("");
  const [hp, setHp] = useState("");
  const [hpRoll, setHpRoll] = useState<{ key: string; faces: number[] } | null>(null);
  const [rollingHp, setRollingHp] = useState(false);
  const hpRollRequestRef = useRef<object | null>(null);
  const hpRollSequenceRef = useRef(0);
  const hasAppliedHpRollRef = useRef(false);
  const [hpRollError, setHpRollError] = useState<string | null>(null);
  useEffect(() => () => { hpRollRequestRef.current = null; }, []);
  const invalidateHpRoll = (clearRolledValue = false) => {
    hpRollRequestRef.current = null;
    setRollingHp(false);
    setHpRollError(null);
    if (clearRolledValue && hasAppliedHpRollRef.current) {
      hasAppliedHpRollRef.current = false;
      setHp("");
      setHpRoll(null);
    }
  };
  const closeWizard = () => { invalidateHpRoll(); onClose(); };
  const [hpPreset, setHpPreset] = useState<HpPreset>(mode === "create" ? "maximum" : "customRoll");
  const [skillRuleset, setSkillRuleset] = useState<SkillRuleset>("pathfinder");
  const savedSkillOptions = sheet.character.workbookOptions ?? {};
  const [skillMode, setSkillMode] = useState<SkillMode>(mode === "create" ? "background" : savedSkillOptions.skillMode ?? (savedSkillOptions.backgroundSkills === false ? "classic" : "background"));
  const [minimumFourSkills, setMinimumFourSkills] = useState(mode === "level-up" && (savedSkillOptions.minimumFourPlusIntSkillRanks ?? false));
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [skillSearch, setSkillSearch] = useState("");
  const [choices, setChoices] = useState<ChoiceSelection[]>([]);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [acceptedOverrides, setAcceptedOverrides] = useState<Record<string, ReturnType<typeof acceptLifecycleWarning>>>({});
  const [error, setError] = useState<string | null>(null);
  const levelProfile = useMemo(() => mode === "create" ? profileForCreate(trackCount, hpPreset, skillRuleset) : profileForAdvancement(sheet.character, hpPreset, skillRuleset), [mode, trackCount, sheet.character, hpPreset, skillRuleset]);
  const homebrewId = homebrewName.trim() ? `homebrew.local.${slug(homebrewName)}` : "";
  const optionNames = homebrewOptions.split(",").map((option) => option.trim()).filter(Boolean);
  const localProgression: ProgressionDefinition | undefined = mode === "create" && homebrewId && Number(homebrewHd) > 0 ? {
    id: homebrewId, name: homebrewName.trim(), hitDieSides: Number(homebrewHd), babProgression: homebrewBab,
    saveProgressions: { fortitude: homebrewFort, reflex: homebrewRef, will: homebrewWill }, skillPointsPerLevel: Number(homebrewSkills) || 0,
    features: homebrewFeature.trim() ? [{ id: "homebrew-feature", name: homebrewFeature.trim(), level: 1, ...(homebrewPrompt.trim() ? { choices: [{ id: "homebrew-choice", prompt: homebrewPrompt.trim(), minimum: 1, maximum: 1, options: optionNames.map((name) => ({ id: slug(name), name })), allowCustom: true }] } : {}) }] : [],
  } : undefined;
  const characterCustom = mode === "level-up" ? sheet.character.customProgressions : undefined;
  const customProgressions = { ...(characterCustom ?? {}), ...(localProgression ? { [localProgression.id]: localProgression } : {}) };
  const catalog = { ...rulesCatalogs.progressionCatalog, ...customProgressions };
  const options = progressionChoicesForCampaign(levelProfile, rulesCatalogs, Object.keys(customProgressions).length ? customProgressions : undefined);
  const visibleOptions = options.filter((item) => item.name.toLocaleLowerCase().includes(progressionSearch.trim().toLocaleLowerCase()) || Object.values(progressions).includes(item.id));
  const previewHpSource = () => {
    if (mode !== "level-up") return undefined;
    let best: { trackId: string; progressionId: string; sides: number; key: string } | undefined;
    for (const track of levelProfile.tracks) {
      const progressionId = progressions[track.id];
      const sides = progressionId ? catalog[progressionId]?.hitDieSides : undefined;
      if (!progressionId || !sides) continue;
      if (!best || sides > best.sides)
        best = { trackId: track.id, progressionId, sides, key: `${track.id}:${progressionId}:${sides}` };
    }
    return best;
  };
  const makeProposal = () => {
    const selected = levelProfile.tracks.flatMap((track) => progressions[track.id] ? [{ level: mode === "create" ? 1 : (sheet.character.advancementSlots?.length ?? 0) + 1, trackId: track.id, progressionId: progressions[track.id]! }] : []);
    if (mode === "create") {
      let proposal = beginCharacterCreation(levelProfile, rulesCatalogs);
      const completeAbilities = abilityIds.every((id) => abilityValues[id].trim() !== "");
      proposal = proposeCharacterCreation(proposal, { character: { id: creationId, name: name.trim(), campaignId: levelProfile.id, workbookOptions: { skillMode, backgroundSkills: skillMode === "background" || skillMode === "ultimate-psionics-background", minimumFourPlusIntSkillRanks: minimumFourSkills }, ...(Object.keys(customProgressions).length ? { customProgressions } : {}), ...(completeAbilities ? { baseAbilities: Object.fromEntries(abilityIds.map((id) => [id, Number(abilityValues[id])])) as CharacterInput["baseAbilities"] } : {}), attacks: [], features: [], damageTaken: 0, temporaryHp: 0 }, progressionSelections: selected, skillAllocations: [{ level: 1, ranks }], choiceSelections: choices, overrides: Object.values(acceptedOverrides) });
      return proposal;
    }
    let proposal = beginAdvancement(sheet.character, levelProfile, rulesCatalogs);
    const selectedHpSource = previewHpSource();
    const hasMatchingRoll = hpRoll !== null && hpRoll.key === selectedHpSource?.key;
    proposal = proposeAdvancement(proposal, { progressionChoices: progressions, ...(hpPreset === "customRoll" ? { hpAcquisition: { amount: Number(hp), method: "rolled" as const, ...(hasMatchingRoll ? { note: `Rolled d${selectedHpSource!.sides}: ${hpRoll!.faces.join(", ")}` } : {}) } } : {}), skillAllocation: { ranks }, choiceSelections: choices, overrides: Object.values(acceptedOverrides) });
    return proposal;
  };
  let proposal: CharacterCreationProposal | AdvancementProposal;
  let preview: ReturnType<typeof previewCharacterCreation> | ReturnType<typeof previewAdvancement>;
  let validation: ReturnType<typeof validateCharacterCreation> | ReturnType<typeof validateAdvancement>;
  try {
    proposal = makeProposal();
    preview = mode === "create" ? previewCharacterCreation(proposal as CharacterCreationProposal) : previewAdvancement(proposal as AdvancementProposal);
    validation = mode === "create" ? validateCharacterCreation(proposal as CharacterCreationProposal) : validateAdvancement(proposal as AdvancementProposal);
  } catch (failure) {
    const message = errorText(failure);
    return <div className="lifecycle-backdrop"><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create character" : "Level up"}><button onClick={closeWizard}>Cancel</button><p role="alert">{message}</p></section></div>;
  }
  const candidate = preview.after;
  const skillPreview = Array.isArray(preview.skills) ? preview.skills[0] : preview.skills;
  const skillsForAllocation = Object.values(preview.after?.skills ?? {}).sort((left, right) => Number(right.classSkill) - Number(left.classSkill) || left.label.localeCompare(right.label));
  const matchingSkills = skillsForAllocation.filter((skill) => skill.label.toLocaleLowerCase().includes(skillSearch.trim().toLocaleLowerCase()));
  const hpPreview = Array.isArray(preview.hp) ? preview.hp[0] : preview.hp;
  const level = mode === "create" ? 1 : (sheet.character.advancementSlots?.length ?? 0) + 1;
  const updateChoice = (requirement: Extract<LifecycleChoiceRequirement, { kind: "feature" }>, optionIds: string[]) => {
    const answer = customAnswers[lifecycleChoiceKey(requirement.reference)] ?? "";
    setChoices((current) => updateLifecycleChoice(current, requirement.reference, optionIds, answer));
  };
  const changeSkillMode = (next: SkillMode) => {
    if (next === skillMode) return;
    if (Object.values(ranks).some((rank) => rank > 0) && !window.confirm("Changing skill variant will clear the ranks allocated in this wizard. Continue?")) return;
    setRanks({});
    setSkillSearch("");
    setAcceptedOverrides({});
    setSkillMode(next);
  };
  const commit = async () => {
    if (savingRef.current || hpRollRequestRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const committed = mode === "create" ? commitCharacterCreation(proposal as CharacterCreationProposal) : commitAdvancement(proposal as AdvancementProposal);
      const canonical = parseCharacterInput(committed);
      const ok = await sheet.commitLifecycleCharacter(canonical, mode === "create" ? "Character created" : `Advanced to level ${level}`);
      if (ok) closeWizard();
    } catch (failure) { setError(errorText(failure)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const rollHpForLevel = async () => {
    const source = previewHpSource();
    if (!source || hpPreset !== "customRoll" || hpRollRequestRef.current || savingRef.current) return;
    // The request owns its result only until an edit, dismissal, or newer roll.
    const request = { sequence: ++hpRollSequenceRef.current };
    hpRollRequestRef.current = request;
    setRollingHp(true);
    setHpRollError(null);
    try {
      const plan: RollPlan = {
        id: `hp:${sheet.character.id}:${level}:${globalThis.crypto?.randomUUID?.() ?? `${creationId}-${request.sequence}`}`,
        characterId: sheet.character.id,
        label: `Level ${level} HP · d${source.sides}`,
        dice: [{ sides: source.sides, count: 1 }],
        modifier: 0,
        context: { kind: "damage", actorCharacterId: sheet.character.id, action: { kind: "other" } },
        outcomePolicy: plainOutcomePolicy,
        provenance: { modifier: [], excluded: [] },
      };
      const result = await sheet.rollPlan(plan);
      if (hpRollRequestRef.current === request) {
        if (result) {
          hasAppliedHpRollRef.current = true;
          setHp(String(result.total));
          setHpRoll({ key: source.key, faces: result.faces });
        } else {
          setHpRollError("HP roll did not complete. Try again or enter your result.");
        }
      }
    } catch (failure) {
      if (hpRollRequestRef.current === request) setHpRollError(errorText(failure));
    } finally {
      if (hpRollRequestRef.current === request) {
        hpRollRequestRef.current = null;
        setRollingHp(false);
      }
    }
  };
  const applyAbilityLine = () => {
    const values = abilityLine.trim().split(/[\s,;]+/).filter(Boolean);
    if (values.length !== abilityIds.length || values.some((value) => !/^\d+$/.test(value))) {
      setAbilityLineError("Enter six whole-number scores in STR, DEX, CON, INT, WIS, CHA order.");
      return;
    }
    setAbilityValues(Object.fromEntries(abilityIds.map((id, index) => [id, values[index]!])) as Record<AbilityId, string>);
    setAbilityLineError(null);
  };
  return <div className="lifecycle-backdrop"><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create character" : "Level up"}>
    <header><div><span className="eyebrow">{mode === "create" ? "CHARACTER CREATION" : "LEVEL UP"}</span><h2>{mode === "create" ? "Create character" : `Level ${level - 1} → ${level}`}</h2></div><button type="button" disabled={saving} onClick={closeWizard}>Cancel</button></header>
    <nav aria-label="Workflow steps">{["Identity", "Progression", "Choices", "Review"].map((label, index) => <button key={label} disabled={saving} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    {step === 0 && <div className="lifecycle-fields">
      {mode === "create" ? <><label>Character name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Campaign profile<input value="Default campaign" readOnly /></label><label>Advancement tracks<select value={trackCount} onChange={(event) => setTrackCount(Number(event.target.value))}><option value={1}>Single track</option><option value={2}>Gestalt (two tracks)</option><option value={3}>Three tracks</option></select></label><fieldset><legend>Ability scores</legend><div className="lifecycle-quick-abilities"><label>Paste six scores in STR, DEX, CON, INT, WIS, CHA order<input aria-label="Six ability scores in order" value={abilityLine} onChange={(event) => { setAbilityLine(event.target.value); setAbilityLineError(null); }} placeholder="15, 14, 13, 12, 10, 8" /></label><button type="button" onClick={applyAbilityLine}>Apply scores</button></div>{abilityLineError && <small className="lifecycle-inline-error" role="alert">{abilityLineError}</small>}<div className="lifecycle-abilities">{abilityIds.map((id) => { const score = Number(abilityValues[id]); const hasScore = abilityValues[id].trim() !== "" && Number.isFinite(score); return <label key={id}>{abilities[id]}<input type="number" aria-label={abilities[id]} value={abilityValues[id]} onChange={(event) => setAbilityValues((current) => ({ ...current, [id]: event.target.value }))} /><small>{hasScore ? `Modifier ${formatModifier(Math.floor((score - 10) / 2))}` : "Enter a score to see its modifier"}</small></label>; })}</div></fieldset></> : <><p>Current level: <b>{level - 1}</b>. Choose a progression for every campaign track.</p>{preview.kind === "advancement" && preview.before && <p>Current max HP {preview.before.maxHp.value}; damage taken {sheet.character.damageTaken}; temporary HP {sheet.character.temporaryHp}.</p>}</>}
    </div>}
    {step === 1 && <div className="lifecycle-fields"><label>Hit point method<select aria-label="Hit point method" value={hpPreset} onChange={(event) => { invalidateHpRoll(true); setHpPreset(event.target.value as HpPreset); }}><option value="averageDown">Average</option><option value="averageDownFirstMax">Average (1st max)</option><option value="averageUp">Average round up</option><option value="averageUpFirstMax">Average round up (1st max)</option><option value="maximum">Maximum</option><option value="customRoll">Custom rolled</option></select><small>{hpPreset === "customRoll" ? "Roll the winning class hit die or enter a result from your own dice." : "HP is calculated from the winning hit die; Constitution is added separately."}</small></label>{mode === "create" && <details className="lifecycle-optional"><summary>Add a custom or monster progression (optional)</summary><fieldset><p>Optional. This class content stays with the character. Choose its hit die, BAB and saves; it can grant one named level 1 feature choice.</p><label>Progression name<input aria-label="Custom progression name" value={homebrewName} onChange={(event) => setHomebrewName(event.target.value)} /></label><label>Hit die<select aria-label="Custom progression hit die" value={homebrewHd} onChange={(event) => setHomebrewHd(event.target.value)}><option value="">Choose a hit die</option>{[4, 6, 8, 10, 12, 20].map((die) => <option key={die} value={die}>d{die}</option>)}</select></label><label>BAB progression<select aria-label="Custom progression BAB" value={homebrewBab} onChange={(event) => setHomebrewBab(event.target.value as ProgressionDefinition["babProgression"])}>{[["full", "Full"], ["threeQuarters", "Three-quarters"], ["half", "Half"], ["quarter", "Quarter"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Fortitude save<select aria-label="Custom Fortitude progression" value={homebrewFort} onChange={(event) => setHomebrewFort(event.target.value as ProgressionDefinition["saveProgressions"]["fortitude"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Reflex save<select aria-label="Custom Reflex progression" value={homebrewRef} onChange={(event) => setHomebrewRef(event.target.value as ProgressionDefinition["saveProgressions"]["reflex"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Will save<select aria-label="Custom Will progression" value={homebrewWill} onChange={(event) => setHomebrewWill(event.target.value as ProgressionDefinition["saveProgressions"]["will"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Skill points per level<input aria-label="Custom progression skill points" type="number" min="0" value={homebrewSkills} onChange={(event) => setHomebrewSkills(event.target.value)} /></label><label>Level 1 feature name<input aria-label="Custom feature name" value={homebrewFeature} onChange={(event) => setHomebrewFeature(event.target.value)} /></label><label>Feature choice prompt<input aria-label="Custom feature choice prompt" value={homebrewPrompt} onChange={(event) => setHomebrewPrompt(event.target.value)} /></label><label>Choice options (comma separated)<input aria-label="Custom feature choice options" value={homebrewOptions} onChange={(event) => setHomebrewOptions(event.target.value)} /></label>{localProgression && <p>Available as {localProgression.name} · d{localProgression.hitDieSides} · {localProgression.skillPointsPerLevel} skill points.</p>}</fieldset></details>}{levelProfile.tracks.map((track) => <label className="lifecycle-progression-picker" key={track.id}>{track.name}<input type="search" aria-label={`Search ${track.name} progressions`} placeholder="Search classes and progressions" value={progressionSearch} onChange={(event) => setProgressionSearch(event.target.value)} /><small aria-live="polite">{visibleOptions.length} matches</small><select aria-label={`${track.name} progression`} value={progressions[track.id] ?? ""} onChange={(event) => { invalidateHpRoll(true); setProgressions((current) => ({ ...current, [track.id]: event.target.value })); }}><option value="">Choose a progression</option>{visibleOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · d{item.hitDieSides} · {item.skillPointsPerLevel} skill points</option>)}</select>{visibleOptions.length === 0 && <small>No matching progressions. Try another search.</small>}<small>{options.find((item) => item.id === progressions[track.id])?.description}</small></label>)}{mode === "level-up" && (hpPreset === "customRoll" ? (() => { const source = previewHpSource(); return <div className="lifecycle-hp-roll"><label>HP gained before Constitution<input aria-label="HP gained" type="number" min="1" value={hp} onChange={(event) => { invalidateHpRoll(); hasAppliedHpRollRef.current = false; setHp(event.target.value); setHpRoll(null); }} /></label><div><button type="button" disabled={!source || rollingHp} onClick={() => void rollHpForLevel()}>{rollingHp ? "Rolling…" : source ? "Roll winning HD · d" + source.sides : "Choose progression"}</button>{hpRoll && hpRoll.key === source?.key && <small>Rolled {hpRoll.faces.join(", ")} on d{source.sides}</small>}{hpRollError && <small className="lifecycle-inline-error" role="alert">{hpRollError}</small>}</div></div>; })() : <p>HP gained is calculated using the selected hit point method; Constitution is added separately.</p>)}<section className="lifecycle-skill-allocation">{mode === "create" ? <><label>Skill variant<select aria-label="Creation skill variant" value={skillMode} onChange={(event) => changeSkillMode(event.target.value as SkillMode)}>{Object.entries(skillModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>Choose before allocating ranks. Changing the variant clears this wizard’s rank allocations after confirmation.</small></label><label><input type="checkbox" aria-label="Creation minimum 4 + INT skill ranks" checked={minimumFourSkills} disabled={skillMode === "consolidated"} onChange={(event) => { setMinimumFourSkills(event.target.checked); setAcceptedOverrides({}); }} />Minimum 4 + INT skill ranks{skillMode === "consolidated" && <small>Consolidated Skills uses its own half-rank budget; this option does not apply.</small>}</label></> : <p>Skill variant: {skillModes[skillMode]}{minimumFourSkills && skillMode !== "consolidated" ? " · Minimum 4 + INT skill ranks" : ""}. Saved character options apply to this level.</p>}<label className="lifecycle-skill-ruleset">Skill-rank rules<select aria-label="Skill-rank rules" value={skillRuleset} onChange={(event) => setSkillRuleset(event.target.value as SkillRuleset)}><option value="pathfinder">Pathfinder · 1 point per rank, max ranks = character level</option><option value="dnd35">D&amp;D 3.5 · cross-class ranks cost 2, class cap = level + 3</option></select><small>Class skills come from all selected progressions. Cross-class caps in D&amp;D 3.5 are half the class-skill cap.</small></label><h3>Skill ranks</h3><p>Available skill points: {skillPreview?.available ?? "Choose progressions to calculate"} · ranks assigned: {skillPreview?.allocated ?? 0} · points used: {skillPreview?.budgetUsed ?? 0} · points remaining: {skillPreview?.remaining ?? "—"}</p><label className="lifecycle-skill-search">Find a skill<input type="search" aria-label="Find a skill" placeholder="Search skills" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} /></label><p className="lifecycle-skill-count" aria-live="polite">Showing {matchingSkills.length} of {skillsForAllocation.length} skills. Class skills appear first.</p>{matchingSkills.map((skill) => <label className="lifecycle-skill-entry" key={skill.id}><span>{skill.label}<small>{skill.classSkill ? "Class skill" : "Cross-class"}</small></span><input aria-label={`${skill.label} ranks for this level`} type="number" min="0" step="0.5" value={ranks[skill.id] ?? 0} onChange={(event) => setRanks((current) => ({ ...current, [skill.id]: Math.max(0, Number(event.target.value) || 0) }))} /></label>)}{matchingSkills.length === 0 && <p className="lifecycle-skill-empty">No skills match this search.</p>}</section></div>}
    {step === 2 && <div className="lifecycle-fields">{preview.requirements.length ? preview.requirements.map((requirement) => requirement.kind === "feature" ? <fieldset key={lifecycleChoiceKey(requirement.reference)}><legend>{requirement.progressionName}: {requirement.featureName}</legend><p>{requirement.requirement.prompt} · choose {requirement.requirement.minimum}{requirement.requirement.maximum !== requirement.requirement.minimum ? `–${requirement.requirement.maximum}` : ""}</p><select multiple={requirement.requirement.maximum > 1} aria-label={requirement.requirement.prompt} value={requirement.requirement.maximum > 1 ? requirement.selection?.optionIds ?? [] : requirement.selection?.optionIds[0] ?? ""} onChange={(event) => updateChoice(requirement, Array.from(event.currentTarget.selectedOptions, (option) => option.value).filter(Boolean))}><option value="">Choose an option</option>{(requirement.requirement.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>{requirement.requirement.allowCustom && <label>Custom answer<input aria-label={`Custom answer for ${requirement.requirement.prompt}`} value={customAnswers[lifecycleChoiceKey(requirement.reference)] ?? ""} onChange={(event) => { const value = event.target.value; setCustomAnswers((current) => ({ ...current, [lifecycleChoiceKey(requirement.reference)]: value })); setChoices((current) => updateLifecycleChoice(current, requirement.reference, requirement.selection?.optionIds ?? [], value)); }} /></label>}</fieldset> : <p key={requirement.id}>{requirement.prompt}</p>) : <p>No additional feature choices are required.</p>}</div>}
    {step === 3 && <div className="lifecycle-fields"><h3>Review</h3><p>Skill variant: {skillModes[skillMode]}{minimumFourSkills && skillMode !== "consolidated" ? " · Minimum 4 + INT skill ranks" : ""}</p>{mode === "create" && <p>{name || "Unnamed character"} · {trackCount}-track · level 1</p>}<ul>{preview.changes.map((change, index) => <li key={`${change.kind}-${index}`}>{change.label}{change.before !== undefined ? `: ${change.before} → ${change.after}` : ""}</li>)}</ul>{candidate && <><p>BAB {candidate.bab.value}; saves Fort {candidate.saves.fortitude.value}, Ref {candidate.saves.reflex.value}, Will {candidate.saves.will.value}; max HP {candidate.maxHp.value}.</p><p>{levelProfile.tracks.map((track) => `${track.name}: ${catalog[progressions[track.id] ?? ""]?.name ?? "not selected"}`).join(" · ")}</p><p>Progression levels: {Object.entries(candidate.advancement?.progressionLevels ?? {}).map(([id, value]) => `${catalog[id]?.name ?? id} ${value.value}`).join(" · ")}</p>{hpPreview && <p>Winning hit die: d{hpPreview.winningHitDie?.sides ?? "?"}{hpPreview.winningHitDie ? ` — ${catalog[hpPreview.winningHitDie.progressionId]?.name ?? hpPreview.winningHitDie.progressionId}, ${hpPreview.winningHitDie.trackId}` : ""}. HP gained before Constitution: {hpPreview.amount ?? "pending"}; acquisition: {hpPreview.acquisition?.method ?? "pending"}.</p>}{skillPreview && <p>Skill ranks: {skillPreview.allocated} assigned; {skillPreview.budgetUsed ?? skillPreview.allocated} skill points used of {skillPreview.available ?? "manual"}; {skillPreview.remaining ?? 0} remaining.</p>}</>}
      <section aria-label="Validation"><h3>Blocking errors</h3>{validation.errors.length ? <ul>{validation.errors.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul> : <p>None</p>}<h3>Warnings</h3>{validation.warnings.length ? validation.warnings.map((issue, index) => { const key = `${issue.code}-${JSON.stringify(issue.scope ?? {})}`; return <article key={key}><p>{issue.message}</p>{issue.requiresOverride && <><label>Reason for this override<textarea aria-label={`Reason for ${issue.code}`} value={overrideReasons[key] ?? ""} onChange={(event) => setOverrideReasons((current) => ({ ...current, [key]: event.target.value }))} /></label><button type="button" disabled={!overrideReasons[key]?.trim()} onClick={() => setAcceptedOverrides((current) => ({ ...current, [key]: acceptLifecycleWarning(`override-${key}`, issue, overrideReasons[key]!) }))}>{acceptedOverrides[key] ? "Override recorded" : "Accept this warning"}</button></>}</article>; }) : <p>None</p>}</section>{error && <p role="alert">{error}</p>}</div>}
    <footer><button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={saving || step === 0}>Back</button><button type="button" onClick={() => setStep(Math.min(3, step + 1))} disabled={saving || step === 3}>Continue</button>{step === 3 && <button type="button" className="primary" onClick={() => void commit()} disabled={saving || rollingHp || !validation.canCommit || (mode === "create" && (!name.trim() || !abilityIds.every((id) => abilityValues[id].trim() !== "")))}>{saving ? "Saving…" : mode === "create" ? "Create character" : "Confirm level up"}</button>}</footer>
  </section></div>;
}
