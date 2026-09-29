import { FormEvent, ReactNode, useEffect, useState } from "react";
import { CampaignManagement } from "./campaign-management";
import { PlayerCharacterWorkspace } from "./player-character-workspace";

type Role = "dm" | "player" | "co_dm";
type ActiveRole = "dm" | "player";
type Account = { id: string; username: string; name: string; role: Role; activeRole?: ActiveRole; siteAdmin?: boolean };
type LegacyAccount = Account & { salt: string; hash: string };
type AuthResponse = { account: Account | null; bootstrapAvailable?: boolean };

function bytesToHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password: string, salt: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g) || [], (byte) => parseInt(byte, 16)), iterations: 160000, hash: "SHA-256" }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

function legacyBrowserData() {
  const legacyAccounts: LegacyAccount[] = [];
  const legacyCharacters: unknown[] = [];
  try {
    const accounts = JSON.parse(localStorage.getItem("threepointpf.accounts.v1") || "[]") as unknown;
    if (Array.isArray(accounts)) for (const value of accounts) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (typeof row.id === "string" && typeof row.username === "string" && typeof row.name === "string" && (row.role === "dm" || row.role === "player" || row.role === "co_dm") && typeof row.salt === "string" && typeof row.hash === "string") {
        legacyAccounts.push({ id: row.id, username: row.username, name: row.name, role: row.role, salt: row.salt, hash: row.hash });
      }
    }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("threepointpf.character.")) continue;
      try { legacyCharacters.push(JSON.parse(localStorage.getItem(key) || "null")); } catch { /* Skip damaged browser records; retain valid records for migration. */ }
    }
  } catch { /* Private browsing may deny localStorage; fresh account setup still works. */ }
  return { legacyAccounts, legacyCharacters, currentAccountId: localStorage.getItem("threepointpf.session.v1") || "" };
}

function clearLegacyBrowserData() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) if (key === "threepointpf.accounts.v1" || key === "threepointpf.session.v1" || key.startsWith("threepointpf.character.")) localStorage.removeItem(key);
  } catch { /* A successful server import remains valid if browser storage is unavailable. */ }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message || "The campaign account service could not complete that request.");
  return body;
}

export function HostedAccountApp({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [page, setPage] = useState<"campaign" | "settings" | "users">("campaign");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<AuthResponse>("/api/auth").then((state) => {
      if (!active) return;
      setAccount(state.account);
      setBootstrapAvailable(state.bootstrapAvailable ?? false);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "The campaign account service is unavailable.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!account?.siteAdmin || page !== "users") return;
    let active = true;
    api<{ accounts: Account[] }>("/api/accounts").then((result) => { if (active) setAccounts(result.accounts); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load campaign accounts."); });
    return () => { active = false; };
  }, [account?.siteAdmin, page]);

  useEffect(() => {
    if (!account?.id) return;
    let active = true;
    let running = false;
    const drain = async () => {
      if (!active || running) return;
      running = true;
      try {
        await fetch("/api/discord/drain", {
          method: "POST", credentials: "same-origin",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: "{}",
        });
      } catch { /* A pending roll remains in the outbox for the next active session. */ }
      finally { running = false; }
    };
    void drain();
    const timer = window.setInterval(() => { void drain(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [account?.id]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim() || username;
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (!crypto?.subtle) { setError("Secure local sign-in requires a modern browser."); return; }
    try {
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await hashPassword(password, salt);
      if (bootstrapAvailable) {
        const previous = legacyBrowserData();
        const hasLegacyData = previous.legacyAccounts.length > 0 || previous.legacyCharacters.length > 0;
        const migratingAccounts = [...previous.legacyAccounts];
        const activeDmIndex = migratingAccounts.findIndex((item) => item.id === previous.currentAccountId && item.role === "dm");
        const previousDmIndex = activeDmIndex >= 0 ? activeDmIndex : migratingAccounts.findIndex((item) => item.role === "dm");
        const currentAccountId = migratingAccounts[previousDmIndex]?.id;
        if (previousDmIndex >= 0) migratingAccounts[previousDmIndex] = { ...migratingAccounts[previousDmIndex]!, username, name, salt, hash };
        const result = await api<{ account: Account; imported?: { accounts: number; characters: number } }>("/api/auth", { method: "POST", body: JSON.stringify({ action: "bootstrap", username, name, salt, hash, ...(migratingAccounts.length ? { legacyAccounts: migratingAccounts, legacyCharacters: previous.legacyCharacters, currentAccountId } : previous.legacyCharacters.length ? { legacyCharacters: previous.legacyCharacters } : {}) }) });
        if (hasLegacyData && result.imported) clearLegacyBrowserData();
        setAccount(result.account); setBootstrapAvailable(false);
      } else {
        const result = await api<{ account: Account }>("/api/auth", { method: "POST", body: JSON.stringify({ action: "login", username, password }) });
        setAccount(result.account);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") || "").trim();
    const name = String(data.get("name") || "").trim();
    const password = String(data.get("password") || "");
    const role = String(data.get("role")) as Role;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(username)) { setError("Use a username with 3–32 letters, numbers, dots, dashes, or underscores."); return; }
    if (!name || name.length > 80) { setError("Enter a display name of up to 80 characters."); return; }
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    try {
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await hashPassword(password, salt);
      const result = await api<{ account: Account }>("/api/accounts", { method: "POST", body: JSON.stringify({ username, name, role, salt, hash }) });
      setAccounts((items) => [...items, result.account].sort((left, right) => left.name.localeCompare(right.name)));
      form.reset(); setNotice(`${name} can now sign in from another device using this campaign site.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account could not be added.");
    }
  }

  async function updateRole(target: Account, role: Role) {
    setError("");
    try {
      const result = await api<{ account: Account }>(`/api/accounts/${encodeURIComponent(target.id)}`, { method: "PATCH", body: JSON.stringify({ role }) });
      setAccounts((items) => items.map((item) => item.id === target.id ? result.account : item));
      if (target.id === account?.id) setAccount(result.account);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The role could not be changed."); }
  }

  async function removeAccount(target: Account) {
    setError("");
    try {
      await api(`/api/accounts/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setAccounts((items) => items.filter((item) => item.id !== target.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The account could not be removed."); }
  }

  async function resetAccountPassword(target: Account, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") || "");
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    try {
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await hashPassword(password, salt);
      await api(`/api/accounts/${encodeURIComponent(target.id)}`, { method: "PATCH", body: JSON.stringify({ salt, hash }) });
      form.reset();
      setNotice(target.id === account?.id ? "Your password was changed. You can keep using this session." : `Password reset for ${target.name}. Their other sessions were signed out.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The password could not be reset."); }
  }

  async function switchRole() {
    if (account?.role !== "co_dm" || switchingRole) return;
    setSwitchingRole(true); setError("");
    try {
      const next: ActiveRole = account.activeRole === "dm" ? "player" : "dm";
      const result = await api<{ account: Account }>("/api/auth", { method: "POST", body: JSON.stringify({ action: "switch-role", activeRole: next }) });
      setAccount(result.account);
      setPage("campaign");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not switch roles."); }
    finally { setSwitchingRole(false); }
  }

  async function signOut() {
    setError("");
    try {
      await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
      setAccount(null); setPage("campaign"); setBootstrapAvailable(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); }
  }

  if (loading) return <main className="account-screen"><section className="account-card"><p className="account-kicker">LOCAL CAMPAIGN SPACE</p><h1>Checking campaign sign-in</h1></section></main>;
  if (!account) return <main className="account-screen"><section className="account-card"><div className="account-brand"><span className="brand-mark">3P</span><span>THREE POINT PLAY</span></div><p className="account-kicker">LOCAL CAMPAIGN SPACE</p><h1>{bootstrapAvailable ? "Create your DM account" : "Welcome back"}</h1><p className="account-copy">{bootstrapAvailable ? "Set up the first campaign account. It will be saved to this site for the group. Saved accounts and characters on this device will move to the campaign." : "Sign in to continue to your campaign."}</p><form className="account-form" onSubmit={submitAuth}>{bootstrapAvailable && <label>Display name<input name="name" autoComplete="name" placeholder="Game master" /></label>}<label>Username<input name="username" required autoComplete="username" placeholder="Your username" minLength={3} maxLength={32} /></label><label>Password<input name="password" required type="password" autoComplete={bootstrapAvailable ? "new-password" : "current-password"} placeholder={bootstrapAvailable ? "At least 8 characters" : "Your password"} minLength={8} /></label><button className="button primary account-submit">{bootstrapAvailable ? "Create account" : "Sign in"}</button></form>{error && <p className="account-error">{error}</p>}<p className="account-foot">Local accounts are stored with the campaign on this site.</p></section></main>;

  const isDm = account.activeRole === "dm";
  const isAdmin = Boolean(account.siteAdmin && isDm);
  return <div className="site-frame"><header className="site-header"><a className="site-brand" href="#campaign" onClick={() => setPage("campaign")}><span className="brand-mark">3P</span><span><b>THREE POINT PLAY</b><small>PATHFINDER CAMPAIGN</small></span></a><nav className="site-nav"><button className={page === "campaign" ? "active" : ""} onClick={() => setPage("campaign")}>Campaign</button>{isDm && <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>Campaign settings</button>}{isAdmin && <button className={page === "users" ? "active" : ""} onClick={() => setPage("users")}>Users</button>}</nav><div className="site-user"><span className="online-dot"/><span className="site-user-name">{account.name}<small>{account.role === "co_dm" ? `CO-DM · ${isDm ? "DM MODE" : "PLAYER MODE"}` : account.role.toUpperCase()}</small></span>{account.role === "co_dm" && <button type="button" className="button quiet" disabled={switchingRole} onClick={() => void switchRole()}>{switchingRole ? "Switching…" : `Switch to ${isDm ? "Player" : "DM"} mode`}</button>}<button className="button quiet" onClick={signOut}>Sign out</button></div></header>
    {error && <p className="account-error" role="alert">{error}</p>}
    {page === "users" && isAdmin ? <main className="account-admin"><div className="account-page-head"><div><p className="account-kicker">CAMPAIGN SETTINGS</p><h1>User management</h1><p className="account-copy">Manage campaign sign-in accounts and roles for everyone using this site.</p></div><span className="account-count">{accounts.length} ACCOUNTS</span></div><div className="account-admin-grid"><section className="account-panel"><div className="account-panel-heading"><div><p className="account-kicker">CAMPAIGN ACCESS</p><h2>People</h2></div></div><div className="account-table-head"><span>USER</span><span>ROLE</span><span>ACTION</span></div>{accounts.map((item) => <div className="account-user-record" key={item.id}><div className="account-row"><span className="account-person"><b>{item.name}</b><small>@{item.username}{item.id === account.id ? " · YOU" : ""}</small></span><select aria-label={`Role for ${item.name}`} value={item.role} onChange={(event) => void updateRole(item, event.target.value as Role)} disabled={item.id === account.id}><option value="dm">Dungeon Master</option><option value="player">Player</option><option value="co_dm">Co-DM</option></select><button className="text-action danger" disabled={item.id === account.id} onClick={() => void removeAccount(item)}>Remove</button></div><details className="account-password-reset"><summary>{item.id === account.id ? "Change your password" : `Reset ${item.name}’s password`}</summary><form onSubmit={(event) => void resetAccountPassword(item, event)}><label>New password<input name="password" type="password" minLength={8} autoComplete="new-password" required placeholder="At least 8 characters" /></label><button className="button quiet">{item.id === account.id ? "Change password" : "Set temporary password"}</button></form></details></div>)}<p className="account-foot">Your own account cannot be removed or changed to a player. At least one Dungeon Master account must remain. Changing a site role clears campaign memberships and character assignments. Password resets sign the account out on other devices.</p></section><section className="account-panel"><div className="account-panel-heading"><div><p className="account-kicker">NEW ACCOUNT</p><h2>Add a user</h2></div></div><form className="account-form" onSubmit={addUser}><label>Display name<input name="name" required placeholder="Player name" maxLength={80} /></label><label>Username<input name="username" required placeholder="Sign-in username" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" /></label><label>Temporary password<input name="password" required minLength={8} type="password" placeholder="At least 8 characters" /></label><label>Campaign role<select name="role" defaultValue="player"><option value="player">Player</option><option value="co_dm">Co-DM</option><option value="dm">Dungeon Master</option></select></label><button className="button primary account-submit">Add account</button></form>{error && <p className="account-error">{error}</p>}{notice && <p className="account-success">{notice}</p>}</section></div><p className="local-note">Local accounts only · Sign-ins work across devices on this campaign site.</p></main> : page === "settings" && isDm ? <CampaignManagement siteAdmin={isAdmin} accountId={account.id} /> : isDm ? <><div className="campaign-context"><span className="campaign-context-dot"/><span>CAMPAIGN TABLE</span><span className="context-divider">/</span><b>Character workspace</b></div>{children}</> : <PlayerCharacterWorkspace key={account.id} accountId={account.id} />}</div>;
}
