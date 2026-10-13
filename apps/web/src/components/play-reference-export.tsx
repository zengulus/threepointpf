import { useState } from "react";
import type { RulesEngine } from "@threepointpf/rules-core";
import { exportPlayReference, playReferenceFilename } from "../lib/play-reference";

export function PlayReferenceExport({ engine, isDirty, evaluationError }: { engine: RulesEngine; isDirty: boolean; evaluationError?: string | null }) {
  const character = engine.character;
  const [feedback, setFeedback] = useState<{ characterId: string; error: boolean; message: string } | null>(null);
  const download = () => {
    if (evaluationError) return;
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const filename = playReferenceFilename(character.name);
      const text = exportPlayReference(engine, { unsaved: isDirty });
      url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      setFeedback({ characterId: character.id, error: false, message: `Download started: ${filename}` });
    } catch {
      setFeedback({ characterId: character.id, error: true, message: "The play reference could not be downloaded. Try again; your character has not been changed." });
    } finally {
      anchor?.remove();
      if (url) {
        const createdUrl = url;
        globalThis.setTimeout(() => URL.revokeObjectURL(createdUrl), 1_000);
      }
    }
  };
  const currentFeedback = feedback?.characterId === character.id ? feedback : null;
  return <details className="character-library-tools">
    <summary>Play reference</summary>
    <div className="character-library-menu">
      <p>Download a text snapshot of defenses, roll formulas and resources for manual play. Re-export after sheet changes; the file does not sync.</p>
      {isDirty && <p>Includes your unsaved edits. Downloading does not save them.</p>}
      {evaluationError && <p role="alert">Resolve the sheet calculation error before exporting a play reference.</p>}
      <button type="button" disabled={Boolean(evaluationError)} onClick={download}>Download play reference</button>
      {currentFeedback && <p role={currentFeedback.error ? "alert" : "status"}>{currentFeedback.message}</p>}
    </div>
  </details>;
}
