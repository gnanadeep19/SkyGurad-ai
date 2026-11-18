import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceCredentialStore } from "./device-credentials.js";

describe("local device credential store", () => {
  it("records when monitoring begins, preserves it on edits, and clears it when disabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-monitoring-"));
    try {
      const store = new DeviceCredentialStore(path.join(dir, "credentials.json"));
      const { credential } = await store.create("TEST-001", "Test station", 1);
      const enabled = await store.setMonitoring(credential.id, 10);
      expect(Number.isFinite(Date.parse(enabled!.monitoring_started_at!))).toBe(true);
      expect((await store.setMonitoring(credential.id, 20))?.monitoring_started_at).toBe(enabled?.monitoring_started_at);
      expect((await store.setMonitoring(credential.id, null))?.monitoring_started_at).toBeNull();
      expect((await store.setMonitoring(credential.id, 10))?.monitoring_started_at).toBeTruthy();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it("stores only a hash, survives a restart, and enforces expiry and revocation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-device-credential-"));
    const file = path.join(dir, "credentials.json");
    try {
      const store = new DeviceCredentialStore(file);
      const created = await store.create("TEST-001", "Test gateway", 90);
      const disk = await fs.readFile(file, "utf8");
      expect(disk).not.toContain(created.token);
      expect(disk).not.toContain(created.token.split("_")[2]);
      expect(JSON.stringify(await store.list())).not.toContain("secret_hash");
      const restarted = new DeviceCredentialStore(file);
      expect((await restarted.authenticate(created.token))?.station_id).toBe("TEST-001");
      expect(await restarted.authenticate(`${created.token.slice(0, -1)}${created.token.endsWith("0") ? "1" : "0"}`)).toBeNull();
      expect(await restarted.revoke(created.credential.id)).toBe(true);
      expect(await restarted.authenticate(created.token)).toBeNull();
      expect(await restarted.revoke(created.credential.id)).toBe(false);
      const expiring = await restarted.create("TEST-002", "Second gateway", 1);
      const records = JSON.parse(await fs.readFile(file, "utf8"));
      records.find((item: { id: string }) => item.id === expiring.credential.id).expires_at = "2000-01-01T00:00:00.000Z";
      await fs.writeFile(file, JSON.stringify(records));
      expect(await restarted.authenticate(expiring.token)).toBeNull();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
