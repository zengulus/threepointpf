import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  activeDiceSkin,
  formatRollOutcome,
  type DicePresentationReport,
  type RollOutcomeKind,
} from "@threepointpf/dice";
import type { DicePresentation } from "../hooks/useDicePresentation";
import {
  diceSum,
  dieAnchorOffset,
  faceTokens,
  revealedAt,
  rollSequenceTimeline,
  type DieOffset,
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
 * The browser dice overlay: the dice table on one side, the result drawer on the
 * other. Once the physical dice have settled, each authoritative value rises off
 * the die it was rolled on, turns to face the screen, travels into the drawer's
 * arithmetic, and the modifier and total are revealed on that same line. Critical
 * and natural-face effects belong to the die (and the result) they happened on,
 * and the semantic outcome ends the sequence rather than sitting in a corner.
 *
 * The values are facts from the resolution; the renderer contributes only the
 * screen positions of the dice it was asked to land on.
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
  const valueRefs = useRef(new Map<number, HTMLElement>());
  const timers = useRef<number[]>([]);
  const scheduled = useRef(false);
  const [report, setReport] = useState<DicePresentationReport | null>(null);
  const [phase, setPhase] = useState<SequencePhase>("pending");
  const [offsets, setOffsets] = useState<(DieOffset | null)[] | null>(null);

  const tokens = faceTokens(stage);
  const modifier = stage.resolved.modifier;
  const hasModifier = modifier !== 0;
  // Adding the dice together is only its own step when a modifier follows it.
  const showSum = tokens.length > 1 && hasModifier;

  useEffect(() => {
    let active = true;
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
        if (active) setReport(result);
      });
    return () => {
      active = false;
    };
    // One presentation per roll: settings changes apply to the next roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Anchors the values to the dice that just landed. This runs after layout, so
   * each chip is still at its slot in the arithmetic when it is measured and the
   * offset is exactly the distance to its die. With no anchors — a renderer that
   * could not report positions, or reduced motion, where there is no throw at
   * all — the sequence is shown settled instead of pretending to move from dice
   * that are not there.
   */
  useLayoutEffect(() => {
    if (!report) return;
    const anchors = report.mode === "rendered" ? report.anchors : undefined;
    const stageElement = stageRef.current;
    if (!anchors || anchors.length === 0 || !stageElement) {
      setOffsets(null);
      setPhase("settled");
      return;
    }
    const stageRect = stageElement.getBoundingClientRect();
    // Indexed by face, not by anchor order: a renderer that could only project
    // some of the dice must not shift the values it did report.
    const next: (DieOffset | null)[] = [];
    for (const anchor of anchors) {
      const chip = valueRefs.current.get(anchor.faceIndex);
      next[anchor.faceIndex] = chip
        ? dieAnchorOffset(anchor, chip.getBoundingClientRect(), stageRect)
        : null;
    }
    setOffsets(next);
    setPhase("die");
  }, [report, stageRef]);

  useEffect(() => {
    if (phase !== "die" || !offsets) return;
    // One frame with the values folded onto their dice, so the rise is a
    // transition that can be seen rather than an instant jump.
    const frame = requestAnimationFrame(() => setPhase("rise"));
    return () => cancelAnimationFrame(frame);
  }, [phase, offsets]);

  /**
   * Schedules the whole sequence, once, when the values start their rise. The
   * beats must not be tied to the phase they cause — a cleanup that ran on every
   * phase change would cancel the later beats the moment the first one landed,
   * which is a sequence that stops after the values appear.
   */
  useEffect(() => {
    if (phase !== "rise" || scheduled.current) return;
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
          "--flourish-intensity": String(settings.intensity / 100),
        } as CSSProperties
      }
    >
      <div className="dice-stage-wrap">
        <div className="dice-stage" id="dice-stage" ref={stageRef} data-testid="dice-stage" />
        <span className="dice-stage-note" data-testid="dice-stage-mode">
          {stageNote}
        </span>
      </div>
      <div className="dice-drawer">
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
        <div className="dice-result">
          <div className="dice-sequence" data-testid="dice-overlay-faces">
            {tokens.map((token, position) => (
              <Fragment key={"face-" + token.index}>
                {position > 0 && (
                  <span
                    className="dice-term dice-reveal"
                    data-revealed={revealedAt(phase, "combine")}
                    aria-hidden="true"
                  >
                    <em className="dice-op">+</em>
                  </span>
                )}
                <span
                  className="dice-value"
                  data-testid={"dice-face-" + token.index}
                  data-natural={token.natural}
                  ref={(element) => {
                    if (element) valueRefs.current.set(token.index, element);
                    else valueRefs.current.delete(token.index);
                  }}
                  style={
                    {
                      ...(offsets?.[token.index]
                        ? {
                            "--die-x": `${offsets[token.index]!.x}px`,
                            "--die-y": `${offsets[token.index]!.y}px`,
                          }
                        : {}),
                      "--value-delay": `${Math.min(token.index, 5) * 60}ms`,
                    } as CSSProperties
                  }
                >
                  <b>{token.value}</b>
                  <i>d{token.sides}</i>
                  {token.natural && flourish.motion !== "none" && !settings.reducedMotion && (
                    <span
                      className="dice-burst"
                      data-motion={flourish.motion}
                      aria-hidden="true"
                    />
                  )}
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
