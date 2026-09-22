import { useState } from "react";
import { abilityCatalog } from "@threepointpf/rules-data";
import {
  cloneAbilityDefinition,
  commitAbilityActivation,
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
  ResourceDefinition,
  ResourceMaximumTerm,
  ResourceRefreshRule,
} from "@threepointpf/rules-schema";
import { catalogValues, clone, describeEffect, nextId, slug } from "../lib/format";
import { bonusTypes, effectTargets } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

type EffectKind = Effect["kind"];

function parseDice(value: string): DiceExpression | undefined {
  const match = /^(\d+)d(\d+)$/i.exec(value.trim());
  if (!match) return undefined;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  return count > 0 && sides > 0 ? { count, sides } : undefined;
}

function csv(value: string): string[] | undefined {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function resourceFacts(sheet: CharacterSheet): ResourceFacts {
  return {
    abilityModifier: (id) => sheet.derived.abilities[id].modifier.value,
    progressionLevel: (id) => sheet.derived.advancement?.progressionLevels[id]?.value ?? 0,
  };
}

function randomRecharge(dice: DiceExpression): number {
  let total = 0;
  for (let index = 0; index < dice.count; index += 1)
    total += Math.floor(Math.random() * dice.sides) + 1;
  return total;
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
              ? derivedTerms.map((term) => term.kind === "abilityModifier" ? { ...term, ability: derivedAbility } : term)
              : [{ kind: "abilityModifier", ability: derivedAbility }],
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
  const mutate = (operation: "spend" | "restore" | "refresh", id: string) => {
    try {
      const facts = resourceFacts(sheet);
      const character = operation === "spend"
        ? spendResource(sheet.character, id, 1, facts, (dice) => randomRecharge(dice))
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
          <button className="table-action" aria-label={`Spend ${resource.name}`} onClick={() => mutate("spend", resource.id)}>−1</button>
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
  const [modes, setModes] = useState("");
  const [attackIds, setAttackIds] = useState("");
  const [requiredTags, setRequiredTags] = useState("");
  const [requiredFlags, setRequiredFlags] = useState("");
  const [costResource, setCostResource] = useState("");
  const [costAmount, setCostAmount] = useState("1");

  const reset = () => {
    setEditingId(null); setDraftId(null); setName(""); setDescription(""); setActivation("toggleable"); setEffects([]); setCosts([]);
  };
  const load = (ability: AbilityInstance) => {
    setEditingId(ability.id); setDraftId(ability.id); setName(ability.name); setDescription(ability.description ?? ""); setActivation(ability.activation); setEffects(clone(ability.effects)); setCosts(clone(ability.costs ?? []));
  };
  const applicability = (): EffectApplicability | undefined => {
    const selectedModes = csv(modes)?.filter((item): item is "melee" | "ranged" => item === "melee" || item === "ranged");
    const value = {
      ...(selectedModes?.length ? { modes: selectedModes } : {}),
      ...(csv(attackIds) ? { attackIds: csv(attackIds) } : {}),
      ...(csv(requiredTags) ? { requiredTags: csv(requiredTags) as EffectApplicability["requiredTags"] } : {}),
      ...(csv(requiredFlags) ? { requiredFlags: csv(requiredFlags) } : {}),
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
      if ((target === "attack.melee" || target === "attack.ranged") && Number.isInteger(numeric) && numeric > 0) effect = { kind: "criticalRange", target, operation: "widen", widenBy: numeric, ...(appliesWhen ? { appliesWhen } : {}) };
    } else if (effectKind === "grant") effect = { kind: "grant", target, grant: damageType.trim() || "Custom capability" };
    else if (Number.isFinite(numeric)) {
      if (effectKind === "modifier") effect = target === "ac" ? { kind: "modifier", target: "ac", value: numeric, bonusType: bonus, appliesTo: ["normal", "touch", "flatFooted"] } : { kind: "modifier", target, value: numeric, bonusType: bonus, ...(appliesWhen ? { appliesWhen } : {}) };
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
    setCosts((current) => [...current.filter((item) => item.resourceId !== costResource), { resourceId: costResource, amount }]);
  };
  const save = () => {
    if (!name.trim()) { sheet.fail("An ability needs a name."); return; }
    const id = editingId ?? draftId ?? nextId(`ability-${slug(name) || "custom"}`, (sheet.character.abilities ?? []).map((item) => item.id));
    const prior = sheet.character.abilities?.find((item) => item.id === id);
    const ability: AbilityInstance = { id, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), activation, ...(activation === "toggleable" ? { active: prior?.active ?? false } : {}), effects, ...(costs.length ? { costs } : {}) };
    const abilities = editingId ? (sheet.character.abilities ?? []).map((item) => item.id === editingId ? ability : item) : [...(sheet.character.abilities ?? []), ability];
    if (sheet.update({ abilities }, `${editingId ? "Updated" : "Added"} ${ability.name}`)) reset();
  };
  const addCatalog = (cloneForEditing: boolean) => {
    const definition = abilityCatalog[catalogId];
    if (!definition) { sheet.fail("Choose a catalog ability."); return; }
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
  const activate = (ability: AbilityInstance) => {
    const result = commitAbilityActivation({ character: sheet.character, abilityId: ability.id, rollRecharge: (rolled) => randomRecharge(rolled) }, resourceFacts(sheet), abilityCatalog);
    if (!result.accepted) { sheet.fail(result.issues.map((issue) => issue.message).join("; ")); return; }
    sheet.update(result.character, ability.activation === "toggleable" ? `${ability.name} ${result.ability.active ? "enabled" : "disabled"}` : `Used ${ability.name}`);
  };

  return <section className="editor-subsection ability-resource-section" aria-label="Abilities">
    <h3>Abilities</h3>
    <div className="catalog-add-row">
      <select aria-label="Catalog ability" value={catalogId} onChange={(event) => setCatalogId(event.target.value)}><option value="">Choose a catalog ability…</option>{catalogValues(abilityCatalog).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button className="button quiet" disabled={!catalogId} onClick={() => addCatalog(false)}>+ Add catalog ability</button>
      <button className="button quiet" disabled={!catalogId} onClick={() => addCatalog(true)}>Clone → local edit</button>
    </div>
    {(sheet.character.abilities ?? []).map((ability) => <div className={`feature-row ${ability.activation === "passive" || ability.active ? "enabled" : ""}`} key={ability.id}>
      <button className="toggle" aria-label={`${ability.activation === "activated" ? "Use" : "Toggle"} ability ${ability.name}`} aria-pressed={ability.active ?? false} disabled={ability.activation === "passive"} onClick={() => activate(ability)}><span /></button>
      <div><b>{ability.name}</b><small>{ability.activation} · {(ability.effects.length ? ability.effects : ability.definitionId ? abilityCatalog[ability.definitionId]?.effects ?? [] : []).map(describeEffect).join(" · ") || "Descriptive ability"}{ability.costs?.length ? ` · costs ${ability.costs.map((cost) => `${cost.amount} ${sheet.character.resources?.find((item) => item.id === cost.resourceId)?.name ?? cost.resourceId}`).join(" + ")}` : ""}</small></div>
      <i>{ability.activation === "passive" ? "PASSIVE" : ability.activation === "activated" ? "USE" : ability.active ? "ON" : "OFF"}</i>
      {!ability.definitionId && <button className="table-action" aria-label={`Edit ability ${ability.name}`} onClick={() => load(ability)}>Edit</button>}
      <button className="table-action" aria-label={`Remove ability ${ability.name}`} onClick={() => sheet.update({ abilities: (sheet.character.abilities ?? []).filter((item) => item.id !== ability.id) })}>×</button>
    </div>)}
    <div className="feature-form ability-builder">
      <input aria-label="Ability name" placeholder="Ability name" value={name} onChange={(event) => setName(event.target.value)} />
      <input aria-label="Ability description" placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <select aria-label="Ability activation" value={activation} onChange={(event) => setActivation(event.target.value as AbilityActivationType)}><option value="passive">Passive</option><option value="toggleable">Toggleable</option><option value="activated">Activated / one-shot</option></select>
      <h4>Effects</h4>
      {effects.map((effect, index) => <div className="chip" key={index}><span>{describeEffect(effect)}</span><button aria-label={`Move effect ${index + 1} up`} onClick={() => move(index, -1)}>↑</button><button aria-label={`Move effect ${index + 1} down`} onClick={() => move(index, 1)}>↓</button><button aria-label={`Remove effect ${index + 1}`} onClick={() => setEffects((current) => current.filter((_, item) => item !== index))}>×</button></div>)}
      <select aria-label="Ability effect kind" value={effectKind} onChange={(event) => setEffectKind(event.target.value as EffectKind)}><option value="modifier">Numeric modifier</option><option value="replaceBase">Replace baseline</option><option value="multiply">Multiply</option><option value="minimum">Minimum</option><option value="maximum">Maximum</option><option value="grant">Grant</option><option value="criticalRange">Critical range</option><option value="damageDice">Additional damage dice</option></select>
      <select aria-label="Ability effect target" value={target} onChange={(event) => setTarget(event.target.value as EffectTargetId)}>{effectTargets.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      {effectKind === "damageDice" ? <><input aria-label="Ability damage dice" value={dice} onChange={(event) => setDice(event.target.value)} /><input aria-label="Ability damage type" placeholder="fire / precision / label" value={damageType} onChange={(event) => setDamageType(event.target.value)} /><select aria-label="Ability damage critical behavior" value={criticalBehavior} onChange={(event) => setCriticalBehavior(event.target.value as typeof criticalBehavior)}><option value="normal">Multiply on critical</option><option value="notMultiplied">Not multiplied</option></select></> : <><input aria-label="Ability effect value" type="number" value={value} onChange={(event) => setValue(event.target.value)} />{effectKind === "modifier" && <select aria-label="Ability effect bonus type" value={bonus} onChange={(event) => setBonus(event.target.value as BonusType)}>{bonusTypes.map((item) => <option key={item}>{item}</option>)}</select>}{effectKind === "grant" && <input aria-label="Ability granted capability" placeholder="Capability label" value={damageType} onChange={(event) => setDamageType(event.target.value)} />}</>}
      <input aria-label="Ability effect modes" placeholder="Modes: melee,ranged" value={modes} onChange={(event) => setModes(event.target.value)} />
      <input aria-label="Ability effect attack IDs" placeholder="Attack IDs, comma-separated" value={attackIds} onChange={(event) => setAttackIds(event.target.value)} />
      <input aria-label="Ability effect required tags" placeholder="Required attack tags" value={requiredTags} onChange={(event) => setRequiredTags(event.target.value)} />
      <input aria-label="Ability effect required flags" placeholder="Required context flags" value={requiredFlags} onChange={(event) => setRequiredFlags(event.target.value)} />
      <button className="button quiet" onClick={addEffect}>+ Add effect</button>
      <h4>Resource costs</h4>
      {costs.map((cost) => <span className="chip" key={cost.resourceId}>{cost.amount} {sheet.character.resources?.find((item) => item.id === cost.resourceId)?.name ?? cost.resourceId}<button aria-label={`Remove cost ${cost.resourceId}`} onClick={() => setCosts((current) => current.filter((item) => item.resourceId !== cost.resourceId))}>×</button></span>)}
      <select aria-label="Ability cost resource" value={costResource} onChange={(event) => setCostResource(event.target.value)}><option value="">Choose resource…</option>{(sheet.character.resources ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input aria-label="Ability cost amount" type="number" min="1" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} />
      <button className="button quiet" onClick={addCost}>+ Add cost</button>
      <button className="button quiet" onClick={save}>{editingId ? "Save ability" : "+ Add ability"}</button>
      {editingId && <button className="button quiet" onClick={reset}>Cancel edit</button>}
    </div>
  </section>;
}

export function AbilityResourceEditor({ sheet }: { sheet: CharacterSheet }) {
  return <div className="ability-resource-editor"><ResourceEditor sheet={sheet} /><AbilityEditor sheet={sheet} /></div>;
}
