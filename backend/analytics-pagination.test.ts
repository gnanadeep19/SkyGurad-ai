import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FileStorage, PostgresStorage, type Incident, type Storage } from "./storage";
import { validateObservation } from "./observations";

const start = "2024-01-01T00:00:00.000Z", end = "2024-02-01T00:00:00.000Z";
const fixedTime = Date.parse(start);

describe("historical analytics pagination", () => {
  it("filters the complete incident set before paging in both storage modes", async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-analytics-"));
    const db=await PGlite.create(); await db.exec(await fs.readFile(path.resolve("backend/schema.sql"),"utf8"));
    const adapter:any={query:(sql:string,params?:any[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:any[])=>db.query(sql,params),release:()=>{}}),end:()=>db.close()};
    const file=new FileStorage(root), pg=new PostgresStorage(adapter);
    const records: Incident[] = Array.from({length:205},(_,i)=>({id:String(i+1).padStart(4,"0"),station_id:i%2 ? "STATION-B" : "STATION-A",source:"station-api",status:"resolved",severity:i%2 ? "Critical" : "Warning",opened_at:new Date(fixedTime+i*3600000).toISOString(),updated_at:new Date(fixedTime+i*3600000).toISOString(),acknowledged_at:null,resolved_at:new Date(fixedTime+i*3600000).toISOString(),details:{affected:i%3===0 ? ["temperature"] : i%3===1 ? ["humidity"] : []}}));
    try {
      await fs.writeFile(path.join(root,"station-incidents.jsonl"),records.map(incident=>JSON.stringify({incident,action:{incident_id:incident.id,actor_id:"system",action:"detection",note:"",created_at:incident.opened_at}})).join("\n")+"\n");
      await fs.writeFile(path.join(root,"alerts.jsonl"),records.map(item=>JSON.stringify({station_id:item.station_id,source:item.source,status:"detected",severity:item.severity,opened_at:item.opened_at,details:item.details})).join("\n")+"\n");
      for(const incident of records) await db.query("INSERT INTO station_incidents(station_id,source,status,severity,opened_at,updated_at,resolved_at,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[incident.station_id,incident.source,incident.status,incident.severity,incident.opened_at,incident.updated_at,incident.resolved_at,JSON.stringify(incident.details)]);
      await db.query("INSERT INTO observations(station_id,station_name,latitude,longitude,observed_at,received_at,source,temperature,humidity,pressure) SELECT station_id,station_id,10,80,opened_at,opened_at,source,20,60,1000 FROM station_incidents");
      await db.query("INSERT INTO alerts(observation_id,station_id,source,status,severity,opened_at,updated_at,details) SELECT o.id,o.station_id,o.source,'detected',i.severity,o.observed_at,o.received_at,i.details FROM observations o JOIN station_incidents i ON i.station_id=o.station_id AND i.opened_at=o.observed_at");
      for(const store of [file,pg] as Storage[]) {
        const options={start,end,source:"station-api" as const,limit:50,offset:0};
        const first=await store.incidentAnalytics(options), fifth=await store.incidentAnalytics({...options,offset:200});
        expect(first.total).toBe(205); expect(first.incidents).toHaveLength(50); expect(fifth.incidents).toHaveLength(5);
        expect(first.bySensor).toEqual({temperature:69,humidity:68,pressure:0,unidentified:68});
        expect(first.byStation).toEqual([{station_id:"STATION-A",count:103},{station_id:"STATION-B",count:102}]);
        expect(first.incidents[0].opened_at).toBe(records[204].opened_at); expect(fifth.incidents.at(-1)?.opened_at).toBe(start);
        const filtered=await store.incidentAnalytics({...options,stationId:"STATION-A",severity:"Warning",sensor:"temperature"});
        expect(filtered.total).toBe(35); expect(filtered.incidents.every(item=>item.station_id==="STATION-A" && item.details.affected.includes("temperature"))).toBe(true);
        expect((await store.incidentAnalytics({...options,status:"open"})).total).toBe(0);
        const firstAlerts=await store.alertAnalytics(options), olderAlerts=await store.alertAnalytics({...options,offset:200});
        expect(firstAlerts.total).toBe(205); expect(firstAlerts.alerts).toHaveLength(50); expect(olderAlerts.alerts).toHaveLength(5);
        expect(firstAlerts.bySensor).toEqual({temperature:69,humidity:68,pressure:0,unidentified:68});
        expect((await store.alertAnalytics({...options,stationId:"STATION-A",severity:"Warning",sensor:"temperature"})).total).toBe(35);
        const rows=[0,1,2,3].map(i=>validateObservation({station_id:"STATION-A",station_name:"Example",latitude:10,longitude:80,timestamp:new Date(fixedTime+i*3600000).toISOString(),temperature:20,humidity:60,pressure:1000},{source:"replay",recordedAt:end}));
        await store.ingest(rows);
        const latest=await store.historyRange({start,end,source:"replay",limit:2,offset:0});
        const older=await store.historyRange({start,end,source:"replay",limit:2,offset:2});
        expect(latest.map(row=>row.timestamp)).toEqual([rows[2].observation!.timestamp,rows[3].observation!.timestamp]);
        expect(older.map(row=>row.timestamp)).toEqual([rows[0].observation!.timestamp,rows[1].observation!.timestamp]);
      }
    } finally { await db.close(); for(const entry of await fs.readdir(root)) await fs.unlink(path.join(root,entry)); await fs.rmdir(root); }
  },30000);
});
