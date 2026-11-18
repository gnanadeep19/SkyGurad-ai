import { describe, expect, it } from "vitest";
import { stationFreshness } from "./station-freshness.js";

describe("station freshness", () => {
  const now = Date.parse("2024-01-01T12:00:00Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const activity = (received: number, observed: number) => ({ station_id: "A", last_received_at: at(received), last_observed_at: at(observed) });
  it("requires an initial receipt and marks late arrivals separately", () => {
    expect(stationFreshness(10, undefined, now)).toBe("awaiting_readings");
    expect(stationFreshness(10, activity(2, 2), now)).toBe("receiving");
    expect(stationFreshness(10, activity(2, 90), now)).toBe("stale");
    expect(stationFreshness(10, activity(21, 21), now)).toBe("stale");
    expect(stationFreshness(10, activity(31, 31), now)).toBe("disconnected");
  });
  it("marks a monitored station with no first reading as overdue after its grace period", () => {
    expect(stationFreshness(10, undefined, now, at(29))).toBe("awaiting_readings");
    expect(stationFreshness(10, undefined, now, at(30))).toBe("awaiting_readings");
    expect(stationFreshness(10, undefined, now, at(31))).toBe("disconnected");
    expect(stationFreshness(10, undefined, now, null)).toBe("awaiting_readings");
    expect(stationFreshness(10, activity(2, 2), now, at(31))).toBe("receiving");
  });
});
