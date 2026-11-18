# Phase 1: observation integrity and storage

## Current local setup

This project can use PostgreSQL when `DATABASE_URL` is configured, or a transitional local JSONL store when it is not. A configured but unavailable database causes startup to fail rather than silently switching stores.

On the machine where the project-local PostgreSQL cluster was initialized, start it from your normal Windows PowerShell or VS Code terminal:

```powershell
cd D:\SkyGuard-AI-main\SkyGuard-AI-main\SkyGuard-AI
npm install --legacy-peer-deps
npm run db:start
npm run dev:backend
```

In a second terminal, run `npm run dev` and open `http://localhost:3000`. The database listens on `127.0.0.1:55432` and is not installed as a Windows service. After a computer restart, run `npm run db:start` before starting the backend. To stop it, first stop the backend, then run `npm run db:stop`.

The ignored `.env.skyguard.local` file contains the generated local database connection. Do not commit or share it. Explicit environment variables take precedence over this file. The local database uses a project-specific role for development; use a separate least-privilege application role and appropriate secret management for a public deployment. User accounts remain in `data/runtime/users.json`, which is separate from PostgreSQL and must be backed up securely as well.

For another PostgreSQL instance, set `DATABASE_URL` in the backend environment before starting. Create the database first; the backend initializes the Phase 1 schema when it connects. Do not point this configuration at a database that contains unrelated data. The PostgreSQL binaries in `data/postgres-local` and the generated connection file are machine-local and are not included in the repository. If setting up another Windows machine, use the official PostgreSQL distribution and configure the connection separately.

## Data format and validation

Each reading contains a station ID and name, observation time, receipt time, source, location when available, temperature in °C, relative humidity in %, and pressure in hPa. Sources include `station-api` (administrator-submitted station readings), `open-meteo`, `replay`, `uploaded`, `legacy-unknown`, and potentially older records labeled `live`. The dashboard filters its charts to the currently selected source; the source badge distinguishes replay and marks stale cached data. Station API submissions appear separately on the Station feed page; see [station API](STATION-API.md). The optional IMD reference is not stored or scored; see [IMD setup](IMD-REFERENCE.md).

A valid timestamp is an ISO date and time. Include a `Z` or explicit UTC offset where possible; a timestamp without an offset is interpreted as Asia/Kolkata (+05:30). Inputs more than five minutes in the future, missing/non-numeric measurements, invalid coordinates, unsupported explicit units, and readings outside the screening ranges are rejected. Unknown station IDs and missing coordinates in CSV uploads are accepted with a warning. For compatibility, accepted CSV readings with no coordinates use `0,0` as a placeholder and must not be treated as a real station position; the original input and missing-coordinate warning are retained.

Default screening ranges are temperature −90 to 65 °C, humidity 0 to 100%, and pressure 300 to 1,100 hPa. These broad limits are not a diagnosis or a substitute for station-specific engineering limits. Adjust them for the deployed equipment using `SKYGUARD_TEMPERATURE_MIN`, `SKYGUARD_TEMPERATURE_MAX`, `SKYGUARD_HUMIDITY_MIN`, `SKYGUARD_HUMIDITY_MAX`, `SKYGUARD_PRESSURE_MIN`, and `SKYGUARD_PRESSURE_MAX`. Set these in the backend environment before startup. Source data is marked stale when all observations are older than `SKYGUARD_SOURCE_MAX_AGE_MINUTES` (default 30 minutes) or when cached Open-Meteo data is used after a fetch failure.

Original inputs and validation issues are stored separately from accepted observations. A duplicate is identified by source, station ID, and observation timestamp. Uploaded data uses the `uploaded` source and is not mixed into live or replay charts. Use the **Data quality** page or authenticated `GET /api/quality-events` to review recent invalid, duplicate, and warning events. The UI displays only the first 5,000 characters of a raw event; the API retains the complete stored input.

`data/examples/sample-observations.csv` is synthetic example data. The CSV upload validates quoted fields and shows up to ten rejected-row explanations. Upload analysis does not replace the live model profile. The API provides a summary and station-level scores; a full alert investigation workflow is planned for a later phase.

## Data stored

PostgreSQL schema version 1 provides stations, sensors, original observation events, accepted observations, model versions, anomaly results, detected-alert snapshots, detection settings, audit events, and reserved alert-action tables. Actual physical sensor identifiers are not invented when a source does not provide them. Stored alert snapshots are historical detections; acknowledgement, resolution, background monitoring, and notifications are not implemented by Phase 1.

When PostgreSQL is not configured, the app continues using append-only runtime files. `observations.jsonl` is not truncated by the new storage layer; `observation-events.jsonl`, `anomaly-results.jsonl`, `alerts.jsonl`, `detector-settings.json`, and `audit.jsonl` provide transitional storage. File mode is intended for local development, is not designed for multiple backend processes, and does not offer PostgreSQL's transactional guarantees. User-account changes and their audit events live in separate stores, so account audit recording is best effort.

## Migrating existing data

1. Back up the project and stop the backend so no process is writing the JSONL files.
2. Start the destination PostgreSQL database and set `DATABASE_URL`. If migrating existing file-mode settings, do this **before** starting the backend against the new database: existing database settings are intentionally never overwritten.
3. Run `npm run migrate:history` from the project directory.
4. The migration creates a uniquely named backup of each existing source file before reading it. It imports original observation history, quality-event sidecars, detection settings when absent in PostgreSQL, scored results and alert snapshots, and audit sidecars. The original files are not removed or rewritten. Malformed sidecar entries are counted and retained in their backups.
5. Review the counts and start the backend. Observation and detection-result inserts are idempotent; rerunning can add duplicate quality-event audit records, but it does not duplicate accepted observations or overwrite database settings.

## Backup and restore

For the project-local cluster, `npm run db:verify-backup` creates a PostgreSQL custom-format dump in the protected `data/postgres-local/backups` directory, restores it into a uniquely named temporary database, checks record counts and settings, and removes that temporary database after a successful verification. Stop the backend while running this check so the source data does not change during comparison. The dump does not include `users.json`, `.env.skyguard.local`, or the original JSONL backup files; retain separate protected backups of what you need. Keep backup copies outside the same machine for disaster recovery.

For other PostgreSQL deployments, use the server's supported `pg_dump` and `pg_restore` tools and restore only to a new, isolated database for verification. Do not pass passwords in command-line arguments.

## Verification and limitations

Run `npm run check`, `npm test`, and `npm run build`. The tests exercise validation, source separation, role enforcement, configuration persistence, file migration, transactional PostgreSQL-compatible storage, and backup restoration. Existing JSONL history is preserved; it is not automatically deleted after migration.

After Phase 1, the backend gained a local background polling scheduler; see the main README for its interval and limitations. An incident lifecycle, notification delivery, drift detection, and production-grade identity and operations remain future work. Review the local setup, validation limits, security, retention, and backup practices before any production deployment.
