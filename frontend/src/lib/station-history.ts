export type StationHistoryPoint = { timestamp: number; temperature: number; humidity: number; pressure: number };

export function normalizeStationHistory(value: unknown, stationId: string): StationHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (item.station_id !== stationId || item.source !== "station-api" || typeof item.timestamp !== "string") return [];
    const timestamp = Date.parse(item.timestamp);
    if (!Number.isFinite(timestamp) || typeof item.temperature !== "number" || !Number.isFinite(item.temperature) || typeof item.humidity !== "number" || !Number.isFinite(item.humidity) || typeof item.pressure !== "number" || !Number.isFinite(item.pressure)) return [];
    return [{ timestamp, temperature: item.temperature, humidity: item.humidity, pressure: item.pressure }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}
