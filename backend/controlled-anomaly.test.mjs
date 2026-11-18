import { describe, expect, it } from "vitest";
import { makeDrift, makeSpike } from "../scripts/controlled-anomaly-evaluation.mjs";

describe("controlled anomaly generation", () => {
  const start = Date.parse("2024-02-15T00:00:00Z");
  const rows = Array.from({ length: 10 }, (_, i) => ({ station_id: "A", timestamp: new Date(start + i * 3 * 3600_000).toISOString(), temperature: "20", humidity: "60", pressure: "1000" }));
  it("changes only the selected observation and field for a spike", () => {
    const modified = makeSpike(rows, 3, "temperature", -1);
    expect(modified[3]).toMatchObject({ temperature: "19", humidity: "60", pressure: "1000" });
    expect(modified[2]).toEqual(rows[2]); expect(rows[3].temperature).toBe("20");
    expect(() => makeSpike(rows, 3, "humidity", 100)).toThrow(/validation limits/);
  });
  it("ramps eight subsequent values over 24 hours and requires complete spacing", () => {
    const modified = makeDrift(rows, 0, "pressure", 4);
    expect(modified[0].pressure).toBe("1000"); expect(modified[1].pressure).toBe("1000.5"); expect(modified[8].pressure).toBe("1004"); expect(modified[9].pressure).toBe("1000");
    expect(rows[8].pressure).toBe("1000");
    expect(() => makeDrift(rows.slice(0, 8), 0, "pressure", 4)).toThrow(/eight unique/);
  });
});
