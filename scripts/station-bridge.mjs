// Local, single-reading bridge. It does not read hardware or generate observations.
import { readFile } from "node:fs/promises";
import { request } from "node:https";

async function main() {
  const token = process.env.SKYGUARD_DEVICE_TOKEN ?? "";
  const stationId = process.env.SKYGUARD_BRIDGE_STATION_ID ?? "";
  const caPath = process.env.SKYGUARD_GATEWAY_CA ?? "";
  const port = Number(process.env.SKYGUARD_GATEWAY_PORT ?? 3443);
  if (!/^sgd_[a-f0-9]{24}_[a-f0-9]{64}$/.test(token) || !/^[a-zA-Z0-9._:-]{1,128}$/.test(stationId) || !caPath || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Configure the device token, station ID, local gateway CA certificate and valid port.");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 16 * 1024) throw new Error("Observation input exceeds 16 KiB.");
  }
  let reading;
  try { reading = JSON.parse(input); } catch { throw new Error("Provide one JSON observation on standard input."); }
  if (!reading || typeof reading !== "object" || Array.isArray(reading) || reading.station_id !== stationId || reading.pressure_type !== "station") throw new Error("Observation must match the configured station ID and use station-level pressure.");
  if (typeof reading.timestamp !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(reading.timestamp)) throw new Error("Observation timestamp must include Z or an explicit UTC offset.");
  const payload = JSON.stringify({ observations: [reading] });
  const ca = await readFile(caPath);
  const result = await new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", servername: "localhost", port, path: "/api/device/observations", method: "POST", ca, timeout: 20_000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: `Bearer ${token}` } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(new Error("Gateway response too large")); });
      res.on("error", reject);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { reject(new Error("Gateway returned an invalid response")); } });
    });
    req.on("timeout", () => req.destroy(new Error("Gateway request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
  if (result.status !== 200) throw new Error(`Gateway rejected the submission (HTTP ${result.status}).`);
  const { quality, detection } = result.data;
  if (!quality || quality.invalid || (quality.inserted !== 1 && quality.duplicate !== 1)) throw new Error("Observation was not accepted; review station data and data quality.");
  console.log(JSON.stringify({ inserted: quality.inserted, duplicate: quality.duplicate, detection_status: detection?.status ?? "unknown" }));
  if (!detection?.status || detection.status === "failed") throw new Error("Reading was accepted, but detection did not complete; do not blindly resend it.");
}

main().catch(error => { console.error(`Station bridge: ${error.message}`); process.exitCode = 1; });
