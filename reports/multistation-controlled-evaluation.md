# Offline comparison across stations and controlled anomalies

The current historical detector was compared with an experimental same-UTC-hour robust baseline. The candidate threshold was fitted **once** on the January 2024 Chennai development sample to match the current detector's count: both flagged 64 of the same 192 scored observations. The resulting candidate threshold was 1.988 robust deviations; the current warning threshold was 0.32. These are different score scales. Matching a flag rate on unlabeled data does not establish equal sensitivity, a false-positive rate, or sensor-fault accuracy.

Even in that matched development sample, the methods flagged different observations: 26 were flagged by both, 38 only by the current method, and 38 only by the candidate. Equal totals therefore do not mean the two detectors make the same decisions.

The threshold was then held fixed for the following separate station-month replays. Each month was analyzed independently with its own rolling warm-up; each point was compared only when both methods could score it. The per-station rolling baselines still use earlier readings within that evaluation month.

| NOAA station and period | Matched readings | Current flagged | Experimental flagged |
| --- | ---: | ---: | ---: |
| Chennai, February 2024 | 174 | 56 (32.2%) | 48 (27.6%) |
| Chennai, July 2024 | 182 | 54 (29.7%) | 62 (34.1%) |
| Singapore, January 2024 | 576 | 183 (31.8%) | 160 (27.8%) |
| Singapore, July 2024 | 563 | 167 (29.7%) | 118 (21.0%) |
| Dubai, January 2024 | 192 | 67 (34.9%) | 81 (42.2%) |
| Dubai, July 2024 | 181 | 49 (27.1%) | 74 (40.9%) |
| London Heathrow, January 2024 | 573 | 311 (54.3%) | 192 (33.5%) |
| London Heathrow, July 2024 | 525 | 236 (45.0%) | 209 (39.8%) |

The held-out flag rates differ by station and period. In particular, the experimental method flagged more observations in Dubai, but fewer in Singapore and London. With no verified sensor-fault labels, these differences cannot be classified as improvements or errors. January and July provide different parts of the year; the climatic seasons and measurement cadence differ across these locations.

## Controlled synthetic perturbations

Each case below replays the February Chennai dataset independently, changing a single reading at one of three selected times. A **new flag** means the changed reading was flagged when the same method did not flag that timestamp in its unmodified control. Thus the denominator excludes timestamps already flagged by that method.

| Single-reading change | Current new flags | Experimental new flags |
| --- | ---: | ---: |
| Temperature +1 °C | 0 of 2 | 0 of 3 |
| Temperature −1 °C | 0 of 2 | 0 of 3 |
| Temperature +2 °C | 0 of 2 | 2 of 3 |
| Temperature −2 °C | 0 of 2 | 1 of 3 |
| Humidity +5 percentage points | 0 of 2 | 0 of 3 |
| Humidity −5 percentage points | 0 of 2 | 2 of 3 |
| Station pressure +2 hPa | 0 of 2 | 1 of 3 |
| Station pressure −2 hPa | 1 of 2 | 2 of 3 |

For the two selected start times, separate 24-hour ramps were also tested: +2 °C, +10 percentage points humidity, and +5 hPa pressure. On one humidity ramp neither method produced a new flag during the eight altered timestamps; on the other, only the candidate produced one, after 21 hours. Temperature and pressure ramp results varied by start time. The [case-level report](calibrated-controlled-anomalies.json) contains all changes, controls, and first-new-flag times.

These are small, synthetic tests at one station and are not field recall measurements. Actual faults may be subtle, correlated, persistent, missing, or otherwise different. NOAA's humidity in these samples is derived from the original temperature and dew point, so changing temperature or humidity alone can create physically inconsistent combinations. A negative perturbation can also remove a flag that was present in its control. No synthetic observation was written to the user's database or sent by email.

## Data and limitations

The [provenance report](noaa-comparison-provenance.json) records the original NOAA URLs and SHA-256 hashes, station identities, monthly sample hashes, and included/excluded row counts. The samples retain complete values within SkyGuard's broad limits, source 223 with quality code 1 for temperature and station pressure, and source 223 derived humidity (measurement code D) with a blank humidity quality code. A blank humidity quality code is **not** independent verification. Missing rows were excluded, not filled. See [NOAA's GHCNh documentation](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf) and the [dataset overview](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01688/html).

These selected data do not contain verified sensor-fault labels. NOAA documents scientist-identified bad-sensor flags in its [USCRN ingest specification](https://www.ncei.noaa.gov/pub/data/uscrn/documentation/program/CRN_Ingest_Functional_Spec.pdf), but matching those records to compatible temperature, humidity, and pressure observations would require separate validation; they have not been treated as labels here. For example, [USCRN's product documentation](https://www.ncei.noaa.gov/access/crn/products.html) describes different variables across its products.

The experimental baseline remains offline. Real fault labels, more stations and time periods, appropriate timezone handling, and validation on independently chosen data are needed before considering a live change. The [machine-readable comparison](calibrated-multistation-comparison.json) records the calibration and matched counts.
