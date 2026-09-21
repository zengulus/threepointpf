import { useState } from "react";
import { DiceOverlay } from "./dice-overlay";
import {
  CharacterSheetWindow,
  FullPageSheet,
  type SheetWindowBounds,
} from "./sheet-presentations";
import { useCharacterSheetController } from "../hooks/useCharacterSheet";
import { useDicePresentation } from "../hooks/useDicePresentation";
import type { SheetTab } from "./character-sheet-view";

type PresentationMode = "full-page" | "workspace";

export interface AppShellProps {
  /**
   * The authored identity selected by a hosting application. Omit it for the
   * standalone demo's sample-picker flow.
   */
  characterId?: string;
  /** Lets a controlled host accept a sheet-initiated character switch. */
  onCharacterIdChange?: (characterId: string) => void;
}

const initialWindowBounds: SheetWindowBounds = {
  x: 48,
  y: 52,
  width: 1040,
  height: 760,
};

/**
 * Application-level composition. Workspace/window geometry and the active tab
 * are presentation state; the controller beneath is the one authored state
 * source whether the view is full-page or floating.
 */
export function AppShell({
  characterId,
  onCharacterIdChange,
}: AppShellProps) {
  const dice = useDicePresentation();
  const sheet = useCharacterSheetController({
    characterId,
    onCharacterIdChange,
    dice,
  });
  const [mode, setMode] = useState<PresentationMode>("full-page");
  const [activeTab, setActiveTab] = useState<SheetTab>("summary");
  const [windowOpen, setWindowOpen] = useState(false);
  const [windowMinimized, setWindowMinimized] = useState(false);
  const [windowBounds, setWindowBounds] = useState(initialWindowBounds);

  const openWorkspace = () => {
    setMode("workspace");
    setWindowOpen(true);
    setWindowMinimized(false);
  };
  const openSheetWindow = () => {
    setWindowOpen(true);
    setWindowMinimized(false);
  };
  const returnToFullPage = () => setMode("full-page");

  return (
    <div className="application-shell">
      {mode === "full-page" ? (
        <FullPageSheet
          sheet={sheet}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onOpenWorkspace={openWorkspace}
        />
      ) : (
        <main className="workspace-mode" data-testid="workspace-mode">
          <header className="workspace-toolbar">
            <div>
              <span className="workspace-kicker">3.PF</span>
              <b>Workspace</b>
              <small>Tabletop surface placeholder</small>
            </div>
            <div className="workspace-actions">
              {!windowOpen && (
                <button
                  type="button"
                  className="workspace-button primary"
                  data-testid="workspace-open-sheet"
                  onClick={openSheetWindow}
                >
                  Open character sheet
                </button>
              )}
              <button
                type="button"
                className="workspace-button"
                data-testid="workspace-full-page"
                onClick={returnToFullPage}
              >
                Full-page sheet
              </button>
            </div>
          </header>
          <section
            className="workspace-canvas"
            data-testid="workspace-canvas"
            aria-label="Future tabletop workspace"
          >
            <div className="workspace-placeholder" aria-hidden="true">
              <span>3.PF</span>
              <p>Workspace surface</p>
              <small>Maps, tokens, and tabletop tools intentionally come later.</small>
            </div>
            {windowOpen && (
              <CharacterSheetWindow
                sheet={sheet}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                bounds={windowBounds}
                onBoundsChange={setWindowBounds}
                minimized={windowMinimized}
                onMinimizedChange={setWindowMinimized}
                onClose={() => setWindowOpen(false)}
                onExitWorkspace={returnToFullPage}
              />
            )}
          </section>
        </main>
      )}
      <DiceOverlay dice={dice} />
    </div>
  );
}
