import { describe, expect, it } from "vitest";
import { csvCell, toCsv, utcDateRange } from "./analytics-export";

describe("historical analytics export", () => {
  it("uses inclusive UTC calendar dates and rejects invalid or oversized ranges", () => {
    expect(utcDateRange("2024-02-28", "2024-02-29")).toEqual({ start: "2024-02-28T00:00:00.000Z", end: "2024-03-01T00:00:00.000Z" });
    expect(utcDateRange("2024-02-30", "2024-03-01")).toBeNull();
    expect(utcDateRange("2023-01-01", "2024-02-01")).toBeNull();
    expect(utcDateRange("2024-03-02", "2024-03-01")).toBeNull();
  });
  it("quotes CSV and neutralizes spreadsheet formulas without changing numeric negatives", () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('  @test')).toBe('"\'  @test"');
    expect(csvCell(-1.5)).toBe('"-1.5"');
    expect(toCsv(["name"], [['North, "A"']])).toBe('"name"\r\n"North, ""A"""\r\n');
  });
});
