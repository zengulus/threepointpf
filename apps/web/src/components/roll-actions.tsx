import { formatModifier } from "@threepointpf/dice";
import type { ActionPlan, RollPlan } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

export type WeaponActionKind = "standardAttack" | "fullAttack";

function diceText(plan: RollPlan): string {
  return plan.dice.map((die) => `${die.count}d${die.sides}`).join("+");
}

/** Keep typed bonus dice visible beside the weapon dice and flat modifier. */
export function damageText(plan: RollPlan): string {
  const terms = plan.provenance?.damageTerms;
  if (!terms?.length) return `${diceText(plan)}${formatModifier(plan.modifier)}`;
  const typed = plan.provenance?.modifier.filter((item) => item.damageType) ?? [];
  const typedTotal = typed.reduce((sum, item) => sum + item.value, 0);
  const dice = terms.map((term) => {
    const flat = typed.filter((item) => item.damageType === term.damageType).reduce((sum, item) => sum + item.value, 0);
    const flatText = flat ? `${flat > 0 ? "+" : ""}${flat}` : "";
    return `${term.dice.count}d${term.dice.sides}${flatText}${term.damageType ? ` ${term.damageType}` : ""}`;
  }).join(" + ");
  const untypedModifier = plan.modifier - typedTotal;
  return `${dice}${formatModifier(untypedModifier)}`;
}

/** A labelled target input shared by Summary and the detailed combat surface. */
export function RollTargetField({
  label,
  value,
  testId,
  onChange,
}: {
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field roll-dc">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder="Prompt on roll"
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * The one weapon-action rendering path. It receives the engine's action plan
 * verbatim, so every visible modifier and every executed plan share context.
 */
export function WeaponActionControls({
  sheet,
  actionPlan,
  attackId,
  attackName,
  action,
  testIdPrefix,
  testIdFor,
  compact = false,
}: {
  sheet: CharacterSheet;
  actionPlan: ActionPlan;
  attackId: string;
  attackName: string;
  action: WeaponActionKind;
  testIdPrefix: string;
  testIdFor?: (kind: "attack" | "damage" | "critical-damage", index: number) => string;
  compact?: boolean;
}) {
  const attack = actionPlan.attacks[0];
  if (!attack) return null;
  const actionLabel = action === "standardAttack" ? "Standard" : "Full attack";
  return (
    <div
      className={compact ? "weapon-action-controls compact" : "weapon-action-controls"}
      data-testid={`${testIdPrefix}-${action}`}
    >
      <span className="weapon-action-label">{actionLabel}</span>
      {attack.steps.map((step) => {
        const role = step.role === "primary" ? "Primary" : step.role.replaceAll("-", " ");
        const sequence = step.index ? ` ${step.index + 1}` : "";
        const damage = step.damage;
        return (
          <div className="weapon-action-step" key={step.index}>
            <button
              type="button"
              className={compact ? "summary-roll" : "roll-button"}
              data-testid={testIdFor?.("attack", step.index) ?? `${testIdPrefix}-${action}-attack-${step.index}`}
              aria-label={`Roll ${attackName} ${actionLabel.toLowerCase()} ${role}${sequence}`}
              title={`Roll ${attackName} ${actionLabel.toLowerCase()} ${role}${sequence}`}
              onClick={() =>
                void sheet.rollWeaponAttack(
                  attackId,
                  action,
                  step.index,
                  attackName,
                )
              }
            >
              {compact
                ? `${role}${sequence} ${formatModifier(step.roll.modifier)}`
                : action === "standardAttack"
                  ? `STANDARD ${formatModifier(step.roll.modifier)}`
                  : `${role.toUpperCase()}${sequence} ${formatModifier(step.roll.modifier)}`}
            </button>
            {damage && (
              <>
                <button
                  type="button"
                  className={compact ? "summary-roll" : "roll-button"}
                  data-testid={testIdFor?.("damage", step.index) ?? `${testIdPrefix}-${action}-damage-${step.index}`}
                  aria-label={`Roll ${attackName} ${actionLabel.toLowerCase()} damage${sequence}`}
                  title={`Roll ${damage.label}`}
                  onClick={() => void sheet.rollPlan(damage)}
                >
                  {`DMG ${damageText(damage)}`}
                </button>
                {sheet.canRollCriticalDamage(step.roll) && (
                  <button
                    type="button"
                    className={compact ? "summary-roll critical-damage" : "roll-button critical-damage"}
                    data-testid={testIdFor?.("critical-damage", step.index) ?? `${testIdPrefix}-${action}-critical-damage-${step.index}`}
                    aria-label={`Roll ${attackName} critical damage${sequence}`}
                    onClick={() =>
                      void sheet.rollPlan(sheet.createCriticalDamagePlan(damage))
                    }
                  >
                    CRIT DMG ×{sheet.criticalMultiplierFor(damage)}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
