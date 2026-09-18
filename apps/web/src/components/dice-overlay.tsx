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
 * The browser dice overlay. The dice are the presentation surface: once the
 * physical dice have settled, each authoritative value rises off the die it was
 * rolled on, turns to face the screen, gathers into the visible arithmetic, and
 * the modifier and total are revealed on that same line. Critical and
 * natural-face effects belong to the die (and the result) they happened on, and
 * the semantic outcome is part of the sequence rather than a panel beside it.
 *
 * The values are facts from the resolution; the renderer contributes only the
 * screen positions of the dice it was asked to land on.
 */
export function DiceOverlay({ dice }: { dice: DicePresentation }) {
  const { stage, presenter, stageRef, settings, dismiss } = dice;
  const valueRefs = useRef(new Map<number, HTMLElement>());
  const [report, setReport] = useState<DicePresentationReport | null>(null);
  const [phase, setPhase] = useState<SequencePhase>("pending");
  const [offsets, setOffsets] = useState<(DieOffset | null)[] | null>(null);

  const tokens = stage ? faceTokens(stage) : [];
  const modifier = stage?.resolved.modifier ?? 0;
  const hasModifier = modifier !== 0;
  // Adding the dice together is only its own step when a modifier follows it.
  const showSum = tokens.length > 1 && hasModifier;

  const stageId = stage?.id;
  useEffect(() => {
    if (stageId === undefined || !stage) return;
    let active = true;
    // A new roll starts from nothing: the values wait for the dice to land.
    setReport(null);
    setPhase("pending");
    setOffsets(null);
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

  /**
   * Anchors the values to the dice that just landed. This runs after layout, so
   * each chip is still at its slot in the arithmetic when it is measured and the
   * offset is exactly the distance to its die. With no anchors — a renderer that
   * could not report positions, or reduced motion, where there is no throw at
   * all — the sequence is shown settled instead of pretending to move from dice
   * that are not there.
   */
  useLayoutEffect(() => {
    if (!report || stageId === undefined) return;
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
  }, [report, stageId, stageRef]);

  useEffect(() => {
    if (phase !== "die" || !offsets) return;
    // One frame with the values folded onto their dice, so the rise is a
    // transition that can be seen rather than an instant jump.
    const frame = requestAnimationFrame(() => setPhase("rise"));
    return () => cancelAnimationFrame(frame);
  }, [phase, offsets]);

  useEffect(() => {
    if (phase !== "rise") return;
    const timers = rollSequenceTimeline({ sum: showSum, modifier: hasModifier }).map(
      (step) => window.setTimeout(() => setPhase(step.phase), step.delay),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [phase, showSum, hasModifier]);

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
      </div>
      <div className="dice-surface">
        <div className="dice-topbar">
          <div>
            <span className="eyebrow">
              {plan.context.kind} · {plan.context.action.kind}
            </span>
            <h3 data-testid="dice-overlay-label">{plan.label}</h3>
            <span className="dice-stage-note" data-testid="dice-stage-mode">
              {stageNote}
            </span>
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
