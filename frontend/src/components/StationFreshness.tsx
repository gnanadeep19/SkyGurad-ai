import { useCallback, useEffect, useState } from "react";
import { Radio } from "lucide-react";

type Freshness = { station_id: string; expected_interval_minutes: number; monitoring_started_at: string | null; status: "awaiting_readings" | "receiving" | "stale" | "disconnected"; last_received_at: string | null; last_observed_at: string | null };
const labels = { awaiting_readings: "Awaiting first reading", receiving: "Receiving readings", stale: "Readings are stale", disconnected: "No recent data received" };
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "None yet";

export default function StationFreshness() {
  const [stations, setStations] = useState<Freshness[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [monitorError, setMonitorError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/station-freshness", { headers: { Accept: "application/json" } });
      if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
      if (!response.ok) throw new Error("Station freshness is unavailable.");
      const result = await response.json(); setStations(result.stations); setMonitorError(result.monitor?.last_error ?? ""); setError("");
    } catch { setError("Station freshness is unavailable; displayed status may be out of date."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); window.addEventListener("skyguard:freshness-updated", load); return () => { window.clearInterval(timer); window.removeEventListener("skyguard:freshness-updated", load); }; }, [load]);
  return <section className="panel freshness-panel"><div className="freshness-heading"><Radio size={19} /><div><span className="directory-kicker">DATA ARRIVAL MONITORING</span><h2>Station freshness</h2><p>Based on the expected interval set by an administrator. Updates every minute.</p></div></div>
    {error && <div className="quality-error" role="alert">{error}</div>}
    {monitorError && <div className="quality-error" role="alert">{monitorError}</div>}
    {loading ? <p className="freshness-empty">Loading station freshness…</p> : stations.length ? <div className="freshness-list">{stations.map(station => <article className="freshness-row" key={station.station_id}><div><strong>{station.station_id}</strong><span>Expected every {station.expected_interval_minutes} min · Last received {time(station.last_received_at)} · Last observed {time(station.last_observed_at)}</span>{station.status === "awaiting_readings" && !station.monitoring_started_at && <span>Monitoring start time unavailable. An administrator can save the interval again to begin the first-reading timer.</span>}</div><b className={`freshness-status ${station.status}`}>{station.status === "disconnected" && !station.last_received_at ? "No first reading received" : labels[station.status]}</b></article>)}</div> : <p className="freshness-empty">No stations are monitored yet. An administrator can set an expected interval under Device access.</p>}
    <p className="freshness-note">Readings are stale after twice the expected interval. No recent data means more than three times the interval since receipt, or since monitoring began if no reading has arrived. Stale or missing data creates a review incident and can send email when configured. This does not verify a physical device.</p>
  </section>;
}
