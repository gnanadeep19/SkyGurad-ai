import { describe, expect, it } from "vitest";
import { normalizeStationHistory } from "./station-history";

describe("submitted station history", () => {
  it("uses only valid readings from the requested station and source, sorted by time", () => {
    const row = { station_id: "ST-1", source: "station-api", timestamp: "2024-01-01T02:00:00Z", temperature: 20, humidity: 55, pressure: 1001 };
    const readings = [row, { ...row, timestamp: "2024-01-01T01:00:00Z" }, { ...row, station_id: "ST-2" }, { ...row, source: "open-meteo" }, { ...row, humidity: null }, { ...row, timestamp: "invalid" }];
    const result = normalizeStationHistory(readings, "ST-1");
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBeLessThan(result[1].timestamp);
    expect(result[0].humidity).toBe(55);
  });
  it("handles unavailable data without inventing readings", () => {
    expect(normalizeStationHistory(null, "ST-1")).toEqual([]);
    expect(normalizeStationHistory([{ station_id: "ST-1", temperature: null }], "ST-1")).toEqual([]);
  });
});
