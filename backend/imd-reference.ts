/** IMD AWS reference observations are never used as station-pressure telemetry. */
export type ImdReference = {
  station_id: string; station_name: string; observed_date: string; observed_time: string;
  temperature_c: number | null; humidity_percent: number | null; mean_sea_level_pressure_hpa: number | null;
  latitude: number | null; longitude: number | null; fetched_at: string;
};
type Config = { station: string; header: string; value: string };

export function imdReferenceConfig(env: NodeJS.ProcessEnv): Config | null {
  const station = env.IMD_REFERENCE_STATION?.trim() ?? "";
  const header = env.IMD_REFERENCE_AUTH_HEADER?.trim() ?? "";
  const value = env.IMD_REFERENCE_AUTH_VALUE?.trim() ?? "";
  // The API reference does not document its authentication header; the user must
  // supply the header name and full value provided by IMD, never a URL.
  if (!/^[a-z0-9_-]{1,40}$/i.test(station) || !/^(authorization|x-[a-z0-9-]+)$/i.test(header) || !value || /[\r\n]/.test(value)) return null;
  return { station, header, value };
}

function numeric(value: unknown, min: number, max: number): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export class ImdReferenceFeed {
  private cached: ImdReference | null = null;
  private pending: Promise<ImdReference> | null = null;
  constructor(private readonly config: Config, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  async get(): Promise<ImdReference> {
    if (this.cached && this.now() - Date.parse(this.cached.fetched_at) < 10 * 60_000) return this.cached;
    if (!this.pending) this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async refresh(): Promise<ImdReference> {
    const url = new URL("https://api.imd.gov.in/api/v1/aws_data");
    url.searchParams.set("id", this.config.station);
    const response = await this.fetcher(url, { headers: { Accept: "application/json", [this.config.header]: this.config.value }, redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("IMD request failed");
    const payload: unknown = await response.json();
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const candidates = Array.isArray(payload) ? payload : Array.isArray(root.data) ? root.data : Array.isArray(root.aws_data) ? root.aws_data : [root];
    const row = candidates.find((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item) && String((item as Record<string, unknown>).CALL_SIGN ?? "").toUpperCase() === this.config.station.toUpperCase());
    if (!row || typeof row.STATION !== "string" || typeof row.DATE !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.DATE) || typeof row.TIME !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(row.TIME)) throw new Error("IMD response did not contain the requested station");
    const result: ImdReference = { station_id: String(row.CALL_SIGN), station_name: row.STATION, observed_date: row.DATE, observed_time: row.TIME, temperature_c: numeric(row.CURR_TEMP, -90, 65), humidity_percent: numeric(row.RH, 0, 100), mean_sea_level_pressure_hpa: numeric(row.MSLP, 800, 1100), latitude: numeric(row.Latitude, -90, 90), longitude: numeric(row.Longitude, -180, 180), fetched_at: new Date(this.now()).toISOString() };
    if (result.temperature_c === null && result.humidity_percent === null && result.mean_sea_level_pressure_hpa === null) throw new Error("IMD observation contains no usable weather values");
    this.cached = result;
    return result;
  }
}
