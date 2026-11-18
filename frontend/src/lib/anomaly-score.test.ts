import { describe, expect, it } from "vitest";
import { formatAnomalyScore } from "./anomaly-score";

describe("anomaly score display", () => {
  it("shows the model's 0–1 score without presenting it as a probability", () => {
    expect(formatAnomalyScore(0.12)).toBe("0.12");
    expect(formatAnomalyScore(1)).toBe("1.00");
    for (const value of [null, undefined, NaN, -1, 1.01, "0.12"]) expect(formatAnomalyScore(value)).toBe("—");
  });
});
