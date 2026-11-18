# Local station bridge

The bridge sends one supplied JSON observation to the existing local HTTPS gateway. It does **not** communicate with a physical device, invent sensor readings, verify station identity, or provide remote access. Once you have a station, a separate device-specific program must obtain actual readings and pass one observation to this bridge on standard input.

## Setup

1. Start SkyGuard and the local HTTPS gateway using the [gateway guide](HTTPS-GATEWAY.md). The gateway must listen on the same computer at `127.0.0.1`; its local test certificate is only for this local setup.
2. As an administrator, create a credential in **Station feed → Device access** for the intended station ID. Store the one-time secret securely. Set `SKYGUARD_DEVICE_TOKEN` in the bridge process environment using your secure launcher. Do not paste it into chat, source files, command history or logs. Treat process environment variables as sensitive on shared computers.
3. Set `SKYGUARD_BRIDGE_STATION_ID` to that credential's station ID, and `SKYGUARD_GATEWAY_CA` to the absolute path of the local gateway's public certificate, typically `data/gateway-local/localhost-cert.pem`. The bridge connects to `127.0.0.1:3443`; set `SKYGUARD_GATEWAY_PORT` only if the local gateway uses a different port. Do not provide the gateway's private key as the CA certificate.
4. Pipe one JSON object from your station adapter into `node scripts/station-bridge.mjs`. See [Station API](STATION-API.md) for fields, validation, timestamp and pressure requirements. The station ID must exactly match the credential. Use an observation timestamp with `Z` or an explicit UTC offset, temperature in °C, relative humidity in %, and station-level pressure in hPa with `pressure_type` set to `station`.

Example input structure (illustrative only, not a real observation; replace the timestamp and values with actual data):

```json
{"station_id":"EXAMPLE-001","station_name":"Example station","timestamp":"2026-01-01T12:00:00Z","latitude":13.0,"longitude":80.18,"temperature":25.2,"humidity":70,"pressure":1008.4,"pressure_type":"station"}
```

The bridge outputs counts for inserted or duplicate observations and the detection status. A duplicate is not inserted again. Invalid input, failed TLS, an unavailable gateway, rejected credentials, invalid data or a failed detection result produce a nonzero exit status. If detection fails after storage succeeds, the observation remains stored: do not blindly retry expecting it to be rescored. There is no offline queue or automatic retry. Check **Data quality** and **Station feed** when troubleshooting.

Do not send simulated anomalies to your normal SkyGuard database just to test this bridge: submitted readings can generate persistent incidents and, if configured, email notifications. The automated test below runs a separate backend and temporary gateway with email disabled:

```powershell
npx vitest run --root . backend/gateway.test.mjs
```

The gateway test verifies certificate validation, scoped credentials, valid and duplicate bridge submissions, invalid station IDs and untrusted certificates. It does not verify a physical device. A real device adapter requires its model, protocol, units and access to the equipment; remote deployment requires further security work.
