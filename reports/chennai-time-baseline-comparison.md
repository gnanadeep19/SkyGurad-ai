# Exploratory detector comparison: Chennai airport

SkyGuard's current historical detector was compared with an **experimental same-UTC-hour baseline** on NOAA GHCNh observations for Chennai International Airport. The live detector was not changed. The two methods use different scoring scales and thresholds; the comparison is descriptive and does not establish which detects sensor faults more accurately.

| Period | Observations scored by both | Current detector flagged | Experimental baseline flagged |
| --- | ---: | ---: | ---: |
| January 2024 | 192 | 64 (33.3%) | 19 (9.9%) |
| February 2024 | 174 | 56 (32.2%) | 6 (3.4%) |

Both counts in each row use the same observation timestamps. January included 57 readings flagged only by the current method and 12 flagged only by the candidate; February included 53 and 3, respectively. Without verified fault labels, neither difference can be classified as correct or incorrect. February is a later period at the **same station**, not an independent-station test.

The candidate compares each reading with earlier readings from the same station and UTC-hour bin. It requires at least seven prior days, uses up to 14 prior days with observations, and flags a reading if any of the three measurements deviates by at least 3.5 robust scales. Minimum scales of 0.5 °C, 3 percentage points of humidity, and 1 hPa prevent division by very small variation. These parameters are experimental and have not been calibrated to match the current detector's sensitivity. Both methods use only earlier readings; each month is replayed independently and has its own warm-up.

## Controlled synthetic spike check

For eight observations on 20 February, each reading was replayed separately with a **synthetic** +5 °C or +10 °C temperature increase. Both methods flagged all eight modified readings at each increase. On the unmodified readings, the current method had already flagged four of eight, while the candidate flagged none. This is a small test of large, single-reading perturbations; it is not a measurement of real-world recall or fault-detection accuracy. It does not test subtle shifts, drift, humidity faults, or pressure faults.

Humidity in this NOAA sample is derived from the original temperature and dew point. The controlled test changes temperature while leaving humidity and pressure unchanged, which can create physical inconsistency and influence a multivariate detector. The injected readings were processed in temporary isolated storage; they were not saved to the user's database or sent by email.

The January and February samples contain only rows with all three fields present and the documented NOAA source/quality selections. They exclude 1,240 of 1,488 January source rows and 1,156 of 1,386 February source rows. Humidity is derived rather than independently measured. See [sample provenance](../data/noaa/README.md). The other four locally saved station files contained no rows with all three numeric fields, so no cross-station conclusion is available. The candidate does not impose a maximum age on prior days, and the fixed UTC-hour bins are not appropriate for all timezone or daylight-saving patterns.

The [machine-readable comparison](chennai-time-baseline-comparison.json) includes hourly counts and the [synthetic check](chennai-synthetic-spike-check.json) records each controlled case. More stations, varied seasons, labeled faults, and independently chosen thresholds are needed before considering any live detector change.
