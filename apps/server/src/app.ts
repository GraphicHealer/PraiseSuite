import { createServer, type Server } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRegistry,
  registerSongCommands,
  LocalTransport,
  type Clock,
  type IdGenerator,
} from "@praisesuite/core";
import { openStorage, type SqliteStorage } from "@praisesuite/storage-sqlite";
import { AuthService } from "./auth.js";
import { dispatch } from "./http.js";
import { buildRoutes } from "./routes.js";
import { SessionChannel } from "./ws.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const clock: Clock = { now: () => new Date() };
const ids: IdGenerator = { next: () => randomUUID() };

export interface PraiseSuiteApp {
  server: Server;
  storage: SqliteStorage;
  auth: AuthService;
  channel: SessionChannel;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

export interface AppOptions {
  databasePath: string;
  mediaDir?: string;
  /** Directory containing the built web UI to serve (optional). */
  webRoot?: string;
}

/** Bind host per the LAN toggle (TAS 15.3): localhost-only unless enabled. */
export function bindHost(lanEnabled: boolean): string {
  return lanEnabled ? "0.0.0.0" : "127.0.0.1";
}

export function createApp(options: AppOptions): PraiseSuiteApp {
  const storage = openStorage(options);
  const auth = new AuthService(storage);
  let lanEnabled = storage.getSetting("server.lanEnabled") === "true";

  const registry = createRegistry();
  registerSongCommands(registry);
  const transport = new LocalTransport(registry, {
    repos: storage.repositories,
    ids,
    clock,
  });

  const server = createServer();
  const channel = new SessionChannel(server, auth);
  const webRoot = options.webRoot ? resolve(options.webRoot) : null;

  const routes = buildRoutes({
    storage,
    repos: storage.repositories,
    transport,
    auth,
    broadcastToSession: (sid, msg) => channel.broadcast(sid, msg),
    setLanEnabled: (v) => {
      lanEnabled = v;
      storage.setSetting("server.lanEnabled", String(v));
    },
    getLanEnabled: () => lanEnabled,
  });
  const handler = dispatch(routes, auth);

  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      await handler(req, res);
      return;
    }
    if (!webRoot || !existsSync(webRoot)) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("PraiseSuite server (API at /api/v1)");
      return;
    }
    // Static serving for the built web app (M4).
    let file = normalize(url.pathname).replace(/^([/\\])+/, "");
    if (file === "" || file.endsWith("/")) file = join(file, "index.html");
    const full = resolve(webRoot, file);
    if (!full.startsWith(webRoot) || !existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const data = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(data);
  });

  return {
    server,
    storage,
    auth,
    channel,
    listen: (port, host) =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, host ?? bindHost(lanEnabled), () => resolvePromise());
      }),
    close: () =>
      new Promise((resolvePromise) => {
        channel.close();
        storage.close();
        server.close(() => resolvePromise());
      }),
  };
}
