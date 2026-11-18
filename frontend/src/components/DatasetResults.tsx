import { Activity, CircleHelp, Database } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HistoricalDriftReview } from "./DriftReview";

export type DatasetReport = {
  fileName: string;
  rows: number;
  unique_observations: number;
  period: { start: string; end: string } | null;
  quality: { inserted: number; duplicate: number; invalid: number };
  thresholds: { warning_score: number; critical_score: number };
  historical_summary: { scored: number; insufficient: number; warning: number; critical: number; baseline_window: number; refit_interval: number; minimum_history: number };
  series: Array<{ station_id: string; timestamp: string; anomaly_score: number | null; status: "Healthy" | "Warning" | "Critical" | "Insufficient data"; temperature: number; pressure: number; humidity: number }>;
  stations: Array<{
    station_id: string; station_name: string; timestamp: string;
    temperature: number; pressure: number; humidity: number;
    status: "Healthy" | "Warning" | "Critical" | "Insufficient data"; anomaly_score: number | null;
    explanation: string; readings_count: number; baseline_readings: number; baseline_available: boolean;
  }>;
};

const utc = (value: string) => `${new Date(value).toLocaleString("en-GB", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC`;

export default function DatasetResults({ report }: { report: DatasetReport }) {
  const [selectedStation, setSelectedStation] = useState("");
  const stationId = report.stations.some(station => station.station_id === selectedStation) ? selectedStation : report.stations[0]?.station_id ?? "";
  const points = useMemo(() => report.series.filter(row => row.station_id === stationId).map(row => ({ ...row, time: Date.parse(row.timestamp) })), [report.series, stationId]);
  const flagged = useMemo(() => points.filter(row => row.status === "Warning" || row.status === "Critical").reverse(), [points]);
  return <section className="panel historical-results" aria-labelledby="historical-results-title">
    <div className="historical-results-head"><div><span className="directory-kicker">HISTORICAL DATASET</span><h2 id="historical-results-title">Analysis results</h2><p>{report.fileName}</p></div><span className="historical-source"><Database size={15} /> Uploaded file</span></div>
    <div className="historical-summary">
      <div><span>Valid rows</span><strong>{report.rows.toLocaleString()}</strong><small>{report.unique_observations.toLocaleString()} unique station timestamps</small></div>
      <div><span>Stations</span><strong>{report.stations.length.toLocaleString()}</strong><small>In this file</small></div>
      <div><span>Newly stored</span><strong>{report.quality.inserted.toLocaleString()}</strong><small>{report.quality.duplicate.toLocaleString()} already stored or duplicate</small></div>
      <div><span>Invalid rows</span><strong>{report.quality.invalid.toLocaleString()}</strong><small>Excluded from analysis</small></div>
    </div>
    {report.period && <p className="historical-period">Observation period <strong>{utc(report.period.start)} – {utc(report.period.end)}</strong></p>}
    <div className="historical-results-intro"><Activity size={18} /><div><h3>Historical anomaly review</h3><p>{report.historical_summary.scored.toLocaleString()} readings scored · {report.historical_summary.insufficient.toLocaleString()} baseline readings not scored · {report.historical_summary.warning.toLocaleString()} warning · {report.historical_summary.critical.toLocaleString()} critical</p></div></div>
    {report.stations.length > 0 && <div className="historical-trend">
      <div className="historical-trend-head"><div><h3>Anomaly score over time</h3><p>Scores use only earlier readings from the selected station.</p></div><label>Station <select value={stationId} onChange={event => setSelectedStation(event.target.value)}>{report.stations.map(station => <option value={station.station_id} key={station.station_id}>{station.station_name} · {station.station_id}</option>)}</select></label></div>
      <div className="historical-chart" role="img" aria-label={`Anomaly scores over time for ${stationId}. Warning threshold ${report.thresholds.warning_score}, critical threshold ${report.thresholds.critical_score}.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 12, right: 15, bottom: 6, left: -12 }}><CartesianGrid stroke="#294658" strokeDasharray="3 5" /><XAxis type="number" dataKey="time" domain={["dataMin", "dataMax"]} tickFormatter={value => new Date(Number(value)).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" })} tick={{ fill: "#9bb5c6", fontSize: 10 }} minTickGap={30} /><YAxis domain={[0, 1]} tick={{ fill: "#9bb5c6", fontSize: 10 }} /><Tooltip labelFormatter={value => utc(new Date(Number(value)).toISOString())} formatter={value => [typeof value === "number" ? value.toFixed(2) : "Not scored", "Anomaly score"]} contentStyle={{ background: "#102838", border: "1px solid #31566b", borderRadius: 8, color: "#ecf7fc" }} /><ReferenceLine y={report.thresholds.warning_score} stroke="#f7ba50" strokeDasharray="4 4" /><ReferenceLine y={report.thresholds.critical_score} stroke="#f66b7c" strokeDasharray="4 4" /><Line type="linear" dataKey="anomaly_score" stroke="#39c4f5" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} /></LineChart></ResponsiveContainer></div>
      <div className="historical-thresholds"><span><i className="historical-dot score" />Score</span><span><i className="historical-dot warn" />Warning ≥ {report.thresholds.warning_score.toFixed(2)}</span><span><i className="historical-dot critical" />Critical ≥ {report.thresholds.critical_score.toFixed(2)}</span></div>
      <p className="historical-method">The first {report.historical_summary.minimum_history} unique readings per station establish a baseline and are not scored. The model uses up to {report.historical_summary.baseline_window} earlier readings and refreshes every {report.historical_summary.refit_interval} readings.</p>
      <HistoricalDriftReview readings={points} />
      <div className="historical-flagged-head"><h3>Flagged readings</h3><span>{flagged.length.toLocaleString()} for this station</span></div>
      {flagged.length ? <div className="historical-table-wrap"><table className="historical-table"><thead><tr><th>Time (UTC)</th><th>Severity</th><th>Score</th><th>Temperature</th><th>Pressure</th><th>Humidity</th></tr></thead><tbody>{flagged.slice(0, 50).map(row => <tr key={row.timestamp}><td>{utc(row.timestamp)}</td><td><span className={`historical-status ${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.anomaly_score?.toFixed(2)}</td><td>{row.temperature.toFixed(1)} °C</td><td>{row.pressure.toFixed(1)} hPa</td><td>{row.humidity.toFixed(0)}%</td></tr>)}</tbody></table>{flagged.length > 50 && <p className="historical-method">Showing the 50 most recent flagged readings.</p>}</div> : <p className="historical-method">No scored readings exceed the configured thresholds for this station.</p>}
    </div>}
    <div className="historical-results-intro"><Activity size={18} /><div><h3>Latest observation by station</h3><p>Latest reading and score for each station in this file.</p></div></div>
    {report.stations.length ? <div className="historical-station-list">{report.stations.map(station => <article className="historical-station" key={station.station_id}>
      <div className="historical-station-title"><div><h4>{station.station_name}</h4><p>{station.station_id} · {utc(station.timestamp)}</p></div><span className={`historical-status ${station.baseline_available ? station.status.toLowerCase() : "insufficient"}`}>{station.baseline_available ? station.status : "Insufficient history"}</span></div>
      <div className="historical-readings"><div><span>Temperature</span><strong>{station.temperature.toFixed(1)} °C</strong></div><div><span>Pressure</span><strong>{station.pressure.toFixed(1)} hPa</strong></div><div><span>Humidity</span><strong>{station.humidity.toFixed(0)}%</strong></div><div><span>Anomaly score</span><strong>{station.baseline_available && station.anomaly_score !== null ? station.anomaly_score.toFixed(2) : "—"}</strong></div></div>
      <p className="historical-explanation">{station.baseline_available ? station.explanation : `At least 24 earlier unique readings are needed for the station baseline; this file has ${station.baseline_readings}.`}</p>
    </article>)}</div> : <p className="historical-explanation historical-empty">No valid observations were available for analysis.</p>}
    <div className="historical-note"><CircleHelp size={16} /><span>Historical uploads stay separate from the live dashboard and do not create active alerts. Scores are indicators, not proof of a sensor fault; a source may include derived values.</span></div>
  </section>;
}
