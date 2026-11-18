import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStorage } from "./storage.js";
import { migrateLegacyHistory, migrateLegacySidecars } from "./migration.js";
import { loadValidationLimits } from "./observations.js";
import { loadProjectEnv } from "./local-env.js";

async function main() {
  loadProjectEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const directory = process.env.SKYGUARD_DATA_DIR ? path.resolve(process.env.SKYGUARD_DATA_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "runtime");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before migrating. The original history will not be changed.");
  const storage = await createStorage({ directory, schemaPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"), databaseUrl: process.env.DATABASE_URL, limits: loadValidationLimits() });
  try {
    const result = await migrateLegacyHistory(storage, path.join(directory,"observations.jsonl"), loadValidationLimits());
    console.log(`Backup created: ${result.backupPath}`);
    console.log(`Processed ${result.lines} history lines: ${result.inserted} inserted, ${result.duplicate} already present, ${result.invalid} invalid.`);
    const sidecars = await migrateLegacySidecars(storage, directory, loadValidationLimits());
    for (const backup of sidecars.backups) console.log(`Backup created: ${backup}`);
    console.log(`Quality events processed: ${sidecars.qualityEvents}; settings: ${sidecars.settings}; audit events imported: ${sidecars.auditEvents}; scored entries processed: ${sidecars.scoredResults}; skipped malformed entries: ${sidecars.skipped}.`);
  } finally { await storage.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "History migration failed."); process.exitCode=1; });
