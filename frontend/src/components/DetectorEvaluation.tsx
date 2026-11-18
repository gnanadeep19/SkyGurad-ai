import { useEffect, useState } from "react";
import { Activity, CircleHelp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Evaluation = {
  period: { start: string; end: string };
  historical_summary: { scored: number; insufficient: number; warning: number; critical: number };
  thresholds: { warning_score: number; critical_score: number };
  flagged_fraction_of_scored: number | null;
  utc_hour_breakdown: Array<{ hour_utc: number; scored: number; flagged: number; flagged_fraction: number | null }>;
};
const labelHour = (value: number) => `${String(value).padStart(2, "0")}:00`;

export default function DetectorEvaluation() {
  const [report, setReport] = useState<Evaluation | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/evaluation/chennai", { headers: { Accept: "application/json" }, signal: controller.signal });
        if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Evaluation unavailable");
        const payload = await response.json();
        if (!controller.signal.aborted) setReport(payload.report);
      } catch { if (!controller.signal.aborted) setUnavailable(true); }
    })();
    return () => controller.abort();
  }, []);
  if (!report) return <section className="panel detector-evaluation"><span className="directory-kicker">OFFLINE REFERENCE</span><h2>Detector evaluation</h2><p>{unavailable ? "The saved historical evaluation is unavailable." : "Loading the historical evaluation…"}</p></section>;
  const summary = report.historical_summary;
  const bars = report.utc_hour_breakdown.map(row => ({ ...row, percentage: row.flagged_fraction === null ? 0 : row.flagged_fraction * 100 }));
  return <section className="panel detector-evaluation"><div className="detector-evaluation-heading"><div><span className="directory-kicker">OFFLINE REFERENCE / NOAA</span><h2>Historical detector evaluation</h2><p>Chennai International Airport · January 2024 · Saved sample</p></div><span className="detector-evaluation-badge"><Activity size={15} /> Historical analysis</span></div>
    <div className="detector-evaluation-stats"><div><span>Observations scored</span><strong>{summary.scored}</strong><small>{summary.insufficient} needed more history</small></div><div><span>Observations flagged</span><strong>{summary.warning + summary.critical}</strong><small>{report.flagged_fraction_of_scored === null ? "Not available" : `${(report.flagged_fraction_of_scored * 100).toFixed(1)}% of scored readings`}</small></div><div><span>Verified fault labels</span><strong>None</strong><small>Accuracy cannot be calculated</small></div></div>
    <div className="detector-evaluation-chart-head"><div><h3>Flags by observation hour</h3><p>Percentage of scored readings flagged at each UTC hour</p></div><span>Warning threshold {report.thresholds.warning_score.toFixed(2)} · Critical {report.thresholds.critical_score.toFixed(2)}</span></div>
    <div className="detector-evaluation-chart" role="img" aria-label="Percentage of scored historical observations flagged by UTC hour"><ResponsiveContainer width="100%" height="100%"><BarChart data={bars} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><CartesianGrid stroke="#284151" vertical={false} /><XAxis dataKey="hour_utc" tickFormatter={labelHour} tick={{ fill: "#a8c1cf", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} width={42} tick={{ fill: "#a8c1cf", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip labelFormatter={value => `${labelHour(Number(value))} UTC`} formatter={(value: number, _name, item) => [`${value.toFixed(1)}% (${item.payload.flagged}/${item.payload.scored})`, "Flagged"]} contentStyle={{ background: "#102334", border: "1px solid #38576b", borderRadius: 8, color: "#fff" }} /><Bar dataKey="percentage" fill="#39c9ff" radius={[4, 4, 0, 0]} maxBarSize={42} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
    <div className="detector-evaluation-note"><CircleHelp size={16} /><span>Flags indicate unusual observations, not confirmed sensor faults. The sample has no fault labels, and its humidity values are derived from temperature and dew point. Time-of-day differences do not establish a cause.</span></div>
  </section>;
}
