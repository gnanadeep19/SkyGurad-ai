/** Public NOAA METAR reference, kept separate from user-submitted station telemetry. */
export type NoaaReference = { station_id: string; station_name: string; observed_at: string; fetched_at: string; latitude: number | null; longitude: number | null; temperature_c: number | null; dew_point_c: number | null; altimeter_hpa: number | null; stale: boolean; cached_after_error: boolean };
type Fetcher = typeof fetch;
export class NoaaReferenceFeed {
  private cached: Omit<NoaaReference, "stale" | "cached_after_error"> | null = null;
  private pending: Promise<NoaaReference> | null = null;
  constructor(private readonly fetcher: Fetcher = fetch, private readonly now: () => number = Date.now, private readonly cacheMs = 10 * 60_000) {}
  async get(): Promise<NoaaReference> {
    if (this.cached && this.now()-Date.parse(this.cached.fetched_at)<this.cacheMs) return this.output(false);
    if (!this.pending) this.pending=this.refresh().finally(()=>{this.pending=null;});
    return this.pending;
  }
  private output(afterError: boolean): NoaaReference {
    if (!this.cached) throw new Error("NOAA reference observations unavailable");
    return {...this.cached,stale:afterError || this.now()-Date.parse(this.cached.observed_at)>90*60_000,cached_after_error:afterError};
  }
  private async refresh(): Promise<NoaaReference> {
    try {
      const response=await this.fetcher("https://aviationweather.gov/api/data/metar?ids=VOMM&format=json&hours=3",{headers:{Accept:"application/json","User-Agent":"SkyGuard research prototype"},signal:AbortSignal.timeout(12_000)});
      if(!response.ok) throw new Error("NOAA response unavailable");
      const payload: unknown=await response.json();
      const row=Array.isArray(payload) ? payload.find(item=>item && typeof item === "object" && item.icaoId === "VOMM") : null;
      const observed=typeof row?.reportTime === "string" ? Date.parse(row.reportTime) : NaN;
      if (!row || !Number.isFinite(observed) || observed>this.now()+5*60_000) throw new Error("NOAA response missing a valid observation");
      const number=(value: unknown,min:number,max:number) => typeof value === "number" && Number.isFinite(value) && value>=min && value<=max ? value : null;
      this.cached={station_id:"VOMM",station_name:"Chennai International Airport",observed_at:new Date(observed).toISOString(),fetched_at:new Date(this.now()).toISOString(),latitude:number(row.lat,-90,90),longitude:number(row.lon,-180,180),temperature_c:number(row.temp,-90,65),dew_point_c:number(row.dewp,-100,65),altimeter_hpa:number(row.altim,800,1100)};
      return this.output(false);
    } catch(error) { if(this.cached) return this.output(true); throw error; }
  }
}
