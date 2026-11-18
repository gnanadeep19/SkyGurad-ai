import { promises as fs, constants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { validateObservation, type ObservationEvent, type SourceMode, type ValidationLimits } from "./observations.js";
import type { Storage } from "./storage.js";

/** Copy the original first; migration never modifies or removes the source history. */
export async function migrateLegacyHistory(storage: Storage, historyPath: string, limits?: ValidationLimits) {
  const backupPath = `${historyPath}.${new Date().toISOString().replace(/[:.]/g,"-")}.${randomBytes(4).toString("hex")}.bak`;
  await fs.copyFile(historyPath, backupPath, constants.COPYFILE_EXCL);
  const content = await fs.readFile(backupPath,"utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const totals = { lines: lines.length, inserted: 0, duplicate: 0, invalid: 0 };
  const sources: SourceMode[] = ["live", "station-api", "open-meteo", "replay", "uploaded", "legacy-unknown"];
  for (let offset=0; offset<lines.length; offset+=250) {
    const events: ObservationEvent[] = lines.slice(offset,offset+250).map((line) => {
      try {
        const raw = JSON.parse(line);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid record");
        const source: SourceMode = sources.includes(raw.source) ? raw.source : "legacy-unknown";
        const validReceived = typeof raw.recorded_at === "string" && Number.isFinite(Date.parse(raw.recorded_at));
        const recordedAt = validReceived ? new Date(raw.recorded_at).toISOString() : new Date().toISOString();
        const event = validateObservation(raw, { source, recordedAt, allowMissingCoordinates: true, limits });
        if (!validReceived) event.issues.push({ code: "legacy_received_at_missing", field: "recorded_at", message: "The original receipt time is unavailable; migration time is recorded.", severity: "warning" });
        return event;
      } catch {
        return { source: "legacy-unknown", recorded_at: new Date().toISOString(), raw: { unparseable_line: line }, observation: null, issues: [{ code:"invalid_json", field:"record", message:"The original line could not be parsed as JSON." }] };
      }
    });
    const result=await storage.ingest(events); totals.inserted+=result.inserted; totals.duplicate+=result.duplicate; totals.invalid+=result.invalid;
  }
  return { backupPath, ...totals };
}

/** Migrate the file-mode sidecars, retaining a backup of each original file. */
export async function migrateLegacySidecars(storage: Storage, directory: string, limits?: ValidationLimits) {
  const report = { backups: [] as string[], qualityEvents: 0, settings: "not found", auditEvents: 0, scoredResults: 0, skipped: 0 };
  const sources: SourceMode[] = ["live", "station-api", "open-meteo", "replay", "uploaded", "legacy-unknown"];
  const snapshot = async (name: string): Promise<string | null> => {
    const original=path.join(directory,name);
    const backup=`${original}.${new Date().toISOString().replace(/[:.]/g,"-")}.${randomBytes(4).toString("hex")}.bak`;
    try { await fs.copyFile(original,backup,constants.COPYFILE_EXCL); }
    catch(error: any) { if(error?.code === "ENOENT") return null; throw error; }
    report.backups.push(backup); return fs.readFile(backup,"utf8");
  };
  const sourceOf = (value: unknown): SourceMode => sources.includes(value as SourceMode) ? value as SourceMode : "legacy-unknown";
  const timestampOf = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
  const quality = await snapshot("observation-events.jsonl");
  if (quality !== null) {
    const lines=quality.split(/\r?\n/).filter((line)=>line.trim());
    for(let offset=0;offset<lines.length;offset+=250) {
      const events: ObservationEvent[] = lines.slice(offset,offset+250).map((line)=>{
        try {
          const item=JSON.parse(line); const raw=item.raw && typeof item.raw === "object" && !Array.isArray(item.raw) ? item.raw : { original_raw:item.raw };
          const event=validateObservation(raw,{source:sourceOf(item.source),recordedAt:timestampOf(item.recorded_at),allowMissingCoordinates:true,limits});
          if(item.quality_status === "invalid") { event.observation=null; if(Array.isArray(item.issues) && item.issues.length) event.issues=item.issues; }
          else if(Array.isArray(item.issues)) for(const issue of item.issues) if(!event.issues.some((existing)=>existing.code===issue.code && existing.field===issue.field)) event.issues.push(issue);
          return event;
        } catch { return {source:"legacy-unknown",recorded_at:new Date().toISOString(),raw:{unparseable_line:line},observation:null,issues:[{code:"invalid_json",field:"record",message:"The original event line could not be parsed as JSON."}]}; }
      });
      await storage.ingest(events); report.qualityEvents+=events.length;
    }
  }
  const settingsText=await snapshot("detector-settings.json");
  if(settingsText !== null) {
    const settings=JSON.parse(settingsText);
    if(![settings.warning_score,settings.critical_score,settings.regional_fraction].every(Number.isFinite) || settings.warning_score < .05 || settings.critical_score > .99 || settings.warning_score >= settings.critical_score || settings.regional_fraction < .2 || settings.regional_fraction > 1) throw new Error("Legacy detector settings are invalid; they were backed up but not imported.");
    report.settings=await storage.importSettingsIfAbsent(settings) ? "imported" : "existing database settings preserved";
  }
  const auditText=await snapshot("audit.jsonl");
  if(auditText !== null) {
    const lines=auditText.split(/\r?\n/).filter((line)=>line.trim());
    for(let index=0;index<lines.length;index++) {
      let row: any; try { row=JSON.parse(lines[index]); } catch { report.skipped++; continue; }
      if(typeof row.action !== "string") { report.skipped++; continue; }
      const actor=String(row.actor ?? row.actor_id ?? "legacy-unknown"), details=row.details && typeof row.details === "object" ? row.details : {};
      const key=createHash("sha256").update(`audit.jsonl|${index}|${lines[index]}`).digest("hex");
      if(await storage.importAuditEvent(actor,row.action,details,timestampOf(row.created_at),key)) report.auditEvents++;
    }
  }
  for(const name of ["anomaly-results.jsonl", "alerts.jsonl"]) {
    const content=await snapshot(name); if(content === null) continue;
    for(const line of content.split(/\r?\n/).filter((entry)=>entry.trim())) {
      let row: any; try { row=JSON.parse(line); } catch { report.skipped++; continue; }
      const result=name === "alerts.jsonl" ? row.details : row;
      if(!result || typeof result.station_id !== "string" || !Number.isFinite(Date.parse(result.timestamp)) || ![result.anomaly_score,result.health].every(Number.isFinite) || !(result.confidence === null || Number.isFinite(result.confidence)) || typeof result.status !== "string") { report.skipped++; continue; }
      await storage.recordResults(sourceOf(row.source),[result]); report.scoredResults++;
    }
  }
  return report;
}
