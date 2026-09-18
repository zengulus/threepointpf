import { useEffect, useState, type CSSProperties } from "react";
import {
  activeDiceSkin,
  formatDiceExpression,
  formatModifier,
  formatRollOutcome,
  type DicePresentationReport,
  type RollOutcomeKind,
} from "@threepointpf/dice";
import type { DicePresentation } from "../hooks/useDicePresentation";

/** Human labels for the resolved outcome; the vocabulary stays in the outcome. */
const outcomeLabels: Record<RollOutcomeKind, string> = {
  criticalSuccess: "Critical success",
  criticalFailure: "Critical failure",
  natural20: "Natural 20",
  natural1: "Natural 1",
  success: "Success",
  failure: "Failure",
  unresolved: "Unresolved",
};

export function outcomeLabel(kind: RollOutcomeKind): string {
  return outcomeLabels[kind];
}

/** How long a result stays on screen before it steps aside. */
export const diceOverlayLifetimeMs = 12_000;

/** The global face index of the declared primary check die, or -1. */
function naturalFaceIndex(
  plan: NonNullable<DicePresentation["stage"]>["plan"],
): number {
  const die = plan.primaryCheckDie;
  if (!die) return -1;
  let offset = 0;
  for (let index = 0; index < die.group; index += 1)
    offset += plan.dice[index]?.count ?? 0;
  return offset + (die.index ?? 0);
}

/** The authoritative faces, grouped by the die they were rolled on. */
function FaceGroups({ dice }: { dice: NonNullable<DicePresentation["stage"]> }) {
  const { plan, resolved } = dice;
  const natural = naturalFaceIndex(plan);
  let cursor = 0;
  const groups = plan.dice.map((group) => {
    const values = resolved.faces.slice(cursor, cursor + group.count);
    const start = cursor;
    cursor += group.count;
    return { expression: formatDiceExpression(group), values, start };
  });
  return (
    <div className="dice-faces" data-testid="dice-overlay-faces">
      {groups.map((group) => (
        <div className="dice-face-group" key={group.expression}>
          <span className="dice-face-die">{group.expression}</span>
          {group.values.map((value, index) => (
            <b
              className="dice-face"
              data-testid={"dice-face-" + (group.start + index)}
              data-natural={group.start + index === natural}
              key={group.expression + "-" + index}
            >
              {value}
            </b>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The browser dice overlay. It shows a roll that has already been decided: the
 * authoritative faces, the modifier breakdown and the semantic outcome are all
 * facts from the resolution, while the 3D stage only animates those faces and
 * the flourish only reflects which outcome occurred.
 */
export function DiceOverlay({ dice }: { dice: DicePresentation }) {
  const { stage, presenter, stageRef, settings, dismiss } = dice;
  const [report, setReport] = useState<DicePresentationReport | null>(null);

  const stageId = stage?.id;
  useEffect(() => {
    if (stageId === undefined || !stage) return;
    let active = true;
    setReport(null);
    void presenter
      .present({
        plan: stage.plan,
        faces: stage.resolved.faces,
        event: stage.presentation.event,
        flourish: stage.flourish,
        skin: activeDiceSkin(settings),
        settings,
      })
      .then((result) => {
        if (active) setReport(result);
      });
    return () => {
      active = false;
    };
    // Only a new roll re-presents; settings changes apply to the next roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  useEffect(() => {
    if (stageId === undefined) return;
    const timer = window.setTimeout(dismiss, diceOverlayLifetimeMs);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss, stageId]);

  if (!stage) return null;
  const { plan, resolved, presentation, flourish } = stage;
  const stageNote =
    report === null
      ? "rolling…"
      : report.mode === "rendered"
        ? report.handoff === "mismatch"
          ? "3D dice disagreed with the resolved faces — the result above is authoritative"
          : "physics landed on the resolved faces"
        : report.mode === "skipped"
          ? (report.reason ?? "animation skipped")
          : `no 3D dice — ${report.reason ?? "renderer unavailable"}`;
  return (
    <div
      className="dice-overlay"
      data-testid="dice-overlay"
      data-event={presentation.event}
      data-motion={flourish.motion}
      data-mode={report?.mode ?? "pending"}
      data-outcome={resolved.outcome.kind}
      style={
        {
          "--flourish-intensity": String(settings.intensity / 100),
        } as CSSProperties
      }
    >
      <div className="dice-flourish" data-motion={flourish.motion} aria-hidden="true" />
      <div className="dice-stage-wrap">
        <div className="dice-stage" id="dice-stage" ref={stageRef} data-testid="dice-stage" />
        <span className="dice-stage-note" data-testid="dice-stage-mode">
          {stageNote}
        </span>
      </div>
      <div className="dice-card">
        <div className="dice-card-head">
          <span className="eyebrow">
            {plan.context.kind} · {plan.context.action.kind}
          </span>
          <button
            className="button quiet"
            data-testid="dice-overlay-close"
            onClick={dismiss}
          >
            Close
          </button>
        </div>
        <h3 data-testid="dice-overlay-label">{plan.label}</h3>
        <FaceGroups dice={stage} />
        <div className="dice-total" data-testid="dice-overlay-total">
          <span>{resolved.faces.join(" + ")}</span>
          <span>{formatModifier(resolved.modifier)}</span>
          <b>= {resolved.total}</b>
        </div>
        <div className="dice-outcome" data-testid="dice-overlay-outcome">
          <span className="dice-outcome-chip" data-kind={resolved.outcome.kind}>
            {outcomeLabel(resolved.outcome.kind)}
          </span>
          <small>{formatRollOutcome(resolved.outcome)}</small>
        </div>
        <dl className="dice-detail">
          <div>
            <dt>Presentation</dt>
            <dd data-testid="dice-overlay-event">{flourish.label} · {presentation.reason}</dd>
          </div>
          {resolved.naturalFace !== undefined && (
            <div>
              <dt>Natural face</dt>
              <dd>{resolved.naturalFace}</dd>
            </div>
          )}
          {resolved.outcome.criticalRange && (
            <div>
              <dt>Threat range</dt>
              <dd>{resolved.outcome.criticalRange.minimumNaturalRoll}–20</dd>
            </div>
          )}
          <div>
            <dt>Appearance</dt>
            <dd>
              {settings.skinId} · {settings.reducedMotion ? "reduced motion" : "animated"}
              {settings.sound ? " · sound on" : " · sound off"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
