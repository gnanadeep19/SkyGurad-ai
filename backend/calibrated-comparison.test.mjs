import { describe, expect, it } from "vitest";
import { calibrateThreshold } from "../scripts/calibrated-comparison.mjs";

describe("empirical flag-rate matching", () => {
  it("matches a target count using only provided calibration scores", () => {
    const result = calibrateThreshold([.1, .4, .8, 1.2], 2);
    expect(result).toMatchObject({ threshold: .8, flagged: 2, target_flagged: 2, scored: 4 });
  });
  it("uses the closest achievable count when scores tie", () => {
    const result = calibrateThreshold([1, 1, 1, 2], 2);
    expect(result).toMatchObject({ threshold: 2, flagged: 1 });
  });
  it("supports zero target flags and rejects invalid input", () => {
    const result = calibrateThreshold([.1, .4], 0);
    expect(result.flagged).toBe(0); expect(result.threshold).toBeGreaterThan(.4);
    expect(() => calibrateThreshold([], 0)).toThrow();
    expect(() => calibrateThreshold([NaN], 1)).toThrow();
  });
});
