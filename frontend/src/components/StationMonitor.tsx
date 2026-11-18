import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertCircle, ChevronRight, Radio, RefreshCw, ShieldCheck } from "lucide-react";
import StationIncidents, { IncidentEvidence, type Incident } from "./StationIncidents";
import NoaaReference from "./NoaaReference";
import ImdReference from "./ImdReference";
import DeviceCredentials from "./DeviceCredentials";
import StationHistory from "./StationHistory";
import StationFreshness from "./StationFreshness";

type StationReading = {
  station_id: string; station_name: string; timestamp: string; received_at: string | null;
  temperature: number; pressure: number; humidity: number; stale: boolean;
  baseline_readings: number; anomaly_score: number | null;
  status: "Healthy" | "Warning" | "Critical" | "Insufficient data"; explanation: string;
};
type DetectionEvent = { id?: string|null; source?:string; station_id: string; station_name: string; timestamp: string; severity: "Warning" | "Critical"; anomaly_score: number | null; explanation: string; details?:Incident["details"] };
type MonitorResponse = { stations: StationReading[]; recent_events: DetectionEvent[]; stale_after_minutes: number; observed_window_hours: number; truncated: boolean };
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unavailable";
const statusLabel = (status: StationReading["status"]) => status === "Healthy" ? "Within baseline" : status === "Warning" ? "Needs review" : status === "Critical" ? "High deviation" : "Building baseline";

export default function StationMonitor({ onBack, onQuality, canManageDevices = false }: { onBack: () => void; onQuality: () => void; canManageDevices?: boolean }) {
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoring, setScoring] = useState<{pending:number;pending_truncated:boolean;last_error:string|null}|null>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (controller.current) return;
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/station-observations/monitor", { headers: { Accept: "application/json" }, signal: current.signal });
      if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load station submissions.");
      if (!current.signal.aborted) setData(payload);
      try {
        const status=await fetch("/api/station-scoring/status",{headers:{Accept:"application/json"},signal:current.signal});
        if (!status.ok) throw new Error("Scoring status unavailable");
        const queue=await status.json();
        if (!current.signal.aborted) setScoring(queue);
      } catch { if (!current.signal.aborted) setScoring(null); }
    } catch (err) {
      if (!current.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load station submissions.");
    } finally {
      if (!current.signal.aborted) setBusy(false);
      if (controller.current === current) controller.current = null;
    }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); return () => { window.clearInterval(timer); controller.current?.abort(); controller.current = null; }; }, [load]);
  return <div className="workspace-page station-feed-page">
    <div className="page-hero panel"><div><span className="eyebrow">Source: submitted station observations</span><h2>Station feed</h2><p>Review readings submitted through the station API, separately from modeled weather data. The physical device has not been verified.</p></div><button className="ghost-button" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />{busy ? "Refreshing…" : "Refresh"}</button></div>
    <NoaaReference />
    <ImdReference />
    {canManageDevices && <DeviceCredentials />}
    <StationFreshness />
    <section className="panel station-feed-panel"><div className="station-feed-heading"><div><span className="directory-kicker">RECENT STATION READINGS</span><h2>Latest observations</h2><p>Observed in the last seven days · Refreshes every minute</p></div>{data && <span className="station-feed-count">{data.stations.length} {data.stations.length === 1 ? "station" : "stations"}</span>}</div>
      {error && <div className="quality-error" role="alert"><AlertCircle size={16} />{error}{data ? " Displayed data may be out of date." : ""}</div>}
      {scoring && (scoring.last_error || scoring.pending > 0) && <div className="quality-error" role="status"><AlertCircle size={16} />{scoring.last_error ?? `${scoring.pending_truncated ? "At least " : ""}${scoring.pending} station readings are waiting for scoring; the backend retries automatically.`}</div>}
      {data?.truncated && <div className="quality-error" role="alert"><AlertCircle size={16} />More than 20,000 readings exist in the window. This view uses only the most recent 20,000, so stations or older baseline readings may be omitted.</div>}
      {!!data?.stations.length && <StationHistory stations={data.stations} />}
      {!data && busy ? <div className="directory-empty">Loading submitted readings…</div> : !data ? null : data.stations.length === 0 ? <div className="station-feed-empty"><span><Radio size={25} /></span><h3>No station readings yet</h3><p>Accepted submissions from the station API will appear here. An administrator can set up a trusted source.</p><button className="ghost-button" onClick={onQuality}>Review data quality <ChevronRight size={15} /></button></div> : <div className="station-feed-list">{data.stations.map(station => <article className="station-feed-card" key={station.station_id}>
        <div className="station-feed-card-head"><div className="station-feed-identity"><span className="station-feed-icon"><Radio size={18} /></span><div><h3>{station.station_name}</h3><p>{station.station_id}</p></div></div><div className="station-feed-badges"><span className={`station-feed-freshness ${station.stale ? "stale" : "fresh"}`}>{station.stale ? "Stale reading" : "Recent reading"}</span><span className={`historical-status ${station.status === "Insufficient data" ? "insufficient" : station.status.toLowerCase()}`}>{statusLabel(station.status)}</span></div></div>
        <div className="station-feed-readings"><div><span>Temperature</span><strong>{station.temperature.toFixed(1)} °C</strong></div><div><span>Station pressure</span><strong>{station.pressure.toFixed(1)} hPa</strong></div><div><span>Relative humidity</span><strong>{station.humidity.toFixed(0)}%</strong></div><div><span>Anomaly score</span><strong>{station.anomaly_score === null ? "—" : station.anomaly_score.toFixed(2)}</strong></div></div>
        <p className="station-feed-explanation">{station.explanation}{station.anomaly_score === null ? ` ${station.baseline_readings} of 24 earlier readings available.` : ""}</p>
        <div className="station-feed-times"><span>Observed {time(station.timestamp)}</span><span>Received {time(station.received_at)}</span></div>
      </article>)}</div>}
      <StationIncidents />
      <div className="station-detections"><div className="station-detections-heading"><div><span className="directory-kicker">DETECTION HISTORY</span><h3>Recent flagged observations</h3><p>Recorded snapshots of submitted readings.</p></div><Activity size={19} /></div>{data && data.recent_events.length ? <div className="station-detection-list">{data.recent_events.map(event => <article className="station-detection" key={`${event.station_id}-${event.timestamp}`}><div className="station-detection-top"><div><strong>{event.station_name}</strong><small>{event.station_id} · {time(event.timestamp)}</small></div><span className={`historical-status ${event.severity.toLowerCase()}`}>{event.severity}</span></div><p>{event.explanation}</p><span className="station-detection-score">Anomaly score {event.anomaly_score === null ? "—" : event.anomaly_score.toFixed(2)}</span><IncidentEvidence incident={{id:event.id ?? "Not recorded",station_id:event.station_id,source:event.source ?? "station-api",status:"open",severity:event.severity,opened_at:event.timestamp,updated_at:event.timestamp,details:event.details ?? {}}} idLabel="Alert record ID" description="Evidence reflects this recorded detection." /></article>)}</div> : data ? <p className="station-detection-empty">No flagged station submissions have been recorded.</p> : null}</div>
      <div className="station-feed-note"><ShieldCheck size={16} /><span>These are submitted values; SkyGuard has not verified the physical device. Readings older than {data?.stale_after_minutes ?? 30} minutes are marked stale. The cards show the current baseline score; review incidents for flat readings, sustained changes and missing data. Scores and warnings are not confirmed faults.</span></div>
    </section><button className="back-link" onClick={onBack}><ChevronRight size={15} className="back-chevron" />Back to overview</button>
  </div>;
}
