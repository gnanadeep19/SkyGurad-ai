import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

type Credential = { id: string; station_id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null; expected_interval_minutes?: number | null; monitoring_started_at?: string | null };
function MonitoringControl({ credential, busy, onSave }: { credential: Credential; busy: boolean; onSave: (credential: Credential, minutes: number | null) => Promise<void> }) {
  const [minutes, setMinutes] = useState(credential.expected_interval_minutes?.toString() ?? "");
  const value = minutes === "" ? null : Number(minutes);
  const needsStart = value !== null && !credential.monitoring_started_at;
  return <form className="device-monitoring-control" onSubmit={event => { event.preventDefault(); void onSave(credential, value); }}><label>Expected interval (minutes)<input type="number" min={1} max={1440} placeholder="Off" value={minutes} onChange={event => setMinutes(event.target.value)} /></label><button className="ghost-button" disabled={busy || (!needsStart && value === (credential.expected_interval_minutes ?? null))} type="submit">Save interval</button></form>;
}
export default function DeviceCredentials() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [station, setStation] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("90");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/device-credentials", { headers: { Accept: "application/json" } });
    if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
    if (!response.ok) throw new Error("Unable to load device credentials. Open SkyGuard on this computer.");
    const result = await response.json(); setCredentials(result.credentials);
  }, []);
  useEffect(() => { void load().catch(err => setError(err.message)); }, [load]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setToken("");
    try {
      const response = await fetch("/api/device-credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ station_id: station.trim(), label: label.trim(), expires_in_days: Number(days) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to create credential.");
      setToken(result.token); setStation(""); setLabel("");
      // Keep the one-time token visible even if refreshing the list fails.
      try { await load(); } catch { setError("Credential created, but the list could not be refreshed."); }
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create credential."); }
    finally { setBusy(false); }
  };
  const revoke = async (credential: Credential) => {
    if (!window.confirm(`Revoke access for ${credential.label} (${credential.station_id})?`)) return;
    setBusy(true); setError("");
    try { const response = await fetch(`/api/device-credentials/${credential.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to revoke credential."); await load(); window.dispatchEvent(new Event("skyguard:freshness-updated")); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to revoke credential."); }
    finally { setBusy(false); }
  };
  const saveMonitoring = async (credential: Credential, minutes: number | null) => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/device-credentials/${credential.id}/monitoring`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_interval_minutes: minutes }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to update monitoring."); await load(); window.dispatchEvent(new Event("skyguard:freshness-updated")); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to update monitoring."); }
    finally { setBusy(false); }
  };
  return <section className="panel device-access"><div className="device-access-heading"><span className="device-access-icon"><KeyRound size={19} /></span><div><span className="directory-kicker">ADMINISTRATOR CONTROLS</span><h2>Device access</h2><p>Create a separate credential for one station. Direct submissions are local; the HTTPS gateway can forward readings.</p></div></div>
    {error && <div className="quality-error" role="alert">{error}</div>}
    <form className="device-access-form" onSubmit={event => void create(event)}><label>Station ID<input required maxLength={128} pattern="[a-zA-Z0-9._:-]+" placeholder="e.g. AWS-001" value={station} onChange={event => setStation(event.target.value)} /></label><label>Credential label<input required maxLength={80} placeholder="e.g. Station gateway" value={label} onChange={event => setLabel(event.target.value)} /></label><label>Expires in (days)<input type="number" min={1} max={365} required value={days} onChange={event => setDays(event.target.value)} /></label><button className="primary-button" disabled={busy || !!token} type="submit">Create credential</button></form>
    {token && <div className="device-token" role="status"><strong>Save this credential now</strong><p>It is shown only once. Store it securely and do not share it in chat.</p><code>{token}</code><button className="ghost-button" onClick={() => setToken("")}>I have saved it</button></div>}
    <div className="device-access-list">{credentials.length ? credentials.map(item => { const expired = Date.parse(item.expires_at) <= Date.now(); return <div className="device-access-entry" key={item.id}><div className="device-access-row"><div><strong>{item.label}</strong><span>{item.station_id} · {item.revoked_at ? "Revoked" : expired ? "Expired" : `Expires ${new Date(item.expires_at).toLocaleDateString()}`}</span></div>{!item.revoked_at && <button className="ghost-button" disabled={busy} onClick={() => void revoke(item)}>Revoke</button>}</div>{!item.revoked_at && !expired && <MonitoringControl credential={item} busy={busy} onSave={saveMonitoring} />}</div>; }) : <p>No device credentials have been created.</p>}</div>
    <div className="device-access-note"><ShieldCheck size={16} /> A credential grants access only to its assigned station. A verified physical station is still needed.</div>
  </section>;
}
