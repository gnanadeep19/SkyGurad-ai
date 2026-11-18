import { describe, expect, it } from "vitest";
import { recommendationFor } from "./anomaly-guidance.js";

describe("source-aware anomaly guidance", () => {
  it.each(["Warning", "Critical"] as const)("does not recommend equipment maintenance for %s modeled or replay data", (status) => {
    expect(recommendationFor("open-meteo", status, "temperature")).toContain("Model estimates cannot diagnose sensor faults");
    expect(recommendationFor("replay", status, "temperature")).toContain("demonstration data");
    for (const source of ["open-meteo", "replay"] as const) expect(recommendationFor(source, status, "temperature")).not.toMatch(/calibrat|inspect.*sensor/i);
  });
  it("tells operators to verify station readings before considering inspection", () => {
    for (const source of ["station-api", "live"] as const) expect(recommendationFor(source, "Critical", "pressure")).toMatch(/Verify.*independent.*Consider sensor inspection/);
  });
  it("treats uploaded data as unverified and does not issue fault guidance for healthy readings", () => {
    expect(recommendationFor("uploaded", "Warning", "humidity")).toContain("quality flags");
    expect(recommendationFor("legacy-unknown", "Critical", "humidity")).toContain("source documentation");
    expect(recommendationFor("station-api", "Healthy", "temperature")).not.toMatch(/inspect|fault/i);
  });
});
