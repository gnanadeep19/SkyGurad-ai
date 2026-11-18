// Offline empirical flag-rate matching. No fault-rate claim is made.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeIsolated } from "./evaluate-detector.mjs";
import { compareSeries } from "./compare-time-baseline.mjs";

export function calibrateThreshold(scores, targetCount) {
  if (!scores.length || !Number.isInteger(targetCount) || targetCount < 0 || targetCount > scores.length || scores.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw Error("Invalid calibration scores.");
  const sorted = Array.from(new Set(scores)).sort((a, b) => b - a);
  const thresholds = [sorted[0] + Math.max(1e-9, Math.abs(sorted[0]) * 1e-12), ...sorted];
  const candidates = thresholds.map(threshold => ({ threshold, flagged: scores.filter(score => score >= threshold).length }));
  candidates.sort((a, b) => Math.abs(a.flagged - targetCount) - Math.abs(b.flagged - targetCount) || a.flagged - b.flagged);
  return { ...candidates[0], target_flagged: targetCount, scored: scores.length };
}

async function run(calibrationFile, testFiles) {
  const calibrationCsv = await fs.readFile(calibrationFile, "utf8");
  const baseline = await analyzeIsolated(calibrationCsv);
  const matched = compareSeries(baseline.series, { includeScores: true });
  const fitted = calibrateThreshold(matched.matched_scores.map(item => item.candidate_score), matched.current_flagged);
  const calibration = compareSeries(baseline.series, { candidateThreshold: fitted.threshold });
  const tests = [];
  for (const file of testFiles) {
    const csv = await fs.readFile(file, "utf8");
    const report = await analyzeIsolated(csv);
    if (report.thresholds.warning_score !== baseline.thresholds.warning_score || report.thresholds.critical_score !== baseline.thresholds.critical_score) throw Error("Detector settings changed during evaluation.");
    tests.push({ dataset: path.basename(file), sha256: createHash("sha256").update(csv).digest("hex"), period: report.period, comparison: compareSeries(report.series, { candidateThreshold: fitted.threshold }) });
  }
  return { evaluated_at: new Date().toISOString(), calibration: { dataset: path.basename(calibrationFile), sha256: createHash("sha256").update(calibrationCsv).digest("hex"), current_thresholds: baseline.thresholds, threshold_selection: fitted, comparison: calibration }, tests, notes: ["The candidate threshold is fitted once to approximate the current detector's flag count on the January Chennai development sample; held-out periods and stations are not used to choose it.", "Each dataset is replayed independently and only matched scored observations are compared. Both baselines use earlier readings only.", "Matching an overall flag rate on unlabeled observations does not prove equal sensitivity, equal false-positive rates, or fault-detection accuracy.", "Temperature and station pressure are NOAA source 223 quality code 1; humidity is derived (code D), not independently measured, and its quality code is blank.", "The time baseline and calibrated threshold are experimental and do not modify the live detector."] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [calibration, output, ...tests] = process.argv.slice(2);
  if (!calibration || !output || !tests.length) { console.error("Usage: node scripts/calibrated-comparison.mjs <calibration.csv> <new-report.json> <test.csv> [...]"); process.exitCode = 1; }
  else run(calibration, tests).then(async result => { await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(`Calibrated comparison written to ${output}`); }).catch(error => { console.error(`Calibrated comparison failed: ${error.message}`); process.exitCode = 1; });
}
