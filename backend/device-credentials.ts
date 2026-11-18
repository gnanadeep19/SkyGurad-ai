import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Request } from "express";

type StoredCredential = { id: string; station_id: string; label: string; secret_hash: string; created_at: string; expires_at: string; revoked_at: string | null; expected_interval_minutes?: number | null; monitoring_started_at?: string | null };
export type DeviceCredential = Omit<StoredCredential, "secret_hash">;
const publicCredential = ({ secret_hash: _hash, ...credential }: StoredCredential): DeviceCredential => credential;
const hash = (secret: string) => createHash("sha256").update(secret).digest();

// This prototype accepts tokens only from the same computer, including when a
// local development proxy forwards a request. It is not a remote TLS gateway.
export function isLocalDeviceRequest(req: Request): boolean {
  const isLoopback = (value: string) => value === "::1" || value === "127.0.0.1" || value === "::ffff:127.0.0.1";
  if (!isLoopback(req.socket.remoteAddress ?? "")) return false;
  const forwarded = req.get("x-forwarded-for");
  return !forwarded || forwarded.split(",").every(address => isLoopback(address.trim()));
}

/** Single-process local credential store. Only token hashes are persisted. */
export class DeviceCredentialStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<StoredCredential[]> {
    try { const parsed: unknown = JSON.parse(await fs.readFile(this.file, "utf8")); if (!Array.isArray(parsed)) throw new Error("Invalid device credential store"); return parsed as StoredCredential[]; }
    catch (error: any) { if (error?.code === "ENOENT") return []; throw error; }
  }
  private async write(items: StoredCredential[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomBytes(8).toString("hex")}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(items, null, 2), { mode: 0o600, flag: "wx" }); await fs.rename(temporary, this.file); }
    finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  async list(): Promise<DeviceCredential[]> { return (await this.read()).map(publicCredential); }
  async create(stationId: string, label: string, days: number): Promise<{ credential: DeviceCredential; token: string }> {
    return this.mutate(async () => {
      const items = await this.read();
      const id = randomBytes(12).toString("hex"), secret = randomBytes(32).toString("hex"), now = Date.now();
      const item: StoredCredential = { id, station_id: stationId, label, secret_hash: hash(secret).toString("hex"), created_at: new Date(now).toISOString(), expires_at: new Date(now + days * 86400_000).toISOString(), revoked_at: null };
      await this.write([...items, item]);
      return { credential: publicCredential(item), token: `sgd_${id}_${secret}` };
    });
  }
  async revoke(id: string): Promise<boolean> {
    return this.mutate(async () => {
      const items = await this.read(), item = items.find(entry => entry.id === id);
      if (!item || item.revoked_at) return false;
      item.revoked_at = new Date().toISOString(); await this.write(items); return true;
    });
  }
  async setMonitoring(id: string, minutes: number | null): Promise<DeviceCredential | null> {
    return this.mutate(async () => {
      const items = await this.read(), item = items.find(entry => entry.id === id);
      if (!item || item.revoked_at || !Number.isFinite(Date.parse(item.expires_at)) || Date.parse(item.expires_at) <= Date.now()) return null;
      if (minutes === null) item.monitoring_started_at = null;
      else if (item.expected_interval_minutes == null || !item.monitoring_started_at) item.monitoring_started_at = new Date().toISOString();
      item.expected_interval_minutes = minutes; await this.write(items); return publicCredential(item);
    });
  }
  async authenticate(token: string): Promise<DeviceCredential | null> {
    const match = /^sgd_([a-f0-9]{24})_([a-f0-9]{64})$/.exec(token);
    if (!match) return null;
    const item = (await this.read()).find(entry => entry.id === match[1]);
    const expected = item && /^[a-f0-9]{64}$/.test(item.secret_hash) ? Buffer.from(item.secret_hash, "hex") : Buffer.alloc(32);
    const valid = timingSafeEqual(expected, hash(match[2]));
    if (!valid || !item || item.revoked_at || !Number.isFinite(Date.parse(item.expires_at)) || Date.parse(item.expires_at) <= Date.now()) return null;
    return publicCredential(item);
  }
}
