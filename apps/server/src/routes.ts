import { networkInterfaces } from "node:os";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
  SlideStyle,
  SlideStyleOverride,
  OutputMode,
} from "@praisesuite/core";
import type { SqliteStorage } from "@praisesuite/storage-sqlite";
import { storeMedia } from "@praisesuite/storage-sqlite";
import { ApiError, type Route, type RouteAccess } from "./http.js";
import type { AuthService } from "./auth.js";
import {
  analyzeImport,
  applyImport,
  applyPrintOverrides,
  mergePrintConfig,
  pageCss,
  buildPlan,
  chordSheetHtml,
  defaultSlideStyle,
  existingInfo,
  indexOfPosition,
  navigate,
  parseOpenSongBible,
  parsePresentSettings,
  parsePrintConfig,
  parseMainSettings,
  DEFAULT_PRINT_CONFIG,
  parseReference,
  ACTIVITY,
  positionOfSlide,
  resolveSlideStyle,
  scriptureSlideGroup,
  setListHtml,
  serializeOpenSongSong,
  serializeOpenSongSet,
  songbookHtml,
  lyricsSheetHtml,
  type BibleTranslation,
  type ImportFile,
} from "@praisesuite/core";
import type { BibleId } from "@praisesuite/core";

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
  /** Built web UI directory — used to inject bundled-font @font-face into print docs. */
  webRoot?: string | undefined;
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
      /** Local mode (LAN off) trusts localhost — no login needed. */
      authRequired: deps.getLanEnabled(),
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
        const song = (await deps.transport.command("songs.create", created.data)) as Song;
        const full = await deps.repos.songs.get(song.id);
        if (full) logSongActivity(deps.storage, full, ACTIVITY.created);
        return song;
      }
      const song = SongSchema.parse(body) as unknown as Song;
      await deps.repos.songs.save(song);
      logSongActivity(deps.storage, song, ACTIVITY.created);
      return song;
    }),

    r("PUT", "/api/v1/songs/:id", "admin", "Update a song", async (ctx) => {
      const song = SongSchema.parse(await ctx.body()) as unknown as Song;
      song.id = ctx.params["id"]! as SongId;
      const before = await deps.repos.songs.get(song.id);
      await deps.repos.songs.save(song);
      logSongActivity(deps.storage, song, before && before.folder !== song.folder ? ACTIVITY.moved : ACTIVITY.modified);
      return song;
    }),

    r("DELETE", "/api/v1/songs/:id", "admin", "Delete a song", async (ctx) => {
      const song = await deps.repos.songs.get(ctx.params["id"]! as SongId);
      await deps.repos.songs.delete(ctx.params["id"]! as SongId);
      if (song) logSongActivity(deps.storage, song, ACTIVITY.deleted);
      return { ok: true };
    }),

    // Library folders (OpenSong Songs/ subfolders — virtual here, derived from
    // song.folder plus an explicit list so empty folders can exist).
    r("GET", "/api/v1/folders", "admin", "List library folders", async () => {
      const named = JSON.parse(deps.storage.getSetting("library.folders") ?? "[]") as string[];
      const used = (await deps.repos.songs.list()).map((s) => s.folder).filter((f): f is string => f !== null);
      return { folders: [...new Set([...named, ...used])].sort() };
    }),
    r("POST", "/api/v1/folders", "admin", "Create a library folder", async (ctx) => {
      const { name } = z.object({ name: z.string().min(1) }).parse(await ctx.body());
      const named = JSON.parse(deps.storage.getSetting("library.folders") ?? "[]") as string[];
      if (!named.includes(name)) named.push(name);
      deps.storage.setSetting("library.folders", JSON.stringify(named));
      return { ok: true };
    }),
    r("DELETE", "/api/v1/folders/:name", "admin", "Delete a folder — songs move to the library root", async (ctx) => {
      const name = ctx.params["name"]!;
      const named = (JSON.parse(deps.storage.getSetting("library.folders") ?? "[]") as string[]).filter((f) => f !== name);
      deps.storage.setSetting("library.folders", JSON.stringify(named));
      for (const s of await deps.repos.songs.list()) {
        if (s.folder === name) {
          const song = await deps.repos.songs.get(s.id);
          if (song) {
            song.folder = null;
            await deps.repos.songs.save(song);
          }
        }
      }
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
      const slide = await currentSlide(deps.repos, deps.storage, session);
      return {
        sessionId: session.id,
        status: session.status,
        blanked: session.blanked,
        mode: session.mode,
        alert: session.alert,
        slide,
      };
    }),

    r("GET", "/api/v1/sessions/:id/plan", "guest", "Flattened slide list for the operator console", async (ctx) => {
      if (ctx.auth?.sub === "guest" && ctx.auth.sessionId !== ctx.params["id"]) {
        throw new ApiError(403, "forbidden", "Guest token is scoped to a different session");
      }
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      const { service, plan } = await sessionPlan(deps.repos, session);
      // Section label/prefix lookup for the list's Text column and verse keys.
      const songIds = [...new Set(plan.slides.map((s) => s.songId).filter((x): x is SongId => x !== null))];
      const songList = await Promise.all(songIds.map((id) => deps.repos.songs.get(id)));
      const songs = new Map(songList.filter((s): s is Song => s !== null).map((s) => [s.id, s]));
      const inItem = new Map<string, number>();
      const slides = plan.slides.map((s, i) => {
        const item = service?.items.find((it) => it.id === s.serviceItemId);
        const song = s.songId ? songs.get(s.songId) : undefined;
        const sec = s.sectionId !== null ? song?.sections.find((x) => x.id === s.sectionId) : undefined;
        const arr =
          s.arrangementId !== null ? song?.arrangements.find((a) => a.id === s.arrangementId) : undefined;
        const as =
          s.sectionInstanceId !== null ? arr?.sequence.find((x) => x.id === s.sectionInstanceId) : undefined;
        const n = (inItem.get(s.serviceItemId) ?? 0) + 1;
        inItem.set(s.serviceItemId, n);
        return {
          index: i,
          itemId: s.serviceItemId,
          itemTitle: item?.title ?? s.title,
          itemKind: s.kind,
          slideInItem: n,
          firstLine: s.lines[0] ?? s.title,
          sectionLabel: sec?.label ?? null,
          prefix: as?.prefix ?? null,
          loopSeconds: item?.loopSeconds ?? 0,
          itemNotes: item?.notes ?? null,
        };
      });
      return { slides, current: indexOfPosition(plan, session.position) ?? 0, total: plan.slides.length };
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
          action: z.enum(["next", "prev", "first", "last", "jump", "item"]),
          index: z.number().int().nonnegative().optional(),
          itemId: z.string().optional(),
        })
        .parse(await ctx.body());
      const { plan } = await sessionPlan(deps.repos, session);
      if (plan.slides.length === 0) return { position: session.position, slide: null, total: 0 };
      let position: PresentationSession["position"];
      if (body.action === "jump") {
        position = positionOfSlide(plan, Math.min(body.index ?? 0, plan.slides.length - 1), session.id);
      } else if (body.action === "item") {
        const idx = plan.slides.findIndex((s) => s.serviceItemId === body.itemId);
        position = positionOfSlide(plan, idx === -1 ? 0 : idx, session.id);
      } else {
        position = navigate(plan, session.position, body.action);
      }
      // Activity log: a song is "presented" when its first slide goes live.
      if (position.songId !== session.position.songId && position.songId !== null) {
        const song = await deps.repos.songs.get(position.songId);
        if (song) logSongActivity(deps.storage, song, ACTIVITY.presented);
      }
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

    r("POST", "/api/v1/sessions/:id/mode", "guest", "Set output mode (normal/logo/freeze)", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      requireControl(ctx, session);
      const body = z
        .object({ mode: z.enum(["normal", "blank", "white", "hidden", "logo", "freeze"]) })
        .parse(await ctx.body());
      const updated: PresentationSession = { ...session, mode: body.mode as OutputMode, lastActivityAt: new Date().toISOString() };
      await deps.repos.sessions.save(updated);
      deps.broadcastToSession(session.id, { type: "mode", sessionId: session.id, mode: updated.mode });
      return { mode: updated.mode };
    }),

    r("POST", "/api/v1/sessions/:id/alert", "guest", "Show/clear an alert overlay on all outputs", async (ctx) => {
      const session = await deps.repos.sessions.get(ctx.params["id"]! as SessionId);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      requireControl(ctx, session);
      const body = z.object({ message: z.string().nullable() }).parse(await ctx.body());
      const updated: PresentationSession = { ...session, alert: body.message, lastActivityAt: new Date().toISOString() };
      await deps.repos.sessions.save(updated);
      deps.broadcastToSession(session.id, { type: "alert", sessionId: session.id, alert: body.message });
      return { alert: body.message };
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
        storeMedia: async (name, mediaType, dataBase64) => {
          const m = await storeMedia(deps.storage, deps.ids, {
            data: Buffer.from(dataBase64, "base64"),
            mediaType,
            originalFilename: name,
          });
          return m.storageKey;
        },
      });
      return report;
    }),

    r("GET", "/api/v1/style", "guest", "Global presentation slide style", async () => ({
      ...loadStyle(deps.storage),
      userFieldLabels: (JSON.parse(deps.storage.getSetting("style.userFields") ?? "[]") as string[]).filter((l) => l !== ""),
    })),

    r("PUT", "/api/v1/style", "admin", "Save global presentation slide style", async (ctx) => {
      const body = z.record(z.string(), z.unknown()).parse(await ctx.body());
      const style = { ...defaultSlideStyle(), ...(body as Partial<SlideStyle>) };
      deps.storage.setSetting("style.present", JSON.stringify(style));
      return style;
    }),

    r("POST", "/api/v1/import/opensong/settings", "admin", "Import OpenSong PresentSettings/PrintSettings", async (ctx) => {
      const body = z
        .object({
          presentSettings: z.string().optional(),
          printSettings: z.string().optional(),
          mainSettings: z.string().optional(),
          /** Whether to apply imported fonts/styles over the current style. */
          applyStyle: z.boolean().optional(),
        })
        .parse(await ctx.body());
      const out: { warnings: string[]; style: SlideStyle | null; printRoles: string[]; media: string[] } = {
        warnings: [],
        style: null,
        printRoles: [],
        media: [],
      };
      if (body.presentSettings !== undefined) {
        const parsed = parsePresentSettings(body.presentSettings);
        const style = body.applyStyle === false ? parsed.style : resolveSlideStyle(loadStyle(deps.storage));
        Object.assign(style, {
          title: parsed.style.title,
          body: parsed.style.body,
          subtitle: parsed.style.subtitle,
          descriptiveSubtitles: parsed.style.descriptiveSubtitles,
          highlightChorus: parsed.style.highlightChorus,
          backgroundColor: parsed.style.backgroundColor,
          transition: parsed.style.transition,
          transitionMs: parsed.style.transitionMs,
        });
        if (parsed.backgroundData) {
          const m = await storeMedia(deps.storage, deps.ids, {
            data: Buffer.from(parsed.backgroundData, "base64"),
            mediaType: "image/jpeg",
            originalFilename: "opensong-background.jpg",
          });
          style.backgroundKey = m.storageKey;
          out.media.push(m.storageKey);
        }
        if (parsed.logoData) {
          const m = await storeMedia(deps.storage, deps.ids, {
            data: Buffer.from(parsed.logoData, "base64"),
            mediaType: "image/jpeg",
            originalFilename: "opensong-logo.jpg",
          });
          style.logoKey = m.storageKey;
          out.media.push(m.storageKey);
        }
        deps.storage.setSetting("style.present", JSON.stringify(style));
        deps.storage.setSetting("style.options", JSON.stringify(parsed.options));
        out.style = style;
        out.warnings.push(...parsed.warnings);
      }
      if (body.printSettings !== undefined) {
        const cfg = parsePrintConfig(body.printSettings);
        deps.storage.setSetting("style.print", JSON.stringify(cfg));
        out.printRoles = Object.keys(cfg.roles);
      }
      if (body.mainSettings !== undefined) {
        const main = parseMainSettings(body.mainSettings);
        deps.storage.setSetting("style.userFields", JSON.stringify(main.userFieldLabels));
        out.warnings.push(...main.userFieldLabels.filter((l) => l !== "").map((l) => `user field label: ${l}`));
      }
      return out;
    }),

    r("GET", "/api/v1/bibles", "admin", "List installed Bible translations", async () =>
      biblesIndex(deps.storage)),

    r("POST", "/api/v1/bibles", "admin", "Import a Bible (OpenSong/Zefania XML or provider JSON)", async (ctx) => {
      const body = z
        .object({
          format: z.enum(["opensong", "zefania", "apibible-json"]),
          xml: z.string().optional(),
          json: z.unknown().optional(),
        })
        .parse(await ctx.body());
      const id = deps.ids.next() as BibleId;
      let bible: BibleTranslation;
      if (body.format === "apibible-json") {
        // Provider-fetched canonical JSON (already normalized client-side or by fetch adapter).
        bible = body.json as BibleTranslation;
        bible.id = id;
      } else {
        if (body.xml === undefined) throw new ApiError(400, "missing_xml", "xml field required");
        bible = parseOpenSongBible(body.xml, id);
      }
      await deps.repos.files.put(`bibles/${id}.json`, new TextEncoder().encode(JSON.stringify(bible)));
      const index = biblesIndex(deps.storage);
      index.push({
        id,
        name: bible.name,
        abbreviation: bible.abbreviation,
        books: bible.books.length,
        copyright: bible.copyright,
      });
      deps.storage.setSetting("bibles.index", JSON.stringify(index));
      return { id, name: bible.name, abbreviation: bible.abbreviation, books: bible.books.length };
    }),

    r("GET", "/api/v1/bibles/:id", "admin", "Get a Bible translation", async (ctx) => {
      const bible = await loadBible(deps.repos, ctx.params["id"]!);
      if (!bible) throw new ApiError(404, "not_found", "Bible not found");
      return bible;
    }),

    r("GET", "/api/v1/bibles/:id/passage", "admin", "Verses + slide group for a scripture reference", async (ctx) => {
      const bible = await loadBible(deps.repos, ctx.params["id"]!);
      if (!bible) throw new ApiError(404, "not_found", "Bible not found");
      const refText = ctx.query.get("ref") ?? "";
      const ref = parseReference(refText);
      if (!ref) throw new ApiError(400, "bad_reference", `Cannot parse reference "${refText}"`);
      const group = scriptureSlideGroup(bible, [ref]);
      if (group.slides.length === 1 && group.slides[0]!.body === "") {
        throw new ApiError(404, "not_found", `Reference "${refText}" is outside this translation`);
      }
      return { title: group.title, slides: group.slides, copyright: bible.copyright };
    }),

    r("DELETE", "/api/v1/bibles/:id", "admin", "Remove a Bible translation", async (ctx) => {
      const id = ctx.params["id"]!;
      await deps.repos.files.delete(`bibles/${id}.json`);
      const index = biblesIndex(deps.storage).filter((b) => b.id !== id);
      deps.storage.setSetting("bibles.index", JSON.stringify(index));
      return { ok: true };
    }),

    r("POST", "/api/v1/media", "admin", "Upload a media asset (base64 JSON)", async (ctx) => {
      const body = z
        .object({ name: z.string(), mediaType: z.string(), dataBase64: z.string() })
        .parse(await ctx.body());
      return storeMedia(deps.storage, deps.ids, {
        data: Buffer.from(body.dataBase64, "base64"),
        mediaType: body.mediaType,
        originalFilename: body.name,
      });
    }),

    r("GET", "/api/v1/media/:file", "guest", "Serve a stored media file (backgrounds/logos)", async (ctx) => {
      const key = `media/${ctx.params["file"]}`;
      if (!(await deps.repos.files.has(key))) throw new ApiError(404, "not_found", "Media not found");
      const data = await deps.repos.files.get(key);
      if (data === null) throw new ApiError(404, "not_found", "Media not found");
      const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
      const types: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
      };
      ctx.res.writeHead(200, {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      });
      ctx.res.end(Buffer.from(data));
      return null;
    }),

    // M8 — print/export: raw HTML documents (browser print -> PDF).
    r("GET", "/api/v1/print/song/:id", "admin", "Song sheet: ?mode=chord|lyrics, &transpose=N, &capo=N", async (ctx) => {
      const song = await deps.repos.songs.get(ctx.params["id"]! as SongId);
      if (!song) throw new ApiError(404, "not_found", "Song not found");
      const print = applyPrintOverrides(printConfig(deps.storage), ctx.query);
      const mode = ctx.query.get("mode") ?? "chord";
      const tr = Number.parseInt(ctx.query.get("transpose") ?? "0", 10) || 0;
      const capoRaw = ctx.query.get("capo");
      const capo = capoRaw === null ? undefined : Number.parseInt(capoRaw, 10) || 0;
      const html = mode === "lyrics"
        ? lyricsSheetHtml(song, { print })
        : chordSheetHtml(song, { print, transpose: tr, capo });
      ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end(withFonts(html, deps.webRoot));
      return undefined;
    }),
    r("POST", "/api/v1/songs/:id/log", "admin", "Record a song activity (printed/copied) — called by print/export actions", async (ctx) => {
      const song = await deps.repos.songs.get(ctx.params["id"]! as SongId);
      if (!song) throw new ApiError(404, "not_found", "Song not found");
      const action = Number.parseInt(ctx.query.get("action") ?? `${ACTIVITY.printed}`, 10);
      logSongActivity(deps.storage, song, action);
      return { ok: true };
    }),
    r("GET", "/api/v1/print/service/:id", "admin", "Service set list", async (ctx) => {
      const svc = await deps.repos.services.get(ctx.params["id"]! as Service["id"]);
      if (!svc) throw new ApiError(404, "not_found", "Service not found");
      ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end(withFonts(setListHtml(svc, applyPrintOverrides(printConfig(deps.storage), ctx.query).roles), deps.webRoot));
      return undefined;
    }),
    // "Print songs" (OpenSong btn_set_print_songs): every song item's chord
    // sheet, page-broken, in one document.
    r("GET", "/api/v1/print/service/:id/songs", "admin", "Chord sheets for all songs in a service", async (ctx) => {
      const svc = await deps.repos.services.get(ctx.params["id"]! as Service["id"]);
      if (!svc) throw new ApiError(404, "not_found", "Service not found");
      const parts: string[] = [];
      const cfg = applyPrintOverrides(printConfig(deps.storage), ctx.query);
      for (const item of svc.items.filter((i) => i.kind === "song" && i.songId !== null)) {
        const song = await deps.repos.songs.get(item.songId!);
        if (song) parts.push(chordSheetHtml(song, { print: cfg }));
      }
      if (parts.length === 0) throw new ApiError(404, "not_found", "No songs in service");
      const html = parts
        .map((h) => h.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, ""))
        .join(`<div style="page-break-after:always"></div>`);
      ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end(withFonts(`<!doctype html><html><head><style>${pageCss(cfg.page)}</style></head><body>${html}</body></html>`, deps.webRoot));
      return undefined;
    }),
    // OpenSong-format export (MainWindow "Export" buttons).
    r("GET", "/api/v1/export/song/:id", "admin", "Export a song as OpenSong XML", async (ctx) => {
      const song = await deps.repos.songs.get(ctx.params["id"]! as SongId);
      if (!song) throw new ApiError(404, "not_found", "Song not found");
      const xml = serializeOpenSongSong(song);
      ctx.res.writeHead(200, {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${encodeURIComponent(song.title)}.xml"`,
      });
      ctx.res.end(xml);
      return undefined;
    }),
    r("GET", "/api/v1/export/service/:id", "admin", "Export a service as an OpenSong set", async (ctx) => {
      const svc = await deps.repos.services.get(ctx.params["id"]! as Service["id"]);
      if (!svc) throw new ApiError(404, "not_found", "Service not found");
      const titles = new Map((await deps.repos.songs.list()).map((s) => [s.id as string, s.title]));
      const xml = serializeOpenSongSet(svc, (id) => titles.get(id) ?? null);
      ctx.res.writeHead(200, {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${encodeURIComponent(svc.name)}.xml"`,
      });
      ctx.res.end(xml);
      return undefined;
    }),
    r("GET", "/api/v1/export/songs", "admin", "Export every song as a zip of OpenSong XML", async (ctx) => {
      const { zipSync, strToU8 } = await import("fflate");
      const summaries = await deps.repos.songs.list();
      const files: Record<string, Uint8Array> = {};
      for (const s of summaries) {
        const song = await deps.repos.songs.get(s.id);
        if (!song) continue;
        const path = `${song.folder !== null ? `${song.folder}/` : ""}${song.title}`;
        files[`${path}`] = strToU8(serializeOpenSongSong(song));
      }
      const zip = Buffer.from(zipSync(files));
      ctx.res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="songs.zip"',
      });
      ctx.res.end(zip);
      return undefined;
    }),

    r("GET", "/api/v1/print/songbook", "admin", "Songbook / TOC grouped by theme", async (ctx) => {
      const songs = await deps.repos.songs.list();
      ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end(withFonts(songbookHtml(songs, applyPrintOverrides(printConfig(deps.storage), ctx.query).roles), deps.webRoot));
      return undefined;
    }),

    // Activity log (OpenSong ActivityLog): query + printable CCLI report.
    r("GET", "/api/v1/activity", "admin", "Activity log entries (?from&to&action)", async (ctx) =>
      deps.storage.activityLog({
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
        action: ctx.query.get("action") === null ? undefined : Number.parseInt(ctx.query.get("action")!, 10),
      })),
    r("GET", "/api/v1/print/activity", "admin", "CCLI activity report (?from&to)", async (ctx) => {
      const from = ctx.query.get("from") ?? undefined;
      const to = ctx.query.get("to") ?? undefined;
      const entries = deps.storage.activityLog({ from, to, limit: 5000 }).filter(
        (e) => e.action === ACTIVITY.presented || e.action === ACTIVITY.printed,
      );
      const bySong = new Map<string, { title: string; authors: string; ccli: string; times: number; last: string }>();
      for (const e of entries) {
        const key = e.songId ?? `${e.title}|${e.ccliNumber ?? ""}`;
        const row = bySong.get(key) ?? { title: e.title, authors: e.authors.join("; "), ccli: e.ccliNumber ?? "", times: 0, last: e.at };
        row.times++;
        if (e.at > row.last) row.last = e.at;
        bySong.set(key, row);
      }
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const range = `${from ?? "start"} – ${to ?? "now"}`;
      const rows = [...bySong.values()]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.authors)}</td><td>${esc(r.ccli)}</td><td style="text-align:center">${r.times}</td><td>${esc(r.last.slice(0, 10))}</td></tr>`)
        .join("\n");
      ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>CCLI activity report</title>
<style>@page{margin:2cm}body{font-family:sans-serif;font-size:10pt}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:3pt 6pt;text-align:left}h1{font-size:16pt}</style>
</head><body><h1>CCLI song activity</h1><p>${esc(range)} — ${entries.length} events, ${bySong.size} songs</p>
<table><tr><th>Title</th><th>Authors</th><th>CCLI #</th><th>Times used</th><th>Last used</th></tr>${rows}</table></body></html>`,
      );
      return undefined;
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

/** Load the stored global style (defaults when unset). */
function loadStyle(storage: SqliteStorage): SlideStyle {
  const raw = storage.getSetting("style.present");
  if (!raw) return defaultSlideStyle();
  try {
    return { ...defaultSlideStyle(), ...(JSON.parse(raw) as Partial<SlideStyle>) };
  } catch {
    return defaultSlideStyle();
  }
}

/**
 * Resolve the session's current slide content for receivers: lines plus the
 * effective style chain (global -> item/song overrides), background, logo,
 * announcement-loop timing, and the next slide for confidence view.
 */
async function currentSlide(repos: Repositories, storage: SqliteStorage, session: PresentationSession) {
  const { service, plan } = await sessionPlan(repos, session);
  const idx = indexOfPosition(plan, session.position) ?? 0;
  const slide = plan.slides[idx] ?? null;
  if (!slide) return null;
  const item = service?.items.find((i) => i.id === slide.serviceItemId);
  const song = slide.songId ? await repos.songs.get(slide.songId) : null;
  const style = resolveSlideStyle(
    loadStyle(storage),
    item?.config["style"] as SlideStyleOverride | undefined,
  );
  const next = plan.slides[idx + 1] ?? null;
  return {
    index: idx,
    total: plan.slides.length,
    title: slide.title,
    lines: slide.lines,
    kind: slide.kind,
    mediaKey: slide.mediaKey,
    style,
    /** Per-verse background wins over song-level, which wins over style. */
    backgroundKey: slide.backgroundKey ?? song?.background ?? style.backgroundKey,
    backgroundAsText: slide.backgroundAsText,
    logoKey: style.logoKey,
    /** Announcement-loop timing in seconds (OpenSong item loop interval). */
    loopSeconds: typeof item?.config["loopSeconds"] === "number" ? (item.config["loopSeconds"] as number) : null,
    next: next ? { title: next.title, lines: next.lines } : null,
  };
}

/** Imported PrintSettings config (style.print setting) for the print engine. */
/** Record an OpenSong-style activity entry for a song. */
function logSongActivity(storage: SqliteStorage, song: Song, action: number): void {
  storage.logActivity({
    at: new Date().toISOString(),
    action,
    songId: song.id,
    filename: song.folder !== null ? `${song.folder}/${song.title}` : song.title,
    title: song.title,
    authors: song.authors,
    ccliNumber: song.ccliNumber,
    hasChords: (song.sections ?? []).some((s) => s.lines.some((l) => l.chords.length > 0)),
  });
}

function printConfig(storage: SqliteStorage): import("@praisesuite/core").PrintConfig {
  try {
    return mergePrintConfig(JSON.parse(storage.getSetting("style.print") ?? "{}") as Partial<import("@praisesuite/core").PrintConfig>);
  } catch {
    return DEFAULT_PRINT_CONFIG;
  }
}

/**
 * @font-face rules for the bundled UI fonts (Inter / Source Serif 4 /
 * JetBrains Mono). Print documents render in their own window — without this
 * they fall back to system fonts even when a role names a bundled family.
 * Scanned once from the web build's hashed asset names.
 */
let fontFacesCache: string | null = null;
function fontFacesCss(webRoot: string | undefined): string {
  if (fontFacesCache !== null) return fontFacesCache;
  fontFacesCache = "";
  if (webRoot === undefined) return fontFacesCache;
  try {
    const files = readdirSync(join(webRoot, "assets"));
    const rules: string[] = [];
    for (const [slug, family] of [["inter", "Inter"], ["source-serif-4", "Source Serif 4"], ["jetbrains-mono", "JetBrains Mono"]] as const) {
      for (const weight of [400, 700]) {
        const file = files.find((n) => n.startsWith(`${slug}-latin-${weight}-normal-`) && n.endsWith(".woff2"));
        if (file) rules.push(`@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url('/assets/${file}') format('woff2')}`);
      }
    }
    fontFacesCache = rules.join("\n");
  } catch {
    // no web build (dev mode) — print docs use system fonts
  }
  return fontFacesCache;
}

/** Inject bundled-font @font-face into a rendered print document. */
function withFonts(html: string, webRoot: string | undefined): string {
  const css = fontFacesCss(webRoot);
  return css === "" ? html : html.replace("</head>", `<style>${css}</style></head>`);
}

function biblesIndex(storage: SqliteStorage): { id: string; name: string; abbreviation: string; books: number; copyright: string | null }[] {
  try {
    return JSON.parse(storage.getSetting("bibles.index") ?? "[]") as ReturnType<typeof biblesIndex>;
  } catch {
    return [];
  }
}

async function loadBible(repos: Repositories, id: string): Promise<BibleTranslation | null> {
  const data = await repos.files.get(`bibles/${id}.json`);
  if (data === null) return null;
  return JSON.parse(new TextDecoder().decode(data)) as BibleTranslation;
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
