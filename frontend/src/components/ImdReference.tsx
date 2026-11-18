import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

type Observation = { station_id: string; station_name: string; observed_date: string; observed_time: string; fetched_at: string; temperature_c: number | null; humidity_percent: number | null; mean_sea_level_pressure_hpa: number | null };
const reading = (value: number | null, unit: string) => value === null ? "Unavailable" : `${value.toFixed(1)} ${unit}`;

export default function ImdReference() {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [status, setStatus] = useState<"loading" | "setup" | "available" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/imd-reference", { headers: { Accept: "application/json" }, signal: controller.signal });
        if (response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; }
        if (!response.ok) throw new Error("IMD unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) { setObservation(data.observation); setStatus(data.configured ? "available" : "setup"); }
      } catch { if (!controller.signal.aborted) { setObservation(null); setStatus("error"); } }
    };
    void load(); const timer = window.setInterval(() => void load(), 10 * 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return <section className="panel noaa-reference" aria-labelledby="imd-reference-title">
    <div className="noaa-reference-heading"><div><span className="directory-kicker">OFFICIAL WEATHER REFERENCE</span><h2 id="imd-reference-title"><Radio size={18} /> IMD automatic weather station</h2><p>{observation ? `${observation.station_name} · ${observation.station_id}` : "India Meteorological Department · AWS/ARG"}</p></div><span className={`station-feed-freshness ${status === "available" ? "fresh" : "stale"}`}>{status === "setup" ? "Setup required" : status === "error" ? "Unavailable" : status === "loading" ? "Loading" : "Reference"}</span></div>
    {observation && <><div className="station-feed-readings noaa-reference-values"><div><span>Temperature</span><strong>{reading(observation.temperature_c, "°C")}</strong></div><div><span>Relative humidity</span><strong>{reading(observation.humidity_percent, "%")}</strong></div><div><span>Mean sea-level pressure</span><strong>{reading(observation.mean_sea_level_pressure_hpa, "hPa")}</strong></div></div><p className="noaa-reference-time">IMD observation time: {observation.observed_date} {observation.observed_time} (time zone not specified in the AWS example) · Fetched {new Date(observation.fetched_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p></>}
    {status === "setup" && <p className="noaa-reference-note">An IMD account, approved access and a station call sign are needed. An administrator can configure this reference on the server.</p>}
    {status === "error" && <p className="noaa-reference-error" role="alert">IMD reference unavailable. Check the approved access details and station call sign.</p>}
    <p className="noaa-reference-note">Reference data is kept separate from your station feed and does not generate incidents. Mean sea-level pressure differs from station pressure. <a href="https://api.imd.gov.in/public/api_reference.html" target="_blank" rel="noreferrer">IMD API reference</a> · <a href="https://api.imd.gov.in/public/" target="_blank" rel="noreferrer">IMD access portal</a></p>
  </section>;
}
