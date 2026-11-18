import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

describe("isolated Open-Meteo source behavior", () => {
  let root: string, base: string, child: ChildProcess, cookie = "", code = "";
  const api = (route: string, body?: unknown) => fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const mode = (value: string) => fs.writeFile(path.join(root, "meteo-state"), value);
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-open-meteo-")); await mode("fail");
    const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = (probe.address() as import("node:net").AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve())); base = `http://127.0.0.1:${port}`;
    const locations = Array.from({ length: 21 }, (_, i) => ({ station_id: `MOCK-${i}`, station_name: `Mock station ${i}`, latitude: 13, longitude: 80 }));
    const fixture = pathToFileURL(path.resolve("backend/test-fixtures/open-meteo-mock.mjs")).href;
    child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "backend/index.ts"], { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: `--import=${fixture}`, PORT: String(port), DATABASE_URL: "", SKYGUARD_DATA_DIR: root, SKYGUARD_USERS_FILE: path.join(root, "users.json"), SKYGUARD_SOURCE_MODE: "open-meteo", SKYGUARD_BACKGROUND_INGESTION: "0", SKYGUARD_EMAIL_ENABLED: "0", OPEN_METEO_LOCATIONS_JSON: JSON.stringify(locations), REALTIME_CACHE_TTL_MS: "1", SKYGUARD_TEST_METEO_STATE: path.join(root, "meteo-state") }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout!.on("data", chunk => { output += String(chunk); code = output.match(/setup code: ([a-f0-9]{36})/)?.[1] ?? code; }); child.stderr!.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(`${base}/api/auth/status`)).ok; } catch {} if (ready && code) break; if (child.exitCode !== null) throw Error("Isolated backend exited"); await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!ready || !code) throw Error("Isolated backend did not start");
    const setup = await api("/api/auth/setup", { username: "admin", password: "isolated-open-meteo-password", code }); expect(setup.status).toBe(201); cookie = setup.headers.get("set-cookie")!.split(";")[0];
  }, 20000);
  afterAll(async () => { if (child && child.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); }); if (root) await fs.rm(root, { recursive: true, force: true }); });
  it("labels replay, fresh estimates, stale upstream data, and cache fallback without saving partial batches", async () => {
    const replay = await (await api("/api/realtime")).json(); expect(replay).toMatchObject({ source: "replay", source_label: "Replay fallback" });
    await mode("fresh"); const fresh = await (await api("/api/realtime")).json(); expect(fresh).toMatchObject({ source: "open-meteo", source_label: "Open-Meteo", source_stale: false }); expect(fresh.stations).toHaveLength(21); expect(fresh.stations.every((station:any)=>station.observation_stale === false)).toBe(true);
    const history = await (await api("/api/history?source=open-meteo&station_id=MOCK-0&hours=24")).json(); expect(history.readings[0]).toMatchObject({ source: "open-meteo", temperature: 25, humidity: 60, pressure: 1002 });
    const trends = await (await api("/api/weather-trends?station_id=MOCK-0&hours=6")).json();
    expect(trends.source).toBe("open-meteo");
    expect(trends.readings.map((row: any) => row.temperature)).toEqual([21, 22, 25]);
    expect(history.readings).toHaveLength(1); // Hourly model estimates do not become recorded observations.
    const shortTrend = await (await api("/api/weather-trends?station_id=MOCK-0&hours=0.25")).json();
    expect(shortTrend.readings.map((row: any) => row.temperature)).toEqual([25]);
    await mode("fresh_previous"); await api("/api/realtime");
    const hourTrend = await (await api("/api/weather-trends?station_id=MOCK-0&hours=1")).json();
    expect(hourTrend.readings.filter((row:any)=>row.temperature === 25)).toHaveLength(2);
    expect(Date.parse(hourTrend.readings.at(-1).timestamp) - Date.parse(hourTrend.readings[0].timestamp)).toBeGreaterThan(19 * 60_000);
    expect((await api("/api/weather-trends?station_id=MOCK-0&hours=0")).status).toBe(400);
    await mode("stale"); const stale = await (await api("/api/realtime")).json(); expect(stale).toMatchObject({ source: "open-meteo", source_label: "Open-Meteo (stale)", source_stale: true }); expect(stale.stations.every((station:any)=>station.observation_stale === true)).toBe(true);
    const staleTrend = await (await api("/api/weather-trends?station_id=MOCK-0&hours=0.25")).json();
    expect(staleTrend.range_end).toBe(stale.stations[0].timestamp);
    expect(staleTrend.readings.some((row:any)=>row.timestamp === staleTrend.range_end)).toBe(true);
    expect(Date.now() - Date.parse(staleTrend.range_end)).toBeGreaterThan(90 * 60_000);
    await mode("fresh-again"); await api("/api/realtime");
    const eventsBefore = await fs.readFile(path.join(root, "observation-events.jsonl"), "utf8");
    await mode("fail_second"); const cached = await (await api("/api/realtime")).json(); expect(cached).toMatchObject({ source: "open-meteo", source_label: "Open-Meteo (cached)", source_stale: true });
    expect(await fs.readFile(path.join(root, "observation-events.jsonl"), "utf8")).toBe(eventsBefore);
  }, 20000);
});
