import { describe, expect, it, vi } from "vitest";
import { NoaaReferenceFeed } from "./noaa-reference.js";

describe("NOAA reference station",()=>{
  it("reads and caches a real-format METAR without treating altimeter as station pressure",async()=>{
    let now=Date.parse("2026-11-12T14:00:00Z");
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([{icaoId:"VOMM",reportTime:"2026-11-12T13:30:00Z",lat:12.994,lon:80.18,temp:28,dewp:24,altim:1013}]),{status:200,headers:{"Content-Type":"application/json"}}));
    const feed=new NoaaReferenceFeed(fetcher,()=>now);
    const result=await feed.get(); expect(result).toMatchObject({station_id:"VOMM",temperature_c:28,dew_point_c:24,altimeter_hpa:1013,stale:false});
    expect(result).not.toHaveProperty("pressure"); expect(result).not.toHaveProperty("humidity");
    await feed.get(); expect(fetcher).toHaveBeenCalledTimes(1);
    now+=11*60_000; fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await feed.get()).toMatchObject({cached_after_error:true,stale:true,temperature_c:28});
  });
  it("rejects missing, wrong-station, and future observations without fabricating data",async()=>{
    const now=Date.parse("2026-11-12T14:00:00Z");
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{icaoId:"OTHER",reportTime:"2026-11-12T13:30:00Z"}]))).mockResolvedValueOnce(new Response(JSON.stringify([{icaoId:"VOMM",reportTime:"2026-11-13T13:30:00Z"}])));
    const feed=new NoaaReferenceFeed(fetcher,()=>now);
    await expect(feed.get()).rejects.toThrow(); await expect(feed.get()).rejects.toThrow();
  });
});
