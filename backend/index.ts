import express, { type RequestHandler } from "express";
import { createServer } from "http";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";
import { STATIONS } from "../shared/stations.js";
import { installAuth } from "./auth.js";
import { loadProjectEnv } from "./local-env.js";
import { parse } from "csv-parse/sync";
import { validateObservation, loadValidationLimits, type Observation, type ObservationEvent, type SourceMode, type StoredRow } from "./observations.js";
import { createStorage, type Storage, type IngestDisposition, type ScoredObservation, type NotificationPolicy } from "./storage.js";
import { IngestionScheduler } from "./ingestion-scheduler.js";
import { EmailWorker, loadEmailConfig, sendTestEmail } from "./email-notifications.js";
import { NoaaReferenceFeed } from "./noaa-reference.js";
import { ImdReferenceFeed, imdReferenceConfig } from "./imd-reference.js";
import { recommendationFor } from "./anomaly-guidance.js";
import { DeviceCredentialStore, isLocalDeviceRequest } from "./device-credentials.js";
import { stationFreshness } from "./station-freshness.js";
import { sustainedSignals } from "./sustained-monitoring.js";

/**
 * SkyGuard backend
 *
 * Data source order:
 *   1. Open-Meteo (current + 7 days of hourly context) for development/demo.
 *   2. Local replay data if the network source is unavailable.
 * IMD AWS data, when configured, is a separate read-only reference.
 *
 * The anomaly detector is a small dependency-free Isolation Forest implementation
 * so the Node/TypeScript backend can run without a Python service.
 */

type EventClassification = "regional_weather" | "localized_anomaly" | "mixed";
type Color = "green" | "amber" | "red";
type Status = "Healthy" | "Warning" | "Critical";


type FeatureVector = number[];

type ApiStation = Observation & {
  state: string;
  region: string;
  status: Status;
  health: number;
  anomaly_score: number;
  confidence: null;
  color: Color;
  deviations: { temperature: number; humidity: number; pressure: number };
  affected: string[];
  explanation: string;
  suspected_cause: string;
  recommended_action: string;
  detector_evidence: {
    model_version: string;
    warning_threshold: number;
    critical_threshold: number;
    baseline_samples: number | null;
    baseline_center: { temperature: number; humidity: number; pressure: number } | null;
    previous: { timestamp: string; temperature: number; humidity: number; pressure: number } | null;
  };
};

type WeatherEvent = {
  classification: EventClassification;
  label: string;
  confidence: null;
  evidence: string;
  affected_stations: string[];
};

type DetectorConfig = {
  warning_score: number;
  critical_score: number;
  regional_fraction: number;
};

type RealtimePayload = {
  source: SourceMode;
  source_label: string;
  source_stale: boolean;
  last_sync: string;
  stations: ApiStation[];
  anomalies: number;
  model: { name: string; version: string; method: string };
  weather_event: WeatherEvent;
  detector_config: DetectorConfig;
  data_quality: { valid: number; expected: number; missing: number; duplicate: number; invalid: number };
};

type TrainingProfile = {
  mean: number[];
  std: number[];
  robustCenter: number[];
  robustSigma: number[];
  forest: IsolationForest;
  samples: number;
};


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadProjectEnv(path.resolve(__dirname, ".."));
const emailConfig = loadEmailConfig();
const port = Number(process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001));
const imdConfig = imdReferenceConfig(process.env);
const cacheTtlMs = Number(process.env.REALTIME_CACHE_TTL_MS || 5 * 60_000);
const runtimeDirectory = process.env.SKYGUARD_DATA_DIR ? path.resolve(process.env.SKYGUARD_DATA_DIR) : path.resolve(__dirname, "..", "data", "runtime");
let storage: Storage;
const validationLimits = loadValidationLimits();

let detectorConfig: DetectorConfig = {
  warning_score: clamp(Number(process.env.ANOMALY_WARNING_THRESHOLD || 0.32), 0.05, 0.95),
  critical_score: clamp(Number(process.env.ANOMALY_CRITICAL_THRESHOLD || 0.62), 0.10, 0.99),
  regional_fraction: clamp(Number(process.env.WEATHER_EVENT_REGIONAL_FRACTION || 0.5), 0.2, 1),
};
let cache: { expiresAt: number; payload: RealtimePayload } | null = null;
let pendingPayload: Promise<RealtimePayload> | null = null;
let configRevision = 0;
let lastGoodOpenMeteo: Observation[] | null = null;
let lastGoodOpenMeteoAt: string | null = null;
let profiles = new Map<string, TrainingProfile>();
let hourlyEstimates = new Map<string, Observation[]>();
let stationSubmissionQueue: Promise<void> = Promise.resolve();
const lastSustainedReview = new Map<string, number>();
let stationScoringStatus = { last_attempt: null as string | null, last_error: null as string | null, pending: 0, pending_truncated: false };
const noaaReference = new NoaaReferenceFeed();
const imdReference = imdConfig ? new ImdReferenceFeed(imdConfig) : null;

const replayObservations: Observation[] = STATIONS.map((station, index) => ({
  station_id: station.station_id,
  station_name: station.station_name,
  latitude: station.latitude,
  longitude: station.longitude,
  temperature: Number((24 + ((index * 7) % 130) / 10).toFixed(1)),
  humidity: 45 + ((index * 13) % 45),
  pressure: Number((1002 + ((index * 11) % 80) / 10).toFixed(1)),
  timestamp: new Date().toISOString(),
}));

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback = NaN): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[], center: number) {
  return median(values.map((value) => Math.abs(value - center)));
}

function standardize(rows: FeatureVector[]) {
  const width = rows[0]?.length ?? 0;
  const mean = Array.from({ length: width }, (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length);
  const std = Array.from({ length: width }, (_, j) => {
    const variance = rows.reduce((sum, row) => sum + (row[j] - mean[j]) ** 2, 0) / Math.max(1, rows.length - 1);
    return Math.max(variance ** 0.5, 1e-6);
  });
  return { mean, std };
}

function applyStandardize(row: FeatureVector, stats: { mean: number[]; std: number[] }) {
  return row.map((value, index) => (value - stats.mean[index]) / stats.std[index]);
}

function observationFeatureRows(observations: Observation[]): FeatureVector[] {
  const sorted = [...observations].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return sorted.map((row, index) => {
    const previous = sorted[Math.max(0, index - 1)];
    return [
      row.temperature,
      row.humidity,
      row.pressure,
      index === 0 ? 0 : row.temperature - previous.temperature,
      index === 0 ? 0 : row.humidity - previous.humidity,
      index === 0 ? 0 : row.pressure - previous.pressure,
    ];
  });
}

function currentFeatures(current: Observation, history: Observation[]) {
  const sorted = [...history].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const previous = sorted[sorted.length - 1];
  return [
    current.temperature,
    current.humidity,
    current.pressure,
    previous ? current.temperature - previous.temperature : 0,
    previous ? current.humidity - previous.humidity : 0,
    previous ? current.pressure - previous.pressure : 0,
  ];
}

// --- Dependency-free Isolation Forest -------------------------------------
// This follows the standard random isolation-tree idea: observations that are
// easy to isolate have shorter average path lengths and therefore higher scores.

class IsolationTree {
  constructor(
    private readonly leaf: boolean,
    private readonly size: number,
    private readonly feature = -1,
    private readonly split = 0,
    private readonly left: IsolationTree | null = null,
    private readonly right: IsolationTree | null = null,
  ) {}

  static build(rows: FeatureVector[], depth: number, maxDepth: number, random: () => number): IsolationTree {
    if (depth >= maxDepth || rows.length <= 1) return new IsolationTree(true, rows.length);
    const featureCount = rows[0].length;
    const feature = Math.floor(random() * featureCount);
    const values = rows.map((row) => row[feature]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return new IsolationTree(true, rows.length);
    const split = min + random() * (max - min);
    const leftRows = rows.filter((row) => row[feature] < split);
    const rightRows = rows.filter((row) => row[feature] >= split);
    if (!leftRows.length || !rightRows.length) return new IsolationTree(true, rows.length);
    return new IsolationTree(false, rows.length, feature, split, IsolationTree.build(leftRows, depth + 1, maxDepth, random), IsolationTree.build(rightRows, depth + 1, maxDepth, random));
  }

  pathLength(row: FeatureVector, depth = 0): number {
    if (this.leaf) return depth + averagePathLength(this.size);
    return row[this.feature] < this.split ? this.left!.pathLength(row, depth + 1) : this.right!.pathLength(row, depth + 1);
  }
}

class IsolationForest {
  private trees: IsolationTree[] = [];
  private sampleSize: number;

  constructor(rows: FeatureVector[], treeCount = 64, sampleSize = 128, seed = 42) {
    this.sampleSize = Math.min(sampleSize, rows.length);
    const random = seededRandom(seed);
    const maxDepth = Math.ceil(Math.log2(Math.max(2, this.sampleSize)));
    for (let i = 0; i < treeCount; i++) {
      const sample = randomSample(rows, this.sampleSize, random);
      this.trees.push(IsolationTree.build(sample, 0, maxDepth, random));
    }
  }

  score(row: FeatureVector) {
    if (!this.trees.length) return 0.5;
    const averagePath = this.trees.reduce((sum, tree) => sum + tree.pathLength(row), 0) / this.trees.length;
    return 2 ** (-averagePath / averagePathLength(this.sampleSize));
  }
}

function averagePathLength(n: number) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const harmonic = Math.log(n - 1) + 0.5772156649;
  return 2 * harmonic - (2 * (n - 1)) / n;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomSample<T>(items: T[], count: number, random: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildProfile(history: Observation[]): TrainingProfile | null {
  const rows = observationFeatureRows(history).filter((row) => row.every(Number.isFinite));
  if (rows.length < 24) return null;
  const stats = standardize(rows);
  const robustCenter = Array.from({ length: rows[0].length }, (_, j) => median(rows.map((row) => row[j])));
  const robustSigma = Array.from({ length: rows[0].length }, (_, j) => Math.max(mad(rows.map((row) => row[j]), robustCenter[j]) * 1.4826, 1e-3));
  return { mean: stats.mean, std: stats.std, robustCenter, robustSigma, forest: new IsolationForest(rows.map((row) => applyStandardize(row, stats))), samples: rows.length };
}

function getDeviation(value: number, values: number[]) {
  const center = median(values);
  const robustSigma = Math.max(mad(values, center) * 1.4826, 0.1);
  return (value - center) / robustSigma;
}

function scoreObservation(source: SourceMode, observation: Observation, history: Observation[], explicitProfile?: TrainingProfile | null, config: DetectorConfig = detectorConfig): ApiStation {
  const profile = explicitProfile === undefined ? profiles.get(observation.station_id) : explicitProfile;
  const historyForStation = history.filter((row) => row.station_id === observation.station_id);
  const temperatureValues = historyForStation.map((row) => row.temperature).filter(Number.isFinite);
  const humidityValues = historyForStation.map((row) => row.humidity).filter(Number.isFinite);
  const pressureValues = historyForStation.map((row) => row.pressure).filter(Number.isFinite);

  const vector = currentFeatures(observation, historyForStation);
  const rawIsolation = profile ? profile.forest.score(applyStandardize(vector, { mean: profile.mean, std: profile.std })) : 0.5;

  const deviations = profile
    ? {
        temperature: (observation.temperature - profile.robustCenter[0]) / profile.robustSigma[0],
        humidity: (observation.humidity - profile.robustCenter[1]) / profile.robustSigma[1],
        pressure: (observation.pressure - profile.robustCenter[2]) / profile.robustSigma[2],
      }
    : {
        temperature: temperatureValues.length ? getDeviation(observation.temperature, temperatureValues) : 0,
        humidity: humidityValues.length ? getDeviation(observation.humidity, humidityValues) : 0,
        pressure: pressureValues.length ? getDeviation(observation.pressure, pressureValues) : 0,
      };

  // Isolation Forest scores depend on the size/shape of the training sample.
  // Blend the forest score with robust multivariate deviation so the dashboard
  // remains stable during the first few hours of a new station.
  const zSignal = clamp(
    (Math.abs(deviations.temperature) / 4 + Math.abs(deviations.humidity) / 4 + Math.abs(deviations.pressure) / 3) / 3,
    0,
    1,
  );
  const isolationSignal = clamp((rawIsolation - 0.35) / 0.5, 0, 1);
  const anomalyScore = Number(clamp(profile ? isolationSignal * 0.7 + zSignal * 0.3 : zSignal, 0.01, 0.99).toFixed(2));
  const status: Status = anomalyScore >= config.critical_score ? "Critical" : anomalyScore >= config.warning_score ? "Warning" : "Healthy";
  const health = Math.round(100 - anomalyScore * 65);
  const affected = [
    Math.abs(deviations.temperature) >= 2 ? "temperature" : "",
    Math.abs(deviations.humidity) >= 2 ? "humidity" : "",
    Math.abs(deviations.pressure) >= 2 ? "pressure" : "",
  ].filter(Boolean);

  const strongest = [
    ["temperature", Math.abs(deviations.temperature)],
    ["humidity", Math.abs(deviations.humidity)],
    ["pressure", Math.abs(deviations.pressure)],
  ].sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];

  let explanation = "No anomaly was flagged for this observation; sensor condition has not been verified.";
  let suspectedCause = "Cause not determined";
  if (status === "Warning") {
    explanation = `The observation exceeded the warning threshold. Its largest baseline deviation is ${strongest}; review the reading and its context.`;
    suspectedCause = "Cause not determined";
  }
  if (status === "Critical") {
    explanation = `The observation exceeded the critical threshold. Its largest baseline deviation is ${strongest}. This is not proof of a sensor fault.`;
    suspectedCause = "Cause not determined";
  }

  const locationMeta = STATIONS.find((station) => station.station_id === observation.station_id);
  const previous = [...historyForStation].filter(row => Date.parse(row.timestamp) < Date.parse(observation.timestamp)).sort((a,b) => Date.parse(b.timestamp)-Date.parse(a.timestamp))[0];
  return {
    ...observation,
    state: locationMeta?.state ?? "Unknown",
    region: locationMeta?.region ?? "Unknown",
    status,
    health: clamp(health, 20, 100),
    anomaly_score: anomalyScore,
    // No probability has been calibrated against labeled sensor faults.
    confidence: null,
    color: status === "Critical" ? "red" : status === "Warning" ? "amber" : "green",
    deviations: {
      temperature: Number(deviations.temperature.toFixed(1)),
      humidity: Number(deviations.humidity.toFixed(1)),
      pressure: Number(deviations.pressure.toFixed(1)),
    },
    affected,
    explanation,
    suspected_cause: suspectedCause,
    recommended_action: recommendationFor(source, status, String(strongest)),
    detector_evidence: {
      model_version: "v1.0.0", warning_threshold: config.warning_score, critical_threshold: config.critical_score,
      baseline_samples: profile?.samples ?? null,
      baseline_center: profile ? { temperature: profile.robustCenter[0], humidity: profile.robustCenter[1], pressure: profile.robustCenter[2] } : null,
      previous: previous ? { timestamp: previous.timestamp, temperature: previous.temperature, humidity: previous.humidity, pressure: previous.pressure } : null,
    },
  };
}

function normaliseObservation(raw: Record<string, unknown>): Observation | null {
  return validateObservation(raw, { source: "open-meteo", allowFuture: true, limits: validationLimits }).observation;
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", ...headers } });
    if (!response.ok) throw new Error(`Weather source responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function getOpenMeteoLocations() {
  const configured = process.env.OPEN_METEO_LOCATIONS_JSON;
  if (configured) {
    try {
      const parsed = JSON.parse(configured);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      console.warn("OPEN_METEO_LOCATIONS_JSON is invalid; using bundled 100-station network.", error);
    }
  }
  return STATIONS;
}

async function fetchOpenMeteoObservations(events: ObservationEvent[]): Promise<Observation[]> {
  const locations = getOpenMeteoLocations();
  const rows: Observation[] = [];
  // Publish new profiles only when every requested batch succeeds.
  const nextProfiles = new Map(profiles);
  const nextHourlyEstimates = new Map<string, Observation[]>();
  const batchSize = 20;
  for (let offset = 0; offset < locations.length; offset += batchSize) {
    const batch = locations.slice(offset, offset + batchSize);
    const query = new URLSearchParams({
      latitude: batch.map((location: any) => location.latitude).join(","),
      longitude: batch.map((location: any) => location.longitude).join(","),
      current: "temperature_2m,relative_humidity_2m,surface_pressure",
      hourly: "temperature_2m,relative_humidity_2m,surface_pressure",
      past_days: "7",
      forecast_days: "1",
      timezone: "Asia/Kolkata",
    });
    const body = await fetchJson(`https://api.open-meteo.com/v1/forecast?${query.toString()}`);
    const items = Array.isArray(body) ? body : [body];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const base = batch[index];
      if (!base) continue;
      const current = item?.current ?? {};
      const candidate = validateObservation({
        station_id: base.station_id, station_name: base.station_name,
        latitude: item?.latitude ?? base.latitude, longitude: item?.longitude ?? base.longitude,
        temperature: current.temperature_2m, humidity: current.relative_humidity_2m,
        pressure: current.surface_pressure, timestamp: current.time, original_current: current,
      }, { source: "open-meteo", limits: validationLimits });
      events.push(candidate);
      if (candidate.observation) rows.push(candidate.observation);

      const hourly = item?.hourly;
      if (hourly?.time?.length) {
        const history: Observation[] = [];
        for (let i = 0; i < hourly.time.length; i++) {
          const hourlyObservation = normaliseObservation({
            station_id: base.station_id, station_name: base.station_name,
            latitude: base.latitude, longitude: base.longitude,
            temperature: hourly.temperature_2m?.[i], humidity: hourly.relative_humidity_2m?.[i],
            pressure: hourly.surface_pressure?.[i], timestamp: hourly.time[i],
          });
          if (hourlyObservation && Date.parse(hourlyObservation.timestamp) <= Date.now()) history.push(hourlyObservation);
        }
        const profile = buildProfile(history);
        if (profile) nextProfiles.set(base.station_id, profile);
        nextHourlyEstimates.set(base.station_id, history);
      }
    }
  }
  if (!rows.length) throw new Error("Open-Meteo returned no valid observations");
  profiles = nextProfiles;
  hourlyEstimates = nextHourlyEstimates;
  lastGoodOpenMeteo = rows;
  lastGoodOpenMeteoAt = new Date().toISOString();
  return rows;
}


function haversineKm(a: Observation, b: Observation) {
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function classifyWeatherEvent(stations: ApiStation[]): WeatherEvent {
  const affected = stations.filter((station) => station.status !== "Healthy");
  const critical = stations.filter((station) => station.status === "Critical");
  if (!affected.length) {
    return { classification: "mixed", label: "No network anomalies flagged", confidence: null, evidence: "No station currently exceeds the configured anomaly threshold. This does not establish that sensors are fault-free.", affected_stations: [] };
  }

  let supported = 0;
  for (const station of affected) {
    const nearby = stations.filter((candidate) => candidate.station_id !== station.station_id && haversineKm(station, candidate) <= 250);
    const peers = nearby.filter((candidate) => candidate.status !== "Healthy");
    if (peers.length >= 1) supported++;
  }
  const spatialAgreement = affected.length ? supported / affected.length : 0;
  const regional = affected.length >= Math.max(2, Math.ceil(stations.length * detectorConfig.regional_fraction)) && spatialAgreement >= 0.4;

  if (regional) {
    return {
      classification: "regional_weather",
      label: "Regional pattern needs review",
      confidence: null,
      evidence: `${affected.length} of ${stations.length} stations exceed the threshold and ${Math.round(spatialAgreement * 100)}% of affected stations have nearby anomalies. Compare independent observations before determining the cause.`,
      affected_stations: affected.map((station) => station.station_id),
    };
  }

  if (critical.length) {
    return {
      classification: "localized_anomaly",
      label: "Localized anomaly needs review",
      confidence: null,
      evidence: `${critical.length} station${critical.length > 1 ? "s" : ""} exceed the critical threshold without broad spatial agreement. Compare nearby observations and investigate possible data or equipment issues.`,
      affected_stations: critical.map((station) => station.station_id),
    };
  }

  return {
    classification: "mixed",
    label: "Localized deviation needs review",
    confidence: null,
    evidence: `${affected.length} station${affected.length > 1 ? "s" : ""} exceed the warning threshold, but the network does not yet show enough spatial agreement for a regional-event call.`,
    affected_stations: affected.map((station) => station.station_id),
  };
}

function createReplayObservations(events: ObservationEvent[]): Observation[] {
  const candidates = replayObservations.map((item) => validateObservation({ ...item, timestamp: new Date().toISOString() }, { source: "replay", limits: validationLimits }));
  events.push(...candidates);
  return candidates.flatMap((event) => event.observation ? [event.observation] : []);
}

async function buildPayload(background = false): Promise<RealtimePayload> {
  let observations: Observation[];
  const events: ObservationEvent[] = [];
  let sourceStale = false;
  let usedCachedSource = false;
  let source: SourceMode = "open-meteo";
  try {
    if (process.env.SKYGUARD_SOURCE_MODE === "replay") {
      source = "replay";
      observations = createReplayObservations(events);
    } else {
      observations = await fetchOpenMeteoObservations(events);
    }
  } catch (error) {
    console.warn("Primary weather source unavailable:", error instanceof Error ? error.message : error);
    if (lastGoodOpenMeteo?.length) {
      observations = lastGoodOpenMeteo.map((row) => ({ ...row }));
      source = "open-meteo";
      sourceStale = true;
      usedCachedSource = true;
      // A failed multi-batch fetch must not ingest a partial, different batch
      // while reporting the last complete batch as the displayed source.
      events.length = 0;
    } else if (background && process.env.SKYGUARD_SOURCE_MODE !== "replay") {
      // Preserve invalid source responses without inventing fresh demo readings on outages.
      if (events.length) await storage.ingest(events);
      throw new Error("Weather source unavailable for background collection");
    } else {
      source = "replay";
      observations = createReplayObservations(events);
    }
  }

  const sourceAgeMinutes = Number(process.env.SKYGUARD_SOURCE_MAX_AGE_MINUTES ?? 30);
  if (source !== "replay" && Number.isFinite(sourceAgeMinutes) && sourceAgeMinutes > 0 && observations.length && observations.every((observation) => Date.now() - Date.parse(observation.timestamp) > sourceAgeMinutes * 60000)) sourceStale = true;

  // Use only earlier observations from the same source when scoring this batch.
  const recentHistory = await storage.history({ hours: 168, source, limit: 100000 });
  const enriched = observations.map((observation) => ({ ...scoreObservation(source, observation, recentHistory.filter((row) => Date.parse(row.timestamp) < Date.parse(observation.timestamp))), observation_stale: sourceStale || (source !== "replay" && Number.isFinite(sourceAgeMinutes) && sourceAgeMinutes > 0 && Date.now() - Date.parse(observation.timestamp) > sourceAgeMinutes * 60000) }));
  const quality = await storage.ingest(events);
  await storage.recordResults(source, enriched.map((row) => ({ ...row, model_version: "v1.0.0", detector_settings: detectorConfig })));

  return {
    source,
    source_label: source === "open-meteo" ? (usedCachedSource ? "Open-Meteo (cached)" : sourceStale ? "Open-Meteo (stale)" : "Open-Meteo") : "Replay fallback",
    source_stale: sourceStale,
    last_sync: sourceStale && lastGoodOpenMeteoAt ? lastGoodOpenMeteoAt : new Date().toISOString(),
    stations: enriched,
    anomalies: enriched.filter((station) => station.status === "Critical").length,
    model: {
      name: "SkyGuard anomaly detector",
      version: "v1.0.0",
      method: "Isolation Forest + robust station baseline + spatial consistency",
    },
    weather_event: classifyWeatherEvent(enriched),
    detector_config: detectorConfig,
    data_quality: {
      valid: observations.length,
      expected: getOpenMeteoLocations().length,
      missing: Math.max(0, getOpenMeteoLocations().length - observations.length),
      duplicate: quality.duplicate,
      invalid: quality.invalid,
    },
  };
}

async function getPayload(forceRefresh = false, background = false) {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.payload;
  if (!pendingPayload) {
    const revision = configRevision;
    pendingPayload = buildPayload(background).then((payload) => { if (revision === configRevision) cache = { expiresAt: Date.now() + cacheTtlMs, payload }; return payload; }).finally(() => { pendingPayload = null; });
  }
  return pendingPayload;
}

class CsvInputError extends Error {}

async function processStationObservations(events: ObservationEvent[]) {
  const details: { dispositions: IngestDisposition[] } = { dispositions: [] };
  const quality = await storage.ingest(events, details);
  const detection = await processPendingStationObservations();
  return { quality, detection };
}

async function processPendingStationObservations() {
  const detection = { status: "complete" as "complete" | "pending" | "failed", scored: 0, flagged: 0, insufficient: 0, stale_or_superseded: 0, pending: 0, pending_truncated: false };
  stationScoringStatus.last_attempt = new Date().toISOString();
  try {
    const sourceAge = Number(process.env.SKYGUARD_SOURCE_MAX_AGE_MINUTES ?? 30);
    const maxAge = Number.isFinite(sourceAge) && sourceAge > 0 ? sourceAge : 30;
    const config = { ...detectorConfig };
    const notificationPolicy=emailConfig ? await storage.getNotificationPolicy({recipient:emailConfig.recipient,minimum_severity:"Warning",escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2}) : undefined;
    for (const candidate of await storage.pendingStationObservations(200)) {
      // Preserve the original arrival decision across retries and restarts.
      const receivedAt = candidate.recorded_at ? Date.parse(candidate.recorded_at) : NaN;
      const fresh = Number.isFinite(receivedAt) && receivedAt - Date.parse(candidate.timestamp) <= maxAge * 60_000;
      if (!fresh) detection.stale_or_superseded++;
      const prior = await storage.historyRange({ stationId: candidate.station_id, source: "station-api", start: new Date(Date.parse(candidate.timestamp) - 168 * 3600000).toISOString(), end: candidate.timestamp, limit: 96 });
      const profile = buildProfile(prior);
      const reviewDrift = fresh && Date.parse(candidate.timestamp) - (lastSustainedReview.get(candidate.station_id) ?? 0) >= 3600_000;
      const longHistory = await storage.historyRange({stationId:candidate.station_id,source:"station-api",start:new Date(Date.parse(candidate.timestamp)-(reviewDrift ? 15*86400_000 : 2*3600_000)).toISOString(),end:candidate.timestamp,limit:reviewDrift ? 30000 : 10000});
      const sustained = sustainedSignals([...longHistory, candidate], reviewDrift);
      if (!profile && !sustained.frozen.length && !sustained.drift.length) { await storage.finishStationObservation(candidate.station_id, candidate.timestamp, "insufficient"); detection.insufficient++; continue; }
      const result: ScoredObservation = { ...scoreObservation("station-api", candidate, prior, profile, config), confidence: null, model_version: "v1.0.0", detector_settings: config, baseline_readings: prior.length, detection_context: fresh ? "station-api fresh submission" : "station-api historical submission" };
      if (sustained.frozen.length || sustained.drift.length) {
        result.status = result.status === "Critical" ? "Critical" : "Warning";
        result.affected = Array.from(new Set([...(Array.isArray(result.affected) ? result.affected : []), ...sustained.frozen, ...sustained.drift]));
        result.sustained_review = sustained;
        result.explanation = `Review required: ${sustained.frozen.length ? `nearly unchanged ${sustained.frozen.join(", ")} readings; ` : ""}${sustained.drift.length ? `sustained change in ${sustained.drift.join(", ")}; ` : ""}these patterns can occur without a sensor fault.`;
        result.recommended_action = "Compare independent readings and inspect the station history before diagnosing a fault.";
      }
      await storage.recordResults("station-api", [result], { createIncidents: fresh, notificationPolicy });
      // PostgreSQL commits the score, incident and queue state together. File mode
      // records completion after the result and remains a single-process prototype.
      if (storage.kind === "file") await storage.finishStationObservation(candidate.station_id, candidate.timestamp, "complete");
      if (reviewDrift) lastSustainedReview.set(candidate.station_id, Date.parse(candidate.timestamp));
      detection.scored++;
      if (result.status === "Warning" || result.status === "Critical") detection.flagged++;
    }
    const remaining = await storage.pendingStationObservations(1001);
    detection.pending = Math.min(remaining.length, 1000);
    detection.pending_truncated = remaining.length > 1000;
    if (remaining.length) detection.status = "pending";
    stationScoringStatus = { last_attempt: stationScoringStatus.last_attempt, last_error: null, pending: detection.pending, pending_truncated: detection.pending_truncated };
  } catch (error) {
    console.warn("Station scoring failed; pending readings will be retried.", error instanceof Error ? error.name : "Unknown error");
    detection.status = "failed";
    stationScoringStatus.last_error = "Scoring failed. Pending readings will be retried; check the backend logs and storage.";
  }
  return detection;
}

async function analyzeCsv(content: string) {
  const analysisConfig = { ...detectorConfig };
  let parsed: string[][];
  try { parsed = parse(content, { skip_empty_lines: true, bom: true, relax_column_count: true }); } catch { throw new CsvInputError("The CSV file could not be parsed. Check its formatting."); }
  if (parsed.length < 2) throw new CsvInputError("CSV must contain a header and at least one data row");
  const headers = parsed[0].map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new CsvInputError("CSV column names must be unique.");
  const aliases: Record<string, string[]> = { timestamp: ["timestamp", "time", "datetime", "date_time"], station_id: ["station_id", "station", "stationid", "call_sign"], temperature: ["temperature", "temp", "curr_temp", "temperature_c", "temperature_celsius"], pressure: ["pressure", "mslp", "surface_pressure", "pressure_hpa"], humidity: ["humidity", "rh", "relative_humidity", "humidity_percent", "relative_humidity_percent"] };
  const keys = Object.fromEntries(Object.entries(aliases).map(([field,names]) => [field, headers.find((header) => names.includes(header))]));
  const missing = Object.keys(aliases).filter((field) => !keys[field]);
  if (missing.length) throw new CsvInputError(`Missing required columns: ${missing.join(", ")}`);
  const rows = parsed.slice(1).map((values) => { const row: Record<string, unknown> = {}; headers.forEach((header,index) => { row[header] = values[index] ?? null; }); if (values.length > headers.length) row.__extra_columns = values.slice(headers.length); return row; });
  const events = rows.map((row) => {
    const canonical: Record<string, unknown> = { ...row };
    for (const [field,key] of Object.entries(keys)) canonical[field] = row[key!];
    const event = validateObservation(canonical, { source: "uploaded", allowMissingCoordinates: true, limits: validationLimits, knownStations: new Set(STATIONS.map((station) => station.station_id)) });
    event.raw = row; return event;
  });
  const observations = events.flatMap((event) => event.observation ? [event.observation] : []);
  const errors = events.flatMap((event,index) => event.observation ? [] : [`Row ${index + 2}: ${event.issues.map((issue) => issue.message).join(" ")}`]);
  // Duplicated timestamps in a file must not count as independent baseline readings.
  const unique = new Map<string, Observation>();
  for (const row of observations) {
    const key = `${row.station_id}\0${row.timestamp}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  if (unique.size > 5000) throw new CsvInputError("This analysis supports at most 5,000 unique station timestamps per file. Split larger files into smaller date ranges.");
  const summary = await storage.ingest(events);
  const byStation = new Map<string, Observation[]>();
  for (const row of Array.from(unique.values())) byStation.set(row.station_id, [...(byStation.get(row.station_id) ?? []), row]);
  const results: Array<Omit<ApiStation, "status" | "anomaly_score" | "health" | "confidence"> & { status: Status | "Insufficient data"; anomaly_score: number | null; health: number | null; confidence: null; readings_count: number; baseline_readings: number; baseline_available: boolean }> = [];
  const series: Array<{ station_id: string; timestamp: string; anomaly_score: number | null; status: Status | "Insufficient data"; temperature: number; pressure: number; humidity: number }> = [];
  let scoredCount = 0, warningCount = 0, criticalCount = 0;
  for (const stationRows of Array.from(byStation.values())) {
    const sorted = [...stationRows].sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let profile: TrainingProfile | null = null;
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index];
      const prior = sorted.slice(Math.max(0, index - 96), index);
      // Refit periodically from strictly earlier readings; never train on future rows.
      if (index >= 24 && (index === 24 || (index - 24) % 24 === 0)) profile = buildProfile(prior);
      const scored = profile ? scoreObservation("uploaded", row, prior, profile, analysisConfig) : null;
      if (scored) { scoredCount++; if (scored.status === "Warning") warningCount++; if (scored.status === "Critical") criticalCount++; }
      series.push({ station_id: row.station_id, timestamp: row.timestamp, anomaly_score: scored?.anomaly_score ?? null, status: scored?.status ?? "Insufficient data", temperature: row.temperature, pressure: row.pressure, humidity: row.humidity });
      if (index === sorted.length - 1) {
        const latest = scored ?? scoreObservation("uploaded", row, prior, null, analysisConfig);
        results.push({ ...latest, status: scored?.status ?? "Insufficient data", anomaly_score: scored?.anomaly_score ?? null, health: scored?.health ?? null, confidence: null, explanation: scored?.explanation ?? "At least 24 earlier unique readings are needed to build a station baseline.", suspected_cause: scored?.suspected_cause ?? "Insufficient history", recommended_action: scored?.recommended_action ?? "Provide more historical readings before interpreting the station status.", readings_count: sorted.length, baseline_readings: prior.length, baseline_available: scored !== null });
      }
      if (index > 0 && index % 64 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const timestamps = Array.from(unique.values(), (row) => row.timestamp).sort();
  return { rows: observations.length, unique_observations: unique.size, period: timestamps.length ? { start: timestamps[0], end: timestamps[timestamps.length - 1] } : null, stations: results, series, historical_summary: { scored: scoredCount, insufficient: unique.size - scoredCount, warning: warningCount, critical: criticalCount, baseline_window: 96, refit_interval: 24, minimum_history: 24 }, thresholds: analysisConfig, errors, quality: summary, model: "Isolation Forest + rolling robust station baseline" };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  if (process.env.SKYGUARD_TRUST_PROXY === "1") app.set("trust proxy", 1);
  storage = await createStorage({ directory: runtimeDirectory, schemaPath: path.resolve(__dirname, "schema.sql"), databaseUrl: process.env.DATABASE_URL, limits: validationLimits });
  await storage.seedStations(STATIONS);
  detectorConfig = await storage.getSettings(detectorConfig);
  if (![detectorConfig.warning_score, detectorConfig.critical_score, detectorConfig.regional_fraction].every(Number.isFinite) || detectorConfig.warning_score >= detectorConfig.critical_score || detectorConfig.warning_score < 0.05 || detectorConfig.critical_score > 0.99 || detectorConfig.regional_fraction < 0.2 || detectorConfig.regional_fraction > 1) throw new Error("Stored detector settings are invalid; restore a valid settings backup before starting.");
  console.log(`SkyGuard storage: ${storage.kind}`);
  app.use(express.json({ limit: "12mb" }));
  // Process readiness only; does not expose configuration, accounts or source data.
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  const handleStationObservations: RequestHandler = async (req, res) => {
    const rows = req.body?.observations;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100 || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return res.status(400).json({ error: "Provide an observations array containing 1 to 100 JSON objects." });
    if (rows.some((row) => Buffer.byteLength(JSON.stringify(row), "utf8") > 16_384)) return res.status(400).json({ error: "Each observation must be no larger than 16 KB." });
    const recordedAt = new Date().toISOString();
    const knownStations = new Set(STATIONS.map((station) => station.station_id));
    const events = rows.map((raw: Record<string, unknown>) => {
      const event = validateObservation(raw, { source: "station-api", recordedAt, limits: validationLimits, knownStations });
      const additional: Array<{ code: string; field: string; message: string }> = [];
      for (const field of ["station_id", "timestamp", "latitude", "longitude", "temperature", "pressure", "humidity"] as const) {
        if (!Object.prototype.hasOwnProperty.call(raw, field)) additional.push({ code: "required_field", field, message: `${field} must be provided explicitly.` });
      }
      if (typeof raw.station_id !== "string" || !raw.station_id.trim() || raw.station_id.length > 128) additional.push({ code: "invalid_station_id", field: "station_id", message: "station_id must be a nonempty string of at most 128 characters." });
      if (typeof raw.timestamp !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw.timestamp)) additional.push({ code: "timezone_required", field: "timestamp", message: "timestamp must include Z or an explicit UTC offset." });
      if (raw.pressure_type !== "station") additional.push({ code: "pressure_type_required", field: "pressure_type", message: "pressure_type must be 'station' for station-level pressure." });
      if (additional.length) { event.issues.push(...additional); event.observation = null; }
      return event;
    });
    try {
      // Serialize in-process submissions so their baseline and duplicate decisions remain consistent.
      const job = stationSubmissionQueue.then(() => processStationObservations(events));
      stationSubmissionQueue = job.then(() => undefined, () => undefined);
      const { quality, detection } = await job;
      try { await storage.auditEvent(res.locals.user?.id ?? `device:${res.locals.device.id}`, "station_observations.submitted", { source: "station-api", ...quality, detection }); } catch { console.warn("Station observation audit recording failed."); }
      res.json({ source: "station-api", received: rows.length, quality, detection, invalid: events.flatMap((event, index) => event.observation ? [] : [{ index, issues: event.issues }]), description: "Queued readings are scored in observation order when a baseline is available. Fresh flagged readings create incidents; failed scoring is retried." });
    } catch { res.status(500).json({ error: "Unable to store station observations." }); }
  };

  const credentials = new DeviceCredentialStore(path.join(runtimeDirectory, "device-credentials.json"));
  // Device credentials cannot access user-session routes. This local-only
  // endpoint is registered before the browser-session authentication guard.
  let deviceAttempts = { count: 0, reset: Date.now() + 60_000 };
  app.post("/api/device/observations", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLocalDeviceRequest(req)) return res.status(403).json({ error: "Device ingestion is available only on this computer." });
    if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Cross-site requests are not allowed." });
    if (!req.is("application/json")) return res.status(415).json({ error: "Requests must use JSON." });
    if (Date.now() >= deviceAttempts.reset) deviceAttempts = { count: 0, reset: Date.now() + 60_000 };
    if (++deviceAttempts.count > 120) return res.status(429).json({ error: "Too many device requests. Try again later." });
    const bearer = /^Bearer (\S+)$/i.exec(req.get("authorization") ?? "");
    try {
      const credential = bearer ? await credentials.authenticate(bearer[1]) : null;
      if (!credential) return res.status(401).json({ error: "Invalid or expired device credential." });
      const rows = req.body?.observations;
      if (Array.isArray(rows) && rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) || row.station_id !== credential.station_id)) return res.status(403).json({ error: "A device may submit readings only for its assigned station." });
      res.locals.device = credential;
      return handleStationObservations(req, res, next);
    } catch { return res.status(500).json({ error: "Unable to verify device credentials." }); }
  });

  const auth = await installAuth(app, path.join(runtimeDirectory, "users.json"), (actor, action, details) => storage.auditEvent(actor, action, details));

  const credentialAdmin: RequestHandler = (req, res, next) => {
    if (res.locals.user.role !== "administrator") return res.status(403).json({ error: "Administrator access required." });
    if (!isLocalDeviceRequest(req)) return res.status(403).json({ error: "Device credentials can be managed only on this computer." });
    next();
  };
  app.get("/api/device-credentials", credentialAdmin, async (_req, res) => {
    try { res.json({ credentials: await credentials.list() }); } catch { res.status(500).json({ error: "Unable to load device credentials." }); }
  });
  app.post("/api/device-credentials", credentialAdmin, async (req, res) => {
    const { station_id: stationId, label, expires_in_days: days } = req.body ?? {};
    if (typeof stationId !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(stationId) || typeof label !== "string" || !label.trim() || label.length > 80 || /[\x00-\x1f\x7f]/.test(label) || !Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: "Provide a valid station ID, label, and expiry of 1 to 365 days." });
    try {
      const created = await credentials.create(stationId, label.trim(), days);
      try { await storage.auditEvent(res.locals.user.id, "device_credential.created", { id: created.credential.id, station_id: stationId, expires_at: created.credential.expires_at }); } catch { console.warn("Device credential audit recording failed."); }
      res.status(201).json(created);
    } catch { res.status(500).json({ error: "Unable to create device credential." }); }
  });
  app.post("/api/device-credentials/:id/revoke", credentialAdmin, async (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(400).json({ error: "Invalid credential ID." });
    try {
      if (!(await credentials.revoke(req.params.id))) return res.status(404).json({ error: "Credential not found or already revoked." });
      try { await storage.auditEvent(res.locals.user.id, "device_credential.revoked", { id: req.params.id }); } catch { console.warn("Device credential audit recording failed."); }
      res.json({ ok: true });
    } catch { res.status(500).json({ error: "Unable to revoke device credential." }); }
  });
  app.post("/api/device-credentials/:id/monitoring", credentialAdmin, async (req, res) => {
    const minutes = req.body?.expected_interval_minutes;
    if (!/^[a-f0-9]{24}$/.test(req.params.id) || !(minutes === null || (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440))) return res.status(400).json({ error: "Use an interval between 1 and 1,440 minutes, or null to disable monitoring." });
    try {
      const updated = await credentials.setMonitoring(req.params.id, minutes);
      if (!updated) return res.status(404).json({ error: "Active credential not found." });
      try { await storage.auditEvent(res.locals.user.id, "device_credential.monitoring_updated", { id: updated.id, station_id: updated.station_id, expected_interval_minutes: minutes }); } catch { console.warn("Device monitoring audit recording failed."); }
      res.json({ credential: updated });
    } catch { res.status(500).json({ error: "Unable to update station monitoring." }); }
  });
  async function stationFreshnessSnapshot() {
      const now = Date.now(), intervals = new Map<string, { minutes: number; startedAt: string | null }>();
      for (const credential of await credentials.list()) {
        const interval = credential.expected_interval_minutes;
        if (credential.revoked_at || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now || typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 1440) continue;
        const existing = intervals.get(credential.station_id);
        const startedAt = credential.monitoring_started_at && Number.isFinite(Date.parse(credential.monitoring_started_at)) ? credential.monitoring_started_at : null;
        if (!existing || interval < existing.minutes) intervals.set(credential.station_id, { minutes: interval, startedAt });
        else if (interval === existing.minutes) {
          const earliest = existing.startedAt && startedAt ? (Date.parse(existing.startedAt) <= Date.parse(startedAt) ? existing.startedAt : startedAt) : existing.startedAt ?? startedAt;
          intervals.set(credential.station_id, { minutes: interval, startedAt: earliest });
        }
      }
      const activities = await storage.stationActivity(Array.from(intervals.keys()));
      const stations = Array.from(intervals).map(([station_id, config]) => {
        const activity = activities.find(item => item.station_id === station_id);
        return { station_id, expected_interval_minutes: config.minutes, monitoring_started_at: config.startedAt, status: stationFreshness(config.minutes, activity, now, config.startedAt), last_received_at: activity?.last_received_at ?? null, last_observed_at: activity?.last_observed_at ?? null };
      });
      return { stations, generated_at: new Date(now).toISOString(), description: "Station-level data arrival only; it does not verify the identity or condition of a physical device." };
  }
  let arrivalMonitorStatus = { last_completed: null as string | null, last_error: null as string | null };
  app.get("/api/station-freshness", async (_req, res) => {
    try {
      res.json({ ...await stationFreshnessSnapshot(), monitor: arrivalMonitorStatus });
    } catch { res.status(500).json({ error: "Unable to load station freshness." }); }
  });

  const configuredInterval = Number(process.env.SKYGUARD_INGEST_INTERVAL_MINUTES ?? 15);
  if (!Number.isFinite(configuredInterval) || configuredInterval < 1 || configuredInterval > 1440) throw new Error("SKYGUARD_INGEST_INTERVAL_MINUTES must be between 1 and 1440.");
  const scheduler = new IngestionScheduler(configuredInterval * 60_000, () => getPayload(true, true));
  const emailWorker = emailConfig ? new EmailWorker(storage, emailConfig) : null;
  let arrivalMonitorRunning = false;
  const monitorStationArrival = async () => {
    if (arrivalMonitorRunning) return;
    arrivalMonitorRunning = true;
    try {
      const { stations } = await stationFreshnessSnapshot();
      const policy = emailConfig ? await storage.getNotificationPolicy({recipient:emailConfig.recipient,minimum_severity:"Warning",escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2}) : undefined;
      await storage.resetUnmonitoredArrival(stations.map(station=>station.station_id));
      for (const station of stations) {
        const details = { explanation: station.status === "stale" ? "Station data is stale. This is a data-arrival warning, not proof of a device fault." : "No recent data received from the station. This is a data-arrival warning, not proof of a device fault.", recommended_action: "Check the station, connection and data pipeline.", ...station };
        await storage.updateStationArrival(station.station_id, station.status === "disconnected" || station.status === "stale", details, policy);
      }
      arrivalMonitorStatus = { last_completed: new Date().toISOString(), last_error: null };
    } catch (error) { arrivalMonitorStatus.last_error = "Data-arrival alert monitoring failed; the backend will retry."; console.warn("Station arrival monitoring failed; it will retry.", error instanceof Error ? error.name : "Unknown error"); }
    finally { arrivalMonitorRunning = false; }
  };
  let scoringScheduled = false;
  const retryStationScoring = () => {
    if (scoringScheduled) return;
    scoringScheduled = true;
    const job = stationSubmissionQueue.then(() => processPendingStationObservations());
    stationSubmissionQueue = job.then(() => undefined, () => undefined).finally(() => { scoringScheduled = false; });
  };
  let scoringTimer: ReturnType<typeof setInterval> | null = null;
  let arrivalTimer: ReturnType<typeof setInterval> | null = null;
  app.get("/api/ingestion/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(scheduler.getStatus());
  });
  app.get("/api/station-scoring/status", async (_req, res) => {
    try {
      const pending = await storage.pendingStationObservations(1001);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...stationScoringStatus, pending: Math.min(pending.length,1000), pending_truncated: pending.length > 1000, retry_interval_seconds: 30 });
    } catch { res.status(503).json({ error: "Unable to inspect the station scoring queue." }); }
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const payload = await getPayload();
      res.json({ ok: true, backend: "online", source: payload.source, source_stale: payload.source_stale, imd_configured: Boolean(imdReference), last_sync: payload.last_sync, stations: payload.stations.length, model: payload.model, weather_event: payload.weather_event.classification });
    } catch (error) {
      res.status(502).json({ ok: false, backend: "online", error: error instanceof Error ? error.message : "Weather source unavailable" });
    }
  });

  app.get("/api/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(detectorConfig);
  });

  app.post("/api/config", async (req, res) => {
    const body = req.body ?? {};
    const next = {
      warning_score: clamp(Number(body.warning_score ?? detectorConfig.warning_score), 0.05, 0.95),
      critical_score: clamp(Number(body.critical_score ?? detectorConfig.critical_score), 0.1, 0.99),
      regional_fraction: clamp(Number(body.regional_fraction ?? detectorConfig.regional_fraction), 0.2, 1),
    };
    if (![next.warning_score, next.critical_score, next.regional_fraction].every(Number.isFinite)) return res.status(400).json({ ok: false, error: "Detector values must be numeric" });
    if (next.critical_score <= next.warning_score) return res.status(400).json({ ok: false, error: "critical_score must be greater than warning_score" });
    try {
      await storage.setSettings(next, res.locals.user.id);
      detectorConfig = next;
      configRevision++;
      cache = null;
      res.json({ ok: true, detector_config: detectorConfig });
    } catch { res.status(500).json({ ok: false, error: "Unable to save detector settings." }); }
  });

  app.post("/api/station-observations", handleStationObservations);

  app.get("/api/station-observations/monitor", async (_req, res) => {
    try {
      const maxRows = 20_000;
      const rows = await storage.history({ hours: 168, source: "station-api", limit: maxRows + 1 });
      const truncated = rows.length > maxRows;
      const recent = truncated ? rows.slice(-maxRows) : rows;
      const stations = new Map<string, StoredRow[]>();
      for (const row of recent) {
        const group = stations.get(row.station_id) ?? [];
        group.push(row); stations.set(row.station_id, group);
      }
      const configuredAge = Number(process.env.SKYGUARD_SOURCE_MAX_AGE_MINUTES ?? 30);
      const staleAfterMinutes = Number.isFinite(configuredAge) && configuredAge > 0 ? configuredAge : 30;
      const config = { ...detectorConfig };
      const monitored = Array.from(stations.values(), (group) => {
        const latest = group[group.length - 1];
        const prior = group.slice(Math.max(0, group.length - 97), -1);
        const profile = buildProfile(prior);
        const scored = profile ? scoreObservation("station-api", latest, prior, profile, config) : null;
        return { station_id: latest.station_id, station_name: latest.station_name, timestamp: latest.timestamp, received_at: latest.recorded_at, latitude: latest.latitude, longitude: latest.longitude, temperature: latest.temperature, humidity: latest.humidity, pressure: latest.pressure, stale: Date.now() - Date.parse(latest.timestamp) > staleAfterMinutes * 60_000, baseline_readings: prior.length, anomaly_score: scored?.anomaly_score ?? null, status: scored?.status ?? "Insufficient data", explanation: scored?.explanation ?? "At least 24 earlier valid readings from this station are needed for a baseline." };
      }).sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      const recentEvents = (await storage.alertHistory(undefined, "station-api")).slice(0, 10).map((event: any) => ({ id: event.id ?? null, source: event.source, station_id: event.station_id, station_name: event.details?.station_name ?? event.station_id, timestamp: event.opened_at, severity: event.severity, anomaly_score: event.details?.anomaly_score ?? null, explanation: event.details?.explanation ?? "Explanation not recorded; review the original observation and independent evidence.", details: event.details && typeof event.details === "object" ? {...event.details,confidence:null} : {} }));
      res.json({ source: "station-api", observed_window_hours: 168, stale_after_minutes: staleAfterMinutes, truncated, stations: monitored, recent_events: recentEvents, generated_at: new Date().toISOString(), description: "Station identity is not verified. Detection snapshots are historical observations; associated incidents can be reviewed separately." });
    } catch { res.status(500).json({ error: "Unable to load submitted station readings." }); }
  });

  app.get("/api/station-incidents", async (_req, res) => {
    try { res.json({ incidents: await storage.incidents(), description: "Station API incidents require manual review and resolution; stale data does not automatically resolve an incident." }); }
    catch { res.status(500).json({ error: "Unable to load station incidents." }); }
  });
  app.get("/api/reference-station", async (_req, res) => {
    try { res.json({ source: "NOAA Aviation Weather Center METAR", observation: await noaaReference.get(), description: "Public airport observation; altimeter setting is not station-level pressure. This reference is not used for incident detection." }); }
    catch { res.status(502).json({ error: "NOAA reference station is unavailable. Please try again later." }); }
  });
  app.get("/api/imd-reference", async (_req, res) => {
    if (!imdReference) return res.json({ configured: false, observation: null });
    try { res.json({ configured: true, observation: await imdReference.get() }); }
    catch { res.status(502).json({ configured: true, error: "IMD reference unavailable. Check access and station configuration." }); }
  });
  app.get("/api/evaluation/chennai", async (_req, res) => {
    try {
      const projectRoot = path.resolve(__dirname, "..");
      const [reportText, dataset] = await Promise.all([
        fs.readFile(path.join(projectRoot, "reports", "chennai-detector-diagnostics.json"), "utf8"),
        fs.readFile(path.join(projectRoot, "data", "noaa", "chennai-ghcnh-january-2024.csv")),
      ]);
      const report = JSON.parse(reportText);
      if (report.dataset !== "chennai-ghcnh-january-2024.csv" || report.sha256 !== createHash("sha256").update(dataset).digest("hex") || !Array.isArray(report.utc_hour_breakdown) || !report.historical_summary || report.labeled_evaluation !== null) return res.status(503).json({ error: "The saved evaluation is missing or does not match the dataset." });
      res.json({ report, description: "Offline, unlabeled NOAA sample; not a measure of confirmed sensor-fault accuracy." });
    } catch { res.status(503).json({ error: "The saved evaluation is unavailable." }); }
  });
  app.get("/api/notification-status", async (_req, res) => {
    try { res.json({ email_enabled: emailConfig !== null, queue: await storage.notificationCounts() }); }
    catch { res.status(500).json({ error: "Unable to load notification status." }); }
  });
  app.get("/api/notification-policy", async (_req,res) => {
    if(res.locals.user.role !== "administrator") return res.status(403).json({error:"Administrator access required."});
    try { const policy=await storage.getNotificationPolicy({recipient:emailConfig?.recipient ?? "",minimum_severity:"Warning",escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2}); res.json({email_enabled:!!emailConfig,policy}); }
    catch { res.status(500).json({error:"Unable to load notification settings."}); }
  });
  let lastTestEmailAt = 0;
  app.post("/api/notification-test", async (_req,res) => {
    if(res.locals.user.role !== "administrator") return res.status(403).json({error:"Administrator access required."});
    if (!emailConfig) return res.status(503).json({error:"Email delivery is not configured."});
    if (Date.now() - lastTestEmailAt < 60_000) return res.status(429).json({error:"Wait one minute before sending another test email."});
    lastTestEmailAt = Date.now();
    try {
      const policy=await storage.getNotificationPolicy({recipient:emailConfig.recipient,minimum_severity:"Warning",escalation_recipient:"",escalation_delay_minutes:60,max_attempts:3,retry_delay_minutes:2});
      await sendTestEmail(emailConfig,policy.recipient);
      try { await storage.auditEvent(res.locals.user.id,"notification.test_sent",{}); } catch { console.warn("Unable to record notification test audit."); }
      res.json({ok:true,message:"The email provider accepted the test message. Check the recipient's inbox."});
    } catch { res.status(502).json({error:"The email provider did not accept the test message. Check the provider configuration and sending permissions."}); }
  });
  app.put("/api/notification-policy", async (req,res) => {
    if(res.locals.user.role !== "administrator") return res.status(403).json({error:"Administrator access required."});
    const {recipient,minimum_severity,escalation_recipient,escalation_delay_minutes,max_attempts,retry_delay_minutes}=req.body ?? {};
    const validAddress=(value:unknown)=>typeof value === "string" && value.length <= 254 && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
    if(!validAddress(recipient) || !["Warning","Critical"].includes(minimum_severity) || !(escalation_recipient === "" || validAddress(escalation_recipient)) || !Number.isInteger(escalation_delay_minutes) || escalation_delay_minutes<5 || escalation_delay_minutes>10080 || !Number.isInteger(max_attempts) || max_attempts<1 || max_attempts>10 || !Number.isInteger(retry_delay_minutes) || retry_delay_minutes<1 || retry_delay_minutes>1440) return res.status(400).json({error:"Provide valid recipients, severity, escalation delay (5–10080 minutes), attempts (1–10), and retry delay (1–1440 minutes)."});
    try { const policy:NotificationPolicy={recipient,minimum_severity,escalation_recipient,escalation_delay_minutes,max_attempts,retry_delay_minutes}; await storage.setNotificationPolicy(policy,res.locals.user.id); res.json({policy}); }
    catch { res.status(500).json({error:"Unable to save notification settings."}); }
  });
  app.get("/api/station-incidents/:id/actions", async (req, res) => {
    if (req.params.id.length > 64) return res.status(400).json({ error: "Invalid incident ID." });
    try { res.json({ actions: await storage.incidentActions(req.params.id) }); }
    catch { res.status(500).json({ error: "Unable to load incident history." }); }
  });
  app.post("/api/station-incidents/:id/assign", async (req,res) => {
    const assigneeId=req.body?.assignee_id;
    if(req.params.id.length>64 || (assigneeId !== null && (typeof assigneeId !== "string" || !/^[a-f0-9]{32}$/.test(assigneeId)))) return res.status(400).json({error:"Choose an active team member or clear the assignment."});
    try { const assignee=assigneeId === null ? null : await auth.getActiveAssignee(assigneeId);
      if(assigneeId !== null && !assignee) return res.status(400).json({error:"That team member is unavailable."});
      const result=await storage.assignIncident(req.params.id,assignee,res.locals.user.id);
      if(result.error === "not_found") return res.status(404).json({error:"Incident not found."});
      if(result.error === "conflict") return res.status(409).json({error:"Resolved incidents cannot be reassigned."});
      res.json({incident:result.incident});
    } catch { res.status(500).json({error:"Unable to assign the incident."}); }
  });
  app.post("/api/station-incidents/:id/:action", async (req, res) => {
    const action = req.params.action;
    const note = req.body?.note ?? "";
    const outcome = req.body?.outcome;
    if (req.params.id.length > 64 || !["acknowledge", "investigate", "resolve"].includes(action) || typeof note !== "string" || note.length > 1000 || (outcome !== undefined && (action !== "resolve" || !["sensor_fault", "weather_event", "false_alarm", "undetermined"].includes(outcome)))) return res.status(400).json({ error: "Invalid incident action, note, or outcome." });
    if (action === "resolve" && outcome && outcome !== "undetermined" && !note.trim()) return res.status(400).json({ error: "Add a review note explaining the selected outcome." });
    try {
      const result=await storage.transitionIncident(req.params.id, action as "acknowledge" | "investigate" | "resolve", res.locals.user.id, note.trim(), { actorName: res.locals.user.username, outcome });
      if (result.error === "not_found") return res.status(404).json({ error: "Incident not found." });
      if (result.error === "conflict") return res.status(409).json({ error: "Incident state changed; refresh and try again." });
      res.json({ incident: result.incident });
    } catch { res.status(500).json({ error: "Unable to update the incident." }); }
  });

  const validAnalyticsDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const analyticsSources = ["live", "station-api", "open-meteo", "replay", "uploaded", "legacy-unknown"];
  const analyticsOffset = (value: unknown) => value === undefined ? 0 : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : NaN;

  app.get("/api/analytics/history", async (req, res) => {
    const { start, end, source, station_id: stationId } = req.query;
    const offset = analyticsOffset(req.query.offset);
    if (!validAnalyticsDate(start) || !validAnalyticsDate(end) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 366 * 86400_000 || typeof source !== "string" || !analyticsSources.includes(source) || !Number.isSafeInteger(offset) || (stationId !== undefined && (typeof stationId !== "string" || stationId.length > 128))) return res.status(400).json({ error: "Provide a valid UTC date range up to 366 days, one supported source and a valid page offset." });
    try {
      const limit = 5000;
      const rows = await storage.historyRange({ start, end, source: source as SourceMode, stationId: stationId || undefined, limit: limit + 1, offset });
      res.setHeader("Cache-Control", "no-store");
      res.json({ readings: rows.slice(-limit), truncated: rows.length > limit, has_older: rows.length > limit, offset, limit, start, end, source });
    } catch { res.status(500).json({ error: "Unable to load historical observations." }); }
  });

  app.get("/api/analytics/incidents", async (req, res) => {
    const { start, end, source, station_id: stationId, severity, status, sensor } = req.query;
    const offset = analyticsOffset(req.query.offset);
    if (!validAnalyticsDate(start) || !validAnalyticsDate(end) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 366 * 86400_000 || typeof source !== "string" || !analyticsSources.includes(source) || !Number.isSafeInteger(offset) || (stationId !== undefined && (typeof stationId !== "string" || stationId.length > 128)) || (severity !== undefined && severity !== "Warning" && severity !== "Critical") || (status !== undefined && status !== "open" && status !== "acknowledged" && status !== "investigating" && status !== "resolved") || (sensor !== undefined && sensor !== "temperature" && sensor !== "humidity" && sensor !== "pressure")) return res.status(400).json({ error: "Invalid incident filters or date range." });
    try {
      const limit = 50;
      const result = await storage.incidentAnalytics({ start, end, source: source as SourceMode, stationId: stationId || undefined, severity: severity as "Warning" | "Critical" | undefined, status: status as "open" | "acknowledged" | "investigating" | "resolved" | undefined, sensor: sensor as "temperature" | "humidity" | "pressure" | undefined, offset, limit });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...result, offset, limit, has_older: offset + result.incidents.length < result.total });
    } catch { res.status(500).json({ error: "Unable to load incident history." }); }
  });

  app.get("/api/analytics/alerts", async (req, res) => {
    const { start, end, source, station_id: stationId, severity, sensor } = req.query;
    const offset = analyticsOffset(req.query.offset);
    if (!validAnalyticsDate(start) || !validAnalyticsDate(end) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 366 * 86400_000 || typeof source !== "string" || !analyticsSources.includes(source) || !Number.isSafeInteger(offset) || (stationId !== undefined && (typeof stationId !== "string" || stationId.length > 128)) || (severity !== undefined && severity !== "Warning" && severity !== "Critical") || (sensor !== undefined && sensor !== "temperature" && sensor !== "humidity" && sensor !== "pressure")) return res.status(400).json({ error: "Invalid alert filters or date range." });
    try {
      const limit = 50;
      const result = await storage.alertAnalytics({ start, end, source: source as SourceMode, stationId: stationId || undefined, severity: severity as "Warning" | "Critical" | undefined, sensor: sensor as "temperature" | "humidity" | "pressure" | undefined, offset, limit });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...result, alerts: result.alerts.map(alert => ({...alert,details:alert.details && typeof alert.details === "object" ? {...alert.details,confidence:null} : {}})), offset, limit, has_older: offset + result.alerts.length < result.total });
    } catch { res.status(500).json({ error: "Unable to load alert history." }); }
  });

  app.get("/api/weather-trends", async (req, res) => {
    const stationId = typeof req.query.station_id === "string" ? req.query.station_id : "";
    const hours = Number(req.query.hours);
    if (!stationId || stationId.length > 128 || !Number.isFinite(hours) || hours <= 0 || hours > 168) return res.status(400).json({ error: "Invalid station or time range." });
    try {
      const current = (lastGoodOpenMeteo ?? []).find(item => item.station_id === stationId);
      // Show the latest complete 15-minute interval. The clock-based window can
      // be empty while a 15-minute upstream update is still being collected.
      const rangeEnd = hours === .25 && current ? Date.parse(current.timestamp) : Date.now();
      const cutoff = rangeEnd - hours * 3600000;
      const recorded = current ? await storage.historyRange({ stationId, source: "open-meteo", start: new Date(cutoff).toISOString(), end: new Date(rangeEnd + 1).toISOString(), limit: 1000 }) : [];
      const readings = [...recorded, ...(hourlyEstimates.get(stationId) ?? []), ...(current ? [current] : [])]
        .filter(item => Date.parse(item.timestamp) >= cutoff && Date.parse(item.timestamp) <= rangeEnd);
      const unique = Array.from(new Map(readings.map(item => [item.timestamp, item])).values()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      res.setHeader("Cache-Control", "no-store");
      res.json({ source: "open-meteo", description: "Model-based estimates; not physical station observations.", last_sync: lastGoodOpenMeteoAt, range_end: hours === .25 && current ? current.timestamp : null, readings: unique });
    } catch { res.status(500).json({ error: "Unable to load weather trends." }); }
  });

  app.get("/api/history", async (req, res) => {
    const requestedHours = Number(req.query.hours || 24);
    if (!Number.isFinite(requestedHours) || requestedHours <= 0) return res.status(400).json({ error: "Hours must be a positive number." });
    const hours = clamp(requestedHours, 1, 168);
    const stationId = typeof req.query.station_id === "string" ? req.query.station_id : undefined;
    res.setHeader("Cache-Control", "no-store");
    if (req.query.source !== undefined && (typeof req.query.source !== "string" || !["live", "station-api", "open-meteo", "replay", "uploaded", "legacy-unknown"].includes(req.query.source))) return res.status(400).json({ error: "Unknown observation source." });
    const source = req.query.source as SourceMode | undefined;
    try {
      const limit = 2000;
      const rows = await storage.history({ stationId, hours, source, limit: limit + 1 });
      res.json({ station_id: stationId ?? "all", hours, source: source ?? "all", readings: rows.slice(-limit), truncated: rows.length > limit, limit });
    } catch { res.status(500).json({ error: "Unable to read observation history." }); }
  });

  app.get("/api/alert-history", async (req, res) => {
    const stationId = typeof req.query.station_id === "string" ? req.query.station_id : undefined;
    try {
      const alerts = (await storage.alertHistory(stationId)).map((alert) => ({
        ...alert,
        details: alert.details && typeof alert.details === "object" && !Array.isArray(alert.details)
          ? { ...alert.details, confidence: null }
          : alert.details,
      }));
      res.json({ alerts, description: "Historical detected observations. An anomaly does not confirm a sensor fault." });
    } catch { res.status(500).json({ error: "Unable to read alert history." }); }
  });

  app.get("/api/quality-events", async (req, res) => {
    const requested = Number(req.query.limit ?? 50);
    if (!Number.isInteger(requested) || requested < 1 || requested > 200) return res.status(400).json({ error: "Limit must be an integer between 1 and 200." });
    try { res.json({ events: await storage.qualityEvents(requested), validation_limits: validationLimits }); } catch { res.status(500).json({ error: "Unable to read quality events." }); }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const content = typeof req.body?.csv === "string" ? req.body.csv : "";
      if (!content) return res.status(400).json({ ok: false, error: "Send CSV content in the 'csv' field" });
      res.json({ ok: true, ...(await analyzeCsv(content)) });
    } catch (error) {
      if (error instanceof CsvInputError) res.status(400).json({ ok: false, error: error.message });
      else { console.error("Dataset analysis storage failed.", error); res.status(500).json({ ok: false, error: "Unable to complete analysis. Check database availability." }); }
    }
  });

  app.get("/api/realtime", async (_req, res) => {
    try {
      const payload = await getPayload();
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (error) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Realtime source unavailable" });
    }
  });

  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  server.listen(port, () => {
    console.log(`SkyGuard API + frontend server running on http://localhost:${port}/`);
    if (process.env.SKYGUARD_BACKGROUND_INGESTION !== "0") scheduler.start();
    retryStationScoring();
    scoringTimer = setInterval(retryStationScoring, 30_000); scoringTimer.unref();
    void monitorStationArrival();
    arrivalTimer = setInterval(() => void monitorStationArrival(), 60_000); arrivalTimer.unref();
    emailWorker?.start();
  });
  server.on("close", () => { scheduler.stop(); emailWorker?.stop(); if (scoringTimer) clearInterval(scoringTimer); if (arrivalTimer) clearInterval(arrivalTimer); });
}

startServer().catch((error) => { console.error(error); process.exit(1); });
