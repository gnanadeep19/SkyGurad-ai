// Real API smoke test with isolated local storage and email/background work disabled.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-real-meteo-"));
let child;
try {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "backend/index.ts"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATABASE_URL: "", SKYGUARD_DATA_DIR: root, SKYGUARD_USERS_FILE: path.join(root, "users.json"), SKYGUARD_SOURCE_MODE: "open-meteo", SKYGUARD_BACKGROUND_INGESTION: "0", SKYGUARD_EMAIL_ENABLED: "0", OPEN_METEO_LOCATIONS_JSON: JSON.stringify([{ station_id: "TEST-CHENNAI", station_name: "Chennai reference location", latitude: 13.08, longitude: 80.27 }]) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", code = ""; child.stdout.on("data", chunk => { output += String(chunk); code = output.match(/setup code: ([a-f0-9]{36})/)?.[1] ?? code; }); child.stderr.on("data", () => {});
  let ready = false; for (let i = 0; i < 100; i++) { try { ready = (await fetch(`${base}/api/auth/status`)).ok; } catch {} if (ready && code) break; if (child.exitCode !== null) throw Error("Isolated backend exited"); await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready || !code) throw Error("Isolated backend failed to start");
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "isolated-open-meteo-password", code }) });
  if (!setup.ok) throw Error("Isolated account setup failed"); const cookie = setup.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${base}/api/realtime`, { headers: { Cookie: cookie } }); const data = await response.json();
  if (!response.ok || data.source !== "open-meteo" || data.stations.length !== 1 || !["temperature", "humidity", "pressure"].every(field => Number.isFinite(data.stations[0][field]))) throw Error(`Real Open-Meteo collection did not succeed; returned source ${data.source ?? "unknown"}`);
  const history = await (await fetch(`${base}/api/history?source=open-meteo&station_id=TEST-CHENNAI&hours=24`, { headers: { Cookie: cookie } })).json();
  if (!history.readings?.some(row => row.source === "open-meteo")) throw Error("Source-specific history did not contain the estimate");
  console.log(JSON.stringify({ source: data.source, label: data.source_label, stale: data.source_stale, station_count: data.stations.length, fields: ["temperature", "humidity", "pressure"], source_specific_history: true }, null, 2));
} finally {
  if (child && child.exitCode === null) await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
  await fs.rm(root, { recursive: true, force: true });
}
