import { formatModifier } from "@threepointpf/dice";
import { abilities, abilityLabels } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import { RollTargetField, WeaponActionControls } from "./roll-actions";

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
  onSelectTab: (tab: "skills") => void;
}) {
  const { character, derived } = sheet;
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
  const activeFeatures = character.features
    .filter((feature) => feature.enabled)
    .slice(0, 6);

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
        </div>

        <div className="summary-quick-actions">
          <div className="summary-section-heading">Quick actions</div>
          <div className="summary-target-row summary-attack-target">
            <RollTargetField
              label="Target AC for weapon attacks"
              value={sheet.attackAc}
              testId="roll-ac-summary"
              onChange={sheet.setAttackAc}
            />
          </div>
          {attacks.length ? (
            attacks.map((attack) => {
              const standard = sheet.createWeaponActionPlan(
                attack.definition.id,
                "standardAttack",
              );
              const full = sheet.createWeaponActionPlan(
                attack.definition.id,
                "fullAttack",
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
                        ? standardDamage.dice
                            .map((die) => die.count + "d" + die.sides)
                            .join("+") + formatModifier(standardDamage.modifier)
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
                      compact
                    />
                    <WeaponActionControls
                      sheet={sheet}
                      actionPlan={full}
                      attackId={attack.definition.id}
                      attackName={attack.definition.name}
                      action="fullAttack"
                      testIdPrefix={"roll-summary-" + attack.definition.id}
                      compact
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="summary-empty">Add a weapon in the attacks section.</p>
          )}
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
        <button
          className="summary-all-skills"
          type="button"
          onClick={() => onSelectTab("skills")}
        >
          View and edit all skills →
        </button>
        {activeFeatures.length > 0 && (
          <div className="summary-active-features" aria-label="Active features and conditions">
            <span className="summary-section-heading">Active</span>
            <div>
              {activeFeatures.map((feature) => (
                <span className="summary-feature-chip" key={feature.id}>
                  {feature.name}
                </span>
              ))}
            </div>
          </div>
        )}
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
