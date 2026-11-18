import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { normalizeStationHistory, type StationHistoryPoint } from "../lib/station-history";

type Station = { station_id: string; station_name: string };
type Metric = "temperature" | "humidity" | "pressure";
const metrics: Record<Metric, { label: string; unit: string; color: string }> = {
  temperature: { label: "Temperature", unit: "°C", color: "#39c9ff" },
  humidity: { label: "Humidity", unit: "%", color: "#b18aff" },
  pressure: { label: "Station pressure", unit: "hPa", color: "#4ee0bc" },
};
const tickTime = (timestamp: number, hours: number) => new Date(timestamp).toLocaleString(undefined, hours > 24 ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

export default function StationHistory({ stations }: { stations: Station[] }) {
  const [stationId, setStationId] = useState(stations[0]?.station_id ?? "");
  const [hours, setHours] = useState(24);
  const [metric, setMetric] = useState<Metric>("temperature");
  const [rows, setRows] = useState<StationHistoryPoint[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectedId = stations.some(station => station.station_id === stationId) ? stationId : stations[0]?.station_id ?? "";

  useEffect(() => {
    if (!selectedId) return;
    let active = true, running = false;
    const controller = new AbortController();
    setRows([]); setTruncated(false); setError(""); setLoading(true);
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/history?station_id=${encodeURIComponent(selectedId)}&hours=${hours}&source=station-api`, { headers: { Accept: "application/json" }, signal: controller.signal });
        if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Unable to load submitted station history.");
        const data = await response.json();
        if (active) { setRows(normalizeStationHistory(data.readings, selectedId)); setTruncated(data.truncated === true); setError(""); }
      } catch (err) {
        if (active && !controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load submitted station history.");
      } finally { if (active) setLoading(false); running = false; }
    };
    void load(); const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [selectedId, hours]);

  const selected = metrics[metric];
  return <section className="station-history" aria-label="Submitted station history">
    <div className="station-history-head"><div><span className="directory-kicker">SUBMITTED STATION DATA</span><h3>Observation history</h3><p>Compare readings for one station. Lines connect available observations; gaps can occur.</p></div><Activity size={20} /></div>
    <div className="station-history-controls"><label>Station<select value={selectedId} onChange={event => setStationId(event.target.value)}>{stations.map(station => <option key={station.station_id} value={station.station_id}>{station.station_name} ({station.station_id})</option>)}</select></label><label>Measurement<select value={metric} onChange={event => setMetric(event.target.value as Metric)}>{(Object.keys(metrics) as Metric[]).map(key => <option key={key} value={key}>{metrics[key].label}</option>)}</select></label><label>Period<select value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></label></div>
    {error && <div className="quality-error" role="alert">{error}{rows.length ? " Showing previously loaded readings." : ""}</div>}
    {truncated && <p className="station-history-warning">Showing the latest 2,000 readings in this period; earlier readings are omitted.</p>}
    {loading ? <p className="station-history-empty">Loading station history…</p> : rows.length === 0 ? <p className="station-history-empty">No submitted readings are available for this station and period.</p> : <><div className="station-history-chart" role="img" aria-label={`${selected.label} in ${selected.unit}, based on ${rows.length} submitted readings`}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 18, bottom: 5, left: 0 }}><CartesianGrid stroke="#284151" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={rows.length === 1 ? [rows[0].timestamp - 60000, rows[0].timestamp + 60000] : ["dataMin", "dataMax"]} scale="time" tickFormatter={value => tickTime(Number(value), hours)} minTickGap={35} tick={{ fill: "#a3bdcc", fontSize: 10 }} tickLine={false} /><YAxis domain={["auto", "auto"]} width={52} tick={{ fill: "#a3bdcc", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip labelFormatter={value => new Date(Number(value)).toLocaleString()} formatter={(value: number) => [`${value.toFixed(1)} ${selected.unit}`, selected.label]} contentStyle={{ background: "#102334", border: "1px solid #38576b", borderRadius: 8, color: "#fff" }} /><Line type="linear" dataKey={metric} stroke={selected.color} strokeWidth={2} dot={rows.length <= 30 ? { r: 3 } : false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><p className="station-history-meta">{rows.length} submitted {rows.length === 1 ? "reading" : "readings"} · {selected.label} ({selected.unit}) · Times shown in your local time</p></>}
  </section>;
}
