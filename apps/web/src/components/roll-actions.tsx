import { formatModifier } from "@threepointpf/dice";
import type { ActionPlan, RollPlan } from "@threepointpf/rules-schema";
import type { CoverLevel, DefenseContext } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

export type WeaponActionKind = "standardAttack" | "fullAttack";

export function MissChanceField({ label, value, testId, onChange }: {
  label: string;
  value: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field roll-dc">
      <span>{label}</span>
      <input data-testid={testId} aria-label={label + " percent"} type="number" min="0" max="100" step="1" value={value} onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isInteger(next) && next >= 0 && next <= 100) onChange(next);
      }} />
      <small>Use the highest applicable chance (e.g. 20% concealment or 50% total concealment).</small>
    </label>
  );
}

export function IgnoreCoverField({ checked, testId, onChange }: {
  checked: boolean;
  testId: string;
  onChange: (checked: boolean) => void;
}) {
  return <label className="field toggle-field"><span>Improved Precise Shot</span><input data-testid={testId} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><small>Ignore cover short of total cover on ranged attacks</small></label>;
}

export function CoverField({ label, value, testId, onChange, showTotal = false }: {
  label: string;
  value: CoverLevel | "none";
  testId: string;
  onChange: (value: CoverLevel | "none") => void;
  showTotal?: boolean;
}) {
  return (
    <label className="field roll-dc">
      <span>{label}</span>
      <select data-testid={testId} value={value} onChange={(event) => onChange(event.target.value as CoverLevel | "none")}>
        <option value="none">None</option>
        <option value="partial">Partial · +2 AC, +1 Reflex</option>
        <option value="standard">Standard · +4 AC, +2 Reflex</option>
        <option value="soft">Soft · +4 AC vs ranged</option>
        <option value="improved">Improved · +8 AC, +4 Reflex</option>
        {showTotal && <option value="total">Total · attacks blocked</option>}
      </select>
    </label>
  );
}

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
  const modifierText = untypedModifier ? ` ${formatModifier(untypedModifier)}` : "";
  return `${dice}${modifierText}`;
}

/** A labelled target input shared by Summary and the detailed combat surface. */
export function RollTargetField({
  label,
  value,
  testId,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
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
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function LinkedTargetFields({ characters, targetId, context, testIdPrefix, onTargetChange, onContextChange, onRefresh }: {
  characters: Array<{ id: string; name: string }>;
  targetId: string;
  context: DefenseContext;
  testIdPrefix: string;
  onTargetChange: (id: string) => void;
  onContextChange: (context: DefenseContext) => void;
  onRefresh: () => void;
}) {
  return <>
    <label className="field roll-dc"><span>Target character</span><select data-testid={`${testIdPrefix}-character`} value={targetId} onChange={(event) => onTargetChange(event.target.value)}><option value="">Enter AC manually</option>{characters.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
    {targetId && <div className="field roll-dc linked-target-ac"><span>Target AC type</span><select data-testid={`${testIdPrefix}-context`} value={context} onChange={(event) => onContextChange(event.target.value as DefenseContext)}><option value="normal">Normal</option><option value="touch">Touch</option><option value="flatFooted">Flat-footed</option><option value="deniedDexterity">Denied Dexterity</option></select><button className="button quiet" type="button" onClick={onRefresh}>Refresh target AC</button></div>}
  </>;
}

export function LinkedTargetPicker({ characters, targetId, testId, onTargetChange, onRefresh }: {
  characters: Array<{ id: string; name: string }>;
  targetId: string;
  testId: string;
  onTargetChange: (id: string) => void;
  onRefresh: () => void;
}) {
  return <div className="field roll-dc linked-target-ac"><label><span>Saved target character</span><select data-testid={testId} value={targetId} onChange={(event) => onTargetChange(event.target.value)}><option value="">Enter target values manually</option>{characters.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>{targetId && <button className="button quiet" type="button" onClick={onRefresh}>Refresh target data</button>}</div>;
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
  offHandAttackCount = 0,
  compact = false,
}: {
  sheet: CharacterSheet;
  actionPlan: ActionPlan;
  attackId: string;
  attackName: string;
  action: WeaponActionKind;
  testIdPrefix: string;
  testIdFor?: (kind: "attack" | "damage" | "critical-damage", index: number) => string;
  offHandAttackCount?: number;
  compact?: boolean;
}) {
  if (!actionPlan.attacks.length) return null;
  const blockedByCover = actionPlan.attacks.some((member) => member.steps.some((step) => step.roll.context.target?.defense?.cover === "total"));
  const blockedByShield = actionPlan.attacks.some((member) => member.steps.some((step) => step.roll.context.flags?.includes("shield-hand-unavailable")));
  const actionLabel = action === "standardAttack" ? "Standard" : "Full attack";
  const attackIds = actionPlan.attacks.map((member) => member.attackId);
  const turnActions = sheet.character.turnActions;
  const actionUnavailable = action === "standardAttack"
    ? Boolean(turnActions?.standardSpent || turnActions?.fullRoundSpent)
    : Boolean(turnActions?.fullRoundSpent && turnActions.fullAttackPlanId !== actionPlan.id);
  const restrictions = sheet.engine.actionRestrictions();
  const blockedByCondition = restrictions.includes("noActions") || restrictions.includes("noPhysicalActions") || restrictions.includes("moveOnly") || restrictions.includes("fleeOnly") || (restrictions.includes("oneStandardOrMove") && (action === "fullAttack" || Boolean(turnActions?.standardSpent || turnActions?.moveSpent || turnActions?.staggeredActionSpent)));
  const blockedByGrapple = restrictions.includes("noTwoHandedActions") && actionPlan.attacks.some((member) => (sheet.character.attacks.find((attack) => attack.id === member.attackId)?.attackTags ?? []).includes("weapon.two-handed"));
  return (
    <div
      className={compact ? "weapon-action-controls compact" : "weapon-action-controls"}
      data-testid={`${testIdPrefix}-${action}`}
    >
      <span className="weapon-action-label">{actionLabel}</span>
      {blockedByCover && <small className="muted">Total cover blocks attacks.</small>}
      {blockedByShield && <small className="muted">An equipped shield occupies the hand this attack needs.</small>}
      {blockedByCondition && <small className="muted">An active condition prevents this attack action.</small>}
      {blockedByGrapple && <small className="muted">Grappled characters cannot use two-handed weapons.</small>}
      {actionUnavailable && <small className="muted">This action is already spent this turn.</small>}
      {actionPlan.attacks.map((member) => <div className="weapon-action-member" key={member.attackId}>
      {actionPlan.attacks.length > 1 && <span className="weapon-action-member-label">{member.role === "primary" ? "Primary" : member.role.replaceAll("-", " ")} · {member.name}</span>}
      {member.steps.length === 0 && <small className="muted">No off-hand attacks at TWF count {offHandAttackCount}; select TWF 1–3 to enable them.</small>}
      {member.steps.map((step) => {
        const role = member.role === "primary" ? "Primary" : member.role.replaceAll("-", " ");
        const sequence = step.index ? ` ${step.index + 1}` : "";
        const damage = step.damage;
        const critical = damage !== undefined && sheet.canRollCriticalDamage(step.roll);
        const displayedDamage = critical && damage ? sheet.createCriticalDamagePlan(damage) : damage;
        return (
          <div className="weapon-action-step" key={`${member.attackId}-${step.index}`}>
            <button
              type="button"
              className={compact ? "summary-roll" : "roll-button"}
              data-testid={testIdFor?.("attack", step.index) ?? `${testIdPrefix}-${action}-attack-${step.index}`}
              aria-label={`Roll ${member.name || attackName} ${actionLabel.toLowerCase()} ${role}${sequence}`}
              title={`Roll ${member.name || attackName} ${actionLabel.toLowerCase()} ${role}${sequence}`}
              disabled={blockedByCover || blockedByShield || blockedByCondition || blockedByGrapple || actionUnavailable || (action === "fullAttack" && (turnActions?.fullAttackRolledStepIds ?? []).includes(step.roll.id))}
              onClick={() =>
                void sheet.rollWeaponAttack(
                  member.attackId || attackId,
                  action,
                  step.index,
                  member.name || attackName,
                  attackIds,
                  offHandAttackCount,
                  actionPlan.id,
                  actionPlan.attacks.flatMap((attack) => attack.steps.map((attackStep) => attackStep.roll.id)),
                )
              }
            >
              {compact
                ? `${role}${sequence} ${formatModifier(step.roll.modifier)}`
                : action === "standardAttack"
                  ? `STANDARD ${formatModifier(step.roll.modifier)}`
                  : `${role.toUpperCase()}${sequence} ${formatModifier(step.roll.modifier)}`}
            </button>
            {displayedDamage && (
              <>
                <button
                  type="button"
                  className={critical ? (compact ? "summary-roll critical-damage" : "roll-button critical-damage") : (compact ? "summary-roll" : "roll-button")}
                  data-testid={critical
                    ? testIdFor?.("critical-damage", step.index) ?? `${testIdPrefix}-${action}-critical-damage-${step.index}`
                    : testIdFor?.("damage", step.index) ?? `${testIdPrefix}-${action}-damage-${step.index}`}
                  aria-label={`Roll ${member.name || attackName} ${actionLabel.toLowerCase()} ${critical ? `critical ` : ""}damage${sequence}`}
                  title={`Roll ${displayedDamage.label}`}
                  disabled={blockedByCover || blockedByShield || blockedByCondition}
                  onClick={() => void sheet.rollPlan(displayedDamage)}
                >
                  {critical
                    ? `CRIT DMG ×${sheet.criticalMultiplierFor(damage!)}`
                    : `DMG ${damageText(displayedDamage)}`}
                </button>
              </>
            )}
          </div>
        );
      })}</div>)}
    </div>
  );
}
