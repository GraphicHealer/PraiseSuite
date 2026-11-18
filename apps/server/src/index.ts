import { join } from "node:path";
import { homedir } from "node:os";
import { createApp, bindHost } from "./app.js";

const dataDir =
  process.env["PRAISESUITE_DATA"] ?? join(homedir(), ".praisesuite");
const port = Number.parseInt(process.env["PORT"] ?? "8080", 10);

const app = createApp({
  databasePath: join(dataDir, "praisesuite.sqlite"),
  ...(process.env["PRAISESUITE_WEB_ROOT"] ? { webRoot: process.env["PRAISESUITE_WEB_ROOT"] } : {}),
});

const lanEnabled = app.storage.getSetting("server.lanEnabled") === "true";
const host = bindHost(lanEnabled);

await app.listen(port, host);
console.log(`PraiseSuite server listening on http://${host}:${port}`);
console.log(`LAN access: ${lanEnabled ? "enabled" : "disabled (localhost only)"}`);
console.log(`API: http://${host}:${port}/api/v1/health`);
