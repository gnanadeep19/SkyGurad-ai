export type StationActivity = { station_id: string; last_received_at: string | null; last_observed_at: string | null };
export type FreshnessStatus = "awaiting_readings" | "receiving" | "stale" | "disconnected";

/** A receipt indicates data arrival, not proof of a connected physical device. */
export function stationFreshness(intervalMinutes: number, activity: StationActivity | undefined, now = Date.now(), monitoringStartedAt?: string | null): FreshnessStatus {
  const received = activity?.last_received_at ? Date.parse(activity.last_received_at) : NaN;
  const observed = activity?.last_observed_at ? Date.parse(activity.last_observed_at) : NaN;
  if (!Number.isFinite(received)) {
    const started = monitoringStartedAt ? Date.parse(monitoringStartedAt) : NaN;
    return Number.isFinite(started) && now - started > intervalMinutes * 3 * 60_000 ? "disconnected" : "awaiting_readings";
  }
  if (now - received > intervalMinutes * 3 * 60_000) return "disconnected";
  if (!Number.isFinite(observed) || now - received > intervalMinutes * 2 * 60_000 || now - observed > intervalMinutes * 2 * 60_000) return "stale";
  return "receiving";
}
