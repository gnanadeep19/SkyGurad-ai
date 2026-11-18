export function isUsableRealtimeResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return response.ok && contentType.includes("application/json");
}

export type WeatherSource = "live" | "open-meteo" | "replay" | null;
export type SourceStatus = "live" | "replay" | "connecting" | "stale";

/** The header describes the weather dashboard, not the separate station feed. */
export function weatherSourceBadge(source: WeatherSource, status: SourceStatus, label: string) {
  const state = status === "live" ? (source === "open-meteo" ? "Current" : "Live") : status === "connecting" ? "Connecting" : status === "stale" ? "Stale" : "Replay";
  return { label: status === "connecting" ? null : `Dashboard: ${label}`, state };
}

export function describeWeatherSource(source: WeatherSource, status: SourceStatus) {
  if (status === "connecting" || !source) return { title: "Waiting for weather data", detail: "The weather source is unavailable or still connecting.", tone: "neutral" } as const;
  const stale = status === "stale" ? " The displayed data is stale; check the observation time before using it." : "";
  if (source === "open-meteo") return { title: "Dashboard source: Open-Meteo estimates", detail: `The weather dashboard uses model-based estimates for mapped locations, not physical station measurements. They cannot establish a sensor fault. The station feed and incidents are separate.${stale}`, tone: status === "stale" ? "warning" : "info" } as const;
  if (source === "replay") return { title: "Dashboard source: replay data", detail: "The weather dashboard uses demonstration readings, not current physical station measurements. The station feed and incidents are separate.", tone: "warning" } as const;
  return { title: "Configured weather feed", detail: `Readings come from the configured external feed. Verify their origin and quality before diagnosing a sensor fault.${stale}`, tone: status === "stale" ? "warning" : "info" } as const;
}
