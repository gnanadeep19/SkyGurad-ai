# Phase 5: model evaluation and promotion decision

**Decision: retain the current operational detector. Do not promote the experimental LSTM or autoencoder.** The models are offline experiments; this is not a claim that the existing detector has been validated against physical sensor failures.

## Comparable offline experiments

The saved reports compare the same observations within each station-month with four scores: the largest standardized one-step change (a simple rule), the existing rolling Isolation Forest plus robust baseline, an LSTM next-reading predictor, and a dense window autoencoder. Neural training uses the first 60% of that month, calibration the next 20%, and testing the final 20%. Each method uses its own 95th-percentile validation threshold. A rolling Isolation Forest is updated with earlier observations as described in the underlying reports. The split is chronological, but these station-months were previously explored and are not independent project-wide holdouts. Each month is trained and calibrated separately, so this is not a held-out-station generalization test.

Counts below refer to **flags on unmodified observations**, not false alarms; the observations have no independently verified fault labels.

| Data and test windows | Simple rule | Combined baseline | LSTM | Autoencoder |
| --- | ---: | ---: | ---: | ---: |
| Chennai, January 2024: 50 | 0 | 0 | 7 | 40 |
| Chennai, February 2024: 46 | 0 | 0 | 0 | 2 |
| Dubai, January 2024: 50 | 0 | 6 | 5 | 17 |

The corresponding full reports contain dataset hashes, dates, thresholds, training losses, and the three synthetic perturbations tested at one endpoint each: [Chennai January](../reports/phase5-neural-comparison-chennai-2024.json), [Chennai February](../reports/phase5-neural-comparison-chennai-feb-2024.json), and [Dubai January](../reports/phase5-neural-comparison-dubai-2024.json). A model can flag the unmodified control and the perturbed observation, so a flag after injection is not automatically a newly detected fault. These few artificial cases cannot establish missed-fault rates, false-alarm rates, or detection delay in the field. Some NOAA humidity values are derived from temperature and dew point rather than independently measured.

The rates vary sharply between datasets and no verified real-fault comparison establishes a benefit. The autoencoder flagged 40 of the 50 unmodified Chennai January windows; the cause and correctness of those flags are unknown. Promotion is therefore not justified. Existing operational settings and alerts remain unchanged. Synthetic sustained-change demonstrations are separate and do not diagnose sensors.

## Evaluating independently supplied labels

The offline comparison accepts an optional `fault_label` column: `1` for a verified fault observation, `0` for a verified non-fault observation, or blank for unknown. Use one station per file with the existing required UTC timestamps and temperature, humidity, and pressure columns. The script rejects duplicate timestamps, invalid labels and known positive labels in training or calibration; a blank earlier label is **unknown**, not proof the period is healthy. Missing or irregular windows are excluded. The script does not verify labels or their source.

```powershell
node scripts/compare-phase5-models.mjs path/to/one-station.csv reports/new-comparison.json
```

Use a new output filename; existing files are not overwritten. For scored test observations with labels, the output reports per-method true positives, false positives, true negatives, false negatives, precision, recall and F1. Undefined metrics are `null`. The output also reports labeled and unknown test counts. Metrics are meaningful only when the label provenance, fault definitions, temporal coverage and independence have been checked. Selecting or tuning after seeing the test set invalidates its role as an independent test.

The [new Chennai report](../reports/phase5-label-evaluation-chennai-2024.json) demonstrates the evaluation path, but it has **zero labeled test observations**. Its zero confusion counts are empty counts, not verified absence of errors; precision, recall and F1 are undefined.

## Requirements before promotion

1. Obtain independently documented, time-aligned fault and non-fault labels with station and sensor identity. Preserve unknown labels and document the source and review method.
2. Predefine representative time and station holdouts, handling of missing observations, operating conditions, and acceptance criteria before evaluation. Include weather extremes and enough fault events for uncertainty assessment.
3. Compare the same held-out cases using missed faults, false alarms per station and time, precision, recall, F1 and event-level detection delay. Check training and calibration quality; report exclusions and uncertainty.
4. Only if the evidence supports improvement, run the candidate in shadow mode with versioned model and thresholds, compare outcomes, and have a rollback plan before any operational switch.

No verified real-weather-station fault labels are provided in this repository. The data and human review needed for that validation cannot be created from model flags or synthetic perturbations. Phase 5 therefore remains incomplete under the original real-fault validation requirement.
