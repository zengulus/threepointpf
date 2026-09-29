import { useState } from "react";
import { formatModifier } from "@threepointpf/dice";
import { calculateCarryLoad, calculateEquipmentBudget, equipmentSlotOverloads, resolveEquipment } from "@threepointpf/rules-core";
import {
  attackProfileCatalog,
  autosheetCompanionWondrousSlots,
  autosheetSizeAdjustmentCatalog,
  autosheetWornSlotReference,
  equipmentCatalog,
  equipmentMaterialCatalog,
  experienceCatalog,
  featureCatalog,
  skillCatalog,
} from "@threepointpf/rules-data";
import {
  movementModes,
  maneuverIds,
  attackTagValues,
  sizeCategories,
  equipmentInventoryCategories,
  type AbilityId,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type Effect,
  type EffectTargetId,
  type EquipmentInventoryCategory,
} from "@threepointpf/rules-schema";
import { CustomEquipmentEditor } from "./custom-equipment-editor";
import { AbilityResourceEditor } from "./ability-resource-editor";
import { Field, StatCard } from "./primitives";
import { CoverField, IgnoreCoverField, LinkedTargetFields, MissChanceField, RollTargetField, WeaponActionControls } from "./roll-actions";
import {
  catalogValues,
  describeEffect,
  labelFor,
  nextId,
  sourceLabel,
} from "../lib/format";
import { abilities, abilityLabels, bonusTypes, effectTargets } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { CharacterDefenseInputs, CharacterIdentityPanel, TextBlock } from "./character-record";

const equipmentCategoryLabels: Record<EquipmentInventoryCategory, string> = {
  general: "General gear",
  disposableMagic: "Disposable magic",
  wornMagic: "Worn magic item",
  alchemicalWeapons: "Alchemical weapon",
  alchemicalMedicines: "Alchemical medicine or drug",
  alchemicalTools: "Alchemical tool or toy",
  miscellaneousMagic: "Miscellaneous magic item",
};
const estimatedWeightByEquipmentCategory: Partial<Record<EquipmentInventoryCategory, number>> = {
  disposableMagic: 0.25,
  alchemicalWeapons: 0.5,
  alchemicalMedicines: 0.5,
  alchemicalTools: 0.5,
};

function setAbilityLoss(sheet: CharacterSheet, field: "abilityDamage" | "abilityDrain", id: AbilityId, raw: string) {
  const next: Partial<Record<AbilityId, number>> = { ...(sheet.character[field] ?? {}) };
  if (!raw.trim() || Number(raw) === 0) delete next[id];
  else {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return sheet.fail("Ability damage and drain must be non-negative whole numbers.");
    next[id] = value;
  }
  sheet.update(field === "abilityDamage" ? { abilityDamage: next } : { abilityDrain: next }, `Updated ${id.toUpperCase()} ${field === "abilityDamage" ? "ability damage" : "ability drain"}`);
}

export function InputsPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
      <>
      <section className="panel inputs-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">AUTHORED INPUTS</span>
            <h2>Core numbers, size & movement</h2>
          </div>
          <span className="pill">recompute on edit</span>
        </div>
        <div className="ability-grid">
          {abilities.map((id) => (
            <div className="ability-input" key={id}>
              <span>{id.toUpperCase()}</span>
              <input
                aria-label={abilityLabels[id] + " base score"}
                type="number"
                value={sheet.character.baseAbilities[id]}
                onChange={(event) => sheet.updateAbility(id, event.target.value)}
              />
              <button
                className="value-link"
                aria-label={"Inspect " + abilityLabels[id]}
                onClick={() =>
                  sheet.inspect(abilityLabels[id], sheet.derived.abilities[id].score)
                }
              >
                {formatModifier(sheet.derived.abilities[id].modifier.value)}
              </button>
            </div>
          ))}
        </div>
        <details className="ability-loss-controls"><summary>Ability damage and drain</summary><p className="muted">These separate counters reduce the current score and every derived roll, and can bring a score to 0. Lower them when damage is healed or drain is restored. Apply the condition for a 0 score separately.</p><div className="form-grid">{abilities.map((id) => <div className="inline-fields" key={id}><label>{abilityLabels[id]} damage<input aria-label={`${abilityLabels[id]} ability damage`} type="number" min="0" step="1" value={sheet.character.abilityDamage?.[id] || ""} onChange={(event) => setAbilityLoss(sheet, "abilityDamage", id, event.target.value)} /></label><label>{abilityLabels[id]} drain<input aria-label={`${abilityLabels[id]} ability drain`} type="number" min="0" step="1" value={sheet.character.abilityDrain?.[id] || ""} onChange={(event) => setAbilityLoss(sheet, "abilityDrain", id, event.target.value)} /></label></div>)}</div></details>
        <div className="inline-fields">
          {!sheet.character.advancementSlots?.length && (
            <>
              <Field
                label="Base BAB"
                value={sheet.character.baseBab ?? ""}
                onChange={(value) =>
                  sheet.update({ baseBab: Number(value) || 0 })
                }
              />
              <Field
                label="Hit dice"
                value={sheet.character.hitDiceCount ?? ""}
                onChange={(value) =>
                  sheet.update({ hitDiceCount: Math.max(1, Number(value) || 1) })
                }
              />
            </>
          )}
          <Field
            label="HP before CON"
            value={sheet.character.baseHpBeforeConstitution}
            onChange={(value) =>
              sheet.update({ baseHpBeforeConstitution: Number(value) || 0 })
            }
          />
          <Field
            label="Favored-class bonus HP"
            value={sheet.character.workbookBonuses?.hp ?? 0}
            onChange={(value) => sheet.update({ workbookBonuses: { ...sheet.character.workbookBonuses, hp: Number(value) || 0 } })}
          />
          <Field
            label="Favored-class bonus skill ranks"
            value={sheet.character.workbookBonuses?.skillPoints ?? 0}
            onChange={(value) => sheet.update({ workbookBonuses: { ...sheet.character.workbookBonuses, skillPoints: Number(value) || 0 } })}
          />
          <TextBlock
            label="Other favored-class bonus"
            value={sheet.character.workbookBonuses?.other ?? ""}
            onChange={(value) => sheet.update({ workbookBonuses: { ...sheet.character.workbookBonuses, other: value } })}
          />
          <Field
            label="Damage taken"
            value={sheet.character.damageTaken}
            onChange={(value) =>
              sheet.update({ damageTaken: Math.max(0, Number(value) || 0) })
            }
          />
          <Field
            label="Temporary HP"
            value={sheet.character.temporaryHp}
            onChange={(value) =>
              sheet.update({ temporaryHp: Math.max(0, Number(value) || 0) })
            }
          />
          <label className="field">
            <span>Base size</span>
            <select
              aria-label="Base size"
              value={sheet.character.baseSize ?? "medium"}
              onChange={(event) =>
                sheet.update({
                  baseSize: event.target
                    .value as CharacterInput["baseSize"],
                })
              }
            >
              {sizeCategories.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!sheet.character.advancementSlots?.length && (
          <div className="save-inputs">
            {(["fortitude", "reflex", "will"] as const).map((save) => (
              <Field
                key={save}
                label={"Base " + save}
                value={sheet.character.baseSaves?.[save] ?? ""}
                onChange={(value) =>
                  sheet.update({
                    baseSaves: {
                      ...(sheet.character.baseSaves ?? {
                        fortitude: 0,
                        reflex: 0,
                        will: 0,
                      }),
                      [save]: Number(value) || 0,
                    },
                  })
                }
              />
            ))}
          </div>
        )}
        <div className="speed-editor">
          <button
            className="eyebrow value-link"
            onClick={() =>
              sheet.inspect(
                "Relative size: " + sheet.derived.size.category,
                sheet.derived.size.relative,
              )
            }
          >
            BASE SPEEDS · DERIVED {sheet.derived.size.category} (
            {formatModifier(sheet.derived.size.relative.value)})
          </button>
          <div className="speed-grid">
            {movementModes.map((mode) => (
              <label className="field" key={mode}>
                <span>{mode}</span>
                <input
                  aria-label={mode + " base speed"}
                  type="number"
                  min="0"
                  value={
                    sheet.character.baseSpeeds?.[mode] ??
                    (mode === "land" ? (sheet.character.baseLandSpeed ?? 30) : 0)
                  }
                  onChange={(event) => {
                    const value = Math.max(
                      0,
                      Number(event.target.value) || 0,
                    );
                    sheet.update({
                      baseSpeeds: {
                        ...sheet.character.baseSpeeds,
                        [mode]: value,
                      },
                      ...(mode === "land" ? { baseLandSpeed: value } : {}),
                    });
                  }}
                />
                <button
                  type="button"
                  className="derived-speed value-link"
                  data-testid={"speed-" + mode}
                  onClick={(event) => {
                    event.preventDefault();
                    sheet.inspect(mode + " speed", sheet.derived.speeds[mode]);
                  }}
                >
                  {sheet.derived.speeds[mode].value} ft · inspect
                </button>
              </label>
            ))}
          </div>
          <div className="speed-grid tactical-speed-grid" aria-label="Tactical movement distances">
            {(["charge", "run"] as const).map((mode) => (
              <label className="field" key={mode}>
                <span>{mode} distance</span>
                <button
                  type="button"
                  className="derived-speed value-link"
                  aria-label={`Derived ${mode} distance`}
                  onClick={() => sheet.inspect(`${mode} distance`, sheet.derived.tacticalSpeeds[mode])}
                >
                  {sheet.derived.tacticalSpeeds[mode].value} ft · inspect
                </button>
              </label>
            ))}
          </div>
        </div>
      </section>
      <CharacterIdentityPanel sheet={sheet} />
      <CharacterDefenseInputs sheet={sheet} />
      </>
  );
}

export function ExperiencePanel({ sheet }: { sheet: CharacterSheet }) {
  return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXPERIENCE</span>
            <h2>XP & level eligibility</h2>
          </div>
          <span className="helper">
            Optional · does not change class slots
          </span>
        </div>
        <div className="inline-fields">
          <label className="field">
            <span>Experience track</span>
            <select
              aria-label="Experience track"
              value={sheet.character.experience?.trackId ?? ""}
              onChange={(event) =>
                sheet.update({
                  experience: event.target.value
                    ? {
                        points: sheet.character.experience?.points ?? 0,
                        trackId: event.target.value,
                      }
                    : undefined,
                })
              }
            >
              <option value="">Milestones / no XP tracking</option>
              {Object.values(experienceCatalog).map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>
          {sheet.character.experience && (
            <Field
              label="Experience points"
              value={sheet.character.experience.points}
              onChange={(value) =>
                sheet.update({
                  experience: {
                    ...sheet.character.experience!,
                    points: Number(value),
                  },
                })
              }
            />
          )}
          {sheet.derived.experience && (
            <button
              className="value-link"
              data-testid="experience-level"
              onClick={() =>
                sheet.inspect(
                  "XP level eligibility",
                  sheet.derived.experience!.eligibleLevel,
                )
              }
            >
              Eligible level {sheet.derived.experience.eligibleLevel.value} ·{" "}
              {sheet.derived.experience.remaining !== undefined
                ? sheet.derived.experience.remaining + " XP to next level"
                : "End of imported chart"}{" "}
              · inspect
            </button>
          )}
        </div>
      </section>
  );
}

export function DefensesPanel({ sheet }: { sheet: CharacterSheet }) {
  const materialDefenses = sheet.engine.equipment.filter((item) => item.equipped);
  const effectiveResistances = { ...(sheet.character.defenses?.energyResistances ?? {}) };
  for (const item of materialDefenses) {
    const resistance = item.materialEnergyResistance;
    if (resistance) effectiveResistances[resistance.damageType] = Math.max(effectiveResistances[resistance.damageType] ?? 0, resistance.amount);
  }
  const effectiveDamageReduction = [
    ...(sheet.character.defenses?.damageReduction ?? []),
    ...sheet.noteDerivedDefenses.damageReduction,
    ...materialDefenses.flatMap((item) => item.materialDamageReduction ? [item.materialDamageReduction] : []),
  ];
  return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DERIVED SHEET</span>
            <h2>Defenses & combat</h2>
          </div>
          <span className="helper">Click any value to inspect</span>
        </div>
        <div className="stats-grid">
          <StatCard
            label="Base Attack Bonus"
            value={formatModifier(sheet.derived.bab.value)}
            evaluation={sheet.derived.bab}
            inspect={() => sheet.inspect("Base Attack Bonus", sheet.derived.bab)}
            testId="stat-bab"
          />
          <StatCard
            label="Armor Class"
            value={sheet.derived.ac.value}
            evaluation={sheet.derived.ac}
            inspect={() => sheet.inspect("Armor Class", sheet.derived.ac)}
            testId="stat-ac"
          />
          <StatCard
            label="Touch AC"
            value={sheet.derived.touchAc.value}
            evaluation={sheet.derived.touchAc}
            inspect={() => sheet.inspect("Touch AC", sheet.derived.touchAc)}
            testId="stat-touch-ac"
          />
          <StatCard
            label="Flat-footed"
            value={sheet.derived.flatFootedAc.value}
            evaluation={sheet.derived.flatFootedAc}
            inspect={() => sheet.inspect("Flat-footed AC", sheet.derived.flatFootedAc)}
            testId="stat-flat-footed"
          />
          <StatCard
            label="Denied Dex"
            value={sheet.derived.deniedDexAc.value}
            evaluation={sheet.derived.deniedDexAc}
            inspect={() => sheet.inspect("AC without Dexterity or dodge bonuses", sheet.derived.deniedDexAc)}
            testId="stat-denied-dex-ac"
          />
          <StatCard
            label="HP"
            value={sheet.derived.currentHp + " / " + sheet.derived.maxHp.value}
            evaluation={sheet.derived.maxHp}
            inspect={() => sheet.inspect("Maximum HP", sheet.derived.maxHp)}
            testId="stat-current-hp"
          />
          <StatCard
            label="Max HP"
            value={sheet.derived.maxHp.value}
            evaluation={sheet.derived.maxHp}
            inspect={() => sheet.inspect("Maximum HP", sheet.derived.maxHp)}
            testId="stat-max-hp"
          />
          <StatCard
            label="Initiative"
            value={formatModifier(sheet.derived.initiative.value)}
            evaluation={sheet.derived.initiative}
            inspect={() => sheet.inspect("Initiative", sheet.derived.initiative)}
            testId="stat-initiative"
          />
          <StatCard
            label="CMB"
            value={formatModifier(sheet.derived.cmb.value)}
            evaluation={sheet.derived.cmb}
            inspect={() => sheet.inspect("CMB", sheet.derived.cmb)}
            testId="stat-cmb"
          />
          <StatCard
            label="CMD"
            value={sheet.derived.cmd.value}
            evaluation={sheet.derived.cmd}
            inspect={() => sheet.inspect("CMD", sheet.derived.cmd)}
            testId="stat-cmd"
          />
        </div>
        <div className="defense-reminders" aria-label="Damage reduction and resistances">
          {Math.max(sheet.character.defenses?.spellResistance ?? 0, sheet.noteDerivedDefenses.spellResistance ?? 0) > 0 && <span>Spell resistance <b>{Math.max(sheet.character.defenses?.spellResistance ?? 0, sheet.noteDerivedDefenses.spellResistance ?? 0)}</b></span>}
          {effectiveDamageReduction.map((entry, index) => <span key={index}>DR <b>{entry.amount}{entry.bypass ? `/${entry.bypass}` : ""}{entry.appliesAgainst?.length ? ` vs ${entry.appliesAgainst.join("/")}` : ""}</b></span>)}
          {Object.entries(effectiveResistances).map(([type, value]) => value > 0 && <span key={type}>{type} resistance <b>{value}</b></span>)}
          {(sheet.character.defenses?.energyImmunities ?? []).map((type) => <span key={type}>{type} immunity</span>)}
          {(sheet.character.nonlethalDamage ?? 0) > 0 && <span>Nonlethal damage <b>{sheet.character.nonlethalDamage}</b></span>}
          {sheet.character.record?.armorClassNotes && <span>AC: {sheet.character.record.armorClassNotes}</span>}
          {sheet.character.record?.savingThrowNotes && <span>Saves: {sheet.character.record.savingThrowNotes}</span>}
        </div>
        <label className="field"><span>Conditions on this character · one per line</span><textarea rows={2} value={(sheet.character.activeConditions ?? []).join("\n")} onChange={(event) => sheet.update({ activeConditions: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} /><small>When another character links this sheet as a target, these conditions become target flags such as target-cursed for authored effects.</small></label>
        <div className="saves-row">
          <RollTargetField
            label="DC for saves & skills"
            value={sheet.rollDc}
            testId="roll-dc-saves"
            onChange={sheet.setRollDc}
          />
          <CoverField label="Your cover on Reflex saves" value={sheet.reflexCover} testId="reflex-save-cover" onChange={sheet.setReflexCover} />
          <div className="roll-row" key="initiative">
            <button
              className="value-link"
              onClick={() =>
                sheet.inspect("Initiative", sheet.derived.initiative)
              }
            >
              <span>initiative</span>
              <strong>{formatModifier(sheet.derived.initiative.value)}</strong>
            </button>
            <button
              className="roll-button"
              data-testid="roll-initiative"
              onClick={() => void sheet.rollInitiative()}
            >
              ROLL d20
            </button>
          </div>
          {(["fortitude", "reflex", "will"] as const).map((save) => (
            <div className="roll-row" key={save}>
              <button
                className="value-link"
                onClick={() => sheet.inspect(save, sheet.derived.saves[save])}
              >
                <span>{save}</span>
                <strong>{formatModifier(sheet.derived.saves[save].value)}</strong>
              </button>
              <button
                className="roll-button"
                data-testid={"roll-" + save}
                onClick={() => void sheet.rollSave(save)}
              >
                ROLL d20
              </button>
            </div>
          ))}
        </div>
      </section>
  );
}

export function AttacksPanel({ sheet }: { sheet: CharacterSheet }) {
  const [selectedFullAttackIds, setSelectedFullAttackIds] = useState<string[]>([]);
  const offHandAttackCount = sheet.offHandAttackCount;
  const selectedAttackIds = selectedFullAttackIds.filter((id) => sheet.derived.attacks.some((attack) => attack.definition.id === id));
  const grappled = sheet.character.features.some((feature) => feature.enabled && feature.definitionId === "pf1e.paizo.grappled");
  const toggleFullAttack = (id: string, selected: boolean) => setSelectedFullAttackIds((previous) =>
    selected ? [...previous.filter((item) => item !== id), id] : previous.filter((item) => item !== id),
  );
  const updateAttack = (id: string, changes: Partial<AttackDefinition>) => sheet.update({
    attacks: sheet.character.attacks.map((attack) => attack.id === id ? { ...attack, ...changes } : attack),
  }, "Updated attack profile");
  return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ATTACKS</span>
            <h2>Weapons & full attack plans</h2>
          </div>
          <span className="helper">
            Standard attacks and explicit full-attack actions · extras once per
            action
          </span>
        </div>
        <div className="combat-targets">
          <LinkedTargetFields characters={sheet.savedCharacters.filter((item) => item.id !== sheet.character.id && (!sheet.character.campaignId || item.campaignId === sheet.character.campaignId))} targetId={sheet.linkedTargetId} context={sheet.targetDefenseContext} testIdPrefix="attack-target" onTargetChange={sheet.setLinkedTargetId} onContextChange={sheet.setTargetDefenseContext} onRefresh={sheet.refreshLinkedTarget} />
          <RollTargetField
            label="Target AC for weapon attacks"
            value={sheet.linkedTargetId && sheet.linkedTargetDefenseValue !== undefined ? String(sheet.linkedTargetDefenseValue) : sheet.attackAc}
            testId="roll-ac-attacks"
            onChange={sheet.setAttackAc}
            readOnly={Boolean(sheet.linkedTargetId && sheet.linkedTargetDefenseValue !== undefined)}
          />
          <RollTargetField
            label="Target CMD for maneuvers"
            value={sheet.linkedTargetCmdValue !== undefined && sheet.linkedTargetCharacter?.id === sheet.linkedTargetId ? String(sheet.linkedTargetCmdValue) : sheet.maneuverCmd}
            testId="roll-cmd-maneuvers"
            onChange={sheet.setManeuverCmd}
            readOnly={Boolean(sheet.linkedTargetCmdValue !== undefined && sheet.linkedTargetCharacter?.id === sheet.linkedTargetId)}
          />
          <CoverField label="Target cover against attacks" value={sheet.targetCover} testId="attack-target-cover" onChange={sheet.setTargetCover} showTotal />
          <MissChanceField label="Target concealment" value={sheet.targetMissChance} testId="attack-target-miss-chance" onChange={sheet.setTargetMissChance} />
          <IgnoreCoverField checked={sheet.ignoreNonTotalCover} testId="attack-ignore-cover" onChange={sheet.setIgnoreNonTotalCover} />
        </div>
        <p className="muted">A linked saved character supplies current AC and CMD; refresh it after changes. Trip is unavailable against targets more than one size category larger.</p>
        <label className="field twf-control">
          <span>Off-hand attacks · Autosheet TWF</span>
          <select aria-label="Autosheet TWF off-hand attack count" value={offHandAttackCount} onChange={(event) => sheet.setOffHandAttackCount(Number(event.target.value))}>
            <option value={0}>0 · Off hand inactive</option>
            <option value={1}>1 · TWF 1</option>
            <option value={2}>2 · TWF 2</option>
            <option value={3}>3 · TWF 3</option>
          </select>
          <small>Each additional off-hand attack takes the next −5 iterative penalty. Full attacks with selected primary- and off-hand weapons also apply the standard two-weapon penalties.</small>
        </label>
        {selectedAttackIds.length >= 2 && (
          <div className="combined-full-attack">
            <div>
              <span className="eyebrow">COMBINED FULL ATTACK</span>
              <p>{selectedAttackIds.length} selected weapons. Each weapon keeps its own sequence; action-level extra attacks apply once to the primary weapon.</p>
            </div>
            <WeaponActionControls
              sheet={sheet}
              actionPlan={sheet.createWeaponActionPlan(selectedAttackIds[0]!, "fullAttack", undefined, selectedAttackIds, offHandAttackCount)}
              attackId={selectedAttackIds[0]!}
              attackName="Selected weapons"
              action="fullAttack"
              testIdPrefix="roll-combined"
              offHandAttackCount={offHandAttackCount}
            />
            <small className="muted">Two-weapon attack penalties use the selected weapons, their hand roles, and the character’s Two-Weapon Fighting feat setting. Hand-use restrictions and other feat-specific modifiers remain table-managed.</small>
          </div>
        )}
        {sheet.derived.attacks.map((attack) => (
          <div
            className="attack-row full-attack-row"
            key={attack.definition.id}
          >
            <label className="full-attack-select">
              <input
                type="checkbox"
                aria-label={`Include ${attack.definition.name} in combined full attack`}
                checked={selectedAttackIds.includes(attack.definition.id)}
                onChange={(event) => toggleFullAttack(attack.definition.id, event.target.checked)}
              />
              Combine
            </label>
            <button
              className="value-link attack-name"
              onClick={() =>
                sheet.inspect(attack.definition.name + " attack", attack.attack)
              }
            >
              <span>{attack.definition.name}</span>
              <strong>{formatModifier(attack.attack.value)}</strong>
              <small>{attack.damage.formula}</small>
              <span className="damage-term-provenance">
                {attack.damage.terms.map((term) =>
                  `${term.dice.count}d${term.dice.sides} ${term.source.label}${term.damageType ? ` (${term.damageType})` : ""}${term.criticalBehavior === "notMultiplied" ? " · not multiplied" : ""}`,
                ).join(" · ")}
              </span>
              {attack.damage.excludedDamageTerms?.map((term, index) => (
                <span className="damage-term-provenance excluded" key={`${term.source.id}-${index}`}>
                  Excluded {term.dice.count}d{term.dice.sides} {term.label}: {term.reason}
                </span>
              ))}
            </button>
            <details className="attack-profile-editor">
              <summary>Edit attack</summary>
              <div className="inline-fields">
                <label>Attack name<input aria-label={`Edit attack name ${attack.definition.name}`} value={attack.definition.name} onChange={(event) => updateAttack(attack.definition.id, { name: event.target.value })} /></label>
                <label>Attack ability<select aria-label={`Edit attack ability ${attack.definition.name}`} value={attack.definition.attackAbility} onChange={(event) => updateAttack(attack.definition.id, { attackAbility: event.target.value as AbilityId })}>{abilities.map((id) => <option key={id} value={id}>{abilityLabels[id]}</option>)}</select></label>
                <label>Damage ability<select aria-label={`Edit damage ability ${attack.definition.name}`} value={attack.definition.damageAbility ?? "none"} onChange={(event) => updateAttack(attack.definition.id, { damageAbility: event.target.value === "none" ? undefined : event.target.value as AbilityId })}><option value="none">No ability modifier</option>{abilities.map((id) => <option key={id} value={id}>{abilityLabels[id]}</option>)}</select></label>
                <label>Damage ability multiplier<input aria-label={`Edit damage ability multiplier ${attack.definition.name}`} type="number" min="-2" max="2" step="0.5" value={attack.definition.damageAbilityMultiplier ?? 1} onChange={(event) => updateAttack(attack.definition.id, { damageAbilityMultiplier: Number(event.target.value) })} /></label>
                <label>Damage dice count<input aria-label={`Edit damage dice count ${attack.definition.name}`} type="number" min="1" value={attack.definition.baseDamage.count} onChange={(event) => updateAttack(attack.definition.id, { baseDamage: { ...attack.definition.baseDamage, count: Math.max(1, Number(event.target.value) || 1) } })} /></label>
                <label>Damage die sides<input aria-label={`Edit damage die sides ${attack.definition.name}`} type="number" min="2" value={attack.definition.baseDamage.sides} onChange={(event) => updateAttack(attack.definition.id, { baseDamage: { ...attack.definition.baseDamage, sides: Math.max(2, Number(event.target.value) || 2) } })} /></label>
                <label>Threat range<select aria-label={`Edit threat range ${attack.definition.name}`} value={attack.definition.criticalRange?.minimumNaturalRoll ?? ""} onChange={(event) => updateAttack(attack.definition.id, { criticalRange: event.target.value ? { minimumNaturalRoll: Number(event.target.value) } : undefined })}><option value="">Profile/default</option>{Array.from({ length: 19 }, (_, index) => 20 - index).map((face) => <option key={face} value={face}>{face}–20</option>)}</select></label>
                <label>Critical multiplier<select aria-label={`Edit critical multiplier ${attack.definition.name}`} value={attack.definition.criticalMultiplier ?? ""} onChange={(event) => updateAttack(attack.definition.id, { criticalMultiplier: event.target.value ? Number(event.target.value) : undefined })}><option value="">Profile/default</option>{[2, 3, 4, 5].map((multiplier) => <option key={multiplier} value={multiplier}>×{multiplier}</option>)}</select></label>
              </div>
              <small className="muted">Leave profile-based critical values blank to use the selected attack profile’s rules.</small>
            </details>
            <div className="attack-sequence">
              <button
                className="value-link"
                aria-label={"Inspect " + attack.definition.name + " damage"}
                onClick={() =>
                  sheet.inspect(attack.definition.name + " damage modifier", {
                    target: `damage.${attack.definition.mode ?? "melee"}`,
                    value: attack.damage.modifier,
                    contributions: attack.damage.contributions,
                    ...(attack.damage.excluded
                      ? { excluded: attack.damage.excluded }
                      : {}),
                  })
                }
              >
                Damage · inspect
              </button>
              <WeaponActionControls
                sheet={sheet}
                actionPlan={sheet.createWeaponActionPlan(
                  attack.definition.id,
                  "standardAttack",
                  undefined,
                  [attack.definition.id],
                  offHandAttackCount,
                )}
                attackId={attack.definition.id}
                attackName={attack.definition.name}
                action="standardAttack"
                testIdPrefix={"roll-standard-" + attack.definition.id}
                testIdFor={(kind) =>
                  kind === "attack"
                    ? "roll-standard-" + attack.definition.id
                    : kind === "damage"
                      ? "roll-standard-damage-" + attack.definition.id
                      : "roll-standard-critical-damage-" + attack.definition.id
                }
                offHandAttackCount={offHandAttackCount}
              />
              <WeaponActionControls
                sheet={sheet}
                actionPlan={sheet.createWeaponActionPlan(
                  attack.definition.id,
                  "fullAttack",
                  undefined,
                  [attack.definition.id],
                  offHandAttackCount,
                )}
                attackId={attack.definition.id}
                attackName={attack.definition.name}
                action="fullAttack"
                testIdPrefix={"roll-full-" + attack.definition.id}
                testIdFor={(kind, index) => {
                  const suffix = index ? "-" + index : "";
                  if (kind === "attack")
                    return "roll-attack-" + attack.definition.id + suffix;
                  if (kind === "damage")
                    return "roll-damage-" + attack.definition.id + suffix;
                  return "roll-critical-damage-" + attack.definition.id + suffix;
                }}
                offHandAttackCount={offHandAttackCount}
              />
            </div>
          </div>
        ))}
        <div className="maneuver-row">
          <span className="eyebrow">MANEUVERS</span>
          <label>
            CMB ability
            <select aria-label="Maneuver ability" value={sheet.maneuverAbilityOverride} onChange={(event) => sheet.setManeuverAbilityOverride(event.target.value as AbilityId | "")}>
              <option value="">Default (Str / size-adjusted Dex)</option>
              {abilities.map((id) => <option key={id} value={id}>{abilityLabels[id]}</option>)}
            </select>
          </label>
          <label>
            Full-BAB class
            <select aria-label="Full-BAB class level" value={sheet.maneuverBabProgressionId} onChange={(event) => sheet.setManeuverBabProgressionId(event.target.value)}>
              <option value="">Character BAB</option>
              {Object.keys(sheet.derived.advancement?.progressionLevels ?? {}).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          {maneuverIds.map(
            (maneuver) => (
              <button
                key={maneuver}
                className="roll-button"
                data-testid={"roll-maneuver-" + maneuver}
                aria-label={"Roll " + maneuver.replaceAll("-", " ") + " maneuver"}
                onClick={() => void sheet.rollManeuver(maneuver)}
              >
                {maneuver.toUpperCase()}{" "}
                {formatModifier(
                  sheet.createManeuverPlan(maneuver).modifier,
                )}
              </button>
            ),
          )}
          {grappled && <><button className="roll-button" data-testid="roll-escape-grapple" onClick={() => void sheet.rollManeuver("escape-grapple")}>Escape Grapple (CMB) · standard action</button><button className="roll-button" data-testid="roll-escape-grapple-artist" onClick={() => void sheet.rollSkill("escape-artist", undefined, [], undefined, true)}>Escape Grapple (Escape Artist) · standard action</button></>}
        </div>
        <div className="add-row">
          <input
            placeholder="Attack name"
            aria-label="New attack name"
            value={sheet.attackName}
            onChange={(event) => sheet.setAttackName(event.target.value)}
          />
          <input
            placeholder="1d8"
            aria-label="New attack dice"
            value={sheet.attackDice}
            onChange={(event) => sheet.setAttackDice(event.target.value)}
          />
          <select
            aria-label="New attack ability"
            value={sheet.attackAbility}
            onChange={(event) =>
              sheet.setAttackAbility(event.target.value as AbilityId)
            }
          >
            {abilities.map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}
              </option>
            ))}
          </select>
          <details className="critical-rules-editor"><summary>Critical rules (optional)</summary><div className="inline-fields"><label>Threatens on<select aria-label="New attack critical range" value={sheet.attackCriticalRange} onChange={(event) => sheet.setAttackCriticalRange(event.target.value)}><option value="">Default (20)</option>{Array.from({ length: 19 }, (_, index) => 20 - index).map((face) => <option key={face} value={face}>{face}–20</option>)}</select></label><label>Damage multiplier<select aria-label="New attack critical multiplier" value={sheet.attackCriticalMultiplier} onChange={(event) => sheet.setAttackCriticalMultiplier(event.target.value)}><option value="">Default (×2)</option>{[2, 3, 4, 5].map((multiplier) => <option key={multiplier} value={multiplier}>×{multiplier}</option>)}</select></label></div></details>
          <label className="checkbox-field"><input type="checkbox" checked={sheet.attackIsNatural} onChange={(event) => sheet.setAttackIsNatural(event.target.checked)} /><span>Natural attack</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={sheet.attackFlurryEligible} onChange={(event) => sheet.setAttackFlurryEligible(event.target.checked)} /><span>Usable for Monk Flurry</span></label>
          {sheet.attackIsNatural && <><select aria-label="New natural attack role" value={sheet.attackNaturalRole} onChange={(event) => sheet.setAttackNaturalRole(event.target.value as "primary" | "secondary")}><option value="primary">Primary natural attack</option><option value="secondary">Secondary natural attack</option></select><Field label="Natural attacks per full attack" value={sheet.customWeaponAttackCount} onChange={sheet.setCustomWeaponAttackCount} /></>}
          <details className="size-damage-editor"><summary>Damage dice by size (optional)</summary><small>Enter the weapon’s damage dice for any sizes it supports. Unlisted sizes use the main damage dice.</small><div className="inline-fields">{sizeCategories.map((size) => <label key={size}>{size}<input aria-label={`Damage dice for ${size} size`} placeholder="1d8" value={sheet.attackDamageBySize[size] ?? ""} onChange={(event) => sheet.setAttackDamageBySize((current) => ({ ...current, [size]: event.target.value }))} /></label>)}</div></details>
          <button className="button quiet" onClick={sheet.addAttack}>
            + Add attack
          </button>
        </div>
      </section>
  );
}

export function SkillsPanel({ sheet }: { sheet: CharacterSheet }) {
  const [customSkillName, setCustomSkillName] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [customSkillAbility, setCustomSkillAbility] = useState<AbilityId>("int");
  const [customSkillTrainedOnly, setCustomSkillTrainedOnly] = useState(false);
  const addCustomSkill = () => {
    const name = customSkillName.trim();
    if (!name) return;
    const base = name.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
    const existing = new Set([...Object.keys(sheet.character.skillRanks), ...Object.keys(sheet.character.skills ?? {})]);
    let id = `custom-${base}`;
    for (let suffix = 2; existing.has(id) || skillCatalog[id]; suffix += 1) id = `custom-${base}-${suffix}`;
    if (sheet.update({ skillRanks: { ...sheet.character.skillRanks, [id]: 0 }, skills: { ...sheet.character.skills, [id]: { name, governingAbility: customSkillAbility, classSkillOverride: false, ...(customSkillTrainedOnly ? { trainedOnly: true } : {}) } } }, `Added custom skill ${name}`)) setCustomSkillName("");
  };
  return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SKILLS</span>
            <h2>Skills</h2>
          </div>
          <span className="helper">
            Ranks, class-skill bonuses, and ability modifiers are included in
            each roll. Choose a DC below.
          </span>
        </div>
        <RollTargetField
          label="DC for saves & skills"
          value={sheet.rollDc}
          testId="roll-dc-skills"
          onChange={sheet.setRollDc}
        />
        <details className="skill-authoring"><summary>Add a custom skill or specialization</summary><div className="form-grid">
          <label className="field"><span>Custom skill or specialization</span><input aria-label="Custom skill or specialization" value={customSkillName} onChange={(event) => setCustomSkillName(event.target.value)} placeholder="Craft (Alchemy), Profession (Sailor), Lore (Local)" /></label>
          <label className="field"><span>Governing ability</span><select aria-label="Custom skill governing ability" value={customSkillAbility} onChange={(event) => setCustomSkillAbility(event.target.value as AbilityId)}>{abilities.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}</select></label>
          <label className="checkbox-field"><input type="checkbox" checked={customSkillTrainedOnly} onChange={(event) => setCustomSkillTrainedOnly(event.target.checked)} /><span>Trained only</span></label>
          <button className="button quiet" onClick={addCustomSkill}>+ Add custom skill</button>
        </div></details>
        {sheet.derived.advancement && <div className="skill-budget-summary" aria-label="Skill rank budget">
          <span>Regular skill ranks {(sheet.derived.advancement.skillRanksUsed ?? 0) - Math.min(sheet.derived.advancement.backgroundSkillPointBudget ?? 0, sheet.derived.advancement.backgroundSkillRanksUsed ?? 0)} / {sheet.derived.advancement.workbookSkillPointBudget}</span>
          {(sheet.derived.advancement.backgroundSkillPointBudget ?? 0) > 0 && <span>Background skill ranks {sheet.derived.advancement.backgroundSkillRanksUsed} / {sheet.derived.advancement.backgroundSkillPointBudget}</span>}
        </div>}
        <label className="skill-search"><span>Find a skill</span><input type="search" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="Search skills…" aria-label="Search skills" /></label>
        <div className="skills-grid">
          {Object.values(sheet.derived.skills).filter((skill) => skill.label.toLocaleLowerCase().includes(skillSearch.trim().toLocaleLowerCase())).map((skill) => {
            const override =
              sheet.character.skills?.[skill.id]?.classSkillOverride ??
              sheet.character.skills?.[skill.id]?.classSkill;
            return (
              <div className="skill-row" key={skill.id}>
                {skill.id.startsWith("custom-") ? <div className="skill-inspect custom-skill-fields">
                  <input aria-label={`${skill.label} name`} value={sheet.character.skills?.[skill.id]?.name ?? skill.label} onChange={(event) => sheet.update({ skills: { ...sheet.character.skills, [skill.id]: { ...sheet.character.skills?.[skill.id], name: event.target.value } } })} />
                  <select aria-label={`${skill.label} governing ability`} value={sheet.character.skills?.[skill.id]?.governingAbility ?? skill.governingAbility} onChange={(event) => sheet.update({ skills: { ...sheet.character.skills, [skill.id]: { ...sheet.character.skills?.[skill.id], governingAbility: event.target.value as AbilityId } } })}>{abilities.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}</select>
                  <label className="checkbox-field"><input aria-label={`${skill.label} trained only`} type="checkbox" checked={sheet.character.skills?.[skill.id]?.trainedOnly ?? false} onChange={(event) => sheet.update({ skills: { ...sheet.character.skills, [skill.id]: { ...sheet.character.skills?.[skill.id], trainedOnly: event.target.checked } } })} /><span>Trained</span></label>
                  <button type="button" className="skill-total-inspect" title="Show calculation breakdown" onClick={() => sheet.inspect(skill.label, skill.total)}><b>{formatModifier(skill.total.value)}</b><small>inspect →</small></button>
                </div> : <button className="skill-inspect" title={sourceLabel(skillCatalog[skill.id]?.source) + (skillCatalog[skill.id]?.trainedOnly ? " · Trained only" : "")} onClick={() => sheet.inspect(skill.label, skill.total)}>
                  <span>{skill.label}</span><em>{skill.governingAbility.toUpperCase()}{skill.classSkill ? " · class" : ""}</em><b>{formatModifier(skill.total.value)}</b>
                </button>}
                <div className="skill-roll-buttons">
                  <button
                    className="roll-button"
                    data-testid={"roll-skill-" + skill.id}
                    disabled={(skillCatalog[skill.id]?.trainedOnly || sheet.character.skills?.[skill.id]?.trainedOnly) && skill.ranks < 1}
                    onClick={() => void sheet.rollSkill(skill.id)}
                  >
                    ROLL d20
                  </button>
                  <button
                    className="roll-button"
                    aria-label={`Roll ${skill.label} as a reaction`}
                    title="Situational reaction check"
                    disabled={(skillCatalog[skill.id]?.trainedOnly || sheet.character.skills?.[skill.id]?.trainedOnly) && skill.ranks < 1}
                    onClick={() => void sheet.rollSkill(skill.id, undefined, ["reaction-check"])}
                  >
                    REACTION
                  </button>
                </div>
                {skill.id === "acrobatics" && (
                  <button
                    className="roll-button"
                    aria-label="Roll Acrobatics jump check"
                    onClick={() => void sheet.rollSkill(skill.id, "jump")}
                  >
                    JUMP
                  </button>
                )}
                <label className="rank-input">
                  <span>ranks</span>
                  <input
                    aria-label={skill.label + " ranks"}
                    type="number"
                    min="0"
                    step="0.5"
                    value={skill.ranks}
                    onChange={(event) =>
                      sheet.update({
                        skillRanks: {
                          ...sheet.character.skillRanks,
                          [skill.id]: Number(event.target.value) || 0,
                        },
                      })
                    }
                  />
                </label>
                {skill.id.startsWith("custom-") && <button type="button" className="table-action" aria-label={`Remove custom skill ${skill.label}`} onClick={() => { const { [skill.id]: _removed, ...skills } = sheet.character.skills ?? {}; const { [skill.id]: _removedRanks, ...skillRanks } = sheet.character.skillRanks; sheet.update({ skills, skillRanks }); }}>×</button>}
                <select
                  className="class-skill-override"
                  aria-label={skill.label + " class skill override"}
                  value={
                    override === undefined
                      ? "auto"
                      : override
                        ? "yes"
                        : "no"
                  }
                  onChange={(event) => {
                    const current = sheet.character.skills?.[skill.id] ?? {};
                    const {
                      classSkillOverride: removed,
                      classSkill: legacyRemoved,
                      ...rest
                    } = current;
                    sheet.update({
                      skills: {
                        ...sheet.character.skills,
                        [skill.id]:
                          event.target.value === "auto"
                            ? rest
                            : {
                                ...rest,
                                classSkillOverride:
                                  event.target.value === "yes",
                              },
                      },
                    });
                  }}
                >
                  <option value="auto">auto</option>
                  <option value="yes">class</option>
                  <option value="no">not class</option>
                </select>
              </div>
            );
          })}
          {Object.values(sheet.derived.skills).every((skill) => !skill.label.toLocaleLowerCase().includes(skillSearch.trim().toLocaleLowerCase())) && <p className="muted">No skills match “{skillSearch}”.</p>}
        </div>
      </section>
  );
}

function containerWouldCreateCycle(items: NonNullable<CharacterInput["equipment"]>, itemId: string, proposedContainerId: string): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let currentId: string | undefined = proposedContainerId;
  while (currentId) {
    if (currentId === itemId || visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.containerId;
  }
  return false;
}

export function EquipmentPanel({ sheet }: { sheet: CharacterSheet }) {
  const items = sheet.character.equipment ?? [];
  const updateItem = (id: string, patch: Partial<(typeof items)[number]>) => sheet.update({ equipment: items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  const addInventoryItem = (category: EquipmentInventoryCategory) => {
    const label = equipmentCategoryLabels[category];
    const weight = estimatedWeightByEquipmentCategory[category];
    sheet.update({ equipment: [...items, {
      id: nextId("inventory-item", items.map((item) => item.id)),
      name: `New ${label.toLocaleLowerCase("en-US")}`,
      inventoryCategory: category,
      kind: "other",
      equipped: false,
      carried: true,
      quantity: 1,
      ...(weight !== undefined ? { weight } : {}),
    }] }, `Added ${label.toLocaleLowerCase("en-US")}`);
  };
  const load = calculateCarryLoad(resolveEquipment(sheet.character, equipmentCatalog), sheet.derived.abilities.str.score.value, sheet.derived.size.category, autosheetSizeAdjustmentCatalog);
  const slotOverloads = equipmentSlotOverloads(sheet.character, equipmentCatalog, autosheetWornSlotReference);
  const inventory = sheet.character.inventory ?? {};
  const budget = calculateEquipmentBudget(sheet.character);
  const companion = inventory.companion ?? { items: [] };
  const companionItems = companion.items ?? [];
  const companionLoad = companion.strength ? calculateCarryLoad(companionItems, companion.strength, companion.size ?? "medium", autosheetSizeAdjustmentCatalog) : undefined;
  const companionWondrousSlots = companion.bodyType ? autosheetCompanionWondrousSlots[companion.bodyType].slots : undefined;
  const invalidCompanionSlotItems = companionWondrousSlots ? companionItems.filter((item) => item.slot?.trim() && !companionWondrousSlots.includes(item.slot.trim() as never)) : [];
  const profileHasNaturalAttack = attackProfileCatalog[sheet.profileId]?.attackTags.includes("natural.attack") ?? false;
  const updateCompanion = (changes: Partial<typeof companion>) => sheet.update({ inventory: { ...inventory, companion: { ...companion, ...changes } } });
  return (
      <section className="panel equipment-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EQUIPMENT</span>
            <h2>Catalog gear & custom weapons</h2>
          </div>
          <span className="helper">
            Carried gear, worn items, storage, currency & encumbrance
          </span>
        </div>
        <div className="equipment-load-summary">
          <b>{load.carriedWeight.toLocaleString()} lb carried · {load.band}</b>
          <span>Light &lt; {load.lightLimit.toLocaleString()} lb · Medium &lt; {load.mediumLimit.toLocaleString()} lb · Heavy ≤ {load.heavyLimit.toLocaleString()} lb</span>
          {(load.band === "medium" || load.band === "heavy") && <span>{load.band === "medium" ? "Maximum Dexterity +3 · armor check penalty −3" : "Maximum Dexterity +1 · armor check penalty −6"} · land speed uses the {load.band} load rate. The check penalty adds to worn armor.</span>}
          {load.containerOverloads.map((container) => <small className="error-banner" key={container.itemId}>{container.name}: {container.weight} lb exceeds its {container.capacity} lb capacity.</small>)}
          {slotOverloads.map(({ slot, items: slotItems, capacity }) => <small className="error-banner" key={slot}>{slotItems.length} equipped items use the {slot} slot; the workbook provides {capacity}.</small>)}
        </div>
        <div className="form-grid inventory-currency">
          {(["platinum", "gold", "silver", "copper"] as const).map((coin) => <Field key={coin} label={`${coin} pieces on hand`} type="number" value={inventory[coin] ?? 0} onChange={(value) => sheet.update({ inventory: { ...inventory, [coin]: Math.max(0, Number(value) || 0) } })} />)}
        </div>
        <div className="form-grid inventory-currency">
          <Field label="Starting wealth budget (gp)" type="number" value={inventory.startingGold ?? ""} onChange={(value) => sheet.update({ inventory: { ...inventory, startingGold: value === "" ? undefined : Math.max(0, Number(value) || 0) } })} />
          {budget && <div className="equipment-load-summary"><b>{budget.remainingGold.toLocaleString(undefined, { maximumFractionDigits: 2 })} gp budget remaining</b><span>{budget.spentGold.toLocaleString(undefined, { maximumFractionDigits: 2 })} gp spent on listed character items</span></div>}
        </div>
        <div className="catalog-add-row">
          <select
            aria-label="Catalog equipment"
            value={sheet.equipmentId}
            onChange={(event) => sheet.setEquipmentId(event.target.value)}
          >
            <option value="">Choose catalog equipment…</option>
            {sheet.equipmentOptions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name} · {definition.kind}
              </option>
            ))}
          </select>
          <button
            className="button quiet"
            disabled={!sheet.equipmentId}
            onClick={sheet.addEquipment}
          >
            + Equip selected
          </button>
        </div>
        <details className="editor-subsection inventory-add-section">
          <summary>Add a character inventory item</summary>
          <p className="muted">These categories mirror the workbook’s blank equipment tables. Disposable magic items start at the workbook’s ¼ lb estimate; alchemical items start at ½ lb. Adjust weight, quantity, price, and notes for the actual item.</p>
          <div className="inline-actions inventory-add-actions">
            {equipmentInventoryCategories.map((category) => <button className="button quiet" type="button" key={category} onClick={() => addInventoryItem(category)}>+ {equipmentCategoryLabels[category]}</button>)}
          </div>
        </details>
        {sheet.equipmentId && (
          <p className="muted">
            {sourceLabel(equipmentCatalog[sheet.equipmentId]?.source)}
            {equipmentCatalog[sheet.equipmentId]?.description
              ? " · " + equipmentCatalog[sheet.equipmentId]?.description
              : ""}
          </p>
        )}
        {items.map((item) => (
          <div className="equipment-row" key={item.id}>
          {(() => { const resolved = sheet.engine.equipment.find((entry) => entry.id === item.id); return <>
              {resolved?.materialWarning && <small className="error-banner">{resolved.materialWarning}</small>}
              {resolved?.attachmentWarning && <small className="error-banner">{resolved.attachmentWarning}</small>}
              {resolved?.materialNotes && <small className="muted">Material effect: {resolved.materialNotes}</small>}
              {resolved?.containerWeightMultiplier === 0 && <small className="muted">Fixed container weight: contents count toward capacity but do not add to carried weight.</small>}
              {resolved?.armorWeightCategory !== undefined && <small className="muted">Armor category: {(["Unarmored", "Light", "Medium", "Heavy"][resolved.armorWeightCategory] ?? "Unknown")}{resolved.reduceLandSpeed ? " · reduces land speed" : ""}</small>}
            </>; })()}
            <label>
              <input
                aria-label={"Equip " + (item.name ?? item.id)}
                type="checkbox"
                checked={item.equipped}
                onChange={() => {
                  const equipped = !item.equipped;
                  const kind = item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind;
                  sheet.update({
                    equipment: (sheet.character.equipment ?? []).map((entry) =>
                      entry.id === item.id
                        ? { ...entry, equipped, ...((kind === "weapon" || kind === "shield" || item.attack) ? { held: equipped, ...(equipped ? { carried: true } : {}) } : {}) }
                        : entry,
                    ),
                  });
                }}
              />{" "}
              <b>
                {item.name ??
                  equipmentCatalog[item.definitionId ?? ""]?.name ??
                  item.definitionId ??
                  "Unnamed item"}
              </b>
            </label>
            <small>
              {item.definitionId
                ? sourceLabel(equipmentCatalog[item.definitionId]?.source)
                : item.attack
                  ? "Local custom weapon"
                  : "Local custom equipment"}
              {item.definitionId &&
                equipmentCatalog[item.definitionId]?.description && (
                  <span>
                    {" "}
                    · {equipmentCatalog[item.definitionId]?.description}
                  </span>
                )}
              {(() => { const chance = sheet.engine.equipment.find((entry) => entry.id === item.id)?.arcaneSpellFailureChance; return chance !== undefined && chance > 0 ? <span> · Arcane spell failure {Math.round(chance * 100)}%</span> : null; })()}
            </small>
            <div className="inventory-item-fields">
              <label>Item name<input aria-label={`Item name ${item.name ?? item.id}`} value={item.name ?? equipmentCatalog[item.definitionId ?? ""]?.name ?? ""} onChange={(event) => updateItem(item.id, { name: event.target.value || undefined })} /></label>
              <label>Workbook section<select aria-label={`Inventory category ${item.name ?? item.id}`} value={item.inventoryCategory ?? "general"} onChange={(event) => updateItem(item.id, { inventoryCategory: event.target.value as EquipmentInventoryCategory })}>{equipmentInventoryCategories.map((category) => <option key={category} value={category}>{equipmentCategoryLabels[category]}</option>)}</select></label>
              <label><input type="checkbox" aria-label={`Carry ${item.name ?? item.id}`} checked={item.carried !== false} onChange={(event) => updateItem(item.id, { carried: event.target.checked })} /> Carried</label>
              <label><input type="checkbox" aria-label={`Held ${item.name ?? item.id}`} checked={item.held ?? false} onChange={(event) => { const kind = item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind; updateItem(item.id, { held: event.target.checked, ...(event.target.checked ? { carried: true, ...((kind === "weapon" || kind === "shield" || item.attack) ? { equipped: true } : {}) } : { ...((kind === "weapon" || kind === "shield" || item.attack) ? { equipped: false } : {}) }) }); }} /> Held</label>
              <label>Quantity<input aria-label={`Quantity ${item.name ?? item.id}`} type="number" min="1" step="1" value={item.quantity ?? 1} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} /></label>
              <label>Weight (lb)<input aria-label={`Weight ${item.name ?? item.id}`} type="number" min="0" step="0.1" value={item.weight ?? equipmentCatalog[item.definitionId ?? ""]?.weight ?? ""} onChange={(event) => updateItem(item.id, { weight: Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label>Value (gp)<input aria-label={`Value ${item.name ?? item.id}`} type="number" min="0" step="0.01" value={item.price ?? ""} onChange={(event) => updateItem(item.id, { price: Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label>Save DC<input aria-label={`Save DC ${item.name ?? item.id}`} type="number" min="0" step="1" value={item.saveDc ?? ""} onChange={(event) => updateItem(item.id, { saveDc: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label>Slot<input aria-label={`Slot ${item.name ?? item.id}`} list="autosheet-worn-slots" value={item.slot ?? ""} onChange={(event) => updateItem(item.id, { slot: event.target.value })} /></label>
              <label>Material<input aria-label={`Material ${item.name ?? item.id}`} list="autosheet-equipment-materials" value={item.material ?? ""} onChange={(event) => updateItem(item.id, { material: event.target.value })} /></label>
              {(item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind) === "shield" && item.definitionId !== "pf1e.autosheet.spell-shield" && <>
                {(item.definitionId !== "pf1e.autosheet.buckler" && item.name?.trim().toLocaleLowerCase("en-US") !== "buckler") && <label><input type="checkbox" aria-label={`Occupies a hand ${item.name ?? item.id}`} checked={item.shieldOccupiesHand ?? true} onChange={(event) => updateItem(item.id, { shieldOccupiesHand: event.target.checked })} /> Occupies a hand</label>}
                {(item.definitionId === "pf1e.autosheet.buckler" || item.name?.trim().toLocaleLowerCase("en-US") === "buckler" || (item.shieldOccupiesHand ?? true)) && <label>{item.definitionId === "pf1e.autosheet.buckler" || item.name?.trim().toLocaleLowerCase("en-US") === "buckler" ? "Buckler arm" : "Shield arm"}<select aria-label={`Shield arm ${item.name ?? item.id}`} value={item.shieldHand ?? "offHand"} onChange={(event) => updateItem(item.id, { shieldHand: event.target.value as "primary" | "offHand" })}><option value="offHand">Off hand</option><option value="primary">Primary hand</option></select></label>}
              </>}
              {(item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind) !== undefined && ["armor", "shield"].includes(item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind ?? "") && <label><input type="checkbox" aria-label={`Proficient with ${item.name ?? item.id}`} checked={item.armorProficient !== false} onChange={(event) => updateItem(item.id, { armorProficient: event.target.checked })} /> Proficient (unchecked: armor check penalty applies to attacks and all Strength/Dexterity skill checks)</label>}
              {[("pf1e.autosheet.light-shield"), ("pf1e.autosheet.heavy-shield")].includes(item.definitionId ?? "") && <label><input type="checkbox" aria-label={`Enable shield bash ${item.name ?? item.id}`} checked={Boolean(item.attack)} onChange={(event) => {
                if (!event.target.checked) { updateItem(item.id, { attack: undefined }); return; }
                const light = item.definitionId === "pf1e.autosheet.light-shield";
                const attackTags: NonNullable<AttackDefinition["attackTags"]> = ["weapon.melee", "weapon.off-hand"];
                if (light) attackTags.push("weapon.light");
                const attack: AttackDefinition = { id: `${item.id}-bash`, name: `${item.name ?? (light ? "Light shield" : "Heavy shield")} bash`, attackAbility: "str", damageAbility: "str", damageAbilityMultiplier: 1, baseDamage: { count: 1, sides: light ? 3 : 4 }, mode: "melee", attackTags, proficient: true };
                updateItem(item.id, { attack });
              }} /> Enable shield bash</label>}
              {item.definitionId === "pf1e.autosheet.tower-shield" && <small className="muted">Tower shields cannot be used to bash.</small>}
              {item.definitionId === "pf1e.autosheet.armored-kilt" && <label>Attach to armor<select aria-label="Armor for armored kilt" value={item.attachedTo ?? ""} onChange={(event) => updateItem(item.id, { attachedTo: event.target.value || undefined })}><option value="">Wear as standalone armor</option>{items.filter((candidate) => candidate.id !== item.id && (candidate.kind ?? equipmentCatalog[candidate.definitionId ?? ""]?.kind) === "armor" && candidate.definitionId !== "pf1e.autosheet.armored-kilt" && !items.some((other) => other.id !== item.id && other.definitionId === "pf1e.autosheet.armored-kilt" && other.attachedTo === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name ?? equipmentCatalog[candidate.definitionId ?? ""]?.name ?? candidate.id}</option>)}</select></label>}
              {item.attack && <>
                <label>Attack name<input aria-label={`Attack name ${item.name ?? item.id}`} value={item.attack.name} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, name: event.target.value } })} /></label>
                <label>Damage dice count<input aria-label={`Damage dice count ${item.name ?? item.id}`} type="number" min="1" value={item.attack.baseDamage.count} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, baseDamage: { ...item.attack!.baseDamage, count: Math.max(1, Number(event.target.value) || 1) } } })} /></label>
                <label>Damage die sides<input aria-label={`Damage die sides ${item.name ?? item.id}`} type="number" min="2" value={item.attack.baseDamage.sides} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, baseDamage: { ...item.attack!.baseDamage, sides: Math.max(2, Number(event.target.value) || 2) } } })} /></label>
                <label>Threat range<select aria-label={`Threat range ${item.name ?? item.id}`} value={item.attack.criticalRange?.minimumNaturalRoll ?? ""} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, criticalRange: event.target.value ? { minimumNaturalRoll: Number(event.target.value) } : undefined } })}><option value="">Use profile/default</option>{Array.from({ length: 19 }, (_, index) => 20 - index).map((face) => <option key={face} value={face}>{face}–20</option>)}</select></label>
                <label>Critical multiplier<select aria-label={`Critical multiplier ${item.name ?? item.id}`} value={item.attack.criticalMultiplier ?? ""} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, criticalMultiplier: event.target.value ? Number(event.target.value) : undefined } })}><option value="">Use profile/default</option>{[2, 3, 4, 5].map((multiplier) => <option key={multiplier} value={multiplier}>×{multiplier}</option>)}</select></label>
                <details className="size-damage-editor"><summary>Damage dice by size (optional)</summary><small>Unlisted sizes use the main damage dice.</small><div className="inline-fields">{sizeCategories.map((size) => <label key={size}>{size}<input aria-label={`${item.name ?? item.id} damage dice for ${size} size`} placeholder="1d8" defaultValue={item.attack!.damageBySize?.[size] ? `${item.attack!.damageBySize[size]!.count}d${item.attack!.damageBySize[size]!.sides}` : ""} onBlur={(event) => { const value = event.target.value.trim(); const parsed = /^(\d+)d(\d+)$/i.exec(value); const damageBySize = { ...item.attack!.damageBySize }; if (parsed) damageBySize[size] = { count: Number(parsed[1]), sides: Number(parsed[2]) }; else if (!value) delete damageBySize[size]; else return; updateItem(item.id, { attack: { ...item.attack!, damageBySize } }); }} /></label>)}</div></details>
                <label><input type="checkbox" aria-label={`Off-hand weapon ${item.name ?? item.id}`} checked={item.attack.attackTags?.includes("weapon.off-hand") ?? false} onChange={(event) => { const tags = new Set(item.attack?.attackTags ?? []); event.target.checked ? tags.add("weapon.off-hand") : tags.delete("weapon.off-hand"); updateItem(item.id, { attack: { ...item.attack!, attackTags: [...tags] } }); }} /> Off-hand weapon</label>
                <label><input type="checkbox" aria-label={`Light weapon ${item.name ?? item.id}`} checked={item.attack.attackTags?.includes("weapon.light") ?? false} onChange={(event) => { const tags = new Set(item.attack?.attackTags ?? []); event.target.checked ? tags.add("weapon.light") : tags.delete("weapon.light"); updateItem(item.id, { attack: { ...item.attack!, attackTags: [...tags] } }); }} /> Light weapon</label>
                <label><input type="checkbox" aria-label={`Natural attack ${item.name ?? item.id}`} checked={item.attack.attackTags?.includes("natural.attack") ?? false} onChange={(event) => { const tags = new Set(item.attack?.attackTags ?? []); event.target.checked ? tags.add("natural.attack") : tags.delete("natural.attack"); updateItem(item.id, { attack: { ...item.attack!, attackTags: [...tags], ...(event.target.checked ? { naturalAttackRole: item.attack?.naturalAttackRole ?? "primary" } : {}) } }); }} /> Natural attack</label>
                <label><input type="checkbox" aria-label={`Usable for Monk Flurry ${item.name ?? item.id}`} checked={item.attack.eligibilityTags?.includes("monk-flurry-weapon") ?? false} onChange={(event) => { const tags = new Set(item.attack?.eligibilityTags ?? []); event.target.checked ? tags.add("monk-flurry-weapon") : tags.delete("monk-flurry-weapon"); updateItem(item.id, { attack: { ...item.attack!, eligibilityTags: [...tags] } }); }} /> Usable for Monk Flurry</label>
                {item.attack.attackTags?.includes("natural.attack") && <><label>Natural attack role<select aria-label={`Natural attack role ${item.name ?? item.id}`} value={item.attack.naturalAttackRole ?? "primary"} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, naturalAttackRole: event.target.value as "primary" | "secondary" } })}><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label><label>Natural attack count<input aria-label={`Natural attack count ${item.name ?? item.id}`} type="number" min="1" max="256" value={item.attack.attackCount ?? 1} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, attackCount: Math.max(1, Math.min(256, Number(event.target.value) || 1)) } })} /></label><label>Arm used<select aria-label={`Arm used by ${item.name ?? item.id}`} value={item.attack.handUse ?? "unspecified"} onChange={(event) => updateItem(item.id, { attack: { ...item.attack!, handUse: event.target.value === "unspecified" ? undefined : event.target.value as NonNullable<AttackDefinition["handUse"]> } })}><option value="unspecified">Unspecified</option><option value="primary">Primary arm</option><option value="offHand">Off hand</option><option value="both">Both arms</option><option value="none">No arms</option></select></label></>}
              </>}
              {item.definitionId === "pf1e.autosheet.bracers-of-armor-wondrous-item" && <label>Armor bonus<input aria-label="Bracers of Armor bonus" type="number" min="0" max="8" step="1" value={item.armorBonus ?? 0} onChange={(event) => updateItem(item.id, { armorBonus: Math.max(0, Math.min(8, Number(event.target.value) || 0)) })} /></label>}
              <label>Container<select aria-label={`Container for ${item.name ?? item.id}`} value={item.containerId ?? ""} onChange={(event) => updateItem(item.id, { containerId: event.target.value || undefined })}><option value="">None</option>{items.filter((container) => { const definition = equipmentCatalog[container.definitionId ?? ""]; const canContain = container.containerCapacity !== undefined || definition?.containerCapacity !== undefined || (container.unlimitedContainer ?? definition?.unlimitedContainer); return container.id !== item.id && canContain && (container.id === item.containerId || !containerWouldCreateCycle(items, item.id, container.id)); }).map((container) => { const definition = equipmentCatalog[container.definitionId ?? ""]; return <option key={container.id} value={container.id}>{container.name ?? definition?.name ?? container.id}</option>; })}</select></label>
              <label><input type="checkbox" aria-label={`Unlimited capacity for ${item.name ?? item.id}`} checked={item.unlimitedContainer ?? equipmentCatalog[item.definitionId ?? ""]?.unlimitedContainer ?? false} onChange={(event) => updateItem(item.id, { unlimitedContainer: event.target.checked })} /> Unlimited capacity</label>
              <label>Capacity (lb)<input aria-label={`Capacity of ${item.name ?? item.id}`} type="number" min="0" step="0.1" disabled={item.unlimitedContainer ?? equipmentCatalog[item.definitionId ?? ""]?.unlimitedContainer ?? false} placeholder={item.unlimitedContainer ?? equipmentCatalog[item.definitionId ?? ""]?.unlimitedContainer ? "Unlimited" : undefined} value={item.containerCapacity ?? equipmentCatalog[item.definitionId ?? ""]?.containerCapacity ?? ""} onChange={(event) => updateItem(item.id, { containerCapacity: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label>Contents weight<input aria-label={`Contents weight factor of ${item.name ?? item.id}`} type="number" min="0" max="1" step="0.1" value={item.containerWeightMultiplier ?? equipmentCatalog[item.definitionId ?? ""]?.containerWeightMultiplier ?? 1} onChange={(event) => updateItem(item.id, { containerWeightMultiplier: Math.min(1, Math.max(0, Number(event.target.value) || 0)) })} /></label>
            </div>
            <TextBlock label={`${item.name ?? item.id} notes`} value={item.notes ?? ""} onChange={(value) => updateItem(item.id, { notes: value })} />
            <button
              className="table-action"
              aria-label={"Remove " + (item.name ?? item.id)}
              onClick={() =>
                sheet.update({
                  equipment: (sheet.character.equipment ?? []).filter(
                    (entry) => entry.id !== item.id,
                  ),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
        <datalist id="autosheet-equipment-materials">{Object.values(equipmentMaterialCatalog).map((material) => <option key={material.id} value={material.name} />)}</datalist>
        <datalist id="autosheet-worn-slots">{[...new Set([...autosheetWornSlotReference.map(({ slot }) => slot), "Miscellaneous"])].map((slot) => <option key={slot} value={slot} />)}</datalist>
        <TextBlock label="Storage and container notes" value={inventory.storageNotes ?? ""} onChange={(value) => sheet.update({ inventory: { ...inventory, storageNotes: value } })} />
        <div className="workbook-system-subsection companion-inventory">
          <div className="panel-heading"><div><span className="eyebrow">EQUIPMENT · COMPANION</span><h3>{companion.name || "Companion carrying capacity"}</h3></div></div>
          <div className="form-grid inventory-currency">
            <Field label="Companion name" value={companion.name ?? ""} onChange={(value) => updateCompanion({ name: value })} />
            <Field label="Strength" type="number" value={companion.strength ?? ""} onChange={(value) => updateCompanion({ strength: value === "" ? undefined : Math.max(1, Number(value) || 1) })} />
            <label className="field"><span>Size</span><select value={companion.size ?? "medium"} onChange={(event) => updateCompanion({ size: event.target.value as typeof companion.size })}>{sizeCategories.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
            <label className="field"><span>Body type</span><select aria-label="Companion body type" value={companion.bodyType ?? ""} onChange={(event) => updateCompanion({ bodyType: event.target.value ? event.target.value as NonNullable<typeof companion.bodyType> : undefined })}><option value="">Not specified</option>{Object.entries(autosheetCompanionWondrousSlots).map(([id, body]) => <option key={id} value={id}>{body.name}</option>)}</select></label>
          </div>
          {companion.bodyType && <div className="equipment-load-summary"><b>Wondrous-item slot codes</b><span>{autosheetCompanionWondrousSlots[companion.bodyType].slots.join(", ")}</span><small>From the Autosheet companion body-type reference. Slot codes are shown exactly as the workbook lists them.</small>{invalidCompanionSlotItems.map((item) => <small className="error-banner" key={item.id}>{item.name ?? item.id}: slot code {item.slot} is not listed for this body type.</small>)}</div>}
          {companionLoad && <div className="equipment-load-summary"><b>{companionLoad.carriedWeight.toLocaleString()} lb carried · {companionLoad.band}</b><span>Light &lt; {companionLoad.lightLimit.toLocaleString()} lb · Medium &lt; {companionLoad.mediumLimit.toLocaleString()} lb · Heavy ≤ {companionLoad.heavyLimit.toLocaleString()} lb</span>{(companionLoad.band === "medium" || companionLoad.band === "heavy") && <span>{companionLoad.band === "medium" ? "Maximum Dexterity +3 · armor check penalty −3" : "Maximum Dexterity +1 · armor check penalty −6"} · land speed uses the {companionLoad.band} load rate.</span>}{companionLoad.containerOverloads.map((container) => <small className="error-banner" key={container.itemId}>{container.name}: {container.weight} lb exceeds its {container.capacity} lb capacity.</small>)}</div>}
          <button className="button quiet" type="button" onClick={() => updateCompanion({ items: [...companionItems, { id: crypto.randomUUID(), name: "Companion item", equipped: false, carried: true, quantity: 1, weight: 0 }] })}>+ Add companion item</button>
          {companionItems.map((item) => <div className="inventory-item-fields" key={item.id}>
            <label>Item<input aria-label="Companion item name" value={item.name ?? ""} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} /></label>
            <label>Quantity<input aria-label="Companion item quantity" type="number" min="1" value={item.quantity ?? 1} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, quantity: Math.max(1, Number(event.target.value) || 1) } : entry) })} /></label>
            <label>Weight (lb)<input aria-label="Companion item weight" type="number" min="0" step="0.1" value={item.weight ?? 0} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, weight: Math.max(0, Number(event.target.value) || 0) } : entry) })} /></label>
            <label>Value (gp)<input aria-label={`Companion item value ${item.name ?? item.id}`} type="number" min="0" step="0.01" value={item.price ?? ""} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, price: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) } : entry) })} /></label>
            <label>Save DC<input aria-label={`Companion item save DC ${item.name ?? item.id}`} type="number" min="0" step="1" value={item.saveDc ?? ""} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, saveDc: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) } : entry) })} /></label>
            <label>Wondrous slot code<input aria-label={`Companion item wondrous slot ${item.name ?? item.id}`} list={companion.bodyType ? "companion-wondrous-slot-codes" : undefined} value={item.slot ?? ""} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, slot: event.target.value || undefined } : entry) })} />{companion.bodyType && <datalist id="companion-wondrous-slot-codes">{autosheetCompanionWondrousSlots[companion.bodyType].slots.map((slot) => <option key={slot} value={slot} />)}</datalist>}</label>
            <label><input type="checkbox" aria-label="Companion carries item" checked={item.carried !== false} onChange={(event) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, carried: event.target.checked } : entry) })} /> Carried</label>
            <button className="table-action" aria-label={`Remove ${item.name ?? "companion item"}`} onClick={() => updateCompanion({ items: companionItems.filter((entry) => entry.id !== item.id) })}>×</button>
            <TextBlock label={`${item.name ?? "Companion item"} notes`} value={item.notes ?? ""} onChange={(value) => updateCompanion({ items: companionItems.map((entry) => entry.id === item.id ? { ...entry, notes: value } : entry) })} />
          </div>)}
        </div>
        <div className="custom-equipment-form">
          <input
            aria-label="Custom equipment name"
            placeholder="Custom weapon name"
            value={sheet.customWeaponName}
            onChange={(event) => sheet.setCustomWeaponName(event.target.value)}
          />
          <input
            aria-label="Custom equipment dice"
            placeholder="1d6"
            value={sheet.customWeaponDice}
            onChange={(event) => sheet.setCustomWeaponDice(event.target.value)}
          />
          <label className="checkbox-field"><input type="checkbox" checked={sheet.customWeaponOffHand} onChange={(event) => sheet.setCustomWeaponOffHand(event.target.checked)} /><span>Off-hand weapon</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={sheet.customWeaponLight} onChange={(event) => sheet.setCustomWeaponLight(event.target.checked)} /><span>Light weapon</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={sheet.customWeaponNatural} onChange={(event) => sheet.setCustomWeaponNatural(event.target.checked)} /><span>Natural attack</span></label>
          {(sheet.customWeaponNatural || profileHasNaturalAttack) && <label className="field"><span>Natural attack role</span><select aria-label="Natural attack role" value={sheet.customWeaponNaturalRole} onChange={(event) => sheet.setCustomWeaponNaturalRole(event.target.value as "primary" | "secondary")}><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label>}
          <label className="checkbox-field"><input type="checkbox" checked={sheet.customWeaponProficient} onChange={(event) => sheet.setCustomWeaponProficient(event.target.checked)} /><span>Proficient with weapon (unchecked: −4 attack)</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={sheet.customWeaponFlurryEligible} onChange={(event) => sheet.setCustomWeaponFlurryEligible(event.target.checked)} /><span>Usable for Monk Flurry</span></label>
          {(sheet.customWeaponNatural || profileHasNaturalAttack) && <Field label="Attacks per full attack" value={sheet.customWeaponAttackCount} onChange={sheet.setCustomWeaponAttackCount} />}
          <select
            aria-label="Custom equipment attack profile"
            value={sheet.profileId}
            onChange={(event) => sheet.setProfileId(event.target.value)}
          >
            <option value="">Manual melee profile</option>
            {sheet.profileOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {sourceLabel(profile.source)}
              </option>
            ))}
          </select>
          {attackProfileCatalog[sheet.profileId]?.attackBaseline === "casterLevel" && (
            <select aria-label="Spellcasting source for attack" value={sheet.casterLevelSourceId} onChange={(event) => sheet.setCasterLevelSourceId(event.target.value)}>
              <option value="">Choose spellcasting source</option>
              {(sheet.character.spellcastingSources ?? []).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          )}
          <details className="critical-rules-editor"><summary>Critical rules (optional)</summary><small>Leave these at the selected profile’s value, or default to 20–20 and ×2, unless this weapon has its own threat range or multiplier.</small><div className="inline-fields"><label>Threatens on<select aria-label="Custom weapon critical range" value={sheet.customWeaponCriticalRange} onChange={(event) => sheet.setCustomWeaponCriticalRange(event.target.value)}><option value="">Use profile/default</option>{Array.from({ length: 19 }, (_, index) => 20 - index).map((face) => <option key={face} value={face}>{face}–20</option>)}</select></label><label>Damage multiplier<select aria-label="Custom weapon critical multiplier" value={sheet.customWeaponCriticalMultiplier} onChange={(event) => sheet.setCustomWeaponCriticalMultiplier(event.target.value)}><option value="">Use profile/default</option>{[2, 3, 4, 5].map((multiplier) => <option key={multiplier} value={multiplier}>×{multiplier}</option>)}</select></label></div></details>
          <Field
            label="Weapon enhancement"
            value={sheet.weaponEnhancement}
            onChange={sheet.setWeaponEnhancement}
          />
          <Field
            label="Attack adjustment"
            value={sheet.weaponAttackAdjustment}
            onChange={sheet.setWeaponAttackAdjustment}
          />
          <Field
            label="Strength damage cap (optional)"
            value={sheet.weaponStrengthRating}
            onChange={sheet.setWeaponStrengthRating}
          />
          <button className="button quiet" onClick={sheet.addCustomWeapon}>
            + Custom weapon
          </button>
        </div>
        {sheet.profileId && (
          <p className="muted">
            {attackProfileCatalog[sheet.profileId]?.description} · Select only
            profiles your character qualifies for; prerequisites and
            combined two-weapon penalties are calculated for marked off-hand weapons.
          </p>
        )}
        <CustomEquipmentEditor
          add={(item) =>
            sheet.update(
              {
                equipment: [
                  ...(sheet.character.equipment ?? []),
                  {
                    ...item,
                    id: nextId(
                      "custom-item",
                      (sheet.character.equipment ?? []).map((entry) => entry.id),
                    ),
                  },
                ],
              },
              "Added " + item.name,
            )
          }
        />
      </section>
  );
}

export function FeaturesPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
      <section className="panel features-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">USE ABILITIES · TRACK RESOURCES</span>
            <h2>Character features and resources</h2>
          </div>
        </div>
        <AbilityResourceEditor sheet={sheet} />
        <h3>Other features and conditions</h3>
        {sheet.character.features.map((feature) => (
          <div
            className={"feature-row " + (feature.enabled ? "enabled" : "")}
            key={feature.id}
          >
            <button
              className="toggle"
              aria-label={"Toggle " + feature.name}
              aria-pressed={feature.enabled}
              onClick={() => sheet.toggleFeature(feature.id)}
            >
              <span />
            </button>
            <div>
              <b>{feature.name}</b>
              <small>
                {feature.definitionId
                  ? (featureCatalog[feature.definitionId]?.description ??
                    feature.name)
                  : feature.effects.map(describeEffect).join(" · ") ||
                    "No authored effects"}
              </small>
              {feature.definitionId && featureCatalog[feature.definitionId]?.stacking === "additive" && <details className="feature-rules-notes"><summary>Edit count</summary><label className="field"><span>Count</span><input aria-label={`${feature.name} count`} type="number" min="1" step="1" value={feature.stackCount ?? 1} onChange={(event) => { const value = Math.max(1, Math.floor(Number(event.target.value) || 1)); sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, stackCount: value } : entry) }); }} /></label></details>}
              {(() => { const limits = [...new Set([...(feature.definitionId ? featureCatalog[feature.definitionId]?.actionRestrictions ?? [] : []), ...(feature.actionRestrictions ?? []), ...(feature.turnActionRestrictions ?? [])])].filter((limit) => limit !== "denyDexterityBonus"); const labels = { noActions: "cannot take actions", noPhysicalActions: "cannot take physical actions", moveOnly: "move action only", oneStandardOrMove: "one standard or move action; no full-round action", fleeOnly: "may only act to flee", noTwoHandedActions: "cannot use two-handed actions" }; return limits.length ? <small>Action restriction: {limits.map((limit) => labels[limit]).join(" · ")}</small> : null; })()}
              {(() => { const limits = [...new Set([...(feature.definitionId ? featureCatalog[feature.definitionId]?.defenseRestrictions ?? [] : []), ...(feature.defenseRestrictions ?? []), ...(feature.actionRestrictions?.includes("denyDexterityBonus") ? ["denyDexterityBonus" as const] : [])])]; const labels = { denyDexterityBonus: "loses positive Dexterity to AC", denyDodgeBonus: "loses positive dodge bonuses to AC" }; return limits.length ? <small>Defense restriction: {limits.map((limit) => labels[limit]).join(" · ")}</small> : null; })()}
            </div>
            <label className="field"><span>Rounds remaining</span><input aria-label={`${feature.name} rounds remaining`} type="number" min="0" step="1" value={feature.roundsRemaining ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Math.max(0, Math.floor(Number(event.target.value) || 0)); sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, roundsRemaining: value } : entry) }); }} /></label>
              {feature.definitionId === "pf1e.paizo.bleed" && <details className="feature-rules-notes"><summary>Edit bleed damage</summary><label className="field"><span>Bleed dice per turn</span><input aria-label={`${feature.name} damage dice count`} type="number" min="1" step="1" value={feature.startOfTurnDamage?.dice.count ?? ""} onChange={(event) => { const count = event.target.value === "" ? undefined : Math.max(1, Math.floor(Number(event.target.value) || 1)); sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, startOfTurnDamage: count === undefined ? undefined : { dice: { count, sides: entry.startOfTurnDamage?.dice.sides ?? 6 }, ...(entry.startOfTurnDamage?.bonus !== undefined ? { bonus: entry.startOfTurnDamage.bonus } : {}) } } : entry) }); }} /></label><label className="field"><span>Die size</span><input aria-label={`${feature.name} damage die size`} type="number" min="1" step="1" value={feature.startOfTurnDamage?.dice.sides ?? ""} onChange={(event) => { const sides = event.target.value === "" ? undefined : Math.max(1, Math.floor(Number(event.target.value) || 1)); sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, startOfTurnDamage: sides === undefined ? undefined : { dice: { count: entry.startOfTurnDamage?.dice.count ?? 1, sides }, ...(entry.startOfTurnDamage?.bonus !== undefined ? { bonus: entry.startOfTurnDamage.bonus } : {}) } } : entry) }); }} /></label><label className="field"><span>Flat damage</span><input aria-label={`${feature.name} flat damage bonus`} type="number" step="1" disabled={!feature.startOfTurnDamage} value={feature.startOfTurnDamage?.bonus ?? ""} onChange={(event) => { const bonus = event.target.value === "" ? undefined : Number(event.target.value) || 0; sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, startOfTurnDamage: { dice: entry.startOfTurnDamage?.dice ?? { count: 1, sides: 6 }, ...(bonus === undefined ? {} : { bonus }) } } : entry) }); }} /></label><small>Rolls at the start of each turn while this Bleed condition is on.</small></details>}
              {feature.turnResolution && <small>Turn resolution: {feature.turnResolution}</small>}
            <i>{feature.enabled ? "ON" : "OFF"}</i>
            <details className="feature-rules-notes"><summary>Workbook notes{feature.notes?.trim() ? " · has notes" : ""}</summary><TextBlock label={`${feature.name} notes`} value={feature.notes ?? ""} onChange={(value) => sheet.update({ features: sheet.character.features.map((entry) => entry.id === feature.id ? { ...entry, notes: value } : entry) })} /></details>
            <details className="feature-rules-notes"><summary>Edit</summary><button className="table-action" aria-label={"Remove feature " + feature.name} onClick={() => sheet.update({ features: sheet.character.features.filter((item) => item.id !== feature.id) })}>Remove</button></details>
          </div>
        ))}
        <details className="editor-subsection system-source-edit">
          <summary>Add or edit features and conditions</summary>
          <div className="catalog-add-row">
            <select
              aria-label="Catalog feature or condition"
              value={sheet.catalogFeatureId}
              onChange={(event) => sheet.setCatalogFeatureId(event.target.value)}
            >
              <option value="">Choose a feature or condition…</option>
              {sheet.featureOptions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name} · {sourceLabel(definition.source)}
                </option>
              ))}
            </select>
            <button
              className="button quiet"
              disabled={!sheet.catalogFeatureId}
              onClick={sheet.addCatalogFeature}
            >
              + Add
            </button>
          </div>
        <div className="feature-form">
          <input
            placeholder="Feature name"
            aria-label="New feature name"
            value={sheet.featureName}
            onChange={(event) => sheet.setFeatureName(event.target.value)}
          />
          <select
            aria-label="New feature kind"
            value={sheet.featureKind}
            onChange={(event) =>
              sheet.setFeatureKind(event.target.value as Effect["kind"])
            }
          >
            <option value="modifier">Modifier</option>
            <option value="replaceBase">Replace intrinsic baseline</option>
            <option value="multiply">Multiply result</option>
            <option value="minimum">Minimum result</option>
            <option value="maximum">Maximum result</option>
            <option value="grant">Grant capability</option>
          </select>
          <select
            aria-label="New feature target"
            value={sheet.featureTarget}
            onChange={(event) =>
              sheet.setFeatureTarget(event.target.value as EffectTargetId)
            }
          >
            {effectTargets.map((target) => (
              <option key={target} value={target}>
                {labelFor(target)}
              </option>
            ))}
          </select>
          {sheet.featureKind === "grant" ? (
            <input
              aria-label="New feature grant"
              placeholder="Granted capability"
              value={sheet.featureGrant}
              onChange={(event) => sheet.setFeatureGrant(event.target.value)}
            />
          ) : (
            <div className="mini-fields">
              <input
                aria-label="New feature value"
                type="number"
                step={sheet.featureKind === "multiply" ? "0.1" : "1"}
                value={sheet.featureValue}
                onChange={(event) => sheet.setFeatureValue(event.target.value)}
              />
              {sheet.featureKind === "modifier" && (
                <select
                  aria-label="New feature bonus type"
                  value={sheet.featureBonus}
                  onChange={(event) =>
                    sheet.setFeatureBonus(event.target.value as BonusType)
                  }
                >
                  {bonusTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {sheet.featureKind === "modifier" && sheet.featureTarget === "ac" && (
            <select
              aria-label="New feature AC applicability (required)"
              value={sheet.featureContexts}
              onChange={(event) =>
                sheet.setFeatureContexts(
                  event.target.value as typeof sheet.featureContexts,
                )
              }
            >
              <option value="all">AC: all contexts</option>
              <option value="normal">AC: normal only</option>
              <option value="normalTouch">AC: normal + touch</option>
              <option value="normalFlat">
                AC: normal + flat-footed (armor / shield)
              </option>
            </select>
          )}
          {sheet.featureKind === "modifier" && <>
            <label>Applies to roll kinds<select aria-label="Feature effect roll kinds" multiple value={sheet.featureKinds} onChange={(event) => sheet.setFeatureKinds([...event.currentTarget.selectedOptions].map((option) => option.value as typeof sheet.featureKinds[number]))}>{["attack", "damage", "healing", "maneuver", "save", "skill", "initiative"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label>Applies to attack modes<select aria-label="Feature effect attack modes" multiple value={sheet.featureModes} onChange={(event) => sheet.setFeatureModes([...event.currentTarget.selectedOptions].map((option) => option.value as typeof sheet.featureModes[number]))}><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label>
            <label>Touch applicability<select aria-label="Feature effect touch applicability" value={sheet.featureTouch} onChange={(event) => sheet.setFeatureTouch(event.target.value as typeof sheet.featureTouch)}><option value="any">Touch or non-touch</option><option value="touch">Touch only</option><option value="nonTouch">Non-touch only</option></select></label>
            <label>Attack action applicability<select aria-label="Feature effect attack action applicability" value={sheet.featureAction} onChange={(event) => sheet.setFeatureAction(event.target.value as typeof sheet.featureAction)}><option value="any">Standard or full attack</option><option value="standard">Standard attack only</option><option value="full">Full attack only</option></select></label>
            <label>Required attack tags<select aria-label="Feature effect required attack tags" multiple value={sheet.featureRequiredTags} onChange={(event) => sheet.setFeatureRequiredTags([...event.currentTarget.selectedOptions].map((option) => option.value as typeof sheet.featureRequiredTags[number]))}>{attackTagValues.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
            <label>Excluded attack tags<select aria-label="Feature effect excluded attack tags" multiple value={sheet.featureExcludedTags} onChange={(event) => sheet.setFeatureExcludedTags([...event.currentTarget.selectedOptions].map((option) => option.value as typeof sheet.featureExcludedTags[number]))}>{attackTagValues.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
            <input aria-label="Feature effect attack IDs" value={sheet.featureAttackIds} onChange={(event) => sheet.setFeatureAttackIds(event.target.value)} placeholder="Specific attack IDs, comma-separated" />
            <input aria-label="Feature effect required flags" value={sheet.featureRequiredFlags} onChange={(event) => sheet.setFeatureRequiredFlags(event.target.value)} placeholder="Required context flags, comma-separated" />
            <input aria-label="Feature effect excluded flags" value={sheet.featureExcludedFlags} onChange={(event) => sheet.setFeatureExcludedFlags(event.target.value)} placeholder="Excluded context flags, comma-separated" />
          </>}
          <label>Action restrictions for this feature<select aria-label="Feature action restrictions" multiple value={sheet.manualFeatureActionRestrictions} onChange={(event) => sheet.setManualFeatureActionRestrictions([...event.currentTarget.selectedOptions].map((option) => option.value as typeof sheet.manualFeatureActionRestrictions[number]))}><option value="noActions">Cannot take actions</option><option value="moveOnly">Only a move action</option><option value="oneStandardOrMove">One standard or move action; no full-round actions</option><option value="fleeOnly">Only act to flee</option><option value="noTwoHandedActions">Cannot take two-handed actions</option></select></label>
          <button className="button quiet" onClick={sheet.addManualFeature}>
            + Add structured effect
          </button>
        </div>
        </details>
      </section>
  );
}
