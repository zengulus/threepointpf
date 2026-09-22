import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { CharacterSheetView, type SheetTab } from "./character-sheet-view";
import type { CharacterSheet } from "../hooks/useCharacterSheet";
import type { ThemePreferenceController } from "../hooks/useThemePreference";

export interface SheetWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowInteraction {
  kind: "drag" | "resize";
  startX: number;
  startY: number;
  bounds: SheetWindowBounds;
  /** The window is positioned inside this canvas, not the browser viewport. */
  canvasWidth: number;
  canvasHeight: number;
}

function workspaceCanvasSize(target: HTMLElement) {
  const canvas = target.closest(".workspace-canvas");
  const bounds = canvas?.getBoundingClientRect();
  return {
    width: bounds?.width ?? window.innerWidth,
    height: bounds?.height ?? window.innerHeight,
  };
}

interface SharedSheetPresentationProps {
  sheet: CharacterSheet;
  theme: ThemePreferenceController;
  activeTab: SheetTab;
  onActiveTabChange: (tab: SheetTab) => void;
}

/** The ordinary published-sheet presentation. */
export function FullPageSheet({
  sheet,
  theme,
  activeTab,
  onActiveTabChange,
  onOpenWorkspace,
}: SharedSheetPresentationProps & { onOpenWorkspace: () => void }) {
  return (
    <main className="full-page-sheet" data-testid="full-page-sheet">
      <CharacterSheetView
        sheet={sheet}
        theme={theme}
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
        onOpenWorkspace={onOpenWorkspace}
      />
    </main>
  );
}

/**
 * A presentation-only frame around the same CharacterSheetView used by the
 * full-page route. It owns no character state and renders no dice overlay.
 */
export function CharacterSheetWindow({
  sheet,
  theme,
  activeTab,
  onActiveTabChange,
  bounds,
  onBoundsChange,
  minimized,
  onMinimizedChange,
  onClose,
  onExitWorkspace,
}: SharedSheetPresentationProps & {
  bounds: SheetWindowBounds;
  onBoundsChange: (bounds: SheetWindowBounds) => void;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  onClose: () => void;
  onExitWorkspace: () => void;
}) {
  const interaction = useRef<WindowInteraction | undefined>();

  const beginInteraction = (
    kind: "drag" | "resize",
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      kind === "drag" &&
      event.target instanceof Element &&
      event.target.closest("button")
    )
      return;

    event.preventDefault();
    event.stopPropagation();
    const canvas = workspaceCanvasSize(event.currentTarget);
    interaction.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      bounds,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };

    const onMove = (moveEvent: PointerEvent) => {
      const current = interaction.current;
      if (!current) return;
      const deltaX = moveEvent.clientX - current.startX;
      const deltaY = moveEvent.clientY - current.startY;

      if (current.kind === "drag") {
        // Keep the complete window within the workspace. The initial bounds
        // may be larger than a smaller desktop canvas, in which case CSS has
        // already narrowed it; use the currently available size here too.
        const renderedWidth = Math.min(
          current.bounds.width,
          Math.max(0, current.canvasWidth - current.bounds.x - 8),
        );
        const renderedHeight = Math.min(
          current.bounds.height,
          Math.max(0, current.canvasHeight - current.bounds.y - 8),
        );
        const maxX = Math.max(8, current.canvasWidth - renderedWidth - 8);
        const maxY = Math.max(8, current.canvasHeight - renderedHeight - 8);
        onBoundsChange({
          ...current.bounds,
          x: Math.min(maxX, Math.max(8, current.bounds.x + deltaX)),
          y: Math.min(maxY, Math.max(8, current.bounds.y + deltaY)),
        });
        return;
      }

      const maxWidth = Math.max(
        280,
        current.canvasWidth - current.bounds.x - 8,
      );
      const maxHeight = Math.max(
        180,
        current.canvasHeight - current.bounds.y - 8,
      );
      const minWidth = Math.min(620, maxWidth);
      const minHeight = Math.min(460, maxHeight);
      onBoundsChange({
        ...current.bounds,
        width: Math.min(maxWidth, Math.max(minWidth, current.bounds.width + deltaX)),
        height: Math.min(
          maxHeight,
          Math.max(minHeight, current.bounds.height + deltaY),
        ),
      });
    };

    const endInteraction = () => {
      interaction.current = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
  };

  return (
    <section
      className={
        "character-sheet-window " +
        (minimized ? "character-sheet-window-minimized" : "")
      }
      data-testid="character-sheet-window"
      aria-label={sheet.character.name + " character sheet window"}
      style={{
        left: bounds.x,
        top: bounds.y,
        // The offsets are relative to .workspace-canvas. Reserve its trailing
        // gutter so the titlebar controls and resize affordance stay reachable
        // at ordinary 1024/1280 desktop viewports.
        width: minimized
          ? `min(420px, calc(100% - ${bounds.x + 8}px))`
          : `min(${bounds.width}px, calc(100% - ${bounds.x + 8}px))`,
        height: minimized
          ? undefined
          : `min(${bounds.height}px, calc(100% - ${bounds.y + 8}px))`,
      }}
    >
      <header
        className="character-sheet-window-titlebar"
        data-testid="character-sheet-window-titlebar"
        onPointerDown={(event) => beginInteraction("drag", event)}
      >
        <div className="character-sheet-window-title">
          <span aria-hidden="true">◆</span>
          <b>{sheet.character.name}</b>
          <small>Character sheet</small>
        </div>
        <div className="character-sheet-window-actions">
          <button
            type="button"
            onClick={onExitWorkspace}
            title="Return to full-page sheet"
          >
            Full page
          </button>
          <button
            type="button"
            data-testid="character-sheet-window-minimize"
            aria-label={minimized ? "Restore character sheet" : "Minimize character sheet"}
            onClick={() => onMinimizedChange(!minimized)}
          >
            {minimized ? "▣" : "—"}
          </button>
          <button
            type="button"
            data-testid="character-sheet-window-close"
            aria-label="Close character sheet"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      {!minimized && (
        <div className="character-sheet-window-body">
          <CharacterSheetView
            sheet={sheet}
            theme={theme}
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
          />
        </div>
      )}
      {!minimized && (
        <div
          className="character-sheet-window-resize-handle"
          data-testid="character-sheet-window-resize-handle"
          aria-label="Resize character sheet"
          onPointerDown={(event) => beginInteraction("resize", event)}
        />
      )}
    </section>
  );
}
