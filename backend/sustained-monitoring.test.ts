import { describe, expect, it } from "vitest";
import { sustainedSignals } from "./sustained-monitoring.js";
import { makeDriftDemo, simulateDrift } from "../frontend/src/lib/drift.js";

describe("station sustained-change review", () => {
  it("flags a sufficiently long flat series but not sparse or short data", () => {
    const start=Date.parse("2024-01-01T00:00:00Z");
    const rows=Array.from({length:9},(_,i)=>({station_id:"S",timestamp:new Date(start+i*15*60_000).toISOString(),temperature:25,humidity:55+i,pressure:1000+i}));
    expect(sustainedSignals(rows,false).frozen).toEqual(["temperature"]);
    expect(sustainedSignals(rows.slice(0,4),false).frozen).toEqual([]);
    expect(sustainedSignals(rows.filter((_,i)=>i!==3 && i!==4),false).frozen).toEqual([]);
  });
  it("flags a controlled gradual shift against its prior same-hour baseline", () => {
    const baseline=makeDriftDemo();
    expect(sustainedSignals(baseline).drift).not.toContain("temperature");
    expect(sustainedSignals(simulateDrift(baseline,"temperature")).drift).toContain("temperature");
  });
});
