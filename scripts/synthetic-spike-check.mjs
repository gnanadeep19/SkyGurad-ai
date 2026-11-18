// Controlled, synthetic single-reading perturbations on a historical dataset.
// No altered observations are persisted in the user's database or sent by email.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeIsolated } from "./evaluate-detector.mjs";
import { compareSeries } from "./compare-time-baseline.mjs";

export function decisionAt(series, stationId, timestamp) {
  const time = Date.parse(timestamp);
  const before = series.filter(point => point.station_id === stationId && Date.parse(point.timestamp) < time);
  const through = series.filter(point => point.station_id === stationId && Date.parse(point.timestamp) <= time);
  const previous = compareSeries(before), current = compareSeries(through);
  if (current.matched_observations !== previous.matched_observations + 1) return null;
  return { current_flagged: current.current_flagged > previous.current_flagged, candidate_flagged: current.candidate_flagged > previous.candidate_flagged };
}

const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
function stringify(rows, headers) { return [headers.map(quote).join(","), ...rows.map(row => headers.map(header => quote(row[header])).join(",")), ""].join("\n"); }

async function run(file, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Use a UTC date in YYYY-MM-DD format.");
  const csv = await fs.readFile(file, "utf8");
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  if (!rows.length || !["station_id", "timestamp", "temperature"].every(field => Object.hasOwn(rows[0], field))) throw Error("CSV needs station_id, timestamp and temperature columns.");
  const stations = new Set(rows.map(row => row.station_id));
  if (stations.size !== 1) throw Error("Use one station per controlled spike check.");
  const targetHours = [0, 3, 6, 9, 12, 15, 18, 21];
  const chosen = targetHours.map(hour => {
    const matches = rows.filter(row => row.timestamp.startsWith(`${day}T${String(hour).padStart(2, "0")}:`));
    if (matches.length !== 1 || !/Z$/i.test(matches[0].timestamp) || !Number.isFinite(Date.parse(matches[0].timestamp)) || !Number.isFinite(Number(matches[0].temperature))) throw Error(`Expected one valid ${hour}:00 UTC observation on ${day}.`);
    return matches[0];
  });
  const baseline = await analyzeIsolated(csv);
  const cases = [];
  for (const row of chosen) {
    const timestamp = new Date(row.timestamp).toISOString();
    const original = decisionAt(baseline.series, row.station_id, timestamp);
    if (!original) throw Error("A chosen observation lacks a comparable baseline.");
    for (const added of [5, 10]) {
      const altered = Number(row.temperature) + added;
      if (altered > 65) throw Error("A synthetic temperature would exceed input validation limits.");
      const modified = rows.map(item => item === row ? { ...item, temperature: String(altered) } : item);
      const replay = await analyzeIsolated(stringify(modified, Object.keys(rows[0])));
      const injected = decisionAt(replay.series, row.station_id, timestamp);
      if (!injected) throw Error("An injected observation lacks a comparable baseline.");
      cases.push({ timestamp, synthetic_temperature_increase_c: added, original, injected });
    }
  }
  const results = [5, 10].map(delta => {
    const selected = cases.filter(item => item.synthetic_temperature_increase_c === delta);
    return { synthetic_temperature_increase_c: delta, cases: selected.length, current_originally_flagged: selected.filter(item => item.original.current_flagged).length, candidate_originally_flagged: selected.filter(item => item.original.candidate_flagged).length, current_flagged_after_injection: selected.filter(item => item.injected.current_flagged).length, candidate_flagged_after_injection: selected.filter(item => item.injected.candidate_flagged).length };
  });
  return { dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), date_utc: day, evaluated_at: new Date().toISOString(), cases, summary: results, notes: ["Each replay changes one temperature reading only; the rest of the historical input is unchanged.", "Humidity in this sample was derived from the original temperature and dew point; keeping it unchanged after a temperature perturbation may create physical inconsistency and influence multivariate detection.", "These are synthetic, single-reading temperature increases, not verified physical sensor faults; the counts are not real-world recall or accuracy.", "Some unmodified observations were already flagged; compare the original and injected results.", "The current and experimental detectors have different score scales and thresholds; the experimental detector is not deployed.", "The eight selected hours are from one station on one day and are not a representative sample of all weather or fault types."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, day, output] = process.argv.slice(2);
  if (!file || !day) { console.error("Usage: node scripts/synthetic-spike-check.mjs <csv> <UTC-date> [new-report.json]"); process.exitCode = 1; }
  else run(file, day).then(async result => { const json = JSON.stringify(result, null, 2) + "\n"; if (output) { await fs.writeFile(output, json, { flag: "wx" }); console.log(`Synthetic spike report written to ${output}`); } else process.stdout.write(json); }).catch(error => { console.error(`Synthetic spike check failed: ${error.message}`); process.exitCode = 1; });
}
