import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { validateObservation, type ValidationLimits, type ObservationEvent, type SourceMode, type StoredRow } from "./observations.js";
import type { StationActivity } from "./station-freshness.js";

export type DetectorSettings = { warning_score: number; critical_score: number; regional_fraction: number };
export type IngestSummary = { inserted: number; invalid: number; duplicate: number };
export type ScoredObservation = { station_id: string; timestamp: string; anomaly_score: number; status: string; health: number; confidence: number | null; [key: string]: unknown };
export type StationSeed = { station_id: string; station_name: string; latitude: number; longitude: number; state: string; region: string };
export type IngestDisposition = "inserted" | "invalid" | "duplicate";
export type IncidentOutcome = "sensor_fault" | "weather_event" | "false_alarm" | "undetermined";
export type Incident = { id: string; station_id: string; source: string; status: "open" | "acknowledged" | "investigating" | "resolved"; severity: "Warning" | "Critical"; opened_at: string; updated_at: string; acknowledged_at: string | null; resolved_at: string | null; assigned_to?: string | null; assigned_name?: string | null; resolution_outcome?: IncidentOutcome | null; details: Record<string, any> };
export type IncidentAction = { incident_id: string; actor_id: string; action: string; note: string; created_at: string };
export type IncidentQuery = { start: string; end: string; source: SourceMode; stationId?: string; severity?: "Warning" | "Critical"; status?: Incident["status"]; sensor?: "temperature" | "humidity" | "pressure"; limit: number; offset: number };
export type IncidentAnalytics = { incidents: Incident[]; total: number; bySensor: Record<string, number>; byStation: Array<{ station_id: string; count: number }> };
export type AlertSnapshot = { id: string | null; station_id: string; source: string; status: string; severity: string; opened_at: string; details: Record<string, any> };
export type AlertAnalytics = { alerts: AlertSnapshot[]; total: number; bySensor: Record<string, number>; byStation: Array<{station_id:string;count:number}> };
export type NotificationPolicy = { recipient: string; minimum_severity: "Warning" | "Critical"; escalation_recipient: string; escalation_delay_minutes: number; max_attempts: number; retry_delay_minutes: number };
type NotificationOptions = { createIncidents?: boolean; notifyRecipient?: string; notificationPolicy?: NotificationPolicy };
export type NotificationJob = { id: string; incident_id: string; recipient: string; attempts: number; station_id: string; severity: string; opened_at: string; kind?: "initial" | "escalation" };
export type NotificationCounts = { pending: number; sending: number; sent: number; failed: number; cancelled: number };
type FileNotification = NotificationJob & { status: keyof NotificationCounts; next_attempt_at: string; locked_at: string | null; max_attempts?: number; retry_delay_minutes?: number };
export interface Storage {
  kind: "postgres" | "file";
  seedStations(stations: StationSeed[]): Promise<void>;
  ingest(events: ObservationEvent[], details?: { dispositions: IngestDisposition[] }): Promise<IngestSummary>;
  pendingStationObservations(limit: number): Promise<StoredRow[]>;
  finishStationObservation(stationId: string, timestamp: string, state: "insufficient" | "complete"): Promise<void>;
  auditEvent(actor: string, action: string, details: Record<string, unknown>): Promise<void>;
  alertHistory(stationId?: string, source?: SourceMode): Promise<any[]>;
  history(options: { hours: number; stationId?: string; source?: SourceMode; limit?: number }): Promise<StoredRow[]>;
  historyRange(options: { start: string; end: string; stationId?: string; source: SourceMode; limit: number; offset?: number }): Promise<StoredRow[]>;
  stationActivity(stationIds: string[]): Promise<StationActivity[]>;
  updateStationArrival(stationId: string, disconnected: boolean, details: Record<string, unknown>, policy?: NotificationPolicy): Promise<void>;
  resetUnmonitoredArrival(stationIds: string[]): Promise<void>;
  qualityEvents(limit: number): Promise<Array<{ source: string; recorded_at: string; quality_status: string; issues: unknown; raw: unknown }>>;
  getSettings(defaults: DetectorSettings): Promise<DetectorSettings>;
  importSettingsIfAbsent(settings: DetectorSettings): Promise<boolean>;
  importAuditEvent(actor: string, action: string, details: Record<string, unknown>, createdAt: string, key: string): Promise<boolean>;
  setSettings(settings: DetectorSettings, actor: string): Promise<void>;
  recordResults(source: SourceMode, results: ScoredObservation[], options?: NotificationOptions): Promise<void>;
  getNotificationPolicy(defaults: NotificationPolicy): Promise<NotificationPolicy>;
  setNotificationPolicy(policy: NotificationPolicy, actor: string): Promise<void>;
  incidents(): Promise<Incident[]>;
  incidentAnalytics(options: IncidentQuery): Promise<IncidentAnalytics>;
  alertAnalytics(options: Omit<IncidentQuery,"status">): Promise<AlertAnalytics>;
  incidentActions(id: string): Promise<IncidentAction[]>;
  transitionIncident(id: string, action: "acknowledge" | "investigate" | "resolve", actor: string, note: string, options?: { actorName?: string; outcome?: IncidentOutcome }): Promise<{ incident?: Incident; error?: "not_found" | "conflict" }>;
  assignIncident(id: string, assignee: {id:string;username:string} | null, actor: string): Promise<{ incident?: Incident; error?: "not_found" | "conflict" }>;
  claimNotification(): Promise<NotificationJob | null>;
  finishNotification(id: string, attempt: number, success: boolean): Promise<void>;
  notificationCounts(): Promise<NotificationCounts>;
  close(): Promise<void>;
}

type QueryResult = { rows: any[]; rowCount?: number | null };
export type Queryable = { query(sql: string, params?: any[]): Promise<QueryResult> };
type Connectable = Queryable & { connect(): Promise<Queryable & { release(): void }>; end(): Promise<void> };
function parseRow(row: any): StoredRow {
  return { station_id: row.station_id, station_name: row.station_name, latitude: Number(row.latitude), longitude: Number(row.longitude), temperature: Number(row.temperature), humidity: Number(row.humidity), pressure: Number(row.pressure), timestamp: new Date(row.timestamp).toISOString(), source: row.source, recorded_at: new Date(row.recorded_at).toISOString() };
}
function parseIncident(row: any): Incident {
  return { ...row, id: String(row.id), opened_at: new Date(row.opened_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(), acknowledged_at: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null, resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null };
}
export class PostgresStorage implements Storage {
  kind = "postgres" as const;
  constructor(private pool: Connectable) {}
  async initialize(schema: string) { await this.pool.query(schema); }
  async seedStations(stations: StationSeed[]) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); for (const station of stations) await client.query("INSERT INTO stations(station_id,station_name,latitude,longitude,state,region) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(station_id) DO UPDATE SET station_name=EXCLUDED.station_name,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,state=EXCLUDED.state,region=EXCLUDED.region,updated_at=now()", [station.station_id,station.station_name,station.latitude,station.longitude,station.state,station.region]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async auditEvent(actor: string, action: string, details: Record<string, unknown>) { await this.pool.query("INSERT INTO audit_events(actor_id,action,details) VALUES ($1,$2,$3::jsonb)", [actor,action,JSON.stringify(details)]); }
  async alertHistory(stationId?: string, source?: SourceMode) { const result = await this.pool.query("SELECT id::text,station_id,source,status,severity,opened_at,details FROM alerts WHERE ($1::text IS NULL OR station_id=$1) AND ($2::text IS NULL OR source=$2) ORDER BY opened_at DESC,id DESC LIMIT 200", [stationId ?? null, source ?? null]); return result.rows; }
  async ingest(events: ObservationEvent[], details?: { dispositions: IngestDisposition[] }): Promise<IngestSummary> {
    const client = await this.pool.connect(); const summary = { inserted: 0, invalid: 0, duplicate: 0 }; const dispositions: IngestDisposition[] = [];
    try {
      await client.query("BEGIN");
      for (const event of events) {
        const quality = event.observation ? "valid" : "invalid";
        const saved = await client.query("INSERT INTO observation_events(source,received_at,raw_payload,quality_status,quality_issues) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb) RETURNING id", [event.source,event.recorded_at,JSON.stringify(event.raw),quality,JSON.stringify(event.issues)]);
        if (!event.observation) { summary.invalid++; dispositions.push("invalid"); continue; }
        const o = event.observation;
        const inserted = await client.query("INSERT INTO observations(station_id,station_name,latitude,longitude,observed_at,received_at,source,temperature,humidity,pressure,observation_event_id,detection_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $7='station-api' THEN 'pending' ELSE NULL END) ON CONFLICT(source,station_id,observed_at) DO NOTHING RETURNING id", [o.station_id,o.station_name,o.latitude,o.longitude,o.timestamp,event.recorded_at,event.source,o.temperature,o.humidity,o.pressure,saved.rows[0].id]);
        if (!inserted.rows.length) { summary.duplicate++; dispositions.push("duplicate"); await client.query("UPDATE observation_events SET quality_status='duplicate',quality_issues=$2::jsonb WHERE id=$1", [saved.rows[0].id, JSON.stringify([...event.issues,{code:"duplicate",field:"timestamp",message:"This station observation was already stored for this source."}])]); continue; }
        summary.inserted++;
        dispositions.push("inserted");
        await client.query("INSERT INTO stations(station_id,station_name,latitude,longitude) VALUES ($1,$2,$3,$4) ON CONFLICT(station_id) DO NOTHING", [o.station_id,o.station_name,o.latitude || null,o.longitude || null]);
      }
      await client.query("COMMIT"); if (details) details.dispositions.push(...dispositions); return summary;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async pendingStationObservations(limit: number): Promise<StoredRow[]> {
    const result = await this.pool.query("SELECT station_id,station_name,latitude,longitude,temperature,humidity,pressure,observed_at AS timestamp,source,received_at AS recorded_at FROM observations WHERE source='station-api' AND detection_state='pending' ORDER BY observed_at,id LIMIT $1", [limit]);
    return result.rows.map(parseRow);
  }
  async finishStationObservation(stationId: string, timestamp: string, state: "insufficient" | "complete") {
    await this.pool.query("UPDATE observations SET detection_state=$3 WHERE source='station-api' AND station_id=$1 AND observed_at=$2 AND detection_state='pending'", [stationId, timestamp, state]);
  }
  async history(options: { hours: number; stationId?: string; source?: SourceMode; limit?: number }): Promise<StoredRow[]> {
    const cutoff = new Date(Date.now() - options.hours * 3600000).toISOString();
    const result = await this.pool.query("SELECT station_id,station_name,latitude,longitude,temperature,humidity,pressure,observed_at AS timestamp,source,received_at AS recorded_at FROM (SELECT * FROM observations WHERE observed_at >= $1 AND ($2::text IS NULL OR station_id=$2) AND ($3::text IS NULL OR source=$3) ORDER BY observed_at DESC,id DESC LIMIT $4) recent ORDER BY observed_at ASC,id ASC", [cutoff,options.stationId ?? null,options.source ?? null,options.limit ?? 2000]);
    return result.rows.map(parseRow);
  }
  async historyRange(options: { start: string; end: string; stationId?: string; source: SourceMode; limit: number; offset?: number }): Promise<StoredRow[]> {
    const result = await this.pool.query("SELECT station_id,station_name,latitude,longitude,temperature,humidity,pressure,observed_at AS timestamp,source,received_at AS recorded_at FROM (SELECT * FROM observations WHERE observed_at >= $1 AND observed_at < $2 AND ($3::text IS NULL OR station_id=$3) AND source=$4 ORDER BY observed_at DESC,station_id DESC LIMIT $5 OFFSET $6) recent ORDER BY observed_at ASC,station_id ASC", [options.start, options.end, options.stationId ?? null, options.source, options.limit, options.offset ?? 0]);
    return result.rows.map(parseRow);
  }
  async stationActivity(stationIds: string[]): Promise<StationActivity[]> {
    if (!stationIds.length) return [];
    const result = await this.pool.query("SELECT station_id, MAX(received_at) AS last_received_at, MAX(observed_at) AS last_observed_at FROM observations WHERE source='station-api' AND station_id=ANY($1::text[]) GROUP BY station_id", [stationIds]);
    return result.rows.map((row: any) => ({ station_id: row.station_id, last_received_at: row.last_received_at ? new Date(row.last_received_at).toISOString() : null, last_observed_at: row.last_observed_at ? new Date(row.last_observed_at).toISOString() : null }));
  }
  async updateStationArrival(stationId: string, disconnected: boolean, details: Record<string, unknown>, policy?: NotificationPolicy) {
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO station_arrival_monitor(station_id,disconnected) VALUES ($1,false) ON CONFLICT(station_id) DO NOTHING",[stationId]);
      const current=await client.query("SELECT disconnected FROM station_arrival_monitor WHERE station_id=$1 FOR UPDATE",[stationId]);
      if (disconnected && !current.rows[0].disconnected) {
        const incident=await client.query("INSERT INTO station_incidents(station_id,source,status,severity,opened_at,details) VALUES ($1,'station-health','open','Warning',now(),$2::jsonb) ON CONFLICT (source,station_id) WHERE status IN ('open','acknowledged','investigating') DO NOTHING RETURNING id",[stationId,JSON.stringify(details)]);
        if (incident.rows.length) {
          await client.query("INSERT INTO station_incident_actions(incident_id,actor_id,action,note) VALUES ($1,'system','detection','No recent station data')",[incident.rows[0].id]);
          if (policy && policy.minimum_severity === "Warning") {
            await client.query("INSERT INTO notification_outbox(incident_id,recipient,status,kind,max_attempts,retry_delay_minutes) VALUES ($1,$2,'pending','initial',$3,$4) ON CONFLICT(incident_id,kind) DO NOTHING",[incident.rows[0].id,policy.recipient,policy.max_attempts,policy.retry_delay_minutes]);
            if (policy.escalation_recipient) await client.query("INSERT INTO notification_outbox(incident_id,recipient,status,kind,next_attempt_at,max_attempts,retry_delay_minutes) VALUES ($1,$2,'pending','escalation',now()+($3::int * interval '1 minute'),$4,$5) ON CONFLICT(incident_id,kind) DO NOTHING",[incident.rows[0].id,policy.escalation_recipient,policy.escalation_delay_minutes,policy.max_attempts,policy.retry_delay_minutes]);
          }
        }
      }
      await client.query("UPDATE station_arrival_monitor SET disconnected=$2,updated_at=now() WHERE station_id=$1",[stationId,disconnected]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async resetUnmonitoredArrival(stationIds: string[]) {
    await this.pool.query("UPDATE station_arrival_monitor SET disconnected=false,updated_at=now() WHERE disconnected=true AND NOT (station_id = ANY($1::text[]))",[stationIds]);
  }
  async qualityEvents(limit: number) {
    const result = await this.pool.query("SELECT source,received_at AS recorded_at,quality_status,quality_issues AS issues,raw_payload AS raw FROM observation_events WHERE quality_status <> 'valid' OR quality_issues <> '[]'::jsonb ORDER BY id DESC LIMIT $1", [limit]);
    return result.rows.map((row: any) => ({ ...row, recorded_at: new Date(row.recorded_at).toISOString() }));
  }
  async getSettings(defaults: DetectorSettings): Promise<DetectorSettings> {
    await this.pool.query("INSERT INTO detector_settings(id,settings) VALUES (1,$1::jsonb) ON CONFLICT(id) DO NOTHING", [JSON.stringify(defaults)]);
    const result = await this.pool.query("SELECT settings FROM detector_settings WHERE id=1"); return result.rows[0].settings;
  }
  async importSettingsIfAbsent(settings: DetectorSettings) {
    const client=await this.pool.connect();
    try { await client.query("BEGIN"); const result=await client.query("INSERT INTO detector_settings(id,settings) VALUES (1,$1::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",[JSON.stringify(settings)]); if(result.rows.length) await client.query("INSERT INTO audit_events(actor_id,action,details) VALUES ('migration','detector_settings.imported',$1::jsonb)",[JSON.stringify(settings)]); await client.query("COMMIT"); return result.rows.length > 0; }
    catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async importAuditEvent(actor: string, action: string, details: Record<string, unknown>, createdAt: string, key: string) { const result=await this.pool.query("INSERT INTO audit_events(actor_id,action,details,created_at,migration_key) VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT(migration_key) DO NOTHING RETURNING id",[actor,action,JSON.stringify(details),createdAt,key]); return result.rows.length > 0; }
  async setSettings(settings: DetectorSettings, actor: string): Promise<void> {
    const client=await this.pool.connect();
    try { await client.query("BEGIN"); await client.query("INSERT INTO detector_settings(id,settings,updated_at) VALUES (1,$1::jsonb,now()) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()",[JSON.stringify(settings)]); await client.query("INSERT INTO audit_events(actor_id,action,details) VALUES ($1,'detector_settings.updated',$2::jsonb)",[actor,JSON.stringify(settings)]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async getNotificationPolicy(defaults: NotificationPolicy) { const result=await this.pool.query("SELECT policy FROM notification_policy WHERE id=1"); return {...defaults,...result.rows[0]?.policy}; }
  async setNotificationPolicy(policy:NotificationPolicy,actor:string) { const client=await this.pool.connect(); try { await client.query("BEGIN"); await client.query("INSERT INTO notification_policy(id,policy) VALUES (1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET policy=EXCLUDED.policy,updated_at=now()",[JSON.stringify(policy)]); await client.query("INSERT INTO audit_events(actor_id,action,details) VALUES ($1,'notification_policy.updated',$2::jsonb)",[actor,JSON.stringify(policy)]); await client.query("COMMIT"); } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async recordResults(source: SourceMode, results: ScoredObservation[], options?: NotificationOptions): Promise<void> {
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO model_versions(version,name) VALUES ('v1.0.0','SkyGuard anomaly detector') ON CONFLICT(version) DO NOTHING");
      for(const result of results) {
        await client.query("INSERT INTO anomaly_results(observation_id,model_version,score,status,health,confidence,details) SELECT id,'v1.0.0',$4,$5,$6,$7,$8::jsonb FROM observations WHERE source=$1 AND station_id=$2 AND observed_at=$3 ON CONFLICT(observation_id,model_version) DO NOTHING",[source,result.station_id,result.timestamp,result.anomaly_score,result.status,result.health,result.confidence,JSON.stringify(result)]);
        if (source === "station-api") await client.query("UPDATE observations SET detection_state='complete' WHERE source=$1 AND station_id=$2 AND observed_at=$3 AND detection_state='pending'", [source,result.station_id,result.timestamp]);
        if (result.status !== "Warning" && result.status !== "Critical") continue;
        const event=await client.query("INSERT INTO alerts(observation_id,station_id,source,status,severity,opened_at,updated_at,details) SELECT id,station_id,source,'detected',$4,observed_at,now(),$5::jsonb FROM observations WHERE source=$1 AND station_id=$2 AND observed_at=$3 ON CONFLICT(observation_id) DO NOTHING RETURNING id", [source,result.station_id,result.timestamp,result.status,JSON.stringify(result)]);
        if (event.rows.length && source === "station-api" && options?.createIncidents) {
          const args=[result.station_id,source,result.status,result.timestamp,JSON.stringify(result)];
          const insertSql="INSERT INTO station_incidents(station_id,source,status,severity,opened_at,details) VALUES ($1,$2,'open',$3,$4,$5::jsonb) ON CONFLICT (source,station_id) WHERE status IN ('open','acknowledged','investigating') DO NOTHING RETURNING id";
          let incident=await client.query(insertSql,args), created=incident.rows.length > 0;
          if (!created) incident=await client.query("UPDATE station_incidents SET severity=CASE WHEN severity='Critical' THEN 'Critical' ELSE $3 END,updated_at=now(),details=$4::jsonb WHERE station_id=$1 AND source=$2 AND status IN ('open','acknowledged','investigating') RETURNING id",[result.station_id,source,result.status,JSON.stringify(result)]);
          if (!incident.rows.length) { incident=await client.query(insertSql,args); created=incident.rows.length > 0; }
          if (!incident.rows.length) throw new Error("Concurrent incident state change; retry detection processing.");
          await client.query("INSERT INTO station_incident_actions(incident_id,actor_id,action,note) VALUES ($1,'system','detection','')", [incident.rows[0].id]);
          const policy=options.notificationPolicy ?? (options.notifyRecipient ? {recipient:options.notifyRecipient,minimum_severity:"Warning" as const,escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2} : null);
          if (policy && (policy.minimum_severity === "Warning" || result.status === "Critical")) {
            await client.query("INSERT INTO notification_outbox(incident_id,recipient,status,kind,max_attempts,retry_delay_minutes) VALUES ($1,$2,'pending','initial',$3,$4) ON CONFLICT(incident_id,kind) DO NOTHING",[incident.rows[0].id,policy.recipient,policy.max_attempts,policy.retry_delay_minutes]);
            if(policy.escalation_recipient) await client.query("INSERT INTO notification_outbox(incident_id,recipient,status,kind,next_attempt_at,max_attempts,retry_delay_minutes) VALUES ($1,$2,'pending','escalation',now()+($3::int * interval '1 minute'),$4,$5) ON CONFLICT(incident_id,kind) DO NOTHING",[incident.rows[0].id,policy.escalation_recipient,policy.escalation_delay_minutes,policy.max_attempts,policy.retry_delay_minutes]);
          }
        }
      }
      await client.query("COMMIT");
    }
    catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async incidents() { const result=await this.pool.query("SELECT * FROM station_incidents ORDER BY CASE WHEN status='resolved' THEN 1 ELSE 0 END, updated_at DESC, id DESC LIMIT 200"); return result.rows.map(parseIncident); }
  async incidentAnalytics(options: IncidentQuery): Promise<IncidentAnalytics> {
    const where = "source=$1 AND opened_at >= $2 AND opened_at < $3 AND ($4::text IS NULL OR station_id=$4) AND ($5::text IS NULL OR severity=$5) AND ($6::text IS NULL OR status=$6) AND ($7::text IS NULL OR COALESCE(details->'affected','[]'::jsonb) @> jsonb_build_array($7::text))";
    const params = [options.source, options.start, options.end, options.stationId ?? null, options.severity ?? null, options.status ?? null, options.sensor ?? null];
    const [page, summary, stations] = await Promise.all([
      this.pool.query(`SELECT * FROM station_incidents WHERE ${where} ORDER BY opened_at DESC,id DESC LIMIT $8 OFFSET $9`, [...params, options.limit, options.offset]),
      this.pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE details->'affected' @> '["temperature"]'::jsonb)::int AS temperature, count(*) FILTER (WHERE details->'affected' @> '["humidity"]'::jsonb)::int AS humidity, count(*) FILTER (WHERE details->'affected' @> '["pressure"]'::jsonb)::int AS pressure, count(*) FILTER (WHERE NOT (COALESCE(details->'affected','[]'::jsonb) @> '["temperature"]'::jsonb OR COALESCE(details->'affected','[]'::jsonb) @> '["humidity"]'::jsonb OR COALESCE(details->'affected','[]'::jsonb) @> '["pressure"]'::jsonb))::int AS unidentified FROM station_incidents WHERE ${where}`, params),
      this.pool.query(`SELECT station_id,count(*)::int AS count FROM station_incidents WHERE ${where} GROUP BY station_id ORDER BY count(*) DESC,station_id ASC LIMIT 10`, params),
    ]);
    const counts = summary.rows[0];
    return { incidents: page.rows.map(parseIncident), total: Number(counts.total), bySensor: { temperature: Number(counts.temperature), humidity: Number(counts.humidity), pressure: Number(counts.pressure), unidentified: Number(counts.unidentified) }, byStation: stations.rows.map(row => ({ station_id: row.station_id, count: Number(row.count) })) };
  }
  async alertAnalytics(options: Omit<IncidentQuery,"status">): Promise<AlertAnalytics> {
    const where = "source=$1 AND opened_at >= $2 AND opened_at < $3 AND ($4::text IS NULL OR station_id=$4) AND ($5::text IS NULL OR severity=$5) AND ($6::text IS NULL OR COALESCE(details->'affected','[]'::jsonb) @> jsonb_build_array($6::text))";
    const params = [options.source, options.start, options.end, options.stationId ?? null, options.severity ?? null, options.sensor ?? null];
    const [page, summary, stations] = await Promise.all([
      this.pool.query(`SELECT id::text,station_id,source,status,severity,opened_at,details FROM alerts WHERE ${where} ORDER BY opened_at DESC,id DESC LIMIT $7 OFFSET $8`, [...params, options.limit, options.offset]),
      this.pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE details->'affected' @> '["temperature"]'::jsonb)::int AS temperature, count(*) FILTER (WHERE details->'affected' @> '["humidity"]'::jsonb)::int AS humidity, count(*) FILTER (WHERE details->'affected' @> '["pressure"]'::jsonb)::int AS pressure, count(*) FILTER (WHERE NOT (COALESCE(details->'affected','[]'::jsonb) @> '["temperature"]'::jsonb OR COALESCE(details->'affected','[]'::jsonb) @> '["humidity"]'::jsonb OR COALESCE(details->'affected','[]'::jsonb) @> '["pressure"]'::jsonb))::int AS unidentified FROM alerts WHERE ${where}`, params),
      this.pool.query(`SELECT station_id,count(*)::int AS count FROM alerts WHERE ${where} GROUP BY station_id ORDER BY count(*) DESC,station_id ASC LIMIT 10`, params),
    ]);
    const counts = summary.rows[0];
    return { alerts: page.rows.map(row => ({ ...row, id: String(row.id), opened_at: new Date(row.opened_at).toISOString() })), total:Number(counts.total), bySensor:{temperature:Number(counts.temperature),humidity:Number(counts.humidity),pressure:Number(counts.pressure),unidentified:Number(counts.unidentified)}, byStation:stations.rows.map(row=>({station_id:row.station_id,count:Number(row.count)})) };
  }
  async incidentActions(id: string) { const result=await this.pool.query("SELECT incident_id::text,actor_id,action,note,created_at FROM station_incident_actions WHERE incident_id::text=$1 ORDER BY id DESC LIMIT 100",[id]); return result.rows.map((row:any)=>({...row,created_at:new Date(row.created_at).toISOString()})); }
  async transitionIncident(id: string, action: "acknowledge" | "investigate" | "resolve", actor: string, note: string, options: { actorName?: string; outcome?: IncidentOutcome } = {}) {
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const allowed=action === "acknowledge" ? ["open"] : action === "investigate" ? ["open","acknowledged"] : ["open","acknowledged","investigating"];
      const next=action === "acknowledge" ? "acknowledged" : action === "investigate" ? "investigating" : "resolved";
      const updated=await client.query("UPDATE station_incidents SET status=$2,updated_at=now(),acknowledged_at=CASE WHEN $2 IN ('acknowledged','investigating') THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,resolved_at=CASE WHEN $2='resolved' THEN now() ELSE resolved_at END,assigned_name=CASE WHEN $2='investigating' AND assigned_to IS NULL THEN $5 ELSE assigned_name END,assigned_to=CASE WHEN $2='investigating' THEN COALESCE(assigned_to,$4) ELSE assigned_to END,resolution_outcome=CASE WHEN $2='resolved' THEN $6 ELSE resolution_outcome END WHERE id::text=$1 AND status=ANY($3::text[]) RETURNING *",[id,next,allowed,actor,options.actorName ?? null,options.outcome ?? "undetermined"]);
      if (!updated.rows.length) { const existing=await client.query("SELECT id FROM station_incidents WHERE id::text=$1",[id]); await client.query("ROLLBACK"); return {error:existing.rows.length ? "conflict" as const : "not_found" as const}; }
      await client.query("INSERT INTO station_incident_actions(incident_id,actor_id,action,note) VALUES ($1,$2,$3,$4)",[updated.rows[0].id,actor,action,note]);
      if (action === "resolve") await client.query("UPDATE notification_outbox SET status='cancelled' WHERE incident_id=$1 AND status='pending'",[updated.rows[0].id]);
      if (action === "acknowledge" || action === "investigate") await client.query("UPDATE notification_outbox SET status='cancelled' WHERE incident_id=$1 AND kind='escalation' AND status='pending'",[updated.rows[0].id]);
      await client.query("INSERT INTO audit_events(actor_id,action,details) VALUES ($1,$2,$3::jsonb)",[actor,`station_incident.${action}`,JSON.stringify({incident_id:id,...(action === "resolve" ? {outcome:options.outcome ?? "undetermined"} : {})})]);
      await client.query("COMMIT"); return {incident:parseIncident(updated.rows[0])};
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async assignIncident(id:string, assignee:{id:string;username:string}|null, actor:string) {
    const client=await this.pool.connect();
    try { await client.query("BEGIN"); const updated=await client.query("UPDATE station_incidents SET assigned_to=$2,assigned_name=$3,updated_at=now() WHERE id::text=$1 AND status <> 'resolved' RETURNING *",[id,assignee?.id ?? null,assignee?.username ?? null]);
      if(!updated.rows.length) { const existing=await client.query("SELECT id FROM station_incidents WHERE id::text=$1",[id]); await client.query("ROLLBACK"); return {error:existing.rows.length ? "conflict" as const : "not_found" as const}; }
      await client.query("INSERT INTO station_incident_actions(incident_id,actor_id,action,note) VALUES ($1,$2,'assign',$3)",[updated.rows[0].id,actor,assignee ? `Assigned to ${assignee.username}` : "Assignment cleared"]);
      await client.query("INSERT INTO audit_events(actor_id,action,details) VALUES ($1,'station_incident.assign',$2::jsonb)",[actor,JSON.stringify({incident_id:id,assigned_to:assignee?.id ?? null})]);
      await client.query("COMMIT"); return {incident:parseIncident(updated.rows[0])};
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async claimNotification(): Promise<NotificationJob | null> {
    await this.pool.query("UPDATE notification_outbox SET status='cancelled',locked_at=NULL WHERE EXISTS (SELECT 1 FROM station_incidents i WHERE i.id=notification_outbox.incident_id AND (i.status='resolved' OR (notification_outbox.kind='escalation' AND i.status <> 'open'))) AND (status='pending' OR (status='sending' AND locked_at < now() - interval '5 minutes'))");
    await this.pool.query("UPDATE notification_outbox SET status='failed',locked_at=NULL,last_error='Delivery interrupted after maximum attempts.' WHERE status='sending' AND attempts >= max_attempts AND locked_at < now() - interval '5 minutes'");
    const result=await this.pool.query("WITH candidate AS (SELECT id FROM notification_outbox WHERE attempts < max_attempts AND EXISTS (SELECT 1 FROM station_incidents i WHERE i.id=notification_outbox.incident_id AND i.status <> 'resolved' AND (notification_outbox.kind <> 'escalation' OR i.status='open')) AND ((status='pending' AND next_attempt_at <= now()) OR (status='sending' AND locked_at < now() - interval '5 minutes')) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1), claimed AS (UPDATE notification_outbox SET status='sending',attempts=attempts+1,locked_at=now() WHERE id=(SELECT id FROM candidate) RETURNING *) SELECT claimed.id::text,claimed.incident_id::text,claimed.recipient,claimed.attempts,claimed.kind,i.station_id,i.severity,i.opened_at FROM claimed JOIN station_incidents i ON i.id=claimed.incident_id");
    const row=result.rows[0]; return row ? {...row,opened_at:new Date(row.opened_at).toISOString()} : null;
  }
  async finishNotification(id: string, attempt: number, success: boolean) { await this.pool.query("UPDATE notification_outbox SET status=CASE WHEN $3 THEN 'sent' WHEN EXISTS (SELECT 1 FROM station_incidents i WHERE i.id=notification_outbox.incident_id AND (i.status='resolved' OR (notification_outbox.kind='escalation' AND i.status <> 'open'))) THEN 'cancelled' WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END, sent_at=CASE WHEN $3 THEN now() ELSE NULL END, next_attempt_at=CASE WHEN $3 THEN next_attempt_at ELSE now() + retry_delay_minutes * interval '1 minute' END, locked_at=NULL,last_error=CASE WHEN $3 THEN NULL ELSE 'Delivery failed; check mail service configuration.' END WHERE id::text=$1 AND attempts=$2 AND status='sending'",[id,attempt,success]); }
  async notificationCounts(): Promise<NotificationCounts> { const result=await this.pool.query("SELECT status,count(*)::int AS count FROM notification_outbox GROUP BY status"); const counts:NotificationCounts={pending:0,sending:0,sent:0,failed:0,cancelled:0}; for(const row of result.rows) if(row.status in counts) counts[row.status as keyof NotificationCounts]=Number(row.count); return counts; }
  async close() { await this.pool.end(); }
}

/** Transitional file mode keeps the existing JSONL history intact until PostgreSQL is configured. */
export class FileStorage implements Storage {
  kind = "file" as const;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private limits?: ValidationLimits) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const result = this.queue.then(fn,fn); this.queue=result.catch(() => undefined); return result; }
  private get historyPath() { return path.join(this.directory,"observations.jsonl"); }
  private async lines(file: string): Promise<string[]> { try { return (await fs.readFile(file,"utf8")).split("\n").filter(Boolean); } catch(error: any) { if(error?.code === "ENOENT") return []; throw error; } }
  private async incidentLog(): Promise<Array<{ incident: Incident; action: IncidentAction }>> { const entries=[]; for(const line of await this.lines(path.join(this.directory,"station-incidents.jsonl"))) { try { const row=JSON.parse(line); if(row.incident && row.action) entries.push(row); } catch { /* Preserve damaged lines. */ } } return entries; }
  private async notifications(): Promise<FileNotification[]> { const states=new Map<string,FileNotification>(); for(const line of await this.lines(path.join(this.directory,"notification-outbox.jsonl"))) { try { const row=JSON.parse(line); if(row.id) states.set(row.id,row); } catch { /* Preserve damaged lines. */ } } return Array.from(states.values()); }
  async seedStations(stations: StationSeed[]) { await fs.mkdir(this.directory,{recursive:true}); try { await fs.writeFile(path.join(this.directory,"stations.json"),JSON.stringify(stations,null,2),{flag:"wx"}); } catch(error: any) { if(error?.code !== "EEXIST") throw error; } }
  async auditEvent(actor: string, action: string, details: Record<string, unknown>) { await this.exclusive(async()=>{ await fs.mkdir(this.directory,{recursive:true}); await fs.appendFile(path.join(this.directory,"audit.jsonl"),JSON.stringify({actor,action,details,created_at:new Date().toISOString()})+"\n","utf8"); }); }
  async alertHistory(stationId?: string, source?: SourceMode) { const alerts: any[]=[]; for(const line of await this.lines(path.join(this.directory,"alerts.jsonl"))) { try { const row=JSON.parse(line); if((!stationId || row.station_id===stationId) && (!source || row.source===source)) alerts.push(row); } catch {} } return alerts.slice(-200).reverse(); }
  async ingest(events: ObservationEvent[], details?: { dispositions: IngestDisposition[] }): Promise<IngestSummary> { return this.exclusive(async () => {
    await fs.mkdir(this.directory,{recursive:true}); const existing=await this.lines(this.historyPath); const keys=new Set<string>();
    for(const line of existing) { try { const row=JSON.parse(line); keys.add(`${row.source}|${row.station_id}|${row.timestamp}`); } catch { /* Leave existing damaged lines intact. */ } }
    const rows: string[]=[]; const journal: string[]=[]; const summary={inserted:0,invalid:0,duplicate:0};
    const dispositions: IngestDisposition[]=[];
    for(const event of events) { let status: "valid"|"invalid"|"duplicate" = event.observation ? "valid" : "invalid"; if(event.observation) { const key=`${event.source}|${event.observation.station_id}|${event.observation.timestamp}`; if(keys.has(key)) { status="duplicate"; summary.duplicate++; dispositions.push("duplicate"); } else { keys.add(key); summary.inserted++; dispositions.push("inserted"); rows.push(JSON.stringify({...event.observation,source:event.source,recorded_at:event.recorded_at,...(event.source === "station-api" ? {detection_pending:true} : {})})); } } else { summary.invalid++; dispositions.push("invalid"); } journal.push(JSON.stringify({source:event.source,recorded_at:event.recorded_at,raw:event.raw,quality_status:status,issues:status === "duplicate" ? [...event.issues,{code:"duplicate",field:"timestamp",message:"This station observation was already stored for this source."}] : event.issues})); }
    if(journal.length) await fs.appendFile(path.join(this.directory,"observation-events.jsonl"),journal.join("\n")+"\n","utf8");
    if(rows.length) await fs.appendFile(this.historyPath,rows.join("\n")+"\n","utf8"); if(details) details.dispositions.push(...dispositions); return summary;
  }); }
  async pendingStationObservations(limit: number): Promise<StoredRow[]> {
    const done = new Set<string>();
    for (const line of await this.lines(path.join(this.directory, "station-scoring-done.jsonl"))) { try { const row=JSON.parse(line); done.add(`${row.station_id}|${row.timestamp}`); } catch {} }
    const rows: StoredRow[]=[];
    for (const line of await this.lines(this.historyPath)) { try { const row=JSON.parse(line); if (row.source === "station-api" && row.detection_pending && !done.has(`${row.station_id}|${row.timestamp}`)) rows.push(row); } catch {} }
    return rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(0,limit);
  }
  async finishStationObservation(stationId: string, timestamp: string, state: "insufficient" | "complete") {
    await this.exclusive(async()=>{ await fs.appendFile(path.join(this.directory,"station-scoring-done.jsonl"),JSON.stringify({station_id:stationId,timestamp,state})+"\n","utf8"); });
  }
  async history(options: { hours: number; stationId?: string; source?: SourceMode; limit?: number }): Promise<StoredRow[]> {
    const cutoff=Date.now()-options.hours*3600000; const rows: StoredRow[]=[];
    for(const line of await this.lines(this.historyPath)) { try {
      const row=JSON.parse(line); const source: SourceMode = ["live","station-api","open-meteo","replay","uploaded","legacy-unknown"].includes(row.source) ? row.source : "legacy-unknown";
      const recordedAt = row.recorded_at && Number.isFinite(Date.parse(row.recorded_at)) ? new Date(row.recorded_at).toISOString() : null;
      const validated=validateObservation(row,{source,recordedAt: recordedAt ?? undefined,allowMissingCoordinates:true,limits:this.limits});
      if (validated.observation && (!options.stationId || validated.observation.station_id===options.stationId) && (!options.source || source===options.source) && Date.parse(validated.observation.timestamp)>=cutoff) rows.push({...validated.observation,source,recorded_at:recordedAt});
    } catch { /* Leave damaged individual records unchanged. */ } }
    return rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-(options.limit ?? 2000));
  }
  async historyRange(options: { start: string; end: string; stationId?: string; source: SourceMode; limit: number; offset?: number }): Promise<StoredRow[]> {
    const start = Date.parse(options.start), end = Date.parse(options.end), rows: StoredRow[] = [];
    for (const line of await this.lines(this.historyPath)) { try {
      const row = JSON.parse(line);
      const source: SourceMode = ["live","station-api","open-meteo","replay","uploaded","legacy-unknown"].includes(row.source) ? row.source : "legacy-unknown";
      const recordedAt = row.recorded_at && Number.isFinite(Date.parse(row.recorded_at)) ? new Date(row.recorded_at).toISOString() : null;
      const validated = validateObservation(row,{ source, recordedAt: recordedAt ?? undefined, allowMissingCoordinates: true, limits: this.limits });
      if (validated.observation && source === options.source && (!options.stationId || validated.observation.station_id === options.stationId)) {
        const time = Date.parse(validated.observation.timestamp);
        if (time >= start && time < end) rows.push({ ...validated.observation, source, recorded_at: recordedAt });
      }
    } catch { /* Leave damaged individual records unchanged. */ } }
    const offset = options.offset ?? 0;
    return rows.sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp) || (a.station_id < b.station_id ? -1 : a.station_id > b.station_id ? 1 : 0)).slice(-(offset + options.limit), offset ? -offset : undefined);
  }
  async stationActivity(stationIds: string[]): Promise<StationActivity[]> {
    const wanted = new Set(stationIds), found = new Map<string, StationActivity>();
    for (const line of await this.lines(this.historyPath)) {
      try {
        const row = JSON.parse(line);
        if (row.source !== "station-api" || !wanted.has(row.station_id)) continue;
        const current = found.get(row.station_id) ?? { station_id: row.station_id, last_received_at: null, last_observed_at: null };
        for (const [input, output] of [["recorded_at", "last_received_at"], ["timestamp", "last_observed_at"]] as const) {
          const stamp = Date.parse(row[input]);
          if (Number.isFinite(stamp) && (!current[output] || stamp > Date.parse(current[output]!))) current[output] = new Date(stamp).toISOString();
        }
        found.set(row.station_id, current);
      } catch { /* Skip damaged records. */ }
    }
    return Array.from(found.values());
  }
  async updateStationArrival(stationId: string, disconnected: boolean, details: Record<string, unknown>, policy?: NotificationPolicy) {
    await this.exclusive(async()=>{
      await fs.mkdir(this.directory,{recursive:true});
      const file=path.join(this.directory,"station-arrival-monitor.jsonl"), states=new Map<string,boolean>();
      for (const line of await this.lines(file)) { try { const row=JSON.parse(line); states.set(row.station_id,row.disconnected); } catch {} }
      if (disconnected && !states.get(stationId)) {
        const log=await this.incidentLog(), incidents=new Map<string,Incident>(); for (const row of log) incidents.set(row.incident.id,row.incident);
        const active=Array.from(incidents.values()).find(item=>item.station_id===stationId && item.source==="station-health" && item.status!=="resolved");
        if (!active) {
          const now=new Date().toISOString();
          const incident:Incident={id:randomUUID(),station_id:stationId,source:"station-health",status:"open",severity:"Warning",opened_at:now,updated_at:now,acknowledged_at:null,resolved_at:null,details};
          await fs.appendFile(path.join(this.directory,"station-incidents.jsonl"),JSON.stringify({incident,action:{incident_id:incident.id,actor_id:"system",action:"detection",note:"No recent station data",created_at:now}})+"\n","utf8");
          if(policy && policy.minimum_severity === "Warning") {
            const jobs:FileNotification[]=[{id:randomUUID(),incident_id:incident.id,recipient:policy.recipient,kind:"initial",attempts:0,max_attempts:policy.max_attempts,retry_delay_minutes:policy.retry_delay_minutes,status:"pending",next_attempt_at:now,locked_at:null,station_id:stationId,severity:"Warning",opened_at:now}];
            if(policy.escalation_recipient) jobs.push({...jobs[0],id:randomUUID(),recipient:policy.escalation_recipient,kind:"escalation",next_attempt_at:new Date(Date.now()+policy.escalation_delay_minutes*60_000).toISOString()});
            await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),jobs.map(job=>JSON.stringify(job)).join("\n")+"\n","utf8");
          }
        }
      }
      if (states.get(stationId) !== disconnected) await fs.appendFile(file,JSON.stringify({station_id:stationId,disconnected})+"\n","utf8");
    });
  }
  async resetUnmonitoredArrival(stationIds: string[]) {
    await this.exclusive(async()=>{
      const file=path.join(this.directory,"station-arrival-monitor.jsonl"), states=new Map<string,boolean>(), active=new Set(stationIds);
      for(const line of await this.lines(file)) { try { const row=JSON.parse(line); states.set(row.station_id,row.disconnected); } catch {} }
      const reset=Array.from(states).filter(([stationId,disconnected])=>disconnected && !active.has(stationId)).map(([station_id])=>JSON.stringify({station_id,disconnected:false}));
      if(reset.length) await fs.appendFile(file,reset.join("\n")+"\n","utf8");
    });
  }
  async qualityEvents(limit: number) {
    const result: Array<{ source: string; recorded_at: string; quality_status: string; issues: unknown; raw: unknown }> = [];
    for (const line of await this.lines(this.historyPath)) { try {
      const raw=JSON.parse(line); const source: SourceMode = ["live","station-api","open-meteo","replay","uploaded","legacy-unknown"].includes(raw.source) ? raw.source : "legacy-unknown";
      const recordedAt = raw.recorded_at && Number.isFinite(Date.parse(raw.recorded_at)) ? new Date(raw.recorded_at).toISOString() : new Date().toISOString();
      const event=validateObservation(raw,{source,recordedAt,allowMissingCoordinates:true,limits:this.limits});
      if(!event.observation) result.push({source,recorded_at:recordedAt,quality_status:"invalid",issues:event.issues,raw});
    } catch { result.push({source:"legacy-unknown",recorded_at:new Date().toISOString(),quality_status:"invalid",issues:[{code:"invalid_json",field:"record",message:"The original line could not be parsed as JSON."}],raw:{unparseable_line:line}}); } }
    for (const line of await this.lines(path.join(this.directory,"observation-events.jsonl"))) { try { const row = JSON.parse(line); if (row.quality_status !== "valid" || row.issues?.length) result.push(row); } catch { /* Keep unreadable lines unchanged. */ } }
    return result.sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at)).slice(0,limit);
  }
  async getSettings(defaults: DetectorSettings): Promise<DetectorSettings> { try { return JSON.parse(await fs.readFile(path.join(this.directory,"detector-settings.json"),"utf8")); } catch(error: any) { if(error?.code === "ENOENT") return defaults; throw error; } }
  async importSettingsIfAbsent(settings: DetectorSettings) { return this.exclusive(async()=>{ await fs.mkdir(this.directory,{recursive:true}); try { await fs.writeFile(path.join(this.directory,"detector-settings.json"),JSON.stringify(settings,null,2),{flag:"wx"}); return true; } catch(error: any) { if(error?.code === "EEXIST") return false; throw error; } }); }
  async importAuditEvent(actor: string, action: string, details: Record<string, unknown>, createdAt: string, key: string) { return this.exclusive(async()=>{ await fs.mkdir(this.directory,{recursive:true}); const file=path.join(this.directory,"audit.jsonl"); for(const line of await this.lines(file)) { try { if(JSON.parse(line).migration_key === key) return false; } catch {} } await fs.appendFile(file,JSON.stringify({actor,action,details,created_at:createdAt,migration_key:key})+"\n","utf8"); return true; }); }
  async setSettings(settings: DetectorSettings, actor: string): Promise<void> { await this.exclusive(async()=>{ await fs.mkdir(this.directory,{recursive:true}); const file=path.join(this.directory,"detector-settings.json"); const temporary=path.join(this.directory,`detector-settings.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`); try { await fs.writeFile(temporary,JSON.stringify(settings,null,2),{flag:"wx"}); await fs.rename(temporary,file); await fs.appendFile(path.join(this.directory,"audit.jsonl"),JSON.stringify({actor,action:"detector_settings.updated",details:settings,created_at:new Date().toISOString()})+"\n","utf8"); } finally { await fs.unlink(temporary).catch(()=>undefined); } }); }
  async getNotificationPolicy(defaults:NotificationPolicy) { try { return {...defaults,...JSON.parse(await fs.readFile(path.join(this.directory,"notification-policy.json"),"utf8"))}; } catch(error:any) { if(error?.code === "ENOENT") return defaults; throw error; } }
  async setNotificationPolicy(policy:NotificationPolicy,actor:string) { await this.exclusive(async()=>{ await fs.mkdir(this.directory,{recursive:true}); const file=path.join(this.directory,"notification-policy.json"),temp=`${file}.${randomUUID()}.tmp`; try { await fs.writeFile(temp,JSON.stringify(policy),{flag:"wx"}); await fs.rename(temp,file); await fs.appendFile(path.join(this.directory,"audit.jsonl"),JSON.stringify({actor,action:"notification_policy.updated",details:policy,created_at:new Date().toISOString()})+"\n","utf8"); } finally { await fs.unlink(temp).catch(()=>undefined); } }); }
  async recordResults(source: SourceMode, results: ScoredObservation[], options?: NotificationOptions): Promise<void> { if(!results.length) return; await this.exclusive(async()=>{
    await fs.mkdir(this.directory,{recursive:true});
    const resultPath=path.join(this.directory,"anomaly-results.jsonl"), alertPath=path.join(this.directory,"alerts.jsonl");
    const keys=new Set<string>(); for(const line of await this.lines(resultPath)) { try { const row=JSON.parse(line); keys.add(`${row.source}|${row.station_id}|${row.timestamp}|${row.model_version}`); } catch {} }
    const knownAlerts=new Map<string,any>(); for(const line of await this.lines(alertPath)) { try { const row=JSON.parse(line); knownAlerts.set(`${row.source}|${row.station_id}|${row.opened_at}`,row); } catch {} }
    const fresh=results.filter((result)=>{ const key=`${source}|${result.station_id}|${result.timestamp}|v1.0.0`; if(keys.has(key)) return false; keys.add(key); return true; });
    const alerts=results.filter((result)=>result.status === "Warning" || result.status === "Critical" || knownAlerts.has(`${source}|${result.station_id}|${result.timestamp}`)).map((result)=>({source,station_id:result.station_id,status:"detected",severity:result.status,opened_at:result.timestamp,details:result}));
    const newAlerts=alerts.filter(alert=>!knownAlerts.has(`${source}|${alert.station_id}|${alert.opened_at}`));
    if(fresh.length) await fs.appendFile(resultPath,fresh.map((result)=>JSON.stringify({source,model_version:"v1.0.0",recorded_at:new Date().toISOString(),...result})).join("\n")+"\n","utf8");
    if(newAlerts.length) await fs.appendFile(alertPath,newAlerts.map((row)=>JSON.stringify(row)).join("\n")+"\n","utf8");
    if (source === "station-api" && options?.createIncidents && alerts.length) {
      const log=await this.incidentLog(), states=new Map<string,Incident>();
      for(const row of log) states.set(row.incident.id,row.incident);
      const entries=[], notifications:FileNotification[]=[], existingJobs=await this.notifications();
      for(const candidateAlert of alerts) {
        const alert=knownAlerts.get(`${source}|${candidateAlert.station_id}|${candidateAlert.opened_at}`) ?? candidateAlert;
        const now=new Date().toISOString();
        const previous=log.find(row=>row.action.action === "detection" && row.incident.source === source && row.incident.station_id === alert.station_id && row.incident.details?.timestamp === alert.opened_at);
        const previousState=previous ? states.get(previous.incident.id) : undefined;
        if (previousState?.status === "resolved") continue;
        const active=Array.from(states.values()).find(item=>item.source === source && item.station_id === alert.station_id && item.status !== "resolved");
        const incident: Incident=previousState ?? (active ? {...active,severity:active.severity === "Critical" ? "Critical" : alert.severity as Incident["severity"],updated_at:now,details:alert.details} : {id:randomUUID(),station_id:alert.station_id,source,status:"open",severity:alert.severity as Incident["severity"],opened_at:alert.opened_at,updated_at:now,acknowledged_at:null,resolved_at:null,details:alert.details});
        states.set(incident.id,incident);
        if (!previous) entries.push({incident,action:{incident_id:incident.id,actor_id:"system",action:"detection",note:"",created_at:now}});
        const policy=options.notificationPolicy ?? (options.notifyRecipient ? {recipient:options.notifyRecipient,minimum_severity:"Warning" as const,escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2} : null);
        if(policy && (policy.minimum_severity === "Warning" || alert.severity === "Critical")) {
          const has=(kind:string)=>[...existingJobs,...notifications].some(job=>job.incident_id===incident.id && (job.kind ?? "initial")===kind);
          if(!has("initial")) notifications.push({id:randomUUID(),incident_id:incident.id,recipient:policy.recipient,kind:"initial",attempts:0,max_attempts:policy.max_attempts,retry_delay_minutes:policy.retry_delay_minutes,status:"pending",next_attempt_at:now,locked_at:null,station_id:incident.station_id,severity:incident.severity,opened_at:incident.opened_at});
          if(policy.escalation_recipient && !has("escalation")) notifications.push({id:randomUUID(),incident_id:incident.id,recipient:policy.escalation_recipient,kind:"escalation",attempts:0,max_attempts:policy.max_attempts,retry_delay_minutes:policy.retry_delay_minutes,status:"pending",next_attempt_at:new Date(Date.now()+policy.escalation_delay_minutes*60_000).toISOString(),locked_at:null,station_id:incident.station_id,severity:incident.severity,opened_at:incident.opened_at});
        }
      }
      if(entries.length) await fs.appendFile(path.join(this.directory,"station-incidents.jsonl"),entries.map(row=>JSON.stringify(row)).join("\n")+"\n","utf8");
      if(notifications.length) await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),notifications.map(row=>JSON.stringify(row)).join("\n")+"\n","utf8");
    }
  }); }
  async incidents() { const states=new Map<string,Incident>(); for(const entry of await this.incidentLog()) states.set(entry.incident.id,entry.incident); return Array.from(states.values()).sort((a,b)=>Number(a.status === "resolved")-Number(b.status === "resolved") || Date.parse(b.updated_at)-Date.parse(a.updated_at)).slice(0,200); }
  async incidentAnalytics(options: IncidentQuery): Promise<IncidentAnalytics> {
    const states = new Map<string,Incident>();
    for (const entry of await this.incidentLog()) states.set(entry.incident.id,entry.incident);
    const filtered = Array.from(states.values()).filter(item => item.source === options.source && item.opened_at >= options.start && item.opened_at < options.end && (!options.stationId || item.station_id === options.stationId) && (!options.severity || item.severity === options.severity) && (!options.status || item.status === options.status) && (!options.sensor || (Array.isArray(item.details?.affected) && item.details.affected.includes(options.sensor))));
    filtered.sort((a,b) => Date.parse(b.opened_at)-Date.parse(a.opened_at) || b.id.localeCompare(a.id));
    const bySensor: Record<string, number> = { temperature: 0, humidity: 0, pressure: 0, unidentified: 0 }, stationCounts = new Map<string,number>();
    for (const item of filtered) { for (const field of ["temperature","humidity","pressure"]) if (Array.isArray(item.details?.affected) && item.details.affected.includes(field)) bySensor[field]++; if (!["temperature","humidity","pressure"].some(field => Array.isArray(item.details?.affected) && item.details.affected.includes(field))) bySensor.unidentified++; stationCounts.set(item.station_id, (stationCounts.get(item.station_id) ?? 0) + 1); }
    return { incidents: filtered.slice(options.offset, options.offset + options.limit), total: filtered.length, bySensor, byStation: Array.from(stationCounts, ([station_id,count]) => ({station_id,count})).sort((a,b) => b.count-a.count || a.station_id.localeCompare(b.station_id)).slice(0,10) };
  }
  async alertAnalytics(options: Omit<IncidentQuery,"status">): Promise<AlertAnalytics> {
    const filtered: AlertSnapshot[] = [];
    for (const line of await this.lines(path.join(this.directory,"alerts.jsonl"))) { try {
      const item = JSON.parse(line);
      if (item.source === options.source && item.opened_at >= options.start && item.opened_at < options.end && (!options.stationId || item.station_id === options.stationId) && (!options.severity || item.severity === options.severity) && (!options.sensor || (Array.isArray(item.details?.affected) && item.details.affected.includes(options.sensor)))) filtered.push({...item,id:item.id == null ? null : String(item.id)});
    } catch { /* Preserve damaged records. */ } }
    filtered.sort((a,b) => Date.parse(b.opened_at)-Date.parse(a.opened_at) || b.station_id.localeCompare(a.station_id));
    const bySensor: Record<string,number>={temperature:0,humidity:0,pressure:0,unidentified:0}, stationCounts=new Map<string,number>();
    for(const item of filtered) { for(const field of ["temperature","humidity","pressure"]) if(Array.isArray(item.details?.affected) && item.details.affected.includes(field)) bySensor[field]++; if(!["temperature","humidity","pressure"].some(field=>Array.isArray(item.details?.affected) && item.details.affected.includes(field))) bySensor.unidentified++; stationCounts.set(item.station_id,(stationCounts.get(item.station_id) ?? 0)+1); }
    return {alerts:filtered.slice(options.offset,options.offset+options.limit),total:filtered.length,bySensor,byStation:Array.from(stationCounts,([station_id,count])=>({station_id,count})).sort((a,b)=>b.count-a.count||a.station_id.localeCompare(b.station_id)).slice(0,10)};
  }
  async incidentActions(id: string) { return (await this.incidentLog()).filter(row=>row.incident.id === id).map(row=>row.action).slice(-100).reverse(); }
  async transitionIncident(id: string, action: "acknowledge" | "investigate" | "resolve", actor: string, note: string, options: { actorName?: string; outcome?: IncidentOutcome } = {}) { return this.exclusive(async()=>{
    const entries=await this.incidentLog(); const current=entries.filter(row=>row.incident.id === id).at(-1)?.incident;
    if (!current) return {error:"not_found" as const};
    if (current.status === "resolved" || (action === "acknowledge" && current.status !== "open") || (action === "investigate" && current.status === "investigating")) return {error:"conflict" as const};
    const now=new Date().toISOString(); const incident:Incident={...current,status:action === "acknowledge" ? "acknowledged" : action === "investigate" ? "investigating" : "resolved",updated_at:now,acknowledged_at:action === "acknowledge" || action === "investigate" ? current.acknowledged_at ?? now : current.acknowledged_at,resolved_at:action === "resolve" ? now : null,assigned_to:action === "investigate" ? current.assigned_to ?? actor : current.assigned_to ?? null,assigned_name:action === "investigate" && !current.assigned_to ? options.actorName ?? null : current.assigned_name ?? null,resolution_outcome:action === "resolve" ? options.outcome ?? "undetermined" : current.resolution_outcome ?? null};
    await fs.appendFile(path.join(this.directory,"station-incidents.jsonl"),JSON.stringify({incident,action:{incident_id:id,actor_id:actor,action,note,created_at:now}})+"\n","utf8");
    if(action === "resolve" || action === "acknowledge" || action === "investigate") { const pending=(await this.notifications()).filter(job=>job.incident_id === id && job.status === "pending" && (action === "resolve" || job.kind === "escalation")).map(job=>({...job,status:"cancelled" as const})); if(pending.length) await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),pending.map(job=>JSON.stringify(job)).join("\n")+"\n","utf8"); }
    return {incident};
  }); }
  async assignIncident(id:string,assignee:{id:string;username:string}|null,actor:string) { return this.exclusive(async()=>{
    const entries=await this.incidentLog(), current=entries.filter(entry=>entry.incident.id===id).at(-1)?.incident;
    if(!current) return {error:"not_found" as const}; if(current.status === "resolved") return {error:"conflict" as const};
    const now=new Date().toISOString(),incident:Incident={...current,assigned_to:assignee?.id ?? null,assigned_name:assignee?.username ?? null,updated_at:now};
    await fs.appendFile(path.join(this.directory,"station-incidents.jsonl"),JSON.stringify({incident,action:{incident_id:id,actor_id:actor,action:"assign",note:assignee ? `Assigned to ${assignee.username}` : "Assignment cleared",created_at:now}})+"\n","utf8"); return {incident};
  }); }
  async claimNotification(): Promise<NotificationJob | null> { return this.exclusive(async()=>{
    const now=Date.now(), jobs=await this.notifications();
    const incidentStates=new Map<string,Incident>(); for(const entry of await this.incidentLog()) incidentStates.set(entry.incident.id,entry.incident);
    const eligible=(job:FileNotification)=>{const state=incidentStates.get(job.incident_id)?.status; return !!state && state !== "resolved" && (job.kind !== "escalation" || state === "open");};
    const cancelled=jobs.filter(job=>!eligible(job) && (job.status === "pending" || (job.status === "sending" && job.locked_at && now-Date.parse(job.locked_at)>300_000))).map(job=>({...job,status:"cancelled" as const,locked_at:null}));
    if(cancelled.length) await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),cancelled.map(job=>JSON.stringify(job)).join("\n")+"\n","utf8");
    const active=jobs.filter(eligible);
    const exhausted=active.filter(job=>job.status === "sending" && job.attempts >= (job.max_attempts ?? 3) && job.locked_at && now-Date.parse(job.locked_at)>300_000).map(job=>({...job,status:"failed" as const,locked_at:null}));
    if(exhausted.length) await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),exhausted.map(job=>JSON.stringify(job)).join("\n")+"\n","utf8");
    const job=active.find(item=>item.attempts<(item.max_attempts ?? 3) && ((item.status === "pending" && Date.parse(item.next_attempt_at)<=now) || (item.status === "sending" && !!item.locked_at && now-Date.parse(item.locked_at)>300_000)));
    if(!job) return null;
    const claimed:FileNotification={...job,severity:incidentStates.get(job.incident_id)?.severity ?? job.severity,status:"sending",attempts:job.attempts+1,locked_at:new Date(now).toISOString()};
    await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),JSON.stringify(claimed)+"\n","utf8"); return claimed;
  }); }
  async finishNotification(id:string, attempt:number, success:boolean):Promise<void> { await this.exclusive(async()=>{ const job=(await this.notifications()).find(item=>item.id === id); if(!job || job.status !== "sending" || job.attempts !== attempt) return; const incident=(await this.incidentLog()).filter(entry=>entry.incident.id === job.incident_id).at(-1)?.incident; const updated:FileNotification={...job,status:success ? "sent" : !incident || incident.status === "resolved" || (job.kind === "escalation" && incident.status !== "open") ? "cancelled" : job.attempts>=(job.max_attempts ?? 3) ? "failed" : "pending",locked_at:null,next_attempt_at:success ? job.next_attempt_at : new Date(Date.now()+(job.retry_delay_minutes ?? 2)*60_000).toISOString()}; await fs.appendFile(path.join(this.directory,"notification-outbox.jsonl"),JSON.stringify(updated)+"\n","utf8"); }); }
  async notificationCounts():Promise<NotificationCounts> { const counts:NotificationCounts={pending:0,sending:0,sent:0,failed:0,cancelled:0}; for(const job of await this.notifications()) counts[job.status]++; return counts; }
  async close() {}
}

export async function createStorage(options: { directory: string; schemaPath: string; databaseUrl?: string; limits?: ValidationLimits }): Promise<Storage> {
  if (!options.databaseUrl) return new FileStorage(options.directory, options.limits);
  const pool = new Pool({ connectionString: options.databaseUrl });
  const storage = new PostgresStorage(pool as unknown as Connectable);
  try { await storage.initialize(await fs.readFile(options.schemaPath,"utf8")); return storage; }
  catch (error) { await pool.end(); throw error; }
}
