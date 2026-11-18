# Offline evaluation of the experimental drift review

This evaluates the **new sustained-change rule** used in SkyGuard's historical review, not the earlier time-of-day point anomaly comparison. It uses 27 predetermined end times across nine saved NOAA station-month samples: Chennai in January, February and July 2024; Dubai, Singapore Changi and London Heathrow in January and July 2024. The station-months have been explored in earlier project work, so this is **not independent field validation**. The thresholds were fixed before these runs. All nine CSV hashes matched the recorded [provenance manifest](noaa-comparison-provenance.json) or the documented Chennai sample hashes.

For each station-month, the script selected the last observation at or before 21:00 UTC on the 15th, 20th and 25th, within three hours of the target. All 27 targets had a reading exactly at 21:00 UTC. Each original window was checked separately, then one variable at a time was changed with a linear rising or falling ramp across its final 24 hours. The rule used only observations up to the selected endpoint and earlier same-UTC-hour baselines. No observations were sent to SkyGuard's live database and no email was sent.

## Original observations

| Variable | Review flag | No flag | Insufficient data |
| --- | ---: | ---: | ---: |
| Temperature | 7 | 19 | 1 |
| Humidity | 10 | 16 | 1 |
| Pressure | 5 | 21 | 1 |

These observations have no verified sensor-fault labels. The original flags are **not known false positives or confirmed faults**; weather and other effects may explain them. One Chennai July window was insufficient because its most recent day had a gap over six hours. The windows share baseline history and should not be treated as independent trials.

## Synthetic 24-hour ramps

A **new flag** means the original window was not flagged and the modified window was flagged. The eligible denominator excludes original windows already flagged, insufficient windows, and ramps that would leave the broad input ranges. Each row represents up to 27 separately altered windows; it is not a sensor-fault recall measurement.

| Change over 24 hours | New flags / eligible | Skipped outside range | Insufficient | Originally flagged among remaining |
| --- | ---: | ---: | ---: | ---: |
| Temperature −4 °C | 18 / 19 | 0 | 1 | 7 |
| Temperature +4 °C | 18 / 19 | 0 | 1 | 7 |
| Humidity −15 percentage points | 15 / 16 | 0 | 1 | 10 |
| Humidity +15 percentage points | 9 / 11 | 10 | 1 | 5 |
| Station pressure −6 hPa | 18 / 21 | 0 | 1 | 5 |
| Station pressure +6 hPa | 21 / 21 | 0 | 1 | 5 |

Ten upward humidity ramps were skipped because at least one simulated value exceeded 100%; values were not clipped. Adding a ramp also **removed** an existing control flag in some cases: four temperature −4 °C, two temperature +4 °C, five humidity −15 pp, one humidity +15 pp and five pressure +6 hPa cases. This demonstrates that the result depends on the original trend and the direction of the added change. The [machine-readable report](drift-review-multistation-2024.json) records every control and simulated outcome and every skipped case.

## Interpretation

These selected, relatively large synthetic ramps show how the rule behaves under controlled changes; they do not establish detection performance on smaller, longer-lasting or real faults. Derived humidity depends on temperature and dew point, so changing one variable alone can create physically inconsistent data. Differences in reporting cadence, gaps, weather and season affect outcomes. NIST notes that measurement-process drift may be difficult to separate from changes associated with other variables. [NIST measurement-process guidance](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd443.htm)

Keep the feature experimental and historical-only. Verified fault labels, additional independently selected data and assessment of ordinary weather changes are needed before a live deployment or accuracy claim. See [experimental drift methodology](../docs/EXPERIMENTAL-DRIFT.md) and [NOAA sample provenance](../data/noaa/README.md).

## Reproduce

From the project directory, choose a new output path; the script refuses to overwrite an existing report:

```powershell
npx tsx scripts/evaluate-drift-review.ts reports/new-drift-evaluation.json data/noaa/chennai-ghcnh-january-2024.csv data/noaa/chennai-ghcnh-2024-02.csv data/noaa/ghcnh-INI0000VOMM-2024-07.csv data/noaa/ghcnh-AEI0000OMDB-2024-01.csv data/noaa/ghcnh-AEI0000OMDB-2024-07.csv data/noaa/ghcnh-SNI0000WSSS-2024-01.csv data/noaa/ghcnh-SNI0000WSSS-2024-07.csv data/noaa/ghcnh-UKI0000EGLL-2024-01.csv data/noaa/ghcnh-UKI0000EGLL-2024-07.csv
```

The script records each input hash and result. Its synthetic cases run in memory and never use the station gateway.
