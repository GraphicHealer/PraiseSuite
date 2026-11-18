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
import {
  analyzeImport,
  applyImport,
  buildPlan,
  existingInfo,
  indexOfPosition,
  navigate,
  positionOfSlide,
  type ImportFile,
} from "@praisesuite/core";

const SongSchema = z.object({ id: z.string() }).loose();
const ServiceSchema = z.object({ id: z.string() }).loose();

export interface AppDeps {
  storage: SqliteStorage;
  repos: Repositories;
  transport: LocalTransport;
  auth: AuthService;
  ids: import("@praisesuite/core").IdGenerator;
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

    r("GET", "/api/v1/songs", "admin", "List/search songs", async (ctx) => {
      const q = ctx.query.get("query");
      return q ? deps.repos.songs.search(q) : deps.repos.songs.list();
    }),

    r("GET", "/api/v1/songs/:id", "admin", "Get a song", async (ctx) => {
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

    r("GET", "/api/v1/services", "admin", "List services", async () => deps.repos.services.list()),

    r("GET", "/api/v1/services/:id", "admin", "Get a service", async (ctx) => {
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

    r("GET", "/api/v1/sessions/:id/slide", "guest", "Current slide content for receivers (no library exposure)", async (ctx) => {
      if (ctx.auth?.sub === "guest" && ctx.auth.sessionId !== ctx.params["id"]) {
        throw new ApiError(403, "forbidden", "Guest token is scoped to a different session");
      }
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      const slide = await currentSlide(deps.repos, session);
      return {
        sessionId: session.id,
        status: session.status,
        blanked: session.blanked,
        slide,
      };
    }),

    r("POST", "/api/v1/sessions/:id/control", "guest", "Take/release presentation control (TAS 13.4)", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      const body = z.object({ take: z.boolean() }).parse(await ctx.body());
      const auth = ctx.auth!;
      if (auth.sub === "guest" && auth.sessionId !== session.id) {
        throw new ApiError(403, "forbidden", "Guest token is scoped to a different session");
      }
      if (auth.sub === "guest" && !auth.scopes.includes("control")) {
        throw new ApiError(403, "forbidden", "Token lacks the control scope");
      }
      if (body.take) {
        if (session.controlOwner !== null && session.controlOwner !== auth.jti && auth.sub !== "admin") {
          throw new ApiError(409, "control_held", "Another controller holds this session");
        }
        session.controlOwner = auth.jti;
      } else if (session.controlOwner === auth.jti || auth.sub === "admin") {
        session.controlOwner = null;
      }
      session.lastActivityAt = new Date().toISOString();
      await deps.repos.sessions.save(session);
      deps.broadcastToSession(session.id, { type: "control", sessionId: session.id, controlOwner: session.controlOwner });
      return { controlOwner: session.controlOwner };
    }),

    r("POST", "/api/v1/sessions/:id/navigate", "guest", "Move the musical position (next/prev/first/last/jump)", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      requireControl(ctx, session);
      const body = z
        .object({
          action: z.enum(["next", "prev", "first", "last", "jump"]),
          index: z.number().int().nonnegative().optional(),
        })
        .parse(await ctx.body());
      const { plan } = await sessionPlan(deps.repos, session);
      if (plan.slides.length === 0) return { position: session.position, slide: null, total: 0 };
      const position =
        body.action === "jump"
          ? positionOfSlide(plan, Math.min(body.index ?? 0, plan.slides.length - 1), session.id)
          : navigate(plan, session.position, body.action);
      const updated: PresentationSession = {
        ...session,
        position,
        blanked: false,
        lastActivityAt: new Date().toISOString(),
      };
      await deps.repos.sessions.save(updated);
      deps.broadcastToSession(session.id, { type: "position", sessionId: session.id, position, blanked: false });
      return { position, slide: indexOfPosition(plan, position), total: plan.slides.length };
    }),

    r("POST", "/api/v1/sessions/:id/blank", "guest", "Blank/unblank outputs", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      requireControl(ctx, session);
      const body = z.object({ blanked: z.boolean() }).parse(await ctx.body());
      const updated: PresentationSession = { ...session, blanked: body.blanked, lastActivityAt: new Date().toISOString() };
      await deps.repos.sessions.save(updated);
      deps.broadcastToSession(session.id, { type: "blank", sessionId: session.id, blanked: body.blanked });
      return { blanked: body.blanked };
    }),

    r("POST", "/api/v1/import/opensong/preview", "admin", "Analyze OpenSong files without importing", async (ctx) => {
      const body = z
        .object({ files: z.array(z.object({ path: z.string(), text: z.string() })) })
        .parse(await ctx.body());
      const analysis = analyzeImport(body.files as ImportFile[]);
      return {
        songs: analysis.songs.map((s) => ({
          path: s.path,
          title: s.song?.title ?? null,
          authors: s.song?.authors ?? [],
          sections: s.song?.sections.length ?? 0,
          warnings: s.warnings,
          error: s.error ?? null,
        })),
        sets: analysis.sets.map((s) => ({ path: s.path, name: s.name, items: s.items?.length ?? 0, warnings: s.warnings })),
        skipped: analysis.skipped,
        duplicates: analysis.duplicates.length,
      };
    }),

    r("POST", "/api/v1/import/opensong", "admin", "Import OpenSong songs/sets", async (ctx) => {
      const body = z
        .object({
          files: z.array(z.object({ path: z.string(), text: z.string() })),
          onDuplicate: z.enum(["skip", "replace", "import"]).optional(),
        })
        .parse(await ctx.body());
      const summaries = await deps.repos.songs.list();
      const existing = (
        await Promise.all(summaries.map((s) => deps.repos.songs.get(s.id)))
      )
        .filter((s): s is Song => s !== null)
        .map(existingInfo);
      const analysis = analyzeImport(body.files as ImportFile[], existing);
      const report = await applyImport(analysis, deps.ids, deps.repos, {
        onDuplicate: () => body.onDuplicate ?? "skip",
      });
      return report;
    }),

    r("GET", "/api/v1/receiver/join", "public", "Join the most recent live session as a viewer", async () => {
      const sessions = await deps.repos.sessions.listActive();
      const live = sessions
        .filter((s) => s.status === "live")
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
      if (!live) throw new ApiError(404, "no_session", "No live session to join");
      return {
        sessionId: live.id,
        sessionName: live.name,
        token: deps.auth.issue({ sub: "guest", sessionId: live.id, scopes: ["view"] }, 60 * 60 * 12),
      };
    }),

    r("GET", "/api/v1/openapi.json", "public", "OpenAPI document", async () => buildOpenApi(deps)),
  ];
}

/** Build the slide plan for a session's service (empty plan when unattached). */
async function sessionPlan(repos: Repositories, session: PresentationSession) {
  const service = session.serviceId ? await repos.services.get(session.serviceId) : null;
  if (!service) return { service: null, plan: { slides: [], itemStart: [] } };
  const songs = await Promise.all(
    service.items.filter((i) => i.songId !== null).map((i) => repos.songs.get(i.songId!)),
  );
  const plan = buildPlan(
    service,
    new Map(songs.filter((s): s is Song => s !== null).map((s) => [s.id, s])),
  );
  return { service, plan };
}

/** Resolve the session's current slide content for receivers. */
async function currentSlide(repos: Repositories, session: PresentationSession) {
  const { plan } = await sessionPlan(repos, session);
  const idx = indexOfPosition(plan, session.position) ?? 0;
  const slide = plan.slides[idx] ?? null;
  return slide ? { index: idx, total: plan.slides.length, title: slide.title, lines: slide.lines, kind: slide.kind } : null;
}

/** TAS 13.4: control requires admin or a guest token with "control" scope + ownership. */
function requireControl(
  ctx: { auth: import("./auth.js").TokenPayload | null; params: Record<string, string> },
  session: PresentationSession,
): void {
  const auth = ctx.auth;
  if (!auth) throw new ApiError(401, "unauthorized", "Token required");
  if (auth.sub === "guest") {
    if (auth.sessionId !== session.id) throw new ApiError(403, "forbidden", "Guest token is scoped to a different session");
    if (!auth.scopes.includes("control")) throw new ApiError(403, "forbidden", "Token lacks the control scope");
    if (session.controlOwner !== null && session.controlOwner !== auth.jti) {
      throw new ApiError(409, "control_held", "Another controller holds this session");
    }
  }
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
