import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installAuth } from "./auth";

describe("authentication and role permissions", () => {
  let server: Server, base: string, tempDirectory: string, setupCode: string;
  let adminCookie = "", operatorCookie = "", operatorId = "";
  const post = (url: string, body: unknown, cookie = "", method = "POST") => fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  beforeAll(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "skyguard-auth-"));
    const app = express(); app.use(express.json());
    const log = vi.spyOn(console, "log").mockImplementation((value: unknown) => { const match = String(value).match(/setup code: ([a-f0-9]{36})/); if (match) setupCode = match[1]; });
    await installAuth(app, path.join(tempDirectory, "users.json")); log.mockRestore();
    app.get("/api/realtime", (_req, res) => res.json({ ok: true }));
    app.post("/api/analyze", (_req, res) => res.json({ ok: true }));
    app.post("/api/config", (_req, res) => res.json({ ok: true }));
    server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); await fs.unlink(path.join(tempDirectory, "users.json")); await fs.rmdir(tempDirectory); });
  it("requires authentication and a one-time setup code", async () => {
    expect((await fetch(`${base}/api/realtime`)).status).toBe(401);
    expect((await (await fetch(`${base}/api/auth/status`)).json()).setupRequired).toBe(true);
    expect((await post("/api/auth/setup", { username: "admin", password: "correct-horse-battery", code: "wrong" })).status).toBe(403);
    const result = await post("/api/auth/setup", { username: "admin", password: "correct-horse-battery", code: setupCode });
    expect(result.status).toBe(201); adminCookie = result.headers.get("set-cookie")!.split(";")[0];
    expect((await (await fetch(`${base}/api/auth/status`)).json()).setupRequired).toBe(false);
    expect((await post("/api/auth/setup", { username: "other", password: "correct-horse-battery", code: setupCode })).status).toBe(403);
  });
  it("lets administrators manage accounts and protects configuration", async () => {
    expect((await post("/api/auth/login", { username: "admin", password: "correct-horse-battery", role: "operator" })).status).toBe(401);
    expect((await post("/api/auth/login", { username: "admin", password: "correct-horse-battery", role: "administrator" })).status).toBe(200);
    const created = await post("/api/users", { username: "operator", password: "operator-passphrase", role: "operator" }, adminCookie);
    expect(created.status).toBe(201); operatorId = (await created.json()).user.id;
    expect((await post("/api/config", {}, adminCookie)).status).toBe(200);
    expect((await post("/api/auth/login", { username: "operator", password: "operator-passphrase", role: "administrator" })).status).toBe(401);
    const login = await post("/api/auth/login", { username: "operator", password: "operator-passphrase", role: "operator" });
    expect(login.status).toBe(200); operatorCookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await fetch(`${base}/api/realtime`, { headers: { Cookie: operatorCookie } })).status).toBe(200);
    expect((await post("/api/analyze", {}, operatorCookie)).status).toBe(200);
    expect((await fetch(`${base}/api/users`, { headers: { Cookie: operatorCookie } })).status).toBe(403);
    expect((await post("/api/config", {}, operatorCookie)).status).toBe(403);
    expect((await post("/api/users", { username: "rogue", password: "operator-passphrase", role: "administrator" }, operatorCookie)).status).toBe(403);
  });
  it("revokes access when an account is disabled and rejects cross-site mutations", async () => {
    expect((await post(`/api/users/${operatorId}`, { active: false }, adminCookie, "PATCH")).status).toBe(200);
    expect((await fetch(`${base}/api/realtime`, { headers: { Cookie: operatorCookie } })).status).toBe(401);
    expect((await fetch(`${base}/api/config`, { method: "POST", headers: { Cookie: adminCookie, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body: "{}" })).status).toBe(403);
    const stored = await fs.readFile(path.join(tempDirectory, "users.json"), "utf8");
    expect(stored).not.toContain("operator-passphrase"); expect(stored).not.toContain("correct-horse-battery");
  });
});
