import { describe, expect, it } from "vitest";
import { analyzeDrift, makeDriftDemo, simulateDrift, type DriftField } from "./drift";

describe("experimental historical drift review", () => {
  it.each(["temperature", "humidity", "pressure"] as DriftField[])("identifies a controlled gradual %s change while the original is unchanged", field => {
    const original = makeDriftDemo();
    expect(analyzeDrift(original, field).status).toBe("no_shift");
    const modified = simulateDrift(original, field);
    expect(analyzeDrift(modified, field).status).toBe("review");
    expect(original.at(-1)?.[field]).not.toBe(modified.at(-1)?.[field]);
    expect(modified[0]).toEqual(original[0]);
  });
  it("does not flag a single isolated spike as a sustained change", () => {
    const rows = makeDriftDemo(); rows[rows.length - 1] = { ...rows.at(-1)!, temperature: 60 };
    expect(analyzeDrift(rows, "temperature").status).toBe("no_shift");
  });
  it("can identify a controlled decreasing change", () => {
    const rows = makeDriftDemo(); const end = Date.parse(rows.at(-1)!.timestamp);
    const modified = rows.map(row => ({ ...row, temperature: row.temperature - 4 * Math.max(0, Math.min(1, (Date.parse(row.timestamp) - (end - 24 * 3600_000)) / (24 * 3600_000))) }));
    expect(analyzeDrift(modified, "temperature")).toMatchObject({ status: "review", change: expect.any(Number) });
    expect(analyzeDrift(modified, "temperature").change).toBeLessThan(0);
  });
  it("reports insufficient evidence for short, mixed, duplicate and gapped data", () => {
    const rows = makeDriftDemo();
    expect(analyzeDrift(rows.slice(-8), "temperature").status).toBe("insufficient");
    expect(analyzeDrift([...rows, { ...rows[0], station_id: "other" }], "temperature").status).toBe("insufficient");
    expect(analyzeDrift([...rows, rows.at(-1)!], "temperature").status).toBe("insufficient");
    expect(analyzeDrift(rows.filter((_, i) => i < rows.length - 6 || i > rows.length - 4), "temperature").status).toBe("insufficient");
  });
  it("produces the same result for unsorted observations", () => {
    const rows = makeDriftDemo(); const earlier = rows.slice(0, -8);
    expect(analyzeDrift([...earlier].reverse(), "temperature")).toEqual(analyzeDrift(earlier, "temperature"));
  });
});
