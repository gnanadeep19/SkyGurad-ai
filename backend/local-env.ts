import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
/** Load project-local development configuration without overriding explicit environment variables. */
export function loadProjectEnv(projectRoot: string) {
  const file = path.join(projectRoot, ".env.skyguard.local");
  if (existsSync(file)) loadEnvFile(file);
}
