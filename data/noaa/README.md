# NOAA historical station sample

`chennai-ghcnh-january-2024.csv` contains 248 historical records for Chennai International Airport, GHCN station `INI0000VOMM`, from 2024-01-01 00:00 UTC through 2024-01-31 21:00 UTC. These are real historical station observations, not SkyGuard live sensor readings and not a labeled sensor-fault dataset.

Source: NOAA NCEI, Global Historical Climatology Network hourly (GHCNh), version 1; [dataset information](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly), [original 2024 station PSV](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2024/psv/GHCNh_INI0000VOMM_2024.psv), and [NOAA field and quality-code documentation](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf). Downloaded 2026-11-12. NOAA can revise its files; the downloaded source's SHA-256 was `05443a3a5b671eac8d1445e161262388300700e5dc3f31d8658597f5ac46384d`.

## Preparation and quality

- The original year-long PSV is preserved locally in this directory. Original PSV downloads and the station inventory are ignored by Git because of their size; retain them separately if sharing the project. Four additional downloaded station files are retained as source material and are not included in the sample.
- The source contained 1,488 January rows. Of these, 248 included all three required variables; the remaining 1,240 were excluded because at least one was missing. No gap filling was performed. The selected rows are approximately three-hourly, although the underlying archive contains more frequent reports.
- Temperature is in degrees Celsius. `pressure` is **station-level pressure** in hPa, not sea-level pressure. `humidity` is relative humidity in percent. NOAA marks every humidity value in this sample with measurement code `D`: it is derived from air temperature and dew point, not an independent humidity-sensor measurement.
- The temperature and pressure quality codes are `1` (good for source 223); the derived humidity quality code is blank. Source codes, report types, and quality/measurement codes are retained as extra CSV columns. A blank humidity quality flag does not independently validate the derived value. NOAA's source-specific quality codes must not be generalized to other data sources.
- `scripts/prepare-noaa-sample.mjs` reproduces the selection from the original PSV, verifies unique station timestamps, writes explicit UTC timestamps, and refuses to overwrite an existing output file. It retains only source 223, temperature/pressure code 1, humidity code D without a humidity QC flag, complete values, and SkyGuard's broad screening ranges.

## Use in SkyGuard

Sign in, open **Analyze dataset**, choose **Choose CSV file**, select `chennai-ghcnh-january-2024.csv`, then close the upload dialog to review the analysis. The upload is stored as `uploaded` data, separate from the live/replay dashboard. The real NOAA station identifier is intentionally not mapped to the example `AWS-*` station directory; SkyGuard may mark it as an unknown station. Historical readings from 2024 will not appear in the recent 24-hour charts. The report scores each unique observation after an initial 24-reading warm-up using only earlier observations; up to 96 previous readings form the baseline, and the model is refitted every 24 readings. These results do not establish sensor-fault ground truth. The report is held in the current browser session, although accepted readings remain stored; historical analysis does not create active alerts. Uploads are limited to 5,000 unique station timestamps to keep local analysis responsive.

To recreate the file from the saved PSV, first move or rename the existing sample, then run `node scripts/prepare-noaa-sample.mjs` from the project directory. The script does not download data and will not overwrite the existing CSV.

## February 2024 comparison sample

`chennai-ghcnh-2024-02.csv` was prepared from the same saved NOAA source file with the same complete-value, source-code, quality-code, and measurement-code filters. Of 1,386 February source rows, 230 were included and 1,156 excluded. It covers 1 February 00:00 UTC through 29 February 21:00 UTC. Humidity remains derived, not independently measured. Its SHA-256 is `cc35b0c5dcb9e171f839e13aa7c3ac621d7653cfa24dc6fd43f2eac8c9f76209`. To reproduce it without overwriting an existing file, run `node scripts/prepare-noaa-sample.mjs 2024-02 <new-output-path>`.

## Additional station and seasonal subsets

Seven `ghcnh-<station>-<month>.csv` files contain Chennai July, Singapore Changi January/July, Dubai January/July, and London Heathrow January/July 2024. They use the same documented source 223 and quality selections; humidity is derived and its quality code is blank. The [provenance manifest](../../reports/noaa-comparison-provenance.json) records NOAA URLs, original and output hashes, periods, and included/excluded row counts. The original large PSV files are ignored locally. The samples contain no verified sensor-fault labels. The offline [comparison report](../../reports/multistation-controlled-evaluation.md) explains how they were used.
