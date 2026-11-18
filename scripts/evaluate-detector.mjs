// Isolated historical evaluation: does not use the user's database or email.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

export function summarizeEvaluation(report, rows) {
  const columns = rows.length ? Object.keys(rows[0]).map(key => key.toLowerCase()) : [];
  const labelColumn = columns.includes("fault_label");
  const labels = new Map();
  const identities = new Set(), duplicates = new Set();
  if (labelColumn) for (const row of rows) {
    const item = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
    const label = String(item.fault_label ?? "").trim();
    if (label && label !== "0" && label !== "1") throw new Error("fault_label must be 0, 1, or blank.");
    const station = String(item.station_id ?? item.station ?? item.stationid ?? item.call_sign ?? "").trim();
    const rawTime = String(item.timestamp ?? item.time ?? item.datetime ?? item.date_time ?? "").trim();
    const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(rawTime) ? Date.parse(rawTime) : NaN;
    if (!station || !Number.isFinite(timestamp)) { if (label) throw new Error("Each labeled row needs a station ID and timestamp with timezone."); continue; }
    const key = `${station}\0${new Date(timestamp).toISOString()}`;
    if (identities.has(key)) duplicates.add(key); else identities.add(key);
    if (label) labels.set(key, Number(label));
  }
  if (Array.from(duplicates).some(key => labels.has(key))) throw new Error("Duplicate labeled station timestamps are not supported.");
  const confusion = { true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0 };
  let scoredLabels = 0;
  for (const point of report.series) {
    const label = labels.get(`${point.station_id}\0${point.timestamp}`);
    if (label === undefined || point.anomaly_score === null) continue;
    scoredLabels++;
    const predicted = point.status === "Warning" || point.status === "Critical";
    if (predicted && label === 1) confusion.true_positive++;
    else if (predicted) confusion.false_positive++;
    else if (label === 1) confusion.false_negative++;
    else confusion.true_negative++;
  }
  const ratio = (numerator, denominator) => denominator ? Number((numerator / denominator).toFixed(4)) : null;
  const hourly = new Map();
  const byStation = new Map();
  for (const point of report.series) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time)) continue;
    const timestamps = byStation.get(point.station_id) ?? [];
    timestamps.push(time); byStation.set(point.station_id, timestamps);
    if (point.anomaly_score === null) continue;
    const hour = new Date(time).getUTCHours();
    const group = hourly.get(hour) ?? { hour_utc: hour, scored: 0, flagged: 0 };
    group.scored++;
    if (point.status === "Warning" || point.status === "Critical") group.flagged++;
    hourly.set(hour, group);
  }
  const gaps = [];
  for (const timestamps of byStation.values()) {
    timestamps.sort((a, b) => a - b);
    for (let i = 1; i < timestamps.length; i++) if (timestamps[i] > timestamps[i - 1]) gaps.push((timestamps[i] - timestamps[i - 1]) / 3600000);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? (gaps[Math.floor((gaps.length - 1) / 2)] + gaps[Math.floor(gaps.length / 2)]) / 2 : null;
  return {
    rows: report.rows, unique_observations: report.unique_observations, period: report.period,
    historical_summary: report.historical_summary, thresholds: report.thresholds,
    flagged_fraction_of_scored: ratio(report.historical_summary.warning + report.historical_summary.critical, report.historical_summary.scored),
    utc_hour_breakdown: Array.from(hourly.values()).sort((a, b) => a.hour_utc - b.hour_utc).map(group => ({ ...group, flagged_fraction: ratio(group.flagged, group.scored) })),
    observation_spacing_hours: { pairs: gaps.length, median: medianGap, maximum: gaps.length ? gaps[gaps.length - 1] : null },
    labeled_evaluation: scoredLabels ? { labeled_rows: labels.size, scored_labeled_rows: scoredLabels, confusion, precision: ratio(confusion.true_positive, confusion.true_positive + confusion.false_positive), recall: ratio(confusion.true_positive, confusion.true_positive + confusion.false_negative), accuracy: ratio(confusion.true_positive + confusion.true_negative, scoredLabels), false_positive_rate: ratio(confusion.false_positive, confusion.false_positive + confusion.true_negative), f1: ratio(2 * confusion.true_positive, 2 * confusion.true_positive + confusion.false_positive + confusion.false_negative) } : null,
    notes: ["Rolling evaluation scores each observation using earlier observations only; it is not an independent deployment validation.", "Flagged observations are not confirmed sensor faults.", "Hourly groups use UTC; flag frequency and gaps do not establish a cause or a sensor fault.", labelColumn ? "Metrics depend on the supplied fault labels; blank, invalid, or baseline-unscored rows are not scored." : "No fault labels were supplied; false-positive rate, precision and recall cannot be determined."]
  };
}

export async function analyzeIsolated(csv) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-historical-eval-"));
  let child;
  try {
    const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "backend/index.ts"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATABASE_URL: "", SKYGUARD_DATA_DIR: root, SKYGUARD_USERS_FILE: path.join(root, "users.json"), SKYGUARD_SOURCE_MODE: "replay", SKYGUARD_BACKGROUND_INGESTION: "0", SKYGUARD_EMAIL_ENABLED: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", code = ""; child.stdout.on("data", chunk => { output += String(chunk); code = output.match(/setup code: ([a-f0-9]{36})/)?.[1] ?? code; }); child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(`${base}/api/auth/status`)).ok; } catch {} if (ready && code) break; if (child.exitCode !== null) throw Error("Evaluation backend exited."); await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!ready || !code) throw Error("Evaluation backend did not start.");
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "evaluation-admin", password: "isolated-evaluation-password", code }) });
    if (!setup.ok) throw Error("Could not start isolated evaluation.");
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ csv }) });
    const report = await response.json(); if (!response.ok) throw Error(report.error ?? "Analysis failed.");
    return report;
  } finally {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function evaluate(file) {
  const csv = await fs.readFile(file, "utf8");
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  const report = await analyzeIsolated(csv);
  return { dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), evaluated_at: new Date().toISOString(), ...summarizeEvaluation(report, rows) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) { console.error("Usage: node scripts/evaluate-detector.mjs <observations.csv> [new-report.json]"); process.exitCode = 1; }
  else evaluate(input).then(async report => {
    const output = JSON.stringify(report, null, 2) + "\n";
    if (process.argv[3]) { await fs.writeFile(process.argv[3], output, { flag: "wx" }); console.log(`Evaluation report written to ${process.argv[3]}`); }
    else process.stdout.write(output);
  }).catch(error => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; });
}
