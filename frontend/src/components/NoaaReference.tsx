import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

type Observation = { station_name: string; station_id: string; observed_at: string; temperature_c: number | null; dew_point_c: number | null; altimeter_hpa: number | null; stale: boolean; cached_after_error: boolean };
const reading = (value: number | null, unit: string) => value === null ? "Unavailable" : `${value.toFixed(1)} ${unit}`;
export default function NoaaReference() {
  const [observation,setObservation]=useState<Observation | null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{ try { const response=await fetch("/api/reference-station",{headers:{Accept:"application/json"},signal:controller.signal}); if(response.status === 401) { window.dispatchEvent(new Event("skyguard:session-expired")); return; } if(!response.headers.get("content-type")?.includes("application/json")) throw new Error("Reference station unavailable. Check the backend connection."); const data=await response.json(); if(!response.ok) throw new Error(data.error ?? "Reference station unavailable."); if(!controller.signal.aborted) { setObservation(data.observation); setError(""); } } catch(err) { if(!controller.signal.aborted) setError(err instanceof Error ? err.message : "Reference station unavailable."); } };
    void load(); const timer=window.setInterval(()=>void load(),5*60_000); return ()=>{controller.abort(); window.clearInterval(timer);};
  },[]);
  return <section className="panel noaa-reference" aria-labelledby="noaa-reference-title"><div className="noaa-reference-heading"><div><span className="directory-kicker">PUBLIC REFERENCE OBSERVATION</span><h2 id="noaa-reference-title"><Radio size={18} /> Chennai International Airport</h2><p>NOAA Aviation Weather Center · METAR VOMM</p></div><span className={`station-feed-freshness ${observation?.stale || error ? "stale" : "fresh"}`}>{error ? "Unavailable" : !observation ? "Loading" : observation.stale ? "Stale report" : "Recent report"}</span></div>
    {observation && <><div className="station-feed-readings noaa-reference-values"><div><span>Air temperature</span><strong>{reading(observation.temperature_c,"°C")}</strong></div><div><span>Dew point</span><strong>{reading(observation.dew_point_c,"°C")}</strong></div><div><span>Altimeter setting</span><strong>{reading(observation.altimeter_hpa,"hPa")}</strong></div></div><p className="noaa-reference-time">Observed {new Date(observation.observed_at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}{observation.cached_after_error ? " · Cached after source error" : ""}{error ? " · Last displayed report may be out of date" : ""}</p></>}
    {error && <p className="noaa-reference-error" role="alert">{error}</p>}<p className="noaa-reference-note">Public airport weather report, not your station feed. The altimeter setting is not station-level pressure; relative humidity is not supplied here. This reference does not create incidents. <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noreferrer">About the NOAA data</a></p>
  </section>;
}
