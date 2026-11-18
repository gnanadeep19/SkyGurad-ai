/** Canonical weather observation and validation shared by all ingestion paths. */
export type SourceMode = "live" | "station-api" | "open-meteo" | "replay" | "uploaded" | "legacy-unknown";
export type Observation = {
  station_id: string;
  station_name: string;
  latitude: number;
  longitude: number;
  temperature: number;
  humidity: number;
  pressure: number;
  timestamp: string;
};
export type StoredRow = Observation & { source: SourceMode; recorded_at: string | null };
export type ValidationIssue = { code: string; field: string; message: string; severity?: "error" | "warning" };
export type ObservationEvent = {
  source: SourceMode;
  recorded_at: string;
  raw: Record<string, unknown>;
  observation: Observation | null;
  issues: ValidationIssue[];
};
export type ValidationLimits = { temperature: [number, number]; humidity: [number, number]; pressure: [number, number] };
// Broad screening limits, not operating thresholds or a diagnosis of sensor failure.
export const DEFAULT_VALIDATION_LIMITS: ValidationLimits = { temperature: [-90, 65], humidity: [0, 100], pressure: [300, 1100] };

export function loadValidationLimits(env: NodeJS.ProcessEnv = process.env): ValidationLimits {
  const limits: ValidationLimits = { temperature: [...DEFAULT_VALIDATION_LIMITS.temperature], humidity: [...DEFAULT_VALIDATION_LIMITS.humidity], pressure: [...DEFAULT_VALIDATION_LIMITS.pressure] };
  for (const field of ["temperature", "humidity", "pressure"] as const) {
    const prefix = `SKYGUARD_${field.toUpperCase()}`;
    const min = env[`${prefix}_MIN`] === undefined ? limits[field][0] : Number(env[`${prefix}_MIN`]);
    const max = env[`${prefix}_MAX`] === undefined ? limits[field][1] : Number(env[`${prefix}_MAX`]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error(`Invalid validation limits for ${field}`);
    limits[field] = [min, max];
  }
  return limits;
}

function numberValue(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function observationTimestamp(value: unknown, dateValue?: unknown): string | null {
  let text = String(value ?? "").trim();
  if (dateValue && /^\d{1,2}:\d{2}/.test(text)) text = `${String(dateValue).slice(0, 10)}T${text.slice(0, 8)}+05:30`;
  text = text.replace(" ", "T");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null;
  if (!match[8]) text += "+05:30";
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function validateObservation(raw: Record<string, unknown>, options: { source: SourceMode; recordedAt?: string; allowMissingCoordinates?: boolean; limits?: ValidationLimits; knownStations?: Set<string>; allowFuture?: boolean }): ObservationEvent {
  const issues: ValidationIssue[] = [];
  const recorded_at = options.recordedAt ?? new Date().toISOString();
  const limits = options.limits ?? DEFAULT_VALIDATION_LIMITS;
  const stationRaw = raw.station_id ?? raw.stationId ?? raw.CALL_SIGN ?? raw.call_sign ?? raw.id ?? raw.ID ?? raw.station;
  const station_id = typeof stationRaw === "string" || typeof stationRaw === "number" ? String(stationRaw).trim() : "";
  if (!station_id) issues.push({ code: "missing_station", field: "station_id", message: "A station ID is required." });
  if (station_id && options.knownStations && !options.knownStations.has(station_id)) issues.push({ code: "unknown_station", field: "station_id", message: "The station ID is not registered.", severity: "warning" });
  const timestamp = observationTimestamp(raw.timestamp ?? raw.observed_at ?? raw.time ?? raw.TIME, raw.DATE);
  if (!timestamp) issues.push({ code: "invalid_timestamp", field: "timestamp", message: "A valid observation timestamp is required." });
  else if (!options.allowFuture && Date.parse(timestamp) > Date.parse(recorded_at) + 5 * 60_000) issues.push({ code: "future_timestamp", field: "timestamp", message: "The observation timestamp is in the future." });
  const temperature = numberValue(raw.temperature ?? raw.temp ?? raw.air_temperature ?? raw.CURR_TEMP);
  const humidity = numberValue(raw.humidity ?? raw.relative_humidity ?? raw.rh ?? raw.RH);
  const pressure = numberValue(raw.pressure ?? raw.air_pressure ?? raw.mslp ?? raw.MSLP ?? raw.surface_pressure);
  for (const [field, value, unit] of [["temperature", temperature, "°C"], ["humidity", humidity, "%"], ["pressure", pressure, "hPa"]] as const) {
    if (value == null) issues.push({ code: "missing_or_invalid", field, message: `A numeric ${field} reading is required.` });
    else if (value < limits[field][0] || value > limits[field][1]) issues.push({ code: "out_of_range", field, message: `${field} must be between ${limits[field][0]} and ${limits[field][1]} ${unit}.` });
  }
  const units: Array<[string, unknown, string[]]> = [
    ["temperature_unit", raw.temperature_unit, ["c", "°c", "celsius"]],
    ["humidity_unit", raw.humidity_unit, ["%", "percent", "percentage"]],
    ["pressure_unit", raw.pressure_unit, ["hpa"]],
  ];
  for (const [field, unit, allowed] of units) if (unit != null && !allowed.includes(String(unit).trim().toLowerCase())) issues.push({ code: "unsupported_unit", field, message: `Unsupported unit for ${field.replace("_unit", "")}.` });
  const latitude = numberValue(raw.latitude ?? raw.lat ?? raw.Latitude);
  const longitude = numberValue(raw.longitude ?? raw.lon ?? raw.lng ?? raw.Longitude);
  if (options.allowMissingCoordinates && (latitude == null || longitude == null)) issues.push({ code: "missing_coordinates", field: "location", message: "Station coordinates were not provided.", severity: "warning" });
  if ((!options.allowMissingCoordinates && (latitude == null || longitude == null)) || (latitude != null && (latitude < -90 || latitude > 90)) || (longitude != null && (longitude < -180 || longitude > 180))) issues.push({ code: "invalid_coordinates", field: "location", message: "Valid station coordinates are required." });
  const nameRaw = raw.station_name ?? raw.name ?? raw.stationName ?? raw.STATION ?? raw.station ?? station_id;
  const observation = issues.every((issue) => issue.severity === "warning") && timestamp && temperature != null && humidity != null && pressure != null ? {
    station_id, station_name: String(nameRaw), latitude: latitude ?? 0, longitude: longitude ?? 0,
    temperature, humidity, pressure, timestamp,
  } : null;
  return { source: options.source, recorded_at, raw, observation, issues };
}
