# Phase 2: local integration prototype

The original full phase plan is not saved in the repository. This document records what the Phase 2 prototype currently supports and distinguishes that work from field validation still needed for a real sensor deployment.

## Prototype capabilities

- Open-Meteo model estimates are collected on a configurable schedule and kept separate from station submissions. Failed collection is surfaced, and cached readings or replay are labeled. See the [backend notes](BACKEND.md).
- Administrators and station-scoped device credentials can submit validated observations. A local HTTPS gateway is tested with simulated station data; see the [station API](STATION-API.md) and [gateway guide](HTTPS-GATEWAY.md).
- Opt-in station freshness identifies stale data and a first reading that has not arrived after the configured grace period. The display is station-level and does not prove physical device identity. The current backend can create an incident and queue configured email for stale or missing data; see [station API](STATION-API.md).
- Fresh submitted observations can generate detection snapshots and reviewable incidents; optional email delivery and manual incident actions are documented in [email notifications](EMAIL-NOTIFICATIONS.md).
- NOAA historical observations can be analyzed separately. Offline evaluations include multiple stations, held-out months and controlled synthetic changes; see [detector evaluation](DETECTOR-EVALUATION.md).
- An optional IMD read-only reference is prepared but requires approved access and end-to-end verification; see [IMD setup](IMD-REFERENCE.md).

## What remains outside local prototype verification

A physical weather station has not been connected or authenticated. The gateway's default certificate and listener are for local testing, not remote production. Current NOAA samples do not contain verified sensor-fault labels; synthetic perturbations are not real-world accuracy measurements, and the experimental detector has not been deployed. IMD access and its response format have not been verified with credentials. Complete the field connection and independently labeled evaluation when those resources are available; do not describe the prototype as validated against real equipment before then.

## Verification

From the project directory, run `npm test`, `npm run check`, and `npm run build`. The automated gateway and station tests use isolated synthetic data and temporary storage; they do not submit to the user's station database or send email. For the actual dashboard, sign in and check the source badge: an Open-Meteo badge represents model estimates, while a cached or replay badge indicates a different state.

The [13 November 2026 verification report](PHASE2-VERIFICATION.md) records the checks, fixes and remaining limitations.
