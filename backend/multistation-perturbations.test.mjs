import { describe, expect, it } from "vitest";
import { makeElapsedRamp, selectAnchors } from "../scripts/multistation-perturbations.mjs";

describe("fixed-time perturbation selection", () => {
  const rows = ["2024-07-15T00:00:00.000Z", "2024-07-15T03:00:00.000Z", "2024-07-16T12:00:00.000Z"].map(timestamp => ({ timestamp }));
  it("selects the first comparable observation after each predetermined target", () => {
    const control = new Map([[rows[1].timestamp, { current: true, candidate: false }], [rows[2].timestamp, { current: false, candidate: true }]]);
    expect(selectAnchors(rows, control, ["2024-07-15T00:00:00Z", "2024-07-16T12:00:00Z"])).toEqual([1, 2]);
  });
  it("fails when the target window has no comparable observation", () => {
    expect(() => selectAnchors(rows, new Map(), ["2024-07-15T00:00:00Z"])).toThrow(/No eligible/);
  });
});

describe("elapsed-time ramps", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ timestamp: new Date(Date.parse("2024-07-15T00:00:00Z") + i * 3600_000).toISOString(), temperature: "20" }));
  it("changes every reading proportionally, including hourly readings", () => {
    const altered = makeElapsedRamp(rows, 0, "temperature", 2.4);
    expect(altered[0].temperature).toBe("20"); expect(altered[1].temperature).toBe("20.1"); expect(altered[24].temperature).toBe("22.4");
    expect(rows[1].temperature).toBe("20");
  });
  it("rejects large gaps and incomplete windows", () => {
    expect(() => makeElapsedRamp(rows.filter((_, i) => i < 2 || i > 4), 0, "temperature", 2)).toThrow(/gaps/);
    expect(() => makeElapsedRamp(rows.slice(0, -1), 0, "temperature", 2)).toThrow(/24 hours/);
  });
});
