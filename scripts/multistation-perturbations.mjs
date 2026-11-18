// Independent, offline perturbations. Each replay uses temporary backend storage.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeIsolated } from "./evaluate-detector.mjs";
import { compareSeries } from "./compare-time-baseline.mjs";
import { makeSpike } from "./controlled-anomaly-evaluation.mjs";

const scenarios = [["temperature", 1], ["temperature", -1], ["humidity", 5], ["humidity", -5], ["pressure", 2], ["pressure", -2]];
const ramps = [["temperature", 2], ["humidity", 10], ["pressure", 5]];
const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const serialize = (rows, headers) => [headers.map(quote).join(","), ...rows.map(row => headers.map(header => quote(row[header])).join(",")), ""].join("\n");
const decisions = (report, threshold) => new Map(compareSeries(report.series, { candidateThreshold: threshold, includeScores: true }).matched_scores.map(row => [row.timestamp, { current: row.current_flagged, candidate: row.candidate_flagged }]));

// Apply a linear ramp to every reading, including hourly samples between the
// three-hour points. Reject gaps, duplicates and missing end points.
export function makeElapsedRamp(rows, index, field, delta) {
  const start = Date.parse(rows[index]?.timestamp), end = start + 24 * 3600_000;
  if (!Number.isFinite(start)) throw Error("Invalid ramp start.");
  const selected = rows.map((row, i) => ({ i, time: Date.parse(row.timestamp) })).filter(item => item.time > start && item.time <= end).sort((a, b) => a.time - b.time);
  if (!selected.length || selected.at(-1).time !== end) throw Error("Ramp requires a reading at 24 hours.");
  let previous = start, result = rows;
  for (const item of selected) {
    if (item.time <= previous || item.time - previous > 3 * 3600_000) throw Error("Ramp requires unique readings with gaps no greater than three hours.");
    result = makeSpike(result, item.i, field, delta * (item.time - start) / (24 * 3600_000));
    previous = item.time;
  }
  return result;
}

// Fixed UTC targets are chosen before reading scores. The first exact valid,
// comparable observation at or after each target is selected within 12 hours.
export function selectAnchors(rows, control, targets) {
  const used = new Set();
  return targets.map(target => {
    const start = Date.parse(target);
    if (!Number.isFinite(start)) throw Error("Invalid anchor target.");
    const selected = rows.findIndex(row => {
      const t = Date.parse(row.timestamp);
      return t >= start && t < start + 12 * 3600_000 && control.has(new Date(t).toISOString()) && !used.has(t);
    });
    if (selected < 0) throw Error(`No eligible reading within 12 hours of ${target}.`);
    used.add(Date.parse(rows[selected].timestamp));
    return selected;
  });
}

export async function runExperiments(files, calibrationFile, progress = () => {}) {
  const calibration = JSON.parse(await fs.readFile(calibrationFile, "utf8"));
  const threshold = calibration?.calibration?.threshold_selection?.threshold;
  if (!Number.isFinite(threshold) || threshold < 0) throw Error("Invalid saved candidate threshold.");
  const results = [];
  for (const file of files) {
    const csv = await fs.readFile(file, "utf8");
    const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true });
    if (!rows.length || new Set(rows.map(row => row.station_id)).size !== 1) throw Error("Each dataset must contain one station.");
    const baseline = await analyzeIsolated(csv);
    if (baseline.thresholds.warning_score !== calibration.calibration.current_thresholds.warning_score || baseline.thresholds.critical_score !== calibration.calibration.current_thresholds.critical_score) throw Error("Detector settings differ from calibration.");
    const control = decisions(baseline, threshold);
    const month = rows[0].timestamp.slice(0, 7);
    const anchors = selectAnchors(rows, control, [`${month}-15T00:00:00Z`, `${month}-16T12:00:00Z`]);
    const headers = Object.keys(rows[0]);
    const cases = [];
    for (const index of anchors) {
      const timestamp = new Date(rows[index].timestamp).toISOString();
      for (const [field, delta] of scenarios) {
        let altered;
        try { altered = makeSpike(rows, index, field, delta); }
        catch (error) { cases.push({ kind: "spike", timestamp, field, delta, skipped: error.message }); continue; }
        const injected = decisions(await analyzeIsolated(serialize(altered, headers)), threshold).get(timestamp);
        if (!injected) throw Error(`Missing altered score at ${timestamp}.`);
        cases.push({ kind: "spike", timestamp, field, delta, original: control.get(timestamp), injected });
        progress(`${path.basename(file)} ${timestamp} ${field} ${delta}`);
      }
    }
    // One fixed start per dataset; ramp every available reading up to 24 hours.
    const index = anchors[0], timestamp = new Date(rows[index].timestamp).toISOString();
    for (const [field, delta] of ramps) {
      let altered;
      try { altered = makeElapsedRamp(rows, index, field, delta); }
      catch (error) { cases.push({ kind: "24_hour_ramp", timestamp, field, delta, skipped: error.message }); continue; }
      const injected = decisions(await analyzeIsolated(serialize(altered, headers)), threshold);
      const steps = rows.filter(row => Date.parse(row.timestamp) > Date.parse(timestamp) && Date.parse(row.timestamp) <= Date.parse(timestamp) + 24 * 3600_000).map(row => {
        const at = new Date(row.timestamp).toISOString();
        const original = control.get(at), modified = injected.get(at);
        if (!original || !modified) throw Error(`Missing comparable ramp score at ${at}.`);
        return { hours: (Date.parse(at) - Date.parse(timestamp)) / 3600_000, original, injected: modified };
      });
      cases.push({ kind: "24_hour_ramp", timestamp, field, delta, steps });
      progress(`${path.basename(file)} ${timestamp} ${field} ramp`);
    }
    results.push({ dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), station_id: rows[0].station_id, anchors: anchors.map(i => new Date(rows[i].timestamp).toISOString()), cases });
  }
  return { evaluated_at: new Date().toISOString(), calibration_dataset: calibration.calibration.dataset, calibration_sha256: calibration.calibration.sha256, candidate_threshold: threshold, current_thresholds: calibration.calibration.current_thresholds, datasets: results, notes: ["Each case replays one separately altered unlabeled dataset in temporary storage; there are no live detector or notification changes.", "The January Chennai calibration is fixed; held-out cases did not select the thresholds.", "A new flag appears on an altered reading that was not flagged at that time in the same method's unmodified control. Counts exclude already-flagged control readings.", "A ramp starts at the first selected time and changes every observation for 24 hours, using its actual elapsed time. Missing endpoint, gaps over three hours and out-of-range perturbations are skipped, not filled.", "Humidity is derived from temperature and dew point. Independent synthetic perturbations may produce physically inconsistent combinations.", "Synthetic anomalies are not verified sensor faults; these counts are not real-world recall or false-positive rates."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [calibration, output, ...files] = process.argv.slice(2);
  if (!calibration || !output || !files.length) { console.error("Usage: node scripts/multistation-perturbations.mjs <calibration.json> <new-output.json> <station-month.csv> [...]"); process.exitCode = 1; }
  else runExperiments(files, calibration, message => console.log(message)).then(async result => { await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(`Report written to ${output}`); }).catch(error => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; });
}
