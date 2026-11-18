# Controlled perturbations across three NOAA stations

This offline experiment extends the earlier Chennai-only controlled tests to July 2024 observations from Chennai International Airport, Dubai International Airport and Singapore Changi Airport. It uses the existing time-of-day candidate threshold, fitted once on January Chennai data to approximately match the current detector's flag count. It was not retuned for these station-months. The [case-level results](multistation-perturbations-2024.json) record the dataset hashes, settings, control decisions and altered decisions.

For each station, two times were selected in advance: July 15 at 00:00 UTC and July 16 at 12:00 UTC. Six single-reading changes were replayed separately at each time. The underlying historical observations have no verified sensor-fault labels; changes are synthetic, not evidence that a sensor failed. For each method, the table counts **new flags** only when the unmodified control was not already flagged. The denominators differ because the methods flagged different controls.

| Synthetic single-reading change | Current: new flags / eligible | Experimental: new flags / eligible |
| --- | ---: | ---: |
| Temperature +1 °C | 0 / 4 | 1 / 5 |
| Temperature −1 °C | 0 / 4 | 1 / 5 |
| Humidity +5 percentage points | 0 / 4 | 0 / 5 |
| Humidity −5 percentage points | 0 / 4 | 2 / 5 |
| Station pressure +2 hPa | 1 / 4 | 0 / 5 |
| Station pressure −2 hPa | 2 / 4 | 4 / 5 |

Six observations were changed per row; ineligible controls were already flagged. Perturbations can also remove an existing flag, as the case-level data show. These small, non-random samples and unequal eligibility counts do not measure comparative recall or establish a false-positive rate.

## 24-hour synthetic ramps

For each station the first selected time was used as the start of independent +2 °C, +10 percentage point humidity and +5 hPa pressure ramps. Each ramp changes **every** subsequent reading proportionally to elapsed time through 24 hours. A 24-hour endpoint and no gaps longer than three hours were required; no readings were filled. The table gives the first altered reading with a new flag relative to the same method's control. A dash means no new flag during the changed readings, not proof that the detector missed a real fault.

| Station and synthetic ramp | Current first new flag | Experimental first new flag |
| --- | ---: | ---: |
| Chennai, temperature +2 °C | — | — |
| Chennai, humidity +10 pp | 12 h | — |
| Chennai, pressure +5 hPa | — | — |
| Dubai, temperature +2 °C | — | 21 h |
| Dubai, humidity +10 pp | 3 h | — |
| Dubai, pressure +5 hPa | 3 h | 15 h |
| Singapore, temperature +2 °C | — | 13 h |
| Singapore, humidity +10 pp | — | — |
| Singapore, pressure +5 hPa | 24 h | 14 h |

All 36 single-reading scenarios and all nine ramps completed. The results are sensitive to the selected times, weather, reporting cadence and baseline history. NOAA humidity in these samples is derived from temperature and dew point; independently perturbing one field can create an unrealistic combination. One station, month and two times per location do not represent the range of real fault behavior. See the [source provenance](noaa-comparison-provenance.json) and [earlier comparison](multistation-controlled-evaluation.md).

## Reproduce

From the project directory, choose a new output filename:

```powershell
node scripts/multistation-perturbations.mjs reports/calibrated-multistation-comparison.json reports/new-perturbations.json data/noaa/ghcnh-INI0000VOMM-2024-07.csv data/noaa/ghcnh-AEI0000OMDB-2024-07.csv data/noaa/ghcnh-SNI0000WSSS-2024-07.csv
```

The script starts isolated temporary backends, disables background collection and email, and refuses to overwrite its report. Neither the live detector nor the user's stored observations are changed. The candidate should remain offline until evaluation against independently selected, verified sensor-fault labels and broader conditions supports a change.
