# Station observation API

This local prototype accepts station observations from an authenticated administrator or through a station-scoped device credential. Both paths store input under the `station-api` source, separately from Open-Meteo, replay, IMD, and CSV uploads. Fresh, newly inserted observations can produce historical detection snapshots. This does not verify that a physical sensor exists or change the overview dashboard source. No real station feed is connected by adding this endpoint.

The administrator API uses SkyGuard's existing eight-hour browser session. Device credentials provide a separate, station-scoped path with expiry, revocation, and a basic in-process rate limit. **The backend device endpoint and credential management accept requests only from the same computer.** A separate [HTTPS gateway](HTTPS-GATEWAY.md) can forward device submissions; its default setup is local-only and remote deployment is not yet complete. Distributed rate limiting and physical device identity verification are not implemented. Do not expose the development server or its proxy to an untrusted network, embed an administrator password in a device, or consider a station connected until its identity and data have been verified.

## Device credentials for local testing

On the **Station feed** page, an administrator can create a credential for a station ID with a 1–365 day expiry. The secret appears once: store it securely. It is never shown again and only its SHA-256 hash is saved. To rotate a credential, create a replacement, update the gateway, and revoke the old one; a request already in progress may finish. Operators cannot manage credentials. Revoked and expired credentials cannot submit new batches.

An administrator can opt a station into **Station freshness** by setting its expected interval in minutes on an active credential. The display shows awaiting the first reading, receiving, stale when receipt or observation age exceeds twice the interval, and no recent data when receipt age exceeds three times the interval. If no reading has ever arrived, it shows no first reading after three intervals from when monitoring was enabled. Older monitoring settings without a recorded start time remain awaiting; an administrator can save their interval again to start the timer. If multiple active credentials for a station have intervals, the shortest is used; for equal intervals the earliest known monitoring start is used. Revoked and expired credentials do not configure monitoring. These statuses are derived from all accepted `station-api` submissions for that station, including administrator submissions; they do not prove a particular device is connected. The backend checks every minute and opens a separate `station-health` warning for a stale or missing feed. It queues email if email is enabled and Warning notifications are selected. Repeated checks do not create repeated alerts during the same outage; a recovered feed can trigger a new incident after a later outage. An open incident is not automatically resolved when data resumes.

Use `POST /api/device/observations` on the same computer with `Authorization: Bearer <credential>` and the same JSON format described below. Every observation in a batch must have exactly the station ID assigned to that credential; an out-of-scope batch is rejected before storage. Device credentials do not grant access to dashboard or administrator endpoints. The rate limit is shared across local devices in one process and resets when the backend restarts.

A single-reading, local-only client for connecting a future station adapter to the HTTPS gateway is available in [Local station bridge](LOCAL-STATION-BRIDGE.md). It accepts data from another program; it does not itself read a sensor or simulate one.

For example, use a program or secure client that reads the token from protected storage and sends it in the authorization header; avoid putting it in URLs, source code, shell history, or logs. A production deployment needs a reviewed HTTPS gateway and device lifecycle design before any remote station is connected. Bearer credentials require protection in transit and storage; see [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html).

Credential hashes and metadata are stored in the ignored local `data/runtime/device-credentials.json` file, even when telemetry uses PostgreSQL. Protect and back up that file separately, alongside the account file. The file store assumes a single backend process; database backups alone do not include credentials. Never copy an unprotected credential file or token to a public repository.

## Submit a batch

After signing in as an administrator, send JSON to `/api/station-observations`. Operators and unauthenticated requests cannot submit data. The batch accepts 1–100 objects, each at most 16 KiB. All fields below are required; the example is illustrative, not an actual sensor reading:

```json
{
  "observations": [
    {
      "station_id": "EXAMPLE-001",
      "station_name": "Example station",
      "timestamp": "2024-01-01T00:00:00Z",
      "latitude": 13.0,
      "longitude": 80.18,
      "temperature": 25.2,
      "humidity": 70,
      "pressure": 1008.4,
      "pressure_type": "station"
    }
  ]
}
```

Use an observation timestamp with `Z` or a numeric offset, coordinates in decimal degrees, temperature in °C, relative humidity in percent, and **station-level** pressure in hPa. `pressure_type` must be `station`; sea-level pressure cannot be submitted as station pressure. The timestamp is the sensor's observation time, not when the request is sent. The optional station name defaults to the ID. Unknown station IDs are kept with a quality warning and are not automatically matched to the bundled example network.

The response provides aggregate `inserted`, `duplicate`, and `invalid` counts and issues for invalid rows using zero-based array indexes. A `200` response can contain rejected rows; check the quality counts. Duplicate identity is the combination of source, station ID, and observation time, and duplicates do not replace prior observations. Raw valid, invalid, and duplicate events are retained for quality review. The endpoint audits aggregate submission counts without recording credentials. HTTP 401 indicates no valid session, 403 indicates insufficient role, and 400 indicates a malformed or oversized batch.

The `detection` object reports scoring status and counts. Newly inserted station readings enter a persistent queue and are processed in observation order, including older backfilled data. Each Isolation Forest score requires at least 24 earlier readings within seven days; up to 96 earlier readings form the baseline. Insufficient readings are recorded as such, not rescored later using future observations. Warnings or critical results from readings that were fresh when received open or update a station incident, even if a retry is delayed; historical backfills are stored without generating operational incidents. Duplicate observations are not queued again. The worker retries pending work every 30 seconds and at startup; `GET /api/station-scoring/status` exposes pending work and the last error. Queue processing is limited to 200 items per run. PostgreSQL commits a score, incident, notification and queue completion together. The transitional file store is single-process and does not offer the same crash-atomic guarantee; use PostgreSQL for dependable operation. Only one backend process should handle submissions. Previously stored readings are not automatically added to the new queue.

For fresh submitted readings, flat-line review checks for at least eight nearly unchanged samples covering an hour, without gaps over 30 minutes in the last two hours. Sustained-change review uses the experimental same-hour baseline rule, at most once per station per hour, and requires sufficient past history. These heuristics can flag normal weather, rounding or communication problems; a warning is not proof of a sensor fault. Warnings can be raised even when the Isolation Forest baseline is insufficient. The latest Station feed card recomputes the baseline score; review incidents for sustained and arrival warnings. The 15-day sustained-history query is limited to the latest 30,000 rows and the short flat-line query to 10,000 rows.

An authenticated user can inspect recent accepted readings with `GET /api/history?source=station-api&hours=24` (up to 168 hours) and review rejected/duplicate inputs on **Data quality** or `GET /api/quality-events`. The **Station feed** page and `GET /api/station-observations/monitor` display the latest submitted reading per station observed in the last seven days, marking readings older than `SKYGUARD_SOURCE_MAX_AGE_MINUTES` (default 30) stale. Current scores are calculated on request and can differ from saved detection snapshots after additional data or settings changes. The page also shows up to 10 historical flagged snapshots. Scores are not device verification. The monitor uses the most recent 20,000 readings if that window is exceeded and displays a warning when truncated. The page refreshes every minute. Overview dashboard charts continue using their configured source. The submission and validation tests use isolated synthetic inputs and do not put them into the user's database.

On Station feed, **Observation history** plots submitted temperature, humidity, or station pressure for a selected station over 24 hours or seven days. The chart uses only `station-api` readings; model estimates and uploads remain separate. Lines join available points, so they do not establish that measurements exist between observations. The history API returns at most the latest 2,000 readings and reports `truncated: true` if earlier matching readings were omitted; the chart displays a warning when that happens.

## Incidents and public reference

An open incident groups new detections for the same submitted station. Its displayed severity is the highest seen; the latest evidence can be a lower-severity reading. Administrators and operators can acknowledge or resolve an incident, optionally add a note, and review its action history. Incidents are not automatically resolved when observations become stale or return to normal. A later flagged observation after manual resolution opens a new incident. Configure optional Gmail delivery using [Email notifications](EMAIL-NOTIFICATIONS.md).

Separately, Station feed shows a public NOAA Aviation Weather Center METAR observation for Chennai airport (`VOMM`), cached for 10 minutes. It is an airport reference, not a connected device owned by the user. Temperature, dew point, and the reported aviation altimeter setting are displayed; altimeter is not station-level pressure, and the component does not calculate humidity. NOAA reference data is not saved as station telemetry and does not generate incidents. Reports older than 90 minutes or served after an upstream error are labeled stale. See [NOAA's data API](https://aviationweather.gov/data/api/) and [pressure definitions](https://www.weather.gov/bou/pressure_definitions).
