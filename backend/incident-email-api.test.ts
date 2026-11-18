import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EmailWorker, createResendSender, type EmailConfig } from "./email-notifications.js";
import { FileStorage } from "./storage.js";

describe("station observation to email workflow", () => {
  let root: string, base: string, child: ChildProcess, cookie: string, setupCode = "";
  const password = "isolated-test-password";
  const recipient = "operator@example.com";
  const request = (endpoint: string, body?: unknown) => fetch(`${base}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-incident-email-api-"));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as import("node:net").AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    base = `http://127.0.0.1:${port}`;
    // Explicitly override every mail setting so the test can never use local Gmail credentials.
    child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "backend/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), DATABASE_URL: "", SKYGUARD_DATA_DIR: root, SKYGUARD_USERS_FILE: path.join(root, "users.json"), SKYGUARD_SOURCE_MODE: "replay", SKYGUARD_BACKGROUND_INGESTION: "0", SKYGUARD_EMAIL_ENABLED: "1", SKYGUARD_SMTP_HOST: "127.0.0.1", SKYGUARD_SMTP_PORT: "1", SKYGUARD_SMTP_SECURE: "0", SKYGUARD_SMTP_USER: "test-only", SKYGUARD_SMTP_PASSWORD: "test-only", SKYGUARD_EMAIL_FROM: "sender@example.com", SKYGUARD_EMAIL_TO: recipient },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout!.on("data", chunk => { output += String(chunk); setupCode = output.match(/setup code: ([a-f0-9]{36})/)?.[1] ?? setupCode; });
    child.stderr!.on("data", () => {});
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(`${base}/api/auth/status`)).ok; } catch { /* Await startup. */ }
      if (ready && setupCode) break;
      if (child.exitCode !== null) throw new Error("Isolated test server exited during startup");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready || !setupCode) throw new Error("Isolated test server did not start");
    const setup = await request("/api/auth/setup", { username: "admin", password, code: setupCode });
    expect(setup.status).toBe(201);
    cookie = setup.headers.get("set-cookie")!.split(";")[0];
  }, 20000);

  afterAll(async () => {
    if (child && child.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("validates station readings, detects a spike, queues one message, and supports incident resolution", async () => {
    const now = Date.now();
    const common = { station_id: "TEST-EMAIL-STATION", station_name: "Isolated test station", latitude: 13, longitude: 80, temperature: 24, humidity: 60, pressure: 1003, pressure_type: "station" };
    const baseline = Array.from({ length: 24 }, (_, i) => ({ ...common, timestamp: new Date(now - (26 - i) * 60_000).toISOString() }));
    const first = await request("/api/station-observations", { observations: baseline });
    expect(first.status).toBe(200);
    expect((await first.json()).detection).toMatchObject({ scored: 0, insufficient: 24 });
    const spike = { ...common, temperature: 55, timestamp: new Date(now - 60_000).toISOString() };
    const detected = await request("/api/station-observations", { observations: [spike] });
    expect(detected.status).toBe(200);
    expect((await detected.json()).detection).toMatchObject({ status: "complete", scored: 1, flagged: 1 });
    const repeated = await (await request("/api/station-observations", { observations: [spike] })).json();
    expect(repeated.quality.duplicate).toBe(1);
    const initial = await (await request("/api/station-incidents")).json();
    expect(initial.incidents).toHaveLength(1);
    const incident = initial.incidents[0];
    expect(incident).toMatchObject({ station_id: common.station_id, status: "open" });
    expect((await (await request("/api/notification-status")).json()).queue).toMatchObject({ pending: 1, sent: 0 });

    const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"test-only"}),{status:200}));
    const fakeConfig: EmailConfig = {provider:"resend",apiKey:"re_test_only",from:"onboarding@resend.dev",recipient};
    await new EmailWorker(new FileStorage(root), fakeConfig, createResendSender(fakeConfig.apiKey, fakeFetch as unknown as typeof fetch)).runOnce();
    expect(fakeFetch).toHaveBeenCalledOnce();
    const message=JSON.parse(fakeFetch.mock.calls[0][1].body);
    expect(message).toMatchObject({ to: [recipient], subject: `SkyGuard: ${incident.severity} station incident` });
    expect(message.text).toContain("An anomaly is not proof of a sensor fault");
    expect((await (await request("/api/notification-status")).json()).queue).toMatchObject({ pending: 0, sent: 1 });
    expect((await request(`/api/station-incidents/${incident.id}/acknowledge`, { note: "Investigating" })).status).toBe(200);
    expect((await request(`/api/station-incidents/${incident.id}/resolve`, { note: "Test complete" })).status).toBe(200);
    const actions = await (await request(`/api/station-incidents/${incident.id}/actions`)).json();
    expect(actions.actions.map((action: { action: string }) => action.action)).toEqual(["resolve", "acknowledge", "detection"]);
  }, 20000);
  it("scores all new readings in a batch using only earlier observations", async () => {
    const now=Date.now();
    const base={station_id:"BATCH-TEST",station_name:"Batch test",latitude:13,longitude:80,temperature:24,humidity:60,pressure:1003,pressure_type:"station"};
    const rows=Array.from({length:27},(_,i)=>({...base,temperature:i===24 ? 55 : 24+(i%3)*.1,timestamp:new Date(now-(27-i)*60_000).toISOString()}));
    const result=await (await request("/api/station-observations",{observations:rows.reverse()})).json();
    expect(result.quality.inserted).toBe(27);
    expect(result.detection).toMatchObject({status:"complete",scored:3,insufficient:24});
    expect(result.detection.flagged).toBeGreaterThanOrEqual(1);
    const alerts=await (await request("/api/alert-history?station_id=BATCH-TEST")).json();
    expect(alerts.alerts.some((item:any)=>item.opened_at === rows[2].timestamp)).toBe(true);
    expect((await (await request("/api/station-observations",{observations:rows})).json()).quality.duplicate).toBe(27);
  },20000);
  it("opens a review incident for a sustained flat signal without claiming a sensor fault", async () => {
    const now=Date.now();
    const base={station_id:"FLAT-TEST",station_name:"Flat test",latitude:13,longitude:80,temperature:24,humidity:60,pressure:1003,pressure_type:"station"};
    const rows=Array.from({length:9},(_,i)=>({...base,humidity:60+i,pressure:1003+i,timestamp:new Date(now-(8-i)*15*60_000).toISOString()}));
    const result=await (await request("/api/station-observations",{observations:rows})).json();
    expect(result.detection.flagged).toBeGreaterThan(0);
    const data=await (await request("/api/station-incidents")).json();
    const incident=data.incidents.find((item:any)=>item.station_id === "FLAT-TEST");
    expect(incident.details.sustained_review.frozen).toContain("temperature");
    expect(incident.details.explanation).toContain("without a sensor fault");
  },20000);
});
