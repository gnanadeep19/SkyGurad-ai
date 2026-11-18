// Exploratory offline comparison; it does not change the live detector.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeIsolated } from "./evaluate-detector.mjs";

const PARAMETERS = Object.freeze({ minimum_prior_days: 7, max_prior_days: 14, threshold_robust_deviations: 3.5, scale_floors: { temperature: .5, humidity: 3, pressure: 1 } });
const median = values => { const a = [...values].sort((x, y) => x - y); const mid = Math.floor(a.length / 2); return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2; };
const fraction = (n, d) => d ? Number((n / d).toFixed(4)) : null;

export function compareSeries(series, options = {}) {
  const candidateThreshold = options.candidateThreshold ?? PARAMETERS.threshold_robust_deviations;
  if (typeof candidateThreshold !== "number" || !Number.isFinite(candidateThreshold) || candidateThreshold < 0) throw new Error("Invalid candidate threshold.");
  const groups = new Map(), hourly = new Map();
  const matchedScores = [];
  const result = { total_observations: series.length, candidate_eligible: 0, matched_observations: 0, current_flagged: 0, candidate_flagged: 0, both_flagged: 0, current_only: 0, candidate_only: 0, neither_flagged: 0 };
  const points = [...series].sort((a, b) => a.station_id.localeCompare(b.station_id) || Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || ![point.temperature, point.humidity, point.pressure].every(Number.isFinite)) continue;
    const date = new Date(time), day = date.toISOString().slice(0, 10), hour = date.getUTCHours();
    const key = `${point.station_id}\0${hour}`;
    const priorByDay = groups.get(key) ?? new Map();
    // One last observation per earlier UTC day in this UTC-hour bin; never use
    // a reading from the same day or a future date in the candidate baseline.
    const prior = Array.from(priorByDay.entries()).filter(([priorDay]) => priorDay < day).slice(-PARAMETERS.max_prior_days).map(([, row]) => row);
    if (prior.length >= PARAMETERS.minimum_prior_days) {
      result.candidate_eligible++;
      let maxDeviation = 0;
      for (const field of ["temperature", "humidity", "pressure"]) {
        const values = prior.map(row => row[field]), center = median(values);
        const scale = Math.max(median(values.map(value => Math.abs(value - center))) * 1.4826, PARAMETERS.scale_floors[field]);
        maxDeviation = Math.max(maxDeviation, Math.abs(point[field] - center) / scale);
      }
      if (typeof point.anomaly_score === "number" && Number.isFinite(point.anomaly_score)) {
        result.matched_observations++;
        const current = point.status === "Warning" || point.status === "Critical";
        const candidate = maxDeviation >= candidateThreshold;
        if (options.includeScores) matchedScores.push({ station_id: point.station_id, timestamp: point.timestamp, current_score: point.anomaly_score, current_flagged: current, candidate_score: maxDeviation, candidate_flagged: candidate });
        if (current) result.current_flagged++;
        if (candidate) result.candidate_flagged++;
        if (current && candidate) result.both_flagged++;
        else if (current) result.current_only++;
        else if (candidate) result.candidate_only++;
        else result.neither_flagged++;
        const group = hourly.get(hour) ?? { hour_utc: hour, matched: 0, current_flagged: 0, candidate_flagged: 0 };
        group.matched++; if (current) group.current_flagged++; if (candidate) group.candidate_flagged++; hourly.set(hour, group);
      }
    }
    priorByDay.set(day, point);
    // Keep the most recent 14 days for each station/hour; sorting above makes
    // the retained point the last observation in each day/hour bin.
    while (priorByDay.size > PARAMETERS.max_prior_days + 1) priorByDay.delete(priorByDay.keys().next().value);
    groups.set(key, priorByDay);
  }
  return { ...result, current_flag_fraction: fraction(result.current_flagged, result.matched_observations), candidate_flag_fraction: fraction(result.candidate_flagged, result.matched_observations), utc_hour_breakdown: Array.from(hourly.values()).sort((a, b) => a.hour_utc - b.hour_utc).map(group => ({ ...group, current_flag_fraction: fraction(group.current_flagged, group.matched), candidate_flag_fraction: fraction(group.candidate_flagged, group.matched) })), ...(options.includeScores ? { matched_scores: matchedScores } : {}) };
}

async function compare(files) {
  const datasets = [];
  for (const file of files) {
    const csv = await fs.readFile(file, "utf8");
    const report = await analyzeIsolated(csv);
    datasets.push({ dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), period: report.period, current_thresholds: report.thresholds, comparison: compareSeries(report.series) });
  }
  return { evaluated_at: new Date().toISOString(), candidate: { name: "Experimental same-UTC-hour robust baseline", parameters: PARAMETERS, classification: "A flag occurs when any measurement deviates by at least 3.5 robust scales from its prior same-hour baseline." }, datasets, notes: ["Both detectors are compared on exactly the observations for which both produced a score.", "The candidate and current detector use different scores and thresholds; their flag rates are not directly calibrated to equal sensitivity.", "Only earlier observations are used; each dataset is analyzed independently, including its warm-up period.", "These data have no verified sensor-fault labels; fewer flags does not establish better accuracy or fewer false alarms.", "UTC-hour bins assume the observed station uses a stable local offset. Humidity in the Chennai sample is derived, not an independent sensor measurement.", "The candidate is experimental and is not used by the live detector."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, second, output] = process.argv.slice(2);
  if (!first || !second) { console.error("Usage: node scripts/compare-time-baseline.mjs <first.csv> <later.csv> [new-report.json]"); process.exitCode = 1; }
  else compare([first, second]).then(async result => { const json = JSON.stringify(result, null, 2) + "\n"; if (output) { await fs.writeFile(output, json, { flag: "wx" }); console.log(`Comparison written to ${output}`); } else process.stdout.write(json); }).catch(error => { console.error(`Comparison failed: ${error.message}`); process.exitCode = 1; });
}
