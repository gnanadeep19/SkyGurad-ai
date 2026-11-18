import { useMemo, useState } from "react";
import { Activity, CircleHelp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { analyzeDrift, DRIFT_DEMO_DELTAS, makeDriftDemo, simulateDrift, type DriftField, type DriftReading } from "../lib/drift";

const fields: DriftField[] = ["temperature", "humidity", "pressure"];
const names: Record<DriftField, string> = { temperature: "Temperature", humidity: "Humidity", pressure: "Pressure" };
const units: Record<DriftField, string> = { temperature: "°C", humidity: "pp", pressure: "hPa" };
const readingUnits: Record<DriftField, string> = { temperature: "°C", humidity: "%", pressure: "hPa" };
const changeText = (value: number) => { const rounded = Math.abs(value) < .05 ? 0 : value; return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`; };
const title = (status: string) => status === "review" ? "Change to review" : status === "no_shift" ? "No sustained change" : "Insufficient history";

export function HistoricalDriftReview({ readings }: { readings: DriftReading[] }) {
  const results = useMemo(() => fields.map(field => ({ field, result: analyzeDrift(readings, field) })), [readings]);
  return <div className="drift-review"><div className="drift-review-head"><div><span className="directory-kicker">EXPERIMENTAL / HISTORICAL ONLY</span><h3>Sustained change review</h3><p>Latest 24 hours of the selected station compared with earlier observations at the same UTC hour.</p></div></div><div className="drift-result-grid">{results.map(({ field, result }) => <div className="drift-result" key={field}><span>{names[field]}</span><strong>{title(result.status)}</strong><small>{result.change === null ? result.reason : `Difference between half-day medians: ${changeText(result.change)} ${units[field]} · Review threshold ${result.threshold} ${units[field]}`}</small></div>)}</div><p className="drift-note"><CircleHelp size={15} /> This exploratory rule can flag weather changes. It does not diagnose a sensor fault or create incidents.</p></div>;
}

export default function DriftDemo() {
  const [field, setField] = useState<DriftField>("temperature");
  const [simulated, setSimulated] = useState(false);
  const original = useMemo(() => makeDriftDemo(), []);
  const modified = useMemo(() => simulated ? simulateDrift(original, field) : original, [original, field, simulated]);
  const result = useMemo(() => analyzeDrift(modified, field), [modified, field]);
  const chart = modified.slice(-17).map((row, i) => ({ time: Date.parse(row.timestamp), original: original[original.length - 17 + i][field], displayed: row[field] }));
  return <section className="panel drift-demo" aria-labelledby="drift-demo-title"><div className="drift-demo-header"><div><span className="directory-kicker">INTERACTIVE DEMONSTRATION</span><h2 id="drift-demo-title"><Activity size={19} /> Explore sensor drift</h2><p>Compare a stable synthetic series with an added gradual change.</p></div><span className="drift-demo-badge">Synthetic data only</span></div>
    <div className="drift-demo-controls"><label>Measurement <select value={field} onChange={event => { setField(event.target.value as DriftField); setSimulated(false); }}>{fields.map(value => <option value={value} key={value}>{names[value]}</option>)}</select></label><button className="primary-button" onClick={() => setSimulated(value => !value)}>{simulated ? "Show original data" : "Simulate gradual change"}</button></div>
    <div className={`drift-demo-status ${result.status}`} role="status"><strong>{title(result.status)}</strong><span>{simulated ? `Simulated +${DRIFT_DEMO_DELTAS[field]} ${units[field]} over the last 24 hours.` : "Original synthetic series · no change added."} {result.change === null ? result.reason : `Half-day residual difference: ${changeText(result.change)} ${units[field]}.`}</span></div>
    <div className="drift-demo-chart" role="img" aria-label={`${names[field]} synthetic original and displayed series over 48 hours`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 8, right: 15, left: 0, bottom: 4 }}><CartesianGrid stroke="#294658" strokeDasharray="3 5" /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={value => new Date(Number(value)).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", hour: "2-digit" })} tick={{ fill: "#9bb5c6", fontSize: 10 }} minTickGap={40} /><YAxis domain={["auto", "auto"]} tick={{ fill: "#9bb5c6", fontSize: 10 }} width={42} /><Tooltip labelFormatter={value => `${new Date(Number(value)).toISOString().slice(0, 16).replace("T", " ")} UTC`} formatter={(value: number, name: string) => [`${value.toFixed(1)} ${readingUnits[field]}`, name === "original" ? "Original" : simulated ? "With simulated change" : "Displayed"]} contentStyle={{ background: "#102838", border: "1px solid #31566b", borderRadius: 8, color: "#ecf7fc" }} /><Line dataKey="original" name="original" stroke="#82a4b6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} /><Line dataKey="displayed" name="displayed" stroke="#39c4f5" strokeWidth={2.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
    <div className="drift-legend"><span><i className="original" />Original synthetic values</span><span><i className="displayed" />{simulated ? "With simulated change" : "Displayed values"}</span><span>Time: UTC · Values: {readingUnits[field]}</span></div>
    <p className="drift-note"><CircleHelp size={15} /> Experimental demonstration only. Synthetic changes are not sensor faults. The rule uses prior same-hour baselines and may also flag natural weather changes; it does not change live detection or create alerts.</p>
  </section>;
}
