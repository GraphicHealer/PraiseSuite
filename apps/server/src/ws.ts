import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import type { AuthService, TokenPayload } from "./auth.js";

const HEARTBEAT_MS = 30_000;

interface Client {
  ws: WebSocket;
  auth: TokenPayload;
  sessions: Set<string>;
  alive: boolean;
}

export interface AttachOptions {
  /** Pre-auth gate run before any upgrade handling — reject returns false. */
  gate?: (req: IncomingMessage) => boolean;
  /** Requests without a token authenticate as local admin (internal listener). */
  trustLocal?: () => boolean;
}

/**
 * Session-scoped WebSocket channel. Clients authenticate with a bearer
 * token, then subscribe to session rooms. Guest tokens (TAS 13.3) may only
 * subscribe to the session they were issued for.
 */
export class SessionChannel {
  private readonly wss: WebSocketServer;
  private readonly rooms = new Map<string, Set<Client>>();
  private readonly clients = new Set<Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly auth: AuthService,
    private readonly isOpenLocal: () => boolean = () => false,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.attachTo(server);

    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          this.drop(c);
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Route a server's upgrade events into this channel (multi-listener). */
  attachTo(server: Server, opts: AttachOptions = {}): void {
    const trustLocal = opts.trustLocal ?? this.isOpenLocal;
    server.on("upgrade", (req, socket, head) => {
      if (opts.gate !== undefined && !opts.gate(req)) {
        socket.destroy();
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      const token = url.searchParams.get("token");
      const payload = (token ? this.auth.verify(token) : null)
        ?? (trustLocal() ? { sub: "admin", jti: "local", scopes: [], sessionId: null, iat: 0, exp: 0 } as const : null);
      if (!payload) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, payload));
    });
  }

  private attach(ws: WebSocket, auth: TokenPayload): void {
    const client: Client = { ws, auth, sessions: new Set(), alive: true };
    this.clients.add(client);
    ws.on("pong", () => (client.alive = true));
    ws.on("message", (data) => {
      let msg: { type?: string; sessionId?: string };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "subscribe" && typeof msg.sessionId === "string") {
        this.subscribe(client, msg.sessionId);
      }
    });
    ws.on("close", () => this.drop(client));
    ws.send(JSON.stringify({ type: "hello", apiVersion: 1 }));
  }

  private subscribe(client: Client, sessionId: string): void {
    if (client.auth.sub === "guest" && client.auth.sessionId !== sessionId) {
      client.ws.send(JSON.stringify({ type: "error", code: "forbidden", message: "Token is not scoped to that session" }));
      return;
    }
    let room = this.rooms.get(sessionId);
    if (!room) this.rooms.set(sessionId, (room = new Set()));
    room.add(client);
    client.sessions.add(sessionId);
    client.ws.send(JSON.stringify({ type: "subscribed", sessionId }));
  }

  broadcast(sessionId: string, message: unknown): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const data = JSON.stringify(message);
    for (const c of room) c.ws.send(data);
  }

  private drop(client: Client): void {
    for (const sid of client.sessions) this.rooms.get(sid)?.delete(client);
    this.clients.delete(client);
    try {
      client.ws.terminate();
    } catch {
      // already gone
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of [...this.clients]) this.drop(c);
    this.wss.close();
  }
}
