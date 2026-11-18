export type IngestionResult = { source: string; source_stale: boolean };

/** Polls after the previous run finishes, so slow requests cannot overlap. */
export class IngestionScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private status = {
    enabled: false, interval_ms: 0, in_progress: false,
    last_attempt: null as string | null, last_completed: null as string | null,
    last_fresh_sync: null as string | null, last_source: null as string | null,
    last_source_stale: null as boolean | null, last_error: null as string | null,
    next_attempt: null as string | null,
  };

  constructor(private readonly intervalMs: number, private readonly collect: () => Promise<IngestionResult>) {
    this.status.interval_ms = intervalMs;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.status.enabled = true;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    this.status.enabled = false;
    this.status.next_attempt = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus() { return { ...this.status }; }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.status.next_attempt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, delay);
    this.timer.unref?.();
  }

  private async run() {
    this.status.in_progress = true;
    this.status.next_attempt = null;
    this.status.last_attempt = new Date().toISOString();
    try {
      const result = await this.collect();
      this.status.last_completed = new Date().toISOString();
      this.status.last_source = result.source;
      this.status.last_source_stale = result.source_stale;
      this.status.last_error = null;
      if (result.source !== "replay" && !result.source_stale) this.status.last_fresh_sync = this.status.last_completed;
    } catch (error) {
      // Source URLs can contain credentials; do not expose exception details via the API.
      console.warn("Background weather collection failed.", error instanceof Error ? error.name : "Unknown error");
      this.status.last_error = "Weather collection failed. Check the backend logs and source configuration.";
    } finally {
      this.status.in_progress = false;
      this.schedule(this.intervalMs);
    }
  }
}
