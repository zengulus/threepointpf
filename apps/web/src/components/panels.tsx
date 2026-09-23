import { formatModifier } from "@threepointpf/dice";
import {
  attackProfileCatalog,
  equipmentCatalog,
  experienceCatalog,
  featureCatalog,
  skillCatalog,
} from "@threepointpf/rules-data";
import {
  movementModes,
  maneuverIds,
  sizeCategories,
  type AbilityId,
  type BonusType,
  type CharacterInput,
  type Effect,
  type EffectTargetId,
} from "@threepointpf/rules-schema";
import { CustomEquipmentEditor } from "./custom-equipment-editor";
import { AbilityResourceEditor } from "./ability-resource-editor";
import { Field, StatCard } from "./primitives";
import { RollTargetField, WeaponActionControls } from "./roll-actions";
import {
  catalogValues,
  describeEffect,
  labelFor,
  nextId,
  sourceLabel,
} from "../lib/format";
import { abilities, abilityLabels, bonusTypes, effectTargets } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

export function InputsPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
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
        </div>
      </section>
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
        <div className="saves-row">
          <RollTargetField
            label="DC for saves & skills"
            value={sheet.rollDc}
            testId="roll-dc-saves"
            onChange={sheet.setRollDc}
          />
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
          <RollTargetField
            label="Target AC for weapon attacks"
            value={sheet.attackAc}
            testId="roll-ac-attacks"
            onChange={sheet.setAttackAc}
          />
          <RollTargetField
            label="Target CMD for maneuvers"
            value={sheet.maneuverCmd}
            testId="roll-cmd-maneuvers"
            onChange={sheet.setManeuverCmd}
          />
        </div>
        {sheet.derived.attacks.map((attack) => (
          <div
            className="attack-row full-attack-row"
            key={attack.definition.id}
          >
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
              />
              <WeaponActionControls
                sheet={sheet}
                actionPlan={sheet.createWeaponActionPlan(
                  attack.definition.id,
                  "fullAttack",
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
              />
            </div>
          </div>
        ))}
        <div className="maneuver-row">
          <span className="eyebrow">MANEUVERS</span>
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
          <button className="button quiet" onClick={sheet.addAttack}>
            + Add attack
          </button>
        </div>
      </section>
  );
}

export function SkillsPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SKILLS</span>
            <h2>Catalog skills</h2>
          </div>
          <span className="helper">
            Automatic metadata + optional override · rolls use the Target DC
            below
          </span>
        </div>
        <RollTargetField
          label="DC for saves & skills"
          value={sheet.rollDc}
          testId="roll-dc-skills"
          onChange={sheet.setRollDc}
        />
        <div className="skills-grid">
          {Object.values(sheet.derived.skills).map((skill) => {
            const override =
              sheet.character.skills?.[skill.id]?.classSkillOverride ??
              sheet.character.skills?.[skill.id]?.classSkill;
            return (
              <div className="skill-row" key={skill.id}>
                <button
                  className="skill-inspect"
                  title={
                    sourceLabel(skillCatalog[skill.id]?.source) +
                    (skillCatalog[skill.id]?.trainedOnly
                      ? " · Trained only"
                      : "")
                  }
                  onClick={() => sheet.inspect(skill.label, skill.total)}
                >
                  <span>{skill.label}</span>
                  <em>
                    {skill.governingAbility.toUpperCase()}
                    {skill.classSkill ? " · class" : ""}
                  </em>
                  <b>{formatModifier(skill.total.value)}</b>
                </button>
                <button
                  className="roll-button"
                  data-testid={"roll-skill-" + skill.id}
                  onClick={() => void sheet.rollSkill(skill.id)}
                >
                  ROLL d20
                </button>
                <label className="rank-input">
                  <span>ranks</span>
                  <input
                    aria-label={skill.label + " ranks"}
                    type="number"
                    min="0"
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
        </div>
      </section>
  );
}

export function EquipmentPanel({ sheet }: { sheet: CharacterSheet }) {
  return (
      <section className="panel equipment-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EQUIPMENT</span>
            <h2>Catalog gear & custom weapons</h2>
          </div>
          <span className="helper">
            Equipped effects and attacks derive from authored instances
          </span>
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
        {sheet.equipmentId && (
          <p className="muted">
            {sourceLabel(equipmentCatalog[sheet.equipmentId]?.source)}
            {equipmentCatalog[sheet.equipmentId]?.description
              ? " · " + equipmentCatalog[sheet.equipmentId]?.description
              : ""}
          </p>
        )}
        {(sheet.character.equipment ?? []).map((item) => (
          <div className="equipment-row" key={item.id}>
            <label>
              <input
                aria-label={"Equip " + (item.name ?? item.id)}
                type="checkbox"
                checked={item.equipped}
                onChange={() =>
                  sheet.update({
                    equipment: (sheet.character.equipment ?? []).map((entry) =>
                      entry.id === item.id
                        ? { ...entry, equipped: !entry.equipped }
                        : entry,
                    ),
                  })
                }
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
            </small>
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
            combined two-weapon penalties are not automatic.
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
            <span className="eyebrow">ABILITIES / RESOURCES / LEGACY FEATURES</span>
            <h2>Structured authoring & runtime state</h2>
          </div>
        </div>
        <AbilityResourceEditor sheet={sheet} />
        <h3>Legacy features and conditions</h3>
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
            </div>
            <i>{feature.enabled ? "ON" : "OFF"}</i>
            <button
              className="table-action"
              aria-label={"Remove feature " + feature.name}
              onClick={() =>
                sheet.update({
                  features: sheet.character.features.filter(
                    (item) => item.id !== feature.id,
                  ),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
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
          <button className="button quiet" onClick={sheet.addManualFeature}>
            + Add structured effect
          </button>
        </div>
      </section>
  );
}
