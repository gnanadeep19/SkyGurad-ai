import { copyFile } from "node:fs/promises";
await copyFile("backend/schema.sql", "dist/schema.sql");
