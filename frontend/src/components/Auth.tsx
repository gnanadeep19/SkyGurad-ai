import { useEffect, useState } from "react";
import { Activity, AlertCircle, Check, CloudLightning, Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck, UserPlus, UserRound, Users } from "lucide-react";

export type Account = { id: string; username: string; role: "administrator" | "operator"; active: boolean; createdAt: string };
async function request(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

export function AuthGate({ children }: { children: (user: Account, signOut: () => void) => React.ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<Account["role"] | "">("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const status = await request("/api/auth/status");
        if (!active) return;
        setSetup(status.setupRequired);
        if (!status.setupRequired) {
          const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
          if (response.ok) { const data = await response.json(); if (active) setUser(data.user); }
          else if (response.status !== 401) throw new Error("Unable to verify your session.");
        }
      } catch { if (active) setError("Unable to connect to the authentication service. Check that the backend is running and refresh the page."); }
      finally { if (active) setLoading(false); }
    };
    void initialize(); return () => { active = false; };
  }, []);
  useEffect(() => {
    const expired = () => { setUser(null); setPassword(""); setError("Your session has expired. Please sign in again."); };
    window.addEventListener("skyguard:session-expired", expired);
    return () => window.removeEventListener("skyguard:session-expired", expired);
  }, []);
  const signOut = async () => { try { await request("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* Clear the local view even if the server is unavailable. */ } setUser(null); setPassword(""); setCode(""); setSelectedRole(""); setShowPassword(false); setSetup(false); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await request(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: JSON.stringify({ username: username.trim(), password, ...(setup ? { code: code.trim() } : { role: selectedRole }) }) }); setUser(result.user); setPassword(""); setCode(""); setSetup(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };
  if (loading) return <main className="auth-loading"><Activity size={22} /> Connecting to SkyGuard…</main>;
  if (user) return <>{children(user, () => { void signOut(); })}</>;
  return <main className="auth-page"><div className="auth-ambient" /><div className="auth-layout"><section className="auth-intro"><div className="auth-brand"><CloudLightning size={37} /><strong>SkyGuard</strong></div><div className="auth-intro-content"><span className="auth-kicker"><span /> WEATHER STATION INTELLIGENCE</span><h1>Better visibility.<br /><span>More confident decisions.</span></h1><p>Monitor weather station health, investigate anomalies, and review observations from one workspace.</p><div className="auth-feature"><ShieldCheck size={19} /><span>Role-based access for your monitoring team</span></div><div className="auth-feature"><Activity size={19} /><span>Clear insight into station performance</span></div></div><small>SKYGUARD AI · WEATHER DATA MONITORING</small></section><section className="auth-card"><div className="auth-card-icon"><LockKeyhole size={22} /></div><span className="auth-card-kicker">{setup ? "FIRST-TIME SETUP" : "WELCOME BACK"}</span><h2>{setup ? "Create an administrator" : "Sign in to SkyGuard"}</h2><p>{setup ? "Set up the first administrator account to access the workspace." : "Enter your account details to continue to your workspace."}</p><form onSubmit={submit} className="auth-form">{!setup && <fieldset className="auth-role-picker"><legend>Sign in as</legend><div><label className={selectedRole === "administrator" ? "selected" : ""}><input type="radio" name="role" value="administrator" checked={selectedRole === "administrator"} onChange={() => setSelectedRole("administrator")} required /><span className="auth-role-icon"><ShieldCheck size={18} /></span><span className="auth-role-copy"><strong>Administrator</strong><small>Manage users and settings</small></span><span className="auth-role-indicator" aria-hidden="true" /></label><label className={selectedRole === "operator" ? "selected" : ""}><input type="radio" name="role" value="operator" checked={selectedRole === "operator"} onChange={() => setSelectedRole("operator")} required /><span className="auth-role-icon"><UserRound size={18} /></span><span className="auth-role-copy"><strong>Operator</strong><small>Monitor and analyze data</small></span><span className="auth-role-indicator" aria-hidden="true" /></label></div></fieldset>}{setup && <label>Setup code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required placeholder="Enter the backend setup code" /><small>Find the one-time code in the backend terminal.</small></label>}<label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={40} placeholder="Enter your username" />{setup && <small>Use letters, numbers, periods, underscores, or hyphens.</small>}</label><div className="auth-password-field"><label htmlFor="auth-password">Password</label><div className="auth-password-input"><input id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 12 : undefined} maxLength={256} placeholder={setup ? "At least 12 characters" : "Enter your password"} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>{error && <div className="auth-error" role="alert"><AlertCircle size={16} />{error}</div>}<button className="primary-button auth-submit" disabled={busy} type="submit"><LogIn size={17} />{busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}</button></form><div className="auth-card-footer"><ShieldCheck size={15} /> Authorized access for SkyGuard operators</div></section></div></main>;
}

export function UserManagement({ currentUser, onSignOut }: { currentUser: Account; onSignOut: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Account["role"]>("operator");
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { const result = await request("/api/users"); setAccounts(result.users); };
  useEffect(() => { void load().catch((err) => setError(err.message)); }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await request("/api/users", { method: "POST", body: JSON.stringify({ username: username.trim(), password, role }) }); setUsername(""); setPassword(""); setMessage("Account created successfully."); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to create account."); } finally { setBusy(false); }
  };
  const update = async (account: Account, changes: { role?: Account["role"]; active?: boolean; password?: string }) => {
    setBusy(true); setError(""); setMessage("");
    try { await request(`/api/users/${account.id}`, { method: "PATCH", body: JSON.stringify(changes) }); setResetId(null); setNewPassword(""); if (account.id === currentUser.id) { onSignOut(); return; } setMessage("Account updated successfully."); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to update account."); } finally { setBusy(false); }
  };
  return <div className="workspace-page users-workspace"><div className="page-hero panel"><div><span className="eyebrow">Administration / Access control</span><h2>Team access</h2><p>Create accounts and manage access for your SkyGuard team.</p></div><span className="users-count"><Users size={17} /> {accounts.length} accounts</span></div>{error && <div className="auth-error" role="alert"><AlertCircle size={16} />{error}</div>}{message && <div className="users-success" role="status"><Check size={16} />{message}</div>}<div className="users-grid"><section className="panel users-list-panel"><div className="users-panel-heading"><span className="directory-kicker">ACCESS DIRECTORY</span><h2>Team accounts</h2><p>Manage account roles, passwords, and access.</p></div><div className="users-list">{accounts.map((account) => <div className="users-row" key={account.id}><div className="users-row-main"><span className="users-avatar">{account.username.slice(0, 2).toUpperCase()}</span><div className="users-identity"><strong>{account.username}{account.id === currentUser.id && <small> You</small>}</strong><span>{account.active ? "Active" : "Access disabled"}</span></div><select aria-label={`Role for ${account.username}`} value={account.role} disabled={busy || account.id === currentUser.id} onChange={(event) => void update(account, { role: event.target.value as Account["role"] })}><option value="operator">Operator</option><option value="administrator">Administrator</option></select></div><div className="users-actions"><button onClick={() => { setResetId(resetId === account.id ? null : account.id); setNewPassword(""); }}>Reset password</button><button disabled={busy || account.id === currentUser.id} onClick={() => void update(account, { active: !account.active })}>{account.active ? "Disable access" : "Enable access"}</button></div>{resetId === account.id && <form className="users-reset" onSubmit={(event) => { event.preventDefault(); void update(account, { password: newPassword }); }}><label><span className="sr-only">New password for {account.username}</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password (12 characters minimum)" minLength={12} maxLength={256} required autoComplete="new-password" /></label><button className="primary-button" disabled={busy}>Update password</button></form>}</div>)}</div></section><section className="panel users-create-panel"><div className="users-panel-heading"><span className="directory-kicker">ADD A TEAM MEMBER</span><h2>Create account</h2><p>Set a username, initial password, and role.</p></div><form className="users-create-form" onSubmit={create}><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" required placeholder="e.g. station.operator" autoComplete="off" /></label><label>Initial password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} required placeholder="At least 12 characters" autoComplete="new-password" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as Account["role"])}><option value="operator">Operator</option><option value="administrator">Administrator</option></select></label><div className="users-role-note"><ShieldCheck size={16} /><span>{role === "operator" ? "Operators can monitor stations, review anomalies, and analyze datasets." : "Administrators can manage accounts and detection settings in addition to monitoring."}</span></div><button className="primary-button" disabled={busy}><UserPlus size={16} />Create account</button></form></section></div></div>;
}
