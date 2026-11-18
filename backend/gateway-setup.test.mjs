import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSecureContext } from "node:tls";
import path from "node:path";
import os from "node:os";

describe("local gateway setup", () => {
  it.skipIf(process.platform !== "win32")("creates a certificate once without overwriting it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-gateway-setup-"));
    try {
      const scripts = path.join(root, "scripts"); await fs.mkdir(scripts);
      for (const name of ["setup-local-gateway.ps1", "check-local-gateway-cert.mjs"]) await fs.copyFile(path.resolve("scripts", name), path.join(scripts, name));
      const run = () => promisify(execFile)("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "setup-local-gateway.ps1")], { timeout: 25000 });
      await run();
      const certPath = path.join(root, "data", "gateway-local", "localhost-cert.pem");
      const keyPath = path.join(root, "data", "gateway-local", "localhost-key.pem");
      const cert = await fs.readFile(certPath), key = await fs.readFile(keyPath);
      expect(() => createSecureContext({ cert, key })).not.toThrow();
      await run(); expect(await fs.readFile(certPath)).toEqual(cert);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 40000);
});
