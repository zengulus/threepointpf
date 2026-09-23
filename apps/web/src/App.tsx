import { AppShell } from "./components/app-shell";
import type { CharacterRepository } from "@threepointpf/shared";
import type { SheetMode } from "./lib/sheet-mode";
import "./styles.css";

export interface ThreePointPfHost {
  characterRepository?: CharacterRepository;
  mode?: SheetMode;
  currentUser?: { id: string; displayName: string; role?: string };
  onAuthenticationRequired?: () => void;
}

export interface ThreePointPfAppProps extends ThreePointPfHost {
  characterId?: string;
  onCharacterIdChange?: (characterId: string) => void;
}

/**
 * Public entry point for the static sheet. A host can supply a concrete
 * authored character ID; standalone/demo mode intentionally omits one and
 * keeps its existing sample-selection behavior.
 */
export function ThreePointPfApp({ characterId, onCharacterIdChange, ...host }: ThreePointPfAppProps) {
  return (
    <AppShell
      characterId={characterId}
      onCharacterIdChange={onCharacterIdChange}
      {...host}
    />
  );
}

/** Backwards-compatible standalone component name. */
export const App = ThreePointPfApp;
