import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FileStorage, PostgresStorage } from "./storage.js";
import { validateObservation } from "./observations.js";
import { EmailWorker } from "./email-notifications.js";

describe("station recovery and arrival incidents", () => {
  for (const mode of ["file", "postgres"] as const) it(`creates one missing-data incident and email in ${mode} mode`, async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-arrival-"));
    const db=mode === "postgres" ? await PGlite.create() : null;
    try {
      if(db) await db.exec(await fs.readFile(path.resolve("backend/schema.sql"),"utf8"));
      const adapter:any=db && {query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
      const storage=db ? new PostgresStorage(adapter) : new FileStorage(dir);
      const policy={recipient:"operator@example.com",minimum_severity:"Warning" as const,escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2};
      const detail={explanation:"No recent data received from the station."};
      await storage.updateStationArrival("TEST",true,detail,policy);
      await storage.updateStationArrival("TEST",true,detail,policy);
      const incidents=await storage.incidents(); expect(incidents).toHaveLength(1); expect(incidents[0]).toMatchObject({source:"station-health",details:detail});
      expect(await storage.notificationCounts()).toMatchObject({pending:1});
      const sender={sendMail:vi.fn().mockResolvedValue(undefined)};
      await new EmailWorker(storage,{host:"localhost",port:587,secure:false,user:"test",password:"test",from:"sender@example.com",recipient:policy.recipient},sender).runOnce();
      expect(sender.sendMail).toHaveBeenCalledOnce();
      await storage.transitionIncident(incidents[0].id,"acknowledge","operator","");
      await storage.transitionIncident(incidents[0].id,"resolve","operator","");
      await storage.updateStationArrival("TEST",true,detail,policy);
      expect(await storage.incidents()).toHaveLength(1);
      await storage.updateStationArrival("TEST",false,detail,policy);
      await storage.updateStationArrival("TEST",true,detail,policy);
      expect(await storage.incidents()).toHaveLength(2);
      await storage.transitionIncident((await storage.incidents()).find(item=>item.status === "open")!.id,"resolve","operator","");
      await storage.resetUnmonitoredArrival([]);
      await storage.updateStationArrival("TEST",true,detail,policy);
      expect(await storage.incidents()).toHaveLength(3);
    } finally { if(db) await db.close(); await fs.rm(dir,{recursive:true,force:true}); }
  },30000);

  it("retains PostgreSQL work after scoring failure and commits once on retry", async () => {
    const db=await PGlite.create();
    try {
      await db.exec(await fs.readFile(path.resolve("backend/schema.sql"),"utf8"));
      const adapter:any={query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
      const storage=new PostgresStorage(adapter), timestamp=new Date().toISOString();
      const reading={station_id:"TEST",station_name:"Test",latitude:13,longitude:80,temperature:40,humidity:60,pressure:1000,timestamp};
      await storage.ingest([validateObservation(reading,{source:"station-api"})]);
      expect(await storage.pendingStationObservations(10)).toHaveLength(1);
      await db.exec("ALTER TABLE anomaly_results ADD CONSTRAINT test_failure CHECK (score < 0)");
      const result={station_id:"TEST",timestamp,anomaly_score:.9,status:"Critical",health:50,confidence:null};
      await expect(storage.recordResults("station-api",[result],{createIncidents:true})).rejects.toThrow();
      expect(await storage.pendingStationObservations(10)).toHaveLength(1); expect(await storage.incidents()).toHaveLength(0);
      await db.exec("ALTER TABLE anomaly_results DROP CONSTRAINT test_failure");
      await storage.recordResults("station-api",[result],{createIncidents:true});
      await storage.recordResults("station-api",[result],{createIncidents:true});
      expect(await storage.pendingStationObservations(10)).toHaveLength(0); expect(await storage.incidents()).toHaveLength(1);
    } finally { await db.close(); }
  },30000);

  it("repairs an interrupted file-mode result before marking it complete", async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-file-retry-"));
    try {
      const storage=new FileStorage(dir), timestamp=new Date().toISOString();
      const reading={station_id:"TEST",station_name:"Test",latitude:13,longitude:80,temperature:40,humidity:60,pressure:1000,timestamp};
      await storage.ingest([validateObservation(reading,{source:"station-api"})]);
      const result={station_id:"TEST",timestamp,anomaly_score:.9,status:"Critical",health:50,confidence:null};
      await fs.writeFile(path.join(dir,"alerts.jsonl"),JSON.stringify({source:"station-api",station_id:"TEST",status:"detected",severity:"Critical",opened_at:timestamp,details:result})+"\n");
      await storage.recordResults("station-api",[result],{createIncidents:true,notifyRecipient:"operator@example.com"});
      await storage.recordResults("station-api",[result],{createIncidents:true,notifyRecipient:"operator@example.com"});
      expect(await storage.incidents()).toHaveLength(1); expect(await storage.notificationCounts()).toMatchObject({pending:1});
      expect(await storage.pendingStationObservations(10)).toHaveLength(1);
      await storage.finishStationObservation("TEST",timestamp,"complete");
      expect(await new FileStorage(dir).pendingStationObservations(10)).toHaveLength(0);
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
  });
});
