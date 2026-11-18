/** Offline teaching heuristic: a sustained change is not proof of sensor drift. */
export type DriftField = "temperature" | "humidity" | "pressure";
export type DriftReading = { station_id: string; timestamp: string; temperature: number; humidity: number; pressure: number };
export type DriftStatus = "insufficient" | "no_shift" | "review";
export type DriftResult = { status: DriftStatus; change: number | null; threshold: number; samples: number; consistency: number | null; reason: string };
export const DRIFT_THRESHOLDS: Record<DriftField, number> = { temperature: 1, humidity: 5, pressure: 2 };
export const DRIFT_DEMO_DELTAS: Record<DriftField, number> = { temperature: 4, humidity: 15, pressure: 6 };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };

export function analyzeDrift(rows: DriftReading[], field: DriftField): DriftResult {
  const threshold = DRIFT_THRESHOLDS[field];
  const insufficient = (reason: string, samples = 0): DriftResult => ({ status: "insufficient", change: null, threshold, samples, consistency: null, reason });
  if (!rows.length || new Set(rows.map(row => row.station_id)).size !== 1) return insufficient("Choose observations from one station.");
  const sorted = [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (sorted.some(row => !Number.isFinite(Date.parse(row.timestamp)) || !Number.isFinite(row[field]))) return insufficient("Invalid timestamps or readings cannot be analyzed.");
  const times = sorted.map(row => Date.parse(row.timestamp));
  if (times.some((time, i) => i > 0 && time === times[i - 1])) return insufficient("Duplicate timestamps cannot be analyzed.");
  const end = times[times.length - 1], start = end - 24 * 3600_000;
  const recent = sorted.filter(row => Date.parse(row.timestamp) >= start);
  if (recent.length < 6 || Date.parse(recent[0].timestamp) > start + 6 * 3600_000) return insufficient("At least six observations covering 18 hours are needed in the latest 24 hours.", recent.length);
  if (recent.some((row, i) => i > 0 && Date.parse(row.timestamp) - Date.parse(recent[i - 1].timestamp) > 6 * 3600_000)) return insufficient("The latest 24-hour window has a gap over six hours.", recent.length);
  const buckets = new Map<number, Map<string, number>>();
  const residuals: Array<{ time: number; value: number }> = [];
  for (const row of sorted) {
    const time = Date.parse(row.timestamp), date = new Date(time), hour = date.getUTCHours(), day = date.toISOString().slice(0, 10);
    const bucket = buckets.get(hour) ?? new Map<string, number>();
    // Use only earlier days in the prior 14-day window; one value per UTC day/hour.
    const prior = Array.from(bucket.entries()).filter(([d]) => d < day && Date.parse(`${d}T00:00:00Z`) >= Date.parse(`${day}T00:00:00Z`) - 14 * 86400_000).map(([, value]) => value);
    if (time >= start) {
      if (prior.length < 7) return insufficient("Each recent UTC hour needs at least seven earlier days of observations.", residuals.length);
      residuals.push({ time, value: row[field] - median(prior) });
    }
    bucket.set(day, row[field]);
    while (bucket.size > 15) bucket.delete(bucket.keys().next().value!);
    buckets.set(hour, bucket);
  }
  const first = residuals.filter(row => row.time <= end - 12 * 3600_000).map(row => row.value);
  const second = residuals.filter(row => row.time > end - 12 * 3600_000).map(row => row.value);
  if (first.length < 3 || second.length < 3) return insufficient("At least three comparable readings are needed in each half of the latest day.", residuals.length);
  const change = median(second) - median(first);
  const comparisons = first.flatMap(a => second.map(b => Math.sign(change) * (b - a)));
  const consistency = comparisons.filter(diff => diff > 0).length / comparisons.length;
  const flagged = Math.abs(change) >= threshold && consistency >= .7;
  return { status: flagged ? "review" : "no_shift", change, threshold, samples: residuals.length, consistency, reason: flagged ? "A sustained change relative to the earlier same-hour baseline warrants review." : "The recent pattern did not meet this experimental review rule." };
}

export function simulateDrift(rows: DriftReading[], field: DriftField): DriftReading[] {
  if (!rows.length) return [];
  const end = Math.max(...rows.map(row => Date.parse(row.timestamp))), start = end - 24 * 3600_000;
  return rows.map(row => { const fraction = Math.max(0, Math.min(1, (Date.parse(row.timestamp) - start) / (24 * 3600_000))); return { ...row, [field]: row[field] + DRIFT_DEMO_DELTAS[field] * fraction }; });
}

export function makeDriftDemo(): DriftReading[] {
  const start = Date.parse("2024-02-01T00:00:00Z");
  return Array.from({ length: 15 * 8 + 1 }, (_, i) => {
    const hour = (i % 8) * 3, daily = Math.sin((hour - 6) * Math.PI / 12), variation = .08 * Math.sin(i * 1.7);
    return { station_id: "DEMO-001", timestamp: new Date(start + i * 3 * 3600_000).toISOString(), temperature: 25 + 4 * daily + variation, humidity: 60 - 12 * daily + variation, pressure: 1008 + 1.5 * Math.cos(hour * Math.PI / 12) + variation };
  });
}
