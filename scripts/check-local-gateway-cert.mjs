import { readFile } from "node:fs/promises";
import { createSecureContext } from "node:tls";
import { X509Certificate } from "node:crypto";

try {
  const key = await readFile(process.argv[2]);
  const cert = await readFile(process.argv[3]);
  createSecureContext({ key, cert });
  const certificate = new X509Certificate(cert);
  if (!certificate.checkHost("localhost") || Date.parse(certificate.validTo) <= Date.now()) throw new Error("Invalid local certificate");
} catch { console.error("The local test certificate or key is invalid or expired."); process.exitCode = 1; }
