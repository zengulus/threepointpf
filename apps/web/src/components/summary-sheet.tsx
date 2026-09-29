import { formatModifier } from "@threepointpf/dice";
import { useEffect, useState } from "react";
import { abilities, abilityLabels } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { CoverField, damageText, IgnoreCoverField, LinkedTargetFields, MissChanceField, RollTargetField, WeaponActionControls } from "./roll-actions";
import { TurnActionTracker } from "./turn-action-tracker";
import { QuickResourceControls } from "./ability-resource-editor";

/**
 * The first thing a player should see is the character's playable state, not
 * the authoring controls behind it.  This deliberately keeps the detailed
 * panels elsewhere on the page: the compact surface is a live view over the
 * same authored state, rather than a second, lossy representation of it.
 */
export function SummarySheet({
  sheet,
  onSelectTab,
}: {
  sheet: CharacterSheet;
  onSelectTab: (tab: "skills" | "combat" | "features" | "spells") => void;
}) {
  const { character, derived } = sheet;
  const [damageAmount, setDamageAmount] = useState("1");
  const [damageType, setDamageType] = useState("untyped");
  const [damageBypass, setDamageBypass] = useState("");
  const [attackerType, setAttackerType] = useState("unspecified");
  const [healingAmount, setHealingAmount] = useState("1");
  const [temporaryAmount, setTemporaryAmount] = useState(String(character.temporaryHp));
  useEffect(() => {
    setDamageAmount("1");
    setDamageType("untyped");
    setDamageBypass("");
    setAttackerType("unspecified");
    setHealingAmount("1");
  }, [character.id]);
  useEffect(() => {
    setTemporaryAmount(String(character.temporaryHp));
  }, [character.id, character.temporaryHp]);
  const level =
    derived.advancement?.slotCount ?? character.hitDiceCount ?? 1;
  const maxHp = Math.max(1, derived.maxHp.value);
  const healthPercent = Math.max(
    0,
    Math.min(100, Math.round((derived.currentHp / maxHp) * 100)),
  );
  const skills = Object.values(derived.skills);
  const rankedSkills = skills.filter((skill) => skill.ranks > 0);
  const skillPool = rankedSkills.length
    ? [
        ...rankedSkills,
        ...skills.filter(
          (skill) => !rankedSkills.includes(skill) && skill.classSkill,
        ),
      ]
    : skills.filter((skill) => skill.classSkill);
  const displayedSkills = (skillPool.length ? skillPool : skills)
    .sort(
      (left, right) =>
        right.total.value - left.total.value || left.label.localeCompare(right.label),
    )
    .slice(0, 4);
  const attacks = derived.attacks.slice(0, 3);
  const allActiveFeatures = [
    ...character.features.filter((feature) => feature.enabled),
    ...(character.abilities ?? []).filter((ability) =>
      ability.activation === "passive" ||
      (ability.activation === "toggleable" && ability.active),
    ),
  ];
  const activeFeatures = allActiveFeatures.slice(0, 6);
  const activeConditions = (character.activeConditions ?? []).filter(Boolean);
  const quickResources = [
    ...sheet.derived.resources.filter((resource) => resource.remaining !== undefined).map((resource) => ({
      id: `resource-${resource.id}`,
      kind: "resource" as const,
      resourceId: resource.id,
      name: resource.name,
      remaining: resource.remaining!,
      maximum: resource.maximum,
      detail: resource.roundsUntilRefresh === undefined ? "" : `${resource.roundsUntilRefresh} rounds to refresh`,
    })),
    ...(character.abilities ?? []).filter((ability) => ability.usesPerDay !== undefined).map((ability) => ({
      id: `ability-${ability.id}`,
      kind: "ability" as const,
      name: ability.name,
      remaining: Math.max(0, ability.usesPerDay! - (ability.usesSpent ?? 0)),
      maximum: ability.usesPerDay,
      detail: "daily uses",
    })),
  ];
  const displayedQuickResources = quickResources.slice(0, 5);

  return (
    <section className="summary-sheet" id="summary" aria-label="Character summary">
      <aside className="summary-abilities">
        <div className="summary-section-heading">Abilities</div>
        <div className="summary-ability-list">
          {abilities.map((id) => {
            const ability = derived.abilities[id];
            return (
              <label className="summary-ability" key={id}>
                <span>{abilityLabels[id].slice(0, 3)}</span>
                <input
                  aria-label={"Summary " + abilityLabels[id] + " base score"}
                  type="number"
                  value={character.baseAbilities[id]}
                  onChange={(event) => sheet.updateAbility(id, event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => sheet.inspect(abilityLabels[id], ability.score)}
                  title={"Inspect " + abilityLabels[id]}
                >
                  {formatModifier(ability.modifier.value)}
                </button>
              </label>
            );
          })}
        </div>
      </aside>

      <section className="summary-combat" aria-label="Combat summary">
        <div className="summary-rest-row">
          <span aria-hidden="true">⚑</span>
          <b>Combat</b>
          <small>live values</small>
        </div>
        <TurnActionTracker sheet={sheet} onOpenSpells={() => onSelectTab("spells")} />

        <button
          className="summary-health"
          type="button"
          onClick={() => sheet.inspect("Maximum HP", derived.maxHp)}
          title="Inspect maximum hit points"
        >
          <span>Health</span>
          <strong>
            {derived.currentHp}
            <i> / {maxHp}</i>
          </strong>
          <div className="summary-health-track" aria-hidden="true">
            <span style={{ width: healthPercent + "%" }} />
          </div>
          <small>{healthPercent}% ready</small>
        </button>
        <details className="health-management">
          <summary aria-label="Adjust hit points">
            <b>Adjust hit points</b>
            <span>{character.damageTaken} damage · {character.temporaryHp} temporary HP</span>
          </summary>
          <div className="health-management-controls" aria-label="Hit point management">
            {(character.nonlethalDamage ?? 0) > 0 && <p role="status">Nonlethal damage {character.nonlethalDamage} · {character.nonlethalDamage! > derived.currentHp ? "unconscious and helpless" : character.nonlethalDamage === derived.currentHp ? "staggered" : "no nonlethal condition"}</p>}
            <div className="health-resource-line"><b>Damage taken</b><span>{character.damageTaken}</span><b>Temporary HP</b><span>{character.temporaryHp}</span></div>
            <label>Damage amount<input aria-label="Damage amount" type="number" min="0" step="1" value={damageAmount} onChange={(event) => setDamageAmount(event.target.value)} /></label>
            <label>Damage type<select aria-label="Damage type" value={damageType} onChange={(event) => setDamageType(event.target.value)}>{["untyped", "bludgeoning", "piercing", "slashing", "acid", "cold", "electricity", "fire", "sonic"].map((type) => <option key={type}>{type}</option>)}</select></label>
            {["bludgeoning", "piercing", "slashing"].includes(damageType) && <label>DR bypass (if any)<input aria-label="Damage reduction bypass" value={damageBypass} onChange={(event) => setDamageBypass(event.target.value)} placeholder="magic, silver, adamantine…" /></label>}
            <label>Attacker type<select aria-label="Attacker creature type" value={attackerType} onChange={(event) => setAttackerType(event.target.value)}>{["unspecified", "animal", "humanoid", "aberration", "construct", "dragon", "fey", "magical beast", "monstrous humanoid", "ooze", "outsider", "plant", "undead", "vermin"].map((type) => <option key={type}>{type}</option>)}</select></label>
            <button type="button" onClick={() => sheet.takeDamage(Number(damageAmount), damageType, damageBypass, attackerType === "unspecified" ? undefined : attackerType)}>Apply damage</button>
            <label>Healing amount<input aria-label="Healing amount" type="number" min="0" step="1" value={healingAmount} onChange={(event) => setHealingAmount(event.target.value)} /></label>
            <button type="button" onClick={() => sheet.heal(Number(healingAmount))}>Apply healing</button>
            <label>Set temporary HP<input aria-label="Set temporary HP" type="number" min="0" step="1" value={temporaryAmount} onChange={(event) => setTemporaryAmount(event.target.value)} /></label>
            <button type="button" onClick={() => sheet.grantTemporaryHp(Number(temporaryAmount))}>Set temp HP</button>
            <button type="button" onClick={sheet.removeTemporaryHp}>Clear temp HP</button>
          </div>
        </details>

        <div className="summary-combat-pair">
          <SummaryValue
            label="Initiative"
            value={formatModifier(derived.initiative.value)}
            ariaLabel="Roll initiative"
            onClick={sheet.rollInitiative}
          />
          <SummaryValue
            label="BAB"
            value={formatModifier(derived.bab.value)}
            onClick={() => sheet.inspect("Base Attack Bonus", derived.bab)}
          />
        </div>

        <div className="summary-defense-grid">
          <SummaryValue
            label="AC"
            value={derived.ac.value}
            onClick={() => sheet.inspect("Armor Class", derived.ac)}
          />
          <SummaryValue
            label="Touch"
            value={derived.touchAc.value}
            onClick={() => sheet.inspect("Touch AC", derived.touchAc)}
          />
          <SummaryValue
            label="FF"
            value={derived.flatFootedAc.value}
            onClick={() => sheet.inspect("Flat-footed AC", derived.flatFootedAc)}
          />
          <SummaryValue
            label="No Dex"
            value={derived.deniedDexAc.value}
            onClick={() => sheet.inspect("AC without Dexterity or dodge bonuses", derived.deniedDexAc)}
          />
        </div>

        <div className="summary-save-grid">
          {(["fortitude", "reflex", "will"] as const).map((save) => (
            <SummaryValue
              key={save}
              label={save}
              value={formatModifier(derived.saves[save].value)}
              ariaLabel={"Roll " + save + " save"}
              onClick={() => sheet.rollSave(save)}
            />
          ))}
        </div>

        <div className="summary-target-row">
            <RollTargetField
              label="DC for saves & skills"
            value={sheet.rollDc}
            testId="roll-dc-summary"
            onChange={sheet.setRollDc}
          />
          <CoverField label="Your cover on Reflex saves" value={sheet.reflexCover} testId="reflex-save-cover-summary" onChange={sheet.setReflexCover} />
        </div>

        <div className="summary-quick-actions">
          <div className="summary-section-heading">Quick actions</div>
          <div className="summary-target-row summary-attack-target">
            <LinkedTargetFields characters={sheet.savedCharacters.filter((item) => item.id !== sheet.character.id && (!sheet.character.campaignId || item.campaignId === sheet.character.campaignId))} targetId={sheet.linkedTargetId} context={sheet.targetDefenseContext} testIdPrefix="attack-target-summary" onTargetChange={sheet.setLinkedTargetId} onContextChange={sheet.setTargetDefenseContext} onRefresh={sheet.refreshLinkedTarget} />
            <RollTargetField
              label="Target AC for weapon attacks"
              value={sheet.linkedTargetId && sheet.linkedTargetDefenseValue !== undefined ? String(sheet.linkedTargetDefenseValue) : sheet.attackAc}
              testId="roll-ac-summary"
              onChange={sheet.setAttackAc}
              readOnly={Boolean(sheet.linkedTargetId && sheet.linkedTargetDefenseValue !== undefined)}
            />
          </div>
          <details className="summary-target-options">
            <summary>Cover, concealment, and roll options</summary>
            <div className="summary-target-row summary-attack-target">
              <CoverField label="Target cover against attacks" value={sheet.targetCover} testId="attack-target-cover-summary" onChange={sheet.setTargetCover} showTotal />
              <MissChanceField label="Target concealment" value={sheet.targetMissChance} testId="attack-target-miss-chance-summary" onChange={sheet.setTargetMissChance} />
              <IgnoreCoverField checked={sheet.ignoreNonTotalCover} testId="attack-ignore-cover-summary" onChange={sheet.setIgnoreNonTotalCover} />
            </div>
          </details>
          {attacks.length ? (
            attacks.map((attack) => {
              const standard = sheet.createWeaponActionPlan(
                attack.definition.id,
                "standardAttack",
                undefined,
                [attack.definition.id],
                sheet.offHandAttackCount,
              );
              const full = sheet.createWeaponActionPlan(
                attack.definition.id,
                "fullAttack",
                undefined,
                [attack.definition.id],
                sheet.offHandAttackCount,
              );
              const standardDamage = standard.attacks[0]?.steps[0]?.damage;
              return (
                <div className="summary-attack" key={attack.definition.id}>
                  <button
                    type="button"
                    className="summary-attack-name"
                    aria-label={"Inspect " + attack.definition.name + " attack"}
                    onClick={() =>
                      sheet.inspect(
                        attack.definition.name + " standard attack",
                        attack.attack,
                      )
                    }
                    title={"Inspect " + attack.definition.name + " attack"}
                  >
                    <span>{attack.definition.name}</span>
                    <small>
                      Standard damage {standardDamage
                        ? damageText(standardDamage)
                        : attack.damage.formula}
                    </small>
                  </button>
                  <div className="summary-attack-actions">
                    <WeaponActionControls
                      sheet={sheet}
                      actionPlan={standard}
                      attackId={attack.definition.id}
                      attackName={attack.definition.name}
                      action="standardAttack"
                      testIdPrefix={"roll-summary-" + attack.definition.id}
                      offHandAttackCount={sheet.offHandAttackCount}
                      compact
                    />
                    <WeaponActionControls
                      sheet={sheet}
                      actionPlan={full}
                      attackId={attack.definition.id}
                      attackName={attack.definition.name}
                      action="fullAttack"
                      testIdPrefix={"roll-summary-" + attack.definition.id}
                      offHandAttackCount={sheet.offHandAttackCount}
                      compact
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="summary-empty">Add a weapon in the attacks section.</p>
          )}
          {derived.attacks.length > attacks.length && <button className="summary-all-skills" type="button" onClick={() => onSelectTab("combat")}>View all {derived.attacks.length} attacks in Combat →</button>}
        </div>
      </section>

      <section className="summary-skills" aria-label="Skills summary">
        <div className="summary-section-heading">Skills</div>
        <div className="summary-skill-list">
          {displayedSkills.map((skill) => (
            <button
              className="summary-skill"
              type="button"
              key={skill.id}
              aria-label={"Roll " + skill.label}
              onClick={() => sheet.rollSkill(skill.id)}
              title={"Roll " + skill.label}
            >
              <span className="summary-skill-die" aria-hidden="true">◆</span>
              <span>
                {skill.label}
                {skill.classSkill && <i> class</i>}
              </span>
              <b>{formatModifier(skill.total.value)}</b>
            </button>
          ))}
        </div>
        {sheet.derived.skills.acrobatics && (
          <button
            className="summary-all-skills"
            type="button"
            onClick={() => sheet.rollSkill("acrobatics", "jump")}
          >
            Roll Acrobatics jump check
          </button>
        )}
        <button
          className="summary-all-skills"
          type="button"
          onClick={() => onSelectTab("skills")}
        >
          View and edit all skills →
        </button>
        {(activeFeatures.length > 0 || activeConditions.length > 0) && (
          <div className="summary-active-features" aria-label="Active features and conditions">
            {activeFeatures.length > 0 && <><span className="summary-section-heading">Active</span><div>
              {activeFeatures.map((feature) => <span className="summary-feature-chip" key={feature.id}>{feature.name}</span>)}
            </div></>}
            {allActiveFeatures.length > activeFeatures.length && <button className="summary-all-skills" type="button" onClick={() => onSelectTab("features")}>View all {allActiveFeatures.length} active features →</button>}
            {activeConditions.length > 0 && <><span className="summary-active-label">Conditions</span><div>
              {activeConditions.slice(0, 4).map((condition, index) => <span className="summary-feature-chip is-condition" key={`${condition}-${index}`}>{condition}</span>)}
            </div><button className="summary-all-skills" type="button" onClick={() => onSelectTab("combat")}>Review conditions in Combat →</button></>}
          </div>
        )}
        {quickResources.length > 0 && <div className="summary-resource-status" aria-label="Resource counters">
          <span className="summary-active-label">Resources</span>
          <div>{displayedQuickResources.map((resource) => <span className={`summary-resource-chip${resource.remaining === 0 ? " is-empty" : ""}`} key={resource.id} title={resource.detail ? `${resource.name}: ${resource.remaining} of ${resource.maximum ?? "the maximum"} · ${resource.detail}` : undefined}><b>{resource.name}</b><strong>{resource.remaining}{resource.maximum === undefined ? "" : `/${resource.maximum}`}</strong>{resource.kind === "resource" && <QuickResourceControls sheet={sheet} resourceId={resource.resourceId} />}</span>)}</div>
          <button className="summary-all-skills" type="button" onClick={() => onSelectTab("features")}>Manage resources and uses in Features{quickResources.length > displayedQuickResources.length ? ` · ${quickResources.length - displayedQuickResources.length} more` : ""} →</button>
        </div>}
      </section>
    </section>
  );
}

function SummaryValue({
  label,
  value,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string | number;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      className="summary-value"
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? "Inspect " + label}
      title={ariaLabel ?? "Inspect " + label}
    >
      <span>{label}</span>
      <b>{value}</b>
    </button>
  );
}
