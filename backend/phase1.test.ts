import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { validateObservation, observationTimestamp } from "./observations";
import { FileStorage, PostgresStorage } from "./storage";
import { migrateLegacyHistory, migrateLegacySidecars } from "./migration";

const now = new Date().toISOString();
const raw = { station_id:"AWS-001", station_name:"Srinagar North", latitude:34.08, longitude:74.8, timestamp:now, temperature:25.4, humidity:71, pressure:1004.2 };
const event = (changes: Record<string, unknown> = {}, source: "replay" | "open-meteo" = "replay") => validateObservation({ ...raw, ...changes }, { source, recordedAt: now });

describe("canonical observations", () => {
  it("validates units, ranges, timestamps and blank measurements without discarding the original", () => {
    const candidate = event({ humidity:"", temperature:70, timestamp:"not-a-date", pressure_unit:"psi" });
    expect(candidate.observation).toBeNull();
    expect(candidate.raw.humidity).toBe("");
    expect(candidate.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["invalid_timestamp","missing_or_invalid","out_of_range","unsupported_unit"]));
    expect(observationTimestamp("2026-02-30T08:00:00Z")).toBeNull();
    expect(observationTimestamp("2026-01-02T12:30")).toBe("2026-01-02T07:00:00.000Z");
  });
  it("flags unknown stations and rejects future data", () => {
    const warning = validateObservation(raw, {source:"live",recordedAt:now,knownStations:new Set(["OTHER"])});
    expect(warning.observation).not.toBeNull(); expect(warning.issues[0].code).toBe("unknown_station");
    const future=event({timestamp:new Date(Date.now()+3600000).toISOString()});
    expect(future.observation).toBeNull(); expect(future.issues[0].code).toBe("future_timestamp");
  });
});

describe("transitional file storage and migration", () => {
  it("keeps invalid evidence, separates sources, persists settings and backs up the original", async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-phase1-")); const source=path.join(root,"legacy"), dest=path.join(root,"store");
    await fs.mkdir(source); await fs.mkdir(dest);
    try {
      const file=path.join(source,"observations.jsonl");
      const initial=JSON.stringify({...raw,source:"replay",recorded_at:now})+"\n"+JSON.stringify({...raw,humidity:150,source:"replay",recorded_at:now})+"\n"+"{bad json\n";
      await fs.writeFile(file,initial,"utf8"); const store=new FileStorage(dest);
      const result=await migrateLegacyHistory(store,file);
      expect(result).toMatchObject({lines:3,inserted:1,invalid:2});
      expect(await fs.readFile(file,"utf8")).toBe(initial); expect(await fs.readFile(result.backupPath,"utf8")).toBe(initial);
      expect(await store.ingest([event(),event({},"open-meteo")])).toEqual({inserted:1,invalid:0,duplicate:1});
      expect((await store.history({hours:24,source:"replay"}))).toHaveLength(1);
      expect((await store.history({hours:24,source:"open-meteo"}))).toHaveLength(1);
      const issues=await store.qualityEvents(20); expect(issues.map((entry)=>entry.quality_status)).toEqual(expect.arrayContaining(["invalid","duplicate"]));
      const settings={warning_score:.2,critical_score:.7,regional_fraction:.5}; await store.setSettings(settings,"admin-1");
      expect(await new FileStorage(dest).getSettings({warning_score:.3,critical_score:.6,regional_fraction:.5})).toEqual(settings);
      expect(await fs.readFile(path.join(dest,"audit.jsonl"),"utf8")).toContain("admin-1");
    } finally {
      for(const directory of [source,dest]) { for(const entry of await fs.readdir(directory)) await fs.unlink(path.join(directory,entry)); await fs.rmdir(directory); } await fs.rmdir(root);
    }
  });
});

describe("file-to-PostgreSQL migration", () => {
  it("backs up and imports observations, quality evidence, results, settings, and audit events safely", async () => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-migrate-"));
    const db=await PGlite.create(); await db.exec(await fs.readFile(path.resolve("backend/schema.sql"),"utf8"));
    const adapter:any={query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
    const target=new PostgresStorage(adapter); const original=new FileStorage(directory);
    try {
      await original.ingest([event(),event({humidity:101})]);
      const settings={warning_score:.22,critical_score:.72,regional_fraction:.5}; await original.setSettings(settings,"admin");
      await original.recordResults("replay",[{station_id:"AWS-001",timestamp:now,anomaly_score:.8,status:"Critical",health:48,confidence:88}]);
      const historyPath=path.join(directory,"observations.jsonl"); const before=await fs.readFile(historyPath,"utf8");
      const history=await migrateLegacyHistory(target,historyPath); expect(history.inserted).toBe(1); expect(await fs.readFile(history.backupPath,"utf8")).toBe(before);
      const sidecars=await migrateLegacySidecars(target,directory); expect(sidecars.settings).toBe("imported"); expect(sidecars.auditEvents).toBe(1); expect(sidecars.qualityEvents).toBe(2);
      expect(await target.history({hours:24,source:"replay"})).toHaveLength(1); expect(await target.alertHistory()).toHaveLength(1); expect(await target.getSettings(settings)).toEqual(settings);
      expect((await target.qualityEvents(20)).some((item)=>item.quality_status === "invalid")).toBe(true);
      const again=await migrateLegacySidecars(target,directory); expect(again.settings).toBe("existing database settings preserved"); expect(again.auditEvents).toBe(0); expect(await target.alertHistory()).toHaveLength(1);
      expect(await fs.readFile(historyPath,"utf8")).toBe(before);
    } finally { await db.close(); for(const entry of await fs.readdir(directory)) await fs.unlink(path.join(directory,entry)); await fs.rmdir(directory); }
  },30000);
});

describe("PostgreSQL storage", () => {
  it("stores validation events, prevents duplicates, persists results/settings, and restores a backup", async () => {
    const db=await PGlite.create(); const schema=await fs.readFile(path.resolve("backend/schema.sql"),"utf8"); await db.exec(schema);
    const adapter:any={query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
    const store=new PostgresStorage(adapter);
    try {
      expect(await store.ingest([event(),event(),event({humidity:101}),event({},"open-meteo")])).toEqual({inserted:2,duplicate:1,invalid:1});
      const dispositions: { dispositions: Array<"inserted" | "invalid" | "duplicate"> }={dispositions:[]};
      expect(await store.ingest([event(),event({humidity:101})],dispositions)).toEqual({inserted:0,duplicate:1,invalid:1});
      expect(dispositions.dispositions).toEqual(["duplicate","invalid"]);
      expect(await store.history({hours:24,source:"replay"})).toHaveLength(1);
      expect(await store.history({hours:24,source:"open-meteo"})).toHaveLength(1);
      const range = {start:new Date(Date.parse(now)-1000).toISOString(),end:new Date(Date.parse(now)+1000).toISOString(),stationId:"AWS-001",source:"replay" as const,limit:2};
      expect(await store.historyRange(range)).toHaveLength(1);
      expect(await store.historyRange({...range,stationId:"OTHER"})).toHaveLength(0);
      expect(await store.historyRange({...range,start:now})).toHaveLength(1);
      expect(await store.historyRange({...range,end:now})).toHaveLength(0);
      const issues=await store.qualityEvents(10); expect(issues.map((item)=>item.quality_status)).toEqual(expect.arrayContaining(["invalid","duplicate"]));
      const settings={warning_score:.25,critical_score:.75,regional_fraction:.5}; await store.setSettings(settings,"admin-1"); expect(await store.getSettings(settings)).toEqual(settings);
      const scored={station_id:"AWS-001",timestamp:now,anomaly_score:.8,status:"Critical",health:48,confidence:88};
      await store.recordResults("replay",[scored]); await store.recordResults("replay",[scored]);
      expect(await store.alertHistory("AWS-001")).toHaveLength(1);
      const stationEvent=validateObservation(raw,{source:"station-api",recordedAt:now});
      const stationDispositions: { dispositions: Array<"inserted" | "invalid" | "duplicate"> }={dispositions:[]};
      expect(await store.ingest([stationEvent],stationDispositions)).toEqual({inserted:1,duplicate:0,invalid:0});
      expect(stationDispositions.dispositions).toEqual(["inserted"]);
      expect(await store.stationActivity(["AWS-001", "UNKNOWN"])).toEqual([expect.objectContaining({ station_id: "AWS-001", last_received_at: now, last_observed_at: now })]);
      await store.recordResults("station-api",[{...scored,status:"Warning",confidence:null}],{createIncidents:true,notifyRecipient:"ops@example.com"});
      expect(await store.alertHistory(undefined,"station-api")).toHaveLength(1);
      expect((await store.alertHistory(undefined,"station-api"))[0]).toMatchObject({source:"station-api",severity:"Warning"});
      const incident=(await store.incidents())[0]; expect(incident).toMatchObject({station_id:"AWS-001",status:"open"});
      const escalationTime=new Date(Date.parse(now)-20_000).toISOString();
      await store.ingest([validateObservation({...raw,timestamp:escalationTime},{source:"station-api",recordedAt:now})]);
      await store.recordResults("station-api",[{...scored,timestamp:escalationTime,status:"Critical",confidence:null}],{createIncidents:true,notifyRecipient:"ops@example.com"});
      expect((await store.incidents())).toHaveLength(1); expect((await store.incidents())[0].severity).toBe("Critical");
      expect(await store.notificationCounts()).toMatchObject({pending:1,sent:0});
      const job=await store.claimNotification(); expect(job).toMatchObject({incident_id:incident.id,recipient:"ops@example.com",attempts:1,severity:"Critical"});
      await store.finishNotification(job!.id,job!.attempts,true); expect(await store.notificationCounts()).toMatchObject({sent:1,pending:0});
      expect((await store.transitionIncident(incident.id,"acknowledge","operator","Investigating")).incident?.status).toBe("acknowledged");
      expect((await store.transitionIncident(incident.id,"acknowledge","operator","")).error).toBe("conflict");
      expect((await store.transitionIncident(incident.id,"resolve","operator","Checked")).incident?.status).toBe("resolved");
      expect((await store.incidentActions(incident.id)).map(action=>action.action)).toEqual(["resolve","acknowledge","detection","detection"]);
      const nextTime=new Date(Date.parse(now)-10_000).toISOString();
      await store.ingest([validateObservation({...raw,timestamp:nextTime},{source:"station-api",recordedAt:now})]);
      await store.recordResults("station-api",[{...scored,timestamp:nextTime,status:"Warning",confidence:null}],{createIncidents:true,notifyRecipient:"ops@example.com"});
      const nextIncident=(await store.incidents()).find(item=>item.status === "open")!;
      expect(nextIncident.id).not.toBe(incident.id); expect((await store.notificationCounts()).pending).toBe(1);
      await store.transitionIncident(nextIncident.id,"resolve","operator",""); expect((await store.notificationCounts()).cancelled).toBe(1);
      const beforeRollback=await db.query("SELECT count(*)::int AS count FROM observations");
      const rolledBack: { dispositions: Array<"inserted" | "invalid" | "duplicate"> }={dispositions:[]};
      await expect(store.ingest([event({timestamp:new Date(Date.now()-5000).toISOString()}), {...event({humidity:101}),recorded_at:"invalid"}],rolledBack)).rejects.toThrow();
      expect(rolledBack.dispositions).toEqual([]);
      expect(await db.query("SELECT count(*)::int AS count FROM observations")).toEqual(beforeRollback);
      expect((await db.query("SELECT count(*)::int AS count FROM anomaly_results")).rows[0]).toMatchObject({count:4});
      expect((await db.query("SELECT count(*)::int AS count FROM audit_events")).rows[0]).toMatchObject({count:4});
      expect((await db.query("SELECT count(*)::int AS count FROM alerts")).rows[0]).toMatchObject({count:4});
      const dump=await db.dumpDataDir(); const restored=await PGlite.create({ loadDataDir:dump });
      try { expect((await restored.query("SELECT count(*)::int AS count FROM observations")).rows[0]).toMatchObject({count:5}); expect((await restored.query("SELECT settings FROM detector_settings WHERE id=1")).rows[0]).toMatchObject({settings}); }
      finally { await restored.close(); }
    } finally { await db.close(); }
  }, 30000);
});
