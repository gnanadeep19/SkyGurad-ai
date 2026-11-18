# Phase 4: historical investigation and explainability

SkyGuard's local dashboard supports historical readings, detection snapshots, grouped station incidents, source-aware maps and recorded evidence. These features are intended for investigation and demonstrations; they do not establish that a physical sensor is faulty.

## Historical investigation

Open **Analytics → Historical observations and incidents**. Choose a UTC date range (up to 366 days), one source, and optionally a station ID. The measurement selects the readings trend. Alert measurement and severity filter detection snapshots and incidents; incident status applies only to grouped incidents, not readings or detection snapshots. Select **Apply filters** after changing the controls. All-measurements includes older records that did not identify an affected measurement.

The chart connects available readings, so gaps in time do not imply uninterrupted measurements. The latest displayed observation and its age refer to the current page, not necessarily the latest observation in the database. Open-Meteo values are model estimates; uploaded files, replay and station submissions remain separate sources.

The three independently paged sections show up to 5,000 readings, 50 detection snapshots and 50 grouped incidents per page. Use the newer/older controls to browse beyond those limits. Each CSV export contains the records on its current displayed page. Incident and snapshot counts are computed across matching records, with affected-measurement counts and the ten stations with the most matching records. Counts for individual measurements can overlap when a detection identifies more than one affected measurement. A changing dataset can move records between offset-based pages; reapply filters before reviewing or exporting. CSV text that could be interpreted as a spreadsheet formula is escaped.

Detection snapshots are individual flagged observations. Station incidents group repeated station API detections and have an operator status; those are different records and should not be summed as separate physical faults. Open a grouped incident's action history to see its most recent 100 actions and notes. The dashboard cannot reconstruct records or maintenance notes that were never saved.

## Evidence

New detections record the observed values, score, detector version and thresholds, previous observation, baseline centers and model baseline sample count when available. The incident and detection details display these fields and calculate per-hour changes from the recorded timestamps. The rate of change is context; it is not presented as a separate threshold that the detector applied. Earlier records may not contain all fields and explicitly show **Not recorded**. Nearby comparisons are not invented: check independent weather or station observations before determining a cause.

## Map

The overview map shows registered station locations, source-based statuses, region and status filters, map/satellite layers and selected-station details. The backend marks observations stale according to `SKYGUARD_SOURCE_MAX_AGE_MINUTES`; a cached source, stale observation, missing source or unreported registered station appears as **Unavailable or stale**. This describes the displayed data source, not physical device health or verified connectivity. Map tiles require network access. Replay is demonstration data; Open-Meteo is a modeled estimate.

## Verification

Run `npm test`, `npm run check`, and `npm run build`. Automated tests use isolated storage and include file and PostgreSQL-compatible incident/snapshot filters, pagination beyond 200 records, UTC boundaries, source isolation, evidence, map status, and CSV escaping. The development-only `/visual-check.html` fixture uses synthetic data and mocked requests; it does not validate the live backend. To use newly added backend routes, restart the backend and sign in again; existing in-memory sessions expire on restart.
