import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createGateway } from "../gateway/https-gateway.mjs";

describe("HTTPS station gateway", () => {
  let root, child, base, cookie, gateway, gatewayPort, cert, certPath, otherCertPath, token, credentialId, setupCode = "";
  const password = "isolated-gateway-password";
  const api = (endpoint, body) => fetch(`${base}${endpoint}`, { method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const throughGateway = (endpoint, body, authorization, extra = {}, trusted = true) => new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = httpsRequest({ hostname: "127.0.0.1", servername: "localhost", port: gatewayPort, path: endpoint, method: "POST", ...(trusted ? { ca: cert } : {}), headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}), ...extra } }, res => { let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
    req.on("error", reject); req.end(payload);
  });
  const throughBridge = (reading, overrides = {}) => new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ["scripts/station-bridge.mjs"], { cwd: process.cwd(), env: { ...process.env, SKYGUARD_DEVICE_TOKEN: token, SKYGUARD_BRIDGE_STATION_ID: "TEST-GATEWAY", SKYGUARD_GATEWAY_CA: certPath, SKYGUARD_GATEWAY_PORT: String(gatewayPort), ...overrides }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; processChild.stdout.on("data", chunk => stdout += chunk); processChild.stderr.on("data", chunk => stderr += chunk);
    processChild.on("error", reject); processChild.on("exit", code => resolve({ code, stdout, stderr }));
    processChild.stdin.end(JSON.stringify(reading));
  });
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-https-gateway-"));
    const windowsOpenSSL = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
    const openssl = process.env.SKYGUARD_TEST_OPENSSL || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
    const keyPath = path.join(root, "test-key.pem"); certPath = path.join(root, "test-cert.pem");
    await promisify(execFile)(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
    otherCertPath = path.join(root, "other-cert.pem");
    await promisify(execFile)(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(root, "other-key.pem"), "-out", otherCertPath, "-days", "1", "-subj", "/CN=unrelated-test"]);
    cert = await fs.readFile(certPath);
    const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "backend/index.ts"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATABASE_URL: "", SKYGUARD_DATA_DIR: root, SKYGUARD_USERS_FILE: path.join(root, "users.json"), SKYGUARD_SOURCE_MODE: "replay", SKYGUARD_BACKGROUND_INGESTION: "0", SKYGUARD_EMAIL_ENABLED: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => { output += String(chunk); setupCode = output.match(/setup code: ([a-f0-9]{36})/)?.[1] ?? setupCode; }); child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(`${base}/api/auth/status`)).ok; } catch {} if (ready && setupCode) break; if (child.exitCode !== null) throw Error("Test backend exited"); await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!ready || !setupCode) throw Error("Test backend did not start");
    const setup = await api("/api/auth/setup", { username: "admin", password, code: setupCode }); expect(setup.status).toBe(201); cookie = setup.headers.get("set-cookie").split(";")[0];
    const credential = await api("/api/device-credentials", { station_id: "TEST-GATEWAY", label: "Isolated gateway", expires_in_days: 1 }); expect(credential.status).toBe(201); const created = await credential.json(); token = created.token; credentialId = created.credential.id;
    gateway = createGateway({ key: await fs.readFile(keyPath), cert, backendPort: port });
    await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve)); gatewayPort = gateway.address().port;
  }, 30000);
  afterAll(async () => {
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    if (child && child.exitCode === null) await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it("uses verified TLS and forwards only authorized, in-scope station readings", async () => {
    const reading = { station_id: "TEST-GATEWAY", station_name: "Synthetic gateway station", latitude: 13, longitude: 80, temperature: 25, humidity: 60, pressure: 1002, pressure_type: "station", timestamp: new Date().toISOString() };
    await expect(throughGateway("/api/device/observations", { observations: [reading] }, token, {}, false)).rejects.toThrow();
    expect((await throughGateway("/api/config", {}, token)).status).toBe(404);
    expect((await throughGateway("/api/device/observations", { observations: [reading] }, "invalid")).status).toBe(401);
    expect(await throughGateway("/api/device/observations", "{broken", token)).toMatchObject({ status: 400, body: { error: "SkyGuard could not process the request." } });
    expect((await throughGateway("/api/device/observations", { observations: [{ ...reading, station_id: "WRONG" }] }, token)).status).toBe(403);
    const accepted = await throughGateway("/api/device/observations", { observations: [reading] }, token, { "X-Forwarded-For": "203.0.113.8" });
    expect(accepted.status).toBe(200); expect(accepted.body.quality.inserted).toBe(1);
    const duplicate = await throughGateway("/api/device/observations", { observations: [reading] }, token); expect(duplicate.body.quality.duplicate).toBe(1);
    const history = await (await api("/api/history?hours=24&source=station-api&station_id=TEST-GATEWAY")).json(); expect(history.readings).toHaveLength(1);
    // Populate an earlier synthetic baseline through the same authenticated gateway.
    const baseline = Array.from({ length: 24 }, (_, i) => ({ ...reading, timestamp: new Date(Date.parse(reading.timestamp) - (26 - i) * 60_000).toISOString() }));
    const baselineResult = await throughGateway("/api/device/observations", { observations: baseline }, token);
    expect(baselineResult.body.quality.inserted).toBe(24);
    const spike = { ...reading, temperature: 55, timestamp: new Date(Date.parse(reading.timestamp) + 1000).toISOString() };
    const detection = await throughGateway("/api/device/observations", { observations: [spike] }, token);
    expect(detection.body.detection).toMatchObject({ status: "complete", scored: 1, flagged: 1 });
    const monitor = await (await api("/api/station-observations/monitor")).json();
    expect(monitor.recent_events.some(event => event.station_id === "TEST-GATEWAY")).toBe(true);
    const incidents = await (await api("/api/station-incidents")).json();
    expect(incidents.incidents).toEqual(expect.arrayContaining([expect.objectContaining({ station_id: "TEST-GATEWAY", status: "open" })]));
    expect(incidents.description).toContain("manual review");
    const bridgeReading = { ...reading, timestamp: new Date(Date.parse(reading.timestamp) + 2000).toISOString() };
    const bridged = await throughBridge(bridgeReading);
    expect(bridged.code).toBe(0); expect(JSON.parse(bridged.stdout)).toMatchObject({ inserted: 1, duplicate: 0, detection_status: "complete" });
    const duplicateBridge = await throughBridge(bridgeReading);
    expect(duplicateBridge.code).toBe(0); expect(JSON.parse(duplicateBridge.stdout)).toMatchObject({ inserted: 0, duplicate: 1 });
    const wrongStation = await throughBridge({ ...bridgeReading, station_id: "WRONG" });
    expect(wrongStation.code).toBe(1); expect(wrongStation.stderr).not.toContain(token);
    const untrustedCert = await throughBridge(bridgeReading, { SKYGUARD_GATEWAY_CA: otherCertPath });
    expect(untrustedCert.code).toBe(1); expect(untrustedCert.stderr).toMatch(/certificate/i); expect(untrustedCert.stderr).not.toContain(token);
    expect((await api(`/api/device-credentials/${credentialId}/revoke`, {})).status).toBe(200);
    expect((await throughGateway("/api/device/observations", { observations: [reading] }, token)).status).toBe(401);
  }, 20000);
});
