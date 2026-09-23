import { useState, type ChangeEvent } from "react";
import { abilityCatalog } from "@threepointpf/rules-data";
import {
  cloneAbilityDefinition,
  commitAbilityActivation,
  advanceAbilityResourceRound,
  createRechargeRollPlan,
  prepareAbilityExecution,
  refreshResource,
  restoreResource,
  spendResource,
  type ResourceFacts,
} from "@threepointpf/rules-core";
import type {
  AbilityActivationType,
  AbilityInstance,
  BonusType,
  DiceExpression,
  Effect,
  EffectApplicability,
  EffectTargetId,
  ResourceCostTiming,
  ResourceDefinition,
  ResourceMaximumTerm,
  ResourceRefreshRule,
} from "@threepointpf/rules-schema";
import { catalogValues, clone, describeEffect, nextId, slug } from "../lib/format";
import { bonusTypes, effectTargets } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

type EffectKind = Effect["kind"];

function selectedValues(event: ChangeEvent<HTMLSelectElement>): string[] {
  return [...event.currentTarget.selectedOptions].map((option) => option.value);
}

function TokenField({ label, values, onChange }: { label: string; values: string[]; onChange(values: string[]): void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || !/^[a-z0-9][a-z0-9._:-]*$/i.test(value) || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };
  return <div className="token-field"><label>{label}<input aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /></label><button className="button quiet" type="button" onClick={add}>Add</button>{values.map((value) => <span className="chip" key={value}>{value}<button aria-label={`Remove ${label} ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>×</button></span>)}</div>;
}

function parseDice(value: string): DiceExpression | undefined {
  const match = /^(\d+)d(\d+)$/i.exec(value.trim());
  if (!match) return undefined;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  return count > 0 && sides > 0 ? { count, sides } : undefined;
}

function resourceFacts(sheet: CharacterSheet): ResourceFacts {
  return {
    abilityModifier: (id, source = "current") => source === "base"
      ? Math.floor((sheet.character.baseAbilities[id] - 10) / 2)
      : sheet.derived.abilities[id].modifier.value,
    progressionLevel: (id) => sheet.derived.advancement?.progressionLevels[id]?.value ?? 0,
  };
}

function refreshLabel(refresh: ResourceRefreshRule): string {
  if (refresh.kind === "interval") return `every ${refresh.rounds} rounds`;
  if (refresh.kind === "rechargeRoll") return `recharge ${refresh.dice.count}d${refresh.dice.sides} rounds`;
  return refresh.kind;
}

function ResourceEditor({ sheet }: { sheet: CharacterSheet }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maximumKind, setMaximumKind] = useState<"fixed" | "manual" | "derived">("fixed");
  const [maximum, setMaximum] = useState("1");
  const [derivedAbility, setDerivedAbility] = useState<"str" | "dex" | "con" | "int" | "wis" | "cha">("cha");
  const [derivedAbilitySource, setDerivedAbilitySource] = useState<"base" | "current">("current");
  const [derivedTerms, setDerivedTerms] = useState<ResourceMaximumTerm[]>([]);
  const [refreshKind, setRefreshKind] = useState<ResourceRefreshRule["kind"]>("daily");
  const [refreshValue, setRefreshValue] = useState("1");

  const reset = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setMaximumKind("fixed");
    setMaximum("1");
    setDerivedTerms([]);
    setRefreshKind("daily");
    setRefreshValue("1");
  };
  const edit = (resource: ResourceDefinition) => {
    setEditingId(resource.id);
    setName(resource.name);
    setDescription(resource.description ?? "");
    setMaximumKind(resource.maximum.kind);
    setMaximum(String(resource.maximum.kind === "derived" ? (resource.maximum.base ?? 0) : resource.maximum.value));
    const term = resource.maximum.kind === "derived" ? resource.maximum.terms.find((item) => item.kind === "abilityModifier") : undefined;
    setDerivedTerms(resource.maximum.kind === "derived" ? clone(resource.maximum.terms) : []);
    if (term?.kind === "abilityModifier") setDerivedAbility(term.ability);
    if (term?.kind === "abilityModifier") setDerivedAbilitySource(term.source ?? "current");
    setRefreshKind(resource.refresh.kind);
    setRefreshValue(String(resource.refresh.kind === "interval" ? resource.refresh.rounds : resource.refresh.kind === "rechargeRoll" ? resource.refresh.dice.sides : 1));
  };
  const save = () => {
    const numeric = Number(maximum);
    if (!name.trim() || !Number.isInteger(numeric) || numeric < 0) {
      sheet.fail("A resource needs a name and a nonnegative whole maximum.");
      return;
    }
    const id = editingId ?? nextId(`resource-${slug(name) || "custom"}`, (sheet.character.resources ?? []).map((item) => item.id));
    const interval = Math.max(1, Math.floor(Number(refreshValue) || 1));
    const resource: ResourceDefinition = {
      id,
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      maximum: maximumKind === "derived"
        ? {
            kind: "derived",
            base: numeric,
            terms: derivedTerms.length
              ? derivedTerms.map((term) => term.kind === "abilityModifier" ? { ...term, ability: derivedAbility, source: derivedAbilitySource } : term)
              : [{ kind: "abilityModifier", ability: derivedAbility, source: derivedAbilitySource }],
          }
        : { kind: maximumKind, value: numeric },
      refresh: refreshKind === "interval"
        ? { kind: "interval", rounds: interval }
        : refreshKind === "rechargeRoll"
          ? { kind: "rechargeRoll", dice: { count: 1, sides: interval } }
          : { kind: refreshKind } as ResourceRefreshRule,
    };
    const resources = editingId
      ? (sheet.character.resources ?? []).map((item) => item.id === editingId ? resource : item)
      : [...(sheet.character.resources ?? []), resource];
    if (sheet.update({ resources }, `${editingId ? "Updated" : "Added"} ${resource.name}`)) reset();
  };
  const remove = (resource: ResourceDefinition) => {
    const users = (sheet.character.abilities ?? []).filter((ability) =>
      ability.costs?.some((cost) => cost.resourceId === resource.id),
    );
    if (users.length) {
      sheet.fail(`${resource.name} is used by ${users.map((item) => item.name).join(", ")}. Remove or repair those costs first.`);
      return;
    }
    sheet.update({
      resources: (sheet.character.resources ?? []).filter((item) => item.id !== resource.id),
      resourceStates: (sheet.character.resourceStates ?? []).filter((item) => item.resourceId !== resource.id),
    }, `Removed ${resource.name}`);
  };
  const mutate = async (operation: "spend" | "restore" | "refresh", id: string) => {
    try {
      const facts = resourceFacts(sheet);
      const definition = sheet.character.resources?.find((item) => item.id === id);
      let rechargeTotal: number | undefined;
      if (operation === "spend" && definition?.refresh.kind === "rechargeRoll") {
        const rolled = await sheet.rollPlan(createRechargeRollPlan(sheet.character, definition));
        if (!rolled) return;
        rechargeTotal = rolled.total;
      }
      const character = operation === "spend"
        ? spendResource(sheet.character, id, 1, facts, (_dice) => rechargeTotal!)
        : operation === "restore"
          ? restoreResource(sheet.character, id, 1, facts)
          : refreshResource(sheet.character, id);
      sheet.update(character, `${operation} ${id}`);
    } catch (error) {
      sheet.fail(error instanceof Error ? error.message : "Resource update failed");
    }
  };

  return <section className="editor-subsection ability-resource-section" aria-label="Resources">
    <h3>Resources</h3>
    <p className="muted">Capacity is an authored/derived fact. Spent and recharge state are mutable play state.</p>
    {sheet.derived.resources.map((resource) => {
      const definition = sheet.character.resources?.find((item) => item.id === resource.id)!;
      return <div className="feature-row enabled" key={resource.id}>
        <div>
          <b>{resource.name}</b>
          <small>
            Maximum: {resource.maximum ?? "Unlimited"} · Remaining: {resource.remaining ?? "Unlimited"} · Spent: {resource.spent}
            {resource.roundsUntilRefresh !== undefined ? ` · ${resource.roundsUntilRefresh} rounds remaining` : ""}
            {` · ${refreshLabel(resource.refresh)}`}
          </small>
        </div>
        <div className="mini-fields">
          <button className="table-action" aria-label={`Spend ${resource.name}`} onClick={() => void mutate("spend", resource.id)}>−1</button>
          <button className="table-action" aria-label={`Restore ${resource.name}`} onClick={() => mutate("restore", resource.id)}>+1</button>
          <button className="table-action" aria-label={`Refresh ${resource.name}`} onClick={() => mutate("refresh", resource.id)}>Refresh</button>
          <button className="table-action" aria-label={`Edit resource ${resource.name}`} onClick={() => edit(definition)}>Edit</button>
          <button className="table-action" aria-label={`Remove resource ${resource.name}`} onClick={() => remove(definition)}>×</button>
        </div>
      </div>;
    })}
    <div className="feature-form">
      <input aria-label="Resource name" placeholder="Resource name" value={name} onChange={(event) => setName(event.target.value)} />
      <input aria-label="Resource description" placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <select aria-label="Resource maximum policy" value={maximumKind} onChange={(event) => setMaximumKind(event.target.value as typeof maximumKind)}>
        <option value="fixed">Fixed maximum</option><option value="manual">Manual maximum</option><option value="derived">Base + ability modifier</option>
      </select>
      <input aria-label="Resource maximum" type="number" min="0" value={maximum} onChange={(event) => setMaximum(event.target.value)} />
      {maximumKind === "derived" && <select aria-label="Resource maximum ability" value={derivedAbility} onChange={(event) => setDerivedAbility(event.target.value as typeof derivedAbility)}>
        {(["str", "dex", "con", "int", "wis", "cha"] as const).map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
      </select>}
      {maximumKind === "derived" && <select aria-label="Resource maximum ability source" value={derivedAbilitySource} onChange={(event) => setDerivedAbilitySource(event.target.value as typeof derivedAbilitySource)}><option value="current">Current derived modifier</option><option value="base">Base ability modifier</option></select>}
      <select aria-label="Resource refresh rule" value={refreshKind} onChange={(event) => setRefreshKind(event.target.value as ResourceRefreshRule["kind"])}>
        <option value="manual">Manual</option><option value="round">Per round</option><option value="encounter">Encounter</option><option value="rest">Rest</option><option value="daily">Daily</option><option value="interval">Fixed interval</option><option value="rechargeRoll">Recharge roll (1dN)</option><option value="unlimited">Unlimited / at-will</option>
      </select>
      {(refreshKind === "interval" || refreshKind === "rechargeRoll") && <input aria-label="Resource refresh rounds" type="number" min="1" value={refreshValue} onChange={(event) => setRefreshValue(event.target.value)} />}
      <button className="button quiet" onClick={save}>{editingId ? "Save resource" : "+ Add resource"}</button>
      {editingId && <button className="button quiet" onClick={reset}>Cancel edit</button>}
    </div>
  </section>;
}

function AbilityEditor({ sheet }: { sheet: CharacterSheet }) {
  const [catalogId, setCatalogId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activation, setActivation] = useState<AbilityActivationType>("toggleable");
  const [effects, setEffects] = useState<Effect[]>([]);
  const [costs, setCosts] = useState<NonNullable<AbilityInstance["costs"]>>([]);
  const [effectKind, setEffectKind] = useState<EffectKind>("modifier");
  const [target, setTarget] = useState<EffectTargetId>("attack.melee");
  const [value, setValue] = useState("1");
  const [bonus, setBonus] = useState<BonusType>("untyped");
  const [dice, setDice] = useState("1d6");
  const [damageType, setDamageType] = useState("");
  const [criticalBehavior, setCriticalBehavior] = useState<"normal" | "notMultiplied">("normal");
  const [criticalOperation, setCriticalOperation] = useState<"widen" | "double">("widen");
  const [acContexts, setAcContexts] = useState<Array<"normal" | "touch" | "flatFooted">>(["normal"]);
  const [kinds, setKinds] = useState<NonNullable<EffectApplicability["kinds"]>>([]);
  const [modes, setModes] = useState<NonNullable<EffectApplicability["modes"]>>([]);
  const [touch, setTouch] = useState<"any" | "touch" | "nonTouch">("any");
  const [fullAttack, setFullAttack] = useState<"any" | "full" | "standard">("any");
  const [maneuvers, setManeuvers] = useState<string[]>([]);
  const [attackIds, setAttackIds] = useState<string[]>([]);
  const [requiredTags, setRequiredTags] = useState<string[]>([]);
  const [excludedTags, setExcludedTags] = useState<string[]>([]);
  const [requiredFlags, setRequiredFlags] = useState<string[]>([]);
  const [excludedFlags, setExcludedFlags] = useState<string[]>([]);
  const [costResource, setCostResource] = useState("");
  const [costAmount, setCostAmount] = useState("1");
  const [costTimingValue, setCostTimingValue] = useState<ResourceCostTiming>("onActivate");

  const reset = () => {
    setEditingId(null); setDraftId(null); setName(""); setDescription(""); setActivation("toggleable"); setEffects([]); setCosts([]); setCostTimingValue("onActivate");
  };
  const load = (ability: AbilityInstance) => {
    setEditingId(ability.id); setDraftId(ability.id); setName(ability.name); setDescription(ability.description ?? ""); setActivation(ability.activation); setEffects(clone(ability.effects)); setCosts(clone(ability.costs ?? []));
  };
  const applicability = (): EffectApplicability | undefined => {
    const value = {
      ...(kinds.length ? { kinds } : {}),
      ...(modes.length ? { modes } : {}),
      ...(touch !== "any" ? { touch: touch === "touch" } : {}),
      ...(fullAttack !== "any" ? { fullAttack: fullAttack === "full" } : {}),
      ...(maneuvers.length ? { maneuvers } : {}),
      ...(attackIds.length ? { attackIds } : {}),
      ...(requiredTags.length ? { requiredTags: requiredTags as EffectApplicability["requiredTags"] } : {}),
      ...(excludedTags.length ? { excludedTags: excludedTags as EffectApplicability["excludedTags"] } : {}),
      ...(requiredFlags.length ? { requiredFlags } : {}),
      ...(excludedFlags.length ? { excludedFlags } : {}),
    };
    return Object.keys(value).length ? value : undefined;
  };
  const addEffect = () => {
    const numeric = Number(value);
    const appliesWhen = applicability();
    let effect: Effect | undefined;
    if (effectKind === "damageDice") {
      const parsed = parseDice(dice);
      if (parsed && (target === "damage.melee" || target === "damage.ranged")) effect = { kind: "damageDice", target, dice: parsed, criticalBehavior, ...(damageType.trim() ? { damageType: damageType.trim() } : {}), ...(appliesWhen ? { appliesWhen } : {}) };
    } else if (effectKind === "criticalRange") {
      if ((target === "attack.melee" || target === "attack.ranged") && (criticalOperation === "double" || (Number.isInteger(numeric) && numeric > 0))) effect = { kind: "criticalRange", target, operation: criticalOperation, ...(criticalOperation === "widen" ? { widenBy: numeric } : {}), ...(appliesWhen ? { appliesWhen } : {}) };
    } else if (effectKind === "grant") effect = { kind: "grant", target, grant: damageType.trim() || "Custom capability" };
    else if (Number.isFinite(numeric)) {
      if (effectKind === "modifier") effect = target === "ac" && acContexts.length ? { kind: "modifier", target: "ac", value: numeric, bonusType: bonus, appliesTo: acContexts } : target !== "ac" ? { kind: "modifier", target, value: numeric, bonusType: bonus, ...(appliesWhen ? { appliesWhen } : {}) } : undefined;
      else if (effectKind === "replaceBase") effect = { kind: "replaceBase", target, value: numeric };
      else if (effectKind === "multiply") effect = { kind: "multiply", target, factor: numeric };
      else if (effectKind === "minimum") effect = { kind: "minimum", target, value: numeric };
      else if (effectKind === "maximum") effect = { kind: "maximum", target, value: numeric };
    }
    if (!effect) { sheet.fail("Complete a valid structured effect. Damage dice use NdN and damage targets; critical range uses attack targets."); return; }
    setEffects((current) => [...current, effect!]);
  };
  const move = (index: number, direction: -1 | 1) => setEffects((current) => {
    const next = [...current]; const destination = index + direction;
    if (destination < 0 || destination >= next.length) return current;
    [next[index], next[destination]] = [next[destination]!, next[index]!]; return next;
  });
  const addCost = () => {
    const amount = Number(costAmount);
    if (!costResource || !Number.isInteger(amount) || amount <= 0) { sheet.fail("Choose a resource and a positive whole cost."); return; }
    setCosts((current) => [...current.filter((item) => !(item.resourceId === costResource && item.timing === costTimingValue)), { resourceId: costResource, amount, timing: costTimingValue }]);
  };
  const save = () => {
    if (!name.trim()) { sheet.fail("An ability needs a name."); return; }
    const id = editingId ?? draftId ?? nextId(`ability-${slug(name) || "custom"}`, (sheet.character.abilities ?? []).map((item) => item.id));
    const prior = sheet.character.abilities?.find((item) => item.id === id);
    const ability: AbilityInstance = { id, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), activation, ...(activation === "toggleable" ? { active: prior?.active ?? false } : {}), effects, ...(activation !== "passive" && costs.length ? { costs } : {}) };
    const abilities = editingId ? (sheet.character.abilities ?? []).map((item) => item.id === editingId ? ability : item) : [...(sheet.character.abilities ?? []), ability];
    if (sheet.update({ abilities }, `${editingId ? "Updated" : "Added"} ${ability.name}`)) reset();
  };
  const addCatalog = (cloneForEditing: boolean) => {
    const definition = abilityCatalog[catalogId];
    if (!definition) { sheet.fail("Choose a catalog ability."); return; }
    if (!cloneForEditing && ((sheet.character.abilities ?? []).some((item) => item.definitionId === definition.id) || sheet.character.features.some((item) => item.enabled && item.definitionId === definition.id))) {
      sheet.fail(`${definition.name} is already represented by this character.`);
      return;
    }
    const id = nextId(`ability-${slug(definition.name)}`, (sheet.character.abilities ?? []).map((item) => item.id));
    if (cloneForEditing) {
      const cloned = cloneAbilityDefinition(definition, id);
      load(cloned);
      setEditingId(null);
      setDraftId(id);
      return;
    }
    const ability: AbilityInstance = { id, definitionId: definition.id, name: definition.name, ...(definition.description ? { description: definition.description } : {}), activation: definition.activation, ...(definition.activation === "toggleable" ? { active: false } : {}), effects: [] };
    sheet.update({ abilities: [...(sheet.character.abilities ?? []), ability] }, `Added ${ability.name}`);
  };
  const activate = async (ability: AbilityInstance) => {
    const proposal = { character: sheet.character, abilityId: ability.id };
    const prepared = prepareAbilityExecution(proposal, resourceFacts(sheet), abilityCatalog);
    if (!prepared.accepted) { sheet.fail(prepared.issues.map((issue) => issue.message).join("; ")); return; }
    const rechargeRollResults: Record<string, number> = {};
    for (const plan of prepared.execution.rollPlans.filter((item) => item.id.startsWith("resource:"))) {
      const rolled = await sheet.rollPlan(plan);
      if (!rolled) return;
      const resourceId = (sheet.character.resources ?? []).find((resource) => plan.id === `resource:${sheet.character.id}:${resource.id}:recharge`)?.id;
      if (resourceId) rechargeRollResults[resourceId] = rolled.total;
    }
    const result = commitAbilityActivation({ ...proposal, rechargeRollResults }, resourceFacts(sheet), abilityCatalog);
    if (!result.accepted) { sheet.fail(result.issues.map((issue) => issue.message).join("; ")); return; }
    sheet.update(result.character, ability.activation === "toggleable" ? `${ability.name} ${result.ability.active ? "enabled" : "disabled"}` : `Used ${ability.name}`);
    for (const plan of result.execution.rollPlans.filter((item) => item.id.startsWith("ability:")))
      await sheet.rollPlan(plan);
  };

  return <section className="editor-subsection ability-resource-section" aria-label="Abilities">
    <h3>Abilities</h3>
    <div className="catalog-add-row">
      <select aria-label="Catalog ability" value={catalogId} onChange={(event) => setCatalogId(event.target.value)}><option value="">Choose a catalog ability…</option>{catalogValues(abilityCatalog).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button className="button quiet" disabled={!catalogId} onClick={() => addCatalog(false)}>+ Add catalog ability</button>
      <button className="button quiet" disabled={!catalogId} onClick={() => addCatalog(true)}>Clone → local edit</button>
    </div>
    {(sheet.character.abilities ?? []).map((ability) => <div className={`feature-row ${ability.activation === "passive" || ability.active ? "enabled" : ""}`} key={ability.id}>
      <button className="toggle" aria-label={`${ability.activation === "activated" ? "Use" : "Toggle"} ability ${ability.name}`} aria-pressed={ability.active ?? false} disabled={ability.activation === "passive"} onClick={() => void activate(ability)}><span /></button>
      <div><b>{ability.name}</b><small>{ability.activation} · {(ability.effects.length ? ability.effects : ability.definitionId ? abilityCatalog[ability.definitionId]?.effects ?? [] : []).map(describeEffect).join(" · ") || "Descriptive ability"}{ability.costs?.length ? ` · costs ${ability.costs.map((cost) => `${cost.amount} ${sheet.character.resources?.find((item) => item.id === cost.resourceId)?.name ?? cost.resourceId} ${cost.timing ?? (ability.activation === "activated" ? "onUse" : "onActivate")}`).join(" + ")}` : ""}</small></div>
      <i>{ability.activation === "passive" ? "PASSIVE" : ability.activation === "activated" ? "USE" : ability.active ? "ON" : "OFF"}</i>
      {!ability.definitionId && <button className="table-action" aria-label={`Edit ability ${ability.name}`} onClick={() => load(ability)}>Edit</button>}
      <button className="table-action" aria-label={`Remove ability ${ability.name}`} onClick={() => sheet.update({ abilities: (sheet.character.abilities ?? []).filter((item) => item.id !== ability.id) })}>×</button>
    </div>)}
    <div className="feature-form ability-builder">
      <input aria-label="Ability name" placeholder="Ability name" value={name} onChange={(event) => setName(event.target.value)} />
      <input aria-label="Ability description" placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <select aria-label="Ability activation" value={activation} onChange={(event) => { const next = event.target.value as AbilityActivationType; setActivation(next); setCostTimingValue(next === "activated" ? "onUse" : "onActivate"); }}><option value="passive">Passive</option><option value="toggleable">Toggleable</option><option value="activated">Activated / one-shot</option></select>
      <h4>Effects</h4>
      {effects.map((effect, index) => <div className="chip" key={index}><span>{describeEffect(effect)}</span><button aria-label={`Move effect ${index + 1} up`} onClick={() => move(index, -1)}>↑</button><button aria-label={`Move effect ${index + 1} down`} onClick={() => move(index, 1)}>↓</button><button aria-label={`Remove effect ${index + 1}`} onClick={() => setEffects((current) => current.filter((_, item) => item !== index))}>×</button></div>)}
      <select aria-label="Ability effect kind" value={effectKind} onChange={(event) => setEffectKind(event.target.value as EffectKind)}><option value="modifier">Numeric modifier</option><option value="replaceBase">Replace baseline</option><option value="multiply">Multiply</option><option value="minimum">Minimum</option><option value="maximum">Maximum</option><option value="grant">Grant</option><option value="criticalRange">Critical range</option><option value="damageDice">Additional damage dice</option></select>
      <select aria-label="Ability effect target" value={target} onChange={(event) => setTarget(event.target.value as EffectTargetId)}>{effectTargets.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      {effectKind === "damageDice" ? <><input aria-label="Ability damage dice" value={dice} onChange={(event) => setDice(event.target.value)} /><input aria-label="Ability damage type" placeholder="fire / precision / label" value={damageType} onChange={(event) => setDamageType(event.target.value)} /><select aria-label="Ability damage critical behavior" value={criticalBehavior} onChange={(event) => setCriticalBehavior(event.target.value as typeof criticalBehavior)}><option value="normal">Multiply on critical</option><option value="notMultiplied">Not multiplied</option></select></> : <>{effectKind === "criticalRange" && <select aria-label="Critical range operation" value={criticalOperation} onChange={(event) => setCriticalOperation(event.target.value as typeof criticalOperation)}><option value="widen">Widen by N</option><option value="double">Double base threat range</option></select>}{!(effectKind === "criticalRange" && criticalOperation === "double") && <input aria-label="Ability effect value" type="number" value={value} onChange={(event) => setValue(event.target.value)} />}{effectKind === "modifier" && <select aria-label="Ability effect bonus type" value={bonus} onChange={(event) => setBonus(event.target.value as BonusType)}>{bonusTypes.map((item) => <option key={item}>{item}</option>)}</select>}{effectKind === "grant" && <input aria-label="Ability granted capability" placeholder="Capability label" value={damageType} onChange={(event) => setDamageType(event.target.value)} />}</>}
      {effectKind === "modifier" && target === "ac" && <label>AC contexts<select multiple aria-label="AC applicability contexts" value={acContexts} onChange={(event) => setAcContexts(selectedValues(event) as typeof acContexts)}><option value="normal">Normal</option><option value="touch">Touch</option><option value="flatFooted">Flat-footed</option></select></label>}
      <label>Roll kinds<select multiple aria-label="Ability effect roll kinds" value={kinds} onChange={(event) => setKinds(selectedValues(event) as typeof kinds)}>{["attack", "damage", "maneuver", "save", "skill", "initiative"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Attack modes<select multiple aria-label="Ability effect modes" value={modes} onChange={(event) => setModes(selectedValues(event) as typeof modes)}><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label>
      <select aria-label="Ability effect touch applicability" value={touch} onChange={(event) => setTouch(event.target.value as typeof touch)}><option value="any">Touch or non-touch</option><option value="touch">Touch only</option><option value="nonTouch">Non-touch only</option></select>
      <select aria-label="Ability effect action applicability" value={fullAttack} onChange={(event) => setFullAttack(event.target.value as typeof fullAttack)}><option value="any">Standard or full attack</option><option value="standard">Standard attack only</option><option value="full">Full attack only</option></select>
      <label>Maneuvers<select multiple aria-label="Ability effect maneuvers" value={maneuvers} onChange={(event) => setManeuvers(selectedValues(event))}>{["bull-rush", "dirty-trick", "disarm", "drag", "grapple", "overrun", "reposition", "steal", "sunder", "trip"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Specific attacks<select multiple aria-label="Ability effect attack IDs" value={attackIds.filter((id) => sheet.character.attacks.some((attack) => attack.id === id))} onChange={(event) => setAttackIds([...attackIds.filter((id) => !sheet.character.attacks.some((attack) => attack.id === id)), ...selectedValues(event)])}>{sheet.character.attacks.map((attack) => <option key={attack.id} value={attack.id}>{attack.name}</option>)}</select></label>
      <TokenField label="Homebrew attack ID" values={attackIds.filter((id) => !sheet.character.attacks.some((attack) => attack.id === id))} onChange={(custom) => setAttackIds([...attackIds.filter((id) => sheet.character.attacks.some((attack) => attack.id === id)), ...custom])} />
      <label>Required attack tags<select multiple aria-label="Ability effect required tags" value={requiredTags} onChange={(event) => setRequiredTags(selectedValues(event))}>{["weapon.melee", "weapon.ranged", "weapon.two-handed", "weapon.off-hand", "weapon.touch", "natural.attack"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Excluded attack tags<select multiple aria-label="Ability effect excluded tags" value={excludedTags} onChange={(event) => setExcludedTags(selectedValues(event))}>{["weapon.melee", "weapon.ranged", "weapon.two-handed", "weapon.off-hand", "weapon.touch", "natural.attack"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <TokenField label="Required context flag" values={requiredFlags} onChange={setRequiredFlags} />
      <TokenField label="Excluded context flag" values={excludedFlags} onChange={setExcludedFlags} />
      <button className="button quiet" onClick={addEffect}>+ Add effect</button>
      <h4>Resource costs</h4>
      {costs.map((cost) => <span className="chip" key={`${cost.resourceId}-${cost.timing}`}>{cost.amount} {sheet.character.resources?.find((item) => item.id === cost.resourceId)?.name ?? cost.resourceId} {cost.timing}<button aria-label={`Remove cost ${cost.resourceId} ${cost.timing}`} onClick={() => setCosts((current) => current.filter((item) => item !== cost))}>×</button></span>)}
      <select disabled={activation === "passive"} aria-label="Ability cost resource" value={costResource} onChange={(event) => setCostResource(event.target.value)}><option value="">Choose resource…</option>{(sheet.character.resources ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input disabled={activation === "passive"} aria-label="Ability cost amount" type="number" min="1" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} />
      <select disabled={activation === "passive"} aria-label="Ability cost timing" value={costTimingValue} onChange={(event) => setCostTimingValue(event.target.value as ResourceCostTiming)}>{activation === "activated" ? <option value="onUse">On use</option> : <><option value="onActivate">On activation</option><option value="perRound">Per round</option></>}</select>
      <button disabled={activation === "passive"} className="button quiet" onClick={addCost}>+ Add cost</button>
      <button className="button quiet" onClick={save}>{editingId ? "Save ability" : "+ Add ability"}</button>
      {editingId && <button className="button quiet" onClick={reset}>Cancel edit</button>}
    </div>
  </section>;
}

export function AbilityResourceEditor({ sheet }: { sheet: CharacterSheet }) {
  const advanceRound = () => {
    const result = advanceAbilityResourceRound(sheet.character, resourceFacts(sheet), abilityCatalog);
    const suffix = result.deactivatedAbilityIds.length
      ? `; disabled ${result.deactivatedAbilityIds.join(", ")} for unpaid upkeep`
      : "";
    sheet.update(result.character, `Advanced resource round${suffix}`);
  };
  return <div className="ability-resource-editor"><button className="button quiet" aria-label="Advance resource round" onClick={advanceRound}>Advance resource round</button><ResourceEditor sheet={sheet} /><AbilityEditor sheet={sheet} /></div>;
}
