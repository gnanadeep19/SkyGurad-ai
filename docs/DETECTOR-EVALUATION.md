# Historical detector evaluation

Run the current detector in an isolated temporary backend with:

```powershell
node scripts/evaluate-detector.mjs data/noaa/chennai-ghcnh-january-2024.csv
```

To save a new report without overwriting an existing file, add a new output path as the second argument. The script disables background ingestion and email, uses temporary file storage, and removes it after the run. It scores each observation using only earlier observations, with a minimum of 24 prior readings and a rolling baseline of up to 96 readings. This is a temporal replay, not an independent field validation. Thresholds and the dataset hash are recorded in the report.

## Chennai sample result

The saved [evaluation report](../reports/chennai-detector-evaluation.json) covers 248 Chennai airport observations from January 2024. The first 24 did not have enough prior readings; 224 were scored. At the recorded thresholds, 69 were flagged as warnings and none as critical: 30.8% of scored observations were flagged. This is a **flag rate**, not an error rate or a count of faulty sensors. The sample has no verified sensor-fault labels, so precision, recall, and false-positive rate cannot be established.

NOAA's humidity values in this sample are derived from temperature and dew point, not independent humidity-sensor measurements. The sample also excludes records missing any required field. See [sample provenance and limitations](../data/noaa/README.md) before interpreting the result. Observed flag frequency alone is not sufficient reason to change thresholds.

The [diagnostic breakdown](../reports/chennai-detector-diagnostics.json), also shown on the Analytics page, groups scored readings by UTC observation hour. At 06:00 and 09:00 UTC, 24 of 28 and 23 of 28 observations were flagged, respectively; at 18:00 and 21:00 UTC, none of the 28 observations at either hour were flagged. The sample's selected observations are three hours apart. This concentration suggests that time of day is worth investigating, but the unlabelled data does not establish whether the flags are errors, normal weather, or sensor problems. More labeled, independent data and a comparison with time-of-day-aware baselines are needed before adjusting the detector.

## Evaluating verified labels

An optional `fault_label` column can contain `1` for a verified sensor-fault observation, `0` for an observation verified not to be a sensor fault, or blank for unknown. Labeled rows need a station ID and a timestamp with a UTC offset. Duplicate labeled station timestamps are rejected to avoid ambiguous matches. The report computes confusion counts, precision, recall, accuracy, F1, and per-reading false-positive rate only for labeled observations that the rolling model actually scored; the initial baseline observations and invalid rows are excluded. Undefined metrics are `null`. This historical evaluation covers the Isolation Forest and robust baseline, not the live sustained-change and arrival rules. No current result establishes accuracy on real sensor faults.

Label quality, class balance, environmental conditions, and dataset provenance determine what those figures mean. Keep a separate later time period or stations for independent validation; do not tune thresholds and then report performance on the same data as a field result.

An [experimental time-of-day comparison](../reports/chennai-time-baseline-comparison.md) replays the current detector against a same-UTC-hour robust baseline on the January sample and a later February sample from the same station. A small [synthetic spike check](../reports/chennai-synthetic-spike-check.json) changes one historical temperature reading at a time. These are exploratory tests, not measured fault accuracy; the candidate has not been deployed.

A follow-up [multi-station comparison and controlled anomaly report](../reports/multistation-controlled-evaluation.md) matches flag counts on the January Chennai development sample, then uses that fixed threshold for later Chennai data and separate Singapore, Dubai, and London station-months. It also records smaller synthetic temperature, humidity, and pressure changes and 24-hour ramps. None of these samples supplies verified fault labels, so matched flag rates and synthetic flags do not establish field accuracy.

The [expanded perturbation report](../reports/multistation-perturbations-2024.md) applies small positive and negative changes and 24-hour ramps to July observations from Chennai, Dubai and Singapore, using the same fixed threshold. The results vary with the selected station and time; the experimental method remains offline.

An independent [experimental sustained-change review](EXPERIMENTAL-DRIFT.md) is available for uploaded history, together with an interactive synthetic demonstration on Analytics. It is not used by the live detector.
