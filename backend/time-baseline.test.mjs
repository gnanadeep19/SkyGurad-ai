import { describe, expect, it } from "vitest";
import { compareSeries } from "../scripts/compare-time-baseline.mjs";
import { decisionAt } from "../scripts/synthetic-spike-check.mjs";

const reading = (day, minute = 0, temperature = 20, station = "A") => ({ station_id: station, timestamp: new Date(Date.UTC(2024, 0, day, 6, minute)).toISOString(), temperature, humidity: 60, pressure: 1000, anomaly_score: .2, status: "Healthy" });
describe("experimental same-hour baseline", () => {
  it("requires seven previous days and identifies a large same-hour deviation", () => {
    const points = [...Array.from({ length: 7 }, (_, i) => reading(i + 1)), reading(8, 0, 22), reading(8, 10, 20)];
    const result = compareSeries(points);
    expect(result.matched_observations).toBe(2);
    expect(result.candidate_flagged).toBe(1);
    expect(result.candidate_only).toBe(1);
    expect(result.neither_flagged).toBe(1);
    expect(decisionAt(points, "A", reading(8, 0).timestamp)).toEqual({ current_flagged: false, candidate_flagged: true });
    expect(decisionAt(points, "A", reading(1).timestamp)).toBeNull();
  });
  it("never lets future days or another station affect earlier results", () => {
    const initial = [...Array.from({ length: 7 }, (_, i) => reading(i + 1)), reading(8, 0, 22)];
    const baseline = compareSeries(initial);
    const future = { ...reading(9, 0, 50), anomaly_score: null };
    const result = compareSeries([future, reading(1, 0, -50, "B"), ...initial.reverse()]);
    expect(result.matched_observations).toBe(baseline.matched_observations);
    expect(result.candidate_flagged).toBe(baseline.candidate_flagged);
    expect(result.current_flagged).toBe(baseline.current_flagged);
  });
  it("supports an offline calibrated threshold without changing the scored observations", () => {
    const points = [...Array.from({ length: 7 }, (_, i) => reading(i + 1)), reading(8, 0, 21)];
    const strict = compareSeries(points, { candidateThreshold: 3.5, includeScores: true });
    const calibrated = compareSeries(points, { candidateThreshold: 1.5, includeScores: true });
    expect(strict.matched_observations).toBe(1); expect(calibrated.matched_observations).toBe(1);
    expect(strict.matched_scores[0].candidate_score).toBe(2);
    expect(strict.candidate_flagged).toBe(0); expect(calibrated.candidate_flagged).toBe(1);
    expect(strict.matched_scores[0].current_score).toBe(calibrated.matched_scores[0].current_score);
  });
});
