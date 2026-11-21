import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
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
import { seedOpenSongDefaults } from "./defaults.js";
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
  /** Bind the internal loopback listener on an ephemeral port; returns the port. */
  listenInternal(): Promise<number>;
  /** Start/stop the external (LAN) listener; returns its bound port when up. */
  setExternal(enabled: boolean): Promise<number | null>;
  /** Port of the internal listener once bound (dual-listener mode only). */
  getInternalPort(): number | null;
  close(): Promise<void>;
}

export interface AppOptions {
  databasePath: string;
  mediaDir?: string;
  /** Directory containing the built web UI to serve (optional). */
  webRoot?: string;
  /** Single-user mode (desktop): only one live session at a time. */
  singleSession?: boolean;
  /** Plugin directory — defaults to `<databasePath>/../plugins`. */
  pluginsDir?: string;
  /**
   * Desktop split-listener mode: when set, `server` is the internal
   * loopback listener gated by this per-launch token, and a second
   * 0.0.0.0 listener exists only while LAN access is enabled.
   */
  internalToken?: string;
  /** Port for the external (LAN) listener in split-listener mode. */
  externalPort?: number;
}

/** Per-launch token gate for the internal listener (cookie or bearer). */
function internalGate(token: string): (req: IncomingMessage) => boolean {
  return (req) => {
    if (req.headers["x-ps-internal"] === token) return true;
    if (req.headers.authorization === `Bearer ${token}`) return true;
    const cookie = req.headers.cookie ?? "";
    return cookie.split(";").some((c) => c.trim() === `ps_internal=${token}`);
  };
}

/** Bind host per the LAN toggle (TAS 15.3): localhost-only unless enabled. */
export function bindHost(lanEnabled: boolean): string {
  return lanEnabled ? "0.0.0.0" : "127.0.0.1";
}

export function createApp(options: AppOptions): PraiseSuiteApp {
  const storage = openStorage(options);
  const auth = new AuthService(storage);
  let lanEnabled = storage.getSetting("server.lanEnabled") === "true";

  // OpenSong installs its "OpenSong Defaults" (backgrounds + styles) into the
  // data folder on first run — we do the same into media storage + settings.
  void seedOpenSongDefaults(storage, ids);

  // Boot cleanup: sessions pointing at a deleted service are dead — drop
  // them so receivers don't auto-join a session with an empty plan, and
  // remove scratch "(Presented Song)" services no session references.
  void (async () => {
    try {
      const live = await storage.repositories.sessions.listActive();
      const refs = new Set<string>();
      for (const s of live) {
        if (s.serviceId === null) continue;
        if ((await storage.repositories.services.get(s.serviceId)) === null)
          await storage.repositories.sessions.delete(s.id);
        else refs.add(s.serviceId);
      }
      for (const svc of await storage.repositories.services.list()) {
        if (svc.name === "(Presented Song)" && !refs.has(svc.id))
          await storage.repositories.services.delete(svc.id);
      }
    } catch {
      /* cleanup is best-effort */
    }
  })();

  const registry = createRegistry();
  registerSongCommands(registry);
  const transport = new LocalTransport(registry, {
    repos: storage.repositories,
    ids,
    clock,
  });

  const server = createServer();
  const channel = new SessionChannel(server, auth, () => !lanEnabled);
  const webRoot = options.webRoot ? resolve(options.webRoot) : null;

  // Split-listener mode (desktop): `server` is the internal loopback
  // listener gated by a per-launch token; the external 0.0.0.0 listener is
  // created only while LAN access is enabled.
  const internalToken = options.internalToken ?? null;
  const dual = internalToken !== null;
  const gate = internalToken !== null ? internalGate(internalToken) : null;
  let internalPort: number | null = null;
  let externalServer: Server | null = null;

  const setExternal = async (enabled: boolean): Promise<number | null> => {
    if (!enabled) {
      const s = externalServer;
      externalServer = null;
      if (s !== null) await new Promise<void>((r) => s.close(() => r()));
      return null;
    }
    if (externalServer !== null) return (externalServer.address() as { port: number }).port;
    const s = createServer(makeRequestHandler(externalHandler));
    channel.attachTo(s);
    externalServer = s;
    await new Promise<void>((resolvePromise, reject) => {
      s.once("error", reject);
      s.listen(options.externalPort ?? 7729, "0.0.0.0", () => resolvePromise());
    });
    return (s.address() as { port: number }).port;
  };

  const routes = buildRoutes({
    storage,
    repos: storage.repositories,
    transport,
    auth,
    ids,
    broadcastToSession: (sid, msg) => channel.broadcast(sid, msg),
    setLanEnabled: (v) => {
      lanEnabled = v;
      storage.setSetting("server.lanEnabled", String(v));
      // Split-listener mode: the external listener follows the toggle live.
      if (dual) void setExternal(v);
    },
    getLanEnabled: () => lanEnabled,
    getInternalPort: () => internalPort,
    ...(options.externalPort !== undefined ? { externalPort: options.externalPort } : {}),
    ...(options.singleSession !== undefined ? { singleSession: options.singleSession } : {}),
    ...(webRoot !== null ? { webRoot } : {}),
    pluginsDir: options.pluginsDir ?? join(dirname(options.databasePath), "plugins"),
  });
  // LAN off = localhost-only = trusted local user, no token needed.
  const isOpenLocal = () => !lanEnabled;
  const externalHandler = dispatch(routes, auth, isOpenLocal);
  // Internal listener: the launch-token gate already proves it's our own
  // Electron shell — requests are always trusted (no login gate ever).
  const internalHandler = dispatch(routes, auth, () => true);

  const makeRequestHandler = (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ) => async (req: IncomingMessage, res: ServerResponse) => {
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
    let full = resolve(webRoot, file);
    if (!full.startsWith(webRoot)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      // SPA fallback: extension-less paths (/receiver, /stage, ...) are
      // client-side routes — serve the app shell instead of a 404.
      if (!file.includes(".")) {
        full = join(webRoot, "index.html");
      } else {
        res.writeHead(404);
        res.end("not found");
        return;
      }
    }
    const data = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(data);
  };

  server.on("request", (req, res) => {
    // Internal listener (split mode): every request must carry the launch
    // token — loopback alone doesn't keep other local processes out.
    if (gate !== null && !gate(req)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "forbidden", message: "Internal listener" } }));
      return;
    }
    void (dual ? makeRequestHandler(internalHandler) : makeRequestHandler(externalHandler))(req, res);
  });
  // WS upgrades on the internal listener get the same token gate.
  if (gate !== null) {
    server.removeAllListeners("upgrade");
    channel.attachTo(server, { gate, trustLocal: () => true });
  }

  return {
    server,
    storage,
    auth,
    channel,
    getInternalPort: () => internalPort,
    listen: (port, host) =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, host ?? bindHost(lanEnabled), () => resolvePromise());
      }),
    listenInternal: () =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          internalPort = (server.address() as { port: number }).port;
          resolvePromise(internalPort);
        });
      }),
    setExternal,
    close: () =>
      new Promise((resolvePromise) => {
        channel.close();
        storage.close();
        externalServer?.close();
        server.close(() => resolvePromise());
      }),
  };
}
