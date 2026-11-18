import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

describe("NOAA comparison sample provenance", () => {
  it("preserves dataset hashes, station identities, quality fields, and unique times", async () => {
    const manifest = JSON.parse(await fs.readFile("reports/noaa-comparison-provenance.json", "utf8"));
    expect(manifest.datasets).toHaveLength(7);
    for (const dataset of manifest.datasets) {
      const content = await fs.readFile(dataset.csv, "utf8");
      expect(createHash("sha256").update(content).digest("hex")).toBe(dataset.csv_sha256);
      const rows = parse(content, { columns: true, bom: true, skip_empty_lines: true });
      expect(rows).toHaveLength(dataset.included_rows);
      expect(new Set(rows.map(row => row.timestamp)).size).toBe(rows.length);
      expect(rows.every(row => row.station_id === dataset.station_id && row.timestamp.startsWith(dataset.month_utc) && row.humidity_measurement_code === "D" && row.temperature_quality_code === "1" && row.pressure_quality_code === "1" && row.humidity_quality_code === "" && row.temperature_source_code === "223" && row.pressure_source_code === "223" && row.humidity_source_code === "223")).toBe(true);
    }
  });
});
