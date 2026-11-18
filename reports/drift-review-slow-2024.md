# Offline evaluation: smaller, slower changes

## Finding

The existing experimental review rule was rarely triggered by the smaller three- and five-day ramps tested here. It also flagged a substantial number of the unmodified historical windows. These observations do not establish real-world detection accuracy or a false-positive rate: the historical data has no verified sensor-fault labels. The rule should remain experimental and offline; it should not be presented as reliable gradual sensor-drift detection.

The rule compares same-hour residuals in the first and second halves of the latest day. A gradual multi-day ramp can be much smaller over those twelve hours than its total change, and its earlier portion also enters the historical baseline. These are plausible reasons for the low conditional detection counts, not a proven diagnosis of every individual result.

## Method and data

We used nine previously explored NOAA-derived 2024 station-month samples from Chennai, Dubai, Singapore and London. Source details are in `noaa-comparison-provenance.json` and the existing NOAA sample documentation. Humidity is derived from temperature and dew point; the independent synthetic humidity changes need not be physically consistent. All nine file hashes and each case are recorded in `drift-review-slow-2024.json`. The seven files covered by the comparison provenance matched their recorded SHA-256 hashes; the Chennai January and February hashes also matched their previously documented values.

We selected days 12 through 28 at 21:00 UTC, using only observations at or before the endpoint and requiring an observation within three hours. There were 153 scheduled windows, of which 152 had a usable endpoint. For each field, three windows had insufficient data for the rule, leaving 149 scored controls. Windows overlap and are not independent; the samples are not held-out evidence.

For each available window and each field, we separately added a linear positive or negative ramp ending at the final observed reading: temperature 1 or 2 °C, humidity 5 or 10 percentage points, and pressure 2 or 4 hPa, over 72 or 120 hours. An observation at or before the ramp start within six hours and no observation gaps above six hours through the endpoint were required. Cases exceeding broad input bounds, including humidity outside 0–100%, were skipped rather than clipped. Existing thresholds were not changed.

## Unmodified historical windows

| Field | Review flags | No shift | Insufficient |
| --- | ---: | ---: | ---: |
| Temperature | 49 | 100 | 3 |
| Humidity | 53 | 96 | 3 |
| Pressure | 28 | 121 | 3 |

These are review flags among unlabeled observations, not confirmed faults or confirmed false alarms. Results differed considerably across stations and months: for example, London January had 14 temperature and 15 pressure review flags among the 17 scheduled windows; Chennai January had 3 and 0, respectively. Real weather, observational characteristics and other factors may all contribute; these data cannot identify the cause.

## Synthetic ramp results

Each cell shows newly flagged cases / eligible cases. Eligible means the unmodified window was `no_shift`, the ramp had sufficient coverage and remained within input bounds, and the simulated window was scorable. Windows already flagged before injection are excluded from this denominator. The signs and magnitudes below refer to the total injected change at the end of the ramp, not the observed change during the last day.

| Field | Ramp | 72 hours | 120 hours |
| --- | ---: | ---: | ---: |
| Temperature | −1 °C | 5/96 | 5/93 |
| Temperature | +1 °C | 4/96 | 2/93 |
| Temperature | −2 °C | 8/96 | 7/93 |
| Temperature | +2 °C | 8/96 | 4/93 |
| Humidity | −5 pp | 4/93 | 3/90 |
| Humidity | +5 pp | 1/88 | 1/83 |
| Humidity | −10 pp | 10/93 | 4/90 |
| Humidity | +10 pp | 4/67 | 3/56 |
| Pressure | −2 hPa | 2/116 | 1/112 |
| Pressure | +2 hPa | 1/116 | 0/112 |
| Pressure | −4 hPa | 4/116 | 1/112 |
| Pressure | +4 hPa | 5/116 | 2/112 |

Per scenario, three controls were insufficient; another five 72-hour or nine 120-hour cases lacked ramp coverage. Positive humidity ramps also exceeded 100% in 11 or 45 cases for +5 or +10 pp over 72 hours, and 15 or 58 cases over 120 hours. These exclusions change the populations being compared. In some cases an injected ramp changed an existing review flag to `no_shift`; counts are recorded as `suppressed_flags` in the JSON. The experiment cannot establish how accurately the system detects actual sensor drift.

## Reproduce

Run from the project directory. The evaluator refuses to overwrite an existing report; choose a new output filename:

```powershell
npx.cmd tsx scripts/evaluate-slow-drift.ts reports/drift-review-slow-reproduction.json `
  data/noaa/chennai-ghcnh-january-2024.csv `
  data/noaa/chennai-ghcnh-2024-02.csv `
  data/noaa/ghcnh-INI0000VOMM-2024-07.csv `
  data/noaa/ghcnh-AEI0000OMDB-2024-01.csv `
  data/noaa/ghcnh-AEI0000OMDB-2024-07.csv `
  data/noaa/ghcnh-SNI0000WSSS-2024-01.csv `
  data/noaa/ghcnh-SNI0000WSSS-2024-07.csv `
  data/noaa/ghcnh-UKI0000EGLL-2024-01.csv `
  data/noaa/ghcnh-UKI0000EGLL-2024-07.csv
```

No live telemetry, database records, incidents, notifications or production thresholds are modified. Future work could compare a longer-horizon candidate with the present rule using separately selected station-months and, when available, verified fault labels. Synthetic tests alone cannot validate physical sensor faults.
