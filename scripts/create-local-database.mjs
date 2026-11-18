import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
const root = process.cwd();
const localDirectory = path.resolve(root,"data/postgres-local/cluster");
const line = (await fs.readFile(path.join(root,".env.skyguard.local"),"utf8")).split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL="));
if (!line) throw new Error("Project-local database configuration was not found.");
const target = new URL(line.slice("DATABASE_URL=".length));
if (target.hostname !== "127.0.0.1" || target.port !== "55432" || target.username !== "skyguard" || target.pathname !== "/skyguard") throw new Error("Refusing to change a database outside the expected project-local instance.");
target.pathname = "/postgres";
const client = new pg.Client({ connectionString: target.toString() });
try {
  await client.connect();
  const result = await client.query("SHOW data_directory");
  if (path.resolve(result.rows[0].data_directory).toLowerCase() !== localDirectory.toLowerCase()) throw new Error("The server is not the expected project-local PostgreSQL cluster.");
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname=$1",["skyguard"]);
  if (exists.rows.length) console.log("Project database already exists; no changes made.");
  else { await client.query("CREATE DATABASE skyguard"); console.log("Created the project-local SkyGuard database."); }
} finally { await client.end(); }
