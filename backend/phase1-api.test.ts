import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const password="test-admin-password";
describe("Phase 1 API persistence", () => {
  let root:string, port:number, child:ChildProcess, base:string, code:string, cookie:string;
  const start = async () => {
    child=spawn(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"backend/index.ts"], { cwd: process.cwd(), env:{ ...process.env, PORT:String(port), DATABASE_URL:"", SKYGUARD_DATA_DIR:root, SKYGUARD_USERS_FILE:path.join(root,"users.json"), SKYGUARD_SOURCE_MODE:"replay", SKYGUARD_SOURCE_MAX_AGE_MINUTES:"30", SKYGUARD_EMAIL_ENABLED:"0" }, stdio:["ignore","pipe","pipe"] });
    let output=""; child.stdout!.on("data", (chunk) => { output+=String(chunk); const match=output.match(/setup code: ([a-f0-9]{36})/); if(match) code=match[1]; });
    child.stderr!.on("data",()=>{});
    for(let attempt=0;attempt<100;attempt++) { try { const response=await fetch(`${base}/api/auth/status`); if(response.ok) return; } catch {} if(child.exitCode !== null) throw new Error("Test server exited during startup"); await new Promise((resolve)=>setTimeout(resolve,100)); }
    throw new Error("Test server did not start");
  };
  const stop = async () => { if(child.exitCode !== null) return; await new Promise<void>((resolve)=>{ child.once("exit",()=>resolve()); child.kill(); }); };
  const request = (endpoint:string, data?:unknown) => fetch(`${base}${endpoint}`, { method:data === undefined ? "GET" : "POST", headers:{ ...(cookie ? {Cookie:cookie}:{}), ...(data === undefined ? {} : {"Content-Type":"application/json"}) }, ...(data === undefined ? {} : {body:JSON.stringify(data)}) });
  beforeAll(async () => {
    root=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-api-phase1-"));
    const probe=createServer(); await new Promise<void>((resolve)=>probe.listen(0,"127.0.0.1",resolve)); port=(probe.address() as import("node:net").AddressInfo).port; await new Promise<void>((resolve)=>probe.close(()=>resolve()));
    base=`http://127.0.0.1:${port}`; await start();
    const response=await request("/api/auth/setup",{username:"admin",password,code}); expect(response.status).toBe(201); cookie=response.headers.get("set-cookie")!.split(";")[0];
  },20000);
  afterAll(async () => { if(child) await stop(); if(root) { for(const entry of await fs.readdir(root)) await fs.unlink(path.join(root,entry)); await fs.rmdir(root); } });
  it("provides a minimal unauthenticated readiness response", async () => {
    const response=await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true});
  });
  it("requires sign-in and configured email before sending a test", async () => {
    const anonymous=await fetch(`${base}/api/notification-test`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    expect(anonymous.status).toBe(401);
    expect((await request("/api/notification-test",{})).status).toBe(503);
  });
  it("collects replay data in the background without a dashboard request", async () => {
    let status: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      status = await (await request("/api/ingestion/status")).json();
      if (status.last_completed || status.last_error) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(status).toMatchObject({enabled:true,last_source:"replay",last_error:null,last_fresh_sync:null});
    const history=await (await request("/api/history?hours=24&station_id=AWS-001&source=replay")).json();
    expect(history.readings).toHaveLength(1);
  },20000);
  it("serves the historical evaluation only to signed-in users", async () => {
    expect((await fetch(`${base}/api/evaluation/chennai`)).status).toBe(401);
    const response = await request("/api/evaluation/chennai"); expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.report.historical_summary).toMatchObject({ scored: 224, warning: 69, critical: 0 });
    expect(data.report.labeled_evaluation).toBeNull();
    expect(data.report.utc_hour_breakdown.reduce((sum: number, row: { flagged: number }) => sum + row.flagged, 0)).toBe(69);
  });
  it("restricts and validates persistent notification policy settings", async () => {
    const endpoint=`${base}/api/notification-policy`, policy={recipient:"review@example.com",minimum_severity:"Critical",escalation_recipient:"lead@example.com",escalation_delay_minutes:30,max_attempts:4,retry_delay_minutes:7};
    expect((await fetch(endpoint)).status).toBe(401);
    const put=(body:unknown)=>fetch(endpoint,{method:"PUT",headers:{Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify(body)});
    expect((await put({...policy,escalation_delay_minutes:0})).status).toBe(400);
    expect((await put(policy)).status).toBe(200);
    expect((await (await request("/api/notification-policy")).json()).policy).toEqual(policy);
    expect(JSON.parse(await fs.readFile(path.join(root,"notification-policy.json"),"utf8"))).toEqual(policy);
  });
  it("filters historical analytics by source, station and UTC range", async () => {
    const start = "2024-01-01T00:00:00.000Z", end = "2024-01-03T00:00:00.000Z";
    const baseRow = { station_id:"HIST-TEST", station_name:"Historical test", latitude:13, longitude:80, temperature:20, humidity:55, pressure:1000, recorded_at:new Date().toISOString() };
    const samples = [
      {...baseRow,timestamp:start,source:"uploaded"},
      {...baseRow,timestamp:"2024-01-02T00:00:00.000Z",source:"replay"},
      {...baseRow,timestamp:end,source:"uploaded"},
      {...baseRow,station_id:"OTHER",timestamp:start,source:"uploaded"},
    ];
    await fs.appendFile(path.join(root,"observations.jsonl"),samples.map(row => JSON.stringify(row)).join("\n")+"\n");
    const query = new URLSearchParams({start,end,source:"uploaded",station_id:"HIST-TEST"});
    expect((await fetch(`${base}/api/analytics/history?${query}`)).status).toBe(401);
    const response = await request(`/api/analytics/history?${query}`); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.readings).toHaveLength(1); expect(data.readings[0]).toMatchObject({station_id:"HIST-TEST",source:"uploaded",timestamp:start}); expect(data.truncated).toBe(false);
    query.set("source","unknown"); expect((await request(`/api/analytics/history?${query}`)).status).toBe(400);
    query.set("source","uploaded"); query.set("start","2024-02-30T00:00:00.000Z"); expect((await request(`/api/analytics/history?${query}`)).status).toBe(400);
  });
  it("suppresses uncalibrated confidence in historical alert responses without changing stored records", async () => {
    const record={station_id:"LEGACY-CONFIDENCE",source:"replay",severity:"Warning",opened_at:new Date().toISOString(),details:{confidence:92,anomaly_score:0.72}};
    const file=path.join(root,"alerts.jsonl");
    await fs.appendFile(file,JSON.stringify(record)+"\n");
    const result=await (await request("/api/alert-history?station_id=LEGACY-CONFIDENCE")).json();
    expect(result.alerts[0].details).toMatchObject({confidence:null,anomaly_score:0.72});
    expect(await fs.readFile(file,"utf8")).toContain('"confidence":92');
  });
  it("restricts device credentials to their assigned station and supports revocation", async () => {
    const adminCookie = cookie;
    expect((await request("/api/users", { username: "device-operator", password, role: "operator" })).status).toBe(201);
    const operator = await request("/api/auth/login", { username: "device-operator", password, role: "operator" });
    cookie = operator.headers.get("set-cookie")!.split(";")[0];
    expect((await request("/api/device-credentials", { station_id: "TEST-DEVICE", label: "Test", expires_in_days: 30 })).status).toBe(403);
    expect((await request("/api/device-credentials")).status).toBe(403);
    cookie = adminCookie;
    expect((await request("/api/device-credentials", { station_id: "test/invalid", label: "Test", expires_in_days: 30 })).status).toBe(400);
    const created = await request("/api/device-credentials", { station_id: "TEST-DEVICE", label: "Test gateway", expires_in_days: 30 });
    expect(created.status).toBe(201);
    const { credential, token } = await created.json();
    expect(token).toMatch(/^sgd_[a-f0-9]{24}_[a-f0-9]{64}$/);
    expect((await (await request("/api/station-freshness")).json()).stations).toHaveLength(0);
    expect((await request(`/api/device-credentials/${credential.id}/monitoring`, { expected_interval_minutes: 0 })).status).toBe(400);
    expect((await request(`/api/device-credentials/${credential.id}/monitoring`, { expected_interval_minutes: 10 })).status).toBe(200);
    expect((await (await request("/api/station-freshness")).json()).stations).toEqual([expect.objectContaining({ station_id: "TEST-DEVICE", expected_interval_minutes: 10, status: "awaiting_readings" })]);
    const credentialFile = path.join(root, "device-credentials.json");
    const credentialData = JSON.parse(await fs.readFile(credentialFile, "utf8"));
    credentialData.find((item: { id: string }) => item.id === credential.id).monitoring_started_at = new Date(Date.now() - 31 * 60_000).toISOString();
    await fs.writeFile(credentialFile, JSON.stringify(credentialData));
    expect((await (await request("/api/station-freshness")).json()).stations).toEqual([expect.objectContaining({ station_id: "TEST-DEVICE", status: "disconnected", last_received_at: null })]);
    const list = await (await request("/api/device-credentials")).json();
    expect(list.credentials).toHaveLength(1); expect(JSON.stringify(list)).not.toContain(token); expect(JSON.stringify(list)).not.toContain("secret_hash");
    const device = (authorization: string, observations: unknown[], extra: Record<string,string> = {}) => fetch(`${base}/api/device/observations`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorization}`, ...extra }, body: JSON.stringify({ observations }) });
    const common = { station_id: "TEST-DEVICE", station_name: "Test device", latitude: 13, longitude: 80, temperature: 24, humidity: 60, pressure: 1003, pressure_type: "station" };
    const reading = { ...common, timestamp: new Date().toISOString() };
    expect((await device("invalid", [reading])).status).toBe(401);
    expect((await device(token, [reading], { "X-Forwarded-For": "203.0.113.12" })).status).toBe(403);
    expect((await device(token, [reading], { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await device(token, [reading, { ...reading, station_id: "OTHER" }])).status).toBe(403);
    expect((await (await request("/api/history?hours=24&station_id=TEST-DEVICE&source=station-api")).json()).readings).toHaveLength(0);
    const submitted = await device(token, [reading]); expect(submitted.status).toBe(200); expect((await submitted.json()).quality.inserted).toBe(1);
    expect((await (await request("/api/station-freshness")).json()).stations).toEqual([expect.objectContaining({ station_id: "TEST-DEVICE", status: "receiving" })]);
    expect((await (await device(token, [reading])).json()).quality.duplicate).toBe(1);
    const stale = await (await device(token, [{ ...reading, timestamp: new Date(Date.now() - 120 * 60_000).toISOString() }])).json();
    expect(stale.quality.inserted).toBe(1); expect(stale.detection).toMatchObject({ scored: 0, stale_or_superseded: 1 });
    expect((await request(`/api/device-credentials/${credential.id}/revoke`, {})).status).toBe(200);
    expect((await (await request("/api/station-freshness")).json()).stations).toHaveLength(0);
    expect((await device(token, [reading])).status).toBe(401);
    expect((await fetch(`${base}/api/config`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    const audit = await fs.readFile(path.join(root, "audit.jsonl"), "utf8"); expect(audit).not.toContain(token);
  }, 20000);
  it("marks station history as truncated when more than 2,000 readings match", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 2001 }, (_, index) => ({ station_id: "HISTORY-BOUNDARY", station_name: "History test", latitude: 13, longitude: 80, temperature: 20, humidity: 55, pressure: 1000, timestamp: new Date(now - (2000 - index) * 1000).toISOString(), recorded_at: new Date(now).toISOString(), source: "station-api" }));
    await fs.appendFile(path.join(root, "observations.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const result = await (await request("/api/history?hours=24&station_id=HISTORY-BOUNDARY&source=station-api")).json();
    expect(result).toMatchObject({ source: "station-api", truncated: true, limit: 2000 });
    expect(result.readings).toHaveLength(2000);
    expect(result.readings[0].timestamp).toBe(rows[1].timestamp);
  }, 20000);
  it("restricts station submissions to administrators and preserves quality and source", async () => {
    const timestamp=new Date().toISOString();
    const reading={station_id:"AWS-001",station_name:"Srinagar North",timestamp,latitude:34.08,longitude:74.8,temperature:20,humidity:60,pressure:1002,pressure_type:"station"};
    const anonymous=await fetch(`${base}/api/station-observations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({observations:[reading]})});
    expect(anonymous.status).toBe(401);
    const adminCookie=cookie;
    expect((await request("/api/users",{username:"station-operator",password,role:"operator"})).status).toBe(201);
    const operator=await request("/api/auth/login",{username:"station-operator",password,role:"operator"});
    expect(operator.status).toBe(200); cookie=operator.headers.get("set-cookie")!.split(";")[0];
    expect((await request("/api/station-observations",{observations:[reading]})).status).toBe(403);
    cookie=adminCookie;
    const response=await request("/api/station-observations",{observations:[reading,reading,{...reading,humidity:150},{...reading,timestamp:timestamp.slice(0,-1)}]});
    expect(response.status).toBe(200); const data=await response.json();
    expect(data).toMatchObject({source:"station-api",received:4,quality:{inserted:1,duplicate:1,invalid:2}});
    expect(data.invalid[1].issues.map((issue:any)=>issue.code)).toContain("timezone_required");
    const history=await (await request("/api/history?hours=24&station_id=AWS-001&source=station-api")).json();
    expect(history.readings).toHaveLength(1); expect(history.readings[0].source).toBe("station-api");
    const events=await (await request("/api/quality-events?limit=50")).json();
    expect(events.events.some((event:any)=>event.source === "station-api" && event.quality_status === "invalid" && event.raw.humidity === 150)).toBe(true);
    const alerts=await (await request("/api/alert-history?station_id=AWS-001")).json();
    expect(alerts.alerts.some((alert:any)=>alert.source === "station-api")).toBe(false);
    const oversized=await request("/api/station-observations",{observations:Array.from({length:101},()=>reading)}); expect(oversized.status).toBe(400);
  },20000);
  it("monitors submitted stations with source isolation, staleness, and baseline limits", async () => {
    expect((await fetch(`${base}/api/station-observations/monitor`)).status).toBe(401);
    const baseTime=Date.now();
    const common={station_id:"SYNTHETIC-MONITOR",station_name:"Test station",latitude:12.9,longitude:80.1,temperature:24,humidity:60,pressure:1003,pressure_type:"station"};
    const rows=Array.from({length:25},(_,index)=>({...common,timestamp:new Date(baseTime-(24-index)*60_000).toISOString()}));
    rows.push({...common,station_id:"SYNTHETIC-STALE",timestamp:new Date(baseTime-120*60_000).toISOString()});
    const submitted=await request("/api/station-observations",{observations:rows}); expect(submitted.status).toBe(200);
    const adminCookie=cookie;
    const operator=await request("/api/auth/login",{username:"station-operator",password,role:"operator"}); cookie=operator.headers.get("set-cookie")!.split(";")[0];
    const response=await request("/api/station-observations/monitor"); expect(response.status).toBe(200);
    const data=await response.json(); expect(data.source).toBe("station-api"); expect(data.truncated).toBe(false);
    expect(data.stations.find((station:any)=>station.station_id === "SYNTHETIC-MONITOR")).toMatchObject({stale:false,baseline_readings:24,anomaly_score:expect.any(Number)});
    expect(data.stations.find((station:any)=>station.station_id === "SYNTHETIC-STALE")).toMatchObject({stale:true,baseline_readings:0,anomaly_score:null,status:"Insufficient data"});
    expect(data.stations.find((station:any)=>station.station_id === "AWS-001")).toMatchObject({baseline_readings:0,anomaly_score:null,status:"Insufficient data"});
    expect(data.stations.some((station:any)=>station.station_id === "AWS-002")).toBe(false);
    cookie=adminCookie;
    const alerts=await (await request("/api/alert-history?station_id=SYNTHETIC-MONITOR")).json(); expect(alerts.alerts).toHaveLength(0);
  },20000);
  it("records fresh station deviations once and skips duplicates and old submissions", async () => {
    const monitor=await (await request("/api/station-observations/monitor")).json();
    const latest=monitor.stations.find((station:any)=>station.station_id === "SYNTHETIC-MONITOR");
    const reading={station_id:"SYNTHETIC-MONITOR",station_name:"Test station",timestamp:new Date(Date.parse(latest.timestamp)+1000).toISOString(),latitude:12.9,longitude:80.1,temperature:55,humidity:60,pressure:1003,pressure_type:"station"};
    const response=await request("/api/station-observations",{observations:[reading]});
    const data=await response.json(); expect(data.quality.inserted).toBe(1); expect(data.detection).toMatchObject({status:"complete",scored:1,flagged:1});
    const history=await (await request("/api/station-observations/monitor")).json();
    const flagged=history.recent_events.filter((event:any)=>event.station_id === "SYNTHETIC-MONITOR");
    expect(flagged).toHaveLength(1); expect(["Warning","Critical"]).toContain(flagged[0].severity);
    const repeat=await (await request("/api/station-observations",{observations:[{...reading,temperature:56}]})).json();
    expect(repeat.quality.duplicate).toBe(1); expect(repeat.detection.scored).toBe(0);
    const old=await (await request("/api/station-observations",{observations:[{...reading,timestamp:new Date(Date.now()-180*60_000).toISOString()}]})).json();
    expect(old.quality.inserted).toBe(1); expect(old.detection).toMatchObject({scored:0,stale_or_superseded:1});
    const after=await (await request("/api/station-observations/monitor")).json(); expect(after.recent_events.filter((event:any)=>event.station_id === "SYNTHETIC-MONITOR")).toHaveLength(1);
  },20000);
  it("lets operators acknowledge and resolve a station incident with an audit trail", async () => {
    const initial=await (await request("/api/station-incidents")).json();
    const incident=initial.incidents.find((item:any)=>item.station_id === "SYNTHETIC-MONITOR" && item.status === "open");
    expect(incident).toBeTruthy();
    expect(incident.details.recommended_action).toMatch(/Verify.*independent.*Consider sensor inspection/);
    expect(incident.details.detector_evidence).toMatchObject({model_version:"v1.0.0",warning_threshold:expect.any(Number),critical_threshold:expect.any(Number),baseline_samples:expect.any(Number),baseline_center:{temperature:expect.any(Number),humidity:expect.any(Number),pressure:expect.any(Number)},previous:{timestamp:expect.any(String),temperature:24,humidity:60,pressure:1003}});
    expect(Date.parse(incident.details.detector_evidence.previous.timestamp)).toBeLessThan(Date.parse(incident.details.timestamp));
    const adminCookie=cookie;
    const operator=await request("/api/auth/login",{username:"station-operator",password,role:"operator"}); cookie=operator.headers.get("set-cookie")!.split(";")[0];
    expect((await request("/api/notification-policy")).status).toBe(403);
    const team=(await (await request("/api/incident-assignees")).json()).users;
    const admin=team.find((user:any)=>user.username === "admin"), operatorUser=team.find((user:any)=>user.username === "station-operator");
    expect((await request(`/api/station-incidents/${incident.id}/assign`,{assignee_id:"f".repeat(32)})).status).toBe(400);
    expect((await (await request(`/api/station-incidents/${incident.id}/assign`,{assignee_id:admin.id})).json()).incident.assigned_name).toBe("admin");
    const acknowledged=await request(`/api/station-incidents/${incident.id}/acknowledge`,{note:"Reviewing observations"}); expect(acknowledged.status).toBe(200); expect((await acknowledged.json()).incident.status).toBe("acknowledged");
    expect((await request(`/api/station-incidents/${incident.id}/acknowledge`,{})).status).toBe(409);
    const investigating=await request(`/api/station-incidents/${incident.id}/investigate`,{note:"Checking independent evidence"}); expect(investigating.status).toBe(200); expect((await investigating.json()).incident).toMatchObject({status:"investigating",assigned_name:"admin"});
    expect((await (await request(`/api/station-incidents/${incident.id}/assign`,{assignee_id:operatorUser.id})).json()).incident.assigned_name).toBe("station-operator");
    expect((await request(`/api/station-incidents/${incident.id}/resolve`,{outcome:"sensor_fault"})).status).toBe(400);
    expect((await request(`/api/station-incidents/${incident.id}/resolve`,{outcome:"invalid",note:"bad"})).status).toBe(400);
    const resolved=await request(`/api/station-incidents/${incident.id}/resolve`,{note:"Reviewed against nearby observations",outcome:"weather_event"}); expect(resolved.status).toBe(200); expect((await resolved.json()).incident).toMatchObject({status:"resolved",resolution_outcome:"weather_event",assigned_name:"station-operator"});
    expect((await request(`/api/station-incidents/${incident.id}/resolve`,{})).status).toBe(409);
    expect((await request(`/api/station-incidents/${incident.id}/assign`,{assignee_id:admin.id})).status).toBe(409);
    const actions=await (await request(`/api/station-incidents/${incident.id}/actions`)).json(); expect(actions.actions.map((item:any)=>item.action)).toEqual(["resolve","assign","investigate","acknowledge","assign","detection"]); expect(actions.actions[0].note).toBe("Reviewed against nearby observations");
    cookie=adminCookie;
    const monitor=await (await request("/api/station-observations/monitor")).json(); const latest=monitor.stations.find((station:any)=>station.station_id === "SYNTHETIC-MONITOR");
    const next={station_id:"SYNTHETIC-MONITOR",station_name:"Test station",timestamp:new Date(Date.parse(latest.timestamp)+1000).toISOString(),latitude:12.9,longitude:80.1,temperature:55,humidity:60,pressure:1003,pressure_type:"station"};
    const later=await (await request("/api/station-observations",{observations:[next]})).json(); expect(later.detection.flagged).toBe(1);
    const final=await (await request("/api/station-incidents")).json(); const matching=final.incidents.filter((item:any)=>item.station_id === "SYNTHETIC-MONITOR");
    expect(matching).toHaveLength(2); expect(matching.find((item:any)=>item.status === "open").id).not.toBe(incident.id);
    const from=new Date(Date.now()-86400_000).toISOString(), to=new Date(Date.now()+86400_000).toISOString();
    const query=new URLSearchParams({start:from,end:to,source:"station-api",station_id:"SYNTHETIC-MONITOR",sensor:"temperature"});
    const analyticsResponse=await request(`/api/analytics/incidents?${query}`); expect(analyticsResponse.status).toBe(200);
    const analytics=await analyticsResponse.json(); expect(analytics.total).toBe(2); expect(analytics.bySensor.temperature).toBe(2); expect(analytics.byStation).toEqual([{station_id:"SYNTHETIC-MONITOR",count:2}]);
    query.set("status","resolved"); expect((await (await request(`/api/analytics/incidents?${query}`)).json()).total).toBe(1);
    query.delete("status");
    const snapshots=await (await request(`/api/analytics/alerts?${query}`)).json(); expect(snapshots.total).toBe(2); expect(snapshots.alerts.every((item:any)=>item.source === "station-api" && item.details.detector_evidence.model_version === "v1.0.0")).toBe(true);
    query.set("offset","invalid"); expect((await request(`/api/analytics/incidents?${query}`)).status).toBe(400);
    expect((await fetch(`${base}/api/analytics/incidents?${query}`)).status).toBe(401);
  },20000);
  it("validates and preserves uploaded rows without mixing sources", async () => {
    const t=new Date().toISOString();
    const csv=`timestamp,station_id,temperature,pressure,humidity,note\n${t},AWS-001,25,1005,65,"normal, reading"\n${t},AWS-001,25,1005,65,duplicate\n${t},AWS-002,20,1000,150,bad\n${t},AWS-003,,1000,50,missing`;
    const response=await request("/api/analyze",{csv}); expect(response.status).toBe(200);
    const data=await response.json(); expect(data.rows).toBe(2); expect(data.unique_observations).toBe(1); expect(data.quality).toEqual({inserted:1,duplicate:1,invalid:2}); expect(data.errors).toHaveLength(2);
    expect(data.stations[0]).toMatchObject({baseline_available:false,baseline_readings:0,status:"Insufficient data",anomaly_score:null});
    const issues=await (await request("/api/quality-events")).json(); expect(issues.events.map((e:any)=>e.quality_status)).toEqual(expect.arrayContaining(["invalid","duplicate"])); expect(issues.events.find((e:any)=>e.raw.station_id === "AWS-002").raw.humidity).toBe("150");
    const aliasCsv=`timestamp,station_id,temperature_C,pressure_hPa,humidity_percent\n${t},AWS-002,20,1000,50`;
    const aliasResponse=await request("/api/analyze",{csv:aliasCsv}); expect(aliasResponse.status).toBe(200); expect((await aliasResponse.json()).rows).toBe(1);
    const badHeaders=await request("/api/analyze",{csv:"timestamp,station_id,temperature,pressure,humidity,humidity\n2026-01-01T00:00:00Z,AWS-001,20,1000,50,50"}); expect(badHeaders.status).toBe(400);
    const uploaded=await (await request("/api/history?hours=24&station_id=AWS-001&source=uploaded")).json(); expect(uploaded.readings).toHaveLength(1);
    const realtime=await (await request("/api/realtime")).json(); expect(realtime.source).toBe("replay");
    expect(realtime.stations.length).toBeGreaterThan(0);
    expect(realtime.stations.every((station:any)=>station.confidence === null)).toBe(true);
    expect(realtime.weather_event.confidence).toBeNull();
    expect(realtime.weather_event.label).not.toMatch(/fault likely/i);
    const replay=await (await request("/api/history?hours=24&station_id=AWS-001&source=replay")).json(); expect(replay.readings).toHaveLength(1); expect(replay.readings[0].source).toBe("replay");
  },20000);
  it("accepts the NOAA sample with the original station identity and provenance", async () => {
    const csv=await fs.readFile(path.join("data","noaa","chennai-ghcnh-january-2024.csv"),"utf8");
    const response=await request("/api/analyze",{csv});
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.rows).toBe(248); expect(result.unique_observations).toBe(248);
    expect(result.period).toEqual({start:"2024-01-01T00:00:00.000Z",end:"2024-01-31T21:00:00.000Z"});
    expect(result.quality).toEqual({inserted:248,duplicate:0,invalid:0});
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({station_id:"INI0000VOMM",station_name:"CHENNAI INTL",readings_count:248,baseline_readings:96,baseline_available:true});
    expect(result.historical_summary).toMatchObject({scored:224,insufficient:24,baseline_window:96,minimum_history:24});
    expect(result.series).toHaveLength(248); expect(result.series.slice(0,24).every((row:any)=>row.anomaly_score === null)).toBe(true);
    const second=await (await request("/api/analyze",{csv})).json();
    expect(second.quality).toEqual({inserted:0,duplicate:248,invalid:0});
    expect(second.stations[0].baseline_readings).toBe(96); expect(second.series).toEqual(result.series);
    const issues=await (await request("/api/quality-events?limit=200")).json();
    expect(issues.events.some((event:any)=>event.source === "uploaded" && event.raw.noaa_dataset === "NOAA GHCNh v1" && event.raw.humidity_measurement_code === "D")).toBe(true);
  },20000);
  it("scores a historical spike using earlier observations without looking ahead", async () => {
    const header="timestamp,station_id,temperature,pressure,humidity\n";
    const start=Date.parse("2024-02-01T00:00:00Z");
    const rows=Array.from({length:56},(_,i)=>`${new Date(start+i*3600000).toISOString()},SYNTHETIC-TEST,${i===30 ? 55 : 20},1000,50`);
    const first=await (await request("/api/analyze",{csv:header+rows.slice(0,31).join("\n")})).json();
    expect(first.stations[0].recommended_action).toContain("quality flags");
    const full=await (await request("/api/analyze",{csv:header+rows.join("\n")})).json();
    expect(full.historical_summary).toMatchObject({scored:32,insufficient:24});
    expect(full.series[30].temperature).toBe(55);
    expect(["Warning", "Critical"]).toContain(full.series[30].status);
    expect(full.series[30].anomaly_score).toBeGreaterThanOrEqual(full.thresholds.warning_score);
    expect(full.series.slice(0,31)).toEqual(first.series);
  },20000);
  it("rejects datasets above the analysis limit before storing any rows", async () => {
    const header="timestamp,station_id,temperature,pressure,humidity\n";
    const start=Date.parse("2024-03-01T00:00:00Z");
    const rows=Array.from({length:5001},(_,i)=>`${new Date(start+i*60000).toISOString()},LIMIT-TEST,20,1000,50`);
    const response=await request("/api/analyze",{csv:header+rows.join("\n")});
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("5,000");
    const saved=await fs.readFile(path.join(root,"observations.jsonl"),"utf8"); expect(saved).not.toContain("LIMIT-TEST");
  },20000);
  it("retains administrator settings and audit records after a backend restart", async () => {
    const settings={warning_score:.21,critical_score:.73,regional_fraction:.5};
    expect((await request("/api/config",settings)).status).toBe(200); await stop(); await start();
    const login=await request("/api/auth/login",{username:"admin",password,role:"administrator"}); expect(login.status).toBe(200); cookie=login.headers.get("set-cookie")!.split(";")[0];
    expect((await (await request("/api/notification-policy")).json()).policy).toMatchObject({recipient:"review@example.com",minimum_severity:"Critical",escalation_recipient:"lead@example.com",escalation_delay_minutes:30});
    expect(await (await request("/api/config")).json()).toEqual(settings);
    const incidents=await (await request("/api/station-incidents")).json(); expect(incidents.incidents.some((item:any)=>item.station_id === "SYNTHETIC-MONITOR" && item.status === "resolved")).toBe(true); expect(incidents.incidents.some((item:any)=>item.station_id === "SYNTHETIC-MONITOR" && item.status === "open")).toBe(true);
    const email=await (await request("/api/notification-status")).json(); expect(email).toMatchObject({email_enabled:false,queue:{pending:0,sent:0,failed:0}});
    const audit=await fs.readFile(path.join(root,"audit.jsonl"),"utf8"); expect(audit).toContain("detector_settings.updated"); expect(audit).toContain("user.setup");
  },20000);
});
