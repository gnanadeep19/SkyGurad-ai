/** Scores are model indicators between 0 and 1, not fault probabilities. */
export function formatAnomalyScore(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value.toFixed(2) : "—";
}
