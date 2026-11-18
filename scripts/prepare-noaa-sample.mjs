// Prepare the documented Chennai sample from the unchanged NOAA GHCNh PSV.
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

const input = "data/noaa/GHCNh_INI0000VOMM_2024.psv";
const period = process.argv[2] ?? "2024-01";
if (!/^2024-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Specify a 2024 month as YYYY-MM.");
const output = process.argv[3] ?? (period === "2024-01" ? "data/noaa/chennai-ghcnh-january-2024.csv" : `data/noaa/chennai-ghcnh-${period}.csv`);
const rows = parse(await readFile(input, "utf8"), { columns: true, delimiter: "|", skip_empty_lines: true });
const periodRows = rows.filter(row => row.STATION === "INI0000VOMM" && row.DATE.startsWith(`${period}-`));
const selected = periodRows.filter(row => {
  const temp = row.temperature, pressure = row.station_level_pressure, humidity = row.relative_humidity;
  return [temp, pressure, humidity].every(value => value !== "" && Number.isFinite(Number(value))) &&
    Number(temp) >= -90 && Number(temp) <= 65 && Number(pressure) >= 300 && Number(pressure) <= 1100 && Number(humidity) >= 0 && Number(humidity) <= 100 &&
    row.temperature_Quality_Code === "1" && row.station_level_pressure_Quality_Code === "1" &&
    row.temperature_Source_Code === "223" && row.station_level_pressure_Source_Code === "223" &&
    row.relative_humidity_Source_Code === "223" && row.relative_humidity_Quality_Code === "" && row.relative_humidity_Measurement_Code === "D";
});
const fields = ["timestamp", "station_id", "station_name", "latitude", "longitude", "temperature", "pressure", "humidity", "noaa_dataset", "pressure_type", "humidity_measurement_code", "temperature_quality_code", "pressure_quality_code", "humidity_quality_code", "temperature_source_code", "pressure_source_code", "humidity_source_code", "temperature_report_type", "pressure_report_type", "humidity_report_type"];
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const outputRows = selected.map(row => [
  `${row.DATE}Z`, row.STATION, row.Station_name, row.LATITUDE, row.LONGITUDE,
  row.temperature, row.station_level_pressure, row.relative_humidity, "NOAA GHCNh v1", "station-level",
  row.relative_humidity_Measurement_Code, row.temperature_Quality_Code, row.station_level_pressure_Quality_Code,
  row.relative_humidity_Quality_Code, row.temperature_Source_Code, row.station_level_pressure_Source_Code,
  row.relative_humidity_Source_Code, row.temperature_Report_Type, row.station_level_pressure_Report_Type,
  row.relative_humidity_Report_Type,
]);
if (!outputRows.length) throw new Error("No complete, eligible NOAA rows found; check the source file and format.");
const keys = new Set(outputRows.map(row => `${row[1]}|${row[0]}`));
if (keys.size !== outputRows.length) throw new Error("Duplicate station timestamps found in the selected NOAA sample.");
await writeFile(output, [fields.join(","), ...outputRows.map(row => row.map(quote).join(",")), ""].join("\n"), { flag: "wx" });
console.log(JSON.stringify({source: input, output, period, source_rows: periodRows.length, included_rows: outputRows.length, excluded_rows: periodRows.length - outputRows.length, first: outputRows[0][0], last: outputRows.at(-1)[0]}));
