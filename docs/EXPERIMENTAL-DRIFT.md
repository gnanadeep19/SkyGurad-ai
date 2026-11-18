# Experimental sustained-change review

The historical analysis and demonstration below remain exploratory. The same sustained-change rule is now also used as a review signal for fresh station submissions, at most once per station per hour; such a signal can create a Warning incident and, when configured, email. It cannot diagnose sensor faults. A gradual change may be normal weather, a change in exposure, a data issue or sensor behavior. Confirming a sensor problem requires independent evidence.

## Where to find it

- **Analytics → Explore sensor drift** shows a fully synthetic 15-day series. Choose a variable and select **Simulate gradual change** to apply a linear ramp over the final 24 hours. The display is computed locally in the browser; no modified readings are stored or sent to the backend.
- **Analyze dataset** shows an experimental sustained-change review for the selected station's latest 24 hours after a historical CSV is analyzed. This uses the validated, deduplicated rows returned for that upload. The existing anomaly analysis and upload-storage behavior remain unchanged; the additional drift review itself does not write data or generate alerts.

## Rule

For each reading in the latest 24-hour window, subtract the median of the same UTC-hour values from earlier days within the preceding 14 days. At least seven earlier days for each hour, six recent readings spanning at least 18 hours, no gap longer than six hours, and at least three readings in each half of the window are required. Duplicate timestamps, mixed stations and invalid readings produce insufficient history. The method uses only earlier dates for each baseline and does not interpolate missing values. UTC-hour matching assumes stable observation timing; time-zone changes and unusual reporting schedules can make this unsuitable.

Compare the median residual in the first and second halves. A review is raised when the absolute difference is at least 1 °C, 5 humidity percentage points or 2 hPa, respectively, and at least 70% of cross-half residual pairs agree with the direction. These thresholds are exploratory choices for the demonstration, not calibrated operating limits. An isolated spike is not normally enough to move a half-window median, but other patterns can still trigger the rule.

The Chennai February 2024 sample has no verified sensor-fault labels; its humidity is derived from temperature and dew point. In one reproducible test, its original latest temperature window did not meet the rule and the same window with a synthetic +4 °C ramp did. This is a controlled illustration, not a performance measurement. Synthetic and weather-driven changes can look similar, and the two half-window medians do not measure the full injected ramp amplitude.

Run `npx vitest run --root . frontend/src/lib/drift.test.ts frontend/src/lib/drift-noaa.test.ts` to check the synthetic cases and the saved NOAA sample. See [dataset provenance](../data/noaa/README.md) and [detector evaluation](DETECTOR-EVALUATION.md).

The [multi-station drift review](../reports/drift-review-multistation-2024.md) evaluates rising and falling ramps at predetermined windows across four stations and several months. It records skipped out-of-range cases and unmodified control flags separately; it is not a field-accuracy evaluation.
