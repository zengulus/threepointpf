import { useEffect, useState } from "react";

type Player = { id: string; name: string };
type AssignedCharacter = { id: string; name: string; campaignId: string; accountId: string | null };

export function CharacterAssignments({ players, campaignId }: { players: Player[]; campaignId: string }) {
  const [characters, setCharacters] = useState<AssignedCharacter[]>([]);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!campaignId) return () => { active = false; };
    fetch("/api/assignments", { credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load character assignments.");
      return response.json() as Promise<{ characters: AssignedCharacter[] }>;
    }).then((body) => { if (active) setCharacters(body.characters.filter((item) => item.campaignId === campaignId)); })
      .catch(() => { if (active) setNotice("Could not load character assignments. Refresh and try again."); });
    return () => { active = false; };
  }, [campaignId]);

  async function assign(character: AssignedCharacter, accountId: string | null) {
    setBusyId(character.id);
    setNotice("");
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(character.id)}/assignment`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!response.ok) throw new Error("Assignment could not be saved.");
      setCharacters((items) => items.map((item) => item.id === character.id ? { ...item, accountId } : item));
      setNotice(accountId ? `${character.name} is assigned. The player will see it after refresh.` : `${character.name} is unassigned.`);
    } catch {
      setNotice("Assignment could not be saved. Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return <section className="account-panel" aria-labelledby="character-assignments-title">
    <div className="account-panel-heading"><div><p className="account-kicker">CHARACTER ACCESS</p><h2 id="character-assignments-title">Assign characters</h2></div></div>
    <p className="account-copy">Players can open only their assigned characters. Campaign Dungeon Masters can access every character in this campaign.</p>
    {characters.length === 0 && <p className="account-copy">No saved characters yet.</p>}
    {characters.map((character) => <label className="field" key={character.id}>
      <span>{character.name}</span>
      <select aria-label={`Player for ${character.name}`} value={character.accountId ?? ""} disabled={busyId === character.id} onChange={(event) => void assign(character, event.target.value || null)}>
        <option value="">Unassigned</option>
        {players.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}
      </select>
    </label>)}
    {notice && <p className="account-copy" role="status">{notice}</p>}
  </section>;
}
