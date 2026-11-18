import { describe, expect, it } from "vitest";
import { describeWeatherSource, isUsableRealtimeResponse, weatherSourceBadge } from "./realtime";

describe("isUsableRealtimeResponse", () => {
  it("accepts a successful JSON response", () => {
    expect(isUsableRealtimeResponse(new Response('{"source":"replay"}', { status: 200, headers: { "content-type": "application/json" } }))).toBe(true);
  });

  it("rejects the HTML SPA fallback returned for a missing API route", () => {
    expect(isUsableRealtimeResponse(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }))).toBe(false);
  });

  it("rejects failed JSON responses", () => {
    expect(isUsableRealtimeResponse(new Response('{"error":"unavailable"}', { status: 502, headers: { "content-type": "application/json" } }))).toBe(false);
  });
});

describe("weather source descriptions", () => {
  it("labels the dashboard source and distinguishes stale, cached and replay states", () => {
    expect(weatherSourceBadge("open-meteo", "live", "Open-Meteo")).toEqual({ label: "Dashboard: Open-Meteo", state: "Current" });
    expect(weatherSourceBadge("open-meteo", "stale", "Open-Meteo (cached)")).toEqual({ label: "Dashboard: Open-Meteo (cached)", state: "Stale" });
    expect(weatherSourceBadge("open-meteo", "stale", "Open-Meteo (stale)")).toEqual({ label: "Dashboard: Open-Meteo (stale)", state: "Stale" });
    expect(weatherSourceBadge("replay", "replay", "Replay fallback")).toEqual({ label: "Dashboard: Replay fallback", state: "Replay" });
    expect(weatherSourceBadge(null, "connecting", "Backend unavailable")).toEqual({ label: null, state: "Connecting" });
  });
  it("distinguishes model estimates and replay from physical measurements", () => {
    expect(describeWeatherSource("open-meteo", "live").detail).toContain("not physical station measurements");
    expect(describeWeatherSource("replay", "replay").detail).toContain("demonstration readings");
    expect(describeWeatherSource("live", "live").detail).toContain("Verify their origin");
  });
  it("warns about stale data and handles connection loss", () => {
    expect(describeWeatherSource("open-meteo", "stale").detail).toContain("stale");
    expect(describeWeatherSource("live", "stale").tone).toBe("warning");
    expect(describeWeatherSource("open-meteo", "connecting").title).toBe("Waiting for weather data");
  });
});
