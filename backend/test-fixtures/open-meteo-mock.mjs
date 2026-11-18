// Imported only by the isolated integration test; all non-Open-Meteo fetches pass through.
import { readFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
let lastMode = "", count = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? input.toString());
  if (url.hostname !== "api.open-meteo.com") return originalFetch(input, options);
  const mode = (await readFile(process.env.SKYGUARD_TEST_METEO_STATE, "utf8")).trim();
  if (mode !== lastMode) { lastMode = mode; count = 0; }
  count++;
  if (mode === "fail" || (mode === "fail_second" && count % 2 === 0)) throw new Error("Simulated weather-source outage");
  const latitudes = url.searchParams.get("latitude").split(",");
  const longitudes = url.searchParams.get("longitude").split(",");
  const time = new Date(Date.now() - (mode === "stale" ? 120 : mode === "fresh_previous" ? 20 : 0) * 60_000).toISOString();
  const hourlyTimes = [8, 2, 1, -1].map(hours => new Date(Date.now() - hours * 3600_000).toISOString());
  const rows = latitudes.map((lat, i) => ({ latitude: Number(lat), longitude: Number(longitudes[i]), current: { time, temperature_2m: 25, relative_humidity_2m: 60, surface_pressure: 1002 }, hourly: { time: hourlyTimes, temperature_2m: [20, 21, 22, 23], relative_humidity_2m: [60, 60, 60, 60], surface_pressure: [1002, 1002, 1002, 1002] } }));
  return new Response(JSON.stringify(rows.length === 1 ? rows[0] : rows), { headers: { "content-type": "application/json" } });
};
