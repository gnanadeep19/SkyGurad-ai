import https from "node:https";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MAX_BODY = 2 * 1024 * 1024;
const TOKEN = /^Bearer sgd_[a-f0-9]{24}_[a-f0-9]{64}$/;
const json = (res, status, error) => {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify({ error }));
};

/** HTTPS ingress only. SkyGuard itself authenticates and scopes each token. */
export function createGateway({ key, cert, backendPort }) {
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) throw new Error("Invalid backend port.");
  const rates = new Map();
  const server = https.createServer({ key, cert, minVersion: "TLSv1.2" }, (req, res) => {
    if (req.url !== "/api/device/observations") { req.resume(); return json(res, 404, "Not found."); }
    if (req.method !== "POST") { req.resume(); return json(res, 405, "Only POST is supported."); }
    const ip = req.socket.remoteAddress ?? "unknown", now = Date.now();
    const rate = rates.get(ip);
    if (!rate || rate.until <= now) {
      if (rates.size >= 1024) for (const [key, value] of rates) { if (value.until <= now) rates.delete(key); }
      if (!rates.has(ip) && rates.size >= 1024) { req.resume(); return json(res, 503, "Gateway is busy."); }
      rates.set(ip, { count: 1, until: now + 60_000 });
    } else if (++rate.count > 120) { req.resume(); return json(res, 429, "Too many requests. Try again later."); }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) { req.resume(); return json(res, 415, "Requests must use JSON."); }
    if (!TOKEN.test(req.headers.authorization ?? "")) { req.resume(); return json(res, 401, "Invalid device credential."); }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY) { req.resume(); return json(res, 413, "Request too large."); }
    let size = 0, rejected = false;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { rejected = true; chunks.length = 0; json(res, 413, "Request too large."); return; }
      if (!rejected) chunks.push(chunk);
    });
    req.on("error", () => { rejected = true; });
    req.on("end", () => {
      if (rejected || res.destroyed) return;
      const body = Buffer.concat(chunks);
      // Do not forward client-provided proxy headers, cookies, or arbitrary paths.
      const upstream = http.request({ host: "127.0.0.1", port: backendPort, method: "POST", path: "/api/device/observations", headers: { "Content-Type": "application/json", Authorization: req.headers.authorization, "Content-Length": String(body.length) }, timeout: 20000 }, upstreamRes => {
        if (!/^application\/json(?:\s*;|$)/i.test(upstreamRes.headers["content-type"] ?? "")) {
          upstreamRes.resume();
          return json(res, upstreamRes.statusCode && upstreamRes.statusCode >= 400 && upstreamRes.statusCode < 500 ? upstreamRes.statusCode : 502, "SkyGuard could not process the request.");
        }
        res.writeHead(upstreamRes.statusCode ?? 502, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        upstreamRes.on("error", () => res.destroy());
        upstreamRes.pipe(res);
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => json(res, 502, "SkyGuard backend is unavailable."));
      res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
      upstream.end(body);
    });
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.maxConnections = 128;
  return server;
}

async function main() {
  const keyPath = process.env.SKYGUARD_GATEWAY_TLS_KEY, certPath = process.env.SKYGUARD_GATEWAY_TLS_CERT;
  if (!keyPath || !certPath) throw new Error("Set SKYGUARD_GATEWAY_TLS_KEY and SKYGUARD_GATEWAY_TLS_CERT to local PEM files.");
  const backendPort = Number(process.env.SKYGUARD_GATEWAY_BACKEND_PORT ?? 3001);
  const gatewayPort = Number(process.env.SKYGUARD_GATEWAY_PORT ?? 3443);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error("Invalid gateway port.");
  const server = createGateway({ key: await readFile(keyPath), cert: await readFile(certPath), backendPort });
  const host = process.env.SKYGUARD_GATEWAY_HOST || "127.0.0.1";
  server.listen(gatewayPort, host, () => console.log(`SkyGuard HTTPS gateway listening on ${host}:${gatewayPort}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(() => { console.error("Unable to start HTTPS gateway. Check the TLS files and configuration."); process.exitCode = 1; });
