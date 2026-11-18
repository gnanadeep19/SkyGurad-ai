import { describe, expect, it } from "vitest";
import { makeDriftDemo } from "./drift";
import { compareWindow, injectRamp, selectPrefix, summarize } from "../../../scripts/evaluate-drift-review";

describe("offline drift evaluation", () => {
  it("applies rising and falling ramps only in the last 24 hours without mutating the input", () => {
    const rows = makeDriftDemo(), up = injectRamp(rows, "temperature", 4)!, down = injectRamp(rows, "temperature", -4)!;
    expect(up[0]).toEqual(rows[0]); expect(up.at(-1)!.temperature - rows.at(-1)!.temperature).toBeCloseTo(4);
    expect(down.at(-1)!.temperature - rows.at(-1)!.temperature).toBeCloseTo(-4);
    expect(rows.at(-1)!.temperature).not.toBe(up.at(-1)!.temperature);
  });
  it("skips out-of-range scenarios instead of clipping them", () => {
    const rows = makeDriftDemo(); rows[rows.length - 1] = { ...rows.at(-1)!, humidity: 98 };
    expect(injectRamp(rows, "humidity", 15)).toBeNull();
  });
  it("selects only earlier readings within the fixed target window", () => {
    const rows = makeDriftDemo(); const target = rows[80].timestamp;
    expect(selectPrefix(rows, target).length).toBe(81);
    expect(selectPrefix(rows.slice(0, 2), rows[80].timestamp)).toEqual([]);
  });
  it("counts new flags only among unflagged, comparable controls", () => {
    const rows = makeDriftDemo(); const result = compareWindow(rows); const summary = summarize(result);
    expect(summary.find(row => row.field === "temperature" && row.delta === 4)).toMatchObject({ cases: 1, eligible: 1, new_flags: 1 });
    expect(summary.find(row => row.field === "temperature" && row.delta === -4)).toMatchObject({ cases: 1, eligible: 1, new_flags: 1 });
  });
});
