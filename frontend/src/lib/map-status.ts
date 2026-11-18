export function mapStationStatus(station: { status: string; observation_stale?: boolean }, sourceStatus: "live" | "replay" | "connecting" | "stale"): "Healthy" | "Warning" | "Critical" | "Unavailable" {
  if (sourceStatus === "connecting" || sourceStatus === "stale" || station.observation_stale || !["Healthy", "Warning", "Critical"].includes(station.status)) return "Unavailable";
  return station.status as "Healthy" | "Warning" | "Critical";
}
