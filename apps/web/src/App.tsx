import { AppShell } from "./components/app-shell";

export interface AppProps {
  characterId?: string;
  onCharacterIdChange?: (characterId: string) => void;
}

/**
 * Public entry point for the static sheet. A host can supply a concrete
 * authored character ID; standalone/demo mode intentionally omits one and
 * keeps its existing sample-selection behavior.
 */
export function App({ characterId, onCharacterIdChange }: AppProps) {
  return (
    <AppShell
      characterId={characterId}
      onCharacterIdChange={onCharacterIdChange}
    />
  );
}
