import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toCsv, utcDateRange } from "../lib/analytics-export";
import { IncidentEvidence, type Incident } from "./StationIncidents";

type Metric = "temperature" | "humidity" | "pressure";
type Reading = { station_id: string; station_name: string; timestamp: string; recorded_at: string | null; source: string; temperature: number; humidity: number; pressure: number };
type AlertSnapshot = { id:string|null; station_id:string; source:string; status:string; severity:"Warning"|"Critical"; opened_at:string; details:Incident["details"] };
type Filters = { start: string; end: string; source: string; station: string; metric: Metric; sensor: string; severity: string; status: string };
const metrics: Record<Metric, { label: string; unit: string }> = { temperature: { label: "Temperature", unit: "°C" }, humidity: { label: "Relative humidity", unit: "%" }, pressure: { label: "Station pressure", unit: "hPa" } };
const initialDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
const format = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unavailable";

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function IncidentActions({ id }: { id: string }) {
  const [actions, setActions] = useState<Array<{action:string;note:string;created_at:string}> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    try { const response = await fetch(`/api/station-incidents/${encodeURIComponent(id)}/actions`); if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; } if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Unable to load action history."); const data = await response.json(); if (!Array.isArray(data.actions)) throw new Error("Invalid action history."); setActions(data.actions); setOpen(true); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load action history."); }
  };
  return <div><button className="incident-history-toggle" onClick={() => void toggle()} aria-expanded={open}>{open ? "Hide action history" : "View action history"}</button>{error && <p role="alert">{error}</p>}{open && <><p className="historical-hint">Most recent 100 actions, including maintenance notes.</p><ul className="incident-history">{actions?.map((action,index)=><li key={`${action.created_at}-${index}`}><strong>{action.action}</strong><span>{format(action.created_at)}</span>{action.note && <p>{action.note}</p>}</li>)}</ul></>}</div>;
}

export default function HistoricalAnalytics() {
  const [draft, setDraft] = useState<Filters>({ start: initialDate(7), end: initialDate(0), source: "station-api", station: "", metric: "temperature", sensor: "all", severity: "all", status: "all" });
  const [applied, setApplied] = useState<Filters | null>(null);
  const [rows, setRows] = useState<Reading[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [readingOffset, setReadingOffset] = useState(0);
  const [incidentOffset, setIncidentOffset] = useState(0);
  const [alertOffset, setAlertOffset] = useState(0);
  const [alerts, setAlerts] = useState<AlertSnapshot[]>([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertSummary, setAlertSummary] = useState<{ bySensor: Record<string,number>; byStation: Array<{station_id:string;count:number}> }>({bySensor:{},byStation:[]});
  const [incidentTotal, setIncidentTotal] = useState(0);
  const [incidentSummary, setIncidentSummary] = useState<{ bySensor: Record<string,number>; byStation: Array<{station_id:string;count:number}> }>({bySensor:{},byStation:[]});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(0);
  const range = utcDateRange(draft.start, draft.end);
  useEffect(() => {
    if (!applied) return;
    const bounds = utcDateRange(applied.start, applied.end)!;
    const controller = new AbortController();
    const query = new URLSearchParams({ ...bounds, source: applied.source });
    if (applied.station.trim()) query.set("station_id", applied.station.trim());
    const readingQuery = new URLSearchParams(query); readingQuery.set("offset", String(readingOffset));
    const incidentQuery = new URLSearchParams(query); incidentQuery.set("offset", String(incidentOffset));
    const alertQuery = new URLSearchParams(query); alertQuery.set("offset", String(alertOffset));
    if (applied.severity !== "all") incidentQuery.set("severity", applied.severity);
    if (applied.severity !== "all") alertQuery.set("severity", applied.severity);
    if (applied.status !== "all") incidentQuery.set("status", applied.status);
    if (applied.sensor !== "all") incidentQuery.set("sensor", applied.sensor);
    if (applied.sensor !== "all") alertQuery.set("sensor", applied.sensor);
    setBusy(true); setError("");
    void (async () => {
      try {
        const [readingsResponse, incidentsResponse, alertsResponse] = await Promise.all([fetch(`/api/analytics/history?${readingQuery}`, { signal: controller.signal }), fetch(`/api/analytics/incidents?${incidentQuery}`, { signal: controller.signal }), fetch(`/api/analytics/alerts?${alertQuery}`, { signal: controller.signal })]);
        if ([readingsResponse,incidentsResponse,alertsResponse].some(response=>response.status === 401)) { window.dispatchEvent(new Event("skyguard:session-expired")); throw new Error("Your session has expired."); }
        if ([readingsResponse,incidentsResponse,alertsResponse].some(response=>!response.ok || !response.headers.get("content-type")?.includes("application/json"))) throw new Error("Unable to load historical data. Check the backend connection and restart it if it is running an older version.");
        const [readings, incidentData, alertData] = await Promise.all([readingsResponse.json(), incidentsResponse.json(), alertsResponse.json()]);
        if (!Array.isArray(readings.readings) || !Array.isArray(incidentData.incidents) || typeof incidentData.total !== "number" || !incidentData.bySensor || !Array.isArray(incidentData.byStation) || !Array.isArray(alertData.alerts) || typeof alertData.total !== "number" || !alertData.bySensor || !Array.isArray(alertData.byStation)) throw new Error("The historical response was not valid. Restart the backend if it is running an older version.");
        if (!controller.signal.aborted) { setRows(readings.readings); setTruncated(readings.has_older === true); setIncidents(incidentData.incidents); setIncidentTotal(incidentData.total); setIncidentSummary({bySensor:incidentData.bySensor,byStation:incidentData.byStation}); setAlerts(alertData.alerts); setAlertTotal(alertData.total); setAlertSummary({bySensor:alertData.bySensor,byStation:alertData.byStation}); }
      } catch (err) { if (!controller.signal.aborted) { setRows([]); setIncidents([]); setAlerts([]); setTruncated(false); setIncidentTotal(0); setAlertTotal(0); setIncidentSummary({bySensor:{},byStation:[]}); setAlertSummary({bySensor:{},byStation:[]}); setError(err instanceof Error ? err.message : "Unable to load historical data."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [applied, requestId, readingOffset, incidentOffset, alertOffset]);
  const filteredIncidents = incidents;
  const values = useMemo(() => applied ? rows.filter(row => Number.isFinite(row[applied.metric])) : [], [rows, applied]);
  const chartRows = values.map(row => ({ timestamp: Date.parse(row.timestamp), value: row[applied!.metric] }));
  const chartSpan = chartRows.length > 1 ? chartRows[chartRows.length - 1].timestamp - chartRows[0].timestamp : 0;
  const chartTick = (value: number) => new Date(value).toLocaleString(undefined, chartSpan <= 86400_000 ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const run = () => { if (range) { setReadingOffset(0); setIncidentOffset(0); setAlertOffset(0); setApplied({ ...draft, station: draft.station.trim() }); setRequestId(id => id + 1); } };
  const exportReadings = () => applied && download("skyguard-filtered-readings.csv", toCsv(["station_id", "station_name", "observed_at_utc", "received_at_utc", "source", `${applied.metric} (${metrics[applied.metric].unit})`], values.map(row => [row.station_id,row.station_name,row.timestamp,row.recorded_at,row.source,row[applied.metric]])));
  const exportIncidents = () => download("skyguard-filtered-incidents.csv", toCsv(["incident_id","station_id","source","severity","status","assigned_name","resolution_outcome","opened_at_utc","updated_at_utc","observation_at_utc","affected","temperature_c","humidity_percent","pressure_hpa","anomaly_score","model_version","warning_threshold","critical_threshold","baseline_temperature_c","baseline_humidity_percent","baseline_pressure_hpa","previous_at_utc","previous_temperature_c","previous_humidity_percent","previous_pressure_hpa","explanation","recommended_action"], filteredIncidents.map(item => [item.id,item.station_id,item.source,item.severity,item.status,item.assigned_name,item.resolution_outcome,item.opened_at,item.updated_at,item.details?.timestamp,item.details?.affected?.join("; "),item.details?.temperature,item.details?.humidity,item.details?.pressure,item.details?.anomaly_score,item.details?.model_version,item.details?.detector_settings?.warning_score,item.details?.detector_settings?.critical_score,item.details?.detector_evidence?.baseline_center?.temperature,item.details?.detector_evidence?.baseline_center?.humidity,item.details?.detector_evidence?.baseline_center?.pressure,item.details?.detector_evidence?.previous?.timestamp,item.details?.detector_evidence?.previous?.temperature,item.details?.detector_evidence?.previous?.humidity,item.details?.detector_evidence?.previous?.pressure,item.details?.explanation,item.details?.recommended_action])));
  const exportAlerts = () => download("skyguard-filtered-alerts.csv", toCsv(["alert_id","station_id","source","severity","observed_at_utc","affected","temperature_c","humidity_percent","pressure_hpa","anomaly_score","model_version","warning_threshold","critical_threshold","explanation","recommended_action"], alerts.map(item=>[item.id,item.station_id,item.source,item.severity,item.opened_at,item.details?.affected?.join("; "),item.details?.temperature,item.details?.humidity,item.details?.pressure,item.details?.anomaly_score,item.details?.model_version,item.details?.detector_settings?.warning_score,item.details?.detector_settings?.critical_score,item.details?.explanation,item.details?.recommended_action])));
  return <section className="panel historical-analytics" aria-labelledby="history-title">
    <div className="historical-analytics-header"><div><span className="directory-kicker">INVESTIGATION / STORED DATA</span><h2 id="history-title">Historical observations and incidents</h2><p>Filter one source at a time. Dates are inclusive and use UTC.</p></div></div>
    <div className="historical-controls">
      <label>From (UTC)<input type="date" value={draft.start} onChange={event => change("start", event.target.value)} /></label><label>To (UTC)<input type="date" value={draft.end} onChange={event => change("end", event.target.value)} /></label>
      <label>Source<select value={draft.source} onChange={event => change("source", event.target.value)}><option value="station-api">Submitted station</option><option value="open-meteo">Open-Meteo estimate</option><option value="uploaded">Uploaded CSV</option><option value="replay">Replay</option><option value="live">Configured live feed</option><option value="legacy-unknown">Legacy / unknown</option></select></label>
      <label>Station ID<input value={draft.station} maxLength={128} onChange={event => change("station", event.target.value)} placeholder="All stations" /></label>
      <label>Measurement<select value={draft.metric} onChange={event => change("metric", event.target.value as Metric)}>{(Object.keys(metrics) as Metric[]).map(key => <option key={key} value={key}>{metrics[key].label}</option>)}</select></label>
      <label>Alert measurement<select value={draft.sensor} onChange={event => change("sensor", event.target.value)}><option value="all">All measurements</option>{(Object.keys(metrics) as Metric[]).map(key => <option key={key} value={key}>{metrics[key].label}</option>)}</select></label>
      <label>Alert severity<select value={draft.severity} onChange={event => change("severity", event.target.value)}><option value="all">All severities</option><option value="Warning">Warning</option><option value="Critical">Critical</option></select></label>
      <label>Incident status<select value={draft.status} onChange={event => change("status", event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="investigating">Under investigation</option><option value="resolved">Resolved</option></select></label>
      <button className="primary-button" disabled={!range || busy} onClick={run}>{busy ? "Loading…" : "Apply filters"}</button>
    </div>
    {!range && <p className="quality-error" role="alert">Choose a valid date range of no more than 366 days.</p>}
    {error && <p className="quality-error" role="alert">{error}</p>}
    {!applied ? <p className="historical-hint">Choose filters and select Apply filters to load stored data.</p> : !busy && !error && <>
      <div className="historical-analytics-summary"><span>{values.length} displayed readings · source: {applied.source} · {applied.start} to {applied.end} UTC{applied.station ? ` · ${applied.station}` : " · all stations"}</span><button className="ghost-button" onClick={exportReadings} disabled={!values.length}><Download size={15} /> Export shown readings</button></div>
      {values.length > 0 && <p className="historical-hint">Latest shown observation: {format(values[values.length - 1].timestamp)} ({Math.max(0, Math.floor((Date.now() - Date.parse(values[values.length - 1].timestamp)) / 60000))} minutes ago). Times are local; the selected date range is UTC.</p>}
      {values.length && applied.station ? <div className="historical-chart" role="img" aria-label={`${metrics[applied.metric].label} in ${metrics[applied.metric].unit}`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows}><CartesianGrid stroke="#284151" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={["dataMin","dataMax"]} scale="time" tickFormatter={value => chartTick(Number(value))} tick={{ fill:"#a3bdcc",fontSize:10 }} minTickGap={65} /><YAxis domain={["auto","auto"]} tick={{ fill:"#a3bdcc",fontSize:10 }} width={48} /><Tooltip labelFormatter={value => new Date(Number(value)).toLocaleString()} formatter={(value:number) => [`${value.toFixed(1)} ${metrics[applied.metric].unit}`,metrics[applied.metric].label]} contentStyle={{background:"#102334",border:"1px solid #38576b"}} /><Line dataKey="value" stroke="#39c9ff" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p className="historical-hint">{values.length ? "Enter a station ID to view its trend; all matching readings can still be exported." : "No matching readings in the selected period."}</p>}
      {values.length > 1 && applied.station && <p className="historical-hint">The line connects available observations; gaps may be present.</p>}
      <div className="historical-page-controls"><button className="ghost-button" onClick={() => setReadingOffset(Math.max(0, readingOffset - 5000))} disabled={readingOffset === 0}>Newer readings</button><span>Readings page {Math.floor(readingOffset / 5000) + 1}</span><button className="ghost-button" onClick={() => setReadingOffset(readingOffset + 5000)} disabled={!truncated}>Older readings</button></div>
      <div className="historical-analytics-summary"><div><h3>Detection history</h3><span>{alertTotal} matching alert snapshots · {alerts.length} shown on this page</span></div><button className="ghost-button" onClick={exportAlerts} disabled={!alerts.length}><Download size={15} /> Export shown alerts</button></div>
      <p className="historical-hint">Affected measurements: temperature {alertSummary.bySensor.temperature ?? 0}, humidity {alertSummary.bySensor.humidity ?? 0}, pressure {alertSummary.bySensor.pressure ?? 0}; none identified {alertSummary.bySensor.unidentified ?? "unavailable"}. A snapshot may include multiple measurements. The explanation may name the largest deviation even if no measurement met the affected threshold. Incident status does not filter detection snapshots.</p>
      {alertSummary.byStation.length > 0 && <p className="historical-hint">Stations with most matching snapshots: {alertSummary.byStation.map(item => `${item.station_id} (${item.count})`).join(", ")}.</p>}
      {!alerts.length ? <p className="historical-hint">No matching detection snapshots on this page.</p> : <div className="historical-table-scroll"><table className="historical-table"><thead><tr><th>Station / alert</th><th>Observed</th><th>Severity</th><th>Evidence</th></tr></thead><tbody>{alerts.map(item => <tr key={`${item.id ?? item.station_id}-${item.opened_at}`}><td>{item.details?.station_name ?? item.station_id}<br /><small>{item.id ?? "ID not recorded"}</small></td><td>{format(item.opened_at)}</td><td>{item.severity}</td><td>{item.details?.explanation ?? "Explanation not recorded"}<IncidentEvidence incident={{id:item.id ?? "Not recorded",station_id:item.station_id,source:item.source,status:"open",severity:item.severity,opened_at:item.opened_at,updated_at:item.opened_at,details:item.details ?? {}}} idLabel="Alert record ID" description="Evidence reflects this recorded detection." /></td></tr>)}</tbody></table></div>}
      <div className="historical-page-controls"><button className="ghost-button" onClick={() => setAlertOffset(Math.max(0, alertOffset - 50))} disabled={alertOffset === 0}>Newer alerts</button><span>Alert page {Math.floor(alertOffset / 50) + 1}</span><button className="ghost-button" onClick={() => setAlertOffset(alertOffset + 50)} disabled={alertOffset + alerts.length >= alertTotal}>Older alerts</button></div>
      <div className="historical-analytics-summary"><div><h3>Incident history</h3><span>{incidentTotal} matching incidents · {filteredIncidents.length} shown on this page</span></div><button className="ghost-button" onClick={exportIncidents} disabled={!filteredIncidents.length}><Download size={15} /> Export shown incidents</button></div>
      <p className="historical-hint">Counts cover matching incidents by opening date and the applied filters. Affected measurements: temperature {incidentSummary.bySensor.temperature ?? 0}, humidity {incidentSummary.bySensor.humidity ?? 0}, pressure {incidentSummary.bySensor.pressure ?? 0}; none identified {incidentSummary.bySensor.unidentified ?? "unavailable"}. One incident may affect multiple measurements. Incidents without an identified measurement appear under All measurements. Severity and status do not filter observation readings.</p>
      {incidentSummary.byStation.length > 0 && <p className="historical-hint">Stations with most matching incidents: {incidentSummary.byStation.map(item => `${item.station_id} (${item.count})`).join(", ")}.</p>}
      {!filteredIncidents.length ? <p className="historical-hint">No matching incidents on this page.</p> : <div className="historical-table-scroll"><table className="historical-table"><thead><tr><th>Station / incident</th><th>Opened</th><th>Severity / status</th><th>Evidence</th></tr></thead><tbody>{filteredIncidents.map(item => <tr key={item.id}><td>{item.details?.station_name ?? item.station_id}<br /><small>{item.id}</small><IncidentActions id={item.id} /></td><td>{format(item.opened_at)}</td><td>{item.severity}<br /><small>{item.status.replace("investigating", "Under investigation")}</small>{item.assigned_name && <><br /><small>Assigned: {item.assigned_name}</small></>}{item.resolution_outcome && <><br /><small>Outcome: {item.resolution_outcome.replaceAll("_", " ")}</small></>}</td><td>{item.details?.explanation ?? "Explanation not recorded"}<br /><small>Score: {item.details?.anomaly_score ?? "unavailable"} · Model: {item.details?.model_version ?? "not recorded in incident"}</small><IncidentEvidence incident={item} /></td></tr>)}</tbody></table></div>}
      <div className="historical-page-controls"><button className="ghost-button" onClick={() => setIncidentOffset(Math.max(0, incidentOffset - 50))} disabled={incidentOffset === 0}>Newer incidents</button><span>Incident page {Math.floor(incidentOffset / 50) + 1}</span><button className="ghost-button" onClick={() => setIncidentOffset(incidentOffset + 50)} disabled={incidentOffset + filteredIncidents.length >= incidentTotal}>Older incidents</button></div>
      <p className="historical-hint">Each export contains the records shown on its current page. New records or incident updates can move entries between pages; reapply filters to refresh.</p>
    </>}
  </section>;
}
