// Offline evaluation only. Reads CSV files and writes a new report; no backend or email.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeDrift, DRIFT_DEMO_DELTAS, DRIFT_THRESHOLDS, type DriftField, type DriftReading, type DriftResult } from "../frontend/src/lib/drift.js";

const fields: DriftField[] = ["temperature", "humidity", "pressure"];
const ranges: Record<DriftField, [number, number]> = { temperature: [-90, 65], humidity: [0, 100], pressure: [300, 1100] };

export function injectRamp(rows: DriftReading[], field: DriftField, delta: number): DriftReading[] | null {
  if (!rows.length || !Number.isFinite(delta)) throw new Error("A valid series and ramp size are required.");
  const end = Math.max(...rows.map(row => Date.parse(row.timestamp)));
  if (!Number.isFinite(end)) throw new Error("Invalid observation timestamp.");
  const result = rows.map(row => {
    const fraction = Math.max(0, Math.min(1, (Date.parse(row.timestamp) - (end - 24 * 3600_000)) / (24 * 3600_000)));
    return { ...row, [field]: row[field] + delta * fraction };
  });
  return result.some(row => !Number.isFinite(row[field]) || row[field] < ranges[field][0] || row[field] > ranges[field][1]) ? null : result;
}

export function selectPrefix(rows: DriftReading[], target: string): DriftReading[] {
  const targetTime = Date.parse(target);
  if (!Number.isFinite(targetTime)) throw new Error("Invalid target timestamp.");
  const eligible = rows.filter(row => Date.parse(row.timestamp) <= targetTime).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!eligible.length || targetTime - Date.parse(eligible[eligible.length - 1].timestamp) > 3 * 3600_000) return [];
  return eligible;
}

type Experiment = { field: DriftField; delta: number; control: DriftResult; simulated: DriftResult | null; skipped: string | null };
export function compareWindow(rows: DriftReading[]): Experiment[] {
  return fields.flatMap(field => [-1, 1].map(direction => {
    const delta = direction * DRIFT_DEMO_DELTAS[field];
    const control = analyzeDrift(rows, field);
    const modified = injectRamp(rows, field, delta);
    return { field, delta, control, simulated: modified ? analyzeDrift(modified, field) : null, skipped: modified ? null : "Ramp would exceed broad input validation limits." };
  }));
}

export function summarize(cases: Experiment[]) {
  return fields.flatMap(field => [-1, 1].map(direction => {
    const selected = cases.filter(item => item.field === field && Math.sign(item.delta) === direction);
    const eligible = selected.filter(item => item.control.status === "no_shift" && item.simulated?.status !== undefined && item.simulated.status !== "insufficient");
    return { field, delta: direction * DRIFT_DEMO_DELTAS[field], cases: selected.length, out_of_range: selected.filter(item => item.skipped).length, insufficient: selected.filter(item => !item.skipped && (item.control.status === "insufficient" || item.simulated?.status === "insufficient")).length, originally_flagged: selected.filter(item => !item.skipped && item.control.status === "review").length, eligible: eligible.length, new_flags: eligible.filter(item => item.simulated?.status === "review").length, suppressed_flags: selected.filter(item => !item.skipped && item.control.status === "review" && item.simulated?.status === "no_shift").length };
  }));
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
    if (rows.some(row => row.timestamp.slice(0, 7) !== month)) throw new Error(`Expected a single UTC month in ${file}.`);
    const windows = [15, 20, 25].map(day => {
      const target = `${month}-${day}T21:00:00Z`, prefix = selectPrefix(rows, target);
      if (!prefix.length) return { target, actual_end: null, skipped: "No observation at or within three hours before the target.", cases: [] as Experiment[] };
      return { target, actual_end: new Date(Date.parse(prefix[prefix.length - 1].timestamp)).toISOString(), skipped: null, cases: compareWindow(prefix) };
    });
    datasets.push({ dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), station_id: rows[0].station_id, month, rows: rows.length, windows });
  }
  const all = datasets.flatMap(dataset => dataset.windows.flatMap(window => window.cases));
  return { evaluated_at: new Date().toISOString(), method: "Experimental same-UTC-hour residual change; thresholds fixed before this evaluation", thresholds: DRIFT_THRESHOLDS, target_selection: "Days 15, 20 and 25 at 21:00 UTC; last reading at or before target within three hours, selected without examining outcomes", datasets, summary: summarize(all), limitations: ["Historical windows are unlabeled; control flags are not measured false positives and synthetic new flags are not measured field recall.", "Each synthetic ramp changes one variable over 24 hours independently; out-of-range cases are skipped, not clipped.", "Humidity in these NOAA samples is derived from temperature and dew point; independent changes can be physically inconsistent.", "Windows overlap in their baseline history and cannot be treated as independent trials. These station-months have been explored in earlier project experiments.", "This evaluation does not change the live detector, stored telemetry, incidents, or notifications."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...files] = process.argv.slice(2);
  if (!output || !files.length) { console.error("Usage: npx tsx scripts/evaluate-drift-review.ts <new-report.json> <station-month.csv> [...]"); process.exitCode = 1; }
  else evaluate(files).then(async report => { await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(`Report written to ${output}`); }).catch(error => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; });
}
