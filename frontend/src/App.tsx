import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudLightning,
  Database,
  Download,
  Gauge,
  Layers3,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Play,
  Radio,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Upload,
  UserRound,
  Wind,
  X,
  Zap,
} from "lucide-react";
import "./page-specific.css";
import Overview from "./components/Overview";
import DataQuality from "./components/DataQuality";
import StationMonitor from "./components/StationMonitor";
import NotificationSettings from "./components/NotificationSettings";
import DetectorEvaluation from "./components/DetectorEvaluation";
import HistoricalAnalytics from "./components/HistoricalAnalytics";
import DriftDemo from "./components/DriftReview";
import StationIncidents from "./components/StationIncidents";
import DatasetResults, { type DatasetReport } from "./components/DatasetResults";
import { AuthGate, UserManagement, type Account } from "./components/Auth";
import { describeWeatherSource, isUsableRealtimeResponse, weatherSourceBadge } from "./lib/realtime";
import { formatAnomalyScore } from "./lib/anomaly-score";
import { STATIONS } from "@shared/stations";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const temperatures = [
  { time: "09:10", value: 25.8, pressure: 1010.8, humidity: 68, anomaly: false },
  { time: "09:25", value: 26.1, pressure: 1010.6, humidity: 69, anomaly: false },
  { time: "09:40", value: 26.3, pressure: 1010.5, humidity: 70, anomaly: false },
  { time: "09:55", value: 26.2, pressure: 1010.4, humidity: 69, anomaly: false },
  { time: "10:10", value: 26.6, pressure: 1010.2, humidity: 70, anomaly: false },
  { time: "10:25", value: 27.1, pressure: 1009.9, humidity: 71, anomaly: false },
  { time: "10:40", value: 27.4, pressure: 1009.8, humidity: 71, anomaly: true },
  { time: "10:55", value: 27.2, pressure: 1009.7, humidity: 72, anomaly: false },
  { time: "11:10", value: 27.5, pressure: 1009.5, humidity: 72, anomaly: false },
];

const pressureSeries = temperatures.map((item) => ({ time: item.time, value: item.pressure }));
const humiditySeries = temperatures.map((item) => ({ time: item.time, value: item.humidity }));

const stations = STATIONS.map((item, index) => ({
  ...item,
  id: item.station_id,
  name: item.station_name,
  location: `${item.latitude.toFixed(2)}° N · ${item.longitude.toFixed(2)}° E`,
  status: index % 17 === 2 ? "Critical" : index % 11 === 1 ? "Warning" : "Healthy",
  health: index % 17 === 2 ? 64 : index % 11 === 1 ? 87 : 94 + (index % 6),
  temp: "—", pressure: "—", humidity: "—", color: index % 17 === 2 ? "red" : index % 11 === 1 ? "amber" : "green",
  mapX: 270, mapY: 185, deviations: { temperature: "—", humidity: "—", pressure: "—" }, affected: index % 17 === 2 ? ["temperature", "humidity"] : index % 11 === 1 ? ["temperature"] : [],
}));

type DetectorEvidence = { model_version: string; warning_threshold: number; critical_threshold: number; baseline_samples: number | null; baseline_center: {temperature:number;humidity:number;pressure:number} | null; previous: {timestamp:string;temperature:number;humidity:number;pressure:number} | null };
type Station = typeof stations[number] & {
  timestamp?: string;
  observation_stale?: boolean;
  detector_evidence?: DetectorEvidence;
  anomaly_score?: number | null;
  explanation?: string;
  suspected_cause?: string;
  recommended_action?: string;
  affected?: string[];
};
type Alert = { id: string; station: string; title: string; type: "CRITICAL" | "WARNING"; score: number | null; time: string; description: string; action: string; color: "red" | "amber"; source?: string | null; observedAt?: string; readings?: {temperature:string;humidity:string;pressure:string}; evidence?: DetectorEvidence };
type DetectorConfig = { warning_score: number; critical_score: number; regional_fraction: number };
const formatDeviation = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}σ` : "—";

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Stations", icon: Radio },
  { label: "Station feed", icon: Activity },
  { label: "Alerts", icon: AlertCircle },
  { label: "Analytics", icon: BarChart3 },
  { label: "Sensor health", icon: Gauge },
];

function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo-mark ${small ? "logo-mark-small" : ""}`} aria-label="SkyGuard AI">
      <span className="logo-orbit orbit-a" />
      <span className="logo-orbit orbit-b" />
      <span className="logo-core" />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "Healthy" ? "green" : status === "Warning" ? "amber" : "red";
  return <span className={`status-pill status-${color}`}><span className="status-dot" />{status}</span>;
}

function MetricCard({ icon: Icon, label, value, detail, accent, unit }: { icon: typeof Activity; label: string; value: string; detail: string; accent: string; unit?: string }) {
  return <div className="metric-card"><div className="metric-card-top"><span className={`metric-icon ${accent}`}><Icon size={20} strokeWidth={1.8} /></span><span className="metric-card-label">{label}</span></div><div className="metric-card-value">{value}<span>{value !== "—" && unit ? unit : ""}</span></div><div className="metric-card-detail">{detail}</div></div>;
}

function StationModel({ station, running }: { station: typeof stations[number]; running: boolean }) {
  const isCritical = station.color === "red";
  const affected = station.affected;
  const hasFault = affected.length > 0;
  return (
    <div className={`station-stage ${running ? "stage-running" : ""} ${hasFault ? "inspection-mode" : ""}`}>
      <div className="stage-grid" />
      <div className="compass compass-n">N</div><div className="compass compass-e">E</div><div className="compass compass-s">S</div><div className="compass compass-w">W</div>
      <div className="inspection-ribbon"><span className={hasFault ? "fault-live" : "fault-clear"}>{hasFault ? "SENSOR REVIEW" : "NO ANOMALIES INDICATED"}</span><small>{hasFault ? `${affected.length} affected component${affected.length > 1 ? "s" : ""}` : "baseline comparison active"}</small></div>
      <div className="station-scene" style={{ transform: `rotateX(57deg) rotateZ(-32deg) rotateY(${isCritical ? -7 : -13}deg)` }}>
        <div className="tower-shadow" />
        <div className="station-foot foot-a" /><div className="station-foot foot-b" /><div className="station-foot foot-c" />
        <div className="tower-frame frame-left" /><div className="tower-frame frame-right" /><div className="tower-frame frame-back" />
        <div className="tower-cross cross-one" /><div className="tower-cross cross-two" /><div className="tower-cross cross-three" />
        <div className={`sensor-box ${isCritical ? "sensor-critical" : ""}`}><span className="sensor-light" /><span className={`fault-pin pin-temperature ${affected.includes("temperature") ? "pin-active" : ""}`} /><span className={`fault-pin pin-pressure ${affected.includes("pressure") ? "pin-active" : ""}`} /></div>
        <div className="sensor-mast"><div className="mast-cap" /><span className={`fault-pin pin-humidity ${affected.includes("humidity") ? "pin-active" : ""}`} /></div>
        <div className={`sensor-arm arm-left ${affected.includes("pressure") ? "arm-affected" : ""}`}><span className="anemometer" /></div>
        <div className={`sensor-arm arm-right ${affected.includes("humidity") ? "arm-affected" : ""}`}><span className="rain-gauge" /></div>
        <div className={`wind-blade blade-one ${running ? "blade-spin" : ""}`} /><div className={`wind-blade blade-two ${running ? "blade-spin" : ""}`} /><div className={`wind-blade blade-three ${running ? "blade-spin" : ""}`} />
      </div>
      {affected.includes("temperature") && <div className="part-callout part-temperature"><span className="part-line" /><b>Temperature probe</b><small>{station.deviations.temperature} · review</small></div>}
      {affected.includes("humidity") && <div className="part-callout part-humidity"><span className="part-line" /><b>RH probe</b><small>{station.deviations.humidity} · review</small></div>}
      {affected.includes("pressure") && <div className="part-callout part-pressure"><span className="part-line" /><b>Pressure port</b><small>{station.deviations.pressure} · review</small></div>}
      {!hasFault && <div className="part-callout part-nominal"><span className="part-line" /><b>No affected components</b><small>Within learned baseline</small></div>}
      <div className="station-callout callout-top"><span className="callout-line" /><div><b>Wind + rain sensors</b><small>Current observations</small></div></div>
      <div className={`station-callout callout-right ${isCritical ? "callout-alert" : ""}`}><span className="callout-line" /><div><b>{isCritical ? "Potential anomaly" : "Station baseline"}</b><small>{isCritical ? "Review highlighted components" : "Within learned range"}</small></div></div>
      <div className="model-footer"><div><span className="live-dot" />STATION MODEL</div><span>Highlighted components indicate areas for review</span></div>
    </div>
  );
}


function projectIndiaPoint(latitude: number, longitude: number) {
  const x = 80 + ((longitude - 68) / 30) * 400;
  const y = 340 - ((latitude - 8) / 29) * 300;
  return { x: Math.max(70, Math.min(490, x)), y: Math.max(32, Math.min(345, y)) };
}

function IndiaNetworkMap({ stations, selectedStation, onSelect, sourceStatus, sourceLabel, lastSync, visualLayer, onLayerChange }: { stations: Station[]; selectedStation: Station; onSelect: (station: Station) => void; sourceStatus: "live" | "replay" | "connecting"; sourceLabel: string; lastSync: string; visualLayer: string; onLayerChange: (layer: string) => void }) {
  return <div className={`india-map-stage layer-${visualLayer.toLowerCase()}`}><div className="map-topline"><span><span className={`status-dot ${sourceStatus === "live" ? "status-dot-green" : sourceStatus === "connecting" ? "status-dot-amber" : "status-dot-blue"}`} /> {sourceStatus === "connecting" ? "CONNECTING TO WEATHER SOURCE" : `${sourceLabel} · LIVE`}</span><span>Network geometry · India</span><div className="layer-control"><small>VISUAL LAYER</small>{["Stations", "Temperature", "Humidity", "Pressure", "Anomalies"].map((layer) => <button key={layer} className={visualLayer === layer ? "active" : ""} onClick={() => onLayerChange(layer)}>{layer}</button>)}</div></div><div className="india-map-grid" /><svg className="india-map-svg" viewBox="0 0 560 370" role="img" aria-label="3D India weather station network map"><defs><linearGradient id="indiaLand" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#1e5a71" stopOpacity=".92" /><stop offset="100%" stopColor="#12283d" stopOpacity=".7" /></linearGradient><filter id="mapGlow"><feGaussianBlur stdDeviation="5" /></filter></defs><path className="india-shadow" d="M214 31 L275 46 310 76 346 93 371 128 402 142 393 178 416 207 399 247 375 269 369 308 341 343 313 329 294 360 270 340 251 304 223 284 213 249 185 223 171 183 187 150 169 120 182 88Z" /><path className="india-land" d="M214 31 L275 46 310 76 346 93 371 128 402 142 393 178 416 207 399 247 375 269 369 308 341 343 313 329 294 360 270 340 251 304 223 284 213 249 185 223 171 183 187 150 169 120 182 88Z" /><path className="india-coast" d="M214 31 L275 46 310 76 346 93 371 128 402 142 393 178 416 207 399 247 375 269 369 308 341 343 313 329 294 360 270 340 251 304 223 284 213 249 185 223 171 183 187 150 169 120 182 88Z" /><path className="route-line" d="M270 249 C251 232 249 226 278 229 C287 214 284 201 305 180" /><path className="route-line route-secondary" d="M263 239 C252 235 260 226 278 229" />{stations.map((station) => { const point = projectIndiaPoint(station.latitude, station.longitude); return <g key={station.id} className="map-station" onClick={() => onSelect(station)} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelect(station)}><circle cx={point.x} cy={point.y} r={station.id === selectedStation.id ? 15 : 5.5} className={`station-halo ${station.color}`} /><circle cx={point.x} cy={point.y} r={station.id === selectedStation.id ? 7 : 2.7} className={`station-node ${station.color}`} /><text x={point.x + 8} y={point.y - 7} className={`station-label ${station.id === selectedStation.id ? "selected" : "station-label-hidden"}`}>{station.id}</text></g>; })}</svg><div className="map-legend"><span><i className="green" />Healthy {stations.filter((station) => station.status === "Healthy").length}</span><span><i className="amber" />Warning {stations.filter((station) => station.status === "Warning").length}</span><span><i className="red" />Anomaly {stations.filter((station) => station.status === "Critical").length}</span></div><div className="map-footer"><span><b>{stations.length.toString().padStart(2, "0")}</b> stations</span><span><b>{stations.filter((station) => station.status === "Healthy").length.toString().padStart(2, "0")}</b> healthy</span><span><b>{stations.filter((station) => station.status === "Critical").length.toString().padStart(2, "0")}</b> critical</span><span><b>{lastSync}</b> last sync</span></div></div>;
}

function ExplainabilityPanel({ station }: { station: Station }) {
  const width = (value: string) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? `${Math.min(100, Math.abs(number) / 4 * 100)}%` : "0%"; };
  const rows = [{ label: "Temperature", value: station.deviations.temperature, width: width(station.deviations.temperature), color: "red" }, { label: "Humidity", value: station.deviations.humidity, width: width(station.deviations.humidity), color: "blue" }, { label: "Pressure", value: station.deviations.pressure, width: width(station.deviations.pressure), color: "amber" }];
  return <div className="xai-panel"><div className="xai-heading"><div><span className="eyebrow">Selected station</span><h3>{station.id}</h3><span>{station.name} · {station.location}</span></div><StatusPill status={station.status} /></div><div className="xai-confidence"><div className={`xai-status ${station.color}`}><AlertCircle size={16} />{station.status === "Critical" ? "Anomaly detected" : station.status === "Warning" ? "Review recommended" : "Within baseline"}</div><div className="confidence-number"><strong>{formatAnomalyScore(station.anomaly_score)}</strong><small>anomaly score</small></div></div><h4>Why was this station flagged?</h4><div className="deviation-list">{rows.map((row) => <div className="deviation-row" key={row.label}><div><span>{row.label}</span><b>{row.value}</b></div><span className="deviation-track"><i className={row.color} style={{ width: row.width }} /></span></div>)}</div><div className="xai-explanation"><span className="eyebrow">AI explanation</span><p>{station.explanation ?? (station.status === "Critical" ? "An observation was flagged. Review the readings and independent evidence before determining the cause." : station.status === "Warning" ? "A deviation was flagged; compare the reading with relevant reference data." : "No anomaly was flagged for the latest reading. This does not confirm sensor condition.")}</p></div><div className="xai-evidence"><span><b>Suspected cause</b><small>{station.suspected_cause ?? "Cause not determined"}</small></span><span><b>Recommended action</b><small>{station.recommended_action ?? (station.status === "Critical" ? "Inspect temperature and humidity sensors; verify against nearby AWS observations." : station.status === "Warning" ? "Schedule calibration review within the next maintenance window." : "Continue monitoring; no action required.")}</small></span></div></div>;
}


function InstrumentStrip({ sourceStatus, sourceLabel, simulation, stationCount, healthyCount, warningCount, anomalyCount }: { sourceStatus: "live" | "replay" | "connecting"; sourceLabel: string; simulation: boolean; stationCount: number; healthyCount: number; warningCount: number; anomalyCount: number }) {
  return <div className="instrument-strip"><div className="strip-label"><span className="eyebrow">Mission status</span><b>SKYGUARD / WEATHER DATA YOU CAN TRUST</b></div><div className="strip-stat"><strong>{String(stationCount).padStart(2, "0")}</strong><span>STATIONS</span></div><div className="strip-stat"><strong>{String(healthyCount + warningCount + anomalyCount).padStart(2, "0")}</strong><span>ONLINE</span></div><div className="strip-stat warning"><strong>{String(warningCount).padStart(2, "0")}</strong><span>WARNING</span></div><div className="strip-stat anomaly"><strong>{String(anomalyCount).padStart(2, "0")}</strong><span>ANOMALIES</span></div><div className="strip-state"><span className={`status-dot ${sourceStatus === "live" ? "status-dot-green" : sourceStatus === "connecting" ? "status-dot-amber" : "status-dot-blue"}`} /><span>{sourceStatus === "connecting" ? "CONNECTING TO WEATHER SOURCE" : `${sourceLabel} · CONNECTED`}</span></div></div>;
}

function WeatherEventBanner({ event }: { event: { classification: string; label: string; confidence: null; evidence: string; affected_stations: string[] } }) {
  const tone = event.classification === "regional_weather" ? "regional" : event.classification === "localized_anomaly" ? "sensor" : "mixed";
  return <div className={`weather-event-banner ${tone}`}><div><span className="eyebrow">Network weather-event detector</span><strong>{event.label}</strong><p>{event.evidence}</p></div><div className="event-confidence"><b>{event.affected_stations.length}</b><span>stations flagged</span><small>{event.affected_stations.length ? `${event.affected_stations.length} stations affected` : "No broad event"}</small></div></div>;
}

function ForensicReport({ station, onInvestigate }: { station: Station; onInvestigate: () => void }) {
  const critical = station.color === "red";
  return <section className="forensic-panel"><div className="forensic-head"><div><span className="eyebrow">Forensic station report</span><h2>Why SkyGuard flagged this</h2><p>{station.id} · {station.name} · {station.location}</p></div><span className={`forensic-verdict ${critical ? "anomaly" : station.color === "amber" ? "warning" : "normal"}`}>{critical ? "ANOMALY - REVIEW" : station.color === "amber" ? "REVIEW REQUIRED" : "NORMAL BASELINE"}</span></div><div className="forensic-grid"><div className="forensic-chain"><div className="chain-step"><b>01</b><span>Normal baseline</span><small>Recent reference observations</small></div><div className="chain-arrow">↓</div><div className="chain-step"><b>02</b><span>{critical ? "Temperature baseline deviation" : "Signal moved outside baseline"}</span><small>{station.deviations.temperature} temperature deviation</small></div><div className="chain-arrow">↓</div><div className="chain-step"><b>03</b><span>{critical ? "Humidity baseline deviation" : "Cross-variable evidence reviewed"}</span><small>{station.deviations.humidity} relative humidity</small></div><div className="chain-arrow">↓</div><div className="chain-step"><b>04</b><span>{critical ? "Pressure baseline deviation" : "Pressure baseline reviewed"}</span><small>{station.deviations.pressure} pressure deviation</small></div></div><div className="forensic-assessment"><span className="eyebrow">AI assessment</span><strong>{critical ? "Investigation recommended" : station.color === "amber" ? "Review recommended" : "No anomaly flagged"}</strong><div className="assessment-confidence"><span>Anomaly score (0-1)</span><b>{formatAnomalyScore(station.anomaly_score)}</b></div><p>{station.explanation ?? (critical ? "An unusual reading was flagged. Review independent observations and station records before determining its cause." : station.color === "amber" ? "Pattern needs operator review before escalation. Evidence is not yet strong enough to call a sensor failure." : "No anomaly was flagged; sensor condition has not been verified.")}</p><button className="forensic-action" onClick={onInvestigate}>Open station investigation <ChevronRight size={14} /></button></div></div></section>;
}

function TelemetryChart({ mode, running }: { mode: "temperature" | "pressure" | "humidity"; running: boolean }) {
  const config = {
    temperature: { data: temperatures, color: "#e28a52", value: "27.4°", unit: "°C", label: "Temperature", min: 24, max: 30 },
    pressure: { data: pressureSeries, color: "#9c9b91", value: "1009.8", unit: "hPa", label: "Pressure", min: 1004, max: 1013 },
    humidity: { data: humiditySeries, color: "#61e7c1", value: "71", unit: "%", label: "Humidity", min: 60, max: 85 },
  }[mode];
  const data = running && mode === "temperature" ? [...config.data.slice(0, -1), { ...config.data[config.data.length - 1], value: 31.8, anomaly: true }] : config.data;
  return (
    <div className="telemetry-card">
      <div className="telemetry-head"><div><span className="eyebrow">{config.label}</span><strong>{config.value}<em>{config.unit}</em></strong></div><span className="telemetry-delta">{mode === "temperature" ? "+0.8°" : mode === "pressure" ? "−1.3" : "+2%"}<small>vs baseline</small></span></div>
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="2 5" stroke="#223047" vertical={false} />
        <XAxis dataKey="time" stroke="#63718a" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} interval={2} />
        <YAxis domain={[config.min, config.max]} stroke="#63718a" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
        <Tooltip contentStyle={{ background: "#111b2b", border: "1px solid #263750", borderRadius: 10, color: "#f4f7fb", fontSize: 11 }} />
        <Line type="monotone" dataKey="value" stroke={config.color} strokeWidth={2.3} dot={(props: any) => props.payload.anomaly ? <circle key={`anomaly-dot-${props.index}`} cx={props.cx} cy={props.cy} r={5} fill="#ff6577" stroke="#ffb5bd" strokeWidth={2} /> : <circle key={`normal-dot-${props.index}`} cx={props.cx} cy={props.cy} r={2.3} fill={config.color} />} activeDot={{ r: 4 }} />
      </LineChart></ResponsiveContainer></div>
      <div className="chart-foot"><span><i className="legend-line" style={{ background: config.color }} />learned baseline</span>{mode === "temperature" && <span><i className="legend-anomaly" />fault injection</span>}<span>last 2 hours</span></div>
    </div>
  );
}


function LandingNetworkHero({ stations }: { stations: Station[] }) {
  return <div className="landing-network-hero"><div className="landing-network-head"><span><span className="status-dot status-dot-green" /> REAL-TIME AWS INTELLIGENCE NETWORK</span><b>INDIA / {stations.length.toString().padStart(2, "0")} STATIONS</b></div><div className="landing-map-grid" /><svg className="landing-india-map" viewBox="0 0 560 370" role="img" aria-label="India weather station network"><defs><linearGradient id="heroIndia" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#30382d" /><stop offset="100%" stopColor="#151a16" /></linearGradient><filter id="heroGlow"><feGaussianBlur stdDeviation="4" /></filter></defs><path className="hero-land-shadow" d="M214 31 L275 46 310 76 346 93 371 128 402 142 393 178 416 207 399 247 375 269 369 308 341 343 313 329 294 360 270 340 251 304 223 284 213 249 185 223 171 183 187 150 169 120 182 88Z" /><path className="hero-land" d="M214 31 L275 46 310 76 346 93 371 128 402 142 393 178 416 207 399 247 375 269 369 308 341 343 313 329 294 360 270 340 251 304 223 284 213 249 185 223 171 183 187 150 169 120 182 88Z" /><path className="hero-contour contour-a" d="M172 167 C228 115 315 132 397 190 S375 290 302 330" /><path className="hero-contour contour-b" d="M195 104 C281 86 359 116 401 168 S348 272 247 286" /><path className="hero-contour contour-c" d="M187 212 C250 166 337 183 395 235" /><path className="hero-route" d="M263 239 C251 231 257 226 278 229 C286 213 288 196 306 180" />{stations.map((station) => <g key={station.id} className={`hero-tower ${station.color}`} transform={`translate(${projectIndiaPoint(station.latitude, station.longitude).x - 270}, ${projectIndiaPoint(station.latitude, station.longitude).y - 185})`}><circle className="hero-node-pulse" cx="270" cy="185" r={station.color === "red" ? 18 : 10} /><circle className="hero-node" cx="270" cy="185" r="4" /><path d="M270 181 L270 166 M261 171 L279 171 M270 181 L263 190 M270 181 L277 190" className="tower-glyph" /><text x="282" y="181" className="hero-station-label">{station.id}</text></g>)}</svg><div className="landing-network-callout"><span className="status-dot status-dot-red" /><div><b>AWS-003 / PALAKKAD EAST</b><small>localized anomaly · 3 sensor deviations</small></div></div><div className="landing-network-footer"><span><b>{stations.length.toString().padStart(2, "0")}</b> stations</span><span><b>{stations.filter((station) => station.status === "Healthy").length.toString().padStart(2, "0")}</b> healthy</span><span><b>{stations.filter((station) => station.status === "Critical").length.toString().padStart(2, "0")}</b> anomaly</span><span><b>Prototype</b> anomaly monitoring</span></div></div>;
}

function Landing({ onOpen, onAnalyze }: { onOpen: () => void; onAnalyze: () => void }) {
  return (
    <div className="landing-page">
      <header className="landing-nav"><div className="brand-lockup"><LogoMark /><div><strong>SKYGUARD<span>AI</span></strong><small>weather intelligence</small></div></div><div className="landing-nav-links"><a href="#why">Why SkyGuard</a><a href="#workflow">How it works</a><button className="nav-signin" onClick={onOpen}>Operator sign in <ChevronRight size={15} /></button></div></header>
      <main className="landing-main"><div className="hero-copy"><div className="kicker"><span className="pulse-ring" />SIH 2026 · AWS anomaly intelligence</div><h1>WEATHER DATA <span>YOU CAN TRUST.</span></h1><p>Real-time intelligence for automatic weather stations. Investigate changes, separate regional weather events from sensor faults, and act on evidence.</p><div className="hero-actions"><button className="primary-button" onClick={onOpen}><span>Access monitoring dashboard</span><ChevronRight size={17} /></button><button className="ghost-button" onClick={onAnalyze}><Upload size={16} /> Analyze dataset</button></div><div className="hero-note"><ShieldCheck size={16} />Prototype environment · synthetic telemetry clearly labeled</div></div><div className="hero-visual"><LandingNetworkHero stations={stations} /><div className="hero-label label-left"><span>01</span><b>Network context</b><small>Illustrative station locations</small></div><div className="hero-label label-right"><span>02</span><b>Localized anomaly</b><small>Nearby stations remain stable</small></div></div></main><section id="why" className="landing-features"><div className="section-intro"><span className="eyebrow">A clearer signal in the noise</span><h2>From raw readings to a decision you can defend.</h2></div><div className="feature-row"><div className="feature-card"><div className="feature-number">01</div><Sparkles size={21} /><h3>AI anomaly detection</h3><p>Station-specific temporal baselines catch spikes, drift, frozen values, and multivariate inconsistencies.</p></div><div className="feature-card feature-active"><div className="feature-number">02</div><CloudLightning size={21} /><h3>Explainable alerts</h3><p>Alerts show an anomaly score and suggest observations to review.</p></div><div className="feature-card"><div className="feature-number">03</div><Gauge size={21} /><h3>Sensor health</h3><p>Monitor station health and prioritize equipment inspections across your network.</p></div></div></section><footer className="landing-footer"><span>SKYGUARD AI / 2026 PROTOTYPE</span><span>Built for intelligent weather operations</span></footer></div>
  );
}


function StationsPage({ stations, selectedStation, onSelect, onRun }: { stations: Station[]; selectedStation: Station; onSelect: (station: Station) => void; onRun: () => void }) {
  const [stateFilter, setStateFilter] = useState("All states");
  const [regionFilter, setRegionFilter] = useState("All regions");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = search.trim().toLowerCase();
  const filteredStations = stations.filter((station) =>
    (stateFilter === "All states" || station.state === stateFilter) &&
    (regionFilter === "All regions" || station.region === regionFilter) &&
    (statusFilter === "All statuses" || station.status === statusFilter) &&
    (!query || [station.id, station.name, station.state, station.region].some((value) => value.toLowerCase().includes(query)))
  );
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredStations.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const firstIndex = currentPage * pageSize;
  const visibleStations = filteredStations.slice(firstIndex, firstIndex + pageSize);
  return <div className="workspace-page station-workspace">
    <div className="page-hero panel"><div><span className="eyebrow">Station directory</span><h2>Weather stations</h2><p>Browse the station network, compare the latest readings, and inspect individual stations.</p></div><button className="primary-button" onClick={onRun}><Play size={15} fill="currentColor" /> Run simulation</button></div>
    <div className="station-filter-bar"><label>State<select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); setPage(0); }}><option>All states</option>{Array.from(new Set(stations.map((station) => station.state))).sort().map((state) => <option key={state}>{state}</option>)}</select></label><label>Region<select value={regionFilter} onChange={(event) => { setRegionFilter(event.target.value); setPage(0); }}><option>All regions</option>{Array.from(new Set(stations.map((station) => station.region))).sort().map((region) => <option key={region}>{region}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }}><option>All statuses</option><option>Healthy</option><option>Warning</option><option>Critical</option></select></label><span className="filter-result">{filteredStations.length} of {stations.length} stations</span></div>
    <div className="station-detail-grid"><section className="panel station-directory" aria-label="Station directory">
      <div className="directory-heading"><div><span className="directory-kicker">STATION NETWORK <span> / </span> DIRECTORY</span><h2>All stations <span className="directory-count">{filteredStations.length}</span></h2><p>Select a station to review its health and latest readings.</p></div><div className="directory-network"><span className="directory-network-dot" />{stations.length} registered</div></div>
      <div className="directory-tools"><label className="directory-search"><Search size={16} /><span className="sr-only">Search stations</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search by station, ID or location" /></label><span className="directory-results">{filteredStations.length} {filteredStations.length === 1 ? "station" : "stations"} found</span></div>
      <div className="directory-columns" aria-hidden="true"><span>Station</span><span>Location</span><span>Status</span><span>Health</span><span /></div>
      <div className="directory-list">{visibleStations.length ? visibleStations.map((station) => <button key={station.id} className={`directory-row ${selectedStation.id === station.id ? "selected" : ""}`} onClick={() => onSelect(station)} aria-pressed={selectedStation.id === station.id}><span className="directory-identity"><span className={`directory-station-icon ${station.color}`}><Radio size={18} /></span><span className="directory-name"><strong>{station.name}</strong><small>{station.id}</small></span></span><span className="directory-location"><strong>{station.state}</strong><small>{station.region} region</small></span><span className={`directory-status ${station.color}`}><i />{station.status}</span><span className="directory-health"><span><strong>{station.health}%</strong><small>health</small></span><i><b className={station.color} style={{ width: `${Math.max(0, Math.min(100, station.health))}%` }} /></i></span><ChevronRight size={17} className="directory-arrow" /></button>) : <div className="directory-empty"><Search size={21} /><strong>No stations found</strong><span>Try a different search or adjust your filters.</span></div>}</div>
      <div className="directory-footer"><span>{filteredStations.length ? `Showing ${firstIndex + 1}–${Math.min(firstIndex + pageSize, filteredStations.length)} of ${filteredStations.length}` : "No results"}</span><div className="directory-pagination"><button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} aria-label="Previous page"><ChevronRight size={16} className="directory-previous" /></button><span>Page <strong>{currentPage + 1}</strong> of {pageCount}</span><button onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
    </section><section className="panel station-focus"><div className="panel-header"><div><span className="eyebrow">Selected station</span><h2>{selectedStation.id} <span className="muted-title">/ {selectedStation.name}</span></h2></div><StatusPill status={selectedStation.status} /></div><StationModel station={selectedStation} running={false} /></section></div>
    <div className="station-stat-grid"><MetricCard icon={Thermometer} label="Temperature" value={selectedStation.temp.replace(/°.*$/, "")} unit="°C" detail="Latest station reading" accent="blue" /><MetricCard icon={Gauge} label="Pressure" value={selectedStation.pressure} unit="hPa" detail="Latest station reading" accent="blue" /><MetricCard icon={Activity} label="Humidity" value={selectedStation.humidity.replace(/%.*/, "")} unit="%" detail="Relative humidity" accent="green" /></div>
  </div>;
}

function DashboardAlertEvidence({ alert }: { alert: Alert }) {
  const evidence = alert.evidence;
  const previous = evidence?.previous;
  const center = evidence?.baseline_center;
  const number = (value: unknown, unit: string) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "Not recorded";
  return <details className="incident-evidence"><summary>View observation evidence</summary><dl>
    <div><dt>Source</dt><dd>{alert.source ?? "Not recorded"}</dd></div><div><dt>Observation</dt><dd>{alert.observedAt && Number.isFinite(Date.parse(alert.observedAt)) ? new Date(alert.observedAt).toLocaleString() : "Not recorded"}</dd></div>
    <div><dt>Latest readings</dt><dd>{alert.readings ? `${alert.readings.temperature}C · ${alert.readings.humidity} · ${alert.readings.pressure} hPa` : "Not recorded"}</dd></div>
    <div><dt>Baseline centers</dt><dd>{center ? `${number(center.temperature,"°C")} · ${number(center.humidity,"%")} · ${number(center.pressure,"hPa")}` : "Not recorded"}</dd></div>
    <div><dt>Previous reading</dt><dd>{previous ? `${new Date(previous.timestamp).toLocaleString()} · ${number(previous.temperature,"°C")} · ${number(previous.humidity,"%")} · ${number(previous.pressure,"hPa")}` : "Not recorded"}</dd></div>
    <div><dt>Detector</dt><dd>{evidence?.model_version ?? "Not recorded"}{typeof evidence?.baseline_samples === "number" ? ` · ${evidence.baseline_samples} baseline readings` : ""}</dd></div>
    <div><dt>Score thresholds</dt><dd>{evidence ? `Warning ${evidence.warning_threshold}; critical ${evidence.critical_threshold}` : "Not recorded"}</dd></div>
  </dl><p>Evidence is associated with the displayed observation. An unusual reading does not confirm a sensor fault.</p></details>;
}

function AlertsPage({ alerts, selectedAlert, onSelect }: { alerts: Alert[]; selectedAlert: Alert; onSelect: (alert: Alert) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = query.trim().toLowerCase();
  const filtered = alerts.filter((alert) => !search || [alert.title, alert.station, alert.type].some((value) => value.toLowerCase().includes(search)));
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const critical = alerts.filter((alert) => alert.type === "CRITICAL").length;
  const warning = alerts.filter((alert) => alert.type === "WARNING").length;
  return <div className="workspace-page alerts-workspace">
    <div className="page-hero panel"><div><span className="eyebrow">Anomaly monitoring</span><h2>Anomaly alerts</h2><p>Review unusual observations and prioritize the stations that need attention.</p></div><div className="alert-summary"><strong>{alerts.length}</strong><span>active alerts</span></div></div>
    <div className="alert-overview-strip"><span><i className="critical" /> <b>{critical}</b> critical</span><span><i className="warning" /> <b>{warning}</b> warnings</span><span>Across the station network</span></div>
    <div className="alerts-layout"><section className="panel alert-center-list"><div className="alert-section-heading"><div><span className="directory-kicker">MONITORING / ALERT QUEUE</span><h2>Active alerts <span className="directory-count">{filtered.length}</span></h2><p>Select an alert to review its details.</p></div></div><div className="alert-search-wrap"><label className="directory-search"><Search size={16} /><span className="sr-only">Search alerts</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search by station, alert or severity" /></label></div>
      <div className="alert-list">{visible.length ? visible.map((alert) => <button key={alert.id} className={`alert-row ${selectedAlert.id === alert.id ? "selected" : ""}`} onClick={() => onSelect(alert)} aria-pressed={selectedAlert.id === alert.id}><span className={`alert-severity ${alert.color}`}>{alert.type === "CRITICAL" ? <AlertCircle size={18} /> : <AlertCircle size={18} />}</span><span className="alert-copy"><b>{alert.title}</b><small>{alert.station} <span>·</span> {alert.time}</small></span><span className="alert-confidence"><strong>{formatAnomalyScore(alert.score)}</strong><small>anomaly score</small></span><ChevronRight size={16} className="row-arrow" /></button>) : <div className="directory-empty"><Search size={21} /><strong>No matching alerts</strong><span>Try a different search.</span></div>}</div>
      <div className="directory-footer"><span>{filtered.length ? `Showing ${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}` : "No results"}</span><div className="directory-pagination"><button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} aria-label="Previous alert page"><ChevronRight size={16} className="directory-previous" /></button><span>Page <strong>{currentPage + 1}</strong> of {pages}</span><button onClick={() => setPage(Math.min(pages - 1, currentPage + 1))} disabled={currentPage >= pages - 1} aria-label="Next alert page"><ChevronRight size={16} /></button></div></div>
    </section><section className="panel alert-detail-card"><div className="alert-detail-head"><div><span className="directory-kicker">SELECTED ALERT</span><h2>{selectedAlert.title}</h2><p>{selectedAlert.station} <span>·</span> {selectedAlert.time}</p></div><span className={`severity-tag ${selectedAlert.color}`}>{selectedAlert.type}</span></div><div className="alert-detail-body"><div className="alert-confidence-panel"><div className="alert-confidence-copy"><span>Anomaly score</span><strong>{formatAnomalyScore(selectedAlert.score)}</strong><small>Model indicator, not a probability of sensor failure</small></div><div className="score-ring" style={{ "--score": `${(selectedAlert.score ?? 0) * 360}deg` } as React.CSSProperties}><div><Activity size={19} /></div></div></div><div className="alert-explanation"><h3>Assessment</h3><p>{selectedAlert.description}</p></div><DashboardAlertEvidence alert={selectedAlert} /><div className="recommendation"><span><ShieldCheck size={18} /></span><div><small>RECOMMENDED ACTION</small><b>{selectedAlert.action}</b></div></div><div className="alert-detail-note"><CircleHelp size={15} /> An alert identifies an unusual observation and should be verified before diagnosing a fault.</div></div></section></div>
  </div>;
}

type HumidityReading = { timestamp: number; humidity: number };

function AnalyticsPage({ history, station, hours, onHoursChange }: { history: HumidityReading[]; station: Station; hours: number; onHoursChange: (hours: number) => void }) {
  const latest = history.at(-1);
  const average = history.length ? history.reduce((sum, row) => sum + row.humidity, 0) / history.length : null;
  const minimum = history.length ? Math.min(...history.map((row) => row.humidity)) : null;
  const maximum = history.length ? Math.max(...history.map((row) => row.humidity)) : null;
  const span = history.length > 1 ? history[history.length - 1].timestamp - history[0].timestamp : 0;
  const formatTick = (value: number) => new Date(value).toLocaleString([], span > 86400000 ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : span < 120000 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  const formatTime = (value: number) => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const percentage = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`;
  return <div className="workspace-page analytics-workspace station-analytics">
    <div className="page-hero panel analytics-hero"><div><span className="eyebrow">Station performance / historical data</span><h2>Station analytics</h2><p>Explore recorded humidity observations for the selected weather station.</p></div><div className="analytics-station-badge"><span><Radio size={17} /></span><div><small>SELECTED STATION</small><strong>{station.name}</strong><em>{station.id}</em></div></div></div>
    <HistoricalAnalytics />
    <DetectorEvaluation />
    <DriftDemo />
    <div className="analytics-summary-grid"><div className="analytics-summary-card"><div className="analytics-summary-top"><span className="analytics-summary-icon blue"><Database size={19} /></span><span>Recorded observations</span></div><strong>{history.length}</strong><small>{history.length === 120 ? "Most recent 120 readings" : "In the selected time period"}</small></div><div className="analytics-summary-card"><div className="analytics-summary-top"><span className="analytics-summary-icon cyan"><Activity size={19} /></span><span>Average humidity</span></div><strong>{percentage(average)}</strong><small>Average of recorded readings</small></div><div className="analytics-summary-card"><div className="analytics-summary-top"><span className="analytics-summary-icon violet"><Gauge size={19} /></span><span>Latest recorded humidity</span></div><strong>{percentage(latest?.humidity)}</strong><small>{latest ? formatTime(latest.timestamp) : "No readings available"}</small></div></div>
    <div className="analytics-main-grid"><section className="panel analytics-trend-panel"><div className="analytics-panel-heading"><div><span className="directory-kicker">HUMIDITY / OBSERVATIONS</span><h2>Humidity over time</h2><p>Recorded observations for {station.name}</p></div><div className="history-range-picker" aria-label="Observation period">{[24, 72, 168].map((item) => <button key={item} className={hours === item ? "active" : ""} onClick={() => onHoursChange(item)} aria-pressed={hours === item}>{item === 24 ? "24 hours" : item === 72 ? "3 days" : "7 days"}</button>)}</div></div><div className="analytics-chart-meta"><span><i />Relative humidity</span><small>Recorded time · %</small></div><div className="analytics-trend-chart">{history.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ top: 12, right: 18, bottom: 3, left: 0 }}><defs><linearGradient id="stationHumidityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2abef5" stopOpacity={.28} /><stop offset="100%" stopColor="#2abef5" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#263f50" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatTick} stroke="#91aaba" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={55} tickCount={5} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={43} stroke="#91aaba" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={(value) => formatTime(Number(value))} formatter={(value: number) => [`${value.toFixed(1)}%`, "Humidity"]} contentStyle={{ background: "#102536", border: "1px solid #36586d", borderRadius: 9, color: "#f4f9fc", fontSize: 12 }} /><Area type="monotone" dataKey="humidity" stroke="#36c6f9" fill="url(#stationHumidityFill)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <div className="analytics-chart-empty"><Activity size={22} /><strong>{history.length ? "Waiting for another observation" : "No observations available"}</strong><span>{history.length ? "The trend will appear after at least two readings are recorded." : "Try another period or choose a station with recorded readings."}</span></div>}</div><div className="analytics-chart-footer"><span>Showing {history.length} {history.length === 1 ? "observation" : "observations"}</span><span>Times shown in your local time zone</span></div></section>
    <section className="panel analytics-insights"><div className="analytics-insights-head"><span className="directory-kicker">SELECTED PERIOD</span><h2>Reading summary</h2><p>A closer look at the recorded values.</p></div><div className="analytics-insight-list"><div><span>Lowest humidity</span><strong>{percentage(minimum)}</strong></div><div><span>Highest humidity</span><strong>{percentage(maximum)}</strong></div><div><span>Average humidity</span><strong>{percentage(average)}</strong></div><div><span>Last recorded</span><strong>{latest ? formatTime(latest.timestamp) : "—"}</strong></div></div><div className="analytics-insight-note"><CircleHelp size={16} /><span>Values reflect stored readings for this station and the selected period{history.length === 120 ? ", limited to the most recent 120 observations" : ""}.</span></div></section></div>
  </div>;
}

function HealthPage({ stations, sourceStatus }: { stations: Station[]; sourceStatus: "live" | "replay" | "connecting" | "stale" }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [page, setPage] = useState(0);
  const hasData = sourceStatus !== "connecting";
  const available = hasData ? stations : [];
  const healthy = available.filter((station) => station.status === "Healthy").length;
  const warning = available.filter((station) => station.status === "Warning").length;
  const critical = available.filter((station) => station.status === "Critical").length;
  const average = available.length ? available.reduce((sum, station) => sum + station.health, 0) / available.length : 0;
  const search = query.trim().toLowerCase();
  const filtered = available.filter((station) => (status === "All statuses" || station.status === status) && (!search || [station.id, station.name, station.state].some((value) => value.toLowerCase().includes(search)))).sort((a, b) => a.health - b.health || a.name.localeCompare(b.name));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const firstIndex = currentPage * pageSize;
  const visible = filtered.slice(firstIndex, firstIndex + pageSize);
  const count = (value: number) => hasData ? value : "—";
  return <div className="workspace-page health-workspace">
    <div className="page-hero panel health-hero"><div><span className="eyebrow">Station health overview</span><h2>Sensor health</h2><p>Monitor station condition and prioritize equipment that may need inspection.</p></div><span className="health-hero-badge"><Activity size={16} /> {sourceStatus === "stale" ? "Stale source data" : hasData ? "Network monitoring" : "Connecting to source"}</span></div>
    <div className="health-summary-grid"><div className="health-summary-card"><span className="health-summary-icon blue"><Gauge size={19} /></span><div><span>Average health</span><strong>{hasData && available.length ? `${average.toFixed(1)}%` : "—"}</strong><small>Across monitored stations</small></div></div><div className="health-summary-card"><span className="health-summary-icon green"><Check size={19} /></span><div><span>Healthy</span><strong>{count(healthy)}</strong><small>Stations within baseline</small></div></div><div className="health-summary-card"><span className="health-summary-icon amber"><AlertCircle size={19} /></span><div><span>Warning</span><strong>{count(warning)}</strong><small>Stations needing review</small></div></div><div className="health-summary-card"><span className="health-summary-icon red"><AlertCircle size={19} /></span><div><span>Critical</span><strong>{count(critical)}</strong><small>Stations flagged for review</small></div></div></div>
    <section className="panel health-directory"><div className="health-directory-heading"><div><span className="directory-kicker">STATION NETWORK <span> / </span> HEALTH</span><h2>Maintenance queue <span className="directory-count">{filtered.length}</span></h2><p>Review station health and affected sensors, ordered by lowest health first.</p></div><span className="health-sort-label">Lowest health first</span></div><div className="health-tools"><label className="directory-search"><Search size={16} /><span className="sr-only">Search station health</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search by station, ID or state" /></label><label className="health-status-filter"><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option>All statuses</option><option>Healthy</option><option>Warning</option><option>Critical</option></select><ChevronDown size={15} /></label><span className="health-result-count">{filtered.length} {filtered.length === 1 ? "station" : "stations"}</span></div>
      <div className="health-table-scroll"><table className="health-directory-table"><thead><tr><th scope="col">Station</th><th scope="col">Health</th><th scope="col">Status</th><th scope="col">Anomaly score</th><th scope="col">Affected sensors</th><th scope="col">Last update</th></tr></thead><tbody>{visible.map((station) => { const time = station.timestamp ? new Date(station.timestamp) : null; return <tr key={station.id}><td><div className="health-station"><span className="health-station-icon"><Radio size={17} /></span><span><strong>{station.name}</strong><small>{station.id} · {station.state}</small></span></div></td><td><div className="health-table-progress"><strong>{station.health}%</strong><span><i className={station.color} style={{ width: `${Math.max(0, Math.min(100, station.health))}%` }} /></span></div></td><td><span className={`directory-status ${station.color}`}><i />{station.status}</span></td><td className="health-table-score">{station.anomaly_score != null && Number.isFinite(station.anomaly_score) ? station.anomaly_score.toFixed(2) : "—"}</td><td className="health-table-sensors">{station.affected?.length ? station.affected.join(", ") : "None"}</td><td className="health-table-time">{time && !Number.isNaN(time.getTime()) ? time.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td></tr>; })}</tbody></table>{!visible.length && <div className="directory-empty"><Search size={21} /><strong>{hasData ? "No stations found" : "Waiting for station data"}</strong><span>{hasData ? "Try a different search or status filter." : "Health information will appear when the data source is available."}</span></div>}</div>
      <div className="directory-footer"><span>{filtered.length ? `Showing ${firstIndex + 1}–${Math.min(firstIndex + pageSize, filtered.length)} of ${filtered.length}` : "No results"}</span><div className="directory-pagination"><button onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} aria-label="Previous health page"><ChevronRight size={16} className="directory-previous" /></button><span>Page <strong>{currentPage + 1}</strong> of {pageCount}</span><button onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1} aria-label="Next health page"><ChevronRight size={16} /></button></div></div>
    </section>
  </div>;
}

function SettingsPage({ onBack, config, onSave }: { onBack: () => void; config: DetectorConfig; onSave: (config: DetectorConfig) => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState(config);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(config), [config]);
  const save = async () => { setSaving(true); setSaveError(""); try { await onSave(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1800); } catch (error) { setSaveError(error instanceof Error ? error.message : "Unable to save settings."); } finally { setSaving(false); } };
  return <div className="workspace-page settings-workspace">{saveError && <div className="auth-error" role="alert">{saveError}</div>}<div className="page-hero panel"><div><span className="eyebrow">Monitoring configuration</span><h2>Workspace settings</h2><p>Adjust detection thresholds and review monitoring preferences.</p></div><button className="primary-button" onClick={() => void save()} disabled={saving}>{saved ? <><Check size={15} /> Saved</> : <><Settings2 size={15} /> Save settings</>}</button></div><div className="settings-grid"><section className="panel settings-card"><div className="panel-header"><div><span className="eyebrow">Monitoring behavior</span><h2>Alert preferences (preview)</h2></div></div><label className="setting-row"><span><b>Critical alert sound</b><small>Preview option for audible critical alert notifications.</small></span><input type="checkbox" defaultChecked /></label><label className="setting-row"><span><b>Auto-start simulation</b><small>Preview option for starting simulations automatically.</small></span><input type="checkbox" /></label><label className="setting-row"><span><b>Show technical factors</b><small>Preview option for displaying contributing factors in alert details.</small></span><input type="checkbox" defaultChecked /></label></section><section className="panel settings-card"><div className="panel-header"><div><span className="eyebrow">Model controls</span><h2>Detection sensitivity</h2></div></div><div className="threshold-form"><label>Warning score <output>{draft.warning_score.toFixed(2)}</output><input type="range" min="0.05" max="0.8" step="0.01" value={draft.warning_score} onChange={(event) => setDraft({ ...draft, warning_score: Number(event.target.value) })} /></label><label>Critical score <output>{draft.critical_score.toFixed(2)}</output><input type="range" min="0.1" max="0.99" step="0.01" value={draft.critical_score} onChange={(event) => setDraft({ ...draft, critical_score: Number(event.target.value) })} /></label><label>Regional event sensitivity <output>{Math.round(draft.regional_fraction * 100)}%</output><input type="range" min="0.2" max="1" step="0.05" value={draft.regional_fraction} onChange={(event) => setDraft({ ...draft, regional_fraction: Number(event.target.value) })} /></label></div><div className="model-detail"><div><span>Algorithm</span><b>Isolation Forest + robust baseline</b></div><div><span>Source</span><b>Open-Meteo estimates; IMD reference separate</b></div></div></section></div><NotificationSettings /><button className="back-link" onClick={onBack}><ChevronRight size={15} className="back-chevron" />Back to overview</button></div>;
}

function App({ user, onSignOut }: { user: Account; onSignOut: () => void }) {
  const [activeNav, setActiveNav] = useState("Overview");
  const [selectedStation, setSelectedStation] = useState(stations[2]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [simulation, setSimulation] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [showAllOverviewStations, setShowAllOverviewStations] = useState(false);
  const [range, setRange] = useState("6 hours");
  const [sourceStatus, setSourceStatus] = useState<"live" | "replay" | "connecting" | "stale">("connecting");
  const [sourceLabel, setSourceLabel] = useState("Connecting to weather source");
  const [lastSync, setLastSync] = useState("connecting");
  const [visualLayer, setVisualLayer] = useState("Stations");
  const [realtimeStations, setRealtimeStations] = useState<Station[]>(stations);
  const [weatherEvent, setWeatherEvent] = useState({ classification: "mixed", label: "Checking network conditions", confidence: null as null, evidence: "Waiting for the first backend observation batch.", affected_stations: [] as string[] });
  const [history, setHistory] = useState<HumidityReading[]>([]);
  const [historySource, setHistorySource] = useState<"live" | "open-meteo" | "replay" | null>(null);
  const [historyHours, setHistoryHours] = useState(24);
  const [detectorConfig, setDetectorConfig] = useState<DetectorConfig>({ warning_score: 0.32, critical_score: 0.62, regional_fraction: 0.5 });
  const [datasetResult, setDatasetResult] = useState<DatasetReport | null>(null);
  const [stationIncidentCount, setStationIncidentCount] = useState(0);

  useEffect(() => {
    let mounted=true;
    const sync=async()=>{ try { const response=await fetch("/api/station-incidents",{headers:{Accept:"application/json"}}); if(!response.ok || !response.headers.get("content-type")?.includes("application/json")) return; const data=await response.json(); if(mounted && Array.isArray(data.incidents)) setStationIncidentCount(data.incidents.filter((incident:{status:string})=>incident.status !== "resolved").length); } catch { /* Keep the last known count when the backend is unavailable. */ } };
    void sync(); const timer=window.setInterval(()=>void sync(),60_000); window.addEventListener("skyguard:incidents-updated",sync);
    return ()=>{mounted=false;window.clearInterval(timer);window.removeEventListener("skyguard:incidents-updated",sync);};
  },[]);

  useEffect(() => {
    let mounted = true;
    const syncLiveSource = async () => {
      try {
        const response = await fetch("/api/realtime", { headers: { Accept: "application/json" } });
        if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
        if (!isUsableRealtimeResponse(response)) throw new Error("Realtime backend unavailable");
        const payload = await response.json();
        const mappedStations = Array.isArray(payload.stations) ? payload.stations.map((item: any) => {
          const base = stations.find((station) => station.id === item.station_id) ?? stations[0];
          return { ...base, id: item.station_id, name: item.station_name ?? base.name, location: `${Number(item.latitude).toFixed(2)}° N · ${Number(item.longitude).toFixed(2)}° E`, state: item.state ?? base.state ?? "Unknown", region: item.region ?? base.region ?? "Unknown", latitude: Number(item.latitude), longitude: Number(item.longitude), status: ["Healthy", "Warning", "Critical"].includes(item.status) ? item.status : "Unavailable", health: Number(item.health ?? base.health), temp: `${Number(item.temperature).toFixed(1)}°`, pressure: Number(item.pressure).toFixed(1), humidity: `${Number(item.humidity).toFixed(0)}%`, color: item.color ?? base.color, timestamp: item.timestamp, observation_stale: item.observation_stale === true, detector_evidence: item.detector_evidence, anomaly_score: typeof item.anomaly_score === "number" && Number.isFinite(item.anomaly_score) ? item.anomaly_score : null, explanation: item.explanation, suspected_cause: item.suspected_cause, recommended_action: item.recommended_action, deviations: { temperature: formatDeviation(item.deviations?.temperature), humidity: formatDeviation(item.deviations?.humidity), pressure: formatDeviation(item.deviations?.pressure) }, affected: Array.isArray(item.affected) ? item.affected : [] };
        }) : [];
        if (mounted) {
          setRealtimeStations(mappedStations);
          setSelectedStation((current) => mappedStations.find((station: Station) => station.id === current.id) ?? current);
          setSourceStatus(!mappedStations.length ? "connecting" : payload.source_stale ? "stale" : payload.source === "live" || payload.source === "open-meteo" ? "live" : "replay");
          setHistorySource(["live", "open-meteo", "replay"].includes(payload.source) ? payload.source : null);
          setSourceLabel(payload.source_label ?? "Weather source");
          setLastSync(payload.last_sync && !Number.isNaN(Date.parse(payload.last_sync)) ? new Date(payload.last_sync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "unavailable");
          if (payload.weather_event) setWeatherEvent(payload.weather_event);

        }
      } catch {
        if (mounted) { setSourceStatus("connecting"); setSourceLabel("Backend unavailable"); }
      }
    };
    fetch("/api/config", { headers: { Accept: "application/json" } }).then((response) => response.json()).then((config) => mounted && setDetectorConfig(config)).catch(() => undefined);
    syncLiveSource();
    const interval = window.setInterval(syncLiveSource, 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!historySource) { setHistory([]); return; }
    let mounted = true;
    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/history?hours=${historyHours}&station_id=${encodeURIComponent(selectedStation.id)}&source=${historySource}`, { headers: { Accept: "application/json" } });
        if (!isUsableRealtimeResponse(response)) throw new Error("History unavailable");
        const payload = await response.json();
        const rows: HumidityReading[] = Array.isArray(payload.readings) ? payload.readings.filter((row: any) => row.humidity != null).map((row: any) => ({ timestamp: Date.parse(row.recorded_at ?? row.timestamp), humidity: Number(row.humidity) })).filter((row: HumidityReading) => Number.isFinite(row.timestamp) && Number.isFinite(row.humidity)).sort((a: HumidityReading, b: HumidityReading) => a.timestamp - b.timestamp).slice(-120) : [];
        if (mounted) setHistory(rows);
      } catch { if (mounted) setHistory([]); }
    };
    setHistory([]);
    void loadHistory();
    const interval = window.setInterval(loadHistory, 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [historyHours, selectedStation.id, historySource]);

  useEffect(() => {
    if (!simulation) return;
    const timer = window.setTimeout(() => setSimulation(false), 10000);
    return () => window.clearTimeout(timer);
  }, [simulation]);

  const liveStation = useMemo(() => simulation ? { ...selectedStation, health: 57, temp: "38.6°", status: "Critical" } : selectedStation, [selectedStation, simulation]);
  const activeStations: Station[] = realtimeStations.length ? realtimeStations : stations;
  const mapStations: Station[] = useMemo(() => {
    const reporting = new Map((sourceStatus === "connecting" ? [] : realtimeStations).map(item => [item.id,item]));
    const registered = stations.map(item => reporting.get(item.id) ?? { ...item, status: "Unavailable", observation_stale: true, health: 0, temp: "—", humidity: "—", pressure: "—", color: "unknown", affected: [] });
    const registeredIds = new Set(registered.map(item => item.id));
    return [...registered, ...Array.from(reporting.values()).filter(item => !registeredIds.has(item.id))];
  }, [realtimeStations, sourceStatus]);
  const activeAlerts = useMemo<Alert[]>(() => {
    const live = (sourceStatus === "connecting" ? [] : activeStations).filter((station) => station.status === "Warning" || station.status === "Critical").map((station) => ({
      id: `${historySource ?? "unknown"}:${station.id}:${station.timestamp ?? "unknown"}`, station: station.id,
      title: station.status === "Critical" ? `${station.affected?.[0] ? station.affected[0][0].toUpperCase() + station.affected[0].slice(1) : "Observation"} anomaly detected` : `${station.affected?.[0] ? station.affected[0][0].toUpperCase() + station.affected[0].slice(1) : "Observation"} requires review`,
      type: station.status === "Critical" ? "CRITICAL" as const : "WARNING" as const,
      score: station.anomaly_score ?? null,
      time: station.timestamp && Number.isFinite(Date.parse(station.timestamp)) ? new Date(station.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Time unavailable",
      description: station.explanation ?? "The latest observation moved outside the learned station pattern.",
      action: station.recommended_action ?? "Verify the reading and its source against independent observations before drawing conclusions.",
      color: station.color === "red" ? "red" as const : "amber" as const, source: historySource, observedAt: station.timestamp, readings: {temperature:station.temp, humidity:station.humidity, pressure:station.pressure}, evidence: station.detector_evidence,
    }));
    return live;
  }, [activeStations, sourceStatus, historySource]);
  useEffect(() => { if (activeAlerts.length && !activeAlerts.some((alert) => alert.id === selectedAlert?.id)) setSelectedAlert(activeAlerts[0]); }, [activeAlerts, selectedAlert?.id]);

  const setNav = (label: string) => { setActiveNav(label); setMenuOpen(false); setProfileOpen(false); };
  const sourceDescription = describeWeatherSource(historySource, sourceStatus);
  const sourceBadge = weatherSourceBadge(historySource, sourceStatus, sourceLabel);
  return (
    <div className="app-shell">
      <aside className={`sidebar reference-sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="reference-brand"><div className="reference-brand-line"><span className="cloud-logo"><CloudLightning size={35} /></span><strong>SkyGuard</strong><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={17} /></button></div><p>Weather Station<br />Monitoring</p></div>
        <nav className="reference-nav" aria-label="Main navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={activeNav === label ? "active" : ""} onClick={() => setNav(label)}><Icon size={19} /><span>{label === "Alerts" ? "Anomalies" : label}</span>{label === "Alerts" && <b className="nav-count">{activeAlerts.length + stationIncidentCount >= 200 ? "200+" : activeAlerts.length + stationIncidentCount}</b>}</button>)}<button className={activeNav === "Analyze dataset" ? "active" : ""} onClick={() => setNav("Analyze dataset")}><Database size={19} /><span>Analyze dataset</span></button><button className={activeNav === "Data quality" ? "active" : ""} onClick={() => setNav("Data quality")}><ShieldCheck size={19} /><span>Data quality</span></button>{user.role === "administrator" && <><button className={activeNav === "Users" ? "active" : ""} onClick={() => setNav("Users")}><UserRound size={19} /><span>Team access</span></button><button className={activeNav === "Settings" ? "active" : ""} onClick={() => setNav("Settings")}><Settings2 size={19} /><span>Settings</span></button></>}</nav>
        <div className="sidebar-waves" aria-hidden="true" />
      </aside>
      <main className="dashboard-main reference-main"><header className="reference-header"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="reference-title"><span>{activeNav === "Alerts" ? "Anomalies" : activeNav}</span><h1>{activeNav === "Overview" ? "Station intelligence" : activeNav === "Alerts" ? "Anomalies" : activeNav}</h1><p>{activeNav === "Overview" ? "Monitor weather observations and identify potential sensor anomalies." : "Monitor station performance and review observations across your network."}</p></div><div className="reference-actions"><label className="station-select"><span className="sr-only">Select station</span><Radio size={17} /><select value={selectedStation.id} onChange={(event) => { const station = activeStations.find((item) => item.id === event.target.value); if (station) setSelectedStation(station); }}>{!activeStations.some((station) => station.id === selectedStation.id) && <option value={selectedStation.id}>{selectedStation.name} (unavailable)</option>}{activeStations.map((station) => <option value={station.id} key={station.id}>{station.name}</option>)}</select><ChevronDown size={16} /></label>{sourceBadge.label && <span className="source-name">{sourceBadge.label}</span>}<span className={`live-badge ${sourceStatus}`}><span className="status-dot" />{sourceBadge.state}</span><span className="header-time">{lastSync === "connecting" ? "Awaiting data" : `Updated ${lastSync}`}</span><button className="reference-icon notification" onClick={() => setNav("Alerts")} aria-label="Open anomalies"><Bell size={21} />{activeAlerts.length + stationIncidentCount > 0 && <i>{activeAlerts.length + stationIncidentCount >= 200 ? "200+" : activeAlerts.length + stationIncidentCount}</i>}</button><div className="auth-profile-wrap"><button className="reference-avatar" onClick={() => setProfileOpen((value) => !value)} aria-label="Account menu" aria-expanded={profileOpen}><UserRound size={19} /></button>{profileOpen && <div className="auth-profile-menu"><div><strong>{user.username}</strong><small>{user.role === "administrator" ? "Administrator" : "Operator"}</small></div>{user.role === "administrator" && <button onClick={() => setNav("Users")}>Team access</button>}<button onClick={onSignOut}>Sign out</button></div>}</div></div></header>
        <div className="dashboard-content reference-content">
          {["Overview", "Stations", "Alerts", "Analytics", "Sensor health"].includes(activeNav) && <section className={`source-notice ${sourceDescription.tone}`} aria-label="Weather data source"><CircleHelp size={19} aria-hidden="true" /><div><strong>{sourceDescription.title}</strong><p>{sourceDescription.detail}</p></div><button onClick={() => setNav("Station feed")}>View station feed <ChevronRight size={15} /></button></section>}
          {simulation && activeNav === "Overview" && <div className="simulation-notice" role="status">Demonstration: the selected station's temperature, status and health index are simulated for 10 seconds. This does not indicate a real sensor fault.</div>}
          {activeNav === "Stations" ? <StationsPage stations={activeStations} selectedStation={selectedStation} onSelect={setSelectedStation} onRun={() => { setSimulation(true); setNav("Overview"); }} /> : activeNav === "Alerts" ? <div className="workspace-page alerts-combined"><StationIncidents />{activeAlerts.length ? <AlertsPage alerts={activeAlerts} selectedAlert={activeAlerts.find((alert) => alert.id === selectedAlert?.id) ?? activeAlerts[0]} onSelect={setSelectedAlert} /> : <div className="ref-panel empty-alerts">{sourceStatus === "connecting" ? "Waiting for a connection to the selected weather source." : "There are no current anomalies in the selected weather source."}</div>}</div> : activeNav === "Analytics" ? <AnalyticsPage history={history} station={selectedStation} hours={historyHours} onHoursChange={setHistoryHours} /> : activeNav === "Sensor health" ? <HealthPage stations={activeStations} sourceStatus={sourceStatus} /> : activeNav === "Users" && user.role === "administrator" ? <UserManagement currentUser={user} onSignOut={onSignOut} /> : activeNav === "Settings" && user.role === "administrator" ? <SettingsPage config={detectorConfig} onBack={() => setNav("Overview")} onSave={async (nextConfig) => { const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextConfig) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to save detector settings."); setDetectorConfig(payload.detector_config ?? nextConfig); }} /> : activeNav === "Station feed" ? <StationMonitor onBack={() => setNav("Overview")} onQuality={() => setNav("Data quality")} canManageDevices={user.role === "administrator"} /> : activeNav === "Data quality" ? <DataQuality onBack={() => setNav("Overview")} /> : activeNav === "Analyze dataset" ? <DatasetPanel onBack={() => setNav("Overview")} onOpenUpload={() => setDatasetOpen(true)} /> : <Overview station={liveStation} stations={activeStations} mapStations={mapStations} alerts={activeAlerts} sourceStatus={sourceStatus} historySource={historySource} onViewAlerts={() => setNav("Alerts")} onViewStations={() => setNav("Stations")} onSelectStation={(id) => { const selected = mapStations.find((item) => item.id === id); if (selected) setSelectedStation(selected); }} />}
          {activeNav === "Analyze dataset" && datasetResult && <DatasetResults report={datasetResult} />}<div className="content-disclaimer"><CircleHelp size={14} /> Scores and health indices are model-derived, not verified sensor condition. Investigate flagged readings before diagnosing a fault.</div>
        </div></main>
      {datasetOpen && <DatasetModal onClose={() => setDatasetOpen(false)} onComplete={(report) => { setDatasetResult(report); }} />}
    </div>
  );
}

function DatasetPanel({ onBack, onOpenUpload }: { onBack: () => void; onOpenUpload: () => void }) {
  const fields = [
    { name: "timestamp", description: "Date and time of observation" },
    { name: "station_id", description: "Unique station identifier" },
    { name: "temperature", description: "Temperature in °C" },
    { name: "pressure", description: "Atmospheric pressure in hPa" },
    { name: "humidity", description: "Relative humidity in %" },
  ];
  return <div className="workspace-page dataset-workspace">
    <div className="page-hero panel dataset-intro"><div><span className="eyebrow">Historical data / analysis</span><h2>Analyze weather station data</h2><p>Upload recorded observations to identify potential anomalies across your station network.</p></div><div className="dataset-intro-badge"><Database size={18} /><span><strong>CSV analysis</strong><small>Historical observations</small></span></div></div>
    <div className="dataset-layout"><section className="panel dataset-upload-panel"><div className="dataset-section-heading"><span className="directory-kicker">GET STARTED</span><h2>Upload observations</h2><p>Choose a CSV file containing weather station readings.</p></div><div className="dataset-upload-area"><span className="dataset-upload-symbol"><Upload size={24} /></span><h3>Select a CSV file to analyze</h3><p>Choose a file from your device. Analysis begins after selection.</p><button className="primary-button dataset-upload-action" onClick={onOpenUpload}><Upload size={16} /> Choose CSV file</button><span className="dataset-file-limit">CSV format <i /> Maximum file size: 10 MB</span></div><div className="dataset-processing-note"><ShieldCheck size={17} /><span>Your file is sent to the application server for validation and analysis.</span></div></section>
    <section className="panel dataset-requirements"><div className="dataset-section-heading"><span className="directory-kicker">BEFORE YOU UPLOAD</span><h2>File requirements</h2><p>Include a header row with these columns.</p></div><div className="dataset-field-list">{fields.map((field) => <div className="dataset-field" key={field.name}><span className="dataset-field-check"><Check size={14} /></span><span><strong>{field.name}</strong><small>{field.description}</small></span></div>)}</div><div className="dataset-requirements-note"><CircleHelp size={16} /><span>Include valid timestamps and numeric readings. Invalid rows are skipped; each file may contain up to 5,000 unique station timestamps.</span></div></section></div>
    <section className="panel dataset-process"><div className="dataset-process-heading"><div><span className="directory-kicker">HOW IT WORKS</span><h2>From file to analysis</h2></div><span>Three simple steps</span></div><div className="dataset-process-grid"><div><span className="dataset-step-number">01</span><span><strong>Choose a file</strong><small>Select a CSV with the required columns.</small></span></div><div><span className="dataset-step-number">02</span><span><strong>Validate and analyze</strong><small>Valid readings are grouped and analyzed by station.</small></span></div><div><span className="dataset-step-number">03</span><span><strong>Review the summary</strong><small>See the number of observations and stations processed.</small></span></div></div></section>
    <button className="back-link" onClick={onBack}><ChevronRight size={15} className="back-chevron" />Back to overview</button>
  </div>;
}

function DatasetModal({ onClose, onComplete }: { onClose: () => void; onComplete: (report: DatasetReport) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const chooseFile = () => inputRef.current?.click();
  const analyze = async (file: File) => {
    setBusy(true); setError(""); setResult(""); setRowErrors([]); setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Select a CSV file to continue.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The file exceeds the 10 MB size limit.");
      const csv = await file.text();
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ csv }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to analyze the dataset. Please try again.");
      const message = `${payload.rows} valid rows processed across ${payload.stations?.length ?? 0} stations${payload.errors?.length ? ` · ${payload.errors.length} invalid rows were skipped` : ""}. Close this window to review the results.`;
      setResult(message); setRowErrors(Array.isArray(payload.errors) ? payload.errors.slice(0, 10) : []); onComplete({ ...payload, fileName: file.name });
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to analyze the dataset. Please try again."); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onClick={onClose}><div className="dataset-modal" role="dialog" aria-modal="true" aria-labelledby="dataset-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="directory-kicker">CSV ANALYSIS</span><h2 id="dataset-modal-title">Upload observations</h2><p>Select a file to validate and analyze its readings.</p></div><button className="icon-button" onClick={onClose} aria-label="Close upload dialog"><X size={19} /></button></div><input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyze(file); event.target.value = ""; }} /><button className="modal-upload modal-upload-button" onClick={chooseFile} disabled={busy}><span className="modal-file-icon"><Upload size={20} /></span><span className="modal-file-copy"><b>{fileName || "Choose a CSV file"}</b><small>CSV format · Up to 10 MB</small></span><ChevronRight size={17} /></button><div className="modal-schema"><ShieldCheck size={15} /> Analysis begins after a file is selected.</div>{busy && <div className="modal-status" role="status">Analyzing {fileName}…</div>}{result && <div className="modal-success" role="status"><Check size={15} /> {result}</div>}{error && <div className="modal-error" role="alert"><AlertCircle size={15} /> {error}</div>}{rowErrors.length > 0 && <div className="dataset-row-errors"><strong>Invalid rows (first 10)</strong><ul>{rowErrors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<div className="modal-actions"><button className="ghost-button" onClick={onClose}>{result ? "Close" : "Cancel"}</button><button className="primary-button" onClick={chooseFile} disabled={busy}><Upload size={15} /> {busy ? "Analyzing…" : fileName ? "Choose another file" : "Choose CSV file"}</button></div></div></div>;
}

export default function Root() { return <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>; }
