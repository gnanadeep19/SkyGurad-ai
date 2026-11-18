import { describe, expect, it } from "vitest";
import { makeDriftDemo } from "./drift";
import { compareSlowWindow, injectSlowRamp, summarize } from "../../../scripts/evaluate-slow-drift";

describe("offline slow drift evaluation", () => {
  it("adds a gradual ramp without changing the input or earlier observations", () => {
    const rows = makeDriftDemo(), original = structuredClone(rows);
    for (const duration of [72, 120]) {
      const result = injectSlowRamp(rows, "temperature", -2, duration);
      expect(result.skipped).toBeNull();
      const changed = result.rows!;
      expect(changed[0].temperature).toBe(rows[0].temperature);
      expect(changed.at(-1)!.temperature).toBeCloseTo(rows.at(-1)!.temperature - 2);
      const halfway = changed.length - 1 - duration / 6;
      expect(changed[halfway].temperature).toBeCloseTo(rows[halfway].temperature - 1);
    }
    expect(rows).toEqual(original);
  });

  it("skips missing ramp coverage rather than interpolating", () => {
    const rows = makeDriftDemo();
    expect(injectSlowRamp(rows.slice(-20), "pressure", 2, 72).skipped).toBe("coverage");
    expect(injectSlowRamp(rows.filter((_, index) => index < 100 || index > 103), "pressure", 2, 72).skipped).toBe("coverage");
  });

  it("rejects impossible humidity instead of clipping it", () => {
    const rows = makeDriftDemo();
    rows[rows.length - 1].humidity = 98;
    expect(injectSlowRamp(rows, "humidity", 5, 72).skipped).toBe("out_of_range");
    rows[rows.length - 1].humidity = 1;
    expect(injectSlowRamp(rows, "humidity", -5, 120).skipped).toBe("out_of_range");
  });

  it("accounts for each scenario exactly once", () => {
    const result = compareSlowWindow(makeDriftDemo());
    expect(result.cases).toHaveLength(24);
    for (const group of summarize(result.cases)) {
      expect(group.attempted).toBe(group.insufficient_control + group.insufficient_simulated + group.coverage + group.out_of_range + group.originally_flagged + group.eligible);
      expect(group.new_flags).toBeLessThanOrEqual(group.eligible);
      expect(group.suppressed_flags).toBeLessThanOrEqual(group.originally_flagged);
    }
  });
});
