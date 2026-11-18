// Synthetic experiments only: no modified observations touch the user's database.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeIsolated } from "./evaluate-detector.mjs";
import { compareSeries } from "./compare-time-baseline.mjs";

const limits = { temperature: [-90, 65], humidity: [0, 100], pressure: [300, 1100] };
const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
function serialize(rows, headers) { return [headers.map(quote).join(","), ...rows.map(row => headers.map(header => quote(row[header])).join(",")), ""].join("\n"); }
function adjusted(value, field, delta) {
  if (!(field in limits) || typeof value !== "string" || !value.trim() || !Number.isFinite(Number(value)) || !Number.isFinite(delta)) throw Error("Invalid perturbation.");
  const next = Number((Number(value) + delta).toFixed(3));
  if (next < limits[field][0] || next > limits[field][1]) throw Error("Perturbation is outside input validation limits.");
  return String(next);
}
export function makeSpike(rows, index, field, delta) {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) throw Error("Invalid spike position.");
  return rows.map((row, i) => i === index ? { ...row, [field]: adjusted(row[field], field, delta) } : { ...row });
}
export function makeDrift(rows, index, field, totalDelta) {
  const start = Date.parse(rows[index]?.timestamp);
  if (!Number.isFinite(start)) throw Error("Invalid drift start.");
  const changes = new Map();
  for (let step = 1; step <= 8; step++) {
    const timestamp = start + step * 3 * 3600_000;
    const matches = rows.map((row, i) => ({ row, i })).filter(item => Date.parse(item.row.timestamp) === timestamp);
    if (matches.length !== 1) throw Error("Drift requires eight unique subsequent three-hour observations.");
    changes.set(matches[0].i, adjusted(matches[0].row[field], field, totalDelta * step / 8));
  }
  return rows.map((row, i) => changes.has(i) ? { ...row, [field]: changes.get(i) } : { ...row });
}
function scoreMap(report, threshold) {
  return new Map(compareSeries(report.series, { candidateThreshold: threshold, includeScores: true }).matched_scores.map(item => [`${item.station_id}\0${item.timestamp}`, item]));
}
function decisions(scores, station, timestamp) {
  const item = scores.get(`${station}\0${new Date(timestamp).toISOString()}`);
  if (!item) throw Error("A selected reading has insufficient comparable history.");
  return { current: item.current_flagged, candidate: item.candidate_flagged };
}

async function run(file, calibrationFile) {
  const csv = await fs.readFile(file, "utf8");
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  const calibration = JSON.parse(await fs.readFile(calibrationFile, "utf8"));
  const threshold = calibration?.calibration?.threshold_selection?.threshold;
  if (!Number.isFinite(threshold) || threshold < 0 || !rows.length || !["station_id", "timestamp", "temperature", "humidity", "pressure"].every(key => Object.hasOwn(rows[0], key))) throw Error("Invalid sample or calibrated threshold.");
  const ids = new Set(rows.map(row => row.station_id)); if (ids.size !== 1) throw Error("Use one station per synthetic experiment.");
  const station = rows[0].station_id, headers = Object.keys(rows[0]);
  const originalReport = await analyzeIsolated(csv);
  if (originalReport.thresholds.warning_score !== calibration.calibration.current_thresholds.warning_score || originalReport.thresholds.critical_score !== calibration.calibration.current_thresholds.critical_score) throw Error("Current detector thresholds differ from the calibration run.");
  const control = scoreMap(originalReport, threshold);
  const indexAt = timestamp => { const found = rows.findIndex(row => Date.parse(row.timestamp) === Date.parse(timestamp)); if (found < 0) throw Error(`Missing selected test time ${timestamp}.`); return found; };
  const spikeTimes = ["2024-02-15T00:00:00Z", "2024-02-15T09:00:00Z", "2024-02-15T18:00:00Z"];
  const spikes = [["temperature", 1], ["temperature", -1], ["temperature", 2], ["temperature", -2], ["humidity", 5], ["humidity", -5], ["pressure", 2], ["pressure", -2]];
  const cases = [];
  for (const timestamp of spikeTimes) for (const [field, delta] of spikes) {
    const index = indexAt(timestamp), original = decisions(control, station, timestamp);
    const altered = makeSpike(rows, index, field, delta);
    const replay = await analyzeIsolated(serialize(altered, headers));
    const injected = decisions(scoreMap(replay, threshold), station, timestamp);
    cases.push({ kind: "single_reading", timestamp, field, delta, original, injected });
  }
  for (const timestamp of ["2024-02-15T00:00:00Z", "2024-02-15T12:00:00Z"]) for (const [field, delta] of [["temperature", 2], ["humidity", 10], ["pressure", 5]]) {
    const index = indexAt(timestamp), altered = makeDrift(rows, index, field, delta);
    const replay = await analyzeIsolated(serialize(altered, headers));
    const injected = scoreMap(replay, threshold), start = Date.parse(timestamp), steps = [];
    for (let step = 1; step <= 8; step++) {
      const at = new Date(start + step * 3 * 3600_000).toISOString();
      steps.push({ hours: step * 3, original: decisions(control, station, at), injected: decisions(injected, station, at) });
    }
    cases.push({ kind: "24_hour_drift", timestamp, field, total_delta: delta, steps });
  }
  const singles = spikes.map(([field, delta]) => {
    const selected = cases.filter(item => item.kind === "single_reading" && item.field === field && item.delta === delta);
    return { field, delta, cases: selected.length, current_originally_flagged: selected.filter(item => item.original.current).length, current_after: selected.filter(item => item.injected.current).length, current_new_flags: selected.filter(item => !item.original.current && item.injected.current).length, candidate_originally_flagged: selected.filter(item => item.original.candidate).length, candidate_after: selected.filter(item => item.injected.candidate).length, candidate_new_flags: selected.filter(item => !item.original.candidate && item.injected.candidate).length };
  });
  const drifts = cases.filter(item => item.kind === "24_hour_drift").map(item => ({ field: item.field, total_delta: item.total_delta, start_utc: item.timestamp, current_first_new_flag_hours: item.steps.find(step => !step.original.current && step.injected.current)?.hours ?? null, candidate_first_new_flag_hours: item.steps.find(step => !step.original.candidate && step.injected.candidate)?.hours ?? null, current_control_flagged_steps: item.steps.filter(step => step.original.current).length, candidate_control_flagged_steps: item.steps.filter(step => step.original.candidate).length }));
  return { evaluated_at: new Date().toISOString(), dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), calibration_dataset: calibration.calibration.dataset, current_thresholds: originalReport.thresholds, candidate_threshold: threshold, singles, drifts, cases, notes: ["Each replay alters one selected field only, either once or as a 24-hour ramp; every scenario is run separately using earlier readings only.", "These are synthetic perturbations of unlabeled historical observations, not confirmed sensor faults or measurements of real-world accuracy.", "A new flag is a flag at a perturbed timestamp that the same detector did not flag in the unmodified control.", "Relative humidity is derived from the original temperature and dew point; modifying temperature or humidity alone can create physically inconsistent combinations.", "The sample contains one station, three spike start times, two drift start times, and limited anomaly sizes; it does not characterize all faults, missed detections, or long-term drift.", "The candidate threshold was fitted on January; February scenarios were not used to select it. The live detector remains unchanged."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, calibrationFile, output] = process.argv.slice(2);
  if (!file || !calibrationFile || !output) { console.error("Usage: node scripts/controlled-anomaly-evaluation.mjs <february.csv> <calibration.json> <new-report.json>"); process.exitCode = 1; }
  else run(file, calibrationFile).then(async result => { await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(`Controlled anomaly report written to ${output}`); }).catch(error => { console.error(`Controlled evaluation failed: ${error.message}`); process.exitCode = 1; });
}
