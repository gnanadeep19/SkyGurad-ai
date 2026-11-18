import { describe, expect, it, vi } from "vitest";
import { ImdReferenceFeed, imdReferenceConfig } from "./imd-reference.js";

const config = { station: "NDL", header: "x-api-key", value: "test-secret" };
const row = { CALL_SIGN: "NDL", STATION: "LODI ROAD", DATE: "2024-06-06", TIME: "07:00:00", CURR_TEMP: "40.8", RH: "20", MSLP: "1003.0", Latitude: "28.5885", Longitude: "77.2224" };

describe("IMD reference observations", () => {
  it("parses the documented AWS sample without conflating pressure or assuming a time zone", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([row])));
    const feed = new ImdReferenceFeed(config, fetcher, () => Date.parse("2024-06-06T08:00:00Z"));
    const result = await feed.get();
    expect(result).toMatchObject({ station_id: "NDL", station_name: "LODI ROAD", observed_date: "2024-06-06", observed_time: "07:00:00", temperature_c: 40.8, humidity_percent: 20, mean_sea_level_pressure_hpa: 1003 });
    expect(result).not.toHaveProperty("pressure");
    expect(result).not.toHaveProperty("observed_at");
    const [url, options] = fetcher.mock.calls[0];
    expect(url.toString()).toBe("https://api.imd.gov.in/api/v1/aws_data?id=NDL");
    expect(options.redirect).toBe("error");
    await feed.get(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects incorrect station, missing timestamps and unauthorized responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ ...row, CALL_SIGN: "OTHER" }]))).mockResolvedValueOnce(new Response(JSON.stringify([{ ...row, TIME: null }]))).mockResolvedValueOnce(new Response("", { status: 401 }));
    const feed = new ImdReferenceFeed(config, fetcher);
    await expect(feed.get()).rejects.toThrow(); await expect(feed.get()).rejects.toThrow(); await expect(feed.get()).rejects.toThrow();
  });
  it("does not invent unavailable values and requires explicit, safe configuration", async () => {
    expect(imdReferenceConfig({ IMD_REFERENCE_STATION: "NDL", IMD_REFERENCE_AUTH_HEADER: "Authorization", IMD_REFERENCE_AUTH_VALUE: "Bearer example" })).toEqual({ station: "NDL", header: "Authorization", value: "Bearer example" });
    expect(imdReferenceConfig({ IMD_REFERENCE_STATION: "NDL", IMD_REFERENCE_AUTH_HEADER: "host", IMD_REFERENCE_AUTH_VALUE: "secret" })).toBeNull();
    expect(imdReferenceConfig({ IMD_REFERENCE_STATION: "NDL", IMD_REFERENCE_AUTH_HEADER: "x-key", IMD_REFERENCE_AUTH_VALUE: "bad\r\nvalue" })).toBeNull();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...row, RH: "", MSLP: "9999" })));
    expect(await new ImdReferenceFeed(config, fetcher).get()).toMatchObject({ humidity_percent: null, mean_sea_level_pressure_hpa: null });
  });
});
