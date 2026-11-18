// Offline evaluation only. No database, incidents, live detector, or email.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeDrift, DRIFT_THRESHOLDS, type DriftField, type DriftReading, type DriftResult } from "../frontend/src/lib/drift.js";
import { selectPrefix } from "./evaluate-drift-review.js";

const fields: DriftField[] = ["temperature", "humidity", "pressure"];
const ranges: Record<DriftField, [number, number]> = { temperature: [-90, 65], humidity: [0, 100], pressure: [300, 1100] };
const magnitudes: Record<DriftField, number[]> = { temperature: [1, 2], humidity: [5, 10], pressure: [2, 4] };
const hour = 3600_000;

export function injectSlowRamp(input: DriftReading[], field: DriftField, delta: number, durationHours: number): { rows: DriftReading[] | null; skipped: "coverage" | "out_of_range" | null } {
  if (!input.length || !Number.isFinite(delta) || !Number.isFinite(durationHours) || durationHours <= 0) throw new Error("A series, finite ramp size and positive duration are required.");
  const rows = [...input].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const times = rows.map(row => Date.parse(row.timestamp));
  if (times.some((time, i) => !Number.isFinite(time) || (i > 0 && time === times[i - 1]))) throw new Error("Invalid or duplicate timestamps.");
  const end = times[times.length - 1], start = end - durationHours * hour;
  let anchor = -1;
  for (let i = 0; i < times.length && times[i] <= start; i++) anchor = i;
  if (anchor < 0 || start - times[anchor] > 6 * hour || times.slice(anchor + 1).some((time, i) => time - times[anchor + i] > 6 * hour)) return { rows: null, skipped: "coverage" };
  const modified = rows.map(row => ({ ...row, [field]: row[field] + delta * Math.max(0, Math.min(1, (Date.parse(row.timestamp) - start) / (durationHours * hour))) }));
  if (modified.some(row => !Number.isFinite(row[field]) || row[field] < ranges[field][0] || row[field] > ranges[field][1])) return { rows: null, skipped: "out_of_range" };
  return { rows: modified, skipped: null };
}

type Case = { field: DriftField; duration_hours: number; delta: number; control: DriftResult; simulated: DriftResult | null; skipped: "coverage" | "out_of_range" | "insufficient_control" | "insufficient_simulated" | null };
export function compareSlowWindow(rows: DriftReading[]): { controls: Record<DriftField, DriftResult>; cases: Case[] } {
  const controls = Object.fromEntries(fields.map(field => [field, analyzeDrift(rows, field)])) as Record<DriftField, DriftResult>;
  const cases = fields.flatMap(field => [72, 120].flatMap(duration_hours => magnitudes[field].flatMap(size => [-1, 1].map(direction => {
    const delta = direction * size, control = controls[field];
    if (control.status === "insufficient") return { field, duration_hours, delta, control, simulated: null, skipped: "insufficient_control" as const };
    const injected = injectSlowRamp(rows, field, delta, duration_hours);
    if (!injected.rows) return { field, duration_hours, delta, control, simulated: null, skipped: injected.skipped };
    const simulated = analyzeDrift(injected.rows, field);
    return { field, duration_hours, delta, control, simulated, skipped: simulated.status === "insufficient" ? "insufficient_simulated" as const : null };
  }))));
  return { controls, cases };
}

export function summarize(cases: Case[]) {
  return fields.flatMap(field => [72, 120].flatMap(duration_hours => magnitudes[field].flatMap(size => [-1, 1].map(direction => {
    const delta = direction * size;
    const selected = cases.filter(item => item.field === field && item.duration_hours === duration_hours && item.delta === delta);
    const available = selected.filter(item => !item.skipped);
    const eligible = available.filter(item => item.control.status === "no_shift");
    return { field, duration_hours, delta, attempted: selected.length, insufficient_control: selected.filter(item => item.skipped === "insufficient_control").length, insufficient_simulated: selected.filter(item => item.skipped === "insufficient_simulated").length, coverage: selected.filter(item => item.skipped === "coverage").length, out_of_range: selected.filter(item => item.skipped === "out_of_range").length, originally_flagged: available.filter(item => item.control.status === "review").length, eligible: eligible.length, new_flags: eligible.filter(item => item.simulated?.status === "review").length, suppressed_flags: available.filter(item => item.control.status === "review" && item.simulated?.status === "no_shift").length };
  }))));
}

export async function evaluate(files: string[]) {
  const datasets = [];
  for (const file of files) {
    const csv = await fs.readFile(file, "utf8");
    const parsed: Record<string, string>[] = parse(csv, { columns: true, bom: true, skip_empty_lines: true });
    const rows: DriftReading[] = parsed.map(row => {
      if (!row.station_id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/i.test(row.timestamp) || fields.some(field => !row[field]?.trim() || !Number.isFinite(Number(row[field])))) throw new Error(`Invalid required field in ${file}.`);
      return { station_id: row.station_id, timestamp: row.timestamp, temperature: Number(row.temperature), humidity: Number(row.humidity), pressure: Number(row.pressure) };
    });
    if (!rows.length || new Set(rows.map(row => row.station_id)).size !== 1 || new Set(rows.map(row => Date.parse(row.timestamp))).size !== rows.length || rows.some(row => !Number.isFinite(Date.parse(row.timestamp)) || fields.some(field => row[field] < ranges[field][0] || row[field] > ranges[field][1]))) throw new Error(`Invalid, duplicate or mixed-station data in ${file}.`);
    const month = rows[0].timestamp.slice(0, 7);
    if (rows.some(row => row.timestamp.slice(0, 7) !== month)) throw new Error(`Expected one UTC month in ${file}.`);
    const windows = Array.from({ length: 17 }, (_, index) => {
      const target = `${month}-${String(index + 12).padStart(2, "0")}T21:00:00Z`, prefix = selectPrefix(rows, target);
      return prefix.length ? { target, actual_end: prefix[prefix.length - 1].timestamp, skipped: null, ...compareSlowWindow(prefix) } : { target, actual_end: null, skipped: "No observation at or within three hours before the target.", controls: null, cases: [] as Case[] };
    });
    datasets.push({ dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), station_id: rows[0].station_id, month, rows: rows.length, windows });
  }
  const windows = datasets.flatMap(dataset => dataset.windows);
  const cases = windows.flatMap(window => window.cases);
  const controls = fields.map(field => { const results = windows.flatMap(window => window.controls ? [window.controls[field]] : []); return { field, windows: results.length, review: results.filter(result => result.status === "review").length, no_shift: results.filter(result => result.status === "no_shift").length, insufficient: results.filter(result => result.status === "insufficient").length }; });
  return { evaluated_at: new Date().toISOString(), method: "Experimental same-hour residual heuristic; existing thresholds unchanged", thresholds: DRIFT_THRESHOLDS, target_selection: "Days 12–28 at 21:00 UTC, using observations no later than the target and ending at most three hours before it", scenario: "Independent linear ramps over 72 or 120 hours; require an observation at or before ramp start within six hours and no gaps over six hours through the endpoint. Reject out-of-range values without clipping.", controls, summary: summarize(cases), datasets, limitations: ["Unmodified observations are unlabeled: review flags are not established false positives, and synthetic detections are not real-world recall.", "Humidity is derived from temperature and dew point; independently injected changes can be physically inconsistent.", "Windows overlap substantially and station-month samples were explored previously; results are not independent held-out evidence.", "The ramp also changes historical baseline observations; the measured endpoint is the total injected change, not the change in the latest day.", "This offline experiment does not modify telemetry, the live detector, incidents or notifications."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...files] = process.argv.slice(2);
  if (!output || !files.length) { console.error("Usage: npx tsx scripts/evaluate-slow-drift.ts <new-report.json> <station-month.csv> [...]"); process.exitCode = 1; }
  else evaluate(files).then(async report => { await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(`Report written to ${output}`); }).catch(error => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; });
}
