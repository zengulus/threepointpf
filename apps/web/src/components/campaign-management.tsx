import { FormEvent, useCallback, useEffect, useState } from "react";
import { CampaignDiscordSettings } from "./campaign-discord-settings";
import { CharacterAssignments } from "./character-assignments";

type Campaign = { id: string; name: string };
type Member = { accountId: string; username: string; name: string; role: "dm" | "player" | "co_dm" };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || "Campaign settings could not be updated.");
  return result;
}

export function CampaignManagement({ siteAdmin, accountId }: { siteAdmin: boolean; accountId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshCampaigns = useCallback(async () => {
    const result = await request<{ campaigns: Campaign[] }>("/api/campaigns");
    setCampaigns(result.campaigns);
    setCampaignId((current) => result.campaigns.some((item) => item.id === current) ? current : result.campaigns[0]?.id || "");
  }, []);

  const refreshMembers = useCallback(async (id: string) => {
    const result = await request<{ members: Member[] }>(`/api/campaigns/${encodeURIComponent(id)}/members`);
    setMembers(result.members);
  }, []);

  useEffect(() => {
    void refreshCampaigns().catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : "Could not load campaigns."));
  }, [refreshCampaigns]);
  useEffect(() => {
    setMembers([]);
    if (!campaignId) return;
    void refreshMembers(campaignId).catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : "Could not load campaign members."));
  }, [campaignId, refreshMembers]);

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setNotice("");
    try {
      const result = await request<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST", body: JSON.stringify({ id: String(data.get("id") || "").trim(), name: String(data.get("name") || "").trim() }),
      });
      await refreshCampaigns();
      setCampaignId(result.campaign.id);
      form.reset();
      setNotice(`${result.campaign.name} is ready. Add members before assigning characters.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not create campaign."); }
    finally { setBusy(false); }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setNotice("");
    try {
      await request(`/api/campaigns/${encodeURIComponent(campaignId)}/members`, {
        method: "PUT", body: JSON.stringify({ username: String(data.get("username") || "").trim(), role: String(data.get("role") || "player") }),
      });
      await refreshMembers(campaignId);
      form.reset();
      setNotice("Campaign member added.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not add campaign member."); }
    finally { setBusy(false); }
  }

  async function removeMember(member: Member) {
    if (!campaignId) return;
    setBusy(true); setNotice("");
    try {
      await request(`/api/campaigns/${encodeURIComponent(campaignId)}/members`, {
        method: "DELETE", body: JSON.stringify({ accountId: member.accountId }),
      });
      await refreshMembers(campaignId);
      setNotice(`${member.name} no longer has access to this campaign.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not remove campaign member."); }
    finally { setBusy(false); }
  }

  return <main className="account-admin">
    <div className="account-page-head"><div><p className="account-kicker">CAMPAIGN SETTINGS</p><h1>Campaign access and rolls</h1><p className="account-copy">Choose who belongs to each campaign, assign their characters, and connect its Discord channel.</p></div></div>
    <div className="account-admin-grid">
      <section className="account-panel">
        <div className="account-panel-heading"><div><p className="account-kicker">CAMPAIGN</p><h2>Members</h2></div></div>
        {campaigns.length ? <label className="field"><span>Campaign</span><select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setNotice(""); }}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label> : <p className="account-copy">No campaigns yet. {siteAdmin ? "Create one below." : "Ask the site administrator to add you to one."}</p>}
        {campaignId && <>
          {members.map((member) => <div className="account-row" key={member.accountId}><span className="account-person"><b>{member.name}</b><small>@{member.username} · {member.role === "dm" ? "Dungeon Master" : member.role === "co_dm" ? "Co-DM" : "Player"}</small></span><button className="text-action danger" type="button" disabled={busy || member.accountId === accountId || (!siteAdmin && member.role !== "player")} onClick={() => void removeMember(member)}>Remove</button></div>)}
          <form className="account-form" onSubmit={(event) => void addMember(event)}><label>Existing username<input name="username" required minLength={3} maxLength={32} autoComplete="off" placeholder="Player username" /></label>{siteAdmin && <label>Campaign role<select name="role" defaultValue="player"><option value="player">Player</option><option value="co_dm">Co-DM</option><option value="dm">Dungeon Master</option></select></label>}<button className="button primary" disabled={busy}>Add member</button></form>
        </>}
        {notice && <p className="account-copy" role="status">{notice}</p>}
      </section>
      {siteAdmin && <section className="account-panel"><div className="account-panel-heading"><div><p className="account-kicker">NEW CAMPAIGN</p><h2>Create campaign</h2></div></div><form className="account-form" onSubmit={(event) => void createCampaign(event)}><label>Campaign ID<input name="id" required minLength={3} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" placeholder="rise-of-the-runelords" /></label><label>Campaign name<input name="name" required maxLength={80} placeholder="Rise of the Runelords" /></label><button className="button primary" disabled={busy}>Create campaign</button></form></section>}
      {campaignId && <CharacterAssignments key={campaignId + members.map((member) => member.accountId).join(":")} campaignId={campaignId} players={members.filter((member) => member.role === "player" || member.role === "co_dm").map((member) => ({ id: member.accountId, name: member.name }))} />}
      <CampaignDiscordSettings key={campaigns.map((campaign) => campaign.id).join(":")} />
    </div>
  </main>;
}
