import { networkInterfaces } from "node:os";
import { z } from "zod";
import { API_VERSION } from "@praisesuite/api-contracts";
import type {
  LocalTransport,
  Repositories,
  Service,
  SessionId,
  Song,
  SongId,
  PresentationSession,
} from "@praisesuite/core";
import type { SqliteStorage } from "@praisesuite/storage-sqlite";
import { ApiError, type Route, type RouteAccess } from "./http.js";
import type { AuthService } from "./auth.js";

const SongSchema = z.object({ id: z.string() }).loose();
const ServiceSchema = z.object({ id: z.string() }).loose();

export interface AppDeps {
  storage: SqliteStorage;
  repos: Repositories;
  transport: LocalTransport;
  auth: AuthService;
  broadcastToSession(sessionId: string, message: unknown): void;
  setLanEnabled(enabled: boolean): void;
  getLanEnabled(): boolean;
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const i of infos ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

export function buildRoutes(deps: AppDeps): Route[] {
  const r = (
    method: string,
    path: string,
    access: RouteAccess,
    summary: string,
    handler: Route["handler"],
  ): Route => ({ method, path, access, summary, handler });

  return [
    r("GET", "/api/v1/health", "public", "Service health + API version", async () => ({
      status: "ok",
      apiVersion: API_VERSION,
      appVersion: "0.0.1",
    })),

    r("POST", "/api/v1/auth/setup", "public", "First-run admin password setup", async (ctx) => {
      if (deps.auth.adminPasswordSet) {
        throw new ApiError(409, "already_configured", "Admin password is already set");
      }
      const body = z.object({ password: z.string().min(8) }).parse(await ctx.body());
      deps.auth.setAdminPassword(body.password);
      return { ok: true };
    }),

    r("POST", "/api/v1/auth/login", "public", "Admin login", async (ctx) => {
      const body = z.object({ password: z.string() }).parse(await ctx.body());
      if (!deps.auth.verifyAdminPassword(body.password)) {
        throw new ApiError(401, "invalid_credentials", "Incorrect password");
      }
      return { token: deps.auth.issue({ sub: "admin", sessionId: null, scopes: ["*"] }) };
    }),

    r("POST", "/api/v1/auth/guest", "admin", "Issue a session-scoped guest token (TAS 13.3)", async (ctx) => {
      const body = z
        .object({
          sessionId: z.string(),
          ttlSeconds: z.number().int().positive().optional(),
          scopes: z.array(z.string()).optional(),
        })
        .parse(await ctx.body());
      return {
        token: deps.auth.issue(
          { sub: "guest", sessionId: body.sessionId, scopes: body.scopes ?? ["view"] },
          body.ttlSeconds ?? 60 * 60 * 12,
        ),
      };
    }),

    r("POST", "/api/v1/auth/revoke", "admin", "Revoke a token by jti", async (ctx) => {
      const body = z.object({ jti: z.string() }).parse(await ctx.body());
      deps.auth.revoke(body.jti);
      return { ok: true };
    }),

    r("GET", "/api/v1/server/network", "admin", "LAN binding state + listen addresses", async () => ({
      lanEnabled: deps.getLanEnabled(),
      addresses: deps.getLanEnabled() ? lanAddresses() : ["127.0.0.1"],
    })),

    r("POST", "/api/v1/server/network", "admin", "Toggle LAN binding (TAS 15.3)", async (ctx) => {
      const body = z.object({ lanEnabled: z.boolean() }).parse(await ctx.body());
      deps.setLanEnabled(body.lanEnabled);
      return { lanEnabled: deps.getLanEnabled(), addresses: deps.getLanEnabled() ? lanAddresses() : ["127.0.0.1"] };
    }),

    r("GET", "/api/v1/songs", "guest", "List/search songs", async (ctx) => {
      const q = ctx.query.get("query");
      return q ? deps.repos.songs.search(q) : deps.repos.songs.list();
    }),

    r("GET", "/api/v1/songs/:id", "guest", "Get a song", async (ctx) => {
      const song = await deps.repos.songs.get(ctx.params["id"]! as SongId);
      if (!song) throw new ApiError(404, "not_found", "Song not found");
      return song;
    }),

    r("POST", "/api/v1/songs", "admin", "Create a song", async (ctx) => {
      const body = await ctx.body();
      const created = z.object({ title: z.string(), authors: z.array(z.string()).optional() }).safeParse(body);
      if (created.success) {
        return deps.transport.command("songs.create", created.data);
      }
      const song = SongSchema.parse(body) as unknown as Song;
      await deps.repos.songs.save(song);
      return song;
    }),

    r("PUT", "/api/v1/songs/:id", "admin", "Update a song", async (ctx) => {
      const song = SongSchema.parse(await ctx.body()) as unknown as Song;
      song.id = ctx.params["id"]! as SongId;
      await deps.repos.songs.save(song);
      return song;
    }),

    r("DELETE", "/api/v1/songs/:id", "admin", "Delete a song", async (ctx) => {
      await deps.repos.songs.delete(ctx.params["id"]! as SongId);
      return { ok: true };
    }),

    r("GET", "/api/v1/services", "guest", "List services", async () => deps.repos.services.list()),

    r("GET", "/api/v1/services/:id", "guest", "Get a service", async (ctx) => {
      const s = await deps.repos.services.get(ctx.params["id"]! as Service["id"]);
      if (!s) throw new ApiError(404, "not_found", "Service not found");
      return s;
    }),

    r("PUT", "/api/v1/services/:id", "admin", "Create/update a service", async (ctx) => {
      const service = ServiceSchema.parse(await ctx.body()) as unknown as Service;
      service.id = ctx.params["id"]! as Service["id"];
      await deps.repos.services.save(service);
      return service;
    }),

    r("DELETE", "/api/v1/services/:id", "admin", "Delete a service", async (ctx) => {
      await deps.repos.services.delete(ctx.params["id"]! as Service["id"]);
      return { ok: true };
    }),

    r("GET", "/api/v1/sessions", "guest", "List active sessions", async () => deps.repos.sessions.listActive()),

    r("GET", "/api/v1/sessions/:id", "guest", "Get a session (guest tokens limited to their own session)", async (ctx) => {
      if (ctx.auth?.sub === "guest" && ctx.auth.sessionId !== ctx.params["id"]) {
        throw new ApiError(403, "forbidden", "Guest token is scoped to a different session");
      }
      const s = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!s) throw new ApiError(404, "not_found", "Session not found");
      return s;
    }),

    r("PUT", "/api/v1/sessions/:id", "admin", "Create/update a session", async (ctx) => {
      const session = z.object({ id: z.string() }).loose().parse(await ctx.body()) as unknown as PresentationSession;
      session.id = ctx.params["id"]! as SessionId;
      await deps.repos.sessions.save(session);
      return session;
    }),

    r("POST", "/api/v1/sessions/:id/position", "admin", "Update musical position and broadcast to subscribers", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      const position = z.object({}).loose().parse(await ctx.body()) as unknown as PresentationSession["position"];
      const updated: PresentationSession = {
        ...session,
        position: { ...position, sessionId: session.id },
        lastActivityAt: new Date().toISOString(),
      };
      await deps.repos.sessions.save(updated);
      deps.broadcastToSession(session.id, { type: "position", sessionId: session.id, position: updated.position });
      return updated;
    }),

    r("GET", "/api/v1/openapi.json", "public", "OpenAPI document", async () => buildOpenApi(deps)),
  ];
}

function buildOpenApi(deps: AppDeps): unknown {
  const paths: Record<string, unknown> = {};
  for (const route of buildRoutes(deps)) {
    if (route.path === "/api/v1/openapi.json") continue;
    const p = paths[route.path] ?? (paths[route.path] = {});
    (p as Record<string, unknown>)[route.method.toLowerCase()] = {
      summary: route.summary,
      security: route.access === "public" ? [] : [{ bearerAuth: [] }],
      parameters: route.path
        .split("/")
        .filter((s) => s.startsWith(":"))
        .map((s) => ({
          name: s.slice(1),
          in: "path",
          required: true,
          schema: { type: "string" },
        })),
      responses: { "200": { description: "Success" } },
    };
  }
  return {
    openapi: "3.0.3",
    info: { title: "PraiseSuite API", version: String(API_VERSION) },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
