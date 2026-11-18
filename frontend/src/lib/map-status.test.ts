import { describe, expect, it } from "vitest";
import { mapStationStatus } from "./map-status";

describe("map station status", () => {
  it("uses recorded states only while the source and station observation are current", () => {
    expect(mapStationStatus({status:"Warning"},"live")).toBe("Warning");
    expect(mapStationStatus({status:"Critical"},"replay")).toBe("Critical");
    expect(mapStationStatus({status:"Healthy",observation_stale:true},"live")).toBe("Unavailable");
    expect(mapStationStatus({status:"Critical"},"stale")).toBe("Unavailable");
    expect(mapStationStatus({status:"Healthy"},"connecting")).toBe("Unavailable");
    expect(mapStationStatus({status:"Other"},"live")).toBe("Unavailable");
  });
});
