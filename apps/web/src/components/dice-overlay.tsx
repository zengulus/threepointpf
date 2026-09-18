import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  activeDiceSkin,
  flourishColor,
  formatRollOutcome,
  type DicePresentationReport,
  type RollOutcomeKind,
} from "@threepointpf/dice";
import type { DicePresentation } from "../hooks/useDicePresentation";
import {
  diceSum,
  faceTokens,
  naturalFaceIndex,
  revealedAt,
  rollSequenceTimeline,
  type SequencePhase,
} from "../lib/dice-sequence";

/** One resolved roll, frozen for presentation. */
type DiceStage = NonNullable<DicePresentation["stage"]>;

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

/**
 * The browser dice overlay: one dice drawer, which is the whole roll surface.
 *
 * There is no separate result panel, card or corner summary: the drawer holds the
 * dice, and what it shows changes as the roll resolves. The die-local half of the
 * sequence is not drawn here at all. Once the landed dice are visually still,
 * `presentDieValues` puts each authoritative value into the renderer's own scene
 * as an object parented to the die that rolled it, so a value rises out of its
 * die with a flourish emitted by that die — and follows the die through the scene
 * graph rather than being re-projected into CSS. When those values have left
 * their dice, they hand off to the arithmetic just below them: `17 → 17 + 8 →
 * 25`, with the semantic outcome ending the same sequence.
 *
 * Everything shown here is a fact from the resolution. No DOM element is ever
 * positioned over a die.
 */
export function DiceOverlay({ dice }: { dice: DicePresentation }) {
  const { stage } = dice;
  if (!stage) return null;
  // Each roll mounts its own sequence. That is what makes a new roll start from
  // nothing rather than from the previous roll's revealed beats, and it is why
  // the timers of an interrupted sequence cannot touch the next one.
  return <DiceSequence key={stage.id} dice={dice} stage={stage} />;
}

function DiceSequence({
  dice,
  stage,
}: {
  dice: DicePresentation;
  stage: DiceStage;
}) {
  const { presenter, stageRef, settings, dismiss } = dice;
  const timers = useRef<number[]>([]);
  const scheduled = useRef(false);
  const [report, setReport] = useState<DicePresentationReport | null>(null);
  const [phase, setPhase] = useState<SequencePhase>("pending");

  const tokens = faceTokens(stage);
  const modifier = stage.resolved.modifier;
  const hasModifier = modifier !== 0;
  // Adding the dice together is only its own step when a modifier follows it.
  const showSum = tokens.length > 1 && hasModifier;

  useEffect(() => {
    let active = true;
    let dieValues: { done: Promise<void>; dispose(): void } | null = null;
    // The values wait for the dice to land: nothing is shown until the throw
    // reports, and the report is the only thing that can start the sequence.
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
        if (!active) return;
        setReport(result);
        // Only a renderer with a live scene can put the values on the dice. With
        // no scene — reduced motion, a fallback, a test double — the same values,
        // arithmetic and outcome are shown directly instead.
        const started =
          result.mode === "rendered"
            ? (presenter.presentDieValues?.({
                faces: stage.resolved.faces,
                naturalFaceIndex: naturalFaceIndex(stage.plan),
                event: stage.presentation.event,
                flourish: stage.flourish,
                settings,
              }) ?? null)
            : null;
        if (!started) {
          setPhase("settled");
          return;
        }
        dieValues = started;
        setPhase("scene");
        // The handoff: the values have left their dice and the drawer's
        // arithmetic picks them up.
        void started.done.then(() => {
          if (active) setPhase("values");
        });
      });
    return () => {
      active = false;
      // Dismissing mid-sequence must take the scene objects it created with it.
      dieValues?.dispose();
    };
    // One presentation per roll: settings changes apply to the next roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Schedules the whole sequence, once, when the values arrive in the drawer.
   * The beats must not be tied to the phase they cause — a cleanup that ran on
   * every phase change would cancel the later beats the moment the first one
   * landed, which is a sequence that stops after the values appear.
   */
  useEffect(() => {
    if (phase !== "values" || scheduled.current) return;
    scheduled.current = true;
    timers.current = rollSequenceTimeline({ sum: showSum, modifier: hasModifier }).map(
      (step) => window.setTimeout(() => setPhase(step.phase), step.delay),
    );
  }, [phase, showSum, hasModifier]);

  // The sequence's own timers live and die with this roll.
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  /**
   * The result stays up for its own lifetime *after it starts being shown*. A
   * throw can take seconds to settle, and timing that wait against the roll
   * would let a slow throw eat the sequence it eventually produced.
   */
  const sequenceStarted = phase !== "pending";
  useEffect(() => {
    if (!sequenceStarted) return;
    const timer = window.setTimeout(dismiss, diceOverlayLifetimeMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, sequenceStarted]);

  const { plan, resolved, presentation, flourish } = stage;
  const diceTotal = diceSum(tokens);
  const outcomeKind = resolved.outcome.kind;
  const stageNote =
    report === null
      ? "rolling…"
      : report.mode === "rendered"
        ? report.handoff === "mismatch"
          ? "3D dice disagreed with the resolved faces — the values shown are authoritative"
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
      data-phase={phase}
      data-mode={report?.mode ?? "pending"}
      data-outcome={outcomeKind}
      style={
        {
          // The one place the presentation colour is defined; the stylesheet and
          // the scene's own emissive glow both read it.
          "--flourish-color": flourishColor(presentation.event),
          "--flourish-intensity": String(settings.intensity / 100),
        } as CSSProperties
      }
    >
      <div className="dice-drawer" data-testid="dice-drawer">
        <div className="dice-topbar">
          <div>
            <span className="eyebrow">
              {plan.context.kind} · {plan.context.action.kind}
            </span>
            <h3 data-testid="dice-overlay-label">{plan.label}</h3>
          </div>
          <button
            className="button quiet"
            data-testid="dice-overlay-close"
            onClick={dismiss}
          >
            Close
          </button>
        </div>
        {/* The dice live inside the drawer, not beside it: one surface, whose
            contents change over the course of the roll. */}
        <div className="dice-field">
          <div
            className="dice-stage"
            id="dice-stage"
            ref={stageRef}
            data-testid="dice-stage"
          />
          <span className="dice-stage-note" data-testid="dice-stage-mode">
            {stageNote}
          </span>
        </div>
        <div className="dice-result">
          <div className="dice-sequence" data-testid="dice-overlay-faces">
            {tokens.map((token, position) => (
              <Fragment key={"face-" + token.index}>
                {position > 0 && (
                  <span
                    className="dice-term dice-reveal"
                    data-revealed={revealedAt(phase, "values")}
                    aria-hidden="true"
                  >
                    <em className="dice-op">+</em>
                  </span>
                )}
                <span
                  className="dice-value dice-reveal"
                  data-testid={"dice-face-" + token.index}
                  data-natural={token.natural}
                  data-revealed={revealedAt(phase, "values")}
                >
                  <b>{token.value}</b>
                  <i>d{token.sides}</i>
                </span>
              </Fragment>
            ))}
            {showSum && (
              <span
                className="dice-term dice-reveal"
                data-revealed={revealedAt(phase, "sum")}
              >
                <em className="dice-op">=</em>
                <b className="dice-number">{diceTotal}</b>
              </span>
            )}
            {hasModifier && (
              <span
                className="dice-term dice-reveal"
                data-revealed={revealedAt(phase, "modifier")}
              >
                <em className="dice-op">{modifier < 0 ? "-" : "+"}</em>
                <b className="dice-number">{Math.abs(modifier)}</b>
              </span>
            )}
            <span
              className="dice-term dice-reveal"
              data-testid="dice-overlay-total"
              data-revealed={revealedAt(phase, "total")}
            >
              <em className="dice-op">=</em>
              <b className="dice-number" data-kind={outcomeKind}>
                {resolved.total}
              </b>
            </span>
          </div>
          <div
            className="dice-outcome dice-reveal"
            data-testid="dice-overlay-outcome"
            data-revealed={revealedAt(phase, "outcome")}
          >
            <span className="dice-outcome-chip" data-kind={outcomeKind}>
              {outcomeLabel(outcomeKind)}
            </span>
            <small>{formatRollOutcome(resolved.outcome)}</small>
          </div>
        </div>
        <footer className="dice-footer">
          <span data-testid="dice-overlay-event">
            {flourish.label} · {presentation.reason}
          </span>
          <span>
            {settings.skinId} ·{" "}
            {settings.reducedMotion ? "reduced motion" : "animated"}
            {settings.sound ? " · sound on" : " · sound off"}
          </span>
        </footer>
      </div>
    </div>
  );
}
