# HTTPS station gateway

The gateway accepts only `POST /api/device/observations` over HTTPS. It forwards the device's bearer credential and JSON body to the SkyGuard backend on `127.0.0.1`; the backend verifies the token, expiry, revocation, and station scope. It does not expose account, configuration, or credential-management routes. Incoming proxy headers and cookies are not forwarded. A basic per-address limit and request-size/time limits are provided, but these are not a replacement for a production gateway or distributed abuse protection.

## Local test setup

1. Start the SkyGuard backend on port 3001. An administrator can create a station-scoped credential under **Station feed → Device access**. Save the secret privately; it is displayed once.
2. Run `npm run gateway:setup-local` from the project folder. This creates a 30-day **self-signed local test certificate** and private key under the ignored `data/gateway-local` directory. It requires OpenSSL. It will not overwrite existing files.
3. In a separate PowerShell terminal, start the gateway:

   ```powershell
   $env:SKYGUARD_GATEWAY_TLS_KEY = (Resolve-Path 'data/gateway-local/localhost-key.pem').Path
   $env:SKYGUARD_GATEWAY_TLS_CERT = (Resolve-Path 'data/gateway-local/localhost-cert.pem').Path
   npm run gateway
   ```

4. The gateway listens at `https://127.0.0.1:3443` by default. A test client must explicitly trust the local certificate and verify its hostname; do not disable TLS certificate validation. Send the token in the `Authorization` header, never in a URL, source file, terminal history, or chat. The JSON schema and station-level pressure requirement are documented in [Station API](STATION-API.md).

The automated gateway test generates its own temporary certificate, test account, credential, and readings. It exercises TLS verification, authentication, station scope, and duplicate handling without using your database or sending emails: `npm test -- backend/gateway.test.mjs`.

## Remote deployment is not complete

The default listener accepts connections **only on this computer**. The self-signed certificate is only for local tests; do not install it as a broadly trusted authority or use it for a remote deployment. Before using a real station, a trusted certificate matching the gateway hostname, protected private keys, network firewalling, a device provisioning and rotation process, monitoring, and a security review are needed. If the gateway is configured to bind to another address with `SKYGUARD_GATEWAY_HOST`, protect both the gateway and the backend; the gateway-to-backend hop is unencrypted loopback and the backend must not be exposed as a public service. No physical feed is connected by starting the gateway.
