import { formatModifier } from "@threepointpf/dice";
import type { ActionPlan, RollPlan } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

export type WeaponActionKind = "standardAttack" | "fullAttack";

function diceText(plan: RollPlan): string {
  return plan.dice.map((die) => `${die.count}d${die.sides}`).join("+");
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
                  {compact
                    ? `DMG ${diceText(damage)}${formatModifier(damage.modifier)}`
                    : `DMG ${diceText(damage)}${formatModifier(damage.modifier)}`}
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
