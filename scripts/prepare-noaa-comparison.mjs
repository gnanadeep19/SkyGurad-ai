// Prepare fixed 2024 station/month subsets without modifying NOAA source files.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "csv-parse/sync";

const periods = { INI0000VOMM: ["2024-07"], SNI0000WSSS: ["2024-01", "2024-07"], AEI0000OMDB: ["2024-01", "2024-07"], UKI0000EGLL: ["2024-01", "2024-07"] };
const outputDir = "data/noaa";
const manifestPath = "reports/noaa-comparison-provenance.json";
const fields = ["timestamp", "station_id", "station_name", "latitude", "longitude", "temperature", "pressure", "humidity", "noaa_dataset", "pressure_type", "humidity_measurement_code", "temperature_quality_code", "pressure_quality_code", "humidity_quality_code", "temperature_source_code", "pressure_source_code", "humidity_source_code", "temperature_report_type", "pressure_report_type", "humidity_report_type"];
const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const hash = value => createHash("sha256").update(value).digest("hex");
const targets = Object.entries(periods).flatMap(([id, months]) => months.map(month => path.join(outputDir, `ghcnh-${id}-${month}.csv`)));
for (const output of [...targets, manifestPath]) { try { await fs.access(output); throw Error(`Output already exists: ${output}`); } catch (error) { if (error.code !== "ENOENT") throw error; } }
const outputs = [], manifest = [];
for (const [id, months] of Object.entries(periods)) {
  const source = path.join(outputDir, `GHCNh_${id}_2024.psv`), bytes = await fs.readFile(source);
  const all = parse(bytes.toString("utf8"), { columns: true, delimiter: "|", skip_empty_lines: true });
  for (const month of months) {
    const sourceRows = all.filter(row => row.STATION === id && row.DATE.startsWith(`${month}-`));
    const selected = sourceRows.filter(row => {
      const values = [row.temperature, row.station_level_pressure, row.relative_humidity];
      if (values.some(value => value === "" || !Number.isFinite(Number(value)))) return false;
      const [temperature, pressure, humidity] = values.map(Number);
      return temperature >= -90 && temperature <= 65 && pressure >= 300 && pressure <= 1100 && humidity >= 0 && humidity <= 100 && row.temperature_Quality_Code === "1" && row.station_level_pressure_Quality_Code === "1" && row.temperature_Source_Code === "223" && row.station_level_pressure_Source_Code === "223" && row.relative_humidity_Source_Code === "223" && row.relative_humidity_Quality_Code === "" && row.relative_humidity_Measurement_Code === "D";
    }).sort((a, b) => a.DATE.localeCompare(b.DATE));
    if (!selected.length || new Set(selected.map(row => row.DATE)).size !== selected.length) throw Error(`Missing or duplicate observations for ${id} ${month}`);
    const content = [fields.join(","), ...selected.map(row => [`${row.DATE}Z`, row.STATION, row.Station_name, row.LATITUDE, row.LONGITUDE, row.temperature, row.station_level_pressure, row.relative_humidity, "NOAA GHCNh v1", "station-level", row.relative_humidity_Measurement_Code, row.temperature_Quality_Code, row.station_level_pressure_Quality_Code, row.relative_humidity_Quality_Code, row.temperature_Source_Code, row.station_level_pressure_Source_Code, row.relative_humidity_Source_Code, row.temperature_Report_Type, row.station_level_pressure_Report_Type, row.relative_humidity_Report_Type].map(quote).join(",")), ""].join("\n");
    const output = path.join(outputDir, `ghcnh-${id}-${month}.csv`);
    outputs.push({ output, content });
    manifest.push({ station_id: id, station_name: selected[0].Station_name, month_utc: month, source_url: `https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2024/psv/GHCNh_${id}_2024.psv`, source_sha256: hash(bytes), csv: output.replaceAll("\\", "/"), csv_sha256: hash(content), source_rows: sourceRows.length, included_rows: selected.length, excluded_rows: sourceRows.length - selected.length, first_utc: `${selected[0].DATE}Z`, last_utc: `${selected.at(-1).DATE}Z` });
  }
}
for (const item of outputs) await fs.writeFile(item.output, item.content, { flag: "wx" });
await fs.writeFile(manifestPath, JSON.stringify({ prepared_at: new Date().toISOString(), selection: "Complete valid ranges; temperature and station pressure source 223 quality 1; humidity source 223 measurement D, blank quality code. Humidity is derived, not independently measured.", datasets: manifest }, null, 2) + "\n", { flag: "wx" });
console.log(`Prepared ${outputs.length} NOAA subsets and a provenance report.`);
