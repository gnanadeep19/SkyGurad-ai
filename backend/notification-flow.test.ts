import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { EmailWorker, type EmailConfig } from "./email-notifications.js";
import { validateObservation } from "./observations.js";
import { FileStorage, PostgresStorage } from "./storage.js";

describe("station incident notification flow", () => {
  for (const mode of ["file","postgres"] as const) it(`honors severity and escalates only unacknowledged incidents in ${mode} storage`, async () => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-escalation-test-"));
    const db=mode === "postgres" ? await PGlite.create() : null;
    try {
      if(db) await db.exec(await fs.readFile(path.resolve("backend/schema.sql"),"utf8"));
      const adapter:any=db && {query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
      const storage=db ? new PostgresStorage(adapter) : new FileStorage(directory);
      const policy={recipient:"primary@example.com",minimum_severity:"Critical" as const,escalation_recipient:"lead@example.com",escalation_delay_minutes:5,max_attempts:2,retry_delay_minutes:7};
      await storage.setNotificationPolicy(policy,"admin"); expect(await storage.getNotificationPolicy(policy)).toEqual(policy);
      const record=async (station:string,offset:number,status:"Warning"|"Critical")=>{const timestamp=new Date(Date.now()+offset*1000).toISOString(); const reading={station_id:station,station_name:station,latitude:13,longitude:80,temperature:30,humidity:60,pressure:1000,timestamp}; if(db) await storage.ingest([validateObservation(reading,{source:"station-api",recordedAt:timestamp})]); await storage.recordResults("station-api",[{station_id:station,timestamp,anomaly_score:.8,status,health:50,confidence:null}],{createIncidents:true,notificationPolicy:policy});};
      await record("TEST-A",0,"Warning"); expect(await storage.notificationCounts()).toMatchObject({pending:0});
      await record("TEST-A",1,"Critical"); await record("TEST-A",2,"Critical"); expect(await storage.notificationCounts()).toMatchObject({pending:2});
      const primary=(await storage.claimNotification())!; expect(primary).toMatchObject({recipient:"primary@example.com",kind:"initial"}); await storage.finishNotification(primary.id,primary.attempts,false); expect(await storage.claimNotification()).toBeNull();
      if(db) { const queued=await db.query("SELECT max_attempts,retry_delay_minutes,EXTRACT(EPOCH FROM (next_attempt_at-now())) AS delay FROM notification_outbox WHERE kind='initial'"); expect(queued.rows[0]).toMatchObject({max_attempts:2,retry_delay_minutes:7}); expect(Number((queued.rows[0] as any).delay)).toBeGreaterThan(400); await db.query("UPDATE notification_outbox SET next_attempt_at=now()-interval '1 minute' WHERE kind='initial'"); }
      else {const file=path.join(directory,"notification-outbox.jsonl"),lines=(await fs.readFile(file,"utf8")).trim().split("\n").map(line=>JSON.parse(line)); const latest=lines.filter(job=>job.id===primary.id).at(-1); expect(latest).toMatchObject({max_attempts:2,retry_delay_minutes:7}); expect(Date.parse(latest.next_attempt_at)-Date.now()).toBeGreaterThan(400000); await fs.appendFile(file,JSON.stringify({...latest,next_attempt_at:new Date(Date.now()-1000).toISOString()})+"\n"); }
      const retry=(await storage.claimNotification())!; expect(retry).toMatchObject({id:primary.id,attempts:2}); await storage.finishNotification(retry.id,retry.attempts,true);
      if(db) await db.query("UPDATE notification_outbox SET next_attempt_at=now()-interval '1 minute' WHERE kind='escalation'");
      else {const file=path.join(directory,"notification-outbox.jsonl"),lines=(await fs.readFile(file,"utf8")).trim().split("\n").map(line=>JSON.parse(line)); const escalation=lines.find(job=>job.kind === "escalation"); await fs.appendFile(file,JSON.stringify({...escalation,next_attempt_at:new Date(Date.now()-1000).toISOString()})+"\n");}
      const sendMail=vi.fn().mockResolvedValue(undefined);
      const worker=new EmailWorker(storage,{host:"smtp.example.com",port:587,secure:false,user:"test",password:"test",from:"sender@example.com",recipient:"primary@example.com"},{sendMail});
      await worker.runOnce(); expect(sendMail).toHaveBeenCalledTimes(1); expect(sendMail.mock.calls[0][0]).toMatchObject({to:"lead@example.com",subject:"SkyGuard: Unacknowledged Critical station incident"}); expect(await storage.notificationCounts()).toMatchObject({sent:2});
      await record("TEST-B",3,"Critical"); const incident=(await storage.incidents()).find(item=>item.station_id === "TEST-B")!; await storage.transitionIncident(incident.id,"acknowledge","operator","");
      expect(await storage.notificationCounts()).toMatchObject({cancelled:1});
    } finally { if(db) await db.close(); await fs.rm(directory,{recursive:true,force:true}); }
  },30000);
  it("upgrades an existing incident table without losing records", async () => {
    const db=await PGlite.create();
    try {
      await db.exec("CREATE TABLE station_incidents (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, station_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')), severity TEXT NOT NULL CHECK (severity IN ('Warning','Critical')), opened_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, details JSONB NOT NULL DEFAULT '{}'::jsonb); CREATE UNIQUE INDEX station_incidents_one_active_idx ON station_incidents (source,station_id) WHERE status IN ('open','acknowledged'); INSERT INTO station_incidents(station_id,source,status,severity,opened_at) VALUES ('EXISTING','station-api','open','Warning',now())");
      const schema=await fs.readFile(path.resolve("backend/schema.sql"),"utf8"); await db.exec(schema); await db.exec(schema);
      const result=await db.query("UPDATE station_incidents SET status='investigating', assigned_name='Casey' WHERE station_id='EXISTING' RETURNING *");
      expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({station_id:"EXISTING",status:"investigating",assigned_name:"Casey"});
    } finally { await db.close(); }
  },30000);
  it("queues once, retries a failed delivery, and cancels a resolved incident's pending message", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(await fs.readFile(path.resolve("backend/schema.sql"), "utf8"));
      const adapter: any = { query: (sql: string, params?: any[]) => db.query(sql, params), connect: async () => ({ query: (sql: string, params?: any[]) => db.query(sql, params), release: () => {} }), end: () => db.close() };
      const storage = new PostgresStorage(adapter);
      const now = Date.now();
      const timestamp = (offset: number) => new Date(now + offset * 1000).toISOString();
      const record = async (offset: number) => {
        const reading = { station_id: "TEST-ONLY", station_name: "Test station", latitude: 13, longitude: 80, temperature: 45, humidity: 60, pressure: 1000, timestamp: timestamp(offset) };
        const event = validateObservation(reading, { source: "station-api", recordedAt: timestamp(5) });
        expect((await storage.ingest([event])).inserted).toBe(1);
        await storage.recordResults("station-api", [{ station_id: reading.station_id, timestamp: reading.timestamp, anomaly_score: .8, status: "Critical", health: 48, confidence: null }], { createIncidents: true, notifyRecipient: "operator@example.com" });
      };
      const config: EmailConfig = { host: "smtp.example.com", port: 587, secure: false, user: "sender", password: "test-only", from: "sender@example.com", recipient: "operator@example.com" };
      const sendMail = vi.fn().mockRejectedValueOnce(new Error("temporary error")).mockResolvedValue(undefined);
      const worker = new EmailWorker(storage, config, { sendMail });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await record(0);
        await record(1);
        const incident = (await storage.incidents())[0];
        expect(await storage.incidents()).toHaveLength(1);
        expect(await storage.notificationCounts()).toMatchObject({ pending: 1, sent: 0 });
        await worker.runOnce();
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(await storage.notificationCounts()).toMatchObject({ pending: 1, sent: 0 });
        await worker.runOnce();
        expect(sendMail).toHaveBeenCalledTimes(1); // Retry is delayed.
        await db.query("UPDATE notification_outbox SET next_attempt_at=now() - interval '1 second'");
        await worker.runOnce();
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(sendMail.mock.calls[1][0]).toMatchObject({ to: "operator@example.com", subject: "SkyGuard: Critical station incident" });
        expect(sendMail.mock.calls[1][0].text).toContain("An anomaly is not proof of a sensor fault");
        expect(await storage.notificationCounts()).toMatchObject({ pending: 0, sent: 1 });
        expect((await storage.transitionIncident(incident.id, "acknowledge", "operator", "Reviewing")).incident?.status).toBe("acknowledged");
        expect((await storage.transitionIncident(incident.id, "investigate", "operator", "Checking", {actorName:"Casey"})).incident).toMatchObject({status:"investigating",assigned_to:"operator",assigned_name:"Casey"});
        await record(5);
        expect(await storage.incidents()).toHaveLength(1);
        expect((await storage.incidents())[0]).toMatchObject({id:incident.id,status:"investigating",assigned_name:"Casey"});
        expect((await storage.transitionIncident(incident.id, "resolve", "operator", "Compared independent data", {outcome:"weather_event"})).incident).toMatchObject({status:"resolved",resolution_outcome:"weather_event",assigned_name:"Casey"});
        await record(2);
        const second = (await storage.incidents()).find(item => item.status === "open")!;
        expect(second.id).not.toBe(incident.id);
        expect((await storage.notificationCounts()).pending).toBe(1);
        await storage.transitionIncident(second.id, "resolve", "operator", "Resolved before delivery");
        await worker.runOnce();
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(await storage.notificationCounts()).toMatchObject({ pending: 0, sent: 1, cancelled: 1 });
        await record(3);
        const third = (await storage.incidents()).find(item => item.status === "open")!;
        const inFlight = (await storage.claimNotification())!;
        await storage.transitionIncident(third.id, "resolve", "operator", "Resolved during delivery");
        await storage.finishNotification(inFlight.id, inFlight.attempts, false);
        expect(await storage.notificationCounts()).toMatchObject({ pending: 0, cancelled: 2 });
        await record(4);
        const fourth = (await storage.incidents()).find(item => item.status === "open")!;
        await storage.claimNotification();
        await storage.transitionIncident(fourth.id, "resolve", "operator", "Resolved during interrupted delivery");
        await db.query("UPDATE notification_outbox SET locked_at=now() - interval '6 minutes' WHERE status='sending'");
        await worker.runOnce();
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(await storage.notificationCounts()).toMatchObject({ pending: 0, sending: 0, cancelled: 3 });
      } finally { warning.mockRestore(); }
    } finally { await db.close(); }
  }, 30000);

  it("does not retry a failed in-flight message after an incident is resolved in file storage", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-notification-test-"));
    try {
      const storage = new FileStorage(directory);
      const timestamp = new Date().toISOString();
      await storage.recordResults("station-api", [{ station_id: "TEST-ONLY", timestamp, anomaly_score: .8, status: "Critical", health: 48, confidence: null }], { createIncidents: true, notifyRecipient: "operator@example.com" });
      const incident = (await storage.incidents())[0];
      const claimed = (await storage.claimNotification())!;
      expect((await storage.transitionIncident(incident.id, "investigate", "operator", "Reviewing", {actorName:"Casey"})).incident).toMatchObject({status:"investigating",assigned_name:"Casey"});
      await storage.recordResults("station-api", [{ station_id: "TEST-ONLY", timestamp:new Date(Date.now()+1000).toISOString(), anomaly_score: .8, status: "Critical", health: 48, confidence: null }], { createIncidents: true, notifyRecipient: "operator@example.com" });
      expect(await new FileStorage(directory).incidents()).toHaveLength(1);
      expect((await storage.transitionIncident(incident.id, "resolve", "operator", "Reviewed", {outcome:"false_alarm"})).incident).toMatchObject({status:"resolved",resolution_outcome:"false_alarm"});
      expect((await new FileStorage(directory).incidents())[0]).toMatchObject({resolution_outcome:"false_alarm",assigned_name:"Casey"});
      await storage.finishNotification(claimed.id, claimed.attempts, false);
      expect(await storage.notificationCounts()).toMatchObject({ pending: 0, cancelled: 1 });
      expect(await storage.claimNotification()).toBeNull();
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
