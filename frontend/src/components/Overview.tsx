import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Droplets, Gauge, MapPin, Maximize2, Minus, Plus, Satellite, Thermometer, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { mapStationStatus } from "../lib/map-status";

type Station = { id: string; name: string; status: string; health: number; temp: string; humidity: string; pressure: string; latitude: number; longitude: number; region?: string; timestamp?: string; observation_stale?: boolean };
type Alert = { id: string; station: string; title: string; time: string; type: string; description: string };
type Reading = { time: string; timestamp: number; temperature: number; humidity: number; pressure: number };
type Props = { station: Station; stations: Station[]; mapStations?: Station[]; alerts: Alert[]; sourceStatus: "live" | "replay" | "connecting" | "stale"; historySource: "live" | "open-meteo" | "replay" | null; onViewAlerts: () => void; onViewStations: () => void; onSelectStation: (stationId: string) => void };
const ranges = [{ label: "15 min", hours: .25 }, { label: "1 h", hours: 1 }, { label: "6 h", hours: 6 }, { label: "24 h", hours: 24 }];

function Terrain({ station, stations, onSelectStation, onViewStations, sourceStatus, historySource }: { station: Station; stations: Station[]; onSelectStation: (stationId: string) => void; onViewStations: () => void; sourceStatus: Props["sourceStatus"]; historySource: Props["historySource"] }) {
  const [zoom, setZoom] = useState(4);
  const [layer, setLayer] = useState<"map" | "satellite">("map");
  const [status, setStatus] = useState("all");
  const [region, setRegion] = useState("all");
  const [size, setSize] = useState({ width: 600, height: 500 });
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mapRef.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);
  const n = 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, station.latitude)) * Math.PI / 180;
  const x = (station.longitude + 180) / 360 * n;
  const y = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * n;
  const minX = Math.floor(x - size.width / 512), maxX = Math.floor(x + size.width / 512);
  const minY = Math.max(0, Math.floor(y - size.height / 512)), maxY = Math.min(n - 1, Math.floor(y + size.height / 512));
  const tiles: Array<{ x: number; y: number }> = [];
  for (let tileY = minY; tileY <= maxY; tileY++) for (let tileX = minX; tileX <= maxX; tileX++) tiles.push({ x: tileX, y: tileY });
  const mapStatus = (item: Station) => mapStationStatus(item, sourceStatus);
  const filtered = stations.filter(item => (status === "all" || mapStatus(item) === status) && (region === "all" || item.region === region));
  const marker = (item: Station) => {
    const lat = Math.max(-85.05112878, Math.min(85.05112878, item.latitude)) * Math.PI / 180;
    const mx = (item.longitude + 180) / 360 * n, my = (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * n;
    return { left: size.width / 2 + (mx - x) * 256, top: size.height / 2 + (my - y) * 256 };
  };
  return <section className="ref-panel terrain-panel"><div className="ref-panel-head"><div className="ref-heading-icon"><Satellite size={25} /></div><div><h2>Station location</h2><p>Map and satellite imagery of the surrounding area</p></div><button className="terrain-expand" onClick={onViewStations} title="Open station network" aria-label="Open station network"><Maximize2 size={17} /></button></div><div className="terrain-filters"><label>Region<select value={region} onChange={event => setRegion(event.target.value)}><option value="all">All regions</option>{Array.from(new Set(stations.map(item => item.region).filter((item): item is string => !!item))).sort().map(item => <option key={item}>{item}</option>)}</select></label><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option>Healthy</option><option>Warning</option><option>Critical</option><option>Unavailable</option></select></label></div><div className={`terrain-map terrain-map-${layer}`} ref={mapRef} aria-label={`${layer === "map" ? "Map" : "Satellite view"} centered on ${station.name}`}><div className="terrain-map-tiles">{tiles.map((tile) => { const wrappedX = ((tile.x % n) + n) % n; const url = layer === "map" ? `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tile.y}.png` : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tile.y}/${wrappedX}`; return <img key={`${layer}-${zoom}-${tile.x}-${tile.y}`} src={url} alt="" draggable={false} style={{ left: `calc(50% + ${(tile.x - x) * 256}px)`, top: `calc(50% + ${(tile.y - y) * 256}px)` }} />; })}</div>{layer === "satellite" && <div className="terrain-shade" />}<div className="terrain-layer-control" role="group" aria-label="Map style"><button className={layer === "map" ? "active" : ""} onClick={() => setLayer("map")} aria-pressed={layer === "map"}>Map</button><button className={layer === "satellite" ? "active" : ""} onClick={() => setLayer("satellite")} aria-pressed={layer === "satellite"}>Satellite</button></div><div className="terrain-zoom" role="group" aria-label="Map zoom"><button onClick={() => setZoom((value) => Math.min(16, value + 1))} disabled={zoom >= 16} aria-label="Zoom in"><Plus size={17} /></button><button onClick={() => setZoom((value) => Math.max(3, value - 1))} disabled={zoom <= 3} aria-label="Zoom out"><Minus size={17} /></button></div>{filtered.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map(item => { const pos = marker(item); if (pos.left < 0 || pos.top < 0 || pos.left > size.width || pos.top > size.height) return null; const currentStatus = mapStatus(item); const tone = currentStatus === "Unavailable" ? "unknown" : currentStatus.toLowerCase(); return <button key={item.id} className={`terrain-station-marker ${tone} ${item.id === station.id ? "selected" : ""}`} style={{left:pos.left,top:pos.top}} onClick={() => onSelectStation(item.id)} aria-label={`${item.name}, ${currentStatus === "Unavailable" ? "source unavailable or stale" : currentStatus}`} title={`${item.name} · ${currentStatus}`}><span /></button>; })}<small className="map-credit">{layer === "map" ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> : <>Imagery © Esri</>}</small></div><div className="terrain-details"><strong>{station.name} · {station.id}</strong><span>Source: {historySource ?? "connecting"} · {mapStatus(station) === "Unavailable" ? "Unavailable or stale" : station.status}</span><span>Observation: {station.timestamp && Number.isFinite(Date.parse(station.timestamp)) ? new Date(station.timestamp).toLocaleString() : "Unavailable"}</span><div className="terrain-status-legend"><span><i className="healthy" />Healthy</span><span><i className="warning" />Warning</span><span><i className="critical" />Critical</span><span><i className="unknown" />Unavailable or stale</span></div><small>Map colors represent the selected dashboard source; they do not verify physical sensor health.</small></div></section>;
}

export default function Overview({ station, stations, mapStations = stations, alerts, sourceStatus, historySource, onViewAlerts, onViewStations, onSelectStation }: Props) {
  const [range, setRange] = useState(1);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  useEffect(() => {
    if (!historySource) { setReadings([]); return; }
    let active = true;
    const load = async () => {
      try {
        const endpoint = historySource === "open-meteo" ? `/api/weather-trends?station_id=${encodeURIComponent(station.id)}&hours=${range}` : `/api/history?station_id=${encodeURIComponent(station.id)}&hours=${Math.max(1, range)}&source=${historySource}`;
        const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("History unavailable");
        const data = await response.json();
        const end = historySource === "open-meteo" && range === .25 && Number.isFinite(Date.parse(data.range_end)) ? Date.parse(data.range_end) : Date.now();
        const cutoff = end - range * 3600000;
        const rows = Array.isArray(data.readings) ? data.readings.map((row: any) => ({ timestamp: Date.parse(row.timestamp ?? row.recorded_at), time: new Date(row.timestamp ?? row.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), temperature: Number(row.temperature), humidity: Number(row.humidity), pressure: Number(row.pressure) })).filter((row: Reading) => Number.isFinite(row.timestamp) && row.timestamp >= cutoff && Number.isFinite(row.temperature) && Number.isFinite(row.humidity) && Number.isFinite(row.pressure)).sort((a: Reading, b: Reading) => a.timestamp - b.timestamp) : [];
        if (active) { setReadings(rows); setRangeEnd(historySource === "open-meteo" && range === .25 && data.range_end ? end : null); setHistoryError(false); }
      } catch { if (active) { setReadings([]); setRangeEnd(null); setHistoryError(true); } }
    };
    setReadings([]); setRangeEnd(null); void load(); const timer = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [station.id, range, historySource]);
  const hasData = sourceStatus !== "connecting";
  const healthy = stations.filter((item) => item.status === "Healthy").length;
  const warning = stations.filter((item) => item.status === "Warning").length;
  const critical = stations.filter((item) => item.status === "Critical").length;
  const average = stations.length ? Math.round(stations.reduce((sum, item) => sum + item.health, 0) / stations.length) : 0;
  const metrics = useMemo(() => [
    { name: "Temperature", value: station.temp.replace(/°.*$/, ""), unit: "°C", icon: Thermometer, key: "temperature" as const, color: "#2ecbff" },
    { name: "Humidity", value: station.humidity.replace(/%.*/, ""), unit: "%", icon: Droplets, key: "humidity" as const, color: "#2ecbff" },
    { name: "Pressure", value: station.pressure, unit: "hPa", icon: Gauge, key: "pressure" as const, color: "#2ecbff" },
  ], [station]);
  const stationAlerts = alerts.filter((alert) => alert.station === station.id);
  return <div className="reference-overview">
    <div className="ref-metrics"><section className="ref-panel health-card"><div className="health-head"><Activity size={26} /><div><h2>Network status</h2><p>Model-based monitoring overview</p></div><span className={`operational ${sourceStatus === "stale" ? "stale" : ""}`}><i />{sourceStatus === "connecting" ? "Connecting" : sourceStatus === "stale" ? "Stale data" : "Monitoring"}</span></div><div className="health-body"><div className="health-ring" style={{ "--health": `${average * 3.6}deg` } as React.CSSProperties}><div><strong>{hasData ? `${average}%` : "—"}</strong><span>Average model index</span></div></div><div className="health-legend"><div><i className="healthy" /><span>Within threshold</span><b>{hasData ? healthy : "—"}</b></div><div><i className="degraded" /><span>Warning</span><b>{hasData ? warning : "—"}</b></div><div><i className="fault" /><span>Critical</span><b>{hasData ? critical : "—"}</b></div></div></div></section>
      {metrics.map(({ name, value, unit, icon: Icon, key, color }) => <section className="ref-panel reading-card" key={name}><div className="reading-title"><Icon size={25} /><h2>{name}</h2></div><div className="reading-value">{hasData && value || "—"}<span>{hasData && value && value !== "—" ? unit : ""}</span></div><div className="reading-subtitle">Latest reading</div><div className="sparkline">{readings.length > 0 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={readings}><Line dataKey={key} type="monotone" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <span>No history available yet</span>}</div></section>)}
    </div>
    <div className="ref-lower"><div className="ref-left"><section className="ref-panel chart-panel"><div className="ref-panel-head"><div className="ref-heading-icon"><TrendingUp size={25} /></div><div><h2>Weather trends</h2><p>{station.name} · {historySource === "open-meteo" ? "Open-Meteo estimates" : "Recorded observations"}{rangeEnd !== null ? ` · 15 min ending ${new Date(rangeEnd).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}</p></div><div className="ref-range" aria-label="History range">{ranges.map((item) => <button key={item.label} className={range === item.hours ? "active" : ""} onClick={() => setRange(item.hours)}>{item.label}</button>)}</div></div><div className="ref-chart">{readings.length > 0 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={readings} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}><CartesianGrid stroke="#26394a" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#bac8d5", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#526274" }} minTickGap={35} /><YAxis yAxisId="temperature" domain={["auto", "auto"]} width={44} tick={{ fill: "#bac8d5", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}°`} /><YAxis yAxisId="humidity" orientation="right" domain={["auto", "auto"]} width={40} tick={{ fill: "#b995ff", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} /><YAxis yAxisId="pressure" orientation="right" domain={["auto", "auto"]} width={48} tick={{ fill: "#54e6c0", fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: "#102234", border: "1px solid #38536b", borderRadius: 8, color: "#fff" }} /><Line yAxisId="temperature" type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#25c7ff" strokeWidth={2} dot={readings.length === 1} /><Line yAxisId="humidity" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#ad7aff" strokeWidth={2} dot={readings.length === 1} /><Line yAxisId="pressure" type="monotone" dataKey="pressure" name="Pressure (hPa)" stroke="#4be2b5" strokeWidth={2} dot={readings.length === 1} /></LineChart></ResponsiveContainer> : <div className="chart-empty"><Activity size={24} /><b>{historyError ? "Unable to load weather trends" : "No readings in this time range"}</b><span>{historyError ? "Check the connection and try again." : "Try a longer time range or wait for the next reading."}</span></div>}</div>{readings.length === 1 && <p className="freshness-note">One estimate is available for this interval. A trend line needs at least two readings.</p>}<div className="chart-legend"><span><i className="temp" />Temperature (°C)</span><span><i className="humidity" />Humidity (%)</span><span><i className="pressure" />Pressure (hPa)</span></div></section>
      <section className="ref-panel recent-panel"><div className="ref-panel-head"><div className="ref-heading-icon alert-icon"><AlertTriangle size={25} /></div><div><h2>Recent alerts</h2><p>Active anomalies for the selected station</p></div><button className="view-all" onClick={onViewAlerts}>View all <ArrowRight size={15} /></button></div><div className="recent-list">{stationAlerts.length ? stationAlerts.slice(0, 3).map((alert) => <button className="recent-row" key={alert.id} onClick={onViewAlerts}><AlertTriangle size={17} /><b>{alert.title}</b><span><MapPin size={14} />{station.name}</span><small>{alert.time}</small><em>Active</em></button>) : <div className="empty-alerts">{hasData ? "There are no active alerts for this station." : "Waiting for a connection to the weather data source."}</div>}</div></section></div><Terrain station={station} stations={mapStations} onSelectStation={onSelectStation} onViewStations={onViewStations} sourceStatus={sourceStatus} historySource={historySource} /></div>
  </div>;
}
