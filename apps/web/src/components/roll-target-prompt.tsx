import { useEffect, useRef } from "react";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

/**
 * A deliberate target gate for checks that otherwise look resolved but have no
 * table target. It lives above both full-page and workspace sheet surfaces.
 */
export function RollTargetPrompt({ sheet }: { sheet: CharacterSheet }) {
  const prompt = sheet.targetPrompt;
  const promptOpen = prompt !== null;
  const input = useRef<HTMLInputElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const dismiss = useRef(sheet.dismissTargetPrompt);

  // The controller object is intentionally rebuilt with the sheet state. Keep
  // the latest close action without re-creating the dialog's listeners on
  // every key typed into its controlled input.
  useEffect(() => {
    dismiss.current = sheet.dismissTargetPrompt;
  });

  useEffect(() => {
    if (promptOpen) input.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (!promptOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [promptOpen]);

  if (!prompt) return null;
  const titleId = "roll-target-prompt-title";
  const descriptionId = "roll-target-prompt-description";
  const errorId = "roll-target-prompt-error";
  return (
    <div className="roll-target-prompt-backdrop" data-testid="roll-target-prompt">
      <section
        ref={dialog}
        className="roll-target-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sheet.confirmTargetPrompt();
          }}
        >
          <span className="eyebrow">TARGET BEFORE ROLLING</span>
          <h2 id={titleId}>{prompt.label}</h2>
          <p id={descriptionId}>
            Enter {prompt.targetLabel} to resolve this roll,
            or explicitly make an unopposed roll.
          </p>
          <label className="field">
            <span>{prompt.targetLabel}</span>
            <input
              ref={input}
              type="number"
              inputMode="numeric"
              aria-describedby={prompt.error ? errorId : descriptionId}
              aria-invalid={prompt.error ? true : undefined}
              data-testid="roll-target-prompt-input"
              value={prompt.value}
              onChange={(event) => sheet.setTargetPromptValue(event.target.value)}
            />
          </label>
          {prompt.error && (
            <p id={errorId} className="roll-target-prompt-error" role="status">
              {prompt.error}
            </p>
          )}
          <div className="roll-target-prompt-actions">
            <button type="submit" className="button primary">
              Roll vs {prompt.targetLabel}
            </button>
            <button
              type="button"
              className="button quiet"
              onClick={sheet.rollWithoutTarget}
            >
              Roll without a target
            </button>
            <button
              type="button"
              className="button quiet"
              onClick={sheet.dismissTargetPrompt}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
