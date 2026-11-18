# SkyGuard AI

SkyGuard AI is an automatic-weather-station anomaly detection dashboard. The development dashboard uses Open-Meteo; approved IMD AWS/ARG access can be configured separately as a read-only reference.

## Project layout

- `frontend/` — React + Vite dashboard
- `backend/` — Express API, ingestion, anomaly detection and station registry
- `shared/` — data/types shared by frontend and backend
- `data/` — runtime observation history
- `docs/` — development/backend notes
- `patches/` — package patches

## Run

Install dependencies with Node.js 22.15 or later:

```powershell
npm install --legacy-peer-deps
```

If the project-local PostgreSQL cluster has been set up on this machine, start it from your normal Windows terminal with `npm run db:start`. The backend automatically loads the ignored `.env.skyguard.local` configuration. Alternatively, configure `DATABASE_URL` for another PostgreSQL instance; without it, the app uses transitional file storage.

In one terminal run `npm run dev:backend`, and in another run `npm run dev`. Open http://localhost:3000. To build the complete application, run `npm run build` and then `npm start`.

On Windows PowerShell, if `npm` is blocked by the script execution policy, use `npm.cmd` in these commands (for example, `npm.cmd run dev`).

See [Phase 1 storage and local setup](docs/PHASE1.md) for validation, migration, backups, and limitations.
See [Phase 2 prototype status](docs/PHASE2.md) for integration features and the field validation still needed.
See [Phase 3 incident review](docs/PHASE3.md) for assignment, review outcomes, and notification escalation.
See [Railway deployment preparation](docs/RAILWAY-DEPLOYMENT.md) for hosted storage and HTTPS email configuration.

## Accounts and roles

On first startup, the backend prints a one-time setup code in its terminal. Open the dashboard, enter that code, and create the first administrator account. The code changes if the backend restarts before setup is completed.

Select the role assigned to your account when signing in. Administrators can manage team accounts and detection thresholds. Operators can monitor stations, review anomalies, and analyze datasets. Accounts are stored in `data/runtime/users.json` with salted password hashes; sessions expire after eight hours and are cleared when the backend restarts. Protect the account file and include it in secure backups if accounts must be retained.

This local account system is intended for the prototype. For a public deployment, use HTTPS, protect the setup code and account storage, and terminate TLS at a trusted reverse proxy and set `SKYGUARD_TRUST_PROXY=1` only when direct access to the backend is blocked. Review authentication and session storage before production use.

## Data source

SkyGuard uses Open-Meteo at the bundled 100 locations. These are model-based weather estimates, not physical sensor measurements; they cannot establish that a station sensor is faulty. The optional IMD reference is separate from detection: see [IMD setup](docs/IMD-REFERENCE.md). The former `IMD_AWS_API_URL`/`IMD_API_TOKEN` automatic detector switch is no longer used because the documented IMD pressure is mean sea-level pressure and IMD station identities have not been mapped to the bundled network.

The backend collects and scores data at startup and then every 15 minutes even when no dashboard is open. Configure `SKYGUARD_INGEST_INTERVAL_MINUTES` (1–1440) or disable the background scheduler with `SKYGUARD_BACKGROUND_INGESTION=0`. Only one backend process should run this local scheduler for a database. If a source fails, cached readings are marked stale; without cached readings the background job reports failure instead of generating replay observations. The dashboard may still show its clearly labeled replay fallback. Scheduler status is in memory and resets on restart.

## Main API endpoints

- `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login` — account setup and sign-in
- `GET /api/auth/me`, `POST /api/auth/logout` — current session and sign-out
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` — administrator-only account management
- `GET /api/quality-events` — recent rejected, duplicate, or flagged original inputs
- `GET /api/ingestion/status` — background collection state, last result, and next attempt (sign-in required)
- `GET /api/station-scoring/status` — pending submitted-station scoring and retry status (sign-in required)
- `POST /api/station-observations` — administrator-only submission of station readings; see [station API](docs/STATION-API.md)
- `POST /api/device/observations` — local-only submissions using a station-scoped device credential
- `GET/POST /api/device-credentials`, `POST /api/device-credentials/:id/revoke` — local administrator credential management
- `GET /api/station-observations/monitor` — latest submitted station readings with freshness and baseline information
- `GET /api/station-freshness` — opt-in station data-arrival monitoring
- `GET /api/reference-station` — NOAA Chennai airport reference observation, separate from station telemetry
- `GET /api/imd-reference` — optional IMD AWS reference, separate from station telemetry and detection
- `GET /api/evaluation/chennai` — saved offline evaluation of the NOAA Chennai sample
- `GET /api/station-incidents`, `GET /api/station-incidents/:id/actions`, and `POST /api/station-incidents/:id/{acknowledge,investigate,assign,resolve}` — review and assign incidents and their history
- `GET /api/incident-assignees` — active team members available for incident assignment
- `GET /api/notification-policy`, `PUT /api/notification-policy` — administrator-only email, severity, retry, and escalation settings
- `GET /api/notification-status` — email configuration and queue counts; see [Gmail setup](docs/EMAIL-NOTIFICATIONS.md)
- `GET /api/alert-history` — historical detected-observation snapshots
- `GET /api/realtime` — current station readings + anomaly scores
- `GET /api/history?hours=24` — stored observations
- `GET /api/config` — detector configuration
- `POST /api/config` — update detector thresholds
- `POST /api/analyze` — analyze a CSV dataset
- `npm run gateway` — local-by-default HTTPS device gateway; see [setup](docs/HTTPS-GATEWAY.md)
- `node scripts/evaluate-detector.mjs <csv>` — isolated historical evaluation; see [evaluation](docs/DETECTOR-EVALUATION.md)
- `GET /api/health` — backend/source/model health
