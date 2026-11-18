import { afterEach, describe, expect, it, vi } from "vitest";
import { IngestionScheduler } from "./ingestion-scheduler.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("background ingestion", () => {
  it("waits for a run to finish before scheduling the next and tracks fresh sources", async () => {
    vi.useFakeTimers();
    let finish!: (result: {source: string; source_stale: boolean}) => void;
    const collect = vi.fn(() => new Promise<{source: string; source_stale: boolean}>(resolve => { finish = resolve; }));
    const scheduler = new IngestionScheduler(60_000, collect);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getStatus().in_progress).toBe(true);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(collect).toHaveBeenCalledTimes(1);
    finish({source: "open-meteo", source_stale: false});
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getStatus().last_fresh_sync).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(collect).toHaveBeenCalledTimes(2);
    scheduler.stop();
    finish({source: "replay", source_stale: false});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(scheduler.getStatus().enabled).toBe(false);
  });

  it("reports failures without leaking exception details and retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const collect = vi.fn().mockRejectedValueOnce(new Error("private-token")).mockResolvedValueOnce({source: "open-meteo", source_stale: true});
    const scheduler = new IngestionScheduler(60_000, collect);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getStatus().last_error).not.toContain("private-token");
    expect(scheduler.getStatus().last_fresh_sync).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduler.getStatus()).toMatchObject({last_error: null, last_source_stale: true, last_fresh_sync: null});
    scheduler.stop();
  });
});
