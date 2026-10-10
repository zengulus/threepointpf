import { FormEvent, useEffect, useRef, useState } from "react";

type Campaign = { id: string };
type Connection = { channelId: string; guildId: string | null; version: number; enabled: boolean; updatedAt: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message || "Discord settings could not be updated.");
  return body;
}

export function CampaignDiscordSettings() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const operationVersion = useRef(0);
  const connectionRequestVersion = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void request<{ campaigns: Campaign[] }>("/api/campaigns").then((result) => {
      if (!active) return;
      setCampaigns(result.campaigns);
      setCampaignId((current) => current || result.campaigns[0]?.id || "");
    }).catch((cause: unknown) => { if (active) setNotice(cause instanceof Error ? cause.message : "Could not load campaigns."); });
    return () => {
      active = false;
      mounted.current = false;
      operationVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const version = ++connectionRequestVersion.current;
    if (!campaignId) return () => { active = false; };
    void request<{ connection: Connection | null }>(`/api/campaigns/${encodeURIComponent(campaignId)}/discord`)
      .then((result) => { if (active && version === connectionRequestVersion.current) setConnection(result.connection); })
      .catch((cause: unknown) => { if (active && version === connectionRequestVersion.current) setNotice(cause instanceof Error ? cause.message : "Could not load Discord settings."); });
    return () => { active = false; };
  }, [campaignId]);

  function selectCampaign(id: string) {
    // A campaign change also abandons its draft and pending UI updates.
    operationVersion.current += 1;
    connectionRequestVersion.current += 1;
    busyRef.current = false;
    setBusy(false);
    setConnection(null);
    setDraft("");
    setCampaignId(id);
    setNotice("");
  }

  function beginOperation() {
    if (busyRef.current || !mounted.current) return null;
    busyRef.current = true;
    const version = ++operationVersion.current;
    setBusy(true);
    setNotice("");
    return () => mounted.current && version === operationVersion.current;
  }

  function finishOperation(isCurrent: () => boolean) {
    if (!isCurrent()) return;
    busyRef.current = false;
    setBusy(false);
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignId || !draft) return;
    const isCurrent = beginOperation();
    if (!isCurrent) return;
    try {
      const result = await request<{ connection: Connection }>(`/api/campaigns/${encodeURIComponent(campaignId)}/discord`, { method: "PUT", body: JSON.stringify({ webhookUrl: draft }) });
      if (!isCurrent()) return;
      connectionRequestVersion.current += 1;
      setConnection(result.connection);
      setDraft((current) => current === draft ? "" : current);
      setNotice("Discord channel connected. New server-recorded hosted rolls will be sent here.");
    } catch (cause) {
      if (isCurrent()) setNotice(cause instanceof Error ? cause.message : "Could not connect Discord.");
    } finally { finishOperation(isCurrent); }
  }

  async function disconnect() {
    if (!campaignId) return;
    const isCurrent = beginOperation();
    if (!isCurrent) return;
    try {
      await request(`/api/campaigns/${encodeURIComponent(campaignId)}/discord`, { method: "DELETE" });
      if (!isCurrent()) return;
      connectionRequestVersion.current += 1;
      setConnection(null);
      setNotice("Discord disconnected for this campaign.");
    } catch (cause) {
      if (isCurrent()) setNotice(cause instanceof Error ? cause.message : "Could not disconnect Discord.");
    } finally { finishOperation(isCurrent); }
  }

  async function sendTest() {
    if (!campaignId || !connection) return;
    const isCurrent = beginOperation();
    if (!isCurrent) return;
    try {
      await request(`/api/campaigns/${encodeURIComponent(campaignId)}/discord/test`, { method: "POST" });
      if (!isCurrent()) return;
      setNotice("Test message sent to Discord.");
    } catch (cause) {
      if (isCurrent()) setNotice(cause instanceof Error ? cause.message : "Could not confirm the test message.");
    } finally { finishOperation(isCurrent); }
  }

  return <section className="account-panel" aria-labelledby="campaign-discord-title">
    <div className="account-panel-heading"><div><p className="account-kicker">CAMPAIGN ROLLS</p><h2 id="campaign-discord-title">Discord channel</h2></div></div>
    <p className="account-copy">Connect one channel for the campaign. Players will not need the webhook URL. This setup verifies the channel without posting a message.</p>
    {campaigns.length === 0 ? <p className="account-copy">Create a campaign before connecting its Discord channel.</p> : <>
      <label className="field"><span>Campaign</span><select value={campaignId} onChange={(event) => selectCampaign(event.target.value)}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.id}</option>)}</select></label>
      <p className="account-copy">{connection ? `Connected to Discord channel ${connection.channelId}.` : "No Discord channel connected."}</p>
      <form className="account-form" onSubmit={(event) => void connect(event)}><label>Discord webhook URL<input type="password" autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)} required placeholder="https://discord.com/api/webhooks/…" /></label><button className="button primary" disabled={busy}>{connection ? "Replace channel" : "Connect channel"}</button></form>
      {connection && <div><button type="button" className="button quiet" disabled={busy} onClick={() => void sendTest()}>Send test message</button><button type="button" className="button quiet" disabled={busy} onClick={() => void disconnect()}>Disconnect channel</button></div>}
    </>}
    {notice && <p className="account-copy" role="status">{notice}</p>}
  </section>;
}
