// Set the production environment without shell-specific syntax (Windows, macOS and Linux).
process.env.NODE_ENV = "production";
await import("../dist/index.js");
