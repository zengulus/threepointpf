import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

type Role = "dm" | "player" | "co_dm";
type Account = { id: string; username: string; name: string; role: Role; salt: string; hash: string };
const ACCOUNTS = "threepointpf.accounts.v1";
const SESSION = "threepointpf.session.v1";

function readAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS) || "[]") as Account[]; } catch { return []; }
}
function bytesToHex(bytes: Uint8Array) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password: string, salt: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g) || [], (b) => parseInt(b, 16)), iterations: 160000, hash: "SHA-256" }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}
function saveAccounts(accounts: Account[]) { localStorage.setItem(ACCOUNTS, JSON.stringify(accounts)); }

export function LocalAccountApp({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(readAccounts);
  const [session, setSession] = useState(() => localStorage.getItem(SESSION) || "");
  const [actingAs, setActingAs] = useState("");
  const [coDmMode, setCoDmMode] = useState<"dm" | "player">("player");
  const [page, setPage] = useState<"campaign" | "users">("campaign");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = accounts.find((a) => a.id === session);
  const identity = accounts.find((a) => a.id === (actingAs || session));
  const isBootstrap = accounts.length === 0;
  const isDm = current?.role === "dm" || (current?.role === "co_dm" && coDmMode === "dm");

  useEffect(() => { saveAccounts(accounts); }, [accounts]);
  useEffect(() => { if (session) localStorage.setItem(SESSION, session); else localStorage.removeItem(SESSION); }, [session]);
  const players = useMemo(() => accounts.filter((a) => a.role === "player" || a.role === "co_dm"), [accounts]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim();
    if (isBootstrap) {
      if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
      if (typeof crypto === "undefined" || !crypto.subtle) { setError("Secure local sign-in requires a modern browser."); return; }
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const account = { id: crypto.randomUUID(), username, name: name || username, role: "dm" as Role, salt, hash: await hashPassword(password, salt) };
      setAccounts([account]); setSession(account.id); setNotice("DM account created."); return;
    }
    const account = accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
    if (!account || await hashPassword(password, account.salt) !== account.hash) { setError("That username and password do not match."); return; }
    setSession(account.id); setCoDmMode("player"); setNotice("");
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") || "").trim();
    const name = String(data.get("name") || "").trim();
    const password = String(data.get("password") || "");
    const role = String(data.get("role")) as Role;
    if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) { setError("That username is already in use."); return; }
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (typeof crypto === "undefined" || !crypto.subtle) { setError("Secure local sign-in requires a modern browser."); return; }
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    setAccounts((previous) => [...previous, { id: crypto.randomUUID(), username, name: name || username, role, salt, hash }]);
    form.reset(); setNotice(`${name || username} was added.`);
  }

  if (!current) return <main className="account-screen"><section className="account-card"><div className="account-brand"><span className="brand-mark">3P</span><span>THREE POINT PLAY</span></div><p className="account-kicker">LOCAL CAMPAIGN SPACE</p><h1>{isBootstrap ? "Create your DM account" : "Welcome back"}</h1><p className="account-copy">{isBootstrap ? "Set up the campaign owner account to get started." : "Sign in to continue to your tabletop."}</p><form className="account-form" onSubmit={submitAuth}>{isBootstrap && <label>Display name<input name="name" autoComplete="name" placeholder="Game master" /></label>}<label>Username<input name="username" required autoComplete="username" placeholder="Your username" /></label><label>Password<input name="password" required type="password" autoComplete={isBootstrap ? "new-password" : "current-password"} placeholder={isBootstrap ? "At least 8 characters" : "Your password"} minLength={isBootstrap ? 8 : undefined} /></label><button className="button primary account-submit">{isBootstrap ? "Create account" : "Sign in"}</button></form>{error && <p className="account-error">{error}</p>}<p className="account-foot">Accounts are stored in this browser on this device.</p></section></main>;

  return <div className="site-frame"><header className="site-header"><a className="site-brand" href="#campaign" onClick={() => setPage("campaign")}><span className="brand-mark">3P</span><span><b>THREE POINT PLAY</b><small>PATHFINDER CAMPAIGN</small></span></a><nav className="site-nav"><button className={page === "campaign" ? "active" : ""} onClick={() => setPage("campaign")}>Campaign</button>{isDm && <button className={page === "users" ? "active" : ""} onClick={() => setPage("users")}>Users</button>}</nav><div className="site-user"><span className="online-dot"/><span className="site-user-name">{identity?.name}<small>{actingAs ? "PLAYING AS PLAYER" : current.role === "co_dm" ? `CO-DM · ${coDmMode.toUpperCase()} MODE` : current.role.toUpperCase()}</small></span>{current.role === "co_dm" && <button type="button" className="button quiet" onClick={() => { setCoDmMode((mode) => mode === "dm" ? "player" : "dm"); setActingAs(""); setPage("campaign"); }}>Switch to {isDm ? "Player" : "DM"} mode</button>}{isDm && <select aria-label="Play as player" value={actingAs} onChange={(e) => setActingAs(e.target.value)}><option value="">DM view</option>{players.map((p) => <option key={p.id} value={p.id}>Play as {p.name}</option>)}</select>}<button className="button quiet" onClick={() => { setActingAs(""); setCoDmMode("player"); setSession(""); }}>Sign out</button></div></header>
    {page === "users" && isDm ? <main className="account-admin"><div className="account-page-head"><div><p className="account-kicker">CAMPAIGN SETTINGS</p><h1>User management</h1><p className="account-copy">Manage local sign-in accounts and assign campaign roles.</p></div><span className="account-count">{accounts.length} ACCOUNTS</span></div><div className="account-admin-grid"><section className="account-panel"><div className="account-panel-heading"><div><p className="account-kicker">CAMPAIGN ACCESS</p><h2>People</h2></div></div><div className="account-table-head"><span>USER</span><span>ROLE</span><span>ACTION</span></div>{accounts.map((a) => <div className="account-row" key={a.id}><span className="account-person"><b>{a.name}</b><small>@{a.username}{a.id === session ? " · YOU" : ""}</small></span><select aria-label={`Role for ${a.name}`} value={a.role} onChange={(e) => { const role = e.target.value as Role; if ((a.role === "dm" || a.role === "co_dm") && role === "player" && accounts.filter((x) => x.role === "dm" || x.role === "co_dm").length === 1) { setError("Keep at least one Dungeon Master account."); return; } setError(""); setAccounts((xs) => xs.map((x) => x.id === a.id ? { ...x, role } : x)); }}><option value="dm">Dungeon Master</option><option value="co_dm">Co-DM</option><option value="player">Player</option></select><button className="text-action danger" disabled={a.id === session || ((a.role === "dm" || a.role === "co_dm") && accounts.filter((x) => x.role === "dm" || x.role === "co_dm").length === 1)} onClick={() => { setAccounts((xs) => xs.filter((x) => x.id !== a.id)); if (actingAs === a.id) setActingAs(""); }}>Remove</button></div>)}<p className="account-foot">Your own account cannot be removed. At least one DM account must remain.</p></section><section className="account-panel"><div className="account-panel-heading"><div><p className="account-kicker">NEW ACCOUNT</p><h2>Add a user</h2></div></div><form className="account-form" onSubmit={addUser}><label>Display name<input name="name" required placeholder="Player name" /></label><label>Username<input name="username" required placeholder="Sign-in username" /></label><label>Temporary password<input name="password" required minLength={8} type="password" placeholder="At least 8 characters" /></label><label>Campaign role<select name="role" defaultValue="player"><option value="player">Player</option><option value="co_dm">Co-DM</option><option value="dm">Dungeon Master</option></select></label><button className="button primary account-submit">Add account</button></form>{error && <p className="account-error">{error}</p>}{notice && <p className="account-success">{notice}</p>}</section></div><p className="local-note">Local accounts only · Sign-ins are available in this browser profile.</p></main> : <><div className="campaign-context"><span className="campaign-context-dot"/><span>CAMPAIGN TABLE</span><span className="context-divider">/</span><b>{actingAs ? `${identity?.name}’s player view` : "Character workspace"}</b>{actingAs && <button onClick={() => setActingAs("")}>Return to DM view</button>}</div>{children}</>}</div>;
}
