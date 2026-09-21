import { formatModifier } from "@threepointpf/dice";
import { abilities, abilityLabels } from "../lib/options";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

/**
 * The first thing a player should see is the character's playable state, not
 * the authoring controls behind it.  This deliberately keeps the detailed
 * panels elsewhere on the page: the compact surface is a live view over the
 * same authored state, rather than a second, lossy representation of it.
 */
export function SummarySheet({ sheet }: { sheet: CharacterSheet }) {
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
            onClick={() => sheet.inspect("Initiative", derived.initiative)}
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
              onClick={() => sheet.inspect(save, derived.saves[save])}
            />
          ))}
        </div>

        <div className="summary-quick-actions">
          <div className="summary-section-heading">Quick actions</div>
          {attacks.length ? (
            attacks.map((attack) => (
              <div className="summary-attack" key={attack.definition.id}>
                <button
                  type="button"
                  className="summary-attack-name"
                  onClick={() =>
                    sheet.inspect(attack.definition.name + " attack", attack.attack)
                  }
                >
                  <span>{attack.definition.name}</span>
                  <small>{attack.damage.formula}</small>
                </button>
                <button
                  type="button"
                  className="summary-roll"
                  onClick={() =>
                    sheet.roll(attack.definition.name + " attack", () =>
                      sheet.engine.createAttackRollPlan(attack.definition.id, 0),
                    )
                  }
                >
                  Roll {formatModifier(attack.attack.value)}
                </button>
              </div>
            ))
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
              aria-label="Inspect summary skill"
              onClick={() => sheet.inspect(skill.label, skill.total)}
              title={"Inspect " + skill.label}
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
        <a className="summary-all-skills" href="#skills">
          View and edit all skills →
        </a>
      </section>
    </section>
  );
}

function SummaryValue({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick: () => void;
}) {
  return (
    <button className="summary-value" type="button" onClick={onClick}>
      <span>{label}</span>
      <b>{value}</b>
    </button>
  );
}
