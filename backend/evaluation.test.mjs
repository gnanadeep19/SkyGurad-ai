import { describe, expect, it } from "vitest";
import { summarizeEvaluation } from "../scripts/evaluate-detector.mjs";

describe("historical evaluation summary", () => {
  const times = ["2024-01-01T01:00:00.000Z", "2024-01-01T02:00:00.000Z", "2024-01-01T03:00:00.000Z", "2024-01-01T04:00:00.000Z", "2024-01-01T05:00:00.000Z"];
  const report = { rows: 5, unique_observations: 5, period: null, thresholds: { warning_score: .32 }, historical_summary: { scored: 4, warning: 1, critical: 1 }, series: [
    { station_id: "A", timestamp: times[0], status: "Insufficient data", anomaly_score: null },
    { station_id: "A", timestamp: times[1], status: "Critical", anomaly_score: .9 },
    { station_id: "A", timestamp: times[2], status: "Warning", anomaly_score: .5 },
    { station_id: "A", timestamp: times[3], status: "Healthy", anomaly_score: .1 },
    { station_id: "A", timestamp: times[4], status: "Healthy", anomaly_score: .2 },
  ] };
  it("does not invent accuracy when labels are absent", () => {
    const result = summarizeEvaluation(report, [{ station_id: "A", timestamp: times[0] }]);
    expect(result.labeled_evaluation).toBeNull(); expect(result.flagged_fraction_of_scored).toBe(.5);
    expect(result.utc_hour_breakdown).toEqual([{hour_utc:2,scored:1,flagged:1,flagged_fraction:1},{hour_utc:3,scored:1,flagged:1,flagged_fraction:1},{hour_utc:4,scored:1,flagged:0,flagged_fraction:0},{hour_utc:5,scored:1,flagged:0,flagged_fraction:0}]);
    expect(result.observation_spacing_hours).toEqual({pairs:4,median:1,maximum:1});
  });
  it("excludes unscored labels and calculates confusion counts on supplied labels", () => {
    const rows = times.map((timestamp, index) => ({ station_id: "A", timestamp, fault_label: ["1", "1", "0", "0", "1"][index] }));
    const result = summarizeEvaluation(report, rows).labeled_evaluation;
    expect(result).toMatchObject({ labeled_rows: 5, scored_labeled_rows: 4, confusion: { true_positive: 1, false_positive: 1, true_negative: 1, false_negative: 1 }, precision: .5, recall: .5, accuracy: .5, false_positive_rate: .5, f1: .5 });
  });
  it("rejects ambiguous labels and accepts blank labels", () => {
    expect(() => summarizeEvaluation(report, [{ station_id: "A", timestamp: times[0], fault_label: "yes" }])).toThrow();
    expect(() => summarizeEvaluation(report, [{ station_id: "A", timestamp: times[0], fault_label: "1" }, { station_id: "A", timestamp: times[0], fault_label: "" }])).toThrow(/Duplicate/);
    expect(summarizeEvaluation(report, [{ station_id: "A", timestamp: times[0], fault_label: "" }]).labeled_evaluation).toBeNull();
  });
});
