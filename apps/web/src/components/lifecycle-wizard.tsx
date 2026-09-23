import { useMemo, useState } from "react";
import {
  acceptLifecycleWarning, beginAdvancement, beginCharacterCreation, commitAdvancement, commitCharacterCreation,
  previewAdvancement, previewCharacterCreation, progressionChoicesForCampaign,
  proposeAdvancement, proposeCharacterCreation, validateAdvancement, validateCharacterCreation,
  type AdvancementProposal, type CampaignCharacterProfile, type CharacterCreationProposal,
  type ChoiceSelection, type LifecycleChoiceRequirement,
} from "@threepointpf/rules-core";
import { abilityIds, parseCharacterInput, type AbilityId, type CharacterInput, type ProgressionDefinition } from "@threepointpf/rules-schema";
import { rulesCatalogs } from "@threepointpf/rules-data";
import { errorText, slug } from "../lib/format";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

type Mode = "create" | "level-up";
const abilities: Record<AbilityId, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

function profileForCreate(tracks: number): CampaignCharacterProfile {
  return { id: "player-default", name: "Default campaign", startingLevel: 1,
    tracks: Array.from({ length: tracks }, (_, index) => ({ id: `track-${index + 1}`, name: tracks === 1 ? "Class / progression" : `Track ${String.fromCharCode(64 + index + 1)}` })),
    hpPolicy: { firstLevel: { kind: "maximum" }, laterLevels: { kind: "manual" } },
    skillAllocationPolicy: { kind: "calculated", includeIntelligenceModifier: true, minimumPerLevel: 1 }, allowCustomProgressions: true, allowManualOverrides: true };
}

function profileForAdvancement(character: CharacterInput): CampaignCharacterProfile {
  const tracks = character.advancementSlots?.[0]?.tracks ?? [];
  return { id: character.campaignId ?? "current-campaign", startingLevel: 1,
    tracks: tracks.map((track, index) => ({ id: track.id, name: tracks.length === 1 ? "Class / progression" : `Track ${String.fromCharCode(64 + index + 1)}` })),
    hpPolicy: { firstLevel: { kind: "maximum" }, laterLevels: { kind: "manual" } },
    skillAllocationPolicy: { kind: "calculated", includeIntelligenceModifier: true, minimumPerLevel: 1 }, allowCustomProgressions: true, allowManualOverrides: true };
}

function choiceSelection(requirement: Extract<LifecycleChoiceRequirement, { kind: "feature" }>, optionIds: string[]): ChoiceSelection {
  return { id: `${requirement.reference.featureId}-${requirement.level}-${requirement.reference.trackId}`, requirement: requirement.reference, optionIds };
}

export function LifecycleWizard({ mode, sheet, onClose }: { mode: Mode; sheet: CharacterSheet; onClose: () => void }) {
  const [step, setStep] = useState(0);
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
  const [progressions, setProgressions] = useState<Record<string, string>>({});
  const [hp, setHp] = useState("");
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [choices, setChoices] = useState<ChoiceSelection[]>([]);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [acceptedOverrides, setAcceptedOverrides] = useState<Record<string, ReturnType<typeof acceptLifecycleWarning>>>({});
  const [error, setError] = useState<string | null>(null);
  const levelProfile = useMemo(() => mode === "create" ? profileForCreate(trackCount) : profileForAdvancement(sheet.character), [mode, trackCount, sheet.character]);
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
  const makeProposal = () => {
    const selected = levelProfile.tracks.flatMap((track) => progressions[track.id] ? [{ level: mode === "create" ? 1 : (sheet.character.advancementSlots?.length ?? 0) + 1, trackId: track.id, progressionId: progressions[track.id]! }] : []);
    if (mode === "create") {
      let proposal = beginCharacterCreation(levelProfile, rulesCatalogs);
      const completeAbilities = abilityIds.every((id) => abilityValues[id].trim() !== "");
      proposal = proposeCharacterCreation(proposal, { character: { id: creationId, name: name.trim(), campaignId: levelProfile.id, ...(Object.keys(customProgressions).length ? { customProgressions } : {}), ...(completeAbilities ? { baseAbilities: Object.fromEntries(abilityIds.map((id) => [id, Number(abilityValues[id])])) as CharacterInput["baseAbilities"] } : {}), attacks: [], features: [], damageTaken: 0, temporaryHp: 0 }, progressionSelections: selected, skillAllocations: [{ level: 1, ranks }], choiceSelections: choices, overrides: Object.values(acceptedOverrides) });
      return proposal;
    }
    let proposal = beginAdvancement(sheet.character, levelProfile, rulesCatalogs);
    proposal = proposeAdvancement(proposal, { progressionChoices: progressions, hpAcquisition: { amount: Number(hp) }, skillAllocation: { ranks }, choiceSelections: choices, overrides: Object.values(acceptedOverrides) });
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
    return <div className="lifecycle-backdrop"><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create character" : "Level up"}><button onClick={onClose}>Cancel</button><p role="alert">{message}</p></section></div>;
  }
  const candidate = preview.after;
  const skillPreview = Array.isArray(preview.skills) ? preview.skills[0] : preview.skills;
  const hpPreview = Array.isArray(preview.hp) ? preview.hp[0] : preview.hp;
  const level = mode === "create" ? 1 : (sheet.character.advancementSlots?.length ?? 0) + 1;
  const updateChoice = (requirement: Extract<LifecycleChoiceRequirement, { kind: "feature" }>, optionIds: string[]) => {
    const answer = customAnswers[requirement.reference.requirementId]?.trim();
    const selection = choiceSelection(requirement, optionIds);
    if (answer) selection.customOptions = [{ id: `custom-${requirement.reference.requirementId}`, name: answer }];
    setChoices((current) => [...current.filter((choice) => choice.requirement.requirementId !== requirement.reference.requirementId || choice.requirement.trackId !== requirement.reference.trackId), ...(optionIds.length || answer ? [selection] : [])]);
  };
  const commit = async () => {
    setError(null);
    try {
      const committed = mode === "create" ? commitCharacterCreation(proposal as CharacterCreationProposal) : commitAdvancement(proposal as AdvancementProposal);
      const canonical = parseCharacterInput(committed);
      const ok = await sheet.commitLifecycleCharacter(canonical, mode === "create" ? "Character created" : `Advanced to level ${level}`);
      if (ok) onClose();
    } catch (failure) { setError(errorText(failure)); }
  };
  return <div className="lifecycle-backdrop"><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create character" : "Level up"}>
    <header><div><span className="eyebrow">{mode === "create" ? "CHARACTER CREATION" : "LEVEL UP"}</span><h2>{mode === "create" ? "Create character" : `Level ${level - 1} → ${level}`}</h2></div><button type="button" onClick={onClose}>Cancel</button></header>
    <nav aria-label="Workflow steps">{["Identity", "Progression", "Choices", "Review"].map((label, index) => <button key={label} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    {step === 0 && <div className="lifecycle-fields">
      {mode === "create" ? <><label>Character name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Campaign profile<input value="Default campaign · client-side profile" readOnly /></label><label>Advancement tracks<select value={trackCount} onChange={(event) => setTrackCount(Number(event.target.value))}><option value={1}>Single track</option><option value={2}>Gestalt (two tracks)</option><option value={3}>Three tracks</option></select></label><fieldset><legend>Ability scores (enter all six)</legend><div className="lifecycle-abilities">{abilityIds.map((id) => <label key={id}>{abilities[id]}<input type="number" aria-label={abilities[id]} value={abilityValues[id]} onChange={(event) => setAbilityValues((current) => ({ ...current, [id]: event.target.value }))} /></label>)}</div></fieldset></> : <><p>Current level: <b>{level - 1}</b>. Choose a progression for every campaign track.</p>{preview.kind === "advancement" && preview.before && <p>Current max HP {preview.before.maxHp.value}; damage taken {sheet.character.damageTaken}; temporary HP {sheet.character.temporaryHp}.</p>}</>}
    </div>}
    {step === 1 && <div className="lifecycle-fields">{mode === "create" && <fieldset><legend>Add a custom or monster progression</legend><p>Optional. This class content stays with the character. Choose its hit die, BAB and saves; it can grant one named level 1 feature choice.</p><label>Progression name<input aria-label="Custom progression name" value={homebrewName} onChange={(event) => setHomebrewName(event.target.value)} /></label><label>Hit die<select aria-label="Custom progression hit die" value={homebrewHd} onChange={(event) => setHomebrewHd(event.target.value)}><option value="">Choose a hit die</option>{[4, 6, 8, 10, 12, 20].map((die) => <option key={die} value={die}>d{die}</option>)}</select></label><label>BAB progression<select aria-label="Custom progression BAB" value={homebrewBab} onChange={(event) => setHomebrewBab(event.target.value as ProgressionDefinition["babProgression"])}>{[["full", "Full"], ["threeQuarters", "Three-quarters"], ["half", "Half"], ["quarter", "Quarter"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Fortitude save<select aria-label="Custom Fortitude progression" value={homebrewFort} onChange={(event) => setHomebrewFort(event.target.value as ProgressionDefinition["saveProgressions"]["fortitude"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Reflex save<select aria-label="Custom Reflex progression" value={homebrewRef} onChange={(event) => setHomebrewRef(event.target.value as ProgressionDefinition["saveProgressions"]["reflex"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Will save<select aria-label="Custom Will progression" value={homebrewWill} onChange={(event) => setHomebrewWill(event.target.value as ProgressionDefinition["saveProgressions"]["will"])}><option value="good">Good</option><option value="poor">Poor</option><option value="prestigeGood">Prestige good</option><option value="prestigePoor">Prestige poor</option></select></label><label>Skill points per level<input aria-label="Custom progression skill points" type="number" min="0" value={homebrewSkills} onChange={(event) => setHomebrewSkills(event.target.value)} /></label><label>Level 1 feature name<input aria-label="Custom feature name" value={homebrewFeature} onChange={(event) => setHomebrewFeature(event.target.value)} /></label><label>Feature choice prompt<input aria-label="Custom feature choice prompt" value={homebrewPrompt} onChange={(event) => setHomebrewPrompt(event.target.value)} /></label><label>Choice options (comma separated)<input aria-label="Custom feature choice options" value={homebrewOptions} onChange={(event) => setHomebrewOptions(event.target.value)} /></label>{localProgression && <p>Available as {localProgression.name} · d{localProgression.hitDieSides} · {localProgression.skillPointsPerLevel} skill points.</p>}</fieldset>}{levelProfile.tracks.map((track) => <label key={track.id}>{track.name}<select aria-label={`${track.name} progression`} value={progressions[track.id] ?? ""} onChange={(event) => setProgressions((current) => ({ ...current, [track.id]: event.target.value }))}><option value="">Choose a progression</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name} · d{item.hitDieSides} · {item.skillPointsPerLevel} skill points</option>)}</select><small>{options.find((item) => item.id === progressions[track.id])?.description}</small></label>)}{mode === "level-up" && <label>HP gained before Constitution<input aria-label="HP gained" type="number" min="1" value={hp} onChange={(event) => setHp(event.target.value)} /></label>}<section className="lifecycle-skill-allocation"><h3>Skill ranks</h3><p>Available: {skillPreview?.available ?? "Choose progressions to calculate"} · allocated: {skillPreview?.allocated ?? 0} · remaining: {skillPreview?.remaining ?? "—"}</p>{Object.values(preview.after?.skills ?? {}).map((skill) => <label key={skill.id}>{skill.label}<input aria-label={`${skill.label} ranks for this level`} type="number" min="0" value={ranks[skill.id] ?? 0} onChange={(event) => setRanks((current) => ({ ...current, [skill.id]: Math.max(0, Number(event.target.value) || 0) }))} /></label>)}</section></div>}
    {step === 2 && <div className="lifecycle-fields">{preview.requirements.length ? preview.requirements.map((requirement) => requirement.kind === "feature" ? <fieldset key={requirement.reference.requirementId + requirement.reference.trackId}><legend>{requirement.progressionName}: {requirement.featureName}</legend><p>{requirement.requirement.prompt} · choose {requirement.requirement.minimum}{requirement.requirement.maximum !== requirement.requirement.minimum ? `–${requirement.requirement.maximum}` : ""}</p><select multiple={requirement.requirement.maximum > 1} aria-label={requirement.requirement.prompt} value={choices.find((choice) => choice.requirement.requirementId === requirement.reference.requirementId)?.optionIds ?? []} onChange={(event) => updateChoice(requirement, Array.from(event.currentTarget.selectedOptions, (option) => option.value).filter(Boolean))}><option value="">Choose an option</option>{(requirement.requirement.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>{requirement.requirement.allowCustom && <label>Custom answer<input aria-label={`Custom answer for ${requirement.requirement.prompt}`} value={customAnswers[requirement.reference.requirementId] ?? ""} onChange={(event) => { const value = event.target.value; setCustomAnswers((current) => ({ ...current, [requirement.reference.requirementId]: value })); const selection = choiceSelection(requirement, choices.find((choice) => choice.requirement.requirementId === requirement.reference.requirementId)?.optionIds ?? []); selection.customOptions = value.trim() ? [{ id: `custom-${requirement.reference.requirementId}`, name: value.trim() }] : undefined; setChoices((current) => [...current.filter((choice) => choice.requirement.requirementId !== requirement.reference.requirementId || choice.requirement.trackId !== requirement.reference.trackId), ...(selection.optionIds.length || selection.customOptions?.length ? [selection] : [])]); }} /></label>}</fieldset> : <p key={requirement.id}>{requirement.prompt}</p>) : <p>No additional feature choices are required.</p>}</div>}
    {step === 3 && <div className="lifecycle-fields"><h3>Review</h3>{mode === "create" && <p>{name || "Unnamed character"} · {trackCount}-track · level 1</p>}<ul>{preview.changes.map((change, index) => <li key={`${change.kind}-${index}`}>{change.label}{change.before !== undefined ? `: ${change.before} → ${change.after}` : ""}</li>)}</ul>{candidate && <><p>BAB {candidate.bab.value}; saves Fort {candidate.saves.fortitude.value}, Ref {candidate.saves.reflex.value}, Will {candidate.saves.will.value}; max HP {candidate.maxHp.value}.</p><p>{levelProfile.tracks.map((track) => `${track.name}: ${catalog[progressions[track.id] ?? ""]?.name ?? "not selected"}`).join(" · ")}</p><p>Progression levels: {Object.entries(candidate.advancement?.progressionLevels ?? {}).map(([id, value]) => `${catalog[id]?.name ?? id} ${value.value}`).join(" · ")}</p>{hpPreview && <p>Winning hit die: d{hpPreview.winningHitDie?.sides ?? "?"}{hpPreview.winningHitDie ? ` — ${catalog[hpPreview.winningHitDie.progressionId]?.name ?? hpPreview.winningHitDie.progressionId}, ${hpPreview.winningHitDie.trackId}` : ""}. HP gained before Constitution: {hpPreview.amount ?? "pending"}; acquisition: {hpPreview.acquisition?.method ?? "pending"}.</p>}{skillPreview && <p>Skill ranks: {skillPreview.allocated} allocated of {skillPreview.available ?? "manual"}; {skillPreview.remaining ?? 0} remaining.</p>}</>}
      <section aria-label="Validation"><h3>Blocking errors</h3>{validation.errors.length ? <ul>{validation.errors.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul> : <p>None</p>}<h3>Warnings</h3>{validation.warnings.length ? validation.warnings.map((issue, index) => { const key = `${issue.code}-${JSON.stringify(issue.scope ?? {})}`; return <article key={key}><p>{issue.message}</p>{issue.requiresOverride && <><label>Reason for this override<textarea aria-label={`Reason for ${issue.code}`} value={overrideReasons[key] ?? ""} onChange={(event) => setOverrideReasons((current) => ({ ...current, [key]: event.target.value }))} /></label><button type="button" disabled={!overrideReasons[key]?.trim()} onClick={() => setAcceptedOverrides((current) => ({ ...current, [key]: acceptLifecycleWarning(`override-${key}`, issue, overrideReasons[key]!) }))}>{acceptedOverrides[key] ? "Override recorded" : "Accept this warning"}</button></>}</article>; }) : <p>None</p>}</section>{error && <p role="alert">{error}</p>}</div>}
    <footer><button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button><button type="button" onClick={() => setStep(Math.min(3, step + 1))} disabled={step === 3}>Continue</button>{step === 3 && <button type="button" className="primary" onClick={() => void commit()} disabled={!validation.canCommit || (mode === "create" && (!name.trim() || !abilityIds.every((id) => abilityValues[id].trim() !== "")))}>{mode === "create" ? "Create character" : "Confirm level up"}</button>}</footer>
  </section></div>;
}
