# SkyGuard backend

The backend is an Express + TypeScript service. For current storage, validation, migration, and backup instructions, see [Phase 1](PHASE1.md). The dashboard uses Open-Meteo; the optional IMD AWS reference is separate from anomaly detection.

## Data source

The default network contains 100 Indian station locations. Open-Meteo requests are batched in groups of 20 to avoid oversized URLs. Each batch requests current values plus seven days of hourly temperature, relative humidity and surface pressure for station-specific model context.

## Detection

The detector combines:

1. numeric, timestamp, coordinate, unit, and configurable broad-range validation,
2. station-specific robust median/MAD deviations,
3. a dependency-free Isolation Forest over six temporal/multivariate features,
4. nearby-station spatial patterns to help prioritize regional or localized anomalies for review.

The result is exposed by `GET /api/realtime`.

An anomaly score is a model indicator, not a calibrated probability of sensor failure. The score-derived health index is not a verified measurement of equipment condition. Investigate flagged observations against independent observations and station records before diagnosing a fault. Open-Meteo values are modeled weather data, not physical sensor observations.

Recommendations depend on the source: model estimates are compared with independent weather observations, replay data is demonstration-only, and submitted station readings should be verified before considering equipment inspection. Uploaded datasets require a review of provenance and quality flags. Previously stored snapshots retain their original guidance as historical records.

Legacy `confidence` fields remain in responses for compatibility but are `null`; historical alert responses also suppress previously stored uncalibrated values without changing the stored records. The network classification `localized_anomaly` replaces the former `sensor_fault` classification: API consumers should update their handling of this value.

## API

- `GET /api/health`
- `GET /api/config`
- `POST /api/config`
- `GET /api/history?hours=24&station_id=AWS-001&source=replay`
- `GET /api/quality-events`
- `GET /api/alert-history`
- `GET /api/realtime`
- `POST /api/analyze` with `{ "csv": "..." }`

## IMD reference

See [IMD reference setup](IMD-REFERENCE.md). The documented AWS example provides mean sea-level pressure, not station pressure. Do not mix these quantities or use IMD reference data as a validated physical station feed.
