import { join } from "node:path";
import { homedir } from "node:os";
import { createApp, bindHost } from "./app.js";

const dataDir =
  process.env["PRAISESUITE_DATA"] ?? join(homedir(), ".praisesuite");
const port = Number.parseInt(process.env["PORT"] ?? "7729", 10);

const app = createApp({
  databasePath: join(dataDir, "praisesuite.sqlite"),
  ...(process.env["PRAISESUITE_WEB_ROOT"] ? { webRoot: process.env["PRAISESUITE_WEB_ROOT"] } : {}),
  singleSession: process.env["PRAISESUITE_SINGLE_SESSION"] === "1",
  ...(process.env["PRAISESUITE_INTERNAL_TOKEN"] !== undefined
    ? { internalToken: process.env["PRAISESUITE_INTERNAL_TOKEN"], externalPort: port }
    : {}),
});

const lanEnabled = app.storage.getSetting("server.lanEnabled") === "true";

if (process.env["PRAISESUITE_INTERNAL"] === "1") {
  // Desktop split-listener mode: an ephemeral loopback port gated by a
  // per-launch token serves only the Electron windows; PORT (7729) is the
  // external LAN listener and exists only while LAN access is enabled.
  const internalPort = await app.listenInternal();
  console.log(`Internal listener: http://127.0.0.1:${internalPort}`);
  if (lanEnabled) console.log(`External listener: http://0.0.0.0:${port}`);
} else {
  const host = bindHost(lanEnabled);
  await app.listen(port, host);
  console.log(`PraiseSuite server listening on http://${host}:${port}`);
  console.log(`LAN access: ${lanEnabled ? "enabled" : "disabled (localhost only)"}`);
  console.log(`API: http://${host}:${port}/api/v1/health`);
}
