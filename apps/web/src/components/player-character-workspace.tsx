import { useEffect, useState } from "react";
import { ThreePointPfApp } from "../App";

type Character = { id: string; name: string; campaignId?: string };

export function PlayerCharacterWorkspace({ accountId }: { accountId: string }) {
  const selectionKey = `threepointpf.hosted.selected.${accountId}`;
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/characters", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load your characters. Refresh or sign in again.");
        return response.json() as Promise<Character[]>;
      }).then((items) => {
        if (!active) return;
        setCharacters(items);
        let remembered: string | null = null;
        try { remembered = localStorage.getItem(selectionKey); } catch { /* Private browsing can reject storage. */ }
        setSelectedId((current) => {
          const preferred = current ?? remembered;
          return preferred && items.some((item) => item.id === preferred) ? preferred : items[0]?.id ?? null;
        });
      }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load your characters."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId]);

  useEffect(() => {
    if (!selectedId) return;
    try { localStorage.setItem(selectionKey, selectedId); } catch { /* Selection still works for this session. */ }
  }, [selectionKey, selectedId]);

  if (loading) return <main className="account-admin"><p role="status">Loading your characters…</p></main>;
  if (error) return <main className="account-admin"><p role="alert">{error}</p></main>;
  if (characters.length === 0) return <main className="account-admin"><h1>My characters</h1><p>Your Dungeon Master has not assigned a character yet. Ask them to assign one in Users, then refresh this page.</p></main>;

  return <div>
    <div className="campaign-context"><label htmlFor="my-character-picker">My characters</label><select id="my-character-picker" value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{characters.map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}</select></div>
    {selectedId && <ThreePointPfApp key={`${accountId}:${selectedId}`} mode="hosted" playerView characterId={selectedId} onCharacterIdChange={setSelectedId} />}
  </div>;
}
