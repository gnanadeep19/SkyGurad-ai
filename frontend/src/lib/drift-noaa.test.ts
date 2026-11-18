import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { analyzeDrift, simulateDrift, type DriftReading } from "./drift";

describe("historical NOAA drift demonstration", () => {
  it("analyzes a verified saved sample and a synthetic temperature ramp without changing it", () => {
    const file = readFileSync("data/noaa/chennai-ghcnh-2024-02.csv", "utf8");
    expect(createHash("sha256").update(file).digest("hex")).toBe("cc35b0c5dcb9e171f839e13aa7c3ac621d7653cfa24dc6fd43f2eac8c9f76209");
    const rows: DriftReading[] = parse(file, { columns: true, skip_empty_lines: true }).map((r: Record<string, string>) => ({ station_id: r.station_id, timestamp: r.timestamp, temperature: Number(r.temperature), humidity: Number(r.humidity), pressure: Number(r.pressure) }));
    const modified = simulateDrift(rows, "temperature");
    expect(analyzeDrift(rows, "temperature").status).toBe("no_shift");
    expect(analyzeDrift(modified, "temperature").status).toBe("review");
    expect(rows.at(-1)?.temperature).toBe(25.5);
  });
});
