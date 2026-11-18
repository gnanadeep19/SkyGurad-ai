import { analyzeDrift, type DriftField, type DriftReading } from "../frontend/src/lib/drift.js";

/** Conservative review signals; neither a flat value nor a shift proves a fault. */
export function sustainedSignals(rows: DriftReading[], includeDrift = true) {
  const sorted = [...rows].sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const fields: DriftField[] = ["temperature", "humidity", "pressure"];
  const frozen: DriftField[] = [], drift: DriftField[] = [];
  if (!sorted.length) return { frozen, drift };
  const end = Date.parse(sorted[sorted.length - 1].timestamp);
  const recent = sorted.filter(row => Date.parse(row.timestamp) >= end - 2 * 3600_000);
  if (recent.length >= 8 && end - Date.parse(recent[0].timestamp) >= 3600_000 && recent.every((row,i) => i === 0 || Date.parse(row.timestamp) - Date.parse(recent[i-1].timestamp) <= 30 * 60_000)) {
    const tolerance = { temperature: 0.05, humidity: 0.1, pressure: 0.1 };
    for (const field of fields) {
      const values = recent.map(row => row[field]);
      if (values.every(Number.isFinite) && Math.max(...values) - Math.min(...values) <= tolerance[field]) frozen.push(field);
    }
  }
  if (includeDrift) for (const field of fields) if (analyzeDrift(sorted, field).status === "review") drift.push(field);
  return { frozen, drift };
}
